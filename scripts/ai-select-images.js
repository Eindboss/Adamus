/**
 * AI-powered image selection for quiz questions (v4.0)
 *
 * Uses Gemini AI to generate optimal search terms in BATCHES,
 * then fetches images from multiple sources with AI VISION validation.
 *
 * v4.0 Improvements (ChatGPT architecture review - targeting 90%+ coverage):
 * - PROXY-QUERY EXPANSION: Hard-coded alternatives for difficult concepts
 *   → RSI → "office ergonomics", "computer posture", "typing hands"
 *   → antagonisten → "biceps triceps arm anatomy", "arm flexion extension"
 *   → spiercontractie → "muscle fiber structure", "sarcomere diagram"
 * - COMMONS CATEGORY BROWSE: When search fails, browse curated categories
 *   → Gray's Anatomy plates, Human skeleton diagrams, Muscle anatomy
 * - WIKIPEDIA ARTICLE IMAGES: Harvest images from Wikipedia articles
 *   → begrippen-index.wikipediaArticle mapping
 * - EXPANDED FALLBACK CHAIN: baseline → AI → proxy → browse → Wikipedia
 *
 * v3.9 Improvements (fixing v3.8 query-language-mismatch):
 * - SOURCE-SPECIFIC QUERIES: Different query format per source
 *   → Stock sites get normalized queries (no incategory, no negations)
 *   → Commons gets full queries with incategory/negations
 * - BASELINE-FIRST: Start with simple index-derived queries
 *   → High recall before precision
 * - BREADTH-THEN-PRECISION: Commons searches without negations first
 *   → Only add negations if too many bad results
 * - QUERY NORMALIZATION: normalizeForStock() strips Commons syntax
 *   → Max 3 keywords, no special operators
 *
 * v3.8 Improvements (based on ChatGPT analysis + lesson content indexing):
 * - BEGRIPPEN INDEX: Loads lesson content index for better keyword enrichment
 *   → NL→EN translations, synonyms, visual concepts from textbook
 * - KEYWORD ENRICHMENT: Matches question keywords against index
 *   → Uses curated English terms instead of AI guessing
 * - MICRO-CONTEXT INJECTION: Per-batch relevant concepts in prompt
 *   → Only ~20 begrippen per batch, not entire index
 * - EXPANDED ALLOWED CONCEPTS: Proxy concepts for RSI/ergonomics/training
 *   → RSI accepts "computer_posture", "typing", "wrist_pain"
 * - MIN SCORE ADJUSTMENTS: Lower thresholds for difficult concepts
 *   → RSI/warming-up/spierpijn get -15 minScore
 * - FALLBACK SEARCHES: Pre-defined searches from visualTypes
 *   → Deterministic fallback when AI queries fail
 *
 * v3.7 Improvements (based on ChatGPT analysis of rate limiting issues):
 * - TOKEN BUCKET RATE LIMITER: Prevents 429 errors instead of reacting to them
 *   → Hard cap on 14 RPM with automatic queuing
 * - TOP-1/TOP-2/TOP-3 STRATEGY: Validates fewer candidates per question
 *   → Reduces vision calls from ~3 to ~1.5 per question
 * - VISION CACHE: Stores validation results to avoid re-validating same images
 *   → JSON file cache with TTL per result type
 * - DOWNLOAD FALLBACK: Multiple URL resolutions for Commons images
 *   → thumb 800px → 1200px → original
 * - AUTO-ACCEPT: Strong Commons matches skip vision validation
 *   → Saves API calls for obvious good matches
 * - FAIL-CLOSED REMOVES OLD: Questions without valid image get image removed
 *   → No stale bad images, retry on next run
 *
 * v3.6 Improvements (based on ChatGPT analysis of 46% failure rate):
 * - CONCEPT MATCHING: expectedConcept/allowedConcepts per question
 * - LANGUAGE GATE: Hard reject non-NL/EN text in images
 * - FAIL-CLOSED FALLBACK: No image is better than wrong image
 * - CONTENT-TYPE GATE: Reject abstract_art, network_graph, table_wordlist
 * - CANONICAL DEDUP: Use pageid/title instead of URL for deduplication
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
 *
 * Options:
 *   --apply    Apply the selected images to the quiz file (removes old images on fail)
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
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const BASE_DELAY = 3000;
const MAX_ESCALATIONS_PER_QUIZ = 10;
const BATCH_DELAY = 5000;

// v3.7: Rate limiting settings
const GEMINI_RPM = 14; // Stay under 15 RPM limit

// v3.7: Vision validation strategy - fewer candidates = fewer API calls
const MAX_VISION_CANDIDATES = 3; // Start with top 3
const ESCALATE_VISION_TO = 5; // Only escalate to 5 for high-priority

// v3.7: Cache settings
const CACHE_FILE = 'vision-cache.json';
const CACHE_TTL_VALID_DAYS = 30; // Good results last 30 days
const CACHE_TTL_INVALID_DAYS = 30; // Bad results (concept mismatch, etc) last 30 days
const CACHE_TTL_DOWNLOAD_FAIL_HOURS = 24; // Download failures may be transient

// v3.7: Auto-accept threshold - skip vision if text score is extremely high
const AUTO_ACCEPT_SCORE_THRESHOLD = 200; // Very high confidence from text scoring

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

// v4.0: PROXY QUERIES for difficult concepts
// When AI-generated queries fail (0 results), try these pre-tested alternatives
// Based on ChatGPT architecture review - these are "breadth-first" queries that work
const PROXY_QUERIES = {
  // RSI / Ergonomics cluster (q037-q042)
  rsi: ['office ergonomics', 'computer workstation posture', 'typing hands keyboard', 'desk ergonomics'],
  ergonomie: ['office ergonomics diagram', 'workstation setup', 'sitting posture desk'],
  zithouding: ['correct sitting posture', 'ergonomic sitting', 'office chair posture'],
  telefoon: ['smartphone neck posture', 'phone use posture', 'text neck'],

  // Muscle contraction cluster (q022-q026)
  spiercontractie: ['muscle fiber contraction', 'sarcomere sliding filament', 'actin myosin'],
  samentrekken: ['muscle contraction diagram', 'skeletal muscle anatomy', 'muscle fiber'],
  antagonist: ['biceps triceps arm muscles', 'antagonist muscle pair arm', 'flexor extensor'],
  antagonisten: ['biceps triceps anatomy', 'arm muscles flexion extension', 'muscle pair diagram'],
  biceps: ['biceps brachii anatomy', 'arm flexion muscle', 'upper arm muscles'],
  triceps: ['triceps brachii anatomy', 'arm extension muscle', 'upper arm muscles'],

  // Smooth/involuntary muscles (q026)
  orgaanspier: ['smooth muscle diagram', 'visceral muscle', 'involuntary muscle types'],
  gladde_spier: ['smooth muscle tissue', 'intestine muscle wall', 'blood vessel muscle'],

  // Motor learning / coordination (q028-q029)
  motorisch: ['motor learning brain', 'motor cortex', 'movement coordination'],
  coordinatie: ['balance coordination exercise', 'motor skills training', 'agility exercise'],
  coördinatie: ['balance coordination exercise', 'motor skills training', 'agility exercise'],

  // Training phases (q032, q048)
  warming_up: ['athletes warming up', 'dynamic stretching sport', 'warm up exercises'],
  cooling_down: ['athletes cooling down', 'static stretching sport', 'cool down stretching'],
  training: ['exercise workout fitness', 'sports training', 'physical activity'],

  // Abstract bone concepts (q003)
  botsamenstelling: ['bone composition diagram', 'bone structure calcium collagen', 'compact bone structure'],
  kalkzouten: ['bone mineral content', 'calcium bone', 'bone composition'],
};

// v4.0: COMMONS CATEGORIES for browse fallback
// When search yields 0 results, try browsing these curated categories
const COMMONS_BROWSE_CATEGORIES = {
  // Anatomy categories
  anatomy: ['Gray\'s Anatomy plates', 'Human skeleton diagrams', 'Human anatomy diagrams'],
  muscles: ['Muscles of the human body', 'Human arm muscles', 'Muscle diagrams'],
  joints: ['Human joints', 'Synovial joints', 'Joint anatomy'],
  skeleton: ['Human skeleton diagrams', 'Bones of the human body'],

  // Ergonomics
  ergonomics: ['Ergonomics', 'Office ergonomics', 'Workplace safety'],

  // Exercise/fitness
  exercise: ['Physical exercise', 'Stretching exercises', 'Fitness training'],

  // Microscopy
  histology: ['Histology', 'Tissue slides', 'Microscopy images'],
};

// v4.0: WIKIPEDIA ARTICLE MAPPING for difficult concepts
// Maps concept keywords to Wikipedia articles that have good images
const WIKIPEDIA_ARTICLE_MAPPING = {
  antagonist: 'Antagonist_(muscle)',
  antagonisten: 'Antagonist_(muscle)',
  spiercontractie: 'Muscle_contraction',
  samentrekken: 'Muscle_contraction',
  biceps: 'Biceps',
  triceps: 'Triceps',
  orgaanspier: 'Smooth_muscle',
  gladde_spier: 'Smooth_muscle',
  rsi: 'Repetitive_strain_injury',
  ergonomie: 'Ergonomics',
  warming_up: 'Warming_up',
  cooling_down: 'Cooling_down',
  coordinatie: 'Motor_coordination',
  coördinatie: 'Motor_coordination',
  motorisch: 'Motor_learning',
};

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
 * v3.7: Token Bucket Rate Limiter
 * Prevents 429 errors by enforcing a hard cap on requests per minute.
 * Instead of reacting to rate limits, we prevent them entirely.
 */
