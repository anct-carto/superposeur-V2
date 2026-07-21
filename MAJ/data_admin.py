import io, os, sqlite3
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests


# ===========================================================================
# CHEMINS
# ===========================================================================

BASE = Path("N:/DST/Carto/INTERACTIVITE/raphael/carte/data/admin")
DB   = "N:/Transverse/Donnees_Obs/Donnees_Statistiques/ngeo/2025/ngeo-fr-cog2025.sqlite3"

GPKG_MAIN = "N:/DST/Carto/YO_BERTRAND/map-process/public/france/2025/fr-drom/fr-drom-3395-gen.gpkg"

# Fichiers GPKG sources (centroïdes, contours, polygones)
GPKG = [
    "N:/DST/Carto/YO_BERTRAND/map-process/public/france/2025/fr-drom/centroide-fr-drom-3395-gen.gpkg",
    "N:/DST/Carto/YO_BERTRAND/map-process/public/france/2025/fr-drom/contour-fr-drom-3395-gen.gpkg",
    "N:/DST/Carto/YO_BERTRAND/map-process/public/france/2025/fr-drom/fr-drom-3395-gen.gpkg",
]

# GeoJSON admin produits par run_admin(), consommés par run_datasets()
GEO = {
    "COM":  BASE / "polygone-4326_com.geojson",
    "EPCI": BASE / "polygone-4326_epci-ept.geojson",
    "DEP":  BASE / "polygone-4326_dep.geojson",
    "REG":  BASE / "polygone-4326_reg.geojson",
}


# ===========================================================================
# CONFIGURATION DES COUCHES ADMIN
# ===========================================================================

COLS = {
    "com":  ["insee_com", "lib_com"],
    "dep":  ["insee_dep", "lib_dep"],
    "reg":  ["insee_reg", "lib_reg"],
    "arr":  ["insee_arr", "lib_arr"],
    "epci": ["siren_epci", "lib_epci"],
    "ept":  ["siren_ept",  "lib_ept"],
}

COLS_COM = [
    "insee_com", "lib_com",
    "insee_dep", "lib_dep",
    "insee_reg", "lib_reg",
    "siren_epci", "lib_epci",
    "siren_ept",  "lib_ept",
    "insee_arr",  "lib_arr",
    "id_crte",    "lib_crte",
    "geometry",
]


# ===========================================================================
# CONFIGURATION DES DATASETS THÉMATIQUES
# ===========================================================================

# id_col   : colonne identifiant unique du dispositif (clé de dissolve)
# lib_col  : colonne nom du dispositif (None si absente)
# Les colonnes lib_groupement, siren_groupement, nature_juridique
# sont communes à tous les datasets de type "dissolve".

DATASETS = {
    "ti": {
        "api":      "https://www.data.gouv.fr/api/1/datasets/programme-territoires-dindustrie/",
        "resource": "a1aca2c0-5a34-4a21-82bf-74ff0daf16db",
        "output":   BASE / "polygone-4326_ti.geojson",
        "id_col":   "id_ti",
        "lib_col":  "lib_ti",
    },
    "ami": {
        "api":      "https://www.data.gouv.fr/api/1/datasets/programme-avenir-montagnes-ingenierie/",
        "resource": "a68210d4-c919-410e-a27d-1b972a9e7630",
        "output":   BASE / "polygone-4326_ami.geojson",
        "id_col":   "id_ami",
        "lib_col":  "lib_ami",
    },
    "amm": {
        "api":      "https://www.data.gouv.fr/api/1/datasets/appel-a-manifestation-dinteret-avenir-montagnes-mobilites/",
        "resource": "d43490a3-bf2c-4b17-a161-c1ab9b7e8acb",
        "output":   BASE / "polygone-4326_amm.geojson",
        "id_col":   "id_amm",
        "lib_col":  None,   # pas de colonne lib_ dans ce dataset
    },
    "fabriques": {
        "api":      "https://www.data.gouv.fr/api/1/datasets/fabriques-prospectives/",
        "resource": "5053fb12-1b52-42a0-a5f3-341314310bfa",
        "output":   BASE / "polygone-4326_fabriques.geojson",
        "id_col":   "id_fabp",
        "lib_col":  None,   # pas de colonne lib_ dans ce dataset
    },
    "crte": {
        "api":      None,
        "resource": "c29c0307-7ba1-483c-bdd3-f8b229a8fea8",
        "output":   BASE / "polygone-4326_crte.geojson",
        "id_col":   "id_crte",
        "lib_col":  "lib_crte",
    },
    "tec": {
        "api":      None,
        "resource": "4fbcd679-5b27-4261-94f2-2f22a93ddadd",
        "output":   BASE / "polygone-4326_tec.geojson",
        "id_col":   "id_tec",
        "lib_col":  None,
        "com_key":  "insee",   # ← nouveau : siren_groupement contient déjà un insee_com, pas un SIREN
    },
}


