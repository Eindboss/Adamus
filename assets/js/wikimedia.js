/* ===========================================
   Adamus - Wikimedia Image Fetcher (v4)

   Search strategy: Query-ladder with context-aware scoring
   1. Try specific queries first (concept + representation)
   2. Progressively relax to broader queries
   3. Score candidates with 3-layer system:
      - Representation fit (diagram vs photo)
      - Educational quality (labels, categories)
      - Domain/chapter fit (muscles, joints, etc.)
   =========================================== */

const LS_KEY = "mediaCache:v4";

// ============================================
// DOMAIN PROFILES - Subject-agnostic priors
// Works for biology, geography, history, etc.
// ============================================
const CHAPTER_PROFILES = {
  // === BIOLOGY DOMAINS ===
  skeleton: {
    prefer: ["diagram", "labelled", "labeled", "anatomy", "skeleton", "bone", "cross-section"],
    avoid: ["dinosaur", "museum", "fossil", "statue", "archaeological"],
    preferCategories: ["Diagrams", "Anatomy", "Human skeleton", "Bones"],
    avoidCategories: ["Logos", "Advertisements", "Fossils"]
  },
  joints: {
    prefer: ["diagram", "labelled", "cross-section", "synovial", "articular", "joint"],
    avoid: ["x-ray", "radiograph", "MRI", "CT", "surgery", "arthritis"],
    preferCategories: ["Diagrams", "Anatomy", "Joints"],
    avoidCategories: ["Medical imaging", "X-rays"]
  },
  muscles: {
    prefer: ["diagram", "labelled", "anatomy", "muscle", "flexion", "extension", "antagonist"],
    avoid: ["bodybuilder", "bodybuilding", "fitness", "competition", "mr. olympia", "gym"],
    preferCategories: ["Diagrams", "Anatomy", "Muscles"],
    avoidCategories: ["Bodybuilding", "Fitness models"]
  },
  health: {
    prefer: ["diagram", "ergonomic", "posture", "workstation", "exercise", "stretching"],
    avoid: ["catalog", "advertisement", "product", "brand", "furniture", "store"],
    preferCategories: ["Diagrams", "Educational", "Ergonomics"],
    avoidCategories: ["Advertisements", "Products", "Promotional"]
  },
  animals: {
    prefer: ["wildlife", "nature", "animal", "species", "habitat"],
    avoid: ["cartoon", "logo", "mascot", "toy", "plush", "zoo"],
    preferCategories: ["Animals", "Wildlife", "Nature"],
    avoidCategories: ["Logos", "Cartoons", "Toys", "Zoos"]
  },
  plants: {
    prefer: ["plant", "botanical", "flower", "leaf", "diagram", "cross-section"],
    avoid: ["garden", "nursery", "store", "product"],
    preferCategories: ["Plants", "Botany", "Botanical illustrations"],
    avoidCategories: ["Advertisements", "Gardens"]
  },
  cells: {
    prefer: ["cell", "microscope", "micrograph", "diagram", "organelle"],
    avoid: ["prison", "battery", "phone"],
    preferCategories: ["Cell biology", "Microscopy", "Diagrams"],
    avoidCategories: ["Technology", "Prisons"]
  },

  // === GEOGRAPHY DOMAINS ===
  maps: {
    prefer: ["map", "topographic", "geographic", "atlas", "relief"],
    avoid: ["game", "fantasy", "fictional"],
    preferCategories: ["Maps", "Geography", "Cartography"],
    avoidCategories: ["Video games", "Fantasy"]
  },
  climate: {
    prefer: ["climate", "weather", "diagram", "chart", "graph"],
    avoid: ["news", "forecast", "app"],
    preferCategories: ["Climatology", "Meteorology", "Diagrams"],
    avoidCategories: ["Weather forecasts", "Apps"]
  },
  landscape: {
    prefer: ["landscape", "terrain", "nature", "geographic"],
    avoid: ["painting", "art", "wallpaper"],
    preferCategories: ["Landscapes", "Geography", "Physical geography"],
    avoidCategories: ["Paintings", "Art"]
  },

  // === HISTORY DOMAINS ===
  historical: {
    prefer: ["historical", "century", "era", "period", "artifact"],
    avoid: ["reenactment", "costume", "movie", "film"],
    preferCategories: ["History", "Historical images", "Artifacts"],
    avoidCategories: ["Movies", "Reenactments"]
  },
  archaeology: {
    prefer: ["archaeological", "excavation", "artifact", "ruins"],
    avoid: ["movie", "game", "indiana jones"],
    preferCategories: ["Archaeology", "Artifacts", "Excavations"],
    avoidCategories: ["Movies", "Video games"]
  },

  // === SCIENCE DOMAINS ===
  chemistry: {
    prefer: ["molecule", "chemical", "structure", "diagram", "reaction"],
    avoid: ["lab coat", "stock photo", "business"],
    preferCategories: ["Chemistry", "Molecules", "Chemical structures"],
    avoidCategories: ["Stock photos", "Advertisements"]
  },
  physics: {
    prefer: ["physics", "diagram", "force", "wave", "experiment"],
    avoid: ["stock photo", "business"],
    preferCategories: ["Physics", "Diagrams", "Experiments"],
    avoidCategories: ["Stock photos"]
  },

  // === SPECIAL ===
  penguins: {
    prefer: ["penguin", "spheniscidae", "flipper", "skeleton", "anatomy"],
    avoid: ["cartoon", "logo", "mascot", "toy", "plush"],
    preferCategories: ["Penguins", "Bird anatomy"],
    avoidCategories: ["Logos", "Cartoons", "Toys"]
  }
};

// Default profile for unknown domains
const DEFAULT_PROFILE = {
  prefer: ["diagram", "labelled", "labeled", "anatomy", "educational"],
  avoid: ["logo", "icon", "cartoon", "advertisement", "catalog"],
  preferCategories: ["Diagrams", "Educational", "Anatomy"],
  avoidCategories: ["Logos", "Advertisements"]
};
const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

// Wikidata SPARQL endpoint
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

// Commons API
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

function readCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors
  }
}

function normalizeQuery(q) {
  return q.trim().replace(/\s+/g, " ");
}

function cacheKey(query, optsKey = "") {
  return (normalizeQuery(query).toLowerCase() + "::" + optsKey).trim();
}

function isFresh(entry, ttl) {
  return Date.now() - entry.ts < ttl;
}

/** Basic helpers */
function containsAny(haystack, needles = []) {
  const h = (haystack || "").toLowerCase();
  return needles.some(n => h.includes(String(n).toLowerCase()));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Detect domain from query or intent
 * Works across all subjects (biology, geography, history, etc.)
 */
function detectDomain(query, intent = {}) {
  const q = (query || "").toLowerCase();
  const concept = (intent.primaryConcept || "").toLowerCase();
  const combined = q + " " + concept;

  // === BIOLOGY ===
  if (containsAny(combined, ["penguin", "pinguïn", "spheniscidae", "flipper"])) return "penguins";
  if (containsAny(combined, ["rsi", "ergonomic", "posture", "workstation", "warming-up", "cooling-down", "stretching", "blessure"])) return "health";
  if (containsAny(combined, ["muscle", "spier", "biceps", "triceps", "antagonist", "flexion", "extension", "pees", "tendon", "contraction"])) return "muscles";
  if (containsAny(combined, ["joint", "gewricht", "synovial", "capsule", "ligament", "articular", "cartilage", "kraakbeen"])) return "joints";
  if (containsAny(combined, ["skeleton", "skelet", "bone", "bot", "skull", "schedel", "rib", "sternum", "vertebra", "osteon", "haversian"])) return "skeleton";
  if (containsAny(combined, ["cell", "cel", "mitochondri", "nucleus", "organelle", "membrane", "cytoplasm"])) return "cells";
  if (containsAny(combined, ["plant", "flower", "bloem", "leaf", "blad", "root", "wortel", "photosynthesis", "botanical"])) return "plants";
  if (containsAny(combined, ["animal", "dier", "species", "soort", "habitat", "wildlife", "mammal", "zoogdier"])) return "animals";

  // === GEOGRAPHY ===
  if (containsAny(combined, ["map", "kaart", "topograph", "atlas", "cartograph"])) return "maps";
  if (containsAny(combined, ["climate", "klimaat", "weather", "weer", "temperature", "precipitation", "neerslag"])) return "climate";
  if (containsAny(combined, ["landscape", "landschap", "terrain", "mountain", "berg", "river", "rivier", "valley", "dal"])) return "landscape";

  // === HISTORY ===
  if (containsAny(combined, ["archaeological", "excavation", "opgraving", "artifact", "ruins", "ruïne"])) return "archaeology";
  if (containsAny(combined, ["historical", "historisch", "century", "eeuw", "era", "tijdperk", "medieval", "middeleeuws", "ancient", "antiek"])) return "historical";

  // === SCIENCE ===
  if (containsAny(combined, ["molecule", "molecuul", "chemical", "chemisch", "reaction", "reactie", "atom", "atoom", "element"])) return "chemistry";
  if (containsAny(combined, ["physics", "fysica", "force", "kracht", "wave", "golf", "energy", "energie", "velocity", "snelheid"])) return "physics";

  return null; // Use default
}

/**
 * Get chapter profile for a domain
 */
function getProfile(domain) {
  return CHAPTER_PROFILES[domain] || DEFAULT_PROFILE;
}

/**
 * Generate query ladder - from specific to broad
 * Returns array of { query, weight } objects
 */
function generateQueryLadder(baseQuery, { representation = "diagram", concepts = [] } = {}) {
  const ladder = [];
  const q = normalizeQuery(baseQuery);

  // Extract core concept (first significant words)
  const words = q.split(/\s+/).filter(w => w.length >= 3);
  const coreWords = words.slice(0, 3).join(" ");
  const firstTwoWords = words.slice(0, 2).join(" ");

  // Representation keywords to try
  const repKeywords = {
    "diagram": ["labelled diagram", "diagram", "anatomy"],
    "photo": ["photo", ""],
    "microscopy": ["micrograph", "histology", "microscope"],
    "cross-section": ["cross-section", "cross section", "section"]
  };
  const repWords = repKeywords[representation] || repKeywords["diagram"];

  // Level 1: Most specific - full query + representation
  ladder.push({ query: `${q} ${repWords[0]}`.trim(), weight: 1.0 });

  // Level 2: Full query + simpler representation
  if (repWords[1]) {
    ladder.push({ query: `${q} ${repWords[1]}`.trim(), weight: 0.9 });
  }

  // Level 3: Core words + representation
  if (coreWords !== q) {
    ladder.push({ query: `${coreWords} ${repWords[0]}`.trim(), weight: 0.8 });
  }

  // Level 4: Core words only (high recall)
  ladder.push({ query: coreWords, weight: 0.7 });

  // Level 5: First two words + anatomy (very broad)
  if (firstTwoWords !== coreWords) {
    ladder.push({ query: `${firstTwoWords} anatomy`, weight: 0.6 });
  }

  // Level 6: Just first two words (last resort)
  ladder.push({ query: firstTwoWords, weight: 0.5 });

  // Add concept-based queries if provided
  for (const concept of concepts.slice(0, 2)) {
    ladder.push({ query: `${concept} ${repWords[0]}`.trim(), weight: 0.75 });
  }

  // Deduplicate
  const seen = new Set();
  return ladder.filter(item => {
    const key = item.query.toLowerCase();
    if (seen.has(key) || key.length < 5) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build a Special:FilePath URL with width param
 */
function commonsFilePathUrl(fileTitle, width = 900) {
  const name = fileTitle.replace(/^File:/i, "");
  const encoded = encodeURIComponent(name).replace(/%2F/g, "/");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${width}`;
}

/**
 * Score candidate file - 3-LAYER SCORING SYSTEM
 *
 * Layer 1: Representation fit (diagram vs photo vs microscopy)
 * Layer 2: Educational quality (labels, diagrams, categories)
 * Layer 3: Domain/chapter fit (muscles, joints, skeleton, etc.)
 *
 * @param {object} candidate - File info
 * @param {string} query - Search query
 * @param {object} opts - Scoring options
 */
function scoreCandidate(
  { title, categories = [], mime, width, height, depictsMatch = false },
  query,
  {
    negativeTerms = [],
    domain = null,
    representation = "diagram",
    queryWeight = 1.0
  } = {}
) {
  const t = (title || "").toLowerCase();
  const q = (query || "").toLowerCase();
  const catText = categories.join(" ").toLowerCase();
  const profile = getProfile(domain);

  let layer1 = 0; // Representation fit
  let layer2 = 0; // Educational quality
  let layer3 = 0; // Domain fit

  // ============================================
  // LAYER 1: Representation Fit (-30 to +30)
  // ============================================
  const repScores = {
    diagram: {
      positive: ["diagram", "labelled", "labeled", "schema", "illustration", "schematic", "anatomy"],
      negative: ["photo", "photograph", "statue", "museum"]
    },
    photo: {
      positive: ["photo", "photograph", "wildlife"],
      negative: ["diagram", "illustration", "schematic"]
    },
    microscopy: {
      positive: ["micrograph", "histology", "microscope", "microscopy", "histological", "section"],
      negative: ["diagram", "illustration"]
    },
    "cross-section": {
      positive: ["cross-section", "cross section", "section", "cutaway", "diagram"],
      negative: ["photo", "photograph"]
    }
  };

  const repConfig = repScores[representation] || repScores.diagram;

  // Count positive representation matches
  for (const term of repConfig.positive) {
    if (t.includes(term)) layer1 += 10;
    if (catText.includes(term)) layer1 += 5;
  }
  // Penalize wrong representation
  for (const term of repConfig.negative) {
    if (t.includes(term)) layer1 -= 10;
  }
  layer1 = clamp(layer1, -30, 30);

  // ============================================
  // LAYER 2: Educational Quality (-40 to +60)
  // ============================================

  // Depicts match is semantic quality indicator
  if (depictsMatch) layer2 += 40;

  // Educational category bonuses
  const educationalCategories = ["educational", "diagrams", "anatomy", "biology", "histology", "physiology"];
  for (const cat of educationalCategories) {
    if (catText.includes(cat)) layer2 += 5;
  }

  // Query token match in title/categories
  const tokens = q.split(/\s+/).filter(tok => tok.length >= 3);
  for (const tok of tokens) {
    if (t.includes(tok)) layer2 += 6;
    if (catText.includes(tok)) layer2 += 3;
  }

  // Penalize junk patterns heavily
  if (containsAny(t, ["logo", "icon", "pictogram", "flag", "coat_of_arms", "stub"])) layer2 -= 40;
  if (containsAny(t, ["map", "locator", "blank_map", "location"])) layer2 -= 30;
  if (containsAny(t, ["book", "cover", "page", "screenshot"])) layer2 -= 35;
  if (containsAny(catText, ["logos", "advertisements", "products"])) layer2 -= 30;

  // Image quality bonus (larger = better)
  if (width && height) {
    const megapixels = (width * height) / 1_000_000;
    layer2 += clamp(megapixels * 2, 0, 10);
  }

  // SVG penalty for LMS compatibility
  if ((mime || "").includes("svg")) layer2 -= 5;

  layer2 = clamp(layer2, -40, 60);

  // ============================================
  // LAYER 3: Domain/Chapter Fit (-30 to +30)
  // ============================================

  // Domain-specific preferences from profile
  for (const term of profile.prefer) {
    if (t.includes(term)) layer3 += 8;
    if (catText.includes(term)) layer3 += 4;
  }

  // Domain-specific avoidances
  for (const term of profile.avoid) {
    if (t.includes(term)) layer3 -= 15;
    if (catText.includes(term)) layer3 -= 10;
  }

  // Category-level domain fit
  for (const cat of profile.preferCategories) {
    if (catText.includes(cat.toLowerCase())) layer3 += 6;
  }
  for (const cat of profile.avoidCategories) {
    if (catText.includes(cat.toLowerCase())) layer3 -= 12;
  }

  // User-specified negative terms (highest priority)
  if (containsAny(t, negativeTerms) || containsAny(catText, negativeTerms)) {
    layer3 -= 50;
  }

  layer3 = clamp(layer3, -50, 30);

  // ============================================
  // FINAL SCORE
  // ============================================
  // Weight by query specificity (specific queries = higher weight)
  const baseScore = layer1 + layer2 + layer3;
  const finalScore = baseScore * queryWeight;

  return Math.round(finalScore);
}

/**
 * SPARQL query to find Commons files that depict a Wikidata entity
 * Uses the Structured Data on Commons (SDC) "depicts" property (P180)
 */
async function sparqlDepictsSearch(qids, { limit = 20, minWidth = 600 } = {}) {
  if (!qids || qids.length === 0) return [];

  // Build VALUES clause for multiple QIDs
  const qidValues = qids.map(q => `wd:${q}`).join(" ");

  // SPARQL query that finds Commons files depicting these entities
  const sparql = `
    SELECT DISTINCT ?file ?fileLabel ?width ?height ?mime WHERE {
      # Find files on Commons that depict any of our target entities
      ?file wdt:P180 ?depicts .
      VALUES ?depicts { ${qidValues} }

      # Get file metadata
      ?file schema:contentUrl ?url .

      # Get dimensions (optional but preferred)
      OPTIONAL { ?file wdt:P2049 ?width . }
      OPTIONAL { ?file wdt:P2048 ?height . }
      OPTIONAL { ?file wdt:P1163 ?mime . }

      # Filter: must be an image file
      FILTER(CONTAINS(STR(?file), "commons.wikimedia.org"))

      # Filter: prefer larger images
      FILTER(!BOUND(?width) || ?width >= ${minWidth})

      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,nl,de" . }
    }
    LIMIT ${limit}
  `;

  try {
    const res = await fetch(SPARQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/sparql-results+json",
        "User-Agent": "Adamus-Quiz/1.0 (https://github.com/Eindboss/Adamus)"
      },
      body: `query=${encodeURIComponent(sparql)}`
    });

    if (!res.ok) {
      console.warn(`SPARQL query failed: ${res.status}`);
      return [];
    }

    const json = await res.json();
    const results = json?.results?.bindings || [];

    return results.map(r => {
      // Extract filename from Commons URL
      const fileUrl = r.file?.value || "";
      const match = fileUrl.match(/\/entity\/(M\d+)$/);
      const mid = match ? match[1] : null;

      return {
        mid,
        fileUrl,
        label: r.fileLabel?.value || "",
        width: parseInt(r.width?.value) || 0,
        height: parseInt(r.height?.value) || 0,
        mime: r.mime?.value || "",
        depictsMatch: true
      };
    }).filter(r => r.mid);
  } catch (e) {
    console.warn("SPARQL depicts search failed:", e);
    return [];
  }
}

/**
 * Get Commons file info from M-id (media id)
 */
async function getCommonsFileFromMid(mid) {
  const url = `${COMMONS_API}?` + new URLSearchParams({
    action: "query",
    pageids: mid.replace("M", ""),
    prop: "imageinfo|categories",
    iiprop: "url|size|mime",
    iiurlwidth: "1200",
    cllimit: "10",
    format: "json",
    origin: "*"
  });

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const page = Object.values(json?.query?.pages || {})[0];
    if (!page || page.missing) return null;

    const ii = page.imageinfo?.[0];
    return {
      title: page.title,
      mime: ii?.mime || "",
      width: ii?.width || 0,
      height: ii?.height || 0,
      thumbUrl: ii?.thumburl || ii?.url,
      fileUrl: ii?.url,
      categories: (page.categories || []).map(c => c.title.replace(/^Category:/, ""))
    };
  } catch {
    return null;
  }
}

/**
 * Combined search: depicts + text query for better precision
 * The depicts-only search often returns unrelated images, so we combine it with text filtering
 */
async function commonsStructuredDataSearch(qids, { limit = 15, minWidth = 600, negativeTerms = [], textQuery = "" } = {}) {
  if (!qids || qids.length === 0) return { candidates: [] };

  // Combine depicts statement with text query for better precision
  // This ensures we get images that both depict the concept AND match our search terms
  const depicts = qids.map(q => `P180=${q}`).join("|");
  let searchQuery = `haswbstatement:${depicts}`;

  // Add text query to filter results (critical for precision)
  if (textQuery) {
    // Extract key terms from text query (skip common words)
    const skipWords = new Set(["the", "a", "an", "of", "in", "on", "at", "to", "for", "with", "and", "or", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can", "need", "dare", "ought", "used", "human", "anatomy", "diagram", "photo", "image"]);
    const keyTerms = textQuery.toLowerCase()
      .split(/\s+/)
      .filter(t => t.length >= 3 && !skipWords.has(t))
      .slice(0, 3); // Use top 3 key terms

    if (keyTerms.length > 0) {
      searchQuery = `${keyTerms.join(" ")} ${searchQuery}`;
    }
  }

  const url = `${COMMONS_API}?` + new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: searchQuery,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo|categories",
    iiprop: "url|size|mime",
    iiurlwidth: "1200",
    cllimit: "10",
    format: "json",
    origin: "*"
  });

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Commons SDC search failed: ${res.status}`);
    const json = await res.json();

    const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
    const candidates = [];

    for (const p of pages) {
      const title = p?.title;
      const ii = p?.imageinfo?.[0];
      if (!title || !ii) continue;

      const mime = ii.mime || "";
      const width = ii.width || 0;
      const height = ii.height || 0;

      // Hard filters
      if (width < minWidth) continue;

      const categories = (p?.categories || []).map(c => c.title.replace(/^Category:/, ""));
      const lowerTitle = title.toLowerCase();

      // Filter junk - be more aggressive
      if (containsAny(lowerTitle, ["logo", "icon", "pictogram", "flag", "coat_of_arms"])) continue;
      if (containsAny(lowerTitle, ["location", "locator", "map of", "blank map"])) continue;

      // Filter non-image files (including animated GIFs)
      if (mime.includes("pdf") || mime.includes("djvu") || mime.includes("ogg") || mime.includes("webm") || mime.includes("gif")) continue;

      candidates.push({
        title,
        mime,
        width,
        height,
        thumbUrl: ii.thumburl || ii.url,
        fileUrl: ii.url,
        categories,
        depictsMatch: true,
        score: 0 // Will be re-scored with full context in getMediaForQuery
      });
    }

    // No pre-sorting - will be re-scored with full context
    return { candidates };
  } catch (e) {
    console.warn("Commons SDC search failed:", e);
    return { candidates: [] };
  }
}

/**
 * Commons text search (fallback)
 */
async function commonsTextSearch(query, {
  limit = 15,
  minWidth = 600,
  allowSvg = true,
  negativeTerms = [],
} = {}) {
  const q = normalizeQuery(query)
    .replace(/^wikimedia:\s*/i, "")
    .replace(/^wikipedia:\s*/i, "")
    .replace(/\+/g, " ");

  // Add filetype filter for images
  const searchUrl = `${COMMONS_API}?` + new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${q} filetype:bitmap|drawing`, // Prefer actual images
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo|categories",
    iiprop: "url|size|mime",
    iiurlwidth: "1200",
    cllimit: "20",
    format: "json",
    origin: "*"
  });

  const res = await fetch(searchUrl);
  if (!res.ok) throw new Error(`Commons search failed: ${res.status}`);
  const json = await res.json();

  const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
  const candidates = [];

  for (const p of pages) {
    const title = p?.title;
    const ii = p?.imageinfo?.[0];
    if (!title || !ii) continue;

    const mime = ii.mime || "";
    const width = ii.width || 0;
    const height = ii.height || 0;

    if (width < minWidth) continue;
    if (!allowSvg && mime.includes("svg")) continue;

    // Filter non-image files (including animated GIFs)
    if (mime.includes("pdf") || mime.includes("djvu") || mime.includes("ogg") || mime.includes("webm") || mime.includes("gif")) continue;

    const categories = (p?.categories || []).map(c => c.title.replace(/^Category:/, ""));
    const lowerTitle = title.toLowerCase();

    // Filter junk - be aggressive
    if (containsAny(lowerTitle, ["logo", "icon", "pictogram", "flag", "coat_of_arms"])) continue;
    if (containsAny(lowerTitle, ["location", "locator", "map of", "blank map"])) continue;
    if (containsAny(lowerTitle, ["book cover", "screenshot", "stub"])) continue;

    candidates.push({
      title,
      mime,
      width,
      height,
      thumbUrl: ii.thumburl || ii.url,
      fileUrl: ii.url,
      categories,
      depictsMatch: false,
      score: 0 // Will be re-scored with full context in getMediaForQuery
    });
  }

  // No pre-sorting - will be re-scored with full context
  return { normalizedQuery: q, candidates };
}

/**
 * Wikipedia fallback (last resort)
 */
async function wikipediaFallback(query, { lang = "en" } = {}) {
  const q = normalizeQuery(query)
    .replace(/^wikimedia:\s*/i, "")
    .replace(/^wikipedia:\s*/i, "")
    .replace(/\+/g, " ");

  const searchUrl = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: q,
    srlimit: "5",
    format: "json",
    origin: "*"
  });

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) throw new Error(`Wikipedia search failed: ${searchRes.status}`);
  const searchJson = await searchRes.json();
  const top = searchJson?.query?.search?.[0];
  if (!top?.title) throw new Error(`No page found for query: ${q}`);

  const pageUrl = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
    action: "query",
    prop: "pageimages|info",
    inprop: "url",
    titles: top.title,
    pithumbsize: "900",
    format: "json",
    origin: "*"
  });

  const pageRes = await fetch(pageUrl);
  if (!pageRes.ok) throw new Error(`Wikipedia page fetch failed: ${pageRes.status}`);
  const pageJson = await pageRes.json();

  const pages = pageJson?.query?.pages;
  const page = pages ? pages[Object.keys(pages)[0]] : null;

  const thumb = page?.thumbnail?.source;
  const fullPageUrl = page?.fullurl;

  if (!thumb || !fullPageUrl) throw new Error(`No thumbnail/fullurl for: ${top.title}`);

  return {
    imageUrl: thumb,
    pageUrl: fullPageUrl,
    title: top.title,
    source: "wikipedia"
  };
}

/**
 * Prune cache to max entries
 */
function pruneCache(cache, maxEntries = 200) {
  const entries = Object.entries(cache);
  if (entries.length > maxEntries) {
    entries
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, entries.length - maxEntries)
      .forEach(([k]) => delete cache[k]);
  }
}

/**
 * Main entry point: Query-ladder with early stopping
 *
 * Strategy:
 * 1. Detect domain from query/intent
 * 2. Generate query ladder (specific → broad)
 * 3. Try each query level, score candidates with 3-layer system
 * 4. Stop early if good candidate found (score >= threshold)
 * 5. Fall back to Wikipedia if nothing found
 *
 * @param {string} query - Text search query
 * @param {object} opts - Options including:
 *   - qids: Array of Wikidata QIDs to search via depicts
 *   - negativeTerms: Terms to avoid
 *   - intent: Media intent object { primaryConcept, representation, ... }
 *   - usedFileTitles: Set to track uniqueness
 *   - minWidth, width, lang, allowSvg, ttlMs
 */
export async function getMediaForQuery(query, opts = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL;
  const lang = opts.lang ?? "en";
  const minWidth = opts.minWidth ?? 600;
  const allowSvg = opts.allowSvg ?? true;
  const width = opts.width ?? 900;
  const negativeTerms = opts.negativeTerms ?? [];
  const qids = opts.qids ?? [];
  const usedFileTitles = opts.usedFileTitles ?? null;
  const intent = opts.intent ?? {};

  // Detect domain for context-aware scoring
  const domain = detectDomain(query, intent);
  const representation = intent.representation || "diagram";

  const optsKey = JSON.stringify({ lang, minWidth, allowSvg, width, negativeTerms, qids, domain });
  const key = cacheKey(query, optsKey);

  const cache = readCache();
  const hit = cache[key];
  if (hit && isFresh(hit, ttlMs)) {
    if (!usedFileTitles || !hit.result?.commonsFileTitle || !usedFileTitles.has(hit.result.commonsFileTitle)) {
      return hit.result;
    }
  }

  // Generate query ladder
  const concepts = intent.primaryConcept ? [intent.primaryConcept] : [];
  const ladder = generateQueryLadder(query, { representation, concepts });

  console.log(`[wikimedia] Domain: ${domain || "default"}, representation: ${representation}`);
  console.log(`[wikimedia] Query ladder:`, ladder.map(l => `"${l.query}" (w=${l.weight})`).join(" → "));

  let allCandidates = [];
  const GOOD_SCORE_THRESHOLD = 40; // Stop early if we find something this good

  // Scoring options for all candidates
  const scoreOpts = { negativeTerms, domain, representation };

  // 1) TRY QUERY LADDER - stop early on good results
  for (const { query: ladderQuery, weight } of ladder) {
    try {
      const { candidates } = await commonsTextSearch(ladderQuery, {
        limit: 15,
        minWidth,
        allowSvg,
        negativeTerms
      });

      // Re-score with full 3-layer scoring
      for (const c of candidates) {
        c.score = scoreCandidate(c, ladderQuery, { ...scoreOpts, queryWeight: weight });
        c.ladderQuery = ladderQuery;
        c.ladderWeight = weight;
      }

      allCandidates.push(...candidates);
      console.log(`[wikimedia] "${ladderQuery}" found ${candidates.length} candidates`);

      // Early stopping: if we found a good unused candidate, stop climbing
      const bestUnused = candidates
        .filter(c => !usedFileTitles || !usedFileTitles.has(c.title))
        .sort((a, b) => b.score - a.score)[0];

      if (bestUnused && bestUnused.score >= GOOD_SCORE_THRESHOLD) {
        console.log(`[wikimedia] Early stop: found good candidate (score=${bestUnused.score})`);
        break;
      }
    } catch (e) {
      console.warn(`Text search failed for "${ladderQuery}":`, e);
    }
  }

  // 2) DEPICTS BOOST: If we have QIDs and not enough good candidates
  const topScore = allCandidates.length > 0 ? Math.max(...allCandidates.map(c => c.score)) : 0;

  if (qids.length > 0 && (allCandidates.length < 5 || topScore < GOOD_SCORE_THRESHOLD)) {
    try {
      const { candidates } = await commonsStructuredDataSearch(qids, {
        limit: 10,
        minWidth,
        negativeTerms,
        textQuery: query
      });

      // Re-score with depicts bonus
      for (const c of candidates) {
        c.score = scoreCandidate(c, query, { ...scoreOpts, queryWeight: 1.0 });
        c.ladderQuery = "depicts:" + qids.join(",");
      }

      allCandidates.push(...candidates);
      console.log(`[wikimedia] Depicts search for ${qids.join(",")} found ${candidates.length} candidates`);
    } catch (e) {
      console.warn("Depicts search failed:", e);
    }
  }

  // Deduplicate by title and re-sort by score
  const seen = new Set();
  allCandidates = allCandidates.filter(c => {
    if (seen.has(c.title)) return false;
    seen.add(c.title);
    return true;
  });
  allCandidates.sort((a, b) => b.score - a.score);

  // Pick best unused candidate
  const chosen = allCandidates.find(c => !usedFileTitles || !usedFileTitles.has(c.title));

  if (chosen) {
    const result = {
      source: chosen.depictsMatch ? "commons-depicts" : "commons-text",
      query: query,
      ladderQuery: chosen.ladderQuery,
      qids: qids,
      domain: domain,
      commonsFileTitle: chosen.title,
      imageUrl: commonsFilePathUrl(chosen.title, width),
      fileUrl: chosen.fileUrl,
      title: chosen.title.replace(/^File:/, ""),
      debug: {
        score: chosen.score,
        ladderWeight: chosen.ladderWeight,
        depictsMatch: chosen.depictsMatch,
        mime: chosen.mime,
        width: chosen.width,
        height: chosen.height
      }
    };

    cache[key] = { ts: Date.now(), query, result };
    pruneCache(cache);
    writeCache(cache);

    if (usedFileTitles) usedFileTitles.add(chosen.title);
    return result;
  }

  // 3) WIKIPEDIA FALLBACK
  console.log(`[wikimedia] Falling back to Wikipedia for "${query}"`);
  const fallback = await wikipediaFallback(query, { lang });
  cache[key] = { ts: Date.now(), query, result: fallback };
  pruneCache(cache);
  writeCache(cache);
  return fallback;
}

/**
 * Load image for a question
 * Supports both media.query (text) and media.qids (Wikidata depicts)
 * Passes _intent to scoring for context-aware selection
 */
export async function loadQuestionImage(question, opts = {}) {
  const media = question.media;
  if (!media?.query && !media?.qids?.length) return null;

  try {
    const negativeTerms = media.negativeTerms ?? opts.negativeTerms ?? [];
    const qids = media.qids ?? [];
    const usedFileTitles = opts.usedFileTitles ?? null;

    // Pass intent for context-aware scoring
    const intent = media._intent ?? {};

    const result = await getMediaForQuery(media.query || qids.join(" "), {
      ...opts,
      qids,
      negativeTerms,
      usedFileTitles,
      intent
    });

    // Write back so UI can use it
    question.image = result.imageUrl;
    question.media = { ...question.media, resolved: result };
    return result.imageUrl;
  } catch (err) {
    console.warn("Failed to load media:", media.query || media.qids, err);
    return null;
  }
}

/**
 * Preload images for multiple questions
 */
export async function preloadQuestionImages(questions, opts = {}) {
  const skipTypes = ["matching", "table_parse", "ratio_table", "data_table", "wiskunde_multi_part"];
  const needsImage = questions.filter(q =>
    (q.media?.query || q.media?.qids?.length) &&
    !q.image &&
    !skipTypes.includes(q.type)
  );

  const usedFileTitles = opts.usedFileTitles ?? new Set();

  const concurrency = 3;
  for (let i = 0; i < needsImage.length; i += concurrency) {
    const batch = needsImage.slice(i, i + concurrency);
    await Promise.all(batch.map(q => loadQuestionImage(q, { ...opts, usedFileTitles })));
  }

  return usedFileTitles;
}
