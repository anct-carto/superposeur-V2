// ===========================================================================
// CONFIG.JS — Configuration partagée (carte + graphiques)
// ===========================================================================
//
// Ce fichier centralise toutes les constantes utilisées par map.js et
// charts.js. Modifier ici suffit pour répercuter les changements partout.
//
// Organisation :
//   1. API — URL de base et routes par type de territoire
//   2. Palette — couleurs des programmes
//   3. Programmes — métadonnées (nom, groupe, icône) + dérivés utiles
//   4. Couches polygones — prog rammes, périmètres, dispositifs, admin
//   5. Territoires — labels et champs de jointure géographique
//   6. Fonds de carte — tuiles IGN
//   7. Typologies — configuration des trois grilles d'analyse
//   8. Constantes d'interface — dimensions du panneau, rayon des cercles
//
// Raphaël Roumeau — Juin 2026
// ===========================================================================


// ---------------------------------------------------------------------------
// 1. API
// ---------------------------------------------------------------------------

/** URL de base du back-end FastAPI (sans slash final). */
const API_URL = window.location.origin;

/**
 * Fonctions-routes : génèrent l'URL d'API pour un territoire donné.
 * Clés = valeurs possibles du champ `type` renvoyé par /api/recherche.
 */
const ROUTES_API = {
    commune:     code => `${API_URL}/api/communes/${code}`,
    departement: code => `${API_URL}/api/departements/${code}`,
    region:      code => `${API_URL}/api/regions/${code}`,
    epci:        code => `${API_URL}/api/epci/${code}`,
    arr:         code => `${API_URL}/api/arr/${code}`,     // ← nouveau
    crte:        code => `${API_URL}/api/crte/${code}`,   // ← nouveau
    massif:  code => `${API_URL}/api/massif/${encodeURIComponent(code)}`,
    france:  ()   => `${API_URL}/api/france`,  
};


// ---------------------------------------------------------------------------
// 2. PALETTE
// ---------------------------------------------------------------------------

const PALETTE = [
    '#e12a5c', // Action cœur de ville      — acv
    '#DA7E42', // Petites villes de demain  — pvd
    '#273375', // France services           — fs
    '#a40037', // Villages d'avenir         — va
    '#327d48', // Avenir montagne (ami/amm) — ami, amm
    '#3ca331', // CRTE                      — crte
    '#8d5a99', // Manufactures de proximité — manup
    '#616daf', // Fabriques de territoire   — fabt
    '#de9f00', // Fabriques prospectives    — fabp
    '#599AD4', // Territoires d'industrie   — ti
    '#2E86AB', // Cités de l'emploi         — cde  (provisoire)
    '#E84855', // Cités éducatives          — cite (provisoire)
    '#6B4226', // Sites clés en main        — site (provisoire)
    '#4E8098', // Entrées de ville          — edv  (provisoire)
    '#b5541e', // Projet appui opérationnel      — pao
    '#4f6d4f', // Fonds restructuration locaux   — frla
    '#8a3f5c', // Commerces ruraux               — comrur
    '#2f5d62', // Plan transformation zones com. — ptzc
];


// ---------------------------------------------------------------------------
// 3. PROGRAMMES
// ---------------------------------------------------------------------------

