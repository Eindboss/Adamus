/* ===========================================
   Adamus - Wikimedia Image Fetcher
   Fetches images from Wikipedia/Wikimedia based on query
   =========================================== */

const LS_KEY = "mediaCache:v1";
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

function cacheKey(query) {
  return normalizeQuery(query).toLowerCase();
}

function isFresh(entry, ttl) {
  return Date.now() - entry.ts < ttl;
}

/**
 * Fetch a representative image from Wikipedia/Wikimedia based on a free-text query.
 * @param {string} query - The search query (e.g. "Wikimedia: Rosetta Stone British Museum")
 * @param {object} opts - Options: ttlMs (cache TTL), lang (language code)
 * @returns {Promise<{imageUrl: string, pageUrl: string, title?: string}>}
 */
export async function getMediaForQuery(query, opts = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL;
  const lang = opts.lang ?? "en";

  const key = cacheKey(query);
  const cache = readCache();
  const hit = cache[key];
  if (hit && isFresh(hit, ttlMs)) {
    return hit.result;
  }

  const q = normalizeQuery(query)
    .replace(/^wikimedia:\s*/i, "")
    .replace(/^wikipedia:\s*/i, "");

  // 1) Wikipedia search (best page match)
  const searchUrl =
    `https://${lang}.wikipedia.org/w/api.php?` +
    new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: q,
      srlimit: "1",
      format: "json",
      origin: "*"
    }).toString();

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) throw new Error(`Wikipedia search failed: ${searchRes.status}`);
  const searchJson = await searchRes.json();
  const top = searchJson?.query?.search?.[0];
  if (!top?.title) throw new Error(`No page found for query: ${q}`);

  const title = top.title;

  // 2) Get page image + url + basic info
  const pageUrl =
    `https://${lang}.wikipedia.org/w/api.php?` +
    new URLSearchParams({
      action: "query",
      prop: "pageimages|info",
      inprop: "url",
      titles: title,
      pithumbsize: "800",
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

  if (!thumb || !fullPageUrl) {
    throw new Error(`No thumbnail/fullurl for: ${title}`);
  }

  const result = {
    imageUrl: thumb,
    pageUrl: fullPageUrl,
    title,
    source: "wikimedia"
  };

  cache[key] = { ts: Date.now(), query: q, result };
  writeCache(cache);

  return result;
}

/**
 * Load image for a question's media spec
 * @param {object} mediaSpec - The media specification from the question
 * @returns {Promise<string|null>} - The image URL or null if failed
 */
export async function loadQuestionImage(mediaSpec) {
  if (!mediaSpec || !mediaSpec.query) return null;

  try {
    const result = await getMediaForQuery(mediaSpec.query);
    return result.imageUrl;
  } catch (err) {
    console.warn("Failed to load media:", mediaSpec.query, err);
    return null;
  }
}

/**
 * Preload images for multiple questions
 * @param {Array} questions - Array of questions with media specs
 */
export async function preloadQuestionImages(questions) {
  const mediaQuestions = questions.filter(q => q.media?.query);

  // Load in parallel with a concurrency limit
  const concurrency = 3;
  for (let i = 0; i < mediaQuestions.length; i += concurrency) {
    const batch = mediaQuestions.slice(i, i + concurrency);
    await Promise.all(batch.map(q => loadQuestionImage(q.media)));
  }
}
