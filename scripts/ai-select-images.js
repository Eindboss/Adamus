/**
 * AI-powered image selection for quiz questions (v3.6)
 *
 * Uses Gemini AI to generate optimal search terms in BATCHES,
 * then fetches images from multiple sources with AI VISION validation.
 *
 * v3.6 Improvements (based on ChatGPT analysis of 46% failure rate):
 * - CONCEPT MATCHING: expectedConcept/allowedConcepts per question
 *   → Prevents "breast for skeleton question" errors
 * - LANGUAGE GATE: Hard reject non-NL/EN text in images
 *   → Prevents Polish/Ukrainian/Lithuanian diagram labels
 * - FAIL-CLOSED FALLBACK: No image is better than wrong image
 *   → Prevents "soup for collagen question" errors
 * - CONTENT-TYPE GATE: Reject abstract_art, network_graph, table_wordlist
 *   → Prevents completely irrelevant images
 * - CANONICAL DEDUP: Use pageid/title instead of URL for deduplication
 *   → Prevents same image appearing twice
 * - COMPLEXITY GATE: Reject images too complex for 14-16 year olds
 *
 * Previous versions:
 * - v3.5: AI vision validation (looks at images)
 * - v3.4: Multi-source (Unsplash, Pexels, Commons)
 * - v3.3: imagePolicy, escalation, Latin grammar
 * - v3.2: concept_diagram, subject profiles
 * - v3.1: negation ladder, score thresholds
 * - v3.0: categories, riskProfiles, intent gating
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
const UNSPLASH_API = 'https://api.unsplash.com';
const PEXELS_API = 'https://api.pexels.com/v1';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.0-flash-exp';

// Batch settings
const BATCH_SIZE = 10; // Reduced from 12 to avoid rate limits
const MAX_RETRIES = 3;
const BASE_DELAY = 3000; // Increased from 2000ms
const MAX_ESCALATIONS_PER_QUIZ = 10; // v3.3: Cap per-question AI escalations
const VISION_DELAY = 500; // Delay between AI vision calls (was 200ms)
const BATCH_DELAY = 5000; // Delay between batches (was implicit)

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

// v3.6: CONCEPT VOCABULARY for biologie
// Maps question keywords to expected concepts for validation
// This prevents "breast for skeleton question" errors
const BIOLOGIE_CONCEPT_VOCABULARY = {
  // Skeleton/bones
  skelet: { expectedConcept: 'skeleton', allowedConcepts: ['skeleton', 'bone', 'skull', 'spine', 'vertebra', 'rib', 'pelvis', 'femur', 'tibia'] },
  bot: { expectedConcept: 'bone', allowedConcepts: ['bone', 'skeleton', 'femur', 'tibia', 'humerus', 'bone_tissue', 'osteon'] },
  botten: { expectedConcept: 'bone', allowedConcepts: ['bone', 'skeleton', 'femur', 'tibia', 'humerus', 'bone_tissue'] },
  beenderen: { expectedConcept: 'bone', allowedConcepts: ['bone', 'skeleton'] },
  schedel: { expectedConcept: 'skull', allowedConcepts: ['skull', 'cranium', 'head', 'skeleton'] },
  wervelkolom: { expectedConcept: 'spine', allowedConcepts: ['spine', 'vertebra', 'backbone', 'skeleton'] },
  wervel: { expectedConcept: 'vertebra', allowedConcepts: ['vertebra', 'spine', 'backbone', 'skeleton'] },
  ribben: { expectedConcept: 'rib', allowedConcepts: ['rib', 'ribcage', 'thorax', 'skeleton'] },
  bekken: { expectedConcept: 'pelvis', allowedConcepts: ['pelvis', 'hip', 'skeleton'] },
  fontanel: { expectedConcept: 'fontanelle', allowedConcepts: ['fontanelle', 'skull', 'baby_skull', 'cranium'] },

  // Bone tissue
  botweefsel: { expectedConcept: 'bone_tissue', allowedConcepts: ['bone_tissue', 'osteon', 'bone_cell', 'osteocyte', 'compact_bone', 'spongy_bone'] },
  beenmerg: { expectedConcept: 'bone_marrow', allowedConcepts: ['bone_marrow', 'marrow', 'bone'] },
  collageen: { expectedConcept: 'collagen', allowedConcepts: ['collagen', 'bone_tissue', 'connective_tissue', 'fibers'] },
  kraakbeen: { expectedConcept: 'cartilage', allowedConcepts: ['cartilage', 'joint', 'bone'] },

  // Joints
  gewricht: { expectedConcept: 'joint', allowedConcepts: ['joint', 'knee', 'elbow', 'hip', 'shoulder', 'synovial'] },
  gewrichten: { expectedConcept: 'joint', allowedConcepts: ['joint', 'knee', 'elbow', 'hip', 'shoulder', 'synovial'] },
  knie: { expectedConcept: 'knee', allowedConcepts: ['knee', 'joint', 'leg'] },
  elleboog: { expectedConcept: 'elbow', allowedConcepts: ['elbow', 'joint', 'arm'] },
  schouder: { expectedConcept: 'shoulder', allowedConcepts: ['shoulder', 'joint', 'arm'] },
  heup: { expectedConcept: 'hip', allowedConcepts: ['hip', 'joint', 'pelvis'] },
  gewrichtssmeer: { expectedConcept: 'synovial_fluid', allowedConcepts: ['synovial_fluid', 'joint', 'synovial'] },
  synoviale: { expectedConcept: 'synovial', allowedConcepts: ['synovial', 'joint', 'synovial_fluid'] },

  // Muscles
  spier: { expectedConcept: 'muscle', allowedConcepts: ['muscle', 'biceps', 'triceps', 'quadriceps', 'muscle_fiber'] },
  spieren: { expectedConcept: 'muscle', allowedConcepts: ['muscle', 'biceps', 'triceps', 'quadriceps', 'muscle_fiber', 'muscular_system'] },
  biceps: { expectedConcept: 'biceps', allowedConcepts: ['biceps', 'arm_muscle', 'muscle'] },
  triceps: { expectedConcept: 'triceps', allowedConcepts: ['triceps', 'arm_muscle', 'muscle'] },
  spiervezel: { expectedConcept: 'muscle_fiber', allowedConcepts: ['muscle_fiber', 'myofibril', 'muscle'] },
  samentrekken: { expectedConcept: 'muscle_contraction', allowedConcepts: ['muscle_contraction', 'muscle', 'contraction'] },
  samentrekking: { expectedConcept: 'muscle_contraction', allowedConcepts: ['muscle_contraction', 'muscle', 'contraction'] },
  antagonist: { expectedConcept: 'antagonist_muscle', allowedConcepts: ['antagonist_muscle', 'muscle_pair', 'biceps_triceps', 'muscle'] },

  // Nervous system
  zenuw: { expectedConcept: 'nerve', allowedConcepts: ['nerve', 'neuron', 'nervous_system'] },
  zenuwen: { expectedConcept: 'nerve', allowedConcepts: ['nerve', 'neuron', 'nervous_system'] },
  zenuwstelsel: { expectedConcept: 'nervous_system', allowedConcepts: ['nervous_system', 'brain', 'spinal_cord', 'nerve'] },
  hersenen: { expectedConcept: 'brain', allowedConcepts: ['brain', 'cerebrum', 'nervous_system'] },
  ruggenmerg: { expectedConcept: 'spinal_cord', allowedConcepts: ['spinal_cord', 'spine', 'nervous_system'] },
  reflex: { expectedConcept: 'reflex', allowedConcepts: ['reflex', 'reflex_arc', 'nervous_system', 'spinal_cord'] },
  reflexboog: { expectedConcept: 'reflex_arc', allowedConcepts: ['reflex_arc', 'reflex', 'nervous_system'] },
  motorisch: { expectedConcept: 'motor', allowedConcepts: ['motor_neuron', 'motor_cortex', 'muscle', 'movement'] },

  // RSI / posture
  rsi: { expectedConcept: 'rsi', allowedConcepts: ['rsi', 'repetitive_strain', 'ergonomics', 'wrist', 'posture', 'computer_work'] },
  houding: { expectedConcept: 'posture', allowedConcepts: ['posture', 'sitting', 'standing', 'ergonomics', 'spine'] },
  zithouding: { expectedConcept: 'sitting_posture', allowedConcepts: ['sitting_posture', 'posture', 'ergonomics', 'chair', 'desk'] },
  ergonomie: { expectedConcept: 'ergonomics', allowedConcepts: ['ergonomics', 'posture', 'workspace'] },

  // Training / movement
  training: { expectedConcept: 'training', allowedConcepts: ['training', 'exercise', 'fitness', 'sport', 'muscle'] },
  squats: { expectedConcept: 'squats', allowedConcepts: ['squats', 'leg_exercise', 'training', 'quadriceps'] },
  opwarmen: { expectedConcept: 'warmup', allowedConcepts: ['warmup', 'stretching', 'exercise', 'training'] },
  stretchen: { expectedConcept: 'stretching', allowedConcepts: ['stretching', 'flexibility', 'warmup', 'muscle'] },
  bewegen: { expectedConcept: 'movement', allowedConcepts: ['movement', 'exercise', 'muscle', 'joint'] },
  beweging: { expectedConcept: 'movement', allowedConcepts: ['movement', 'exercise', 'muscle', 'joint'] },
};

// v3.6: Content types that should ALWAYS be rejected
const REJECT_CONTENT_TYPES = [
  'abstract_art',
  'network_graph',
  'table_wordlist',
  'map_transit',
  'music_instrument',
  'food_drink',
  'scientific_method',
  'unrelated_diagram',
];

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
 * v3.6: Extract expected concept and allowed concepts from question text
 * Uses BIOLOGIE_CONCEPT_VOCABULARY to map Dutch keywords to concepts
 */
