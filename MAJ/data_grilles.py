"""
Traitement des grilles de caractérisation des communes (centralité, densité, ruralité, montagne).
Les XLSX bruts sont issus de l'Observatoire des Territoires (OT) et doivent être
téléchargés manuellement avant d'exécuter ce script.
À relancer à chaque mise à jour des données sur l'OT.
Raphaël Roumeau — mars 2026
"""

import os
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# XLSX bruts téléchargés depuis l'Observatoire des Territoires
FICHIERS = [
    r"N:/DST/Carto/INTERACTIVITE/raphael/carte/data/grilles/brut/centralite.xlsx",
    r"N:/DST/Carto/INTERACTIVITE/raphael/carte/data/grilles/brut/densite.xlsx",
    r"N:/DST/Carto/INTERACTIVITE/raphael/carte/data/grilles/brut/ruralite.xlsx",
]

# Fichiers avec un traitement spécifique
FICHIERS_MONTAGNE = [
    r"N:/DST/Carto/INTERACTIVITE/raphael/carte/data/grilles/brut/montagne.xlsx",
]

# Dossier de sortie des CSV nettoyés, prêts à être joints aux GeoJSON (data_jointure.py)
DOSSIER_SORTIE = r"N:/DST/Carto/INTERACTIVITE/raphael/carte/data/grilles"
os.makedirs(DOSSIER_SORTIE, exist_ok=True)

# ---------------------------------------------------------------------------
# Traitement standard (centralité, densité, ruralité)
# ---------------------------------------------------------------------------

for fichier in FICHIERS:
    nom_base = os.path.basename(fichier).replace(".xlsx", "")

    # Les 3 premières lignes des exports OT sont des métadonnées à ignorer
    df = pd.read_excel(fichier, skiprows=3)

    # Seules les 3 premières colonnes sont utiles (code INSEE, libellé, niveau)
    df = df.iloc[:, :3]
    df.columns = ["insee_com", "lib_com", f"niveau_{nom_base}"]

    # Normalisation du code INSEE sur 5 caractères (ex: "1001" → "01001")
    df["insee_com"] = df["insee_com"].astype(str).str.zfill(5)

    # Suppression des 4 premiers caractères de chaque cellule de la colonne niveau
    df[f"niveau_{nom_base}"] = df[f"niveau_{nom_base}"].astype(str).str[4:]

    chemin_sortie = os.path.join(DOSSIER_SORTIE, nom_base + ".csv")
    df.to_csv(chemin_sortie, index=False, encoding="utf-8-sig")
    print(f"Exporté : {chemin_sortie}")

# ---------------------------------------------------------------------------
# Traitement montagne (skiprows=3 + suppression lignes "null - undefined")
# ---------------------------------------------------------------------------

for fichier in FICHIERS_MONTAGNE:
    nom_base = os.path.basename(fichier).replace(".xlsx", "")

    # Les 3 premières lignes sont des métadonnées à ignorer (identique au traitement standard)
    df = pd.read_excel(fichier, skiprows=3)

    # Seules les 3 premières colonnes sont utiles (code INSEE, libellé, niveau)
    df = df.iloc[:, :3]
    df.columns = ["insee_com", "lib_com", f"niveau_{nom_base}"]

    # Suppression des lignes dont la colonne niveau vaut "null - undefined"
    df = df[df[f"niveau_{nom_base}"].astype(str).str.strip() != "null - undefined"]

    # Normalisation du code INSEE sur 5 caractères (ex: "1001" → "01001")
    df["insee_com"] = df["insee_com"].astype(str).str.zfill(5)

    chemin_sortie = os.path.join(DOSSIER_SORTIE, nom_base + ".csv")
    df.to_csv(chemin_sortie, index=False, encoding="utf-8-sig")
    print(f"Exporté : {chemin_sortie}")