"""
data.py — Données de la carte interactive ANCT
Raphaël Roumeau — mars 2026

Rôle : chargement, mise en cache et exposition des données géographiques
et programmatiques utilisées par l'API (routes.py).

Optimisations :
- Cache mémoire 24 h unifié (_cache) avec helpers _valide / _get / _set
- Chargement parallèle des programmes (ThreadPoolExecutor)
- GeoJSON communes compressé GZip en cache binaire (payload 5-8× plus léger)
- Index de recherche textuelle pré-calculé en mémoire → recherche O(n) sans I/O
"""

import csv
import gzip
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from unicodedata import category, normalize

import geopandas as gpd
import pandas as pd

from pathlib import Path
_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# SOURCES DE DONNÉES (data.gouv.fr)
# ---------------------------------------------------------------------------

SOURCES_DATAGOUV: dict[str, str] = {
    "fs":    "https://www.data.gouv.fr/api/1/datasets/r/f49fe9e1-f9bb-4dbd-8dfe-b9fad31899ef",
    "cde":   "https://www.data.gouv.fr/api/1/datasets/r/00e9a547-50c9-46a2-bbfb-b403e8e1eca6",
    "cite":  "https://www.data.gouv.fr/api/1/datasets/r/37b9f49b-79aa-4093-afa3-3cbd68f72867",
    "ti":    "https://www.data.gouv.fr/api/1/datasets/r/2a228141-469f-4945-a9bf-f8c46f694022",
    "site":  "https://www.data.gouv.fr/api/1/datasets/r/5f2e1413-552a-43fc-9669-74169cbca87d",
    "acv":   "https://www.data.gouv.fr/api/1/datasets/r/8b6f422b-cbdf-459a-9a16-d6be4b92d91a",
    "edv":   "https://www.data.gouv.fr/api/1/datasets/r/ed3486ee-a70d-4ad7-b448-49f1c340dfe9",
    "pvd":   "https://www.data.gouv.fr/api/1/datasets/r/1fa831ec-d912-4277-8b95-a8b998bf951e",
    "va":    "https://www.data.gouv.fr/api/1/datasets/r/fbef04bb-3df9-4d6d-a23f-0a0034f6a3f8",
    "fabt":  "https://www.data.gouv.fr/api/1/datasets/r/309049b4-f9f7-4038-a2b4-875ef32eca7c",
    "manup": "https://www.data.gouv.fr/api/1/datasets/r/a1cf9852-7be2-49bc-8981-a989cc70b6d0",
    "crte":  "https://www.data.gouv.fr/api/1/datasets/r/614e8d6f-934e-45a4-ae58-cd5a621ea16a",
    "ami":   "https://www.data.gouv.fr/api/1/datasets/r/20530b87-b74e-4372-961f-a51dd818ac36",
    "amm":   "https://www.data.gouv.fr/api/1/datasets/r/370d0ac5-fd43-4c62-b1a5-eea6f1fd90d3",
    "fabp":  "https://www.data.gouv.fr/api/1/datasets/r/87d38102-b2c1-4e81-9a9d-4d922effc8f8",
    "pao":    "https://www.data.gouv.fr/api/1/datasets/r/6de2ad29-6671-4cd7-beca-637a5b183fd0",
    "frla":   "https://www.data.gouv.fr/api/1/datasets/r/3fbacdea-2afd-44e9-96ce-1099f128d795",
    "comrur": "https://www.data.gouv.fr/api/1/datasets/r/c6e360a4-d979-4297-b0d4-c3aee158c531",
    "ptzc":   "https://www.data.gouv.fr/api/1/datasets/r/8c627383-0d11-403e-8621-2b82bf223f27",
}

