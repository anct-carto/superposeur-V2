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
let chartSites = null;
let _modeGraphique = 'communes';   // 'communes' | 'sites'
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

    // Graphique 1 bis — Nombre de sites (mêmes options que le graphique 1)
    chartSites = new Chart(document.getElementById('chart-sites'), {
        type: 'bar',
        data: {
            labels:   [],
            datasets: [{ data: [], backgroundColor: PALETTE, borderRadius: 3, borderWidth: 0 }],
        },
        options: {
            ...OPTIONS_COMMUNES,
            indexAxis: 'y',
            plugins: { ...OPTIONS_COMMUNES.plugins, legend: { display: false } },
            scales: {
                x: {
                    display: true,
                    grid:    { color: '#f0f0f0' },
                    border:  { display: false },
                    ticks:   { font: { size: 10 }, color: '#888', maxTicksLimit: 5, precision: 0 },
                },
                y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#444' } },
            },
        },
    });

// Bouton de bascule
document.getElementById('btn-switch-chart').addEventListener('click', _basculerGraphique);

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

// Programmes distincts d'une commune : chaque programme compte 1 par commune.
// QPV est un programme virtuel, basé sur id_qp.
function _progsDeFeature(f) {
    const progs = new Set(f.properties.liste_programmes || []);
    if (String(f.properties.id_qp ?? '').trim()) progs.add('qpv');
    return [...progs];
}

// Découpe un libellé long en plusieurs lignes (max `max` caractères par ligne).
function _decouperLabel(texte, max = 28) {
    const mots = String(texte).split(' ');
    const lignes = [];
    let courante = '';
    mots.forEach(mot => {
        if ((courante + ' ' + mot).trim().length > max) {
            if (courante) lignes.push(courante);
            courante = mot;
        } else {
            courante = (courante + ' ' + mot).trim();
        }
    });
    if (courante) lignes.push(courante);
    return lignes;
}

function _preparerProgrammes(features) {
    const compteProg = {};

    features.forEach(f => {
        _progsDeFeature(f).forEach(p => {
            if (!PROGRAMMES_GRAPHIQUE.has(p)) return;
            if (!programmesActifs.has(p)) return;
            compteProg[p] = (compteProg[p] || 0) + 1;
        });
    });

    const trie = Object.entries(compteProg).sort((a, b) => b[1] - a[1]);

    return {
        labels:   trie.map(([p]) => _decouperLabel(libelleGraphique(p, 'communes'))),
        valeurs:  trie.map(([, v]) => v),
        couleurs: trie.map(([p]) => (PROGRAMMES_META[p] ?? {}).couleur ?? '#cccccc'),
    };
}

// Nombre de sites (programmes/dispositifs) par programme, dédupliqués sur le territoire.
// Une commune avec 3 sites France services compte 3 ; un site rattaché à plusieurs
// communes n'est compté qu'une fois.
function _preparerSites(features) {
    const sites = {};   // { prog: Set d'identifiants }

    features.forEach(f => {
        const p  = f.properties;
        const lp = p.liste_programmes || [];

        _progsDeFeature(f).forEach(prog => {
            if (!PROGRAMMES_GRAPHIQUE.has(prog)) return;
            if (!programmesActifs.has(prog)) return;

            let ids = idsSites(p, prog);
            if (!ids.length) {
                // Pas d'identifiant exploitable : on compte les occurrences dans la commune
                const n = prog === 'qpv' ? 1 : (lp.filter(x => x === prog).length || 1);
                ids = Array.from({ length: n }, (_, k) => `${p.insee_com}#${k}`);
            }
            const set = (sites[prog] ??= new Set());
            ids.forEach(id => set.add(id));
        });
    });

    // Tri décroissant par nombre de sites
    const trie = Object.entries(sites)
        .map(([p, set]) => [p, set.size])
        .sort((a, b) => b[1] - a[1]);


    return {
        labels:   trie.map(([p]) => _decouperLabel(libelleGraphique(p, 'sites'))),
        valeurs:  trie.map(([, v]) => v),
        couleurs: trie.map(([p]) => (PROGRAMMES_META[p] ?? {}).couleur ?? '#cccccc'),
    };
}

function _basculerGraphique() {
    _modeGraphique = _modeGraphique === 'communes' ? 'sites' : 'communes';
    const sites = _modeGraphique === 'sites';

    document.getElementById('wrap-barres').hidden = sites;
    document.getElementById('wrap-sites').hidden  = !sites;
    document.getElementById('chart1-titre').textContent =
        sites ? 'Nombre de programmes et dispositifs' : 'Nombre de communes lauréates';
    document.querySelector('#btn-switch-chart span').textContent =
        sites ? 'Communes lauréates' : 'Programmes et dispositifs';

    (sites ? chartSites : chartBarres)?.resize();
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

        _progsDeFeature(f).forEach(p => {
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
        label:           libelleGraphique(prog, 'typologie'),
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

    if (chartSites && data.sites) {
    chartSites.data.labels           = data.sites.labels;
    chartSites.data.datasets[0].data = data.sites.valeurs;
    chartSites.data.datasets[0].backgroundColor = data.sites.couleurs;
    chartSites.update();
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
        const sites      = _preparerSites(features);
        const typologies = await _preparerTypologie(features);

        updateCharts({ territoire: nom, programmes, sites, typologies });

    } catch (err) {
        console.error('[charts.js] Erreur API :', err);
    }
}

async function updateChartsWithActivePrograms() {
    if (_featuresEnCours.length === 0) return;
    
    try {
        const programmes = _preparerProgrammes(_featuresEnCours);
        const sites      = _preparerSites(_featuresEnCours); 
        const typologies = await _preparerTypologie(_featuresEnCours);
        updateCharts({ territoire: _nomEnCours, programmes, sites, typologies });
    } catch (err) {
        console.error('[charts.js] Erreur mise à jour programmes actifs :', err);
    }
}

function resizeCharts() {
    chartBarres?.resize();
    chartSites?.resize();
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