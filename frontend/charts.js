// ===========================================================================
// CHARTS.JS — Gestion des graphiques du panneau latéral
// Raphaël Roumeau — Juin 2026
// ===========================================================================

// ---------------------------------------------------------------------------
// OPTIONS CHART.JS PARTAGÉES
// ---------------------------------------------------------------------------

const OPTIONS_COMMUNES = {
    responsive:          true,
    maintainAspectRatio: false,
    animation: { duration: 400, easing: 'easeOutQuart' },
    plugins: {
        tooltip: {
            backgroundColor: 'rgba(0,0,0,0.75)',
            padding:         10,
            cornerRadius:    4,
            titleFont:       { size: 11 },
            bodyFont:        { size: 11 },
        },
    },
};

// ---------------------------------------------------------------------------
// ÉTAT GLOBAL
// ---------------------------------------------------------------------------

let chartBarres   = null;
let chartColonnes = null;
const _cacheTypologies = {};
let _featuresEnCours = [];
let _nomEnCours       = '';

// ---------------------------------------------------------------------------
// INITIALISATION
// ---------------------------------------------------------------------------

function initCharts() {
    // Graphique 1 — Barres horizontales
    chartBarres = new Chart(document.getElementById('chart-barres'), {
        type: 'bar',
        data: {
            labels:   [],
            datasets: [{ data: [], backgroundColor: PALETTE, borderRadius: 3, borderWidth: 0 }],
        },
        options: {
            ...OPTIONS_COMMUNES,
            indexAxis: 'y',
            plugins: {
                ...OPTIONS_COMMUNES.plugins,
                legend: { display: false },
            },
            scales: {
                x: {
                    display: true,
                    grid:    { color: '#f0f0f0' },
                    border:  { display: false },
                    ticks:   { font: { size: 10 }, color: '#888', maxTicksLimit: 5, precision: 0 },
                },
                y: {
                    grid:  { display: false },
                    ticks: { font: { size: 11 }, color: '#444' },
                },
            },
        },
    });

    // Graphique 2 — Colonnes empilées
    chartColonnes = new Chart(document.getElementById('chart-colonnes'), {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
            ...OPTIONS_COMMUNES,
            plugins: {
                ...OPTIONS_COMMUNES.plugins,
                legend: { display: false },
            },
            scales: {
                x: {
                    stacked: true,
                    grid:    { display: false },
                    ticks:   {
                        font:        { size: 9 },
                        color:       '#444',
                        maxRotation: 45,
                        autoSkip:    false,
                        callback: function(val) {
                            const label = this.getLabelForValue(val);
                            return label.length > 18 ? label.slice(0, 16) + '…' : label;
                        },
                    },
                },
                y: {
                    stacked: true,
                    display: true,
                    grid:    { color: '#f0f0f0' },
                    border:  { display: false },
                    ticks:   { font: { size: 10 }, color: '#888', precision: 0 },
                },
            },
        },
    });

    // Sélecteur de typologies
    document.querySelectorAll('#typo-dropdown .dropdown-menu a').forEach(link => {
        link.addEventListener('click', async e => {
            e.preventDefault();
            document.querySelectorAll('#typo-dropdown .dropdown-menu a')
                .forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            const typoKey = link.dataset.typo;
            document.getElementById('typo-label').textContent = 
                TYPOLOGIES_CONFIG[typoKey].labelComplet;
            if (_featuresEnCours.length) {
                await _mettreAJourTypologie(_featuresEnCours, _nomEnCours);
            }
        });
    });
}

// ---------------------------------------------------------------------------
// TYPOLOGIES
// ---------------------------------------------------------------------------

async function _chargerTypologie(key) {
    if (_cacheTypologies[key]) return _cacheTypologies[key];
    const res = await fetch(`${API_URL}/api/typologies/${key}`);
    if (!res.ok) throw new Error(`Typologie ${key} : HTTP ${res.status}`);
    _cacheTypologies[key] = await res.json();
    return _cacheTypologies[key];
}

// ---------------------------------------------------------------------------
// PRÉPARATION — Graphique 1
// ---------------------------------------------------------------------------

function _preparerProgrammes(features) {
    const compteProg = {};

    features.forEach(f => {
        (f.properties.liste_programmes || []).forEach(p => {
            if (!PROGRAMMES_GRAPHIQUE.has(p)) return;
            if (!programmesActifs.has(p)) return;
            compteProg[p] = (compteProg[p] || 0) + 1;
        });
    });

    const trie = Object.entries(compteProg).sort((a, b) => b[1] - a[1]);

    return {
        labels:   trie.map(([p]) => LABELS_PROGRAMMES[p] || p),
        valeurs:  trie.map(([, v]) => v),
        couleurs: trie.map(([p]) => (PROGRAMMES_META[p] ?? {}).couleur ?? '#cccccc'),
    };
}