function extractExpectedConcepts(questionText, subject) {
  if (!subject || subject.toLowerCase() !== 'biologie') {
    return { expectedConcept: null, allowedConcepts: [] };
  }

  const clean = questionText.replace(/<[^>]+>/g, ' ').toLowerCase();
  const allAllowed = new Set();
  let primaryConcept = null;

  // Check each vocabulary entry
  for (const [keyword, mapping] of Object.entries(BIOLOGIE_CONCEPT_VOCABULARY)) {
    if (clean.includes(keyword)) {
      if (!primaryConcept) {
        primaryConcept = mapping.expectedConcept;
      }
      mapping.allowedConcepts.forEach(c => allAllowed.add(c));
    }
  }

  return {
    expectedConcept: primaryConcept,
    allowedConcepts: Array.from(allAllowed),
  };
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

// v3.6: Track rate limit state per API to apply adaptive delays
const rateLimitState = {
  gemini: { lastRateLimit: 0, backoffMs: 200 },
  unsplash: { lastRateLimit: 0, backoffMs: 100 },
  pexels: { lastRateLimit: 0, backoffMs: 100 },
  commons: { lastRateLimit: 0, backoffMs: 100 },
};

/**
 * v3.6: Enhanced retry with exponential backoff and rate limit tracking
 */
async function withRetry(fn, retries = MAX_RETRIES, apiName = 'gemini') {
  const state = rateLimitState[apiName] || rateLimitState.gemini;

  // Apply adaptive delay if we were recently rate limited
  const timeSinceRateLimit = Date.now() - state.lastRateLimit;
  if (timeSinceRateLimit < 60000 && state.backoffMs > 200) {
    await sleep(state.backoffMs);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      // Success: gradually reduce backoff
      if (state.backoffMs > 200) {
        state.backoffMs = Math.max(200, state.backoffMs * 0.8);
      }
      return result;
    } catch (err) {
      const isRateLimit = err.message.includes('429') || err.message.includes('rate') || err.message.includes('quota');
      const isLastAttempt = attempt === retries;

      if (isRateLimit) {
        // Track rate limit event
        state.lastRateLimit = Date.now();
        state.backoffMs = Math.min(30000, state.backoffMs * 2); // Max 30s backoff
      }

      if (isLastAttempt || !isRateLimit) throw err;

      const delay = BASE_DELAY * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`  [${apiName}] Rate limited, waiting ${Math.round(delay / 1000)}s before retry (attempt ${attempt + 1}/${retries})...`);
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
    pageid: page.pageid, // v3.6: Include pageid for canonical dedup
    imageUrl: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url,
    descriptionUrl: page.imageinfo?.[0]?.descriptionurl,
    width: page.imageinfo?.[0]?.width,
    height: page.imageinfo?.[0]?.height,
    mime: page.imageinfo?.[0]?.mime,
    description: page.imageinfo?.[0]?.extmetadata?.ImageDescription?.value || '',
    categories: (page.categories || []).map(c => c.title?.replace('Category:', '') || ''),
    source: 'commons',
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
    pageid: page.pageid, // v3.6: Include pageid for canonical dedup
    imageUrl: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url,
    descriptionUrl: page.imageinfo?.[0]?.descriptionurl,
    width: page.imageinfo?.[0]?.width,
    height: page.imageinfo?.[0]?.height,
    mime: page.imageinfo?.[0]?.mime,
    description: page.imageinfo?.[0]?.extmetadata?.ImageDescription?.value || '',
    categories: (page.categories || []).map(c => c.title?.replace('Category:', '') || ''),
    source: 'commons',
  })).filter(img => img.imageUrl);
}

