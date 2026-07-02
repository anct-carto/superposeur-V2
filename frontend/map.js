// ===========================================================================
// MAP.JS — Carte interactive MapLibre (Optimisée)
// Raphaël Roumeau — Juin 2026
// ===========================================================================

// ---------------------------------------------------------------------------
// ÉTAT GLOBAL
// ---------------------------------------------------------------------------

let programmesOrdonnes = [];
const couleursParProg  = {};
let   programmesActifs = new Set();
let   filtreGeo        = null;
const fondsActifs = new Set(['ign']);
const _cacheGeoJSON     = {};
const _handlersParCouche = {};
let   clusterActif = null;
let   panelOpen = false;

// ---------------------------------------------------------------------------
// INITIALISATION MAPLIBRE
// ---------------------------------------------------------------------------

const map = new maplibregl.Map({
    container: 'map',
    preserveDrawingBuffer: true,
    style: {
        version: 8,
        sources: {
            ign: { type: 'raster', tiles: FONDS_CARTE.ign.tiles, tileSize: 256, attribution: FONDS_CARTE.ign.attribution },
            satellite: { type: 'raster', tiles: FONDS_CARTE.satellite.tiles, tileSize: 256, attribution: FONDS_CARTE.satellite.attribution },
        },
        layers: [
            { id: 'fond-ign', type: 'raster', source: 'ign', layout: { visibility: 'visible' } },
            { id: 'fond-satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
        ],
    },
    center: [2.35, 46.8],
    zoom: 5,
    maxZoom: 11,
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
map.addControl(new maplibregl.FullscreenControl(), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

lucide.createIcons();

// ---------------------------------------------------------------------------
// ÉLÉMENTS DOM
// ---------------------------------------------------------------------------

const sliderTab = document.getElementById('slider-tab');
const panel = document.getElementById('panel');
const ctrlRight = document.getElementById('ctrl-top-right');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const btnReset = document.getElementById('btn-reset');

// ---------------------------------------------------------------------------
// FONCTIONS UTILITAIRES
// ---------------------------------------------------------------------------

function _creerPointsEclatement(centre, programmes, commune, lib_com) {
    const rayon = 0.006 + Math.log(programmes.length) * 0.004;
    return {
        type: "FeatureCollection",
        features: programmes.map((prog, idx) => {
            const angle = (idx / programmes.length) * Math.PI * 2;
            return {
                type: "Feature",
                geometry: { type: "Point", coordinates: [centre[0] + rayon * Math.cos(angle), centre[1] + rayon * Math.sin(angle)] },
                properties: { programme: prog, commune, lib_com, idx }
            };
        })
    };
}

function mettreAJourCouleursCentroide() {
    programmesOrdonnes.forEach((prog, i) => {
        const id = `prog-${i}`;
        if (!map.getLayer(id)) return;
        map.setPaintProperty(id, 'circle-color', [
            'case',
            ['==', ['get', 'insee_com'], ['literal', clusterActif]],
            '#000000',
            couleursParProg[prog]
        ]);
    });
}

function appliquerFiltre() {
    programmesOrdonnes.forEach((prog, i) => {
        const id = `prog-${i}`;
        if (!map.getLayer(id)) return;

        if (!programmesActifs.has(prog)) {
            map.setFilter(id, ['literal', false]);
            return;
        }

        const filtreProg = ['in', prog, ['get', 'liste_programmes']];
        map.setFilter(id, filtreGeo ? ['all', filtreProg, filtreGeo] : filtreProg);
    });
    mettreAJourCouleursCentroide();
}

function nettoyerCluster() {
    if (map.getLayer('cluster-eclate')) map.removeLayer('cluster-eclate');
    if (map.getSource('cluster-src')) map.removeSource('cluster-src');
    clusterActif = null;
}

function togglePanelOpen() {
    panelOpen = !panelOpen;
    panel.classList.toggle('open', panelOpen);
    sliderTab.innerHTML = `<i data-lucide="${panelOpen ? 'chevron-right' : 'chevron-left'}"></i>`;
    lucide.createIcons({ context: sliderTab });
    sliderTab.style.right = panelOpen ? `${PANEL_W}px` : '0';
    ctrlRight.style.right = panelOpen ? `${PANEL_W + 16}px` : '16px';
    setTimeout(() => { map.resize(); resizeCharts(); }, 220);
}

function updateChartsForActivePrograms() {
    if (typeof updateChartsWithActivePrograms !== 'undefined') {
        updateChartsWithActivePrograms();
    }
}

// ---------------------------------------------------------------------------
// INITIALISATION PRINCIPALE
// ---------------------------------------------------------------------------

async function initApp() {
    const splash = document.getElementById('splash');
    const errorText = document.getElementById('error-text');

    try {
        await fetch(`${API_URL}/api/init`).then(r => r.json());
        const { programmes } = await fetch(`${API_URL}/api/programmes`).then(r => r.json());
        const geojson = await fetch(`${API_URL}/api/communes`).then(r => r.json());

        programmesOrdonnes = programmes.filter(p => !(p in PROGRAMMES_COUCHES));
        programmesOrdonnes.forEach(prog => {
            couleursParProg[prog] = (PROGRAMMES_META[prog] ?? {}).couleur ?? PALETTE[Object.keys(PROGRAMMES_META).indexOf(prog) % PALETTE.length];
        });

        // Normaliser liste_programmes
        geojson.features.forEach(f => {
            let lp = f.properties.liste_programmes;
            if (typeof lp === 'string') {
                try { lp = JSON.parse(lp); } catch { lp = JSON.parse(lp.replace(/'/g, '"')); }
            }
            f.properties.liste_programmes = Array.isArray(lp) ? lp : [];
        });

        map.addSource('communes', { type: 'geojson', data: geojson });
        _ajouterLayersConcentriques();
        _initialiserHandlers();
        construireLégende();
        construirePanneauCouches();
        appliquerFiltre();

        splash.style.opacity = '0';
        splash.style.pointerEvents = 'none';
    } catch (err) {
        errorText.style.display = 'block';
        errorText.textContent = '⚠️ Erreur lors du chargement. Veuillez rafraîchir la page.';
        console.error(err);
    }
}

map.on('load', initApp);

// ---------------------------------------------------------------------------
// AJOUT DES LAYERS
// ---------------------------------------------------------------------------

function _ajouterLayersConcentriques() {
    programmesOrdonnes.forEach((prog, i) => {
        map.addLayer({
            id: `prog-${i}`,
            type: 'circle',
            source: 'communes',
            filter: ['literal', false],
            paint: {
                'circle-radius': RAYON_BASE,
                'circle-color': couleursParProg[prog],
                'circle-opacity': 1,
                'circle-stroke-width': 0.8,
                'circle-stroke-color': '#ffffff',
            },
        });
    });
}

// ---------------------------------------------------------------------------
// INITIALISATION DES HANDLERS
// ---------------------------------------------------------------------------

function _initialiserHandlers() {
    // Handler cluster (unique)
    map.on('click', 'cluster-eclate', (e) => {
        const insee = e.features[0].properties.commune;
        const lib_com = e.features[0].properties.lib_com;
        if (!panelOpen) togglePanelOpen();
        fetchDonneesTerritoire(insee, 'commune', lib_com);
        nettoyerCluster();
        appliquerFiltre();
    });

    map.on('mouseenter', 'cluster-eclate', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cluster-eclate', () => { map.getCanvas().style.cursor = ''; });

    // Handlers programmes
    programmesOrdonnes.forEach((_, i) => {
        const id = `prog-${i}`;
        
        map.on('click', id, (e) => _gererClickProgramme(e, id));
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    });
}

function _gererClickProgramme(e, id) {
    const insee = e.features[0].properties.insee_com;
    const lib_com = e.features[0].properties.lib_com || insee;
    const coords = e.features[0].geometry.coordinates;
    let programmes = e.features[0].properties.liste_programmes || [];

    if (typeof programmes === 'string') {
        try { programmes = JSON.parse(programmes); } 
        catch { programmes = []; }
    }

    programmes = programmes.filter(p => programmesActifs.has(p));

    // Cleanup ancien cluster
    nettoyerCluster();

    // Set nouveau cluster actif
    clusterActif = insee;
    mettreAJourCouleursCentroide();

    // Afficher graphiques
    if (!panelOpen) togglePanelOpen();
    fetchDonneesTerritoire(insee, 'commune', lib_com);

    // Créer cluster si plusieurs programmes
    if (programmes.length > 1) {
        const geojson = _creerPointsEclatement(coords, programmes, insee, lib_com);
        map.addSource('cluster-src', { type: 'geojson', data: geojson });
        map.addLayer({
            id: 'cluster-eclate',
            type: 'circle',
            source: 'cluster-src',
            paint: {
                'circle-radius': 12,
                'circle-color': ['case', ['has', ['get', 'programme'], ['literal', couleursParProg]], ['get', ['get', 'programme'], ['literal', couleursParProg]], '#ccc'],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#fff',
                'circle-opacity': 0.95
            }
        });
    }
}

// ---------------------------------------------------------------------------
// LÉGENDE (PROGRAMMES + DISPOSITIFS)
// ---------------------------------------------------------------------------

function construireLégende() {
    const legende = document.getElementById('legende');
    legende.querySelectorAll('.legende-groupe, .legende-item, .legende-separateur').forEach(el => el.remove());

    const groupes = {};
    programmesOrdonnes.forEach(prog => {
        const meta = PROGRAMMES_META[prog] ?? { nom: prog, groupe: 'Autres', icone: 'circle' };
        (groupes[meta.groupe] ??= { icone: meta.icone, progs: [] }).progs.push(prog);
    });

    // Bouton "Tous sélectionner"
    const btnTous = document.createElement('div');
    btnTous.style.cssText = 'margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #eee';
    btnTous.innerHTML = '<button id="btn-tous-programmes" style="width:auto;padding:8px;background:var(--color-bg-hover);border:1px solid var(--color-border);border-radius:4px;cursor:pointer;font-size:13px;color:var(--color-accent);font-weight:600;transition:background 0.15s ease">Tous sélectionner</button>';
    legende.appendChild(btnTous);

    const btnTousProgr = document.getElementById('btn-tous-programmes');
    const sontTousSelectionnes = () => programmesOrdonnes.every(p => programmesActifs.has(p));
    const updateBtnText = () => { btnTousProgr.textContent = sontTousSelectionnes() ? 'Tous désélectionner' : 'Tous sélectionner'; };

    btnTousProgr.addEventListener('click', () => {
        if (sontTousSelectionnes()) {
            programmesOrdonnes.forEach(prog => programmesActifs.delete(prog));
            legende.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (programmesOrdonnes.includes(cb.value)) cb.checked = false;
            });
        } else {
            programmesOrdonnes.forEach(prog => programmesActifs.add(prog));
            legende.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (programmesOrdonnes.includes(cb.value)) cb.checked = true;
            });
        }
        appliquerFiltre();
        updateChartsForActivePrograms();
        updateBtnText();
    });

    // Programmes par groupe
    Object.entries(groupes).forEach(([titre, { icone, progs }]) => {
        const titreEl = document.createElement('p');
        titreEl.className = 'legende-groupe';
        titreEl.innerHTML = `<i data-lucide="${icone}"></i>${titre}`;
        legende.appendChild(titreEl);

        progs.forEach(prog => {
            const meta = PROGRAMMES_META[prog] ?? { nom: prog };
            const item = document.createElement('label');
            item.className = 'legende-item';
            item.innerHTML = `<input type="checkbox" value="${prog}"><span class="legende-carre" style="background:${couleursParProg[prog]}"></span><span class="legende-label">${meta.nom}</span>`;
            item.querySelector('input').addEventListener('change', e => {
                e.target.checked ? programmesActifs.add(prog) : programmesActifs.delete(prog);
                appliquerFiltre();
                updateChartsForActivePrograms();
                updateBtnText();
            });
            legende.appendChild(item);
        });
    });

    // Dispositifs
    const sep = document.createElement('p');
    sep.className = 'legende-groupe legende-separateur';
    sep.innerHTML = '<i data-lucide="land-plot"></i>Dispositifs';
    legende.appendChild(sep);

    Object.entries(DISPOSITIFS_LEGENDE).forEach(([key, meta]) => {
        const item = document.createElement('label');
        item.className = 'legende-item';
        item.innerHTML = `<input type="checkbox" value="${key}"><span class="legende-carre" style="${_stylePastille(key, meta)}"></span><span class="legende-label">${meta.nom}</span>`;
        item.querySelector('input').addEventListener('change', async e => {
            const sourceId = `src-${key}`;
            const layerId = `lyr-${key}`;
            e.target.checked ? await _chargerCoucheProgramme(key, sourceId, layerId, meta.couleur) : _retirerCouche(sourceId, layerId);
        });
        legende.appendChild(item);
    });

    lucide.createIcons({ context: legende });
}

// ---------------------------------------------------------------------------
// PANNEAU COUCHES
// ---------------------------------------------------------------------------

function construirePanneauCouches() {
    const panneau = document.getElementById('panneau-couches');
    panneau.innerHTML = '';

    const titreFond = document.createElement('p');
    titreFond.className = 'legende-groupe';
    titreFond.innerHTML = '<i data-lucide="map"></i>Fond de carte';
    panneau.appendChild(titreFond);

    Object.entries(FONDS_CARTE).forEach(([key, meta]) => {
        const item = document.createElement('label');
        item.className = 'legende-item';
        item.innerHTML = `<input type="checkbox" value="${key}" ${fondsActifs.has(key) ? 'checked' : ''}><span class="legende-miniature fond-${key}"></span><span class="legende-label">${meta.nom}</span>`;
        item.querySelector('input').addEventListener('change', e => {
            if (e.target.checked) {
                panneau.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    if (cb !== e.target && Object.keys(FONDS_CARTE).includes(cb.value)) {
                        cb.checked = false;
                        _toggleFond(cb.value, false);
                    }
                });
            }
            _toggleFond(key, e.target.checked);
        });
        panneau.appendChild(item);
    });

    _ajouterSectionCouches(panneau, 'Périmètres', 'land-plot', PERIMETRES_COUCHES, _chargerCoucheProgramme);
    _ajouterSectionCouches(panneau, 'Limites administratives', 'scan', LIMITES_ADMIN, _chargerCoucheAdmin);

    lucide.createIcons({ context: panneau });
}

function _ajouterSectionCouches(panneau, titre, icone, catalogue, chargerFn) {
    const titreEl = document.createElement('p');
    titreEl.className = 'legende-groupe';
    titreEl.innerHTML = `<i data-lucide="${icone}"></i>${titre}`;
    panneau.appendChild(titreEl);

    Object.entries(catalogue).forEach(([key, meta]) => {
        const item = document.createElement('label');
        item.className = 'legende-item';
        item.innerHTML = `<input type="checkbox" value="${key}"><span class="legende-carre" style="${_stylePastille(key, meta)}"></span><span class="legende-label">${meta.nom}</span>`;
        item.querySelector('input').addEventListener('change', async e => {
            const sourceId = `src-${key}`;
            const layerId = `lyr-${key}`;
            e.target.checked ? await chargerFn(key, sourceId, layerId, meta.couleur) : _retirerCouche(sourceId, layerId);
        });
        panneau.appendChild(item);
    });
}

// ---------------------------------------------------------------------------
// UTILITAIRES COUCHES
// ---------------------------------------------------------------------------

function _toggleFond(cle, visible) {
    map.setLayoutProperty(`fond-${cle}`, 'visibility', visible ? 'visible' : 'none');
    visible ? fondsActifs.add(cle) : fondsActifs.delete(cle);
}

function _stylePastille(key, meta) {
    return COUCHES_CONTOUR.has(key) ? `background:transparent;border:2px solid ${meta.couleur}` : `background:${meta.couleur};opacity:0.6`;
}

async function _fetchGeoJSON(url) {
    if (!_cacheGeoJSON[url]) _cacheGeoJSON[url] = await fetch(url).then(r => r.json());
    return _cacheGeoJSON[url];
}

async function _chargerCoucheProgramme(key, sourceId, layerId, couleur) {
    if (map.getSource(sourceId)) return;
    try {
        const meta = PROGRAMMES_COUCHES[key] ?? PERIMETRES_COUCHES[key] ?? DISPOSITIFS_LEGENDE[key];
        const data = await _fetchGeoJSON(meta.url);
        map.addSource(sourceId, { type: 'geojson', data });

        const premierCercle = map.getLayer('prog-0') ? 'prog-0' : undefined;
        map.addLayer({ id: layerId, type: 'fill', source: sourceId, paint: { 'fill-color': couleur, 'fill-opacity': 0.3 } }, premierCercle);
        map.addLayer({ id: `${layerId}-stroke`, type: 'line', source: sourceId, paint: { 'line-color': couleur, 'line-width': 1.5 } }, premierCercle);

        const onClick = e => {
            const p = e.features[0].properties;
            const lignes = [];
            if (p.code_qp) {
                if (p.lib_com) lignes.push(`<tr><th>Commune</th><td>${p.lib_com}</td></tr>`);
                if (p.code_qp) lignes.push(`<tr><th>Code QPV</th><td>${p.code_qp}</td></tr>`);
                if (p.lib_qp) lignes.push(`<tr><th>Quartiers</th><td>${p.lib_qp}</td></tr>`);
            } else {
                const idKey = Object.keys(p).find(k => k.startsWith('id_'));
                const libKey = Object.keys(p).find(k => k.startsWith('lib_') && k !== 'lib_groupement');
                if (idKey) lignes.push(`<tr><th>${idKey}</th><td>${p[idKey]}</td></tr>`);
                if (libKey) lignes.push(`<tr><th>${libKey}</th><td>${p[libKey]}</td></tr>`);
                if (p.lib_groupement) lignes.push(`<tr><th>Territoires</th><td>${p.lib_groupement}</td></tr>`);
                if (p.siren_groupement) lignes.push(`<tr><th>SIREN</th><td>${p.siren_groupement}</td></tr>`);
            }
            if (!lignes.length) return;
            new maplibregl.Popup({ maxWidth: '340px' }).setLngLat(e.lngLat).setHTML(`<strong style="color:${couleur}">${meta.nom}</strong><table style="margin-top:8px;width:100%;border-collapse:collapse;font-size:12px">${lignes.join('')}</table>`).addTo(map);
        };

        map.on('click', layerId, onClick);
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });

        _handlersParCouche[layerId] = { click: onClick };
    } catch (err) {
        console.error(`[map.js] Erreur chargement couche "${key}" :`, err);
    }
}

