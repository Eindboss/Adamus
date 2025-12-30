/* ===========================================
   Adamus - Wikimedia Image Fetcher (v3)

   Search priority:
   1. SPARQL depicts (P180) - most precise
   2. Commons text search - fallback
   3. Wikipedia page image - last resort
   =========================================== */

const LS_KEY = "mediaCache:v3";
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
 * Build a Special:FilePath URL with width param
 */
function commonsFilePathUrl(fileTitle, width = 900) {
  const name = fileTitle.replace(/^File:/i, "");
  const encoded = encodeURIComponent(name).replace(/%2F/g, "/");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${width}`;
}

/**
 * Score candidate file title against query
 */
function scoreCandidate({ title, categories = [], mime, width, height, depictsMatch = false }, query, negativeTerms = []) {
  const t = (title || "").toLowerCase();
  const q = (query || "").toLowerCase();

  let score = 0;

  // HUGE bonus for depicts match - this is semantic, not text-based
  if (depictsMatch) score += 100;

  // Positive match: query tokens in title
  const tokens = q.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    if (t.includes(tok)) score += 8;
  }

  // Category boost
  const catText = categories.join(" ").toLowerCase();
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    if (catText.includes(tok)) score += 4;
  }

  // Penalize negatives
  if (containsAny(t, negativeTerms) || containsAny(catText, negativeTerms)) score -= 40;

  // Penalize common junk patterns
  if (containsAny(t, ["logo", "icon", "pictogram", "flag", "coat_of_arms", "stub"])) score -= 30;
  if (containsAny(t, ["map", "locator", "blank_map", "location"])) score -= 20;
  if (containsAny(t, ["book", "cover", "page", "screenshot"])) score -= 25;

  // Prefer diagrams/illustrations for anatomy
  if (containsAny(q, ["anatomy", "diagram", "skeleton", "bone", "joint", "muscle"])) {
    if (containsAny(t, ["diagram", "illustration", "anatomy", "labeled", "schema"])) score += 15;
  }

  // Prefer raster formats for maximum LMS compatibility
  const isSvg = (mime || "").includes("svg");
  if (isSvg) score -= 5; // Less penalty than before, SVGs can be good for diagrams

  // Prefer larger images
  if (width && height) {
    const megapixels = (width * height) / 1_000_000;
    score += clamp(megapixels * 2, 0, 12);
  }

  return score;
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

      // Filter non-image files
      if (mime.includes("pdf") || mime.includes("djvu") || mime.includes("ogg") || mime.includes("webm")) continue;

      candidates.push({
        title,
        mime,
        width,
        height,
        thumbUrl: ii.thumburl || ii.url,
        fileUrl: ii.url,
        categories,
        depictsMatch: true,
        score: scoreCandidate(
          { title, categories, mime, width, height, depictsMatch: true },
          textQuery || qids.join(" "),
          negativeTerms
        )
      });
    }

    candidates.sort((a, b) => b.score - a.score);
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

    // Filter non-image files
    if (mime.includes("pdf") || mime.includes("djvu") || mime.includes("ogg") || mime.includes("webm")) continue;

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
      score: scoreCandidate({ title, categories, mime, width, height, depictsMatch: false }, q, negativeTerms)
    });
  }

  candidates.sort((a, b) => b.score - a.score);
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
 * Main entry point: Depicts-first, then text search, then Wikipedia fallback
 *
 * @param {string} query - Text search query
 * @param {object} opts - Options including:
 *   - qids: Array of Wikidata QIDs to search via depicts (e.g., ["Q12107251"])
 *   - negativeTerms: Terms to avoid
 *   - negativeQids: QIDs to exclude from depicts results
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

  const optsKey = JSON.stringify({ lang, minWidth, allowSvg, width, negativeTerms, qids });
  const key = cacheKey(query, optsKey);

  const cache = readCache();
  const hit = cache[key];
  if (hit && isFresh(hit, ttlMs)) {
    if (!usedFileTitles || !hit.result?.commonsFileTitle || !usedFileTitles.has(hit.result.commonsFileTitle)) {
      return hit.result;
    }
  }

  let allCandidates = [];

  // 1) TEXT SEARCH FIRST: This is more reliable
  try {
    const { candidates } = await commonsTextSearch(query, {
      limit: 20,
      minWidth,
      allowSvg,
      negativeTerms
    });
    allCandidates.push(...candidates);
    console.log(`[wikimedia] Text search for "${query}" found ${candidates.length} candidates`);
  } catch (e) {
    console.warn("Text search failed:", e);
  }

  // 2) DEPICTS BOOST: If we have QIDs, try to find depicts-tagged images too
  // These get a bonus in scoring but the depicts-only search is often empty
  if (qids.length > 0 && allCandidates.length < 5) {
    try {
      // Try depicts-only search as supplement
      const { candidates } = await commonsStructuredDataSearch(qids, {
        limit: 10,
        minWidth,
        negativeTerms,
        textQuery: "" // Pure depicts search
      });
      // Only add if they seem relevant (filter by having some keywords in title)
      const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
      const relevantCandidates = candidates.filter(c => {
        const title = c.title.toLowerCase();
        return queryTerms.some(t => title.includes(t));
      });
      allCandidates.push(...relevantCandidates);
      console.log(`[wikimedia] Depicts search for ${qids.join(",")} found ${relevantCandidates.length} relevant candidates`);
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
      qids: qids,
      commonsFileTitle: chosen.title,
      imageUrl: commonsFilePathUrl(chosen.title, width),
      fileUrl: chosen.fileUrl,
      title: chosen.title.replace(/^File:/, ""),
      debug: {
        score: chosen.score,
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
 */
export async function loadQuestionImage(question, opts = {}) {
  const media = question.media;
  if (!media?.query && !media?.qids?.length) return null;

  try {
    const negativeTerms = media.negativeTerms ?? opts.negativeTerms ?? [];
    const qids = media.qids ?? [];
    const usedFileTitles = opts.usedFileTitles ?? null;

    const result = await getMediaForQuery(media.query || qids.join(" "), {
      ...opts,
      qids,
      negativeTerms,
      usedFileTitles
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