/**
 * v3.4: Search Unsplash for high-quality photos
 * Requires UNSPLASH_ACCESS_KEY environment variable
 */
async function searchUnsplash(searchTerm, limit = 10) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return [];

  try {
    const params = new URLSearchParams({
      query: searchTerm,
      per_page: String(limit),
      orientation: 'landscape',
    });

    const res = await fetch(`${UNSPLASH_API}/search/photos?${params}`, {
      headers: { 'Authorization': `Client-ID ${accessKey}` }
    });

    if (!res.ok) return [];

    const data = await res.json();
    return (data.results || []).map(photo => ({
      id: photo.id, // v3.6: Include ID for canonical dedup
      title: photo.description || photo.alt_description || searchTerm,
      imageUrl: photo.urls?.regular || photo.urls?.small,
      descriptionUrl: photo.links?.html,
      width: photo.width,
      height: photo.height,
      mime: 'image/jpeg',
      description: photo.description || '',
      categories: photo.tags?.map(t => t.title) || [],
      source: 'unsplash',
      attribution: `Photo by ${photo.user?.name} on Unsplash`,
    })).filter(img => img.imageUrl);
  } catch (err) {
    return [];
  }
}

/**
 * v3.4: Search Pexels for high-quality photos
 * Requires PEXELS_API_KEY environment variable
 */