const PROGRAMMES_META = {
    // --- Services publics ---
    fs:     { nom: 'France services',                                 couleur: '#273375', groupe: 'Services publics', type: 'cercle' },

    // --- Dynamiques des centres villes et bourgs ---
    acv:    { nom: 'Action cœur de ville',            couleur: '#e12a5c', groupe: 'Dynamiques des centres villes et bourgs', type: 'cercle' },
    edv:    { nom: 'Entrées de ville',                couleur: '#4E8098', groupe: 'Dynamiques des centres villes et bourgs', type: 'cercle' },
    pvd:    { nom: 'Petites villes de demain',        couleur: '#DA7E42', groupe: 'Dynamiques des centres villes et bourgs', type: 'cercle' },
    va:     { nom: "Villages d'avenir",               couleur: '#a40037', groupe: 'Dynamiques des centres villes et bourgs', type: 'cercle' },

    // --- Industrie ---
    site:   { nom: 'Sites clés en main',              couleur: '#6B4226', groupe: 'Industrie', type: 'cercle' },
    ti:     { nom: "Territoires d'industrie",         couleur: '#599AD4', groupe: 'Industrie', type: 'polygone', url: '../data/admin/polygone-4326_ti.geojson' },

    // --- Politique de la ville ---
    cde:    { nom: "Cités de l'emploi",               couleur: '#2E86AB', groupe: 'Politique de la ville', type: 'cercle' },
    cite:   { nom: 'Cités éducatives',                couleur: '#E84855', groupe: 'Politique de la ville', type: 'cercle' },
    // Dans PROGRAMMES_META
qpv: { nom: 'Quartier prioritaire de la ville', couleur: '#E1000F', groupe: 'Politique de la ville', type: 'point', url: `${API_URL}/api/qpv` },

    // --- Territoires, transition écologique ---
    ami:    { nom: 'Avenir montagne ingénierie',      couleur: '#327d48', groupe: 'Territoires, transition écologique', type: 'polygone', url: '../data/admin/polygone-4326_ami.geojson' },
    amm:    { nom: 'Avenir montagne mobilité',        couleur: '#327d48', groupe: 'Territoires, transition écologique', type: 'polygone', url: '../data/admin/polygone-4326_amm.geojson' },
    crte:   { nom: 'CRTE',                            couleur: '#3ca331', groupe: 'Territoires, transition écologique', type: 'polygone', url: '../data/admin/polygone-4326_crte.geojson' },

    // --- Commerces ---
    comrur: { nom: 'Commerces ruraux',                                    couleur: '#8a3f5c', groupe: 'Commerces', type: 'cercle' },
    frla:   { nom: "Fonds de restructuration des locaux d'activité",      couleur: '#4f6d4f', groupe: 'Commerces', type: 'cercle' },
    ptzc:   { nom: 'Plan de transformation des zones commerciales',       couleur: '#2f5d62', groupe: 'Commerces', type: 'cercle' },
    pao:    { nom: 'Projet appui opérationnel',                          couleur: '#b5541e', groupe: 'Commerces', type: 'cercle' },

    // --- Coopération territoriale et lien social ---
    fabt:   { nom: 'Fabriques de territoire',         couleur: '#616daf', groupe: 'Coopération territoriale et lien social', type: 'cercle' },
    fabp:   { nom: 'Fabriques prospectives',          couleur: '#de9f00', groupe: 'Coopération territoriale et lien social', type: 'polygone', url: '../data/admin/polygone-4326_fabriques.geojson' },
    manup:  { nom: 'Manufactures de proximité',       couleur: '#8d5a99', groupe: 'Coopération territoriale et lien social', type: 'cercle' },
};

/**
 * Icône (lucide) par grande catégorie, affichée dans l'en-tête de groupe.
 */
const GROUPES_ICONES = {
    'Services publics':                          'users',
    'Dynamiques des centres villes et bourgs':    'landmark',
    'Industrie':                                  'badge-euro',
    'Politique de la ville':                      'building',
    'Territoires, transition écologique':         'leaf',
    'Commerces':                                  'shopping-cart',
    'Coopération territoriale et lien social':    'handshake',
};

/**
 * Dictionnaire clé → libellé court, dérivé de PROGRAMMES_META.
 */
const LABELS_PROGRAMMES = Object.fromEntries(
    Object.entries(PROGRAMMES_META).map(([cle, meta]) => [cle, meta.nom])
);

/**
 * Ensemble des clés de programmes affichables dans les graphiques.
 * NB : seuls les programmes de type "cercle" ont une valeur par commune
 * exploitable par charts.js (liste_programmes) — les polygones (ti, qpv,
 * crte, ami, amm, fabp) sont exclus des graphiques comme avant.
 */
