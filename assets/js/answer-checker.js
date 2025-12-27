/* ===========================================
   Adamus - Smart Answer Checker
   Fuzzy matching + synonym support for open answers
   =========================================== */

/**
 * Levenshtein distance - measures edit distance between two strings
 */
function levenshtein(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score (0-1) between two strings
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const distance = levenshtein(a, b);
  return 1 - distance / maxLen;
}

/**
 * Normalize text for comparison
 * - lowercase
 * - remove accents
 * - remove punctuation
 * - normalize whitespace
 */
function normalize(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^\w\s]/g, " ")        // punctuation to space
    .replace(/\s+/g, " ")            // normalize whitespace
    .trim();
}

/**
 * Common synonyms for history/geography terms
 * Expandable per subject
 */
const SYNONYMS = {
  // Egypte
  "farao": ["pharao", "koning", "heerser"],
  "piramide": ["piramides", "grafmonument", "graftombe"],
  "nijl": ["nijlrivier", "de nijl", "nile"],
  "hierogliefen": ["hieroglyfen", "hiërogliefen", "egyptisch schrift"],
  "mummie": ["mummies", "gemummificeerd lichaam"],
  "papyrus": ["papyri", "papyrusrol"],

  // Grieken
  "polis": ["stadstaat", "stad-staat", "griekse stad"],
  "agora": ["marktplein", "plein", "centrale plein"],
  "akropolis": ["acropolis", "burcht", "stadsburcht"],
  "democratie": ["volksmacht", "volksregering"],
  "oligarchie": ["heerschappij van weinigen"],
  "aristocratie": ["adelsheerschappij"],
  "tirannos": ["tiran", "alleenheerser", "dictator"],
  "athene": ["athens"],
  "sparta": ["lakedaimon"],

  // Goden
  "zeus": ["oppergod", "dondergod"],
  "poseidon": ["zeegod", "god van de zee"],
  "athena": ["godin van wijsheid", "pallas athena"],
  "hades": ["god van de onderwereld"],
  "apollo": ["apollon"],
  "ares": ["oorlogsgod"],

  // Algemeen
  "v.c.": ["voor christus", "vc", "v chr", "vóór christus"],
  "n.c.": ["na christus", "nc", "n chr"],
  "eeuw": ["periode", "tijdperk"],
  "oorlog": ["strijd", "conflict", "veldslag"],
  "koning": ["vorst", "monarch", "heerser"],
  "slaven": ["slaaf", "slavernij", "tot slaaf gemaakten"],
  "burgers": ["burger", "staatsburgers"],
};

/**
 * Get all synonyms for a term (including the term itself)
 */
function getSynonyms(term) {
  const normalized = normalize(term);
  const synonyms = new Set([normalized]);

  // Check if term is a key
  if (SYNONYMS[normalized]) {
    SYNONYMS[normalized].forEach(s => synonyms.add(normalize(s)));
  }

  // Check if term is a value (reverse lookup)
  for (const [key, values] of Object.entries(SYNONYMS)) {
    const normalizedValues = values.map(normalize);
    if (normalizedValues.includes(normalized)) {
      synonyms.add(normalize(key));
      normalizedValues.forEach(s => synonyms.add(s));
    }
  }

  return Array.from(synonyms);
}

/**
 * Check if user answer matches expected answer
 * Returns { match: boolean, score: number, reason: string }
 *
 * Matching levels:
 * 1. Exact match (after normalization)
 * 2. Synonym match
 * 3. Fuzzy match (similarity > 0.8)
 * 4. Keyword containment
 */