# ===========================================================================
# PARTIE 1 — LIMITES ADMINISTRATIVES
# ===========================================================================

def run_admin():
    conn = sqlite3.connect(DB)
    df_com = pd.read_sql_query("""
        SELECT n.insee_com, n.insee_dep, n.insee_reg, n.siren_epci, n.siren_ept, n.insee_arr,
               arr.lib_arr, dep.lib_dep, epc.lib_epci, ept.lib_ept, reg.lib_reg
        FROM ngeo n
        LEFT JOIN arrondissement                   arr ON arr.insee_arr  = n.insee_arr
        LEFT JOIN departement                      dep ON dep.insee_dep  = n.insee_dep
        LEFT JOIN epci                             epc ON epc.siren_epci = n.siren_epci
        LEFT JOIN etablissement_public_territorial ept ON ept.siren_ept  = n.siren_ept
        LEFT JOIN region                           reg ON reg.insee_reg  = n.insee_reg
    """, conn)
    conn.close()

        # ← NOUVEAU : jointure spatiale CRTE sur les centroïdes communes
    gdf_centroides = gpd.read_file(GPKG[0], layer="com").to_crs(4326)  # centroide-fr-drom
    gdf_crte = gpd.read_file(BASE / "polygone-4326_crte.geojson")[["id_crte", "lib_crte", "geometry"]]
    gdf_centroides = gdf_centroides[["insee_com", "geometry"]]
    gdf_joined = gpd.sjoin(gdf_centroides, gdf_crte, how="left", predicate="within")
    df_crte = gdf_joined[["insee_com", "id_crte", "lib_crte"]].drop_duplicates("insee_com")
    df_com = df_com.merge(df_crte, on="insee_com", how="left")




    for gpkg in GPKG:
        name   = os.path.basename(gpkg)
        prefix = "centroide-4326" if "centroide" in name else "contour-4326" if "contour" in name else "polygone-4326"

        for layer in ["com", "dep", "reg", "arr"]:
            try:
                gdf = gpd.read_file(gpkg, layer=layer)
                gdf = gdf[[c for c in COLS[layer] if c in gdf.columns] + ["geometry"]]
                if layer == "com":
                    gdf = gdf.merge(df_com, on="insee_com", how="left")
                    gdf = gdf[[c for c in COLS_COM if c in gdf.columns]]
                gdf.to_crs(4326).to_file(BASE / f"{prefix}_{layer}.geojson", driver="GeoJSON")
            except Exception:
                pass

        frames = []
        for layer in ["epci", "ept"]:
            try:
                g = gpd.read_file(gpkg, layer=layer)
                g = g[[c for c in COLS[layer] if c in g.columns] + ["geometry"]]
                g["type"] = layer
                frames.append(g)
            except Exception:
                pass
        if frames:
            gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry") \
               .to_crs(4326).to_file(BASE / f"{prefix}_epci-ept.geojson", driver="GeoJSON")


# ===========================================================================
# PARTIE 2 — DATASETS THÉMATIQUES
# ===========================================================================

def get_csv(api, resource):
    """Télécharge un CSV depuis data.gouv (via API dataset ou lien direct)."""
    if api:
        url = next(r["url"] for r in requests.get(api).json()["resources"] if r["id"] == resource)
    else:
        url = f"https://www.data.gouv.fr/api/1/datasets/r/{resource}"
    return pd.read_csv(io.BytesIO(requests.get(url).content), dtype=str, sep=None, engine="python")


def _run_dissolve_dataset(name, df, cfg):
    """
    Traitement commun à tous les datasets à dissolve (ti, ami, amm, fabriques, crte) :
      - jointure des géométries par nature_juridique :
          COM    → gpkg layer com  (via SQLite siren_com → insee_com)
          EPT    → gpkg layer ept  (siren_ept)
          autres → gpkg layer epci (siren_epci)
      - dissolve par id_col avec union des géométries
        et agrégation de lib_groupement / siren_groupement
    """
    id_col  = cfg["id_col"]
    lib_col = cfg["lib_col"]  # peut être None

    # Colonnes à conserver
    keep = [id_col, "siren_groupement", "lib_groupement", "nature_juridique"]
    if lib_col:
        keep.insert(1, lib_col)
    df = df[[c for c in keep if c in df.columns]].copy()

    df["nature_juridique"] = df["nature_juridique"].str.strip().str.upper()
    df["siren_groupement"] = df["siren_groupement"].str.strip()

    mask_com  = df["nature_juridique"] == "COM"
    mask_ept  = df["nature_juridique"] == "EPT"
    mask_epci = ~mask_com & ~mask_ept

    frames = []