async function _chargerCoucheAdmin(key, sourceId, layerId, couleur) {
    if (map.getSource(sourceId)) return;
    try {
        const data = await _fetchGeoJSON(LIMITES_ADMIN[key].url);
        map.addSource(sourceId, { type: 'geojson', data });
        map.addLayer({ id: layerId, type: 'line', source: sourceId, paint: { 'line-color': couleur, 'line-width': 2.5, 'line-opacity': 0.9 } });
    } catch (err) {
        console.error(`[map.js] Erreur chargement couche admin "${key}" :`, err);
    }
}

function _retirerCouche(sourceId, layerId) {
    const handlers = _handlersParCouche[layerId];
    if (handlers && map.getLayer(layerId)) {
        map.off('click', layerId, handlers.click);
        delete _handlersParCouche[layerId];
    }
    [`${layerId}-stroke`, layerId].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(sourceId)) map.removeSource(sourceId);
}

// ---------------------------------------------------------------------------
// PANNEAU LATÉRAL
// ---------------------------------------------------------------------------

sliderTab.addEventListener('click', togglePanelOpen);

// ---------------------------------------------------------------------------
// RECHERCHE
// ---------------------------------------------------------------------------

let _searchTimer = null;
let _searchRequestId = 0;

searchInput.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { searchResults.classList.remove('visible'); return; }
    _searchTimer = setTimeout(_lancerRecherche, 200);
});

searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { clearTimeout(_searchTimer); _lancerRecherche(); }
});

document.getElementById('search-btn').addEventListener('click', _lancerRecherche);
document.addEventListener('click', e => {
    if (!e.target.closest('#ctrl-top-left')) searchResults.classList.remove('visible');
});

async function _lancerRecherche() {
    const q = searchInput.value.trim();
    if (q.length < 2) return;
    const requestId = ++_searchRequestId;
    try {
        const data = await fetch(`${API_URL}/api/recherche?q=${encodeURIComponent(q)}`).then(r => r.json());
        if (requestId === _searchRequestId) _afficherRésultats(data);
    } catch (err) {
        console.error('[map.js] Erreur recherche :', err);
    }
}

function _afficherRésultats(résultats) {
    searchResults.innerHTML = '';
    if (!résultats.length) { searchResults.classList.remove('visible'); return; }
    const frag = document.createDocumentFragment();
    résultats.forEach(r => {
        const li = document.createElement('li');
        li.innerHTML = `${r.nom} <span>(${TYPE_LABELS[r.type] ?? r.type})</span>`;
        li.addEventListener('click', () => {
            searchInput.value = r.nom;
            searchResults.classList.remove('visible');
            _zoomEtFiltrer(r);
        });
        frag.appendChild(li);
    });
    searchResults.appendChild(frag);
    searchResults.classList.add('visible');
}

