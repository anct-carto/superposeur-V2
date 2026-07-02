"""
Jointure des typologies de communes (centralité, densité, ruralité) sur les GeoJSON
des limites administratives communales.
La donnée montagne fait l'objet d'un GeoJSON dédié (polygone-4326_montagne.geojson).
Dépendances : à lancer après data_admin.py et data_grille.py.
À relancer à chaque montée de COG ou mise à jour des grilles OT.
Les GeoJSON produits écrasent ceux générés par data_admin.py.
Raphaël Roumeau — mars 2026
"""

import os
import pandas as pd
import geopandas as gpd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# CSV nettoyés produits par data_grille.py
CSV_DIR = r"N:/DST/Carto/INTERACTIVITE/raphael/carte/data/grilles"

# GeoJSON communaux produits par data_admin.py (source et destination identiques :
# les fichiers sont écrasés par les versions enrichies)
GEOJSON_DIR = r"N:/DST/Carto/INTERACTIVITE/raphael/carte/data/admin"
OUTPUT_DIR  = GEOJSON_DIR

os.makedirs(OUTPUT_DIR, exist_ok=True)

# GeoJSON de référence pour la jointure montagne (polygones communaux en 4326)
GEOJSON_MONTAGNE_SOURCE = os.path.join(GEOJSON_DIR, "polygone-4326_com.geojson")

# ---------------------------------------------------------------------------
# Chargement
# ---------------------------------------------------------------------------

# CSV de typologies standards (centralité, densité, ruralité) — on exclut montagne
csv_files = sorted([
    f for f in os.listdir(CSV_DIR)
    if f.endswith(".csv") and "montagne" not in f
])
csvs = []
for csv_file in csv_files:
    df  = pd.read_csv(os.path.join(CSV_DIR, csv_file), dtype={"insee_com": str})
    col = df.columns[2]  # 3e colonne = niveau_xxx
    csvs.append(df[["insee_com", col]])

# CSV montagne chargé séparément
df_montagne = pd.read_csv(
    os.path.join(CSV_DIR, "montagne.csv"),
    dtype={"insee_com": str}
)

# Seuls les GeoJSON communaux reçoivent les typologies standards
geojson_files = sorted([
    f for f in os.listdir(GEOJSON_DIR)
    if f.endswith(".geojson") and "com" in f
])

# ---------------------------------------------------------------------------
# Jointure standards et export (centralité, densité, ruralité)
# ---------------------------------------------------------------------------

NIVEAU_COLS = ["niveau_centralite", "niveau_ruralite", "niveau_densite"]

for geojson_file in geojson_files:
    gdf = gpd.read_file(os.path.join(GEOJSON_DIR, geojson_file))
    gdf["insee_com"] = gdf["insee_com"].astype(str)

    for df in csvs:
        gdf = gdf.merge(df, on="insee_com", how="left")

    for col in NIVEAU_COLS:
        if col in gdf.columns:
            gdf[col] = gdf[col].fillna("").astype(str)

    output_path = os.path.join(OUTPUT_DIR, geojson_file)
    gdf.to_file(output_path, driver="GeoJSON")
    print(f"Exporté : {output_path}")

# ---------------------------------------------------------------------------
# Jointure montagne et export dans un GeoJSON dédié
# ---------------------------------------------------------------------------

gdf_montagne = gpd.read_file(GEOJSON_MONTAGNE_SOURCE)
gdf_montagne["insee_com"] = gdf_montagne["insee_com"].astype(str)

gdf_montagne = gdf_montagne.merge(
    df_montagne[["insee_com", "niveau_montagne"]],
    on="insee_com",
    how="inner"  # on exclut les communes sans massif (ex-"null - undefined")
)

# Dissolve : fusion des géométries communales par nom de massif
gdf_montagne = gdf_montagne.dissolve(by="niveau_montagne", as_index=False)

# On ne conserve que le nom du massif et la géométrie
gdf_montagne = gdf_montagne[["niveau_montagne", "geometry"]]

output_montagne = os.path.join(OUTPUT_DIR, "polygone-4326_montagne.geojson")
gdf_montagne.to_file(output_montagne, driver="GeoJSON")
print(f"Exporté : {output_montagne}")