const PROGRAMMES_GRAPHIQUE = new Set(
    Object.entries(PROGRAMMES_META).filter(([, m]) => m.type === 'cercle').map(([k]) => k)
);

// ---------------------------------------------------------------------------
// 4. COUCHES POLYGONES
// ---------------------------------------------------------------------------

/**
 * Programmes disposant d'une couche polygone (périmètre géographique propre).
 * Ces programmes sont affichés via des polygones plutôt que des points.
 * Clé = identifiant programme, valeur = { nom, couleur, url GeoJSON }.
 */
const PROGRAMMES_COUCHES = {
    ti:   { nom: "Territoires d'industrie",    couleur: '#599AD4', url: '../data/admin/polygone-4326_ti.geojson'        },
    fabp: { nom: 'Fabriques prospectives',     couleur: '#de9f00', url: '../data/admin/polygone-4326_fabriques.geojson' },
    ami:  { nom: 'Avenir montagne ingénierie', couleur: '#327d48', url: '../data/admin/polygone-4326_ami.geojson'       },
    amm:  { nom: 'Avenir montagne mobilité',   couleur: '#327d48', url: '../data/admin/polygone-4326_amm.geojson'       },
    crte: { nom: 'CRTE',                       couleur: '#3ca331', url: '../data/admin/polygone-4326_crte.geojson'      },
    qpv: { nom: 'Quartiers prioritaires', couleur: '#E1000F', url: `${API_URL}/api/qpv` },
};

/**
 * Alias : dispositifs affichés dans la section "Dispositifs" de la légende.
 * Identiques aux couches programmes pour l'instant.
 */
const DISPOSITIFS_LEGENDE = { ...PROGRAMMES_COUCHES };

/**
 * Périmètres thématiques activables depuis le panneau Couches.
 * Inclut certains programmes-couches + zones spécifiques (ex. massifs).
 */
const PERIMETRES_COUCHES = {
    crte:     PROGRAMMES_COUCHES.crte,
    montagne: { nom: 'Massifs montagneux', couleur: '#AE8160', url: '../data/admin/polygone-4326_montagne.geojson' },
};

/**
 * Limites administratives activables depuis le panneau Couches.
 * Affichées en mode contour (line), pas en remplissage.
 */
const LIMITES_ADMIN = {
    com:  { nom: 'Communes',        couleur: '#555555', url: '../data/admin/polygone-4326_com.geojson'       },
    arr:  { nom: 'Arrondissements', couleur: '#c3d144', url: '../data/admin/polygone-4326_arr.geojson'       },
    epci: { nom: 'EPCI',            couleur: '#337ab7', url: '../data/admin/polygone-4326_epci-ept.geojson'  },
    dep:  { nom: 'Départements',    couleur: '#5cb85c', url: '../data/admin/polygone-4326_dep.geojson'       },
    reg:  { nom: 'Régions',         couleur: '#d9534f', url: '../data/admin/polygone-4326_reg.geojson'       },
};

/**
 * Couches affichées uniquement en contour (sans remplissage).
 * Utilisé par _stylePastille() dans map.js pour choisir le style de pastille.
 */
const COUCHES_CONTOUR = new Set(['com', 'arr', 'epci', 'dep', 'reg', 'montagne']);
/** Couches-programmes dont la géométrie est un point (et non un polygone). */
const COUCHES_POINT = new Set(['qpv']);
/**
 * Couches (hors programmes en cercles) auxquelles on applique le filtre
 * de territoire (filtreGeo) lors d'une recherche, comme pour les prog-i.
 */
const COUCHES_TERRITORIALISABLES = new Set(['qpv']);
// ---------------------------------------------------------------------------
// 5. TERRITOIRES
// ---------------------------------------------------------------------------

/**
 * Libellés affichés dans les résultats de recherche (type → label lisible).
 */
