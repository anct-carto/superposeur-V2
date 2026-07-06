"""
routes.py — API de la carte interactive ANCT
Raphaël Roumeau — avril 2026

Rôle : définition des routes FastAPI exposées au frontend.
Les données sont fournies par data.py.

Optimisations :
- /api/communes retourne du GZip (5-8× plus léger) avec ETag + Cache-Control
- Réponses 304 (Not Modified) si le client possède déjà la bonne version
- GZipMiddleware pour toutes les autres réponses JSON/texte > 1 ko
- Réponses 404 explicites sur tous les endpoints de détail
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .data import (
    charger_programmes,
    charger_communes,
    charger_typologie,
    get_communes_json,
    get_detail_commune,
    get_detail_departement,
    get_detail_epci,
    get_detail_ept,
    get_detail_region,
    get_programmes,
    get_typologies_meta,
    rechercher_entites,
    get_detail_arr,
    get_detail_crte
)

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent.parent

# Compression GZip automatique pour toutes les réponses JSON/texte > 1 ko
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routes — page principale
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    return FileResponse(BASE_DIR / "index.html")


# ---------------------------------------------------------------------------
# Routes — données communes et programmes
# ---------------------------------------------------------------------------

@app.get("/api/communes")
def communes(request: Request):
    """
    GeoJSON de toutes les communes avec leurs programmes, compressé GZip.
    Mise en cache 24 h côté client. Répond 304 si l'ETag correspond.
    """
    body, etag = get_communes_json()

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)

    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Encoding": "gzip",
            "Cache-Control":    "public, max-age=86400",
            "ETag":             etag,
        },
    )


@app.get("/api/programmes")
def programmes():
    """Liste dédupliquée des identifiants de programmes ANCT."""
    return get_programmes()

@app.get("/api/init")
def init():
    """Déclenche le préchargement complet."""
    charger_programmes()
    charger_communes()
    get_communes_json()
    
    # Charger explicitement l'index de recherche (charge tous les GDF géo)
    from data import _get_index
    _get_index()
    
    charger_typologie("centralite")
    charger_typologie("densite")
    charger_typologie("ruralite")
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# Routes — détail par territoire
# ---------------------------------------------------------------------------

@app.get("/api/communes/{insee_com}")
def detail_commune(insee_com: str):
    """GeoJSON des communes d'un code INSEE commune. Retourne 404 si inconnu."""
    result = get_detail_commune(insee_com)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Commune '{insee_com}' introuvable.")
    return result


@app.get("/api/departements/{insee_dep}")
def detail_departement(insee_dep: str):
    """GeoJSON des communes d'un département. Retourne 404 si inconnu."""
    result = get_detail_departement(insee_dep)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Département '{insee_dep}' introuvable.")
    return result


@app.get("/api/regions/{insee_reg}")
def detail_region(insee_reg: str):
    """GeoJSON des communes d'une région. Retourne 404 si inconnue."""
    result = get_detail_region(insee_reg)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Région '{insee_reg}' introuvable.")
    return result


@app.get("/api/epci/{siren_epci}")
def detail_epci(siren_epci: str):
    """GeoJSON des communes d'un EPCI. Retourne 404 si inconnu."""
    result = get_detail_epci(siren_epci)
    if result is None:
        raise HTTPException(status_code=404, detail=f"EPCI '{siren_epci}' introuvable.")
    return result


@app.get("/api/ept/{siren_ept}")
def detail_ept(siren_ept: str):
    """GeoJSON des communes d'un EPT. Retourne 404 si inconnu."""
    result = get_detail_ept(siren_ept)
    if result is None:
        raise HTTPException(status_code=404, detail=f"EPT '{siren_ept}' introuvable.")
    return result

@app.get("/api/arr/{insee_arr}")
def detail_arr(insee_arr: str):
    result = get_detail_arr(insee_arr)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Arrondissement '{insee_arr}' introuvable.")
    return result

@app.get("/api/crte/{id_crte}")
def detail_crte(id_crte: str):
    result = get_detail_crte(id_crte)
    if result is None:
        raise HTTPException(status_code=404, detail=f"CRTE '{id_crte}' introuvable.")
    return result

# ---------------------------------------------------------------------------
# Routes — recherche textuelle
# ---------------------------------------------------------------------------

@app.get("/api/recherche")
def recherche(q: str = "", types: str = "commune,epci,departement,region,arr,crte"):
    """
    Recherche textuelle dans les entités géographiques.

    Paramètres :
        q     : terme de recherche (≥ 2 caractères)
        types : types à rechercher, séparés par des virgules
    """
    types_liste = [t.strip() for t in types.split(",") if t.strip()]
    return rechercher_entites(q, types_liste)


# ---------------------------------------------------------------------------
# Routes — typologies communales
# ---------------------------------------------------------------------------

_TYPOLOGIES_VALIDES = {"centralite", "densite", "ruralite"}


@app.get("/api/typologies-meta")
def api_typologies_meta():
    """Métadonnées des typologies (nom de colonne et ordre des classes)."""
    return get_typologies_meta()


@app.get("/api/typologies/{key}")
def api_typologie(key: str):
    """
    Mapping {insee_com: niveau} pour une typologie donnée.
    Retourne 404 si la clé est inconnue.
    """
    if key not in _TYPOLOGIES_VALIDES:
        raise HTTPException(
            status_code=404,
            detail=f"Typologie '{key}' inconnue. Valeurs acceptées : {sorted(_TYPOLOGIES_VALIDES)}.",
        )
    return charger_typologie(key)

class ExportRequest(BaseModel):
    communes_insee: list[str] = []
    programmes: list[str] = []


@app.post("/api/export-csv")
def export_csv(req: ExportRequest):
    """Exporte les données en CSV avec encodage UTF-8."""
    from data import exporter_csv
    
    csv_content = exporter_csv(req.communes_insee, req.programmes)
    
    # Ajoute la BOM UTF-8 pour Excel
    csv_bytes = '\ufeff' + csv_content
    
    return Response(
        content=csv_bytes.encode('utf-8'),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=export_communes.csv"},
    )

# ---------------------------------------------------------------------------
# Fichiers statiques — montés en dernier pour ne pas masquer les routes API
# ---------------------------------------------------------------------------


app.mount("/data", StaticFiles(directory=BASE_DIR / "data"), name="data")
app.mount("/",     StaticFiles(directory=BASE_DIR / "frontend"), name="frontend")