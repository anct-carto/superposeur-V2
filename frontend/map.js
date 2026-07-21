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
        COUCHES_TERRITORIALISABLES.forEach(key => {
        const layerId = `lyr-${key}`;
        if (map.getLayer(layerId)) map.setFilter(layerId, filtreGeo || null);
    });
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
    _coucheClicHandlers['cluster-eclate'] = (f) => {
        const insee = f.properties.commune;
        const lib_com = f.properties.lib_com;
        fetchDonneesTerritoire(insee, 'commune', lib_com);
        nettoyerCluster();
        appliquerFiltre();
    };
    map.on('mouseenter', 'cluster-eclate', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cluster-eclate', () => { map.getCanvas().style.cursor = ''; });

    programmesOrdonnes.forEach((_, i) => {
        const id = `prog-${i}`;
        _coucheClicHandlers[id] = (f, e) => _gererClickProgramme(f, e, id);
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    });
}

function _gererClickProgramme(f, e, id) {
    const insee = f.properties.insee_com;
    const lib_com = f.properties.lib_com || insee;
    const coords = f.geometry.coordinates;
    const prog = programmesOrdonnes[parseInt(id.split('-')[1], 10)];
    new maplibregl.Popup({ maxWidth: '260px' })
        .setLngLat(coords)
        .setHTML(`<strong style="color:${couleursParProg[prog]}">${(PROGRAMMES_META[prog] ?? {}).nom ?? prog}</strong>
            <table style="margin-top:6px;width:100%;border-collapse:collapse;font-size:12px">
                <tr><th>Code INSEE</th><td>${insee}</td></tr>
                <tr><th>Commune</th><td>${lib_com}</td></tr>
            </table>`)
        .addTo(map);    
    let programmes = f.properties.liste_programmes || [];

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
    legende.querySelectorAll('.legende-groupe, .legende-item').forEach(el => el.remove());

    // Regroupement unique (cercles + polygones confondus)
    const groupes = {};
    Object.entries(PROGRAMMES_META).forEach(([key, meta]) => {
        (groupes[meta.groupe] ??= []).push(key);
    });

    // Tri alphabétique : groupes, puis programmes à l'intérieur de chaque groupe
    const nomsGroupesTries = Object.keys(groupes).sort((a, b) =>
        a.localeCompare(b, 'fr', { sensitivity: 'base' })
    );
    nomsGroupesTries.forEach(g => {
        groupes[g].sort((a, b) =>
            PROGRAMMES_META[a].nom.localeCompare(PROGRAMMES_META[b].nom, 'fr', { sensitivity: 'base' })
        );
    });

    // Bouton "Tous sélectionner"
    const btnTous = document.createElement('div');
    btnTous.style.cssText = 'margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #eee';
    btnTous.innerHTML = '<button id="btn-tous-programmes" style="width:auto;padding:8px;background:var(--color-bg-hover);border:1px solid var(--color-border);border-radius:4px;cursor:pointer;font-size:13px;color:var(--color-accent);font-weight:600;transition:background 0.15s ease">Tous sélectionner</button>';
    legende.appendChild(btnTous);

    const btnTousProgr = document.getElementById('btn-tous-programmes');
    const sontTousSelectionnes = () =>
        Object.entries(PROGRAMMES_META).every(([key, meta]) =>
            meta.type === 'cercle' ? programmesActifs.has(key) : !!map.getSource(`src-${key}`)
        );
    const updateBtnText = () => {
        btnTousProgr.textContent = sontTousSelectionnes() ? 'Tous désélectionner' : 'Tous sélectionner';
    };

    btnTousProgr.addEventListener('click', async () => {
        const activer = !sontTousSelectionnes();
        for (const [key, meta] of Object.entries(PROGRAMMES_META)) {
            const checkbox = legende.querySelector(`input[value="${key}"]`);
            if (meta.type === 'cercle') {
                activer ? programmesActifs.add(key) : programmesActifs.delete(key);
                if (checkbox) checkbox.checked = activer;
            } else {
                if (checkbox) checkbox.checked = activer;
                const sourceId = `src-${key}`, layerId = `lyr-${key}`;
                if (activer) await _chargerCoucheProgramme(key, sourceId, layerId, meta.couleur);
                else _retirerCouche(sourceId, layerId);
            }
        }
        appliquerFiltre();
        updateChartsForActivePrograms();
        updateBtnText();
    });

    // Construction des groupes et de leurs items
    nomsGroupesTries.forEach(nomGroupe => {
        const titreEl = document.createElement('p');
        titreEl.className = 'legende-groupe';
        titreEl.innerHTML = `<i data-lucide="${GROUPES_ICONES[nomGroupe] ?? 'circle'}"></i>${nomGroupe}`;
        legende.appendChild(titreEl);

        groupes[nomGroupe].forEach(key => {
            const meta = PROGRAMMES_META[key];
            const item = document.createElement('label');
            item.className = 'legende-item';
            const style = meta.type === 'cercle' ? `background:${meta.couleur}` : _stylePastille(key, meta);
            item.innerHTML = `<input type="checkbox" value="${key}"><span class="legende-carre" style="${style}"></span><span class="legende-label">${meta.nom}</span>`;

            item.querySelector('input').addEventListener('change', async e => {
                if (meta.type === 'cercle') {
                    e.target.checked ? programmesActifs.add(key) : programmesActifs.delete(key);
                    appliquerFiltre();
                    updateChartsForActivePrograms();
                } else {
                    const sourceId = `src-${key}`, layerId = `lyr-${key}`;
                    e.target.checked
                        ? await _chargerCoucheProgramme(key, sourceId, layerId, meta.couleur)
                        : _retirerCouche(sourceId, layerId);
                }
                updateBtnText();
            });
            legende.appendChild(item);
        });
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

        const layerIdPts = `${layerId}-pts`;

        if (COUCHES_POINT.has(key)) {
            map.addLayer({ id: layerId, type: 'circle', source: sourceId, paint: {
                'circle-radius': 5, 'circle-color': couleur, 'circle-opacity': 0.75,
                'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff',
            }});

            if (COUCHES_TERRITORIALISABLES.has(key) && filtreGeo) {
                map.setFilter(layerId, filtreGeo);
            }
        } else if (COUCHES_MIXTES.has(key)) {
            // Sous-ensemble Polygon — même rendu que les couches polygones classiques
            map.addLayer({ id: layerId, type: 'fill', source: sourceId,
                filter: ['==', ['geometry-type'], 'Polygon'],
                paint: { 'fill-color': couleur, 'fill-opacity': 0.3 } });
            map.addLayer({ id: `${layerId}-stroke`, type: 'line', source: sourceId,
                filter: ['==', ['geometry-type'], 'Polygon'],
                paint: { 'line-color': couleur, 'line-width': 1.5 } });

            // Sous-ensemble Point — même rendu que les couches ponctuelles
            map.addLayer({ id: layerIdPts, type: 'circle', source: sourceId,
                filter: ['==', ['geometry-type'], 'Point'],
                paint: {
                    'circle-radius': 5, 'circle-color': couleur, 'circle-opacity': 0.75,
                    'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff',
                }});
        } else {
            map.addLayer({ id: layerId, type: 'fill', source: sourceId, paint: { 'fill-color': couleur, 'fill-opacity': 0.3 } });
            map.addLayer({ id: `${layerId}-stroke`, type: 'line', source: sourceId, paint: { 'line-color': couleur, 'line-width': 1.5 } });
        }

        programmesOrdonnes.forEach((_, i) => { if (map.getLayer(`prog-${i}`)) map.moveLayer(`prog-${i}`); });

        const onClick = (f, e) => {
            const p = f.properties;
            const idKey = Object.keys(p).find(k => k.startsWith('id_'));
            // Le surlignage animé ne s'applique qu'aux entités polygones (comme sur crte/ti)
            if (idKey && f.geometry.type !== 'Point') _surlignerPolygone(layerId, idKey, p[idKey], couleur);

            const lignes = [];
            if (p.code_qp) {
                if (p.lib_com) lignes.push(`<tr><th>Commune</th><td>${p.lib_com}</td></tr>`);
                if (p.code_qp) lignes.push(`<tr><th>Code QPV</th><td>${p.code_qp}</td></tr>`);
                if (p.lib_qp) lignes.push(`<tr><th>Quartiers</th><td>${p.lib_qp}</td></tr>`);
            } else {
                const libKey = Object.keys(p).find(k => k.startsWith('lib_') && k !== 'lib_groupement');
                if (idKey) lignes.push(`<tr><th>${idKey}</th><td>${p[idKey]}</td></tr>`);
                if (libKey) lignes.push(`<tr><th>${libKey}</th><td>${p[libKey]}</td></tr>`);
                if (p.lib_groupement) lignes.push(`<tr><th>Territoires</th><td>${p.lib_groupement}</td></tr>`);
                if (p.siren_groupement) lignes.push(`<tr><th>SIREN</th><td>${p.siren_groupement}</td></tr>`);
            }
            if (!lignes.length) return;
            new maplibregl.Popup({ maxWidth: '340px' }).setLngLat(e.lngLat).setHTML(`<strong style="color:${couleur}">${meta.nom}</strong><table style="margin-top:8px;width:100%;border-collapse:collapse;font-size:12px">${lignes.join('')}</table>`).addTo(map);
        };

        _coucheClicHandlers[layerId] = onClick;
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });

        if (COUCHES_MIXTES.has(key)) {
            _coucheClicHandlers[layerIdPts] = onClick;
            map.on('mouseenter', layerIdPts, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', layerIdPts, () => { map.getCanvas().style.cursor = ''; });
        }
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
    delete _coucheClicHandlers[layerId];
    delete _coucheClicHandlers[`${layerId}-pts`];
    if (surlignage?.layerId === layerId) _reinitialiserSurlignage();
    const glowId = `${layerId}-glow`;
    [glowId, `${layerId}-stroke`, `${layerId}-pts`, layerId].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(sourceId)) map.removeSource(sourceId);
}