class TokenBucketLimiter {
  constructor({ rpm, cooldownMs = 65000 }) {
    this.capacity = rpm;
    this.tokens = rpm;
    this.refillIntervalMs = Math.ceil(60000 / rpm);
    this.lastRefill = Date.now();
    this.cooldownUntil = 0;
    this.defaultCooldownMs = cooldownMs;
    this.callCount = 0;
  }

  _refill() {
    const now = Date.now();
    if (now <= this.lastRefill) return;
    const elapsed = now - this.lastRefill;
    const add = Math.floor(elapsed / this.refillIntervalMs);
    if (add > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + add);
      this.lastRefill += add * this.refillIntervalMs;
    }
  }

  async take(count = 1) {
    while (true) {
      const now = Date.now();

      // If in cooldown, wait
      if (now < this.cooldownUntil) {
        const wait = this.cooldownUntil - now + Math.floor(Math.random() * 250);
        process.stdout.write(` [cooldown ${Math.ceil(wait/1000)}s]`);
        await sleep(wait);
        continue;
      }

      this._refill();

      if (this.tokens >= count) {
        this.tokens -= count;
        this.callCount++;
        return;
      }

      // Wait until at least 1 token refills
      const wait = this.refillIntervalMs + 50 + Math.floor(Math.random() * 250);
      process.stdout.write(` [wait ${Math.ceil(wait/1000)}s]`);
      await sleep(wait);
    }
  }

  cooldown(ms) {
    const until = Date.now() + (ms ?? this.defaultCooldownMs);
    this.cooldownUntil = Math.max(this.cooldownUntil, until);
    // Drop tokens to avoid burst right after cooldown
    this.tokens = Math.min(this.tokens, 1);
    console.log(`  [Rate limited! Cooldown for ${Math.ceil((ms ?? this.defaultCooldownMs)/1000)}s]`);
  }

  getStats() {
    return { tokens: this.tokens, callCount: this.callCount };
  }
}