export function checkAnswer(userAnswer, expectedAnswers, options = {}) {
  const {
    fuzzyThreshold = 0.8,
    checkSynonyms = true,
    checkKeywords = true,
    minKeywordMatch = 0.5, // at least 50% of keywords must match
  } = options;

  if (!userAnswer || !expectedAnswers) {
    return { match: false, score: 0, reason: "empty" };
  }

  const userNorm = normalize(userAnswer);
  const expectedList = Array.isArray(expectedAnswers) ? expectedAnswers : [expectedAnswers];

  // Build set of all acceptable answers (including synonyms)
  const acceptable = new Set();
  expectedList.forEach(exp => {
    const expNorm = normalize(exp);
    acceptable.add(expNorm);

    if (checkSynonyms) {
      getSynonyms(exp).forEach(syn => acceptable.add(syn));
    }
  });

  // 1. Exact match
  if (acceptable.has(userNorm)) {
    return { match: true, score: 1, reason: "exact" };
  }

  // 2. Check each acceptable answer for fuzzy match
  let bestScore = 0;
  let bestReason = "no_match";

  for (const exp of acceptable) {
    const score = similarity(userNorm, exp);
    if (score > bestScore) {
      bestScore = score;
    }

    // Fuzzy match
    if (score >= fuzzyThreshold) {
      return { match: true, score, reason: "fuzzy" };
    }
  }

  // 3. Keyword containment (user answer contains expected, or vice versa)
  if (checkKeywords) {
    for (const exp of acceptable) {
      // User answer contains expected
      if (userNorm.includes(exp) && exp.length >= 3) {
        return { match: true, score: 0.9, reason: "contains" };
      }
      // Expected contains user answer (if user answer is substantial)
      if (exp.includes(userNorm) && userNorm.length >= 3) {
        return { match: true, score: 0.85, reason: "contained" };
      }
    }
  }

  // 4. Multi-word keyword matching
  if (checkKeywords && userNorm.includes(" ")) {
    const userWords = userNorm.split(" ").filter(w => w.length >= 3);

    for (const exp of acceptable) {
      const expWords = exp.split(" ").filter(w => w.length >= 3);
      if (expWords.length === 0) continue;

      const matchedWords = expWords.filter(ew =>
        userWords.some(uw => similarity(uw, ew) >= fuzzyThreshold)
      );

      const matchRatio = matchedWords.length / expWords.length;
      if (matchRatio >= minKeywordMatch) {
        return { match: true, score: matchRatio * 0.8, reason: "keywords" };
      }
    }
  }

  return { match: false, score: bestScore, reason: bestReason };
}

/**
 * Check short answer with keywords
 * Returns { match: boolean, score: number, matchedKeywords: string[], missingKeywords: string[] }
 */
export function checkShortAnswerWithKeywords(userAnswer, keywords, options = {}) {
  const {
    minKeywords = 1,
    fuzzyThreshold = 0.8,
  } = options;

  if (!userAnswer || !keywords || keywords.length === 0) {
    return { match: false, score: 0, matchedKeywords: [], missingKeywords: keywords || [] };
  }

  const userNorm = normalize(userAnswer);
  const userWords = userNorm.split(" ");

  const matchedKeywords = [];
  const missingKeywords = [];

  keywords.forEach(keyword => {
    const keyNorm = normalize(keyword);
    const keySynonyms = getSynonyms(keyword);

    // Check if any form of the keyword is in the answer
    const found = keySynonyms.some(syn => {
      // Exact containment
      if (userNorm.includes(syn)) return true;

      // Fuzzy match against words
      return userWords.some(word => similarity(word, syn) >= fuzzyThreshold);
    });

    if (found) {
      matchedKeywords.push(keyword);
    } else {
      missingKeywords.push(keyword);
    }
  });

  const score = matchedKeywords.length / keywords.length;
  const match = matchedKeywords.length >= minKeywords;

  return { match, score, matchedKeywords, missingKeywords };
}

/**
 * Add custom synonyms (e.g., from quiz data)
 */
export function addSynonyms(term, synonymList) {
  const key = normalize(term);
  if (!SYNONYMS[key]) {
    SYNONYMS[key] = [];
  }
  synonymList.forEach(syn => {
    const synNorm = normalize(syn);
    if (!SYNONYMS[key].includes(synNorm)) {
      SYNONYMS[key].push(synNorm);
    }
  });
}