async function searchPexels(searchTerm, limit = 10) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      query: searchTerm,
      per_page: String(limit),
      orientation: 'landscape',
    });

    const res = await fetch(`${PEXELS_API}/search?${params}`, {
      headers: { 'Authorization': apiKey }
    });

    if (!res.ok) return [];

    const data = await res.json();
    return (data.photos || []).map(photo => ({
      id: photo.id, // v3.6: Include ID for canonical dedup
      title: photo.alt || searchTerm,
      imageUrl: photo.src?.large || photo.src?.medium,
      descriptionUrl: photo.url,
      width: photo.width,
      height: photo.height,
      mime: 'image/jpeg',
      description: photo.alt || '',
      categories: [],
      source: 'pexels',
      attribution: `Photo by ${photo.photographer} on Pexels`,
    })).filter(img => img.imageUrl);
  } catch (err) {
    return [];
  }
}

/**
 * v3.6: Download image and convert to base64 for AI vision
 * Added timeout and better error handling
 */
async function fetchImageAsBase64(imageUrl) {
  try {
    // Add timeout to prevent hanging on slow/dead URLs
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow', // Follow redirects
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Skip if not an image
    if (!contentType.includes('image')) return null;

    const buffer = await response.arrayBuffer();

    // Skip empty or too small responses
    if (buffer.byteLength < 1000) return null;

    const base64 = Buffer.from(buffer).toString('base64');

    // Determine mime type
    let mimeType = 'image/jpeg';
    if (contentType.includes('png')) mimeType = 'image/png';
    else if (contentType.includes('gif')) mimeType = 'image/gif';
    else if (contentType.includes('webp')) mimeType = 'image/webp';
    else if (contentType.includes('svg')) mimeType = 'image/svg+xml';

    return { base64, mimeType };
  } catch (err) {
    // Silently fail - will be reported as "Could not download"
    return null;
  }
}

// v3.5: Intent-specific AI validation thresholds (ChatGPT recommendation)
const MIN_AI_SCORE_BY_INTENT = {
  labeled_diagram: 75,
  diagram: 70,
  concept_diagram: 65,
  map: 70,
  historical_illustration: 70,
  micrograph: 65,
  photo: 60,
  default: 60,
};

/**
 * Get minimum AI validation score for an intent
 */
function getMinAIScore(intent) {
  return MIN_AI_SCORE_BY_INTENT[intent] || MIN_AI_SCORE_BY_INTENT.default;
}

/**
 * v3.6: AI VISION validation - Gemini actually LOOKS at the image
 * Downloads the image as base64 and sends it to Gemini for visual analysis
 *
 * v3.6 improvements based on ChatGPT analysis of 46% failure rate:
 * - CONCEPT MATCHING: predicted_concept vs expectedConcept
 * - LANGUAGE GATE: Detect and reject non-NL/EN text
 * - CONTENT-TYPE GATE: Reject abstract_art, network_graph, etc.
 * - COMPLEXITY GATE: Check age appropriateness for 14-16 year olds
 * - Enhanced JSON contract with new fields
 */