// v3.7: Global rate limiter for Gemini API
const geminiLimiter = new TokenBucketLimiter({ rpm: GEMINI_RPM, cooldownMs: 65000 });

/**
 * v3.7: Vision Cache
 * Stores validation results to avoid re-validating the same images.
 * Uses canonical keys (pageid/title) instead of URLs.
 */
class VisionCache {
  constructor(quizPath) {
    this.cacheDir = path.dirname(quizPath);
    this.cachePath = path.join(this.cacheDir, CACHE_FILE);
    this.cache = this._load();
    this.hits = 0;
    this.misses = 0;
  }

  _load() {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
        // Clean expired entries on load
        const now = Date.now();
        const cleaned = {};
        for (const [key, entry] of Object.entries(data)) {
          if (entry.expiresAt > now) {
            cleaned[key] = entry;
          }
        }
        return cleaned;
      }
    } catch (err) {
      console.log(`  [Cache load error: ${err.message}]`);
    }
    return {};
  }

  _save() {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
    } catch (err) {
      console.log(`  [Cache save error: ${err.message}]`);
    }
  }

  _getTTL(result) {
    // Download failures are transient - short TTL
    if (result.reason?.includes('download') || result.reason?.includes('Could not')) {
      return CACHE_TTL_DOWNLOAD_FAIL_HOURS * 60 * 60 * 1000;
    }
    // Valid results - long TTL
    if (result.valid) {
      return CACHE_TTL_VALID_DAYS * 24 * 60 * 60 * 1000;
    }
    // Invalid results (concept mismatch, language, etc) - long TTL
    return CACHE_TTL_INVALID_DAYS * 24 * 60 * 60 * 1000;
  }

  get(canonicalKey) {
    const entry = this.cache[canonicalKey];
    if (entry && entry.expiresAt > Date.now()) {
      this.hits++;
      return entry.result;
    }
    this.misses++;
    return null;
  }

  set(canonicalKey, result) {
    const ttl = this._getTTL(result);
    this.cache[canonicalKey] = {
      result,
      cachedAt: Date.now(),
      expiresAt: Date.now() + ttl,
    };
  }

  save() {
    this._save();
  }

  getStats() {
    return { hits: this.hits, misses: this.misses, size: Object.keys(this.cache).length };
  }
}

// v3.7: Global vision cache (initialized per quiz)
let visionCache = null;

/**
 * v3.8: Begrippen Index Loader
 * Loads lesson content index for keyword enrichment.
 * Index contains NL→EN translations, synonyms, visual concepts.
 */
class BegrippenIndex {
  constructor(quizPath) {
    this.index = null;
    this.indexPath = null;
    this._loadIndex(quizPath);
  }

  _loadIndex(quizPath) {
    // Try to find a begrippen index in the same directory
    const dir = path.dirname(quizPath);
    const possibleFiles = fs.readdirSync(dir).filter(f =>
      f.endsWith('-begrippen-index.json') || f === 'begrippen-index.json'
    );

    if (possibleFiles.length > 0) {
      this.indexPath = path.join(dir, possibleFiles[0]);
      try {
        this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
        console.log(`Begrippen index: ${Object.keys(this.index.begrippen || {}).length} entries loaded`);
      } catch (err) {
        console.log(`  [Begrippen index load error: ${err.message}]`);
        this.index = null;
      }
    } else {
      console.log('Begrippen index: not found (using defaults)');
    }
  }

  /**
   * Match question text against begrippen index
   * Returns enriched data: EN terms, visualConcepts, allowedConcepts, etc.
   */
  matchQuestion(questionText) {
    if (!this.index || !this.index.begrippen) {
      return null;
    }

    const clean = questionText.replace(/<[^>]+>/g, ' ').toLowerCase();
    const matches = [];

    for (const [key, begrip] of Object.entries(this.index.begrippen)) {
      // Match on nl term
      const nlTerm = begrip.nl?.toLowerCase() || key.toLowerCase();
      if (clean.includes(nlTerm)) {
        matches.push({ key, begrip, matchType: 'nl' });
        continue;
      }

      // Match on synonyms
      const synonyms = begrip.synonyms || [];
      for (const syn of synonyms) {
        if (clean.includes(syn.toLowerCase())) {
          matches.push({ key, begrip, matchType: 'synonym' });
          break;
        }
      }
    }

    if (matches.length === 0) return null;

    // Aggregate all matched begrippen
    const result = {
      matchedKeys: matches.map(m => m.key),
      englishTerms: [],
      visualConcepts: [],
      allowedConcepts: [],
      alternativeSearches: [],
      preferredIntents: [],
      minScoreAdjust: 0,
    };

    for (const { begrip } of matches) {
      // English terms
      if (begrip.en) {
        result.englishTerms.push(...(Array.isArray(begrip.en) ? begrip.en : [begrip.en]));
      }

      // Visual concepts
      if (begrip.visualConcepts) {
        result.visualConcepts.push(...begrip.visualConcepts);
      }

      // Allowed concepts (expanded for proxy matching)
      if (begrip.allowedConcepts) {
        result.allowedConcepts.push(...begrip.allowedConcepts);
      }

      // Alternative searches (fallback)
      if (begrip.alternativeSearches) {
        result.alternativeSearches.push(...begrip.alternativeSearches);
      }

      // Preferred intents
      if (begrip.preferredIntents) {
        result.preferredIntents.push(...begrip.preferredIntents);
      }

      // Min score adjustment (use most negative)
      if (begrip.minScoreAdjust && begrip.minScoreAdjust < result.minScoreAdjust) {
        result.minScoreAdjust = begrip.minScoreAdjust;
      }
    }

    // Dedupe arrays
    result.englishTerms = [...new Set(result.englishTerms)];
    result.visualConcepts = [...new Set(result.visualConcepts)];
    result.allowedConcepts = [...new Set(result.allowedConcepts)];
    result.alternativeSearches = [...new Set(result.alternativeSearches)];
    result.preferredIntents = [...new Set(result.preferredIntents)];

    return result;
  }