# Mapping : clé interne → nom de colonne dans le CSV
MAPPING_ID_COLONNE = {
    "fs":    "id_fs",
    "cde":   "id_cde",
    "cite":  "id_cite",
    "ti":    "id_ti",
    "site":  "id_site",
    "acv":   "id_acv",
    "edv":   "id_acv2",
    "pvd":   "id_pvd",
    "va":    "id_va",
    "fabp":  "id_fabp",
    "manup": "id_manup",
    "crte":  "id_crte",
    "ami":   "id_ami",
    "amm":   "id_amm",
    "fabt":  "id_fabt",
    "pao":    "id_pao",
    "frla":   "id_frla",
    "comrur": "id_comrur",
    "ptzc":   "id_ptzc",
}

# ---------------------------------------------------------------------------
# CHEMINS LOCAUX
# ---------------------------------------------------------------------------

_BASE = str(_ROOT / "data" / "admin")

COMMUNES_CENTROIDE    = f"{_BASE}/centroide-4326_com.geojson"
COMMUNES_POLYGONE     = f"{_BASE}/polygone-4326_com.geojson"
EPCI_EPT_POLYGONE     = f"{_BASE}/polygone-4326_epci-ept.geojson"
DEPARTEMENTS_POLYGONE = f"{_BASE}/polygone-4326_dep.geojson"
REGIONS_POLYGONE      = f"{_BASE}/polygone-4326_reg.geojson"
ARR_POLYGONE  = f"{_BASE}/polygone-4326_arr.geojson"
CRTE_POLYGONE = f"{_BASE}/polygone-4326_crte.geojson"
MONTAGNE_POLYGONE = f"{_BASE}/polygone-4326_montagne.geojson"
TI_POLYGONE   = f"{_BASE}/polygone-4326_ti.geojson"
QPV_CENTROIDE = f"{_BASE}/centroide-4326_qpv.geojson"
AMI_POLYGONE  = f"{_BASE}/polygone-4326_ami.geojson"
AMM_POLYGONE  = f"{_BASE}/polygone-4326_amm.geojson"
FABP_POLYGONE = f"{_BASE}/polygone-4326_fabriques.geojson"

# Zonages nécessitant une jointure spatiale (pas déjà présents dans les communes)
ZONAGES_SPATIAUX = {
    "id_ti":   {"chemin": TI_POLYGONE,   "col_id": None},       # None = détection auto "id_*"
    "id_ami":  {"chemin": AMI_POLYGONE,  "col_id": None},
    "id_amm":  {"chemin": AMM_POLYGONE,  "col_id": None},
    "id_fabp": {"chemin": FABP_POLYGONE, "col_id": None},
}

# ---------------------------------------------------------------------------
# CACHE MÉMOIRE (durée de vie : 24 h)
# Structure : { clé: {"data": ..., "ts": datetime} }
# ---------------------------------------------------------------------------

DUREE_CACHE = timedelta(hours=24)

_cache: dict = {}


def _valide(cle: str) -> bool:
    """Vérifie qu'une entrée de cache existe et n'a pas expiré."""
    entree = _cache.get(cle)
    return entree is not None and datetime.now() - entree["ts"] < DUREE_CACHE


def _get(cle: str):
    """Retourne la valeur d'une entrée de cache (sans vérification d'expiration)."""
    return _cache[cle]["data"]


def _set(cle: str, valeur) -> None:
    """Stocke une valeur en cache avec un horodatage."""
    _cache[cle] = {"data": valeur, "ts": datetime.now()}


# ---------------------------------------------------------------------------
# UTILITAIRE — normalisation de texte pour la recherche
# ---------------------------------------------------------------------------

def _norm(s) -> str:
    """
    Retourne la chaîne en minuscules sans diacritiques.
    Retourne '' pour toute valeur non-string (NaN, float…).
    """
    if not isinstance(s, str):
        return ""
    return "".join(
        c for c in normalize("NFD", s.lower())
        if category(c) != "Mn"
    )


# ---------------------------------------------------------------------------
# CHARGEMENT GeoDataFrame (avec cache)
# ---------------------------------------------------------------------------

