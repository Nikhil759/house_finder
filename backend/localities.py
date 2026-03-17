"""
Canonical locality system for Bangalore housing search.

Single source of truth for all locality names, coordinates, aliases,
geo-expansion, and text extraction.
"""

from math import radians, sin, cos, sqrt, atan2

# ─────────────────────────────────────────────
# Locality metadata
# ─────────────────────────────────────────────
# Each entry:
#   coords      – [lat, lon]
#   radius_km   – geo-expansion radius (bigger zones get larger radius)
#   aliases     – alternate names people use
#   also_include– manual overrides for logically related areas not caught by radius
#   nobroker    – True to include in NoBroker ingestion (uses lat/lon from coords)

LOCALITY_META = {
    "Whitefield": {
        "coords": [12.9698, 77.7499],
        "radius_km": 5.0,
        "aliases": ["whitefield", "wtfd"],
        "also_include": ["ITPL"],
        "nobroker": True,
    },
    "HSR Layout": {
        "coords": [12.9116, 77.6389],
        "radius_km": 3.0,
        "aliases": ["hsr layout", "hsr"],
        "also_include": [],
        "nobroker": True,
    },
    "Koramangala": {
        "coords": [12.9352, 77.6245],
        "radius_km": 3.0,
        "aliases": ["koramangala", "koramangla"],
        "also_include": ["Ejipura"],
        "nobroker": True,
    },
    "Indiranagar": {
        "coords": [12.9784, 77.6408],
        "radius_km": 2.5,
        "aliases": ["indiranagar", "indira nagar"],
        "also_include": [],
        "nobroker": True,
    },
    "Marathahalli": {
        "coords": [12.9591, 77.7010],
        "radius_km": 3.0,
        "aliases": ["marathahalli", "marathalli", "marthahalli"],
        "also_include": [],
        "nobroker": True,
    },
    "Bellandur": {
        "coords": [12.9257, 77.6761],
        "radius_km": 2.5,
        "aliases": ["bellandur", "bellundur"],
        "also_include": [],
        "nobroker": True,
    },
    "BTM Layout": {
        "coords": [12.9165, 77.6101],
        "radius_km": 2.5,
        "aliases": ["btm layout", "btm"],
        "also_include": [],
        "nobroker": True,
    },
    "Hebbal": {
        "coords": [13.0353, 77.5947],
        "radius_km": 3.0,
        "aliases": ["hebbal"],
        "also_include": ["Manyata"],
        "nobroker": True,
    },
    "Yelahanka": {
        "coords": [13.1007, 77.5963],
        "radius_km": 3.0,
        "aliases": ["yelahanka"],
        "also_include": [],
        "nobroker": True,
    },
    "Electronic City": {
        "coords": [12.8399, 77.6770],
        "radius_km": 4.0,
        "aliases": ["electronic city", "ec", "e-city", "ecity"],
        "also_include": [],
        "nobroker": True,
    },
    "Sarjapur Road": {
        "coords": [12.9087, 77.6950],
        "radius_km": 3.5,
        "aliases": ["sarjapur road", "sarjapur", "sarjapura"],
        "also_include": [],
        "nobroker": True,
    },
    "Hoodi": {
        "coords": [12.9888, 77.7113],
        "radius_km": 2.0,
        "aliases": ["hoodi"],
        "also_include": [],
        "nobroker": True,
    },
    "Jayanagar": {
        "coords": [12.9299, 77.5820],
        "radius_km": 2.5,
        "aliases": ["jayanagar", "jaya nagar"],
        "also_include": [],
        "nobroker": True,
    },
    "Bannerghatta": {
        "coords": [12.8634, 77.5855],
        "radius_km": 3.0,
        "aliases": ["bannerghatta", "bannerghatta road", "bgr"],
        "also_include": [],
        "nobroker": True,
    },
    "Cunningham Road": {
        "coords": [12.9812, 77.5958],
        "radius_km": 2.0,
        "aliases": ["cunningham road", "cunningham"],
        "also_include": [],
    },
    "MG Road": {
        "coords": [12.9756, 77.6099],
        "radius_km": 2.0,
        "aliases": ["mg road", "mahatma gandhi road"],
        "also_include": [],
    },
    "Frazer Town": {
        "coords": [12.9854, 77.6146],
        "radius_km": 2.0,
        "aliases": ["frazer town", "fraser town", "frazier town"],
        "also_include": [],
    },
    "Banaswadi": {
        "coords": [13.0109, 77.6553],
        "radius_km": 2.5,
        "aliases": ["banaswadi", "banasvadi"],
        "also_include": [],
        "nobroker": True,
    },
    "KR Puram": {
        "coords": [13.0068, 77.6943],
        "radius_km": 2.5,
        "aliases": ["kr puram", "krishnarajapuram"],
        "also_include": [],
        "nobroker": True,
    },
    "Domlur": {
        "coords": [12.9609, 77.6387],
        "radius_km": 2.0,
        "aliases": ["domlur"],
        "also_include": [],
    },
    "Madiwala": {
        "coords": [12.9196, 77.6182],
        "radius_km": 2.0,
        "aliases": ["madiwala"],
        "also_include": [],
    },
    "Bommanahalli": {
        "coords": [12.8998, 77.6396],
        "radius_km": 2.5,
        "aliases": ["bommanahalli", "bomanhalli"],
        "also_include": [],
        "nobroker": True,
    },
    "Brookefield": {
        "coords": [12.9690, 77.7123],
        "radius_km": 2.0,
        "aliases": ["brookefield", "brookfield", "brook field"],
        "also_include": [],
    },
    "Kadubeesanahalli": {
        "coords": [12.9354, 77.7004],
        "radius_km": 2.0,
        "aliases": ["kadubeesanahalli", "kadabeesanahalli", "kdb halli"],
        "also_include": [],
    },
    "Panathur": {
        "coords": [12.9344, 77.7127],
        "radius_km": 2.0,
        "aliases": ["panathur"],
        "also_include": [],
    },
    "Varthur": {
        "coords": [12.9352, 77.7489],
        "radius_km": 2.5,
        "aliases": ["varthur"],
        "also_include": [],
    },
    "Thubarahalli": {
        "coords": [12.9572, 77.7225],
        "radius_km": 2.0,
        "aliases": ["thubarahalli", "tubrahalli"],
        "also_include": [],
    },
    "Kadugodi": {
        "coords": [12.9775, 77.7593],
        "radius_km": 2.0,
        "aliases": ["kadugodi"],
        "also_include": [],
    },
    "JP Nagar": {
        "coords": [12.9077, 77.5851],
        "radius_km": 2.5,
        "aliases": ["jp nagar", "j p nagar", "jayaprakash nagar"],
        "also_include": [],
        "nobroker": True,
    },
    "Banashankari": {
        "coords": [12.9259, 77.5468],
        "radius_km": 2.5,
        "aliases": ["banashankari", "bsk", "banashankri"],
        "also_include": [],
        "nobroker": True,
    },
    "Rajajinagar": {
        "coords": [12.9899, 77.5530],
        "radius_km": 2.5,
        "aliases": ["rajajinagar", "rajaji nagar"],
        "also_include": [],
        "nobroker": True,
    },
    "Malleshwaram": {
        "coords": [13.0035, 77.5687],
        "radius_km": 2.5,
        "aliases": ["malleshwaram", "malleswaram", "malleshwarm"],
        "also_include": [],
        "nobroker": True,
    },
    "Yeshwanthpur": {
        "coords": [13.0265, 77.5449],
        "radius_km": 2.5,
        "aliases": ["yeshwanthpur", "yeshwantpur", "yeshvanthpur"],
        "also_include": [],
        "nobroker": True,
    },
    "Nagawara": {
        "coords": [13.0435, 77.6202],
        "radius_km": 2.5,
        "aliases": ["nagawara", "nagavara"],
        "also_include": [],
    },
    "HBR Layout": {
        "coords": [13.0277, 77.6384],
        "radius_km": 2.5,
        "aliases": ["hbr layout", "hbr"],
        "also_include": [],
        "nobroker": True,
    },
    "CV Raman Nagar": {
        "coords": [12.9848, 77.6618],
        "radius_km": 2.0,
        "aliases": ["cv raman nagar", "cv raman"],
        "also_include": [],
    },
    "Old Airport Road": {
        "coords": [12.9592, 77.6484],
        "radius_km": 2.0,
        "aliases": ["old airport road", "oar"],
        "also_include": [],
    },
    # Areas that appear in text but aren't primary search targets
    "ITPL": {
        "coords": [12.9854, 77.7308],
        "radius_km": 2.0,
        "aliases": ["itpl", "international tech park"],
        "also_include": [],
    },
    "Manyata": {
        "coords": [13.0467, 77.6210],
        "radius_km": 2.0,
        "aliases": ["manyata", "manyata tech park"],
        "also_include": [],
    },
    "Thanisandra": {
        "coords": [13.0590, 77.6350],
        "radius_km": 2.0,
        "aliases": ["thanisandra", "thanisandhra"],
        "also_include": [],
    },
    "Hennur": {
        "coords": [13.0440, 77.6480],
        "radius_km": 2.5,
        "aliases": ["hennur", "hennur road"],
        "also_include": [],
    },
    "Kalyan Nagar": {
        "coords": [13.0254, 77.6400],
        "radius_km": 2.0,
        "aliases": ["kalyan nagar", "kalyannagar"],
        "also_include": [],
    },
    "RT Nagar": {
        "coords": [13.0210, 77.5970],
        "radius_km": 2.0,
        "aliases": ["rt nagar", "r t nagar"],
        "also_include": [],
    },
    "Ejipura": {
        "coords": [12.9420, 77.6220],
        "radius_km": 1.5,
        "aliases": ["ejipura"],
        "also_include": [],
    },
    "Ulsoor": {
        "coords": [12.9810, 77.6200],
        "radius_km": 1.5,
        "aliases": ["ulsoor", "halasuru"],
        "also_include": [],
    },
    "Basavanagudi": {
        "coords": [12.9420, 77.5730],
        "radius_km": 2.0,
        "aliases": ["basavanagudi", "basavangudi"],
        "also_include": [],
    },
    "Sadashivanagar": {
        "coords": [13.0060, 77.5810],
        "radius_km": 2.0,
        "aliases": ["sadashivanagar", "sadashiva nagar"],
        "also_include": [],
    },
    "Vijayanagar": {
        "coords": [12.9710, 77.5330],
        "radius_km": 2.0,
        "aliases": ["vijayanagar", "vijaya nagar"],
        "also_include": [],
    },
    "Kengeri": {
        "coords": [12.9070, 77.4850],
        "radius_km": 3.0,
        "aliases": ["kengeri"],
        "also_include": [],
    },
}