const _coucheClicHandlers = {}; // layerId -> (feature, event) => void

function _layersCliquables() {
    const pts = programmesOrdonnes.map((_, i) => `prog-${i}`).filter(id => map.getLayer(id));
    const polys = Object.keys(_coucheClicHandlers).filter(id => map.getLayer(id) && !pts.includes(id));
    return [...pts, ...polys];
}

map.on('click', e => {
    const layers = _layersCliquables();
    if (!layers.length) return;
    const features = map.queryRenderedFeatures(e.point, { layers });
    if (!features.length) { _reinitialiserSurlignage(); return; }
    const f = features[0];
    _coucheClicHandlers[f.layer.id]?.(f, e);
});


let surlignage = null; // { layerId, idKey, idValue, couleur, animId }

function _surlignerPolygone(layerId, idKey, idValue, couleur) {
    if (surlignage) _reinitialiserSurlignage();

    const glowId = `${layerId}-glow`;
    if (!map.getLayer(glowId)) {
        map.addLayer({
            id: glowId,
            type: 'line',
            source: map.getLayer(layerId).source,
            paint: {
                'line-color': couleur,
                'line-width': 0,
                'line-blur': 6,
                'line-opacity': 0,
            }
        }, `${layerId}-stroke`); // sous le contour net
    }

    map.setFilter(glowId, ['==', ['get', idKey], idValue]);
    map.setPaintProperty(`${layerId}-stroke`, 'line-width', ['case', ['==', ['get', idKey], idValue], 3, 1.5]);
    map.setPaintProperty(`${layerId}-stroke`, 'line-color', ['case', ['==', ['get', idKey], idValue], '#ffffff', couleur]);
    map.setPaintProperty(layerId, 'fill-opacity', ['case', ['==', ['get', idKey], idValue], 0.5, 0.3]);

    const start = performance.now();
    const anim = now => {
        const t = (now - start) / 1000;
        const pulse = 0.5 + 0.5 * Math.sin(t * 2); // 0 -> 1 -> 0, ~3s par cycle
        map.setPaintProperty(glowId, 'line-width', 6 + pulse * 6);
        map.setPaintProperty(glowId, 'line-opacity', 0.35 + pulse * 0.35);
        surlignage.animId = requestAnimationFrame(anim);
    };
    surlignage = { layerId, idKey, idValue, couleur, animId: null };
    surlignage.animId = requestAnimationFrame(anim);
}

function _reinitialiserSurlignage() {
    if (!surlignage) return;
    const { layerId, couleur, animId } = surlignage;
    if (animId) cancelAnimationFrame(animId);

    const glowId = `${layerId}-glow`;
    if (map.getLayer(glowId)) {
        map.setPaintProperty(glowId, 'line-width', 0);
        map.setPaintProperty(glowId, 'line-opacity', 0);
    }
    if (map.getLayer(`${layerId}-stroke`)) {
        map.setPaintProperty(`${layerId}-stroke`, 'line-width', 1.5);
        map.setPaintProperty(`${layerId}-stroke`, 'line-color', couleur);
    }
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'fill-opacity', 0.3);
    surlignage = null;
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
    fetchDonneesTerritoire(entite.code, entite.type, entite.nom);
}

function _reinitialiser() {
    nettoyerCluster();
    _reinitialiserSurlignage();
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