  /**
   * Get micro-context for a batch of questions
   * Returns compact string with only relevant begrippen
   */
  getMicroContext(questions) {
    if (!this.index || !this.index.begrippen) return '';

    const relevantKeys = new Set();

    for (const q of questions) {
      const text = q.q || q.instruction || q.prompt?.text || q.prompt?.html || '';
      const match = this.matchQuestion(text);
      if (match) {
        match.matchedKeys.forEach(k => relevantKeys.add(k));
      }
    }

    if (relevantKeys.size === 0) return '';

    // Build compact micro-context (max 20 begrippen)
    const begrippen = this.index.begrippen;
    const lines = [];
    let count = 0;

    for (const key of relevantKeys) {
      if (count >= 20) break;
      const b = begrippen[key];
      if (!b) continue;

      const en = Array.isArray(b.en) ? b.en.slice(0, 2).join('; ') : b.en;
      const visual = b.visualConcepts?.slice(0, 2).join(', ') || '';
      lines.push(`- ${b.nl || key} -> ${en}${visual ? `; visual: ${visual}` : ''}`);
      count++;
    }

    return lines.length > 0
      ? `\nCHAPTER CONCEPTS (use when relevant; prefer these exact English terms):\n${lines.join('\n')}\n`
      : '';
  }

  /**
   * Get fallback search terms from visualTypes
   */
  getFallbackSearches(visualConcept) {
    if (!this.index || !this.index.visualTypes) return [];
    const vt = this.index.visualTypes[visualConcept];
    return vt?.searchTerms || [];
  }
}

// v3.8: Global begrippen index (initialized per quiz)
let begrippenIndex = null;

/**
 * v3.6: Extract expected concept and allowed concepts from question text
 * Uses BIOLOGIE_CONCEPT_VOCABULARY to map Dutch keywords to concepts
 * v3.8: Enhanced with begrippen index lookup for expanded allowedConcepts
 */