async function validateImageWithAI(imageUrl, questionText, subject, brief) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { valid: false, score: 0, reason: 'No API key', hardReject: true };

  try {
    // Download the image as base64
    const imageData = await fetchImageAsBase64(imageUrl);
    if (!imageData) return { valid: false, score: 0, reason: 'Could not download image', hardReject: true };

    // Skip SVG validation (Gemini doesn't handle SVG well)
    if (imageData.mimeType === 'image/svg+xml') {
      return { valid: true, score: 60, reason: 'SVG - text-based validation only', image_type: 'diagram' };
    }

    const topicKeywords = brief.topicKeywords || [];
    const topicKeywordsStr = topicKeywords.join(', ') || '(none)';
    const intent = brief.imageIntent || 'photo';
    const riskProfile = brief.riskProfile || 'none';

    // v3.6: Extract expected concepts from question
    const { expectedConcept, allowedConcepts } = extractExpectedConcepts(questionText, subject);
    const expectedConceptStr = expectedConcept || '(any)';
    const allowedConceptsStr = allowedConcepts.length > 0 ? allowedConcepts.join(', ') : '(any)';

    // v3.6: Enhanced prompt with new JSON contract
    const prompt = `Je bent een ZEER STRENGE beoordelaar van educatieve afbeeldingen voor Nederlandse middelbare scholieren (14-16 jaar).

VAK: ${subject || 'Onbekend'}
VRAAG: ${questionText}
INTENT: ${intent}
TOPIC KEYWORDS: ${topicKeywordsStr}
RISK PROFILE: ${riskProfile}
EXPECTED CONCEPT: ${expectedConceptStr}
ALLOWED CONCEPTS: ${allowedConceptsStr}

ABSOLUTE HARD REJECT RULES (valid=false):
1. TAAL: Als er tekst in de afbeelding staat die NIET Nederlands of Engels is → REJECT
2. CONTENT TYPE: Als de afbeelding een van deze types is → REJECT:
   - abstract_art (abstracte kunst, gekleurde lijnen/vormen zonder anatomische betekenis)
   - network_graph (netwerk/graph diagrammen die geen anatomie tonen)
   - table_wordlist (tabellen met woordenlijsten)
   - map_transit (metro/bus/trein kaarten)
   - music_instrument (muziekinstrumenten)
   - food_drink (eten/drinken zoals soep, gerechten)
   - scientific_method (wetenschappelijke methode diagrammen)
   - unrelated_diagram (diagrammen die NIETS met het onderwerp te maken hebben)
3. CONCEPT MATCH: Als EXPECTED CONCEPT gegeven is en de afbeelding toont iets COMPLEET anders → REJECT
   Voorbeeld: vraag over skelet maar afbeelding toont borstklier → REJECT
4. HUMAN VS ANIMAL: Als RISK PROFILE = human_vs_animal en je ziet GEEN mens → REJECT
5. READABILITY: Als de afbeelding te klein, vaag, of onleesbaar is → REJECT
6. COMPLEXITY: Als het te complex is voor 14-16 jarigen (bijv. zeer gedetailleerd medisch diagram) → REJECT

WERKWIJZE:
1) Beschrijf kort wat je ECHT ziet (max 2 zinnen). Wees specifiek.
2) Detecteer eventuele tekst en de taal ervan.
3) Bepaal welk concept de afbeelding werkelijk toont (predicted_concept).
4) Beoordeel of het concept past bij de vraag.
5) Score ALLEEN als alle reject rules zijn gepasseerd.

Antwoord als JSON:
{
  "valid": true/false,
  "score": 0-100,
  "observations": "wat zie je echt (1-2 zinnen)",
  "predicted_concept": "wat de afbeelding werkelijk toont (bijv: skeleton, muscle, bone, breast, soup, abstract_art)",
  "concept_matches": true/false,
  "detected_subject": "human|animal|mixed|unknown",
  "has_text": true/false,
  "text_languages": ["nl", "en", "pl", "uk", "lt", "de", "other"],
  "content_type": "photo|labeled_diagram|diagram|abstract_art|network_graph|table_wordlist|map_transit|food_drink|music_instrument|unknown",
  "image_type": "photo|labeled_diagram|diagram|map|text_heavy|unknown",
  "readability": "good|ok|poor",
  "complexity_level": "simple|moderate|complex",
  "age_appropriate": true/false,
  "issues": ["probleem 1", "probleem 2"],
  "reject_reason": "specifieke reden als valid=false",
  "reason": "korte uitleg in het Nederlands"
}

BELANGRIJK: Wees EXTREEM STRENG. Een foute afbeelding is ERGER dan geen afbeelding.
Bij ELKE twijfel: valid=false.
Geef ALLEEN de JSON.`;

    const response = await fetch(`${GEMINI_API_URL}/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: imageData.mimeType,
                data: imageData.base64
              }
            },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
      })
    });

    if (!response.ok) {
      console.log(`    [AI validation error: ${response.status}]`);
      // v3.6: FAIL-CLOSED - don't allow fallback on API errors
      return { valid: false, score: 0, reason: `API error: ${response.status}`, hardReject: true };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { valid: false, score: 0, reason: 'Could not parse response', hardReject: true };
    }

    const result = JSON.parse(jsonMatch[0]);

    // v3.6: Apply ALL hard reject gates
    let hardReject = false;
    let rejectReason = '';

    // GATE 1: Language check - reject non-NL/EN text
    if (result.has_text && result.text_languages) {
      const allowedLanguages = ['nl', 'en'];
      const hasInvalidLanguage = result.text_languages.some(
        lang => lang && !allowedLanguages.includes(lang.toLowerCase())
      );
      if (hasInvalidLanguage) {
        hardReject = true;
        rejectReason = `Non-NL/EN text detected: ${result.text_languages.join(', ')}`;
      }
    }

    // GATE 2: Content type check - reject banned content types
    if (!hardReject && result.content_type && REJECT_CONTENT_TYPES.includes(result.content_type)) {
      hardReject = true;
      rejectReason = `Banned content type: ${result.content_type}`;
    }

    // GATE 3: Concept match check (for biologie)
    if (!hardReject && expectedConcept && result.predicted_concept) {
      const predictedLower = result.predicted_concept.toLowerCase();
      const conceptMatches = allowedConcepts.some(c =>
        predictedLower.includes(c.toLowerCase()) || c.toLowerCase().includes(predictedLower)
      );
      if (!conceptMatches && result.concept_matches === false) {
        hardReject = true;
        rejectReason = `Concept mismatch: expected ${expectedConcept}, got ${result.predicted_concept}`;
      }
    }

    // GATE 4: human_vs_animal risk profile
    if (!hardReject && riskProfile === 'human_vs_animal' && result.detected_subject !== 'human') {
      hardReject = true;
      rejectReason = `Detected ${result.detected_subject}, not human`;
    }

    // GATE 5: labeled_diagram intent requires diagram type
    if (!hardReject && intent === 'labeled_diagram' && !['labeled_diagram', 'diagram'].includes(result.image_type)) {
      hardReject = true;
      rejectReason = `Image type ${result.image_type}, not a diagram`;
    }

    // GATE 6: poor readability
    if (!hardReject && result.readability === 'poor') {
      hardReject = true;
      rejectReason = 'Poor readability';
    }

    // GATE 7: Age appropriateness
    if (!hardReject && result.age_appropriate === false) {
      hardReject = true;
      rejectReason = `Not age-appropriate: ${result.complexity_level} complexity`;
    }

    // GATE 8: Explicit valid=false from AI
    if (!hardReject && result.valid === false) {
      hardReject = true;
      rejectReason = result.reject_reason || result.reason || 'AI rejected image';
    }

    return {
      valid: !hardReject && result.valid === true,
      score: hardReject ? 0 : (result.score || 0),
      reason: hardReject ? rejectReason : (result.reason || ''),
      issues: result.issues || [],
      observations: result.observations || '',
      predicted_concept: result.predicted_concept || 'unknown',
      concept_matches: result.concept_matches,
      detected_subject: result.detected_subject || 'unknown',
      has_text: result.has_text || false,
      text_languages: result.text_languages || [],
      content_type: result.content_type || 'unknown',
      image_type: result.image_type || 'unknown',
      readability: result.readability || 'unknown',
      complexity_level: result.complexity_level || 'unknown',
      age_appropriate: result.age_appropriate,
      hardReject,
    };
  } catch (err) {
    console.log(`    [AI validation exception: ${err.message}]`);
    // v3.6: FAIL-CLOSED - reject on exceptions too
    return { valid: false, score: 0, reason: `Validation error: ${err.message}`, hardReject: true };
  }
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
 * v3.6: Generate a canonical unique key for deduplication
 * Uses pageid (for Commons) or title-based key to prevent same image via different URLs
 */
function getCanonicalKey(candidate) {
  // For Wikimedia Commons: use pageid if available (most reliable)
  if (candidate.pageid) {
    return `commons:${candidate.pageid}`;
  }

  // For Unsplash/Pexels: use their unique ID
  if (candidate.source === 'unsplash' && candidate.id) {
    return `unsplash:${candidate.id}`;
  }
  if (candidate.source === 'pexels' && candidate.id) {
    return `pexels:${candidate.id}`;
  }

  // Fallback: normalize title to create a canonical key
  // Remove File: prefix, normalize case, strip extension variants
  const title = (candidate.title || '')
    .replace(/^File:/i, '')
    .toLowerCase()
    .replace(/\.(jpg|jpeg|png|gif|svg|webp|tiff?)$/i, '')
    .replace(/[_\s]+/g, '_')
    .trim();

  if (title) {
    return `title:${title}`;
  }

  // Last resort: use imageUrl
  return `url:${candidate.imageUrl}`;
}

/**
 * Enhanced deterministic scoring with categories and risk profiles
 */
function scoreCandidate(candidate, brief, usedImages) {
  // v3.6: Use canonical key for deduplication instead of URL
  const canonicalKey = getCanonicalKey(candidate);
  candidate._canonicalKey = canonicalKey; // Store for later use
  if (usedImages.has(canonicalKey)) return -1000;

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
 * v3.4: Multi-source search (Commons, Unsplash, Pexels) + photo preference
 * v3.5: AI VISION validation of top candidates
 */
async function findBestImage(brief, usedImages, subject = null, questionText = '', enableAIValidation = true) {
  const candidates = [];
  const minScore = getMinScore(brief.imageIntent, subject);
  const queries = brief.commonsQueries || brief.searchTerms || [];
  const subjectLower = (subject || '').toLowerCase();

  // v3.4: For biologie and aardrijkskunde, prefer photos over diagrams
  const preferPhotos = subjectLower === 'biologie' || subjectLower === 'aardrijkskunde';

  // 1. v3.4: Try Unsplash and Pexels FIRST for photo-preferred subjects
  if (preferPhotos && queries.length > 0) {
    const photoQuery = queries[0].replace(/incategory:"[^"]*"/g, '').replace(/-\w+/g, '').trim();
    if (photoQuery) {
      try {
        const unsplashResults = await searchUnsplash(photoQuery, 5);
        candidates.push(...unsplashResults);
        await sleep(100);
      } catch (err) { /* continue */ }

      try {
        const pexelsResults = await searchPexels(photoQuery, 5);
        candidates.push(...pexelsResults);
        await sleep(100);
      } catch (err) { /* continue */ }
    }
  }

  // 2. Try category search (Commons)
  for (const category of (brief.categoryHints || []).slice(0, 2)) {
    try {
      const results = await searchCommonsCategory(category, 15);
      candidates.push(...results);
      await sleep(100);
    } catch (err) { /* continue */ }
  }

  // 3. Try Commons queries (strict → relaxed → broad)
  for (const query of queries.slice(0, 3)) {
    try {
      const results = await searchCommons(query, 10);
      candidates.push(...results);
      await sleep(100);
    } catch (err) { /* continue */ }
  }

  // 4. NEGATION LADDER: If queries with negations gave 0 results, retry without negations
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
  // v3.4: Apply photo preference bonus for Unsplash/Pexels sources
  let scored = candidates.map(c => {
    let score = scoreCandidate(c, brief, usedImages);
    // Bonus for professional photo sources when photos are preferred
    if (preferPhotos && (c.source === 'unsplash' || c.source === 'pexels')) {
      score += 50; // Bonus for high-quality photo sources
    }
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score);

  // 5. SCORE-BASED FALLBACK: Try Wikipedia if no candidates OR best score is too low
  const currentBest = scored[0];
  if ((!currentBest || currentBest.score < minScore) && brief.wikipediaFallback) {
    try {
      const wikiImage = await getWikipediaImage(brief.wikipediaFallback);
      if (wikiImage) {
        wikiImage.score = scoreCandidate(wikiImage, brief, usedImages);
        scored.push(wikiImage);
        scored.sort((a, b) => b.score - a.score);
      }
    } catch (err) { /* continue */ }
  }

  // 6. If still no good result, try broader search terms
  if (scored.length === 0 || scored[0].score < minScore) {
    const lastQuery = queries[queries.length - 1];
    if (lastQuery) {
      const broadQuery = stripNegations(lastQuery).replace(/incategory:"[^"]*"/g, '').trim();
      if (broadQuery) {
        try {
          const results = await searchCommons(broadQuery, 15);
          for (const r of results) {
            r.score = scoreCandidate(r, brief, usedImages);
            scored.push(r);
          }
        } catch (err) { /* continue */ }

        // v3.4: Also try Unsplash/Pexels with broad query
        if (preferPhotos) {
          try {
            const unsplashResults = await searchUnsplash(broadQuery, 5);
            for (const r of unsplashResults) {
              r.score = scoreCandidate(r, brief, usedImages) + 50;
              scored.push(r);
            }
          } catch (err) { /* continue */ }
        }
        scored.sort((a, b) => b.score - a.score);
      }
    }
  }

  // v3.5: AI VISION VALIDATION (enhanced with ChatGPT recommendations)
  // Strategy: validate top 3 first, escalate to top 5 if needed
  // Use intent-specific AI score thresholds
  if (enableAIValidation && scored.length > 0 && questionText) {
    const intent = brief.imageIntent || 'photo';
    const minAIScore = getMinAIScore(intent);
    const validatedCandidates = [];

    // Phase 1: Validate top 3 candidates
    const INITIAL_CANDIDATES = 3;
    const MAX_CANDIDATES = 5;

    for (let i = 0; i < Math.min(INITIAL_CANDIDATES, scored.length); i++) {
      const candidate = scored[i];
      if (candidate.score < MIN_ACCEPT_SCORE.default) continue;

      process.stdout.write(` [v${i + 1}]`);
      const validation = await validateImageWithAI(
        candidate.imageUrl,
        questionText,
        subject,
        brief
      );

      candidate.aiValidation = validation;
      validatedCandidates.push(candidate);

      if (validation.valid && validation.score >= minAIScore) {
        // Found a valid candidate!
        candidate.score += Math.floor(validation.score / 2);
        process.stdout.write(` [AI:${validation.score}✓ ${validation.detected_subject || ''}]`);
        return candidate;
      } else {
        const shortReason = validation.hardReject
          ? `REJECT:${validation.reason?.substring(0, 20) || ''}`
          : `${validation.score}<${minAIScore}`;
        process.stdout.write(` [AI:${shortReason}]`);
      }

      await sleep(VISION_DELAY);
    }

    // Phase 2: Escalate to remaining candidates (4 and 5) if no valid found
    if (scored.length > INITIAL_CANDIDATES) {
      process.stdout.write(` [escalating]`);
      for (let i = INITIAL_CANDIDATES; i < Math.min(MAX_CANDIDATES, scored.length); i++) {
        const candidate = scored[i];
        if (candidate.score < MIN_ACCEPT_SCORE.default) continue;

        process.stdout.write(` [v${i + 1}]`);
        const validation = await validateImageWithAI(
          candidate.imageUrl,
          questionText,
          subject,
          brief
        );

        candidate.aiValidation = validation;
        validatedCandidates.push(candidate);

        if (validation.valid && validation.score >= minAIScore) {
          candidate.score += Math.floor(validation.score / 2);
          process.stdout.write(` [AI:${validation.score}✓]`);
          return candidate;
        } else {
          process.stdout.write(` [AI:${validation.score}✗]`);
        }

        await sleep(VISION_DELAY);
      }
    }

    // v3.6: FAIL-CLOSED - No candidate passed AI validation
    // DO NOT return a bad image. Return null instead.
    // This prevents the "soup for collagen" and "breast for skeleton" errors.
    process.stdout.write(` [FAIL-CLOSED: all ${validatedCandidates.length} candidates rejected]`);
    return null;
  }

  // v3.6: If AI validation is disabled, still require minimum text score
  const best = scored.find(c => c.score >= MIN_ACCEPT_SCORE.default);
  return best || null;
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
      // v3.5: Extract question text for AI validation
      const questionText = question.q || question.instruction || question.prompt?.text || question.prompt?.html || '';
      const cleanQuestionText = questionText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      let bestImage = await findBestImage(brief, usedImages, subject, cleanQuestionText, true);
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
          bestImage = await findBestImage(mergedBrief, usedImages, subject, cleanQuestionText, true);
        }
      }

      if (bestImage && bestImage.score >= minScore) {
        // v3.6: Use canonical key for deduplication
        const canonicalKey = bestImage._canonicalKey || getCanonicalKey(bestImage);
        usedImages.add(canonicalKey);
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
      console.log(`\nWaiting ${BATCH_DELAY/1000}s before next batch...`);
      await sleep(BATCH_DELAY);
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
        // v3.4: Proper attribution per source
        let caption = 'Bron: Wikimedia Commons';
        if (result.source === 'wikipedia') caption = 'Bron: Wikipedia';
        else if (result.source === 'unsplash') caption = result.attribution || 'Bron: Unsplash';
        else if (result.source === 'pexels') caption = result.attribution || 'Bron: Pexels';

        q.media = [{
          type: 'image',
          src: result.imageUrl,
          alt: result.title,
          caption,
          _source: 'ai-v3.5',
          _imageSource: result.source || 'commons',
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
    version: 'v3.5',
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
