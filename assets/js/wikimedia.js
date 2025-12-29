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
    .replace(/^wikipedia:\s*/i, "")
    .replace(/\+/g, " "); // Treat '+' as space in search queries

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

  // Prune cache: keep max 200 entries to prevent localStorage bloat
  const entries = Object.entries(cache);
  if (entries.length > 200) {
    entries
      .sort((a, b) => a[1].ts - b[1].ts) // oldest first
      .slice(0, entries.length - 200)
      .forEach(([k]) => delete cache[k]);
  }

  writeCache(cache);

  return result;
}

/**
 * Question types that should NOT get auto-generated images
 */
const SKIP_IMAGE_TYPES = [
  "matching",
  "table_parse",
  "ratio_table",
  "data_table",
  "wiskunde_multi_part",
];

/**
 * Extract key terms from question text for image search
 * @param {object} question - The question object
 * @returns {string|null} - Search query or null if not suitable
 */
export function generateSearchQuery(question) {
  // Skip types that don't benefit from images
  if (SKIP_IMAGE_TYPES.includes(question.type)) {
    return null;
  }

  // Get the question text
  let text = question.q || question.question || question.prompt_html ||
             question.instruction || question.title || "";

  // Strip HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Skip very short questions
  if (text.length < 10) return null;

  // Extract key nouns/terms - remove common Dutch/Latin/English question words
  const stopWords = new Set([
    // Dutch question/function words
    "wat", "wie", "waar", "wanneer", "waarom", "hoe", "welke", "welk", "hoeveel",
    "is", "zijn", "was", "waren", "heeft", "hebben", "had", "hadden", "wordt", "worden",
    "een", "de", "het", "van", "voor", "met", "bij", "naar", "door", "over", "uit", "aan", "tot",
    "deze", "dit", "die", "dat", "er", "hier", "daar", "ook", "nog", "al", "zo", "dan",
    "niet", "geen", "wel", "dan", "als", "maar", "want", "dus", "toch", "omdat", "indien",
    "je", "jij", "jouw", "jullie", "we", "wij", "ze", "zij", "hun", "ons", "onze",
    "volgens", "vooral", "best", "meest", "juist", "goed", "fout", "vaak", "soms",
    "antwoord", "vraag", "vragen", "tekst", "samenvatting", "methode", "betekent", "betekenis",
    "letterlijk", "letterlijke", "noemen", "noemt", "heet", "heten", "ander", "andere",
    "zou", "kunnen", "kan", "mag", "moet", "moeten", "willen", "wil", "zal", "zullen",
    "heel", "zeer", "meer", "minder", "veel", "weinig", "groot", "grote", "klein", "kleine",
    "pas", "past", "passen", "passend", "passende", "combinatie",
    // Latin common
    "est", "sunt", "esse", "quid", "quod", "qui", "quae",
    // English common (for mixed queries)
    "the", "and", "or", "is", "are", "was", "were", "what", "which", "who", "how", "why",
    // Question/quiz markers
    "reminder", "uitleg", "voorbeeld", "functie", "belangrijkste", "volgende",
  ]);

  // Tokenize and filter
  const words = text
    .toLowerCase()
    .replace(/[.,?!;:()""''«»„"]/g, " ")
    .replace(/[']/g, "") // Remove apostrophes within words
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w) && !/^\d+$/.test(w));

  // If we have very few words, this question might not be suitable for image search
  if (words.length < 1) return null;

  // Take first 2-3 meaningful words (fewer = more specific search)
  const keywords = words.slice(0, 3);

  if (keywords.length < 1) return null;

  // Join for search query
  return keywords.join(" ");
}

/**
 * Load image for a question - either from media spec or auto-generated
 * @param {object} question - The full question object
 * @returns {Promise<string|null>} - The image URL or null if failed
 */
export async function loadQuestionImage(question) {
  // If question has explicit media.query, use that
  if (question.media?.query) {
    try {
      const result = await getMediaForQuery(question.media.query);
      return result.imageUrl;
    } catch (err) {
      console.warn("Failed to load media:", question.media.query, err);
      return null;
    }
  }

  // Otherwise, try to auto-generate a search query
  const autoQuery = generateSearchQuery(question);
  if (!autoQuery) return null;

  try {
    const result = await getMediaForQuery(autoQuery);
    return result.imageUrl;
  } catch (err) {
    // Silently fail for auto-generated queries - not all will find images
    return null;
  }
}

/**
 * Preload images for multiple questions
 * @param {Array} questions - Array of questions
 */
export async function preloadQuestionImages(questions) {
  // Filter questions that don't have images yet and aren't skip types
  const needsImage = questions.filter(q => !q.image && !SKIP_IMAGE_TYPES.includes(q.type));

  // Load in parallel with a concurrency limit
  const concurrency = 3;
  for (let i = 0; i < needsImage.length; i += concurrency) {
    const batch = needsImage.slice(i, i + concurrency);
    await Promise.all(batch.map(q => loadQuestionImage(q)));
  }
}