/**
 * Get matching feedback for educational purposes
 */
export function getMatchFeedback(result, userAnswer, expectedAnswer) {
  if (result.match) {
    switch (result.reason) {
      case "exact":
        return "Helemaal goed!";
      case "fuzzy":
        return "Goed! (kleine spelfout)";
      case "synonym":
        return "Goed! (synoniem geaccepteerd)";
      case "contains":
      case "contained":
        return "Goed!";
      case "keywords":
        return "Goed! (belangrijkste punten genoemd)";
      case "ai":
        return "Goed! (inhoudelijk correct)";
      default:
        return "Goed!";
    }
  }

  if (result.score > 0.6) {
    return "Bijna! Controleer je spelling.";
  }

  return "Helaas, dat is niet correct.";
}

/* ===========================================
   AI Semantic Checker via Supabase Edge Function
   =========================================== */

const AI_CACHE_KEY = "aiCheckCache:v1";
const AI_CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

// Supabase Edge Function URL - API key is stored server-side
const SUPABASE_URL = "https://lmykabhxuiuppbnudvve.supabase.co";
const CHECK_ANSWER_ENDPOINT = `${SUPABASE_URL}/functions/v1/check-answer`;

function readAICache() {
  try {
    return JSON.parse(localStorage.getItem(AI_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAICache(cache) {
  try {
    // Prune old entries
    const entries = Object.entries(cache);
    if (entries.length > 500) {
      entries
        .sort((a, b) => a[1].ts - b[1].ts)
        .slice(0, entries.length - 500)
        .forEach(([k]) => delete cache[k]);
    }
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

/**
 * Check answer using AI via Supabase Edge Function
 * API key is stored securely server-side
 *
 * @param {string} userAnswer - The student's answer
 * @param {string} expectedAnswer - The expected/model answer
 * @param {object} context - Additional context (question, subject, etc.)
 * @returns {Promise<{ match: boolean, score: number, reason: string, feedback?: string }>}
 */
export async function checkAnswerWithAI(userAnswer, expectedAnswer, context = {}) {
  // Check cache first
  const cacheKey = `${normalize(userAnswer)}|${normalize(expectedAnswer)}|${context.question || ""}`.substring(0, 200);
  const cache = readAICache();
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.ts < AI_CACHE_TTL) {
    return cached.result;
  }

  try {
    const response = await fetch(CHECK_ANSWER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userAnswer,
        expectedAnswer,
        question: context.question || "",
      }),
    });

    if (!response.ok) {
      throw new Error(`AI check failed: ${response.status}`);
    }

    const aiResult = await response.json();

    const result = {
      match: aiResult.correct === true,
      score: typeof aiResult.score === "number" ? aiResult.score : (aiResult.correct ? 1 : 0),
      reason: "ai",
      feedback: aiResult.feedback || "",
    };

    // Cache result
    cache[cacheKey] = { ts: Date.now(), result };
    writeAICache(cache);

    return result;
  } catch (err) {
    console.warn("AI check failed, falling back to fuzzy:", err);
    return checkAnswer(userAnswer, expectedAnswer);
  }
}

/**
 * Smart checker: tries fuzzy first, falls back to AI for uncertain cases
 */
export async function smartCheck(userAnswer, expectedAnswers, context = {}, options = {}) {
  // First try fuzzy matching (fast, free)
  const fuzzyResult = checkAnswer(userAnswer, expectedAnswers);

  // If confident match, use fuzzy result
  if (fuzzyResult.match && fuzzyResult.score >= 0.9) {
    return fuzzyResult;
  }

  // For uncertain cases, try AI if enabled
  if (options.useAI !== false) {
    const expected = Array.isArray(expectedAnswers) ? expectedAnswers[0] : expectedAnswers;
    return checkAnswerWithAI(userAnswer, expected, context);
  }

  return fuzzyResult;
}

/**
 * Check if AI checking is available
 * Currently disabled - no backend configured for Adamus
 */
export function isAIAvailable() {
  return false; // AI not available without backend
}
