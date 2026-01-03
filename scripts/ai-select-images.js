/**
 * AI-powered image selection for quiz questions (v3.3)
 *
 * Uses Gemini AI to generate optimal search terms in BATCHES,
 * then fetches images from Wikimedia Commons with enhanced scoring.
 *
 * v3 Improvements:
 * - Category-based scoring using Commons categories as context signal
 * - RiskProfile penalties (animals vs humans, modern vs historical)
 * - Intent gating (require diagram signals for diagram intents)
 * - Wikipedia fallback for "no candidates found" cases
 * - Enhanced AI prompt with commonsQueries and riskProfile
 *
 * v3.1 Improvements:
 * - Negation ladder: retry queries without negations when 0 results
 * - Category bonus gating: require topicKeyword match for category bonus
 * - MIN_ACCEPT_SCORE thresholds per intent type
 * - AI coverage check with local repair brief
 * - Score-based fallback trigger (not just 0 candidates)
 *
 * v3.2 Improvements:
 * - concept_diagram intent for abstract concepts (reflexes, homeostasis, etc.)
 * - Subject profiles (vakprofielen) with preset categoryHints and riskProfiles
 * - Educational quality scoring (bonus for field guide, penalty for stock/toys)
 * - thematic_vs_tourist riskProfile for aardrijkskunde
 * - mythology_vs_popculture riskProfile for latijn
 * - Higher MIN_ACCEPT_SCORE thresholds for better precision
 * - Map legibility bonus for larger images
 *
 * v3.3 Improvements:
 * - imagePolicy="none" for Latin grammar questions (no image needed)
 * - Per-question AI escalation for failures (query-repair, capped per quiz)
 * - Subject-specific threshold overrides
 * - Improved Latin grammar detection
 *
 * Usage:
 *   GEMINI_API_KEY=key node ai-select-images.js --quiz <quiz-file.json>
 *   GEMINI_API_KEY=key node ai-select-images.js --quiz <quiz-file.json> --apply
 *   GEMINI_API_KEY=key node ai-select-images.js --quiz <quiz-file.json> --replace --apply
 *
 * Options:
 *   --apply    Apply the selected images to the quiz file
 *   --replace  Replace ALL existing images (re-evaluate everything with AI)
 */

const fs = require('fs');
const path = require('path');

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.0-flash-exp';

// Batch settings
const BATCH_SIZE = 12;
const MAX_RETRIES = 3;
const BASE_DELAY = 2000;
const MAX_ESCALATIONS_PER_QUIZ = 10; // v3.3: Cap per-question AI escalations

// v3.3: Latin grammar/translation keywords that indicate no image is needed
// Only narrative (cultural/mythological) questions need images
const LATIN_GRAMMAR_KEYWORDS = [
  // Grammar terms
  'accusativus', 'accusatief', 'dativus', 'datief', 'genitivus', 'genitief',
  'ablativus', 'ablatief', 'nominativus', 'nominatief', 'vocativus', 'vocatief',
  'vervoeging', 'verbuiging', 'coniugatio', 'conjugatie', 'declinatio', 'declinatie',
  'praesens', 'imperfectum', 'perfectum', 'plusquamperfectum', 'futurum',
  'passief', 'actief', 'participium', 'infinitivus', 'infinitief',
  'gerundium', 'gerundivum', 'supinum',
  'naamval', 'casus', 'persoonsvorm', 'werkwoordsvorm',
  'singularis', 'pluralis', 'meervoud', 'enkelvoud',
  'grammatica',
  // Translation terms
  'vertaal', 'vertaling', 'betekent', 'betekenis',
  'wat betekent', 'hoe vertaal', 'geef de vertaling',
  // Vocabulary terms
  'woordsoort', 'zelfstandig naamwoord', 'werkwoord', 'bijvoeglijk',
  'voegwoord', 'voorzetsel', 'bijwoord',
  // Sentence analysis
  'ontleed', 'ontleding', 'zinsdeel', 'onderwerp', 'lijdend voorwerp',
  'meewerkend voorwerp', 'gezegde',
];

// Minimum acceptable scores per intent type (v3.2: raised thresholds for better precision)
const MIN_ACCEPT_SCORE = {
  labeled_diagram: 100,
  diagram: 70,
  concept_diagram: 70,
  photo: 35,
  map: 70,
  historical_illustration: 70,
  micrograph: 70,
  default: 35,
};

// v3.3: Subject-specific threshold overrides
const SUBJECT_THRESHOLDS = {
  biologie: {
    labeled_diagram: 100,
    concept_diagram: 60, // Lower for abstract concepts
    diagram: 70,
  },
  geschiedenis: {
    historical_illustration: 80, // Higher for better quality
  },
  aardrijkskunde: {
    map: 80, // Higher for legibility
  },
  latijn: {
    historical_illustration: 70,
    photo: 40,
  },
};

// Risk profile token lists
const ANIMAL_TOKENS = ['animal', 'bovine', 'rhino', 'cow', 'dog', 'cat', 'fish', 'bird', 'insect',
  'crustacean', 'mollusc', 'canine', 'feline', 'horse', 'sheep', 'pig', 'rabbit', 'mouse', 'rat',
  'whale', 'dolphin', 'shark', 'snake', 'lizard', 'frog', 'turtle', 'crab', 'lobster', 'shrimp',
  'barnacle', 'squid', 'octopus', 'snail', 'worm', 'bee', 'ant', 'butterfly', 'spider', 'beetle'];

const HUMAN_ANATOMY_TOKENS = ['human', 'homo sapiens', 'gray', 'grey', 'anatomy', 'medical',
  'patient', 'body', 'anatomical'];