# --- COM : géométrie via gpkg layer com (centroïdes) ---
    sub_com = df[mask_com]
    if not sub_com.empty:
        gdf_com = gpd.read_file(GPKG[0], layer="com").to_crs(4326)

        if cfg.get("com_key") == "insee":
            sub_com = sub_com.copy()
            sub_com["siren_groupement"] = sub_com["siren_groupement"].str.strip().str.zfill(5)
            frames.append(
                gdf_com[["insee_com", "geometry"]].merge(
                    sub_com, left_on="insee_com", right_on="siren_groupement", how="inner"
                )
            )
        else:
            conn    = sqlite3.connect(DB)
            df_ngeo = pd.read_sql_query("SELECT insee_com, siren_com FROM ngeo", conn)
            conn.close()
            sub_com = sub_com.merge(df_ngeo, left_on="siren_groupement", right_on="siren_com", how="inner")
            frames.append(gdf_com[["insee_com", "geometry"]].merge(sub_com, on="insee_com", how="inner"))

    # --- EPT : jointure sur siren_ept ---
    sub_ept = df[mask_ept]
    if not sub_ept.empty:
        gdf_ept = gpd.read_file(GPKG_MAIN, layer="ept").to_crs(4326)
        frames.append(
            gdf_ept[["siren_ept", "geometry"]].merge(
                sub_ept, left_on="siren_ept", right_on="siren_groupement", how="inner"
            )
        )

    # --- CC, CA, CU, METRO, MET69 : jointure sur siren_epci ---
    sub_epci = df[mask_epci]
    if not sub_epci.empty:
        gdf_epci = gpd.read_file(GPKG_MAIN, layer="epci").to_crs(4326)
        frames.append(
            gdf_epci[["siren_epci", "geometry"]].merge(
                sub_epci, left_on="siren_epci", right_on="siren_groupement", how="inner"
            )
        )

    if not frames:
        print(f"  ⚠ {name} : aucune géométrie trouvée")
        return

    gdf = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs="EPSG:4326")

    # Agrégation par id_col
    agg = {
        "lib_groupement":   lambda x: ", ".join(x.dropna().unique()),
        "siren_groupement": lambda x: ", ".join(x.dropna().unique()),
        "geometry":         lambda x: x.union_all(),
    }
    if lib_col and lib_col in gdf.columns:
        agg[lib_col] = "first"

    gdf = gdf.groupby(id_col, as_index=False).agg(agg)
    gdf = gpd.GeoDataFrame(gdf, crs="EPSG:4326")

    # Ordre des colonnes : id, lib, lib_groupement, siren_groupement, geometry
    cols_ordre = [id_col]
    if lib_col:
        cols_ordre.append(lib_col)
    cols_ordre += ["lib_groupement", "siren_groupement", "geometry"]
    gdf = gdf[[c for c in cols_ordre if c in gdf.columns]]

    cfg["output"].parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(cfg["output"], driver="GeoJSON")
    print(f"  → {name} : {len(gdf)} entités exportées")