def _geo(cle: str, chemin: str) -> gpd.GeoDataFrame:
    """Charge un GeoDataFrame depuis le disque et le met en cache."""
    if _valide(cle):
        return _get(cle)
    print(f"  → Chargement GDF '{cle}'…")
    gdf = gpd.read_file(chemin)
    _set(cle, gdf)
    return gdf


# ---------------------------------------------------------------------------
# PROGRAMMES ANCT
# ---------------------------------------------------------------------------

def _charger_source(nom: str, url: str) -> pd.DataFrame | None:
    """Télécharge un programme depuis data.gouv.fr. Retourne None en cas d'erreur."""
    try:
        df = pd.read_csv(url, dtype={"insee_com": str})
        df["programme"] = nom
        print(f"  → {nom} ({len(df)} lignes)")
        return df
    except Exception as e:
        print(f"  ⚠ {nom} : {e}")
        return None


def charger_programmes() -> pd.DataFrame:
    """
    Télécharge toutes les sources de programmes en parallèle et les concatène.
    Résultat mis en cache 24 h.
    """
    if _valide("programmes"):
        return _get("programmes")

    print("Téléchargement des programmes…")
    frames = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {
            executor.submit(_charger_source, nom, url): nom
            for nom, url in SOURCES_DATAGOUV.items()
        }
        for future in as_completed(futures):
            df = future.result()
            if df is not None:
                frames.append(df)

    result = pd.concat(frames, ignore_index=True)
    print(f"  → {len(result)} lignes / {len(frames)} sources")
    _set("programmes", result)
    return result


# ---------------------------------------------------------------------------
# COMMUNES
# ---------------------------------------------------------------------------
def _detecter_col_id(gdf, col_id_forcee=None):
    if col_id_forcee:
        return col_id_forcee
    for col in gdf.columns:
        if col.startswith("id_"):
            return col
    raise ValueError("Aucune colonne 'id_*' trouvée dans ce zonage.")


def _calculer_zonages(communes: gpd.GeoDataFrame) -> pd.DataFrame:
    """
    Jointure spatiale communes ↔ chaque zonage polygone.
    Retourne un DataFrame indexé par insee_com avec une colonne id_xxx par zonage
    (chaîne vide si hors zonage, ids séparés par ';' si plusieurs matches).
    """
    result = communes[["insee_com"]].copy()

    for nom_col, cfg in ZONAGES_SPATIAUX.items():
        try:
            zone_gdf = gpd.read_file(cfg["chemin"])
            if zone_gdf.crs != communes.crs:
                zone_gdf = zone_gdf.to_crs(communes.crs)
            col_id = _detecter_col_id(zone_gdf, cfg["col_id"])

            jointure = gpd.sjoin(
                communes[["insee_com", "geometry"]],
                zone_gdf[[col_id, "geometry"]],
                how="left",
                predicate="within",
            )
            agrege = (
                jointure.groupby("insee_com")[col_id]
                .apply(lambda s: ";".join(sorted({str(v) for v in s.dropna()})))
                .reset_index()
                .rename(columns={col_id: nom_col})
            )
            result = result.merge(agrege, on="insee_com", how="left")
            result[nom_col] = result[nom_col].fillna("")
        except Exception as e:
            print(f"  ⚠ Zonage '{nom_col}' : {e}")
            result[nom_col] = ""

    return result