// Tourist/transport map tokens (aardrijkskunde penalty)
const TOURIST_MAP_TOKENS = ['tourist', 'metro', 'subway', 'road', 'transport', 'travel',
  'transit', 'bus', 'train', 'railway', 'highway', 'motorway'];

// Modern/popculture tokens (latijn/geschiedenis penalty)
const POPCULTURE_TOKENS = ['disney', 'marvel', 'game', 'movie', 'film', 'lego', 'toy',
  'cosplay', 'fanart', 'cgi', '3d render', 'concept art', 'robot', 'humanoid'];

// Stock photo indicators (global penalty)
const STOCK_TOKENS = ['shutterstock', 'getty', 'istock', 'stock photo', 'royalty free',
  'depositphotos', 'dreamstime', 'fotolia'];

// Educational quality signals (bonus)
const EDUCATIONAL_TOKENS = ['identification', 'field guide', 'distribution', 'range map',
  'habitat', 'taxonomy', 'specimen', 'labeled', 'annotated', 'educational', 'textbook'];

// Concept diagram signals (for abstract concepts)
const CONCEPT_DIAGRAM_TOKENS = ['schematic', 'flowchart', 'pathway', 'cycle', 'model',
  'infographic', 'process', 'mechanism', 'regulation', 'feedback'];

// Abstract concept keywords (trigger concept_diagram intent)
const ABSTRACT_CONCEPT_KEYWORDS = ['coördinatie', 'coordination', 'rusttoestand', 'reflex',
  'regeling', 'homeostase', 'homeostasis', 'prikkel', 'stimulus', 'reactie', 'response',
  'spierwerking', 'muscle contraction', 'werking', 'function', 'proces', 'process'];

// Subject profiles with default categoryHints and riskProfiles
const SUBJECT_PROFILES = {
  biologie: {
    defaultIntent: 'labeled_diagram',
    categoryHints: ['Gray\'s Anatomy plates', 'Human anatomy diagrams', 'Human skeleton diagrams',
      'Cell biology diagrams', 'Histology'],
    riskProfile: 'human_vs_animal',
  },
  geschiedenis: {
    defaultIntent: 'historical_illustration',
    categoryHints: ['Historical maps', 'Ancient Rome', 'Ancient Greece', 'Medieval manuscripts'],
    riskProfile: 'historical_vs_modern',
  },
  aardrijkskunde: {
    defaultIntent: 'map',
    categoryHints: ['Physical maps', 'Thematic maps', 'Climate diagrams', 'Population density maps'],
    riskProfile: 'thematic_vs_tourist',
  },
  latijn: {
    defaultIntent: 'historical_illustration',
    categoryHints: ['Ancient Rome', 'Roman mythology', 'Roman mosaics', 'Roman inscriptions'],
    riskProfile: 'mythology_vs_popculture',
  },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Strip negations from a query for fallback search
 * "human skull -animal -insect" -> "human skull"
 */
function stripNegations(query) {
  return query.replace(/-\w+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Check if query has negations
 */
function hasNegations(query) {
  return /-\w+/.test(query);
}

/**
 * Get minimum score threshold for an intent type
 * v3.3: Now supports subject-specific overrides
 */
function getMinScore(intent, subject = null) {
  if (subject) {
    const subjectLower = subject.toLowerCase();
    const subjectOverrides = SUBJECT_THRESHOLDS[subjectLower];
    if (subjectOverrides && subjectOverrides[intent] !== undefined) {
      return subjectOverrides[intent];
    }
  }
  return MIN_ACCEPT_SCORE[intent] || MIN_ACCEPT_SCORE.default;
}

/**
 * v3.3: Detect if a question is Latin grammar/translation (no image needed)
 * Only narrative (cultural/mythological) questions should get images
 */
function isLatinGrammarQuestion(question, subject) {
  if (!subject || subject.toLowerCase() !== 'latijn') return false;

  const text = question.q || question.instruction || question.prompt?.text || question.prompt?.html || '';
  const clean = text.replace(/<[^>]+>/g, ' ').toLowerCase();

  // First check: is this a NARRATIVE question? (these SHOULD get images)
  const narrativeKeywords = [
    'romulus', 'remus', 'vestaalse', 'vesta', 'numa', 'tarquinius',
    'sabijnse', 'aeneas', 'troje', 'jupiter', 'mars', 'venus',
    'tiber', 'palatijn', 'capitool', 'forum', 'colosseum',
    'stichting van rome', 'koningen van rome', 'republiek',
    'mythe', 'sage', 'legende', 'verhaal', 'geschiedenis',
    'wolf', 'lupa', 'herder', 'faustulus', 'wie was', 'wie waren',
    'wat gebeurde', 'waarom', 'hoe kwam', 'vertel', 'beschrijf',
  ];

  const hasNarrativeKeyword = narrativeKeywords.some(kw => clean.includes(kw));

  // If it has narrative keywords AND asks about story/history, it's narrative
  if (hasNarrativeKeyword) {
    const narrativePatterns = [
      /wie was/i, /wie waren/i, /wat gebeurde/i, /waarom/i, /hoe kwam/i,
      /vertel/i, /beschrijf/i, /wat deed/i, /wat deden/i,
      /volgens de mythe/i, /volgens het verhaal/i,
    ];
    if (narrativePatterns.some(p => p.test(clean))) {
      return false; // This IS a narrative question, needs image
    }
  }

  // Check for grammar keywords
  for (const keyword of LATIN_GRAMMAR_KEYWORDS) {
    if (clean.includes(keyword)) return true;
  }

  // Additional patterns for Latin grammar/translation questions
  const grammarPatterns = [
    /welke.*naamval/i,
    /welke.*vorm/i,
    /wat is de.*van/i,
    /vertaal.*naar.*latijn/i,
    /vertaal.*naar.*nederlands/i,
    /geef.*de.*vorm/i,
    /bepaal.*de.*vorm/i,
    /in welke.*naamval/i,
    /welke.*tijd/i,
    /welk.*getal/i,
    /welk.*geslacht/i,
  ];

  for (const pattern of grammarPatterns) {
    if (pattern.test(clean)) return true;
  }

  // If the question contains only Latin text (translation exercise)
  // Pattern: mostly Latin words without Dutch explanation
  const latinWords = clean.match(/\b[a-z]{2,}\b/g) || [];
  const commonLatinSuffixes = ['us', 'um', 'is', 'orum', 'arum', 'os', 'as', 'ibus', 'ae', 'am'];
  const latinCount = latinWords.filter(w =>
    commonLatinSuffixes.some(s => w.endsWith(s))
  ).length;

  // If more than 50% of words look Latin and question is short, it's likely translation
  if (latinWords.length > 3 && latinCount / latinWords.length > 0.5) {
    return true;
  }

  return false;
}

/**
 * v3.3: Get image policy for a question
 * Returns: "required" | "optional" | "none"
 */
function getImagePolicy(question, subject) {
  // Latin grammar questions don't need images
  if (isLatinGrammarQuestion(question, subject)) {
    return 'none';
  }

  // Skip certain question types
  const skipTypes = ['matching', 'table_parse', 'ratio_table', 'data_table', 'fill_blank'];
  if (skipTypes.includes(question.type)) {
    return 'none';
  }

  return 'required';
}

async function withRetry(fn, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.message.includes('429') || err.message.includes('rate');
      const isLastAttempt = attempt === retries;
      if (isLastAttempt || !isRateLimit) throw err;
      const delay = BASE_DELAY * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`  Rate limited, waiting ${Math.round(delay / 1000)}s before retry...`);
      await sleep(delay);
    }
  }
}