# ─────────────────────────────────────────────
# Auto-generated lookup structures
# ─────────────────────────────────────────────

def _build_alias_map():
    """Build alias → canonical name mapping from LOCALITY_META."""
    aliases = {}
    for canonical, meta in LOCALITY_META.items():
        aliases[canonical.lower()] = canonical
        for alias in meta.get("aliases", []):
            aliases[alias.lower()] = canonical
    return aliases


LOCALITY_ALIASES = _build_alias_map()

# Sorted by name length descending for longest-match-first extraction
_SORTED_NAMES = sorted(LOCALITY_META.keys(), key=len, reverse=True)

# Flat list of all canonical names (for frontend compatibility)
ALL_LOCALITY_NAMES = sorted(LOCALITY_META.keys())

# Coords dict {name: [lat, lon]} for frontend/map use
LOCALITY_COORDS = {
    name: meta["coords"] for name, meta in LOCALITY_META.items()
}


# ─────────────────────────────────────────────
# Locality functions
# ─────────────────────────────────────────────

def normalize_locality(raw: str):
    """
    Map user input to a canonical locality name.
    Returns the canonical name or None if not recognized.
    """
    if not raw:
        return None
    return LOCALITY_ALIASES.get(raw.strip().lower())


def extract_locality(text: str):
    """
    Scan text (title + body) and return the first matching canonical locality.
    Uses longest-match-first to prefer 'HSR Layout' over 'HSR'.
    """
    if not text:
        return None
    lower = text.lower()
    for name in _SORTED_NAMES:
        if name.lower() in lower:
            return name
    # Also check aliases that don't match a canonical name directly
    for alias, canonical in sorted(LOCALITY_ALIASES.items(), key=lambda x: len(x[0]), reverse=True):
        if alias in lower:
            return canonical
    return None