// ---------------------------------------------------------------------------
// PRÉPARATION — Graphique 2
// ---------------------------------------------------------------------------

async function _preparerTypologie(features) {
    const key = document.querySelector('#typo-dropdown .dropdown-menu a.active')?.dataset.typo
             ?? 'centralite';
    const cfg     = TYPOLOGIES_CONFIG[key];
    const typoMap = await _chargerTypologie(key);

    const comptage = {};
    cfg.ordre.forEach(classe => { comptage[classe] = {}; });

    features.forEach(f => {
        const insee  = f.properties.insee_com;
        const classe = typoMap[insee];
        if (!classe || !comptage[classe]) return;

        (f.properties.liste_programmes || []).forEach(p => {
            if (!PROGRAMMES_GRAPHIQUE.has(p)) return;
            if (!programmesActifs.has(p)) return;
            comptage[classe][p] = (comptage[classe][p] || 0) + 1;
        });
    });

    const numberedLabels = cfg.ordre.map((_, i) => (i + 1).toString());

    const progsPresents = [...PROGRAMMES_GRAPHIQUE].filter(p =>
        programmesActifs.has(p) &&
        cfg.ordre.some(c => comptage[c][p])
    );

    const datasets = progsPresents.map(prog => ({
        label:           LABELS_PROGRAMMES[prog] || prog,
        data:            cfg.ordre.map(classe => comptage[classe][prog] || 0),
        backgroundColor: (PROGRAMMES_META[prog] ?? {}).couleur ?? '#cccccc',
        borderWidth:     0,
        borderRadius:    2,
    }));

    return { 
        labels: numberedLabels,
        classNames: cfg.ordre,
        datasets 
    };
}

// ---------------------------------------------------------------------------
// MISE À JOUR
// ---------------------------------------------------------------------------

function _afficherLegendTypo(classNames) {
    const legendDiv = document.getElementById('chart-colonnes-legend');
    legendDiv.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px;margin-top:12px;font-size:11px;line-height:1.5;">' +
        classNames.map((name, i) => 
            `<div><strong>${i + 1}.</strong> ${name}</div>`
        ).join('') +
    '</div>';
}

function updateCharts(data) {
    const titre = document.getElementById('territoire');
    if (titre && data.territoire) titre.textContent = data.territoire;

    if (chartBarres && data.programmes) {
        chartBarres.data.labels           = data.programmes.labels;
        chartBarres.data.datasets[0].data = data.programmes.valeurs;
        chartBarres.data.datasets[0].backgroundColor = data.programmes.couleurs;
        chartBarres.update();
    }

    if (chartColonnes && data.typologies) {
        chartColonnes.data.labels   = data.typologies.labels;
        chartColonnes.data.datasets = data.typologies.datasets;
        chartColonnes.update();
        _afficherLegendTypo(data.typologies.classNames);
    }
}

async function _mettreAJourTypologie(features, nom) {
    if (features.length === 0) return;  
    
    try {
        const typo = await _preparerTypologie(features);
        if (chartColonnes) {
            chartColonnes.data.labels   = typo.labels;
            chartColonnes.data.datasets = typo.datasets;
            chartColonnes.update();
            _afficherLegendTypo(typo.classNames);
        }
    } catch (err) {
        console.error('[charts.js] Erreur mise à jour typologie :', err);
    }
}

// ---------------------------------------------------------------------------
// FETCH DONNÉES TERRITOIRE
// ---------------------------------------------------------------------------

async function fetchDonneesTerritoire(code, type, nom) {
    const route = ROUTES_API[type];
    if (!route) {
        console.warn(`[charts.js] Type de territoire inconnu : ${type}`);
        return;
    }

    try {
        const res = await fetch(route(code));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const geojson  = await res.json();
        const features = geojson.features || [];

        if (!features.length) {
            console.warn(`[charts.js] Aucune commune pour ${type} ${code}`);
            return;
        }

        _featuresEnCours = features;
        _nomEnCours       = nom;

        const programmes = _preparerProgrammes(features);
        const typologies = await _preparerTypologie(features);

        updateCharts({ territoire: nom, programmes, typologies });

    } catch (err) {
        console.error('[charts.js] Erreur API :', err);
    }
}

async function updateChartsWithActivePrograms() {
    if (_featuresEnCours.length === 0) return;
    
    try {
        const programmes = _preparerProgrammes(_featuresEnCours);
        const typologies = await _preparerTypologie(_featuresEnCours);
        updateCharts({ territoire: _nomEnCours, programmes, typologies });
    } catch (err) {
        console.error('[charts.js] Erreur mise à jour programmes actifs :', err);
    }
}

function resizeCharts() {
    chartBarres?.resize();
    chartColonnes?.resize();
}

// ---------------------------------------------------------------------------
// LANCEMENT
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Chart === 'undefined') {
        console.error('[charts.js] Chart.js non chargé.');
        return;
    }
    initCharts();
});