function _zoomEtFiltrer(entite) {
    nettoyerCluster();
    map.fitBounds([[entite.bbox[0], entite.bbox[1]], [entite.bbox[2], entite.bbox[3]]], { padding: 40, duration: 800 });
    const champ = CHAMPS_GEO_PAR_TYPE[entite.type];
    filtreGeo = champ ? ['==', ['get', champ], entite.code] : null;
    appliquerFiltre();
    btnReset.style.display = 'inline-flex';
    if (!panelOpen) togglePanelOpen();
    fetchDonneesTerritoire(entite.code, entite.type, entite.nom);
}

function _reinitialiser() {
    nettoyerCluster();
    filtreGeo = null;
    searchInput.value = '';
    appliquerFiltre();
    map.flyTo({ center: [2.35, 46.8], zoom: 5, duration: 800 });
    btnReset.style.display = 'none';
}

btnReset.addEventListener('click', _reinitialiser);

// ---------------------------------------------------------------------------
// EXPORT CSV
// ---------------------------------------------------------------------------

document.getElementById('btn-exporter').addEventListener('click', async () => {
    if (_featuresEnCours.length === 0) { alert('Sélectionnez d\'abord un territoire.'); return; }
    const communes_insee = _featuresEnCours.map(f => f.properties.insee_com);
    const programmes = Array.from(programmesActifs);
    try {
        const response = await fetch(`${API_URL}/api/export-csv`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ communes_insee, programmes }),
        });
        if (!response.ok) throw new Error(`Erreur ${response.status}`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `export_communes_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        console.error('[map.js] Erreur export :', err);
        alert('Erreur lors de l\'export.');
    }
});

// ---------------------------------------------------------------------------
// EXPORT PDF
// ---------------------------------------------------------------------------

document.getElementById('btn-imprimer').addEventListener('click', async () => {
    if (_featuresEnCours.length === 0) { alert('Sélectionnez d\'abord un territoire.'); return; }
    const btn = document.getElementById('btn-imprimer');
    btn.disabled = true;
    btn.style.opacity = '0.5';

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('l', 'mm', 'a4');
        const W = pdf.internal.pageSize.getWidth();
        const H = pdf.internal.pageSize.getHeight();
        const territoire = document.getElementById('territoire').textContent;
        const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

        const hexToRgb = hex => [parseInt(hex.slice(1,3), 16), parseInt(hex.slice(3,5), 16), parseInt(hex.slice(5,7), 16)];
        const drawHeader = (sousTitre) => {
            pdf.setFont('times', 'bold');
            pdf.setFontSize(16);
            pdf.setTextColor(30, 30, 30);
            pdf.text(territoire.toUpperCase(), 10, 13);
            pdf.setFont('times', 'normal');
            pdf.setFontSize(8);
            pdf.setTextColor(140, 140, 140);
            pdf.text(sousTitre, 10, 19);
            pdf.text(date, W - 10, 19, { align: 'right' });
            pdf.setDrawColor(230, 230, 230);
            pdf.setLineWidth(0.3);
            pdf.line(10, 22, W - 10, 22);
        };
        const drawFooter = (pageNum, pageTotal, pageH = H) => {
            pdf.setDrawColor(230, 230, 230);
            pdf.setLineWidth(0.3);
            pdf.line(10, pageH - 8, W - 10, pageH - 8);
            pdf.setFontSize(7);
            pdf.setFont('times', 'normal');
            pdf.setTextColor(180, 180, 180);
            pdf.text('Agence Nationale de la Cohésion des Territoires', 10, pageH - 4);
            pdf.text(`${pageNum} / ${pageTotal}`, W - 10, pageH - 4, { align: 'right' });
        };

        drawHeader('Cartographie des programmes');
        const CARTE_TOP = 25, LEGENDE_H = 50, FOOTER_H = 12;
        const mapMaxH = H - CARTE_TOP - LEGENDE_H - FOOTER_H;
        const mapCanvas = map.getCanvas();
        const mapImg = mapCanvas.toDataURL('image/png');
        const PX_TO_MM = 25.4 / 96;
        const naturalW = mapCanvas.width * PX_TO_MM;
        const naturalH = mapCanvas.height * PX_TO_MM;
        const mapScale = Math.min(1, mapMaxH / naturalH, (W - 20) / naturalW);
        const mapW_f = naturalW * mapScale;
        const mapH_f = naturalH * mapScale;
        const mapOffX = 10 + ((W - 20) - mapW_f) / 2;

        pdf.addImage(mapImg, 'PNG', mapOffX, CARTE_TOP, mapW_f, mapH_f);
        pdf.setDrawColor(210, 210, 210);
        pdf.setLineWidth(0.3);
        pdf.rect(mapOffX, CARTE_TOP, mapW_f, mapH_f, 'S');

        const legendeTop = CARTE_TOP + mapH_f + 6;
        const itemsLegende = [];
        programmesOrdonnes.filter(prog => programmesActifs.has(prog)).forEach(prog => {
            itemsLegende.push({ couleur: couleursParProg[prog], nom: (PROGRAMMES_META[prog] ?? { nom: prog }).nom, contour: false });
        });
        document.querySelectorAll('#legende input[type="checkbox"], #panneau-couches input[type="checkbox"]').forEach(cb => {
            if (!cb.checked || programmesOrdonnes.includes(cb.value)) return;
            const meta = DISPOSITIFS_LEGENDE[cb.value] ?? PERIMETRES_COUCHES[cb.value] ?? LIMITES_ADMIN[cb.value] ?? PROGRAMMES_COUCHES[cb.value];
            if (!meta) return;
            itemsLegende.push({ couleur: meta.couleur, nom: meta.nom, contour: COUCHES_CONTOUR?.has(cb.value) ?? false });
        });

        pdf.setFont('times', 'bold');
        pdf.setFontSize(7);
        pdf.setTextColor(140, 140, 140);
        pdf.text('LÉGENDE', 10, legendeTop);

        const colWidth = 60, itemH = 5, dotR = 1.5, cols = Math.floor((W - 20) / colWidth);
        pdf.setFont('times', 'normal');
        pdf.setFontSize(7.5);
        itemsLegende.forEach((item, i) => {
            const x = 10 + (i % cols) * colWidth;
            const y = legendeTop + 5 + Math.floor(i / cols) * itemH;
            const [r, g, b] = hexToRgb(item.couleur);
            if (item.contour) {
                pdf.setDrawColor(r, g, b);
                pdf.setLineWidth(0.8);
                pdf.rect(x + 0.5, y - dotR, dotR * 2, dotR * 2, 'S');
            } else {
                pdf.setFillColor(r, g, b);
                pdf.circle(x + dotR, y, dotR, 'F');
            }
            pdf.setTextColor(60, 60, 60);
            pdf.text(item.nom, x + dotR * 2 + 2, y + 1);
        });
        drawFooter(1, 2);

        pdf.addPage([210, 297], 'portrait');
        const W2 = 210, H2 = 297;
        drawHeader('Analyse statistique du territoire');
        drawFooter(2, 2, H2);

        const chartsCanvas = await html2canvas(document.getElementById('panel-inner'), {
            scale: 1, useCORS: true, logging: false, backgroundColor: '#ffffff',
        });
        const chartsWmm = chartsCanvas.width * PX_TO_MM;
        const chartsHmm = chartsCanvas.height * PX_TO_MM;
        const maxW = W2 - 20, maxH = H2 - 35;
        const chartScale = Math.min(1, maxW / chartsWmm, maxH / chartsHmm);
        const finalW = chartsWmm * chartScale;
        const finalH = chartsHmm * chartScale;
        const offsetX = 10 + (maxW - finalW) / 2;

        pdf.addImage(chartsCanvas.toDataURL('image/png'), 'PNG', offsetX, 27, finalW, finalH);
        pdf.setDrawColor(210, 210, 210);
        pdf.setLineWidth(0.3);
        pdf.rect(offsetX, 27, finalW, finalH, 'S');
        pdf.save(`export_${territoire}_${date}.pdf`);
    } catch (err) {
        console.error('[map.js] Erreur export PDF :', err);
        alert('Erreur lors de l\'export en PDF.');
    } finally {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
});

// ---------------------------------------------------------------------------
// BOUTONS CONTRÔLE
// ---------------------------------------------------------------------------

document.getElementById('btn-legende').addEventListener('click', () => { document.getElementById('legende').hidden ^= true; });
document.getElementById('btn-couches').addEventListener('click', () => { document.getElementById('panneau-couches').hidden ^= true; });