def _run_qpv():
    """
    Construit le GeoJSON QPV :
      - Télécharge le CSV data.gouv des quartiers prioritaires
      - Corrige le BOM UTF-8
      - Retire l'enrobage Excel ="..." autour des codes insee_com
      - Éclate les cellules insee_com contenant plusieurs communes ("A;B")
      - Corrige les insee_com sur 4 chiffres (zéro manquant en tête)
      - Convertit les codes arrondissement (Paris/Lyon/Marseille) vers
        le code commune correspondant, sinon ces QPV ne matchent jamais
      - Joint les géométries communales depuis le gpkg
      - Agrège par insee_com : une ligne par commune avec la liste
        des code_qp et lib_qp des QPV qu'elle contient
    """
    print("Traitement qpv…")

    url = "https://www.data.gouv.fr/api/1/datasets/r/4c6bb7f3-97b6-4834-8a3a-f5f8b3e6735b"
    df  = pd.read_csv(
        io.BytesIO(requests.get(url).content),
        dtype=str,
        sep=";",                   # data.gouv précise explicitement ce séparateur
        engine="python",
        encoding="utf-8-sig",       # supprime le BOM \ufeff
    )
    df.columns = df.columns.str.strip().str.lower()

    print("Colonnes brutes qpv:", df.columns.tolist())
    print("Shape brute qpv:", df.shape)

    # Ne garder que les colonnes utiles
    df = df[["code_qp", "lib_qp", "insee_com", "lib_com"]]

    # Retire l'enrobage Excel ="..." qui protège les zéros en tête
    df["insee_com"] = df["insee_com"].str.replace(r'^="?|"$', '', regex=True)

    # Certaines cellules contiennent plusieurs communes séparées par ";"
    # (QPV à cheval sur plusieurs communes) -> on éclate en plusieurs lignes
    df["insee_com"] = df["insee_com"].str.split(";")
    df = df.explode("insee_com")

    # Correction du zéro manquant sur les insee_com à 4 chiffres
    df["insee_com"] = df["insee_com"].str.strip().str.zfill(5)

    # --- Correction arrondissements Paris/Lyon/Marseille -> code commune ---
    # Le CSV QPV référence les arrondissements (75101-75120, 69381-69389,
    # 13201-13216) alors que la couche admin "com" référence la commune
    # entière (75056, 69123, 13055). Sans cette conversion, le merge final
    # ignore silencieusement tous les QPV de ces 3 villes.
    def to_code_commune(code):
        if code.startswith("751"):
            return "75056"
        if code.startswith("6938"):
            return "69123"
        if code.startswith("132"):
            return "13055"
        return code

    df["insee_com"] = df["insee_com"].apply(to_code_commune)

    print("Exemples insee_com après correction:", df["insee_com"].head(10).tolist())

    # Agrégation par commune : liste des code_qp et lib_qp
    df_agg = (
        df.groupby("insee_com", as_index=False)
        .agg(
            lib_com = ("lib_com", "first"),
            code_qp = ("code_qp", lambda x: ", ".join(x.dropna().unique())),
            lib_qp  = ("lib_qp",  lambda x: ", ".join(x.dropna().unique())),
        )
    )
    print("Shape après agrégation:", df_agg.shape)

    # Jointure avec les géométries communales
    gdf_com = gpd.read_file(BASE / "centroide-4326_com.geojson")
    print("Dtype insee_com gdf_com:", gdf_com["insee_com"].dtype)
    print("Dtype insee_com df_agg:", df_agg["insee_com"].dtype)
    print("Exemples gdf_com insee_com:", gdf_com["insee_com"].head(10).tolist())

    gdf = gdf_com[["insee_com", "geometry"]].merge(df_agg, on="insee_com", how="inner")
    print("Shape après merge:", gdf.shape)

    gdf = gpd.GeoDataFrame(gdf[["insee_com", "lib_com", "code_qp", "lib_qp", "geometry"]], crs="EPSG:4326")

    output = BASE / "centroide-4326_qpv.geojson"
    output.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(output, driver="GeoJSON")
    print(f"  → qpv : {len(gdf)} communes avec au moins un QPV exportées")

def _fix_mojibake(s):
    """Corrige un texte UTF-8 mal décodé en Latin-1 (ex: 'BarthÃ©lemy' -> 'Barthélemy')."""
    if not isinstance(s, str):
        return s
    try:
        return s.encode("latin1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s


def _preparer_tec(df):
    """
    Prépare le CSV Territoires d'Engagement avant dissolve :
      - retire les id_tec de la forme "-103", "-104"... (valeurs négatives = bugs)
        les préfixes "ai-", "cco-", "patde-", "pptde-" sont conservés intégralement
      - ne garde que les lignes "commune" et "epci" (retire arrondissement,
        arrondissement municipal, departement, region, territoire)
      - renomme "commune" -> "COM" pour matcher la branche SQLite de
        _run_dissolve_dataset ; "epci" -> "EPCI" (branche générique EPCI)
      - corrige l'encodage mojibake de lib_groupement
    """
    df = df.copy()

    df["id_tec"] = df["id_tec"].str.strip()
    df = df[~df["id_tec"].str.match(r"^-\d+$").fillna(False)]

    df["nature_juridique"] = df["nature_juridique"].str.strip().str.lower()
    df = df[df["nature_juridique"].isin(["commune", "epci"])]
    df["nature_juridique"] = df["nature_juridique"].replace({"commune": "COM", "epci": "EPCI"})

    if "lib_groupement" in df.columns:
        df["lib_groupement"] = df["lib_groupement"].apply(_fix_mojibake)

    return df

def run_datasets():
    """Télécharge chaque CSV, joint les géométries admin, exporte en GeoJSON."""
    for name, cfg in DATASETS.items():
        print(f"Traitement {name}…")
        df = get_csv(cfg["api"], cfg["resource"])
        df.columns = df.columns.str.strip().str.lower()

        if name == "tec":
            df = _preparer_tec(df)

        _run_dissolve_dataset(name, df, cfg)

    _run_qpv()

# ===========================================================================
# MAIN
# ===========================================================================

if __name__ == "__main__":
    run_admin()
    run_datasets()