def charger_communes() -> gpd.GeoDataFrame:
    """..."""
    if _valide("communes"):
        return _get("communes")

    print("Chargement des communes…")
    communes = gpd.read_file(COMMUNES_CENTROIDE)
    communes["insee_com"] = communes["insee_com"].astype(str)

    # Agrégation avec conservation de TOUS les IDs
    progs = charger_programmes()
    
    # Crée un dict {insee_com: {id_prog_key: [ids_séparés]}}
    ids_par_commune = {}
    for _, row in progs.iterrows():
        insee = str(row["insee_com"]).zfill(5)
        prog_key = row["programme"]
        id_field = MAPPING_ID_COLONNE.get(prog_key, f"id_{prog_key}")
        prog_id = row.get(id_field, "")
        
        if insee not in ids_par_commune:
            ids_par_commune[insee] = {}
        
        # Utilise "id_prog_key" comme clé (pas juste prog_key)
        col_name = MAPPING_ID_COLONNE.get(prog_key, f"id_{prog_key}")
        if col_name not in ids_par_commune[insee]:
            ids_par_commune[insee][col_name] = []
        
        if prog_id and str(prog_id).strip() and str(prog_id) != "nan":
            ids_par_commune[insee][col_name].append(str(prog_id).strip())
    
    progs_par_commune = (
        progs.groupby("insee_com")["programme"]
        .apply(list)  # ✓ Sans déduplication
        .reset_index()
        .rename(columns={"programme": "liste_programmes"})
    )

    communes = communes.merge(progs_par_commune, on="insee_com", how="left")
    communes["liste_programmes"] = communes["liste_programmes"].apply(
        lambda x: x if isinstance(x, list) else []
    )
    
    communes["ids_par_programme"] = communes["insee_com"].apply(
        lambda insee: ids_par_commune.get(insee, {})
    )
    zonages = _calculer_zonages(communes)
    communes = communes.merge(zonages, on="insee_com", how="left")

    # QPV : jointure attributaire directe sur insee_com (plus de jointure
    # spatiale nécessaire maintenant que le fichier QPV est en centroïdes).
    qpv_brut = gpd.read_file(QPV_CENTROIDE)
    qpv_brut["insee_com"] = qpv_brut["insee_com"].astype(str)
    id_qp = (
        qpv_brut.groupby("insee_com")["code_qp"]
        .apply(lambda s: ";".join(sorted({str(v) for v in s.dropna()})))
        .reset_index()
        .rename(columns={"code_qp": "id_qp"})
    )
    communes = communes.merge(id_qp, on="insee_com", how="left")
    communes["id_qp"] = communes["id_qp"].fillna("")

    _set("communes", communes)
    return communes


# ---------------------------------------------------------------------------
# SÉRIALISATION COMMUNES — GeoJSON compressé GZip (mis en cache)
# ---------------------------------------------------------------------------

def get_communes_json() -> tuple[bytes, str]:
    """
    Retourne (body_gzip, etag).
    Recompresse uniquement si le cache des communes a été rafraîchi.
    """
    communes_ts = _cache.get("communes", {}).get("ts")

    if _valide("communes_gz") and _cache.get("communes_gz_ts") == communes_ts:
        entry = _get("communes_gz")
        return entry["body"], entry["etag"]

    gdf  = charger_communes()
    raw  = gdf.to_json().encode()
    body = gzip.compress(raw, compresslevel=6)
    etag = hashlib.md5(body).hexdigest()

    _set("communes_gz", {"body": body, "etag": etag})
    _cache["communes_gz_ts"] = communes_ts
    return body, etag

# Colonnes territoriales reportées des communes vers les QPV, pour permettre
# le filtrage par territoire recherché côté carte (comme pour les programmes).
_COLONNES_TERRITOIRE_QPV = ["insee_dep", "insee_reg", "siren_epci", "insee_arr", "id_crte", "niveau_montagne"]


def charger_qpv() -> gpd.GeoDataFrame:
    """Charge les centroïdes QPV et leur ajoute les codes territoriaux de la commune de rattachement."""
    if _valide("qpv"):
        return _get("qpv")

    print("Chargement des QPV…")
    qpv = gpd.read_file(QPV_CENTROIDE)
    qpv["insee_com"] = qpv["insee_com"].astype(str)

    communes = charger_communes()
    colonnes_dispo = [c for c in _COLONNES_TERRITOIRE_QPV if c in communes.columns]
    qpv = qpv.merge(communes[["insee_com"] + colonnes_dispo], on="insee_com", how="left")

    _set("qpv", qpv)
    return qpv