function extractExpectedConcepts(questionText, subject) {
  if (!subject || subject.toLowerCase() !== 'biologie') {
    return { expectedConcept: null, allowedConcepts: [], minScoreAdjust: 0 };
  }

  const clean = questionText.replace(/<[^>]+>/g, ' ').toLowerCase();
  const allAllowed = new Set();
  let primaryConcept = null;
  let minScoreAdjust = 0;

  // Check each vocabulary entry (original v3.6 logic)
  for (const [keyword, mapping] of Object.entries(BIOLOGIE_CONCEPT_VOCABULARY)) {
    if (clean.includes(keyword)) {
      if (!primaryConcept) {
        primaryConcept = mapping.expectedConcept;
      }
      mapping.allowedConcepts.forEach(c => allAllowed.add(c));
    }
  }

  // v3.8: Enrich with begrippen index if available
  if (begrippenIndex) {
    const indexMatch = begrippenIndex.matchQuestion(questionText);
    if (indexMatch) {
      // Add expanded allowed concepts from index
      indexMatch.allowedConcepts.forEach(c => allAllowed.add(c));

      // Use most negative minScoreAdjust
      if (indexMatch.minScoreAdjust < minScoreAdjust) {
        minScoreAdjust = indexMatch.minScoreAdjust;
      }
    }
  }

  return {
    expectedConcept: primaryConcept,
    allowedConcepts: Array.from(allAllowed),
    minScoreAdjust,
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
 * v3.9: Normalize query for stock photo sites (Unsplash/Pexels)
 * Stock sites don't understand Commons syntax - strip it all
 * - Remove incategory:"..."
 * - Remove negations (-animal, -insect, etc.)
 * - Remove quotes
 * - Keep max 3 keywords for better recall
 */
function normalizeForStock(query) {
  let clean = query
    .replace(/incategory:"[^"]*"/gi, '')  // Remove incategory:
    .replace(/-\w+/g, '')                  // Remove negations
    .replace(/"/g, '')                     // Remove quotes
    .replace(/\s+/g, ' ')                  // Normalize whitespace
    .trim();

  // Keep max 3 keywords for better recall
  const words = clean.split(' ').filter(w => w.length > 2);
  if (words.length > 3) {
    clean = words.slice(0, 3).join(' ');
  }

  return clean;
}

/**
 * v3.9: Generate baseline queries from begrippen index
 * These are simple, high-recall queries that work on all sources
 */
function generateBaselineQueries(questionText) {
  const baselines = [];

  if (begrippenIndex) {
    const match = begrippenIndex.matchQuestion(questionText);
    if (match) {
      // Use English terms from index (simple, 1-2 words)
      for (const term of match.englishTerms.slice(0, 2)) {
        baselines.push(term);
      }
      // Use alternativeSearches (pre-validated to work)
      for (const alt of match.alternativeSearches.slice(0, 2)) {
        baselines.push(normalizeForStock(alt));
      }
    }
  }

  return [...new Set(baselines)]; // Dedupe
}

/**
 * v4.0: Get proxy queries for difficult concepts
 * Returns pre-tested query alternatives when AI queries fail
 */
function getProxyQueries(questionText) {
  const clean = questionText.replace(/<[^>]+>/g, ' ').toLowerCase();
  const proxyQueries = [];

  for (const [keyword, queries] of Object.entries(PROXY_QUERIES)) {
    if (clean.includes(keyword)) {
      proxyQueries.push(...queries);
    }
  }

  return [...new Set(proxyQueries)]; // Dedupe
}

/**
 * v4.0: Get Commons categories for browse fallback
 * Returns curated categories based on question content
 */
function getBrowseCategories(questionText) {
  const clean = questionText.replace(/<[^>]+>/g, ' ').toLowerCase();
  const categories = [];

  // Check for muscle-related keywords
  if (clean.match(/spier|biceps|triceps|antagonist|samentrek/)) {
    categories.push(...COMMONS_BROWSE_CATEGORIES.muscles);
  }

  // Check for skeleton/anatomy keywords
  if (clean.match(/skelet|bot|gewricht|kraakbeen|wervel/)) {
    categories.push(...COMMONS_BROWSE_CATEGORIES.anatomy);
    categories.push(...COMMONS_BROWSE_CATEGORIES.skeleton);
  }

  // Check for RSI/ergonomics keywords
  if (clean.match(/rsi|ergonomie|zithouding|houding|computer|telefoon/)) {
    categories.push(...COMMONS_BROWSE_CATEGORIES.ergonomics);
  }

  // Check for exercise/training keywords
  if (clean.match(/warming|cooling|training|oefening|stretching/)) {
    categories.push(...COMMONS_BROWSE_CATEGORIES.exercise);
  }

  return [...new Set(categories)].slice(0, 3); // Max 3 categories
}

/**
 * v4.0: Get Wikipedia article for concept
 * Returns Wikipedia article name for harvesting images
 */
function getWikipediaArticleForConcept(questionText) {
  const clean = questionText.replace(/<[^>]+>/g, ' ').toLowerCase();

  for (const [keyword, article] of Object.entries(WIKIPEDIA_ARTICLE_MAPPING)) {
    if (clean.includes(keyword)) {
      return article;
    }
  }

  // Also check begrippen index for wikipediaArticle
  if (begrippenIndex) {
    const match = begrippenIndex.matchQuestion(questionText);
    if (match && match.matchedKeys.length > 0) {
      const begrip = begrippenIndex.index?.begrippen?.[match.matchedKeys[0]];
      if (begrip?.wikipediaArticle) {
        return begrip.wikipediaArticle;
      }
    }
  }

  return null;
}

/**
 * v4.0: Get all images from a Wikipedia article
 * Harvests images from the article for fallback
 */
async function getWikipediaArticleImages(articleName, limit = 5) {
  if (!articleName) return [];

  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: articleName,
      prop: 'images',
      imlimit: String(limit * 2), // Get more, filter later
      format: 'json',
      origin: '*',
    });

    const response = await fetch(`${WIKIPEDIA_API}?${params}`);
    if (!response.ok) return [];

    const data = await response.json();
    const pages = data.query?.pages || {};
    const images = [];

    for (const page of Object.values(pages)) {
      if (page.images) {
        for (const img of page.images) {
          const title = img.title;
          // Skip icons, logos, and non-content images
          if (title.match(/icon|logo|flag|symbol|button|arrow|commons-logo/i)) continue;
          // Skip non-image files
          if (!title.match(/\.(jpg|jpeg|png|svg|gif)$/i)) continue;

          // Get image info from Commons
          const imageInfo = await getCommonsImageInfo(title.replace('File:', ''));
          if (imageInfo) {
            images.push({
              ...imageInfo,
              source: 'wikipedia',
              fromArticle: articleName,
            });
          }

          if (images.length >= limit) break;
        }
      }
    }

    return images;
  } catch (err) {
    return [];
  }
}

/**
 * v4.0: Get image info from Commons by filename
 */
async function getCommonsImageInfo(filename) {
  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: `File:${filename}`,
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: 800,
      format: 'json',
      origin: '*',
    });

    const response = await fetch(`${COMMONS_API}?${params}`);
    if (!response.ok) return null;

    const data = await response.json();
    const pages = data.query?.pages || {};

    for (const page of Object.values(pages)) {
      if (page.imageinfo && page.imageinfo[0]) {
        const info = page.imageinfo[0];
        return {
          pageid: page.pageid,
          title: page.title.replace('File:', ''),
          imageUrl: info.thumburl || info.url,
          descriptionUrl: info.descriptionurl,
          width: info.thumbwidth || info.width,
          height: info.thumbheight || info.height,
          mime: info.mime,
          description: info.extmetadata?.ImageDescription?.value || '',
          categories: [],
          source: 'commons',
        };
      }
    }

    return null;
  } catch (err) {
    return null;
  }
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
 * v3.8: Injects micro-context from begrippen index
 */