/**
 * Generate search briefs for a BATCH of questions using AI
 * Now includes commonsQueries and riskProfile
 */
async function generateBatchSearchTerms(questions, subject, chapterContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable not set');

  const questionList = questions.map((q, i) => {
    const text = q.q || q.instruction || q.prompt?.text || q.prompt?.html || '';
    const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return `${i + 1}. [${q.id}] ${clean}`;
  }).join('\n');

  const prompt = `Je bent een expert in het vinden van educatieve afbeeldingen op Wikimedia Commons voor een Nederlandse quiz-app voor middelbare scholieren.

VAK: ${subject}
${chapterContext ? `HOOFDSTUK/CONTEXT: ${chapterContext}` : ''}

VRAGEN:
${questionList}

Genereer voor ELKE vraag de beste zoekstrategie voor Wikimedia Commons.

Voor elke vraag, bepaal:

1. imageIntent: welk type afbeelding past het beste?
   - "labeled_diagram" voor anatomie/wetenschap waar labels nodig zijn
   - "diagram" voor schematische voorstellingen
   - "concept_diagram" voor abstracte concepten (reflex, homeostase, coördinatie, spierwerking)
   - "photo" voor onderwerpen waar een foto prima is
   - "historical_illustration" voor geschiedenis/oudheid
   - "map" voor aardrijkskunde/locaties (fysisch, thematisch)
   - "micrograph" voor microscopische structuren

2. commonsQueries: 3 Engelse zoektermen voor Wikimedia Commons (strict → relaxed → broad)
   - Eerste query: heel specifiek, gebruik incategory:"..." waar zinvol
   - Tweede query: iets breder
   - Derde query: meest algemeen
   - Voor menselijke anatomie: voeg altijd "human" toe en gebruik "-animal -insect -fish"
   - Gebruik "Gray" of "Gray's Anatomy" voor anatomische platen
   Voorbeelden:
   - ["incategory:\\"Gray's Anatomy plates\\" skull fontanelle -animal", "human skull fontanelle diagram -animal", "fontanelle skull anatomy"]
   - ["incategory:\\"Historical maps\\" Roman Empire", "Roman Empire map ancient", "Roman Empire"]

3. mustHaveKeywords: woorden die IN de bestandsnaam/titel moeten voorkomen (max 2)

4. avoidKeywords: woorden die NIET in resultaten mogen (dieren bij menselijke anatomie, moderne foto's bij geschiedenis, etc.)

5. categoryHints: Wikimedia Commons categorieën die relevant zijn (max 3)
   Voorbeelden per vak:
   - Biologie: "Gray's Anatomy plates", "Human skeleton diagrams", "Cell biology diagrams"
   - Geschiedenis: "Historical maps", "Ancient Rome", "Medieval art"
   - Aardrijkskunde: "Climate diagrams", "Physical maps", "Population density maps"
   - Latijn: "Ancient Rome", "Roman art", "Latin inscriptions"

6. riskProfile: welk type fouten moet vermeden worden?
   - "human_vs_animal" voor menselijke anatomie (vermijd dieren)
   - "historical_vs_modern" voor geschiedenis (vermijd moderne foto's/reconstructies)
   - "thematic_vs_tourist" voor aardrijkskunde (vermijd toeristische/transport kaarten)
   - "mythology_vs_popculture" voor latijn (vermijd Disney/Marvel/games/films)
   - "diagram_vs_photo" voor technische concepten (vermijd stockfoto's)
   - "none" als er geen specifiek risico is

7. topicKeywords: 2-3 kernwoorden die de afbeelding MOET bevatten (voor category gating)
   Dit voorkomt dat een "Gray's Anatomy" match een verkeerde plaat selecteert.
   Voorbeeld: voor een vraag over fontanellen: ["skull", "fontanelle"]

8. wikipediaFallback: optioneel, een Engelse Wikipedia-artikelnaam als fallback
   Gebruik dit voor bekende onderwerpen (personen, plaatsen, dieren, planten)

BELANGRIJK:
- Zorg dat elke vraag een UNIEKE afbeelding krijgt
- Focus op educatieve waarde
- Bij menselijke anatomie: ALTIJD "human" toevoegen en dieren uitsluiten

Geef je antwoord als JSON array:
[
  {
    "questionId": "vraag-id",
    "imageIntent": "type",
    "commonsQueries": ["strict query", "relaxed query", "broad query"],
    "mustHaveKeywords": ["keyword"],
    "avoidKeywords": ["avoid"],
    "categoryHints": ["Category:Example"],
    "riskProfile": "human_vs_animal",
    "topicKeywords": ["topic", "keywords"],
    "wikipediaFallback": "Article_name"
  }
]

Geef ALLEEN de JSON array.`;

  const response = await fetch(`${GEMINI_API_URL}/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 3000 }
    })
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 429) throw new Error('429 Rate limit exceeded');
    throw new Error(`Gemini API error: ${status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Could not parse AI response as JSON array');
  return JSON.parse(jsonMatch[0]);
}

/**
 * Search Wikimedia Commons for images - now includes categories
 */
async function searchCommons(searchTerm, limit = 10) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: searchTerm,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo|categories',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: '800',
    cllimit: '20',
    clshow: '!hidden',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`${COMMONS_API}?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  const pages = data.query?.pages;
  if (!pages) return [];

  return Object.values(pages).map(page => ({
    title: page.title?.replace('File:', '') || '',
    imageUrl: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url,
    descriptionUrl: page.imageinfo?.[0]?.descriptionurl,
    width: page.imageinfo?.[0]?.width,
    height: page.imageinfo?.[0]?.height,
    mime: page.imageinfo?.[0]?.mime,
    description: page.imageinfo?.[0]?.extmetadata?.ImageDescription?.value || '',
    categories: (page.categories || []).map(c => c.title?.replace('Category:', '') || ''),
  })).filter(img => img.imageUrl);
}

/**
 * Search Commons by category - now includes categories
 */
async function searchCommonsCategory(category, limit = 20) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: category.startsWith('Category:') ? category : `Category:${category}`,
    gcmtype: 'file',
    gcmlimit: String(limit),
    prop: 'imageinfo|categories',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: '800',
    cllimit: '20',
    clshow: '!hidden',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`${COMMONS_API}?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  const pages = data.query?.pages;
  if (!pages) return [];

  return Object.values(pages).map(page => ({
    title: page.title?.replace('File:', '') || '',
    imageUrl: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url,
    descriptionUrl: page.imageinfo?.[0]?.descriptionurl,
    width: page.imageinfo?.[0]?.width,
    height: page.imageinfo?.[0]?.height,
    mime: page.imageinfo?.[0]?.mime,
    description: page.imageinfo?.[0]?.extmetadata?.ImageDescription?.value || '',
    categories: (page.categories || []).map(c => c.title?.replace('Category:', '') || ''),
  })).filter(img => img.imageUrl);
}

/**
 * v3.3: Per-question AI escalation - generate new queries for failed questions
 * Only called when initial search fails and we have escalation budget
 */
async function escalateWithAI(question, subject, chapterContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const text = question.q || question.instruction || question.prompt?.text || question.prompt?.html || '';
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const prompt = `Je bent een expert in het vinden van afbeeldingen op Wikimedia Commons.

De standaard zoekstrategie heeft GEFAALD voor deze vraag. Genereer NIEUWE, CREATIEVE zoekstrategieën.

VAK: ${subject}
${chapterContext ? `CONTEXT: ${chapterContext}` : ''}
VRAAG: ${clean}

De standaard queries werkten niet. Probeer nu:
1. Synoniemen en alternatieve terminologie
2. Bredere of specifiekere categorieën
3. Gerelateerde concepten die wel afbeeldingen hebben

Geef 5 nieuwe commonsQueries en 5 nieuwe categoryHints.
Focus op Commons-native termen en bestaande categorieën.

Antwoord als JSON:
{
  "commonsQueries": ["query1", "query2", "query3", "query4", "query5"],
  "categoryHints": ["Category:Hint1", "Category:Hint2", "Category:Hint3", "Category:Hint4", "Category:Hint5"],
  "topicKeywords": ["keyword1", "keyword2"]
}

Geef ALLEEN de JSON.`;

  try {
    const response = await fetch(`${GEMINI_API_URL}/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 1000 }
      })
    });

    if (!response.ok) return null;

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    return null;
  }
}

/**
 * Wikipedia fallback - get article thumbnail
 */
async function getWikipediaImage(articleTitle) {
  const params = new URLSearchParams({
    action: 'query',
    titles: articleTitle,
    prop: 'pageimages|info',
    inprop: 'url',
    pithumbsize: '800',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!res.ok) return null;

  const data = await res.json();
  const page = Object.values(data.query?.pages || {})[0];

  if (page?.thumbnail?.source) {
    return {
      title: page.title,
      imageUrl: page.thumbnail.source,
      descriptionUrl: page.fullurl,
      width: page.thumbnail.width,
      height: page.thumbnail.height,
      mime: 'image/jpeg', // Wikipedia thumbnails are usually JPEG
      description: '',
      categories: [],
      source: 'wikipedia',
    };
  }
  return null;
}

/**
 * Enhanced deterministic scoring with categories and risk profiles
 */
function scoreCandidate(candidate, brief, usedImages) {
  // Hard disqualifications
  if (usedImages.has(candidate.imageUrl)) return -1000;

  const validImageMimes = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/gif', 'image/webp', 'image/tiff'];
  if (candidate.mime && !validImageMimes.includes(candidate.mime)) return -1000;

  let score = 0;
  const titleLower = (candidate.title || '').toLowerCase();
  const descLower = (candidate.description || '').toLowerCase();
  const combined = titleLower + ' ' + descLower;
  const categoriesLower = (candidate.categories || []).join(' ').toLowerCase();
  const allText = combined + ' ' + categoriesLower;

  // === CATEGORY MATCHING with topic gating ===
  // Only give category bonus if topicKeywords also match (prevents wrong Gray's Anatomy plate)
  const topicKeywords = (brief.topicKeywords || []).map(k => k.toLowerCase());
  const hasTopicMatch = topicKeywords.length === 0 ||
    topicKeywords.some(kw => allText.includes(kw));

  for (const hint of (brief.categoryHints || [])) {
    const hintLower = hint.replace('Category:', '').toLowerCase();
    if (categoriesLower.includes(hintLower)) {
      if (hasTopicMatch) {
        score += 60; // Full category bonus with topic match
      } else {
        score += 20; // Reduced bonus without topic match
      }
    }
  }

  // Bonus for being in known good categories (also gated by topic)
  const goodCategories = ['gray', 'anatomy diagram', 'human anatomy', 'medical illustration',
    'historical map', 'climate diagram', 'molecular model'];
  for (const good of goodCategories) {
    if (categoriesLower.includes(good)) {
      score += hasTopicMatch ? 30 : 10;
    }
  }

  // === INTENT GATING ===
  const intent = brief.imageIntent || '';

  if (intent.includes('diagram') || intent === 'labeled_diagram') {
    // Diagram intents: require diagram signals
    const hasDiagramSignal =
      candidate.mime === 'image/svg+xml' ||
      titleLower.includes('.svg') ||
      allText.includes('diagram') ||
      allText.includes('labeled') ||
      allText.includes('plate') ||
      allText.includes('illustration') ||
      allText.includes('drawing');

    if (hasDiagramSignal) {
      score += 40;
      if (candidate.mime === 'image/svg+xml') score += 20; // Extra SVG bonus
    } else {
      score -= 40; // Penalty for photo when diagram expected
    }
  }

  // v3.2: concept_diagram intent for abstract concepts
  if (intent === 'concept_diagram') {
    // Bonus for concept diagram signals
    for (const token of CONCEPT_DIAGRAM_TOKENS) {
      if (allText.includes(token)) {
        score += 40;
        break;
      }
    }
    // SVG bonus for concept diagrams
    if (candidate.mime === 'image/svg+xml') score += 20;
    // Penalty for photos without teaching signals
    const hasTeachingSignal = CONCEPT_DIAGRAM_TOKENS.some(t => allText.includes(t)) ||
      allText.includes('diagram') || allText.includes('illustration');
    if (!hasTeachingSignal) {
      score -= 60;
    }
  }

  if (intent === 'map') {
    if (allText.includes('map')) {
      score += 40;
    } else {
      score -= 30;
    }
    // v3.2: Map legibility bonus for larger images
    if (candidate.width >= 1200) score += 20;
    else if (candidate.width < 800) score -= 20;
  }

  if (intent === 'historical_illustration') {
    if (allText.includes('historical') || allText.includes('ancient') ||
        allText.includes('medieval') || allText.includes('century') ||
        allText.includes('roman') || allText.includes('greek')) {
      score += 30;
    }
  }

  // === RISK PROFILE PENALTIES ===
  const risk = brief.riskProfile || 'none';

  if (risk === 'human_vs_animal') {
    // Check for animal tokens - heavy penalty
    for (const token of ANIMAL_TOKENS) {
      if (allText.includes(token)) {
        score -= 80;
        break; // One match is enough
      }
    }
    // Bonus for human anatomy tokens
    for (const token of HUMAN_ANATOMY_TOKENS) {
      if (allText.includes(token)) {
        score += 20;
        break;
      }
    }
  }

  if (risk === 'historical_vs_modern') {
    // Penalty for modern/photo indicators
    if (allText.includes('photograph') || allText.includes('photo ') ||
        allText.includes('2000s') || allText.includes('2010s') || allText.includes('2020s')) {
      score -= 50;
    }
  }

  if (risk === 'diagram_vs_photo') {
    // Already handled by intent gating, but extra penalty for stock photos
    for (const token of STOCK_TOKENS) {
      if (allText.includes(token)) {
        score -= 100;
        break;
      }
    }
  }

  // v3.2: thematic_vs_tourist for aardrijkskunde
  if (risk === 'thematic_vs_tourist') {
    for (const token of TOURIST_MAP_TOKENS) {
      if (allText.includes(token)) {
        score -= 60;
        break;
      }
    }
  }

  // v3.2: mythology_vs_popculture for latijn
  if (risk === 'mythology_vs_popculture') {
    for (const token of POPCULTURE_TOKENS) {
      if (allText.includes(token)) {
        score -= 80;
        break;
      }
    }
    // Bonus for authentic ancient content
    if (allText.includes('roman') || allText.includes('ancient') ||
        allText.includes('mosaic') || allText.includes('fresco') ||
        allText.includes('inscription') || allText.includes('artifact')) {
      score += 30;
    }
  }

  // v3.2: Global stock photo penalty
  for (const token of STOCK_TOKENS) {
    if (allText.includes(token)) {
      score -= 80;
      break;
    }
  }

  // v3.2: Global popculture penalty (applies to all subjects)
  for (const token of POPCULTURE_TOKENS) {
    if (allText.includes(token)) {
      score -= 40;
      break;
    }
  }

  // v3.2: Educational quality bonus
  for (const token of EDUCATIONAL_TOKENS) {
    if (allText.includes(token)) {
      score += 20;
      break; // Only one bonus
    }
  }

  // === KEYWORD MATCHING ===
  for (const keyword of (brief.mustHaveKeywords || [])) {
    if (combined.includes(keyword.toLowerCase())) {
      score += 30;
    }
  }

  // Search term matching (use commonsQueries or fallback to searchTerms)
  const searchTerms = brief.commonsQueries || brief.searchTerms || [];
  for (const term of searchTerms) {
    // Remove special syntax for matching
    const cleanTerm = term.replace(/incategory:"[^"]*"/g, '').replace(/-\w+/g, '').trim();
    const words = cleanTerm.toLowerCase().split(' ');
    for (const word of words) {
      if (word.length > 3 && combined.includes(word)) {
        score += 10;
      }
    }
  }

  // === AVOID KEYWORDS ===
  for (const avoid of (brief.avoidKeywords || [])) {
    if (allText.includes(avoid.toLowerCase())) {
      score -= 50;
    }
  }

  // === QUALITY ===
  if (candidate.width >= 600 && candidate.height >= 400) score += 10;
  if (candidate.width < 200 || candidate.height < 150) score -= 30;

  // Wikipedia fallback gets small bonus (curated)
  if (candidate.source === 'wikipedia') score += 15;

  return score;
}

/**
 * Find the best image for a single question brief
 * v3.1: Implements negation ladder and score-based fallback
 * v3.3: Subject-specific thresholds
 */
async function findBestImage(brief, usedImages, subject = null) {
  const candidates = [];
  const minScore = getMinScore(brief.imageIntent, subject);

  // 1. Try category search first (highest quality)
  for (const category of (brief.categoryHints || []).slice(0, 2)) {
    try {
      const results = await searchCommonsCategory(category, 15);
      candidates.push(...results);
      await sleep(100);
    } catch (err) { /* continue */ }
  }

  // 2. Try Commons queries (strict → relaxed → broad)
  const queries = brief.commonsQueries || brief.searchTerms || [];
  for (const query of queries.slice(0, 3)) {
    try {
      const results = await searchCommons(query, 10);
      candidates.push(...results);
      await sleep(100);
    } catch (err) { /* continue */ }
  }

  // 3. NEGATION LADDER: If queries with negations gave 0 results, retry without negations
  if (candidates.length === 0) {
    for (const query of queries.slice(0, 3)) {
      if (hasNegations(query)) {
        const cleanQuery = stripNegations(query);
        if (cleanQuery && cleanQuery !== query) {
          try {
            const results = await searchCommons(cleanQuery, 10);
            candidates.push(...results);
            await sleep(100);
          } catch (err) { /* continue */ }
        }
      }
    }
  }

  // Score what we have so far
  let scored = candidates.map(c => ({
    ...c,
    score: scoreCandidate(c, brief, usedImages),
  }));
  scored.sort((a, b) => b.score - a.score);
  let best = scored.find(c => c.score >= minScore);

  // 4. SCORE-BASED FALLBACK: Try Wikipedia if no candidates OR best score is too low
  if ((!best || best.score < minScore) && brief.wikipediaFallback) {
    try {
      const wikiImage = await getWikipediaImage(brief.wikipediaFallback);
      if (wikiImage) {
        wikiImage.score = scoreCandidate(wikiImage, brief, usedImages);
        // Use Wikipedia image if it's better than what we have
        if (!best || wikiImage.score > best.score) {
          best = wikiImage;
        }
      }
    } catch (err) { /* continue */ }
  }

  // 5. If still no good result, try broader search terms without category prefix
  if (!best || best.score < minScore) {
    const lastQuery = queries[queries.length - 1];
    if (lastQuery) {
      const broadQuery = stripNegations(lastQuery).replace(/incategory:"[^"]*"/g, '').trim();
      if (broadQuery) {
        try {
          const results = await searchCommons(broadQuery, 15);
          for (const r of results) {
            r.score = scoreCandidate(r, brief, usedImages);
            if (!best || r.score > best.score) {
              best = r;
            }
          }
        } catch (err) { /* continue */ }
      }
    }
  }

  return best && best.score >= MIN_ACCEPT_SCORE.default ? best : null;
}

/**
 * Generate a local repair brief for questions the AI missed
 * v3.2: Uses subject profiles and detects abstract concepts
 */
function generateLocalRepairBrief(question, subject) {
  const text = question.q || question.instruction || question.prompt?.text || question.prompt?.html || '';
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

  // Extract meaningful words (longer than 3 chars, not common words)
  const stopWords = ['what', 'which', 'where', 'when', 'does', 'have', 'been', 'from', 'with', 'this', 'that', 'their', 'about',
    'welke', 'wanneer', 'waarom', 'hoe', 'zijn', 'wordt', 'kunnen', 'noem', 'geef', 'beschrijf'];
  const words = clean.split(/\s+/).filter(w => w.length > 3 && !stopWords.includes(w));

  // Get subject profile defaults
  const subjectLower = (subject || '').toLowerCase();
  const profile = SUBJECT_PROFILES[subjectLower] || {};

  // Detect intent based on subject and keywords
  let imageIntent = profile.defaultIntent || 'photo';
  let riskProfile = profile.riskProfile || 'none';
  let categoryHints = [...(profile.categoryHints || [])];

  // v3.2: Detect abstract concepts for biologie -> use concept_diagram
  if (subjectLower === 'biologie') {
    const isAbstract = ABSTRACT_CONCEPT_KEYWORDS.some(kw => clean.includes(kw));
    if (isAbstract) {
      imageIntent = 'concept_diagram';
      categoryHints = ['Physiology diagrams', 'Neurology diagrams', 'Homeostasis'];
    } else if (clean.includes('anatom') || clean.includes('skelet') || clean.includes('spier') ||
               clean.includes('gewricht') || clean.includes('bot')) {
      imageIntent = 'labeled_diagram';
    }
  } else if (subjectLower === 'aardrijkskunde') {
    if (clean.includes('kaart') || clean.includes('land') || clean.includes('continent') ||
        clean.includes('oceaan') || clean.includes('zee')) {
      imageIntent = 'map';
    } else if (clean.includes('klimaat') || clean.includes('weer') || clean.includes('neerslag')) {
      imageIntent = 'diagram';
      categoryHints = ['Climate diagrams', 'Weather diagrams'];
    }
  } else if (subjectLower === 'latijn') {
    riskProfile = 'mythology_vs_popculture';
  }

  return {
    questionId: question.id,
    imageIntent,
    commonsQueries: [
      words.slice(0, 3).join(' ') + ' diagram',
      words.slice(0, 2).join(' '),
      words[0] || 'education',
    ],
    mustHaveKeywords: words.slice(0, 2),
    avoidKeywords: [],
    categoryHints: categoryHints.slice(0, 3),
    riskProfile,
    topicKeywords: words.slice(0, 3),
    _repaired: true,
  };
}

/**
 * Process a batch of questions
 * v3.3: Added imagePolicy handling and escalation tracking
 */
async function processBatch(questions, subject, chapterContext, usedImages, batchNum, totalBatches, escalationState) {
  console.log(`\n[Batch ${batchNum}/${totalBatches}] Generating search terms for ${questions.length} questions...`);

  let briefs;
  try {
    briefs = await withRetry(() => generateBatchSearchTerms(questions, subject, chapterContext));
  } catch (err) {
    console.log(`  ✗ AI error: ${err.message}`);
    return questions.map(q => ({
      questionId: q.id,
      success: false,
      reason: `AI batch error: ${err.message}`,
    }));
  }

  const briefMap = new Map(briefs.map(b => [b.questionId, b]));

  // AI COVERAGE CHECK: Generate local repair briefs for missed questions
  let repairedCount = 0;
  for (const question of questions) {
    if (!briefMap.has(question.id)) {
      const repairBrief = generateLocalRepairBrief(question, subject);
      briefMap.set(question.id, repairBrief);
      repairedCount++;
    }
  }
  if (repairedCount > 0) {
    console.log(`  (repaired ${repairedCount} missing briefs locally)`);
  }

  const results = [];

  for (const question of questions) {
    const brief = briefMap.get(question.id);

    process.stdout.write(`  ${question.id}: `);

    // v3.3: Check imagePolicy first
    const policy = getImagePolicy(question, subject);
    if (policy === 'none') {
      results.push({
        questionId: question.id,
        success: true,
        imagePolicy: 'none',
        reason: 'No image needed (grammar question)',
      });
      console.log(`○ No image needed (grammar)`);
      continue;
    }

    try {
      let bestImage = await findBestImage(brief, usedImages, subject);
      const minScore = getMinScore(brief.imageIntent, subject);

      // v3.3: Escalation - try per-question AI if initial search fails
      if ((!bestImage || bestImage.score < minScore) && escalationState.count < MAX_ESCALATIONS_PER_QUIZ) {
        const escalatedBrief = await escalateWithAI(question, subject, chapterContext);
        if (escalatedBrief) {
          escalationState.count++;
          // Merge escalated brief with original
          const mergedBrief = {
            ...brief,
            commonsQueries: escalatedBrief.commonsQueries || brief.commonsQueries,
            categoryHints: escalatedBrief.categoryHints || brief.categoryHints,
            topicKeywords: escalatedBrief.topicKeywords || brief.topicKeywords,
            _escalated: true,
          };
          bestImage = await findBestImage(mergedBrief, usedImages, subject);
        }
      }

      if (bestImage && bestImage.score >= minScore) {
        usedImages.add(bestImage.imageUrl);
        results.push({
          questionId: question.id,
          success: true,
          imageUrl: bestImage.imageUrl,
          title: bestImage.title,
          descriptionUrl: bestImage.descriptionUrl,
          searchTerm: (brief.commonsQueries || brief.searchTerms || [])[0],
          imageIntent: brief.imageIntent,
          riskProfile: brief.riskProfile,
          score: bestImage.score,
          source: bestImage.source || 'commons',
          repaired: brief._repaired || false,
          escalated: brief._escalated || false,
        });
        const shortTitle = bestImage.title.length > 45 ? bestImage.title.substring(0, 45) + '...' : bestImage.title;
        const repairedTag = brief._repaired ? ' [repaired]' : '';
        const escalatedTag = brief._escalated ? ' [escalated]' : '';
        console.log(`✓ ${shortTitle} (score: ${bestImage.score}, min: ${minScore})${repairedTag}${escalatedTag}`);
      } else {
        results.push({
          questionId: question.id,
          success: false,
          reason: bestImage ? `Low score: ${bestImage.score} (min: ${minScore})` : 'No candidates found',
          queries: brief.commonsQueries,
          repaired: brief._repaired || false,
        });
        console.log(`✗ No suitable image (min: ${minScore})`);
      }
    } catch (err) {
      results.push({ questionId: question.id, success: false, reason: err.message });
      console.log(`✗ ${err.message}`);
    }
  }

  return results;
}

/**
 * Main function: process quiz file
 * v3.3: Added imagePolicy filtering, escalation state, and grammar question handling
 */
async function processQuiz(quizPath, applyChanges = false, replaceExisting = false) {
  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
  const questions = quiz.questions || quiz.question_bank || [];
  const subject = quiz.subject || path.basename(path.dirname(quizPath));
  const chapterContext = quiz.title || quiz.chapter || '';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${path.basename(quizPath)}`);
  console.log(`Subject: ${subject}`);
  console.log(`Context: ${chapterContext}`);
  console.log(`Total questions: ${questions.length}`);
  if (replaceExisting) console.log(`Mode: REPLACE ALL IMAGES`);
  console.log(`${'='.repeat(60)}`);

  const usedImages = new Set();
  const allResults = [];
  const escalationState = { count: 0 }; // v3.3: Track escalations across batches

  // v3.3: Filter questions, but include grammar questions (they'll be handled with imagePolicy)
  const needsImage = questions.filter(q => {
    const skipTypes = ['matching', 'table_parse', 'ratio_table', 'data_table', 'fill_blank'];
    if (skipTypes.includes(q.type)) return false;
    if (replaceExisting) return true;
    const mediaItems = Array.isArray(q.media) ? q.media : (q.media ? [q.media] : []);
    const hasImage = mediaItems.some(m => m.type === 'image' && m.src);
    return !hasImage;
  });

  // v3.3: Count grammar questions that will be skipped
  const grammarCount = needsImage.filter(q => getImagePolicy(q, subject) === 'none').length;
  const imageCount = needsImage.length - grammarCount;

  console.log(`Questions to process: ${needsImage.length}`);
  if (grammarCount > 0) {
    console.log(`  (${grammarCount} grammar questions - no image needed)`);
    console.log(`  (${imageCount} questions need images)`);
  }

  if (needsImage.length === 0) {
    console.log('All questions already have images!');
    return { results: [], successCount: 0 };
  }

  const totalBatches = Math.ceil(needsImage.length / BATCH_SIZE);

  for (let i = 0; i < needsImage.length; i += BATCH_SIZE) {
    const batch = needsImage.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batchResults = await processBatch(batch, subject, chapterContext, usedImages, batchNum, totalBatches, escalationState);
    allResults.push(...batchResults);

    if (i + BATCH_SIZE < needsImage.length) {
      console.log(`\nWaiting before next batch...`);
      await sleep(BASE_DELAY);
    }
  }

  const successCount = allResults.filter(r => r.success).length;
  const imageSuccessCount = allResults.filter(r => r.success && r.imagePolicy !== 'none').length;
  const noImageCount = allResults.filter(r => r.imagePolicy === 'none').length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${successCount}/${needsImage.length} questions handled`);
  if (noImageCount > 0) {
    console.log(`  - ${imageSuccessCount} images found`);
    console.log(`  - ${noImageCount} grammar questions (no image needed)`);
  }
  if (escalationState.count > 0) {
    console.log(`  - ${escalationState.count} questions escalated to per-question AI`);
  }
  console.log(`${'='.repeat(60)}`);

  if (applyChanges && successCount > 0) {
    const successResults = allResults.filter(r => r.success && r.imageUrl);
    const resultMap = new Map(successResults.map(r => [r.questionId, r]));

    for (const q of questions) {
      const result = resultMap.get(q.id);
      if (result) {
        q.media = [{
          type: 'image',
          src: result.imageUrl,
          alt: result.title,
          caption: `Bron: ${result.source === 'wikipedia' ? 'Wikipedia' : 'Wikimedia Commons'}`,
          _source: 'commons-ai-v3.3',
          _searchTerm: result.searchTerm,
          _imageIntent: result.imageIntent,
          _riskProfile: result.riskProfile,
          _score: result.score,
          _escalated: result.escalated || false,
        }];
      }
    }

    fs.writeFileSync(quizPath, JSON.stringify(quiz, null, 2));
    console.log(`\n✓ Applied ${imageSuccessCount} images to ${path.basename(quizPath)}`);
  }

  const outputPath = quizPath.replace('.json', '-ai-selections.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    results: allResults,
    successCount,
    imageSuccessCount,
    noImageCount,
    escalationCount: escalationState.count,
    total: needsImage.length,
    timestamp: new Date().toISOString(),
    version: 'v3.3',
  }, null, 2));
  console.log(`Results saved to: ${path.basename(outputPath)}`);

  return { results: allResults, successCount };
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (!process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY not set\n');
    console.error('Usage:');
    console.error('  GEMINI_API_KEY=key node ai-select-images.js --quiz <file.json>');
    console.error('  GEMINI_API_KEY=key node ai-select-images.js --quiz <file.json> --apply');
    console.error('  GEMINI_API_KEY=key node ai-select-images.js --quiz <file.json> --replace --apply');
    process.exit(1);
  }

  const quizIndex = args.indexOf('--quiz');
  if (quizIndex === -1 || !args[quizIndex + 1]) {
    console.error('Please specify a quiz file with --quiz <file.json>');
    process.exit(1);
  }

  const quizPath = path.resolve(args[quizIndex + 1]);
  if (!fs.existsSync(quizPath)) {
    console.error(`File not found: ${quizPath}`);
    process.exit(1);
  }

  const applyChanges = args.includes('--apply');
  const replaceExisting = args.includes('--replace');

  await processQuiz(quizPath, applyChanges, replaceExisting);
}

main().catch(console.error);
