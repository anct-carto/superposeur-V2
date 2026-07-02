"""
main.py — Point d'entrée de la carte interactive ANCT
Raphaël Roumeau — avril 2026

Rôle : lancement du serveur Uvicorn sur 127.0.0.1:8000.
L'application FastAPI est définie dans routes.py.
"""

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "routes:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )