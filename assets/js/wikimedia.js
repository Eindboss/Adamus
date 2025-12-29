/* ===========================================
   Adamus - Wikimedia Image Fetcher (Improved)
   Commons-first search with ranking + filters
   Fallback to Wikipedia pageimages if needed
   =========================================== */

const LS_KEY = "mediaCache:v2";
const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

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
 * Build a Special:FilePath URL with width param (works well in many LMSes)
 */
function commonsFilePathUrl(fileTitle, width = 900) {
  const name = fileTitle.replace(/^File:/i, "");
  const encoded = encodeURIComponent(name).replace(/%2F/g, "/");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${width}`;
}

/**
 * Score candidate file title against query, with lightweight heuristics.
 */
function scoreCandidate({ title, categories = [], mime, width, height }, query, negativeTerms = []) {
  const t = (title || "").toLowerCase();
  const q = (query || "").toLowerCase();

  let score = 0;

  // Positive match: query tokens in title
  const tokens = q.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    if (t.includes(tok)) score += 8;
  }

  // Category boost (if available)
  const catText = categories.join(" ").toLowerCase();
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    if (catText.includes(tok)) score += 4;
  }

  // Penalize negatives
  if (containsAny(t, negativeTerms) || containsAny(catText, negativeTerms)) score -= 40;

  // Penalize common junk patterns
  if (containsAny(t, ["logo", "icon", "pictogram", "flag", "coat_of_arms"])) score -= 30;
  if (containsAny(t, ["map", "locator", "blank_map"])) score -= 20;

  // Prefer raster formats for maximum LMS compatibility
  const isSvg = (mime || "").includes("svg");
  if (isSvg) score -= 10;

  // Prefer larger images
  if (width && height) {
    const megapixels = (width * height) / 1_000_000;
    score += clamp(megapixels * 2, 0, 12); // up to +12
  }

  return score;
}

/**
 * Commons search:
 * - Searches File namespace directly
 * - Fetches imageinfo + (optional) categories
 */
async function commonsSearchFiles(query, {
  limit = 15,
  minWidth = 900,
  allowSvg = true,
  negativeTerms = [],
} = {}) {
  const q = normalizeQuery(query)
    .replace(/^wikimedia:\s*/i, "")
    .replace(/^wikipedia:\s*/i, "")
    .replace(/\+/g, " ");

  // Search in Commons for files (fulltext search, not just intitle)
  const searchUrl = `https://commons.wikimedia.org/w/api.php?` + new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: q,
    gsrnamespace: "6", // File namespace
    gsrlimit: String(limit),
    prop: "imageinfo|categories",
    iiprop: "url|size|mime",
    iiurlwidth: "1200",
    cllimit: "20",
    format: "json",
    origin: "*"
  }).toString();

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

    // Hard filters
    if (width < minWidth) continue;
    if (!allowSvg && mime.includes("svg")) continue;

    const categories = (p?.categories || []).map(c => c.title.replace(/^Category:/, ""));

    // More hard junk filters
    const lowerTitle = title.toLowerCase();
    if (containsAny(lowerTitle, ["logo", "icon", "pictogram", "flag", "coat_of_arms"])) continue;

    candidates.push({
      title,
      mime,
      width,
      height,
      thumbUrl: ii.thumburl || ii.url,
      fileUrl: ii.url,
      categories,
      score: scoreCandidate({ title, categories, mime, width, height }, q, negativeTerms)
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return { normalizedQuery: q, candidates };
}

/**
 * Wikipedia fallback (original approach, but allow >1 result)
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
  }).toString();

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
  }).toString();

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
 * Main entry: Commons-first. Supports uniqueness via opts.usedFileTitles (Set).
 * @param {string} query - The search query
 * @param {object} opts - Options: ttlMs, lang, minWidth, allowSvg, width, negativeTerms, usedFileTitles
 * @returns {Promise<{imageUrl: string, source: string, title: string, ...}>}
 */
export async function getMediaForQuery(query, opts = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL;
  const lang = opts.lang ?? "en";
  const minWidth = opts.minWidth ?? 900;
  const allowSvg = opts.allowSvg ?? true;
  const width = opts.width ?? 900;
  const negativeTerms = opts.negativeTerms ?? [];
  const usedFileTitles = opts.usedFileTitles ?? null;

  const optsKey = JSON.stringify({ lang, minWidth, allowSvg, width, negativeTerms });
  const key = cacheKey(query, optsKey);

  const cache = readCache();
  const hit = cache[key];
  if (hit && isFresh(hit, ttlMs)) {
    // If uniqueness is required, still respect it
    if (!usedFileTitles || !hit.result?.commonsFileTitle || !usedFileTitles.has(hit.result.commonsFileTitle)) {
      return hit.result;
    }
  }

  // 1) Commons-first
  try {
    const { normalizedQuery, candidates } = await commonsSearchFiles(query, {
      limit: 20,
      minWidth,
      allowSvg,
      negativeTerms
    });

    // Pick first candidate not used
    const chosen = candidates.find(c => !usedFileTitles || !usedFileTitles.has(c.title));
    if (chosen) {
      const result = {
        source: "commons",
        query: normalizedQuery,
        commonsFileTitle: chosen.title,
        imageUrl: commonsFilePathUrl(chosen.title, width),
        fileUrl: chosen.fileUrl,
        title: chosen.title.replace(/^File:/, ""),
        debug: { score: chosen.score, mime: chosen.mime, width: chosen.width, height: chosen.height }
      };

      cache[key] = { ts: Date.now(), query: normalizedQuery, result };
      pruneCache(cache);
      writeCache(cache);

      if (usedFileTitles) usedFileTitles.add(chosen.title);
      return result;
    }
  } catch (e) {
    console.warn("Commons search failed, falling back to Wikipedia:", e);
  }

  // 2) Wikipedia fallback
  const fallback = await wikipediaFallback(query, { lang });
  cache[key] = { ts: Date.now(), query: normalizeQuery(query), result: fallback };
  pruneCache(cache);
  writeCache(cache);
  return fallback;
}

/**
 * Load image for a question - ONLY from explicit media.query
 * Optionally supports media.negativeTerms and uniqueness (pass a Set).
 * @param {object} question - The full question object
 * @param {object} opts - Options: negativeTerms, usedFileTitles
 * @returns {Promise<string|null>} - The image URL or null
 */
export async function loadQuestionImage(question, opts = {}) {
  if (!question.media?.query) return null;

  try {
    const negativeTerms = question.media?.negativeTerms ?? opts.negativeTerms ?? [];
    const usedFileTitles = opts.usedFileTitles ?? null;

    const result = await getMediaForQuery(question.media.query, {
      ...opts,
      negativeTerms,
      usedFileTitles
    });

    // Write back so UI can use it
    question.image = result.imageUrl;
    question.media = { ...question.media, resolved: result };
    return result.imageUrl;
  } catch (err) {
    console.warn("Failed to load media:", question.media.query, err);
    return null;
  }
}

/**
 * Preload images for multiple questions
 * - Respects skipTypes
 * - Ensures uniqueness within this batch via Set
 * @param {Array} questions - Array of questions
 * @param {object} opts - Options: usedFileTitles, negativeTerms
 * @returns {Promise<Set>} - Set of used file titles
 */
export async function preloadQuestionImages(questions, opts = {}) {
  const skipTypes = ["matching", "table_parse", "ratio_table", "data_table", "wiskunde_multi_part"];
  const needsImage = questions.filter(q => q.media?.query && !q.image && !skipTypes.includes(q.type));

  // Uniqueness within this preload run
  const usedFileTitles = opts.usedFileTitles ?? new Set();

  const concurrency = 3;
  for (let i = 0; i < needsImage.length; i += concurrency) {
    const batch = needsImage.slice(i, i + concurrency);
    await Promise.all(batch.map(q => loadQuestionImage(q, { ...opts, usedFileTitles })));
  }

  return usedFileTitles;
}