def get_qpv_json() -> dict:
    """GeoJSON des QPV (centroïdes) enrichi des codes territoriaux."""
    return json.loads(charger_qpv().to_json())

# ---------------------------------------------------------------------------
# INDEX DE RECHERCHE TEXTUELLE
# Construit une fois en mémoire à partir des couches polygones.
# Invalidé automatiquement si le cache géographique change.
# Structure : { type: [ {"nom", "nom_norm", "code", "type", "bbox"}, … ] }
# ---------------------------------------------------------------------------

# Définition des couches indexées : (type, clé cache, fichier, colonne nom, colonne code)
_SPECS_INDEX = [
    ("commune",        "geo_communes",        COMMUNES_POLYGONE,        "lib_com",          "insee_com"),
    ("epci",           "geo_epci",            EPCI_EPT_POLYGONE,        "lib_epci",         "siren_epci"),
    ("departement",    "geo_departements",    DEPARTEMENTS_POLYGONE,    "lib_dep",          "insee_dep"),
    ("region",         "geo_regions",         REGIONS_POLYGONE,         "lib_reg",          "insee_reg"),
    ("arr",            "geo_arr",             ARR_POLYGONE,             "lib_arr",          "insee_arr"),
    ("crte",           "geo_crte",            CRTE_POLYGONE,            "lib_crte",         "id_crte"),
    ("massif",         "geo_massif",          MONTAGNE_POLYGONE,        "niveau_montagne",  "niveau_montagne"),
]

# Nombre maximum de résultats retournés par type
_LIMITES_RECHERCHE = {
    "commune": 10, "epci": 5, "departement": 5, "region": 5,
    "arr": 5, "crte": 5, "massif": 10,  # ← nouveau
}


def _construire_index() -> dict:
    """Parcourt les couches géographiques et construit l'index de recherche."""
    print("  → Construction de l'index de recherche…")
    index = {}

    for type_, cle, chemin, col_nom, col_code in _SPECS_INDEX:
        gdf = _geo(cle, chemin)
        entrees = []
        for _, row in gdf.iterrows():
            nom  = row[col_nom]
            code = row[col_code]
            # Ignore les lignes avec un nom ou un code manquant
            if not isinstance(nom, str) or not nom.strip():
                continue
            if not isinstance(code, str) or not code.strip():
                continue
            b = row.geometry.bounds
            entrees.append({
                "nom":      nom,
                "nom_norm": _norm(nom),
                "code":     code,
                "type":     type_,
                "bbox":     [b[0], b[1], b[2], b[3]],
            })
        index[type_] = entrees

    return index


def _get_index() -> dict:
    """Retourne l'index de recherche (depuis le cache ou reconstruit si expiré)."""
    if _valide("search_index"):
        return _get("search_index")
    idx = _construire_index()
    _set("search_index", idx)
    return idx


def rechercher_entites(q: str, types: list[str] | None = None) -> list[dict]:
    if not q or len(q) < 2:
        return []

    q_norm   = _norm(q)
    types_ok = set(types) if types else set(_LIMITES_RECHERCHE) | {"france"}
    index    = _get_index()
    resultats = []

    for type_, entrees in index.items():
        if type_ not in types_ok:
            continue
        n = 0
        for entree in entrees:
            if q_norm in entree["nom_norm"]:
                resultats.append({k: entree[k] for k in ("nom", "code", "type", "bbox")})
                n += 1
                if n >= _LIMITES_RECHERCHE[type_]:
                    break

    if "france" in types_ok and q_norm in _norm("france"):
        b = charger_communes().total_bounds
        resultats.append({"nom": "France entière", "code": "FR", "type": "france",
                           "bbox": [b[0], b[1], b[2], b[3]]})

    return resultats


