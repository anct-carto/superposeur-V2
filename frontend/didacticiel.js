/*
 * didacticiel.js — Tutoriel de démarrage de la carte ANCT
 * Affiche un guide en 4 étapes à chaque chargement de la page.
 */

(function () {
    const ETAPES = [
        { cible: '#search-box',   texte: 'Renseignez un territoire à explorer' },
        { cible: '#btn-legende',  texte: 'Sélectionnez les programmes et dispositifs à afficher' },
        { cible: '#btn-couches',  texte: 'Choisissez les limites administratives et le fond de carte' },
        { cible: '#slider-tab',   texte: 'Consultez les graphiques du territoire' },
    ]

    const STORAGE_KEY = 'anct_tuto_vu';
    const DUREE_CACHE_MS = 6 * 60 * 60 * 1000; // 6 heures

    const TEXTE_ENTETE = 'Suivez ces étapes dans l\'ordre pour afficher des résultats sur la carte :';

    let etapeActuelle = 0;
    let overlay, svg, card, stepNum, stepText, btnPasser;

    function construireDOM() {
        overlay = document.createElement('div');
        overlay.id = 'tuto-overlay';
        overlay.hidden = true;

        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'tuto-svg';

        card = document.createElement('div');
        card.id = 'tuto-card';
        card.innerHTML = `
            <div id="tuto-header">${TEXTE_ENTETE}</div>
            <div id="tuto-step-num"></div>
            <div id="tuto-step-text"></div>
        `;

        btnPasser = document.createElement('button');
        btnPasser.id = 'tuto-btn-passer';
        btnPasser.textContent = 'Suivant';

        overlay.appendChild(svg);
        overlay.appendChild(card);
        overlay.appendChild(btnPasser);
        document.body.appendChild(overlay);

        stepNum  = card.querySelector('#tuto-step-num');
        stepText = card.querySelector('#tuto-step-text');

        if (window.lucide) lucide.createIcons();

        btnPasser.addEventListener('click', etapeSuivante);

        window.addEventListener('resize', () => {
            if (!overlay.hidden) positionnerEtape();
        });
    }

    function positionnerEtape() {
        const etape = ETAPES[etapeActuelle];
        const cible = document.querySelector(etape.cible);
        if (!cible) { etapeSuivante(); return; }

        const rect = cible.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        stepNum.textContent = etapeActuelle + 1;
        stepText.textContent = etape.texte;

        card.style.visibility = 'hidden';
        card.style.left = '0px';
        card.style.top = '0px';

        requestAnimationFrame(() => {
            const cardRect = card.getBoundingClientRect();
            let left, top;

            if (etape.cible === '#slider-tab') {
                left = rect.left - cardRect.width - 28;
                top  = cy - cardRect.height / 2;
            } else {
                left = Math.min(Math.max(rect.left, 16), window.innerWidth - cardRect.width - 16);
                top = rect.bottom + 28;
            }

            top = Math.max(16, Math.min(top, window.innerHeight - cardRect.height - 90));

            card.style.left = `${left}px`;
            card.style.top = `${top}px`;
            card.style.visibility = 'visible';

            dessinerFleche(card.getBoundingClientRect(), cx, cy);
        });
    }

    function dessinerFleche(cardRect, cx, cy) {
        svg.innerHTML = `
            <defs>
                <marker id="tuto-arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill="#ffffff" />
                </marker>
            </defs>
        `;

        const startX = Math.max(cardRect.left, Math.min(cx, cardRect.right));
        const startY = Math.max(cardRect.top, Math.min(cy, cardRect.bottom));

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', startX);
        line.setAttribute('y1', startY);
        line.setAttribute('x2', cx);
        line.setAttribute('y2', cy);
        line.setAttribute('marker-end', 'url(#tuto-arrow-head)');
        svg.appendChild(line);
    }

    function etapeSuivante() {
        etapeActuelle++;
        if (etapeActuelle >= ETAPES.length) { fermerTuto(); return; }
        positionnerEtape();
    }

    function ouvrirTuto() {
        overlay.hidden = false;
        requestAnimationFrame(() => overlay.classList.add('visible'));
        positionnerEtape();
    }

    function fermerTuto() {
        overlay.classList.remove('visible');
        setTimeout(() => { overlay.hidden = true; }, 250);
    }


    function fermerTuto() {
        overlay.classList.remove('visible');
        setTimeout(() => { overlay.hidden = true; }, 250);
        localStorage.setItem(STORAGE_KEY, Date.now().toString());
    }

    function tutoDejaVuRecemment() {
        const ts = localStorage.getItem(STORAGE_KEY);
        if (!ts) return false;
        return (Date.now() - parseInt(ts, 10)) < DUREE_CACHE_MS;
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (tutoDejaVuRecemment()) return;
        construireDOM();
        ouvrirTuto();
    });
})();