const TYPE_LABELS = {
    commune:     'Commune',
    epci:        'EPCI',
    departement: 'Département',
    region:      'Région',
    arr:         'Arrondissement',   // ← nouveau
    crte:        'CRTE',             // ← nouveau
    massif:  'Massif',
    france:  'France',
};

/**
 * Champ de propriété GeoJSON utilisé pour filtrer les communes
 * selon le type de territoire sélectionné dans la recherche.
 */
const CHAMPS_GEO_PAR_TYPE = {
    commune:     'insee_com',
    epci:        'siren_epci',
    departement: 'insee_dep',
    region:      'insee_reg',
    arr:         'insee_arr',        // ← nouveau
    crte:        'id_crte',          // ← à confirmer selon ta colonne
    massif : 'niveau_montagne',
};


// ---------------------------------------------------------------------------
// 6. FONDS DE CARTE
// ---------------------------------------------------------------------------

/**
 * Fonds de carte disponibles dans le panneau Couches.
 * Les tuiles proviennent du Géoportail IGN (accès libre, sans clé).
 * Clé = identifiant utilisé dans MapLibre (source/layer id).
 */
const FONDS_CARTE = {
    ign: {
        nom:         'Plan IGN',
        tiles:       [
            'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
            '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png' +
            '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
        ],
        attribution: '© IGN',
    },
    satellite: {
        nom:         'Satellite IGN',
        tiles:       [
            'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
            '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg' +
            '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
        ],
        attribution: '© IGN',
    },
};


// ---------------------------------------------------------------------------
// 7. TYPOLOGIES
// ---------------------------------------------------------------------------

/**
 * Configuration des trois grilles typologiques INSEE disponibles.
 * - label       : nom court (tab ou tooltip)
 * - labelComplet : libellé complet affiché dans le sélecteur du panneau
 * - col         : nom de la colonne dans la base de données
 * - ordre       : liste ordonnée des classes (axe X du graphique colonnes)
 */
const TYPOLOGIES_CONFIG = {
    centralite: {
        label:        'Centralité',
        labelComplet: "Niveau de centres d'équipements et de services des communes 2021",
        col:          'niveau_centralite',
        ordre: [
            'Communes non centre',
            "Centre local d'équipements et de services",
            "Centre intermédiaire d'équipements et de services",
            "Centre structurant d'équipements et de services",
            "Centre majeur d'équipements et de services",
            'N/A',
        ],
    },
    densite: {
        label:        'Densité',
        labelComplet: 'Grille communale de densité en 7 niveaux',
        col:          'niveau_densite',
        ordre: [
            'Rural à habitat très dispersé',
            'Rural à habitat dispersé',
            'Bourgs ruraux',
            'Ceintures urbaines',
            'Petites villes',
            'Centres urbains intermédiaires',
            'Grands centres urbains',
        ],
    },
    ruralite: {
        label:        'Ruralité',
        labelComplet: 'Typologie diversité des ruralités (Commune)',
        col:          'niveau_ruralite',
        ordre: [
            'Les ruralités touristiques spécialisées',
            'Les ruralités touristiques à dominante résidentielle',
            'Les ruralités productives agricoles',
            'Les ruralités productives ouvrières',
            'Les petites polarités mixtes',
            'Les petites polarités industrielles et artisanales',
            'Les ruralités résidentielles mixtes',
            'Les ruralités résidentielles aisées',
            'Commune dont le périmètre a changé depuis la réalisation de la typologie',
            'Hors champ : DOM ou commune urbaine',
        ],
    },
};


// ---------------------------------------------------------------------------
// 8. CONSTANTES D'INTERFACE
// ---------------------------------------------------------------------------

/** Largeur du panneau latéral en pixels (doit correspondre à --panel-width dans style.css). */
const PANEL_W = 600;

/** Rayon de base (px) des cercles concentriques sur la carte. */
const RAYON_BASE = 5;