def haversine_km(lat1, lon1, lat2, lon2):
    """Distance in km between two lat/lon points."""
    R = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def expand_locality(area: str):
    """
    Given user input, return all canonical locality names to search for.

    - If the input matches a known locality, return it plus all localities
      within its radius_km, plus any manual also_include entries.
    - If not recognized, return [area] as-is for keyword fallback.
    """
    canonical = normalize_locality(area)
    if not canonical:
        return []

    meta = LOCALITY_META.get(canonical)
    if not meta:
        return [canonical]

    center = meta["coords"]
    radius = meta["radius_km"]

    nearby = []
    for name, m in LOCALITY_META.items():
        dist = haversine_km(center[0], center[1], m["coords"][0], m["coords"][1])
        if dist <= radius:
            nearby.append(name)

    for extra in meta.get("also_include", []):
        if extra not in nearby:
            nearby.append(extra)

    return nearby


def get_nobroker_localities():
    """
    Return the list of localities marked for NoBroker ingestion,
    in the format expected by nobroker.py (name, lat, lon).
    """
    result = []
    for name, meta in LOCALITY_META.items():
        if meta.get("nobroker"):
            result.append({
                "name": name,
                "lat": meta["coords"][0],
                "lon": meta["coords"][1],
            })
    return result


def get_all_locality_names_lower():
    """Return a set of all known names and aliases in lowercase for scoring."""
    return set(LOCALITY_ALIASES.keys())


def get_locality_api_data():
    """Return locality data for the /api/localities endpoint."""
    result = {}
    for name, meta in LOCALITY_META.items():
        result[name] = {
            "coords": meta["coords"],
            "radius_km": meta["radius_km"],
            "aliases": meta.get("aliases", []),
        }
    return result