async function generateBatchSearchTerms(questions, subject, chapterContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable not set');

  const questionList = questions.map((q, i) => {
    const text = q.q || q.instruction || q.prompt?.text || q.prompt?.html || '';
    const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return `${i + 1}. [${q.id}] ${clean}`;
  }).join('\n');

  // v3.8: Get micro-context from begrippen index (only relevant begrippen for this batch)
  const microContext = begrippenIndex ? begrippenIndex.getMicroContext(questions) : '';

  const prompt = `Je bent een expert in het vinden van educatieve afbeeldingen op Wikimedia Commons voor een Nederlandse quiz-app voor middelbare scholieren.

VAK: ${subject}
${chapterContext ? `HOOFDSTUK/CONTEXT: ${chapterContext}` : ''}${microContext}

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
 * v3.7: AI VISION validation with rate limiting and caching
 * Downloads the image as base64 and sends it to Gemini for visual analysis.
 *
 * v3.7 improvements:
 * - TOKEN BUCKET RATE LIMITER: Waits for available token before API call
 * - VISION CACHE: Checks cache before making API call
 * - Handles 429 gracefully with cooldown
 *
 * v3.6 improvements based on ChatGPT analysis of 46% failure rate:
 * - CONCEPT MATCHING: predicted_concept vs expectedConcept
 * - LANGUAGE GATE: Detect and reject non-NL/EN text
 * - CONTENT-TYPE GATE: Reject abstract_art, network_graph, etc.
 * - COMPLEXITY GATE: Check age appropriateness for 14-16 year olds
 */
async function validateImageWithAI(imageUrl, questionText, subject, brief, canonicalKey = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { valid: false, score: 0, reason: 'No API key', hardReject: true };

  // v3.7: Check cache first
  if (canonicalKey && visionCache) {
    const cached = visionCache.get(canonicalKey);
    if (cached) {
      process.stdout.write(` [CACHE]`);
      return cached;
    }
  }

  try {
    // Download the image as base64
    const imageData = await fetchImageAsBase64(imageUrl);
    if (!imageData) {
      const result = { valid: false, score: 0, reason: 'Could not download image', hardReject: true };
      if (canonicalKey && visionCache) visionCache.set(canonicalKey, result);
      return result;
    }

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

    // v3.7: Wait for rate limiter token before making API call
    await geminiLimiter.take(1);

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
      // v3.7: On 429, trigger cooldown
      if (response.status === 429) {
        geminiLimiter.cooldown(65000);
      }
      const result = { valid: false, score: 0, reason: `API error: ${response.status}`, hardReject: true };
      // Don't cache 429 errors - they're transient
      if (response.status !== 429 && canonicalKey && visionCache) {
        visionCache.set(canonicalKey, result);
      }
      return result;
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

    const finalResult = {
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

    // v3.7: Cache the result
    if (canonicalKey && visionCache) {
      visionCache.set(canonicalKey, finalResult);
    }

    return finalResult;
  } catch (err) {
    // v3.7: Handle rate limit errors from fetch
    const is429 = err.message.includes('429') || err.message.includes('rate') || err.message.includes('quota');
    if (is429) {
      geminiLimiter.cooldown(65000);
    }
    const result = { valid: false, score: 0, reason: `Validation error: ${err.message}`, hardReject: true };
    // Don't cache rate limit errors
    if (!is429 && canonicalKey && visionCache) {
      visionCache.set(canonicalKey, result);
    }
    return result;
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
 * v3.7: Auto-accept for very high scores, reduced vision calls, caching
 */
async function findBestImage(brief, usedImages, subject = null, questionText = '', enableAIValidation = true) {
  const candidates = [];
  const minScore = getMinScore(brief.imageIntent, subject);
  const queries = brief.commonsQueries || brief.searchTerms || [];
  const subjectLower = (subject || '').toLowerCase();

  // v3.4: For biologie and aardrijkskunde, prefer photos over diagrams
  const preferPhotos = subjectLower === 'biologie' || subjectLower === 'aardrijkskunde';

  // v3.9: Generate baseline queries from begrippen index (high-recall, simple)
  const baselineQueries = generateBaselineQueries(questionText);

  // v3.9: Normalize AI queries for stock sites (remove incategory, negations)
  const stockQueries = queries.map(q => normalizeForStock(q)).filter(q => q.length > 2);

  // v3.9: Combined query set - baselines first, then AI-generated
  const allStockQueries = [...new Set([...baselineQueries, ...stockQueries])].slice(0, 4);

  // 1. v3.9: Try Unsplash and Pexels with NORMALIZED queries (no Commons syntax)
  if (preferPhotos && allStockQueries.length > 0) {
    for (const stockQuery of allStockQueries.slice(0, 2)) {
      if (!stockQuery) continue;
      try {
        const unsplashResults = await searchUnsplash(stockQuery, 5);
        candidates.push(...unsplashResults);
        await sleep(100);
      } catch (err) { /* continue */ }

      try {
        const pexelsResults = await searchPexels(stockQuery, 5);
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

  // 3. v3.9: Try Commons with ORIGINAL queries (incategory OK here, but breadth first)
  // First try without negations for breadth, then with negations for precision
  const commonsQueriesNoNeg = queries.map(q => stripNegations(q)).filter(q => q.length > 2);
  for (const query of [...new Set(commonsQueriesNoNeg)].slice(0, 2)) {
    try {
      const results = await searchCommons(query, 10);
      candidates.push(...results);
      await sleep(100);
    } catch (err) { /* continue */ }
  }

  // 4. v3.9: If still few candidates, try original queries with negations (precision)
  if (candidates.length < 5) {
    for (const query of queries.slice(0, 2)) {
      if (hasNegations(query)) {
        try {
          const results = await searchCommons(query, 10);
          candidates.push(...results);
          await sleep(100);
        } catch (err) { /* continue */ }
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

  // v4.0: PROXY QUERIES - Try pre-tested alternative queries for difficult concepts
  if (scored.length === 0 || (scored[0] && scored[0].score < minScore)) {
    const proxyQueries = getProxyQueries(questionText);
    if (proxyQueries.length > 0) {
      process.stdout.write(' [PROXY]');
      for (const pq of proxyQueries.slice(0, 3)) {
        try {
          // Try stock sites with proxy queries (they work better for lifestyle content)
          const unsplashResults = await searchUnsplash(pq, 5);
          for (const r of unsplashResults) {
            r.score = scoreCandidate(r, brief, usedImages) + 30; // Proxy bonus
            r.proxyQuery = pq;
            scored.push(r);
          }
          await sleep(100);

          const pexelsResults = await searchPexels(pq, 5);
          for (const r of pexelsResults) {
            r.score = scoreCandidate(r, brief, usedImages) + 30;
            r.proxyQuery = pq;
            scored.push(r);
          }
          await sleep(100);

          // Also try Commons
          const commonsResults = await searchCommons(pq, 10);
          for (const r of commonsResults) {
            r.score = scoreCandidate(r, brief, usedImages);
            r.proxyQuery = pq;
            scored.push(r);
          }
          await sleep(100);
        } catch (err) { /* continue */ }
      }
      scored.sort((a, b) => b.score - a.score);
    }
  }

  // v4.0: CATEGORY BROWSE - Browse curated Commons categories
  if (scored.length === 0 || (scored[0] && scored[0].score < minScore)) {
    const browseCategories = getBrowseCategories(questionText);
    if (browseCategories.length > 0) {
      process.stdout.write(' [BROWSE]');
      for (const cat of browseCategories) {
        try {
          const results = await searchCommonsCategory(cat, 15);
          for (const r of results) {
            r.score = scoreCandidate(r, brief, usedImages);
            r.browseCategory = cat;
            scored.push(r);
          }
          await sleep(100);
        } catch (err) { /* continue */ }
      }
      scored.sort((a, b) => b.score - a.score);
    }
  }

  // v4.0: WIKIPEDIA ARTICLE IMAGES - Harvest images from Wikipedia articles
  if (scored.length === 0 || (scored[0] && scored[0].score < minScore)) {
    const wikiArticle = getWikipediaArticleForConcept(questionText);
    if (wikiArticle) {
      process.stdout.write(` [WIKI:${wikiArticle}]`);
      try {
        const wikiImages = await getWikipediaArticleImages(wikiArticle, 5);
        for (const r of wikiImages) {
          r.score = scoreCandidate(r, brief, usedImages) + 20; // Wiki article bonus
          scored.push(r);
        }
        scored.sort((a, b) => b.score - a.score);
      } catch (err) { /* continue */ }
    }
  }

  // v3.7: AI VISION VALIDATION with rate limiting and caching
  // Strategy:
  // 1. Auto-accept very high scoring Commons/Wikipedia matches (skip vision)
  // 2. Validate top MAX_VISION_CANDIDATES first
  // 3. Escalate to ESCALATE_VISION_TO only for high-priority intents
  if (enableAIValidation && scored.length > 0 && questionText) {
    const intent = brief.imageIntent || 'photo';
    const minAIScore = getMinAIScore(intent);
    const validatedCandidates = [];

    // v3.7: Check for auto-accept candidates (very high text score from trusted sources)
    // These are obvious good matches that don't need vision validation
    const topCandidate = scored[0];
    if (topCandidate &&
        topCandidate.score >= AUTO_ACCEPT_SCORE_THRESHOLD &&
        (topCandidate.source === 'commons' || topCandidate.source === 'wikipedia') &&
        (topCandidate.mime === 'image/svg+xml' || intent === 'labeled_diagram')) {
      process.stdout.write(` [AUTO-ACCEPT:${topCandidate.score}]`);
      return topCandidate;
    }

    // Phase 1: Validate top candidates (reduced from 3 to save API calls)
    for (let i = 0; i < Math.min(MAX_VISION_CANDIDATES, scored.length); i++) {
      const candidate = scored[i];
      if (candidate.score < MIN_ACCEPT_SCORE.default) continue;

      // v3.7: Get canonical key for caching
      const canonicalKey = candidate._canonicalKey || getCanonicalKey(candidate);
      candidate._canonicalKey = canonicalKey;

      process.stdout.write(` [v${i + 1}]`);
      const validation = await validateImageWithAI(
        candidate.imageUrl,
        questionText,
        subject,
        brief,
        canonicalKey  // v3.7: Pass canonical key for caching
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
    }

    // Phase 2: Escalate to more candidates only for high-priority intents
    const isHighPriority = intent === 'labeled_diagram' ||
                           intent === 'map' ||
                           brief.riskProfile === 'human_vs_animal';

    if (isHighPriority && scored.length > MAX_VISION_CANDIDATES) {
      process.stdout.write(` [escalating]`);
      for (let i = MAX_VISION_CANDIDATES; i < Math.min(ESCALATE_VISION_TO, scored.length); i++) {
        const candidate = scored[i];
        if (candidate.score < MIN_ACCEPT_SCORE.default) continue;

        const canonicalKey = candidate._canonicalKey || getCanonicalKey(candidate);
        candidate._canonicalKey = canonicalKey;

        process.stdout.write(` [v${i + 1}]`);
        const validation = await validateImageWithAI(
          candidate.imageUrl,
          questionText,
          subject,
          brief,
          canonicalKey
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

      // v3.8: Get minScoreAdjust from begrippen index for difficult concepts
      const { minScoreAdjust } = extractExpectedConcepts(cleanQuestionText, subject);
      let minScore = getMinScore(brief.imageIntent, subject);
      if (minScoreAdjust < 0) {
        minScore = Math.max(MIN_ACCEPT_SCORE.default, minScore + minScoreAdjust);
      }

      let bestImage = await findBestImage(brief, usedImages, subject, cleanQuestionText, true);

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

      // v3.8: Fallback - try alternativeSearches from begrippen index
      let usedFallback = false;
      if ((!bestImage || bestImage.score < minScore) && begrippenIndex) {
        const indexMatch = begrippenIndex.matchQuestion(cleanQuestionText);
        if (indexMatch && indexMatch.alternativeSearches.length > 0) {
          process.stdout.write(` [index-fallback]`);
          const fallbackBrief = {
            ...brief,
            commonsQueries: indexMatch.alternativeSearches.slice(0, 3),
            _fallback: true,
          };
          const fallbackImage = await findBestImage(fallbackBrief, usedImages, subject, cleanQuestionText, true);
          if (fallbackImage && fallbackImage.score >= minScore) {
            bestImage = fallbackImage;
            usedFallback = true;
          }
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
          fallback: usedFallback,
        });
        const shortTitle = bestImage.title.length > 45 ? bestImage.title.substring(0, 45) + '...' : bestImage.title;
        const repairedTag = brief._repaired ? ' [repaired]' : '';
        const escalatedTag = brief._escalated ? ' [escalated]' : '';
        const fallbackTag = usedFallback ? ' [fallback]' : '';
        console.log(`✓ ${shortTitle} (score: ${bestImage.score}, min: ${minScore})${repairedTag}${escalatedTag}${fallbackTag}`);
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
 * v3.7: Initialize vision cache, process ALL questions, remove old images on fail
 */
async function processQuiz(quizPath, applyChanges = false) {
  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
  const questions = quiz.questions || quiz.question_bank || [];
  const subject = quiz.subject || path.basename(path.dirname(quizPath));
  const chapterContext = quiz.title || quiz.chapter || '';

  // v3.7: Initialize vision cache for this quiz
  visionCache = new VisionCache(quizPath);
  const cacheStats = visionCache.getStats();

  // v3.8: Initialize begrippen index for this quiz
  begrippenIndex = new BegrippenIndex(quizPath);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${path.basename(quizPath)}`);
  console.log(`Subject: ${subject}`);
  console.log(`Context: ${chapterContext}`);
  console.log(`Total questions: ${questions.length}`);
  console.log(`Vision cache: ${cacheStats.size} entries loaded`);
  console.log(`Rate limiter: ${GEMINI_RPM} RPM (${Math.ceil(60000/GEMINI_RPM/1000)}s between calls)`);
  console.log(`${'='.repeat(60)}`);

  const usedImages = new Set();
  const allResults = [];
  const escalationState = { count: 0 }; // v3.3: Track escalations across batches

  // v3.7: Process ALL questions that could have images
  // Questions without valid images will have their old images removed
  const needsImage = questions.filter(q => {
    const skipTypes = ['matching', 'table_parse', 'ratio_table', 'data_table', 'fill_blank'];
    if (skipTypes.includes(q.type)) return false;
    return true; // Process all eligible questions
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

  if (applyChanges) {
    const successResults = allResults.filter(r => r.success && r.imageUrl);
    const failedResults = allResults.filter(r => !r.success && r.imagePolicy !== 'none');
    const resultMap = new Map(successResults.map(r => [r.questionId, r]));
    const failedIds = new Set(failedResults.map(r => r.questionId));

    let addedCount = 0;
    let removedCount = 0;

    for (const q of questions) {
      const result = resultMap.get(q.id);
      if (result) {
        // v3.7: Add new valid image
        let caption = 'Bron: Wikimedia Commons';
        if (result.source === 'wikipedia') caption = 'Bron: Wikipedia';
        else if (result.source === 'unsplash') caption = result.attribution || 'Bron: Unsplash';
        else if (result.source === 'pexels') caption = result.attribution || 'Bron: Pexels';

        q.media = [{
          type: 'image',
          src: result.imageUrl,
          alt: result.title,
          caption,
          _source: 'ai-v3.7',
          _imageSource: result.source || 'commons',
          _searchTerm: result.searchTerm,
          _imageIntent: result.imageIntent,
          _riskProfile: result.riskProfile,
          _score: result.score,
          _escalated: result.escalated || false,
        }];
        addedCount++;
      } else if (failedIds.has(q.id)) {
        // v3.7: FAIL-CLOSED - Remove old image if no valid replacement found
        // This ensures we don't keep stale/bad images
        const hadImage = q.media && q.media.length > 0;
        if (hadImage) {
          delete q.media;
          removedCount++;
        }
      }
    }

    fs.writeFileSync(quizPath, JSON.stringify(quiz, null, 2));
    console.log(`\n✓ Applied changes to ${path.basename(quizPath)}`);
    console.log(`  - ${addedCount} images added/updated`);
    if (removedCount > 0) {
      console.log(`  - ${removedCount} old images removed (no valid replacement)`);
    }
  }

  // v3.7: Save vision cache
  if (visionCache) {
    visionCache.save();
    const finalCacheStats = visionCache.getStats();
    console.log(`\nCache stats: ${finalCacheStats.hits} hits, ${finalCacheStats.misses} misses, ${finalCacheStats.size} entries`);
  }

  // v3.7: Log rate limiter stats
  const limiterStats = geminiLimiter.getStats();
  console.log(`API calls: ${limiterStats.callCount} vision validations`);
  console.log(`Tokens remaining: ${limiterStats.tokens}/${GEMINI_RPM}`);

  const outputPath = quizPath.replace('.json', '-ai-selections.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    results: allResults,
    successCount,
    imageSuccessCount,
    noImageCount,
    escalationCount: escalationState.count,
    total: needsImage.length,
    timestamp: new Date().toISOString(),
    version: 'v3.7',
    cacheStats: visionCache ? visionCache.getStats() : null,
    rateLimiterStats: geminiLimiter.getStats(),
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
    console.error('\nv3.7: All questions are re-evaluated. Valid images are kept/updated,');
    console.error('      invalid images are removed. Use --apply to save changes.');
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

  await processQuiz(quizPath, applyChanges);
}

main().catch(console.error);