# ---------------------------------------------------------------------------
# TYPOLOGIES COMMUNALES
# ---------------------------------------------------------------------------

TYPOLOGIES: dict[str, dict] = {
    "centralite": {
        "chemin": str(_ROOT / "data" / "grilles" / "centralite.csv"),
        "col":    "niveau_centralite",
        "ordre":  [
            "Communes non centre",
            "Centre local d'équipements et de services",
            "Centre intermédiaire d'équipements et de services",
            "Centre structurant d'équipements et de services",
            "Centre majeur d'équipements et de services",
        ],
    },
    "densite": {
        "chemin": str(_ROOT / "data" / "grilles" / "densite.csv"),
        "col":    "niveau_densite",
        "ordre":  [
            "Rural à habitat très dispersé",
            "Rural à habitat dispersé",
            "Bourgs ruraux",
            "Petites villes",
            "Ceintures urbaines",
            "Centres urbains intermédiaires",
            "Grands centres urbains",
        ],
    },
    "ruralite": {
        "chemin": str(_ROOT / "data" / "grilles" / "ruralite.csv"),
        "col":    "niveau_ruralite",
        "ordre":  None,  # ordre alphabétique par défaut
    },
}


def charger_typologie(key: str) -> dict:
    """
    Retourne {insee_com: niveau} pour une typologie donnée.
    Résultat mis en cache 24 h.
    """
    cle_cache = f"typo_{key}"
    if _valide(cle_cache):
        return _get(cle_cache)

    cfg = TYPOLOGIES[key]
    result = {}
    with open(cfg["chemin"], encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            insee = row["insee_com"].strip().zfill(5)
            result[insee] = row[cfg["col"]].strip()

    _set(cle_cache, result)
    return result


def get_typologies_meta() -> dict:
    """Retourne les métadonnées des typologies (nom de colonne et ordre des classes)."""
    return {k: {"col": v["col"], "ordre": v["ordre"]} for k, v in TYPOLOGIES.items()}

    
    print("🚀 Préchargement complet…")
    charger_programmes()
    charger_communes()
    charger_communes_json()
    _get_index()
    
    for key in ["centralite", "densite", "ruralite"]:
        charger_typologie(key)
    
    result = {"status": "ok"}
    _set("precharge_complet", result)
    return result


# ---------------------------------------------------------------------------
# API PUBLIQUE — utilisée par routes.py
# ---------------------------------------------------------------------------

def get_communes() -> dict:
    """GeoJSON complet des communes (non compressé)."""
    return json.loads(charger_communes().to_json())


def get_programmes() -> dict:
    """Liste dédupliquée des identifiants de programmes."""
    return {"programmes": charger_programmes()["programme"].unique().tolist()}


def get_detail_commune(insee_com: str) -> dict | None:
    """GeoJSON des communes filtrées par code INSEE commune."""
    c = charger_communes()
    res = c[c["insee_com"] == insee_com]
    return json.loads(res.to_json()) if not res.empty else None


def get_detail_departement(insee_dep: str) -> dict | None:
    """GeoJSON des communes filtrées par code INSEE département."""
    c = charger_communes()
    res = c[c["insee_dep"] == insee_dep]
    return json.loads(res.to_json()) if not res.empty else None


def get_detail_region(insee_reg: str) -> dict | None:
    """GeoJSON des communes filtrées par code INSEE région."""
    c = charger_communes()
    res = c[c["insee_reg"] == insee_reg]
    return json.loads(res.to_json()) if not res.empty else None


def get_detail_epci(siren_epci: str) -> dict | None:
    """GeoJSON des communes filtrées par SIREN EPCI."""
    c = charger_communes()
    res = c[c["siren_epci"] == siren_epci]
    return json.loads(res.to_json()) if not res.empty else None


def get_detail_ept(siren_ept: str) -> dict | None:
    """GeoJSON des communes filtrées par SIREN EPT."""
    c = charger_communes()
    res = c[c["siren_ept"] == siren_ept]
    return json.loads(res.to_json()) if not res.empty else None


def get_detail_arr(insee_arr: str) -> dict | None:
    """GeoJSON des communes filtrées par code INSEE arrondissement."""
    c = charger_communes()
    res = c[c["insee_arr"] == insee_arr]
    return json.loads(res.to_json()) if not res.empty else None


def get_detail_crte(id_crte: str) -> dict | None:
    """GeoJSON des communes filtrées par id CRTE."""
    c = charger_communes()
    res = c[c["id_crte"] == id_crte]
    return json.loads(res.to_json()) if not res.empty else None

def get_detail_massif(code: str) -> dict | None:
    """GeoJSON des communes filtrées par massif (niveau_montagne)."""
    c = charger_communes()
    res = c[c["niveau_montagne"] == code]
    return json.loads(res.to_json()) if not res.empty else None


def get_detail_france() -> dict:
    """GeoJSON de toutes les communes, sans filtre."""
    return json.loads(charger_communes().to_json())


def exporter_csv(communes_insee: list[str], programmes_selectionnés: list[str]) -> str:
    """Génère le CSV avec l'ensemble des programmes, zonages et massifs."""
    import csv
    import io

    communes = charger_communes()

    if communes_insee:
        communes = communes[communes["insee_com"].isin(communes_insee)]

    typologies = {
        "centralite": charger_typologie("centralite"),
        "densite": charger_typologie("densite"),
        "ruralite": charger_typologie("ruralite"),
    }

    # Colonnes territoriales de base
    headers = ["insee_com", "siren_epci", "insee_arr", "insee_dep", "insee_reg",
               "id_crte", "niveau_montagne"]

    # Tous les programmes existants (indépendamment de la sélection sur la carte)
    colonnes_programmes = list(dict.fromkeys(MAPPING_ID_COLONNE.values()))
    headers.extend(colonnes_programmes)

    # Zonages calculés par jointure spatiale
    colonnes_zonages = list(ZONAGES_SPATIAUX.keys()) + ["id_qp"]
    headers.extend(colonnes_zonages)

    # Typologies
    headers.extend([
        "Niveau de centres d'équipements et de services des communes 2021",
        "Grille communale de densité en 7 niveaux",
        "Typologie diversité des ruralités (Commune)",
    ])

    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=headers,
        extrasaction='ignore',
        delimiter=';',
        quoting=csv.QUOTE_MINIMAL
    )
    writer.writeheader()

    for _, row in communes.iterrows():
        insee = row["insee_com"]
        ligne = {
            "insee_com": insee,
            "siren_epci": row.get("siren_epci", ""),
            "insee_arr": row.get("insee_arr", ""),
            "insee_dep": row.get("insee_dep", ""),
            "insee_reg": row.get("insee_reg", ""),
            "id_crte": row.get("id_crte", ""),
            "niveau_montagne": row.get("niveau_montagne", ""),
        }

        # Identifiants de TOUS les programmes
        ids_dict = row.get("ids_par_programme", {})
        for col_prog in colonnes_programmes:
            ids_list = ids_dict.get(col_prog, [])
            ligne[col_prog] = ";".join(ids_list) if ids_list else ""

        # Zonages (jointure spatiale)
        for col_zonage in colonnes_zonages:
            ligne[col_zonage] = row.get(col_zonage, "")

        # Typologies
        ligne["Niveau de centres d'équipements et de services des communes 2021"] = typologies["centralite"].get(insee, "")
        ligne["Grille communale de densité en 7 niveaux"] = typologies["densite"].get(insee, "")
        ligne["Typologie diversité des ruralités (Commune)"] = typologies["ruralite"].get(insee, "")

        writer.writerow(ligne)

    return output.getvalue()