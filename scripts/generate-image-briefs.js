/**
 * Generate image briefs for quiz questions
 *
 * This script analyzes a quiz and generates structured "image briefs"
 * for each question that could benefit from an image.
 *
 * The briefs contain:
 * - Controlled vocabulary search terms (English for Wikipedia)
 * - Preferred image type (photo, diagram, illustration)
 * - Negative terms to avoid
 * - Fallback search terms
 *
 * Usage: node generate-image-briefs.js <quiz-file.json>
 */

const fs = require('fs');
const path = require('path');

// Subject-specific vocabulary mappings (Dutch -> English search terms)
const SUBJECT_VOCABULARY = {
  biologie: {
    // Skeleton & bones
    "skelet": ["human skeleton", "skeletal system"],
    "bot": ["bone anatomy", "bone structure"],
    "botten": ["bones human", "skeletal bones"],
    "ribbenkast": ["rib cage", "thoracic cage", "ribs sternum"],
    "borstbeen": ["sternum", "breastbone"],
    "wervelkolom": ["vertebral column", "spine anatomy"],
    "wervel": ["vertebra", "spinal vertebra"],
    "schedel": ["human skull", "cranium"],
    "fontanel": ["fontanelle baby skull"],
    "bekken": ["pelvis", "pelvic bone"],
    "heup": ["hip bone", "hip joint"],
    "dijbeen": ["femur", "thigh bone"],
    "knieschijf": ["patella", "kneecap"],
    "scheenbeen": ["tibia", "shinbone"],
    "kuitbeen": ["fibula"],
    "spaakbeen": ["radius bone", "forearm radius"],
    "ellepijp": ["ulna bone", "forearm ulna"],
    "sleutelbeen": ["clavicle", "collarbone"],
    "schouderblad": ["scapula", "shoulder blade"],

    // Joints & connective tissue
    "gewricht": ["joint anatomy", "synovial joint"],
    "kraakbeen": ["cartilage", "articular cartilage"],
    "gewrichtskapsel": ["joint capsule", "synovial capsule"],
    "gewrichtssmeer": ["synovial fluid"],
    "kogelgewricht": ["ball and socket joint"],
    "scharniergewricht": ["hinge joint"],
    "rolgewricht": ["pivot joint"],
    "tussenwervelschijf": ["intervertebral disc", "spinal disc"],
    "kapselband": ["ligament", "joint ligament"],

    // Muscles
    "spier": ["muscle anatomy", "skeletal muscle"],
    "spiervezel": ["muscle fiber", "myocyte"],
    "pees": ["tendon"],
    "biceps": ["biceps brachii", "arm flexor"],
    "triceps": ["triceps brachii", "arm extensor"],
    "antagonist": ["antagonist muscles", "muscle pair"],
    "spiercontractie": ["muscle contraction"],

    // Bone tissue
    "botweefsel": ["bone tissue", "osseous tissue"],
    "kalkzouten": ["calcium bone", "bone mineralization"],
    "collageen": ["collagen bone", "bone collagen"],
    "botcel": ["osteocyte", "bone cell"],

    // Movement & health
    "warming-up": ["warm up exercise", "stretching exercise"],
    "cooling-down": ["cool down exercise", "recovery stretching"],
    "rsi": ["repetitive strain injury", "RSI computer"],
    "blessure": ["sports injury", "muscle injury"],
    "spierpijn": ["muscle soreness", "DOMS"],
    "motorisch geheugen": ["motor memory", "muscle memory"],
    "coordinatie": ["motor coordination", "movement coordination"],

    // Animals
    "pinguin": ["penguin anatomy", "penguin skeleton"],
  },

  geschiedenis: {
    // Prehistory
    "prehistorie": ["prehistory", "prehistoric era"],
    "steentijd": ["Stone Age", "paleolithic"],
    "bronstijd": ["Bronze Age"],
    "ijzertijd": ["Iron Age"],
    "jager-verzamelaar": ["hunter gatherer", "prehistoric humans"],
    "landbouwrevolutie": ["Neolithic Revolution", "agricultural revolution"],
    "nederzetting": ["ancient settlement", "prehistoric village"],

    // Ancient civilizations
    "mesopotamie": ["Mesopotamia", "ancient Mesopotamia"],
    "egypte": ["ancient Egypt"],
    "piramide": ["Egyptian pyramid", "Giza pyramid"],
    "farao": ["pharaoh", "Egyptian pharaoh"],
    "mummie": ["Egyptian mummy"],
    "hierogliefen": ["hieroglyphics", "Egyptian writing"],
    "nijl": ["Nile River", "ancient Nile"],
    "spijkerschrift": ["cuneiform", "Sumerian writing"],

    // Greece & Rome
    "griekenland": ["ancient Greece"],
    "grieken": ["ancient Greeks"],
    "democratie": ["Athenian democracy", "ancient Greek democracy"],
    "polis": ["Greek polis", "city state"],
    "rome": ["ancient Rome"],
    "romeinen": ["ancient Romans"],
    "republiek": ["Roman Republic"],
    "keizer": ["Roman emperor"],
    "colosseum": ["Colosseum Rome"],
    "aquaduct": ["Roman aqueduct"],

    // Concepts
    "beschaving": ["ancient civilization"],
    "mythologie": ["Greek mythology", "Roman mythology"],
    "tempel": ["ancient temple"],
    "godenbeeld": ["ancient statue god"],
  },

  aardrijkskunde: {
    // Physical geography
    "aarde": ["Earth planet", "Earth from space"],
    "continent": ["world continents", "continental map"],
    "oceaan": ["ocean", "world oceans"],
    "zee": ["sea"],
    "rivier": ["river"],
    "berg": ["mountain"],
    "gebergte": ["mountain range"],
    "vulkaan": ["volcano"],
    "woestijn": ["desert"],
    "regenwoud": ["rainforest", "tropical rainforest"],
    "klimaat": ["climate zones", "world climate"],
    "klimaatzone": ["climate zone map"],

    // Human geography
    "bevolking": ["world population", "population density"],
    "stad": ["city aerial", "urban area"],
    "hoofdstad": ["capital city"],
    "land": ["country map"],
    "grens": ["border", "national border"],
    "migratie": ["migration", "human migration"],

    // Maps & tools
    "kaart": ["world map", "geographic map"],
    "globe": ["globe Earth"],
    "atlas": ["atlas map"],
    "kompas": ["compass navigation"],
    "breedtegraad": ["latitude lines"],
    "lengtegraad": ["longitude lines"],
  },
};

// Question types that should NOT get images
const SKIP_TYPES = [
  "matching",
  "table_parse",
  "ratio_table",
  "data_table",
  "wiskunde_multi_part",
  "ordering", // Usually conceptual, not visual
];

// Preferred image types per concept category
const IMAGE_TYPE_PREFERENCES = {
  anatomy: "labeled diagram",
  skeleton: "anatomical model or diagram",
  joint: "anatomical diagram cross-section",
  muscle: "anatomical illustration",
  exercise: "photo demonstration",
  animal: "photo wildlife",
  historical_person: "portrait painting or statue",
  historical_place: "photo ruins or reconstruction",
  historical_object: "museum photo",
  geography_physical: "photo landscape",
  geography_map: "map or diagram",
};

/**
 * Detect subject from quiz metadata or file path
 */
function detectSubject(quiz, filePath) {
  if (quiz.subject) {
    const s = quiz.subject.toLowerCase();
    if (s.includes('biologie')) return 'biologie';
    if (s.includes('geschiedenis')) return 'geschiedenis';
    if (s.includes('aardrijkskunde')) return 'aardrijkskunde';
  }

  const fp = filePath.toLowerCase();
  if (fp.includes('biologie')) return 'biologie';
  if (fp.includes('geschiedenis')) return 'geschiedenis';
  if (fp.includes('aardrijkskunde')) return 'aardrijkskunde';

  return null;
}

/**
 * Extract key concepts from question text
 */
function extractConcepts(text, vocabulary) {
  const lower = text.toLowerCase();
  const found = [];

  for (const [dutch, english] of Object.entries(vocabulary)) {
    if (lower.includes(dutch)) {
      found.push({ dutch, english });
    }
  }

  return found;
}

/**
 * Generate image brief for a single question
 */
function generateBrief(question, subject, vocabulary) {
  // Skip certain question types
  if (SKIP_TYPES.includes(question.type)) {
    return null;
  }

  // Get question text
  const text = question.q || question.question || question.prompt_html ||
               question.instruction || question.title || "";

  if (!text || text.length < 10) {
    return null;
  }

  // Extract concepts
  const concepts = extractConcepts(text, vocabulary);

  if (concepts.length === 0) {
    return null; // No recognizable concepts
  }

  // Build search terms from concepts
  const searchTerms = [];
  concepts.forEach(c => {
    searchTerms.push(...c.english);
  });

  // Determine preferred image type
  let preferredType = "photo or diagram";
  const primaryConcept = concepts[0].dutch;

  if (['skelet', 'bot', 'gewricht', 'spier', 'kraakbeen'].some(c => primaryConcept.includes(c))) {
    preferredType = "anatomical diagram or model";
  } else if (['piramide', 'colosseum', 'tempel'].some(c => primaryConcept.includes(c))) {
    preferredType = "photo";
  } else if (['kaart', 'klimaat', 'continent'].some(c => primaryConcept.includes(c))) {
    preferredType = "map or diagram";
  }

  // Build negative terms based on subject
  const negativeTerms = [
    "cartoon",
    "meme",
    "logo",
    "icon",
    "clipart",
  ];

  if (subject === 'biologie') {
    negativeTerms.push("dinosaur", "fossil", "museum exhibit");
  }

  return {
    questionId: question.id,
    concepts: concepts.map(c => c.dutch),
    searchTerms: [...new Set(searchTerms)].slice(0, 5), // Max 5 unique terms
    preferredType,
    negativeTerms,
    fallbackSearch: searchTerms[0] || null,
  };
}

/**
 * Generate briefs for entire quiz
 */
function generateQuizBriefs(quizPath) {
  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
  const subject = detectSubject(quiz, quizPath);

  if (!subject) {
    console.error('Could not detect subject. Supported: biologie, geschiedenis, aardrijkskunde');
    return null;
  }

  const vocabulary = SUBJECT_VOCABULARY[subject];
  if (!vocabulary) {
    console.error(`No vocabulary defined for subject: ${subject}`);
    return null;
  }

  console.log(`Detected subject: ${subject}`);
  console.log(`Processing ${quiz.questions?.length || 0} questions...\n`);

  const briefs = [];
  const skipped = [];

  for (const q of quiz.questions || []) {
    const brief = generateBrief(q, subject, vocabulary);
    if (brief) {
      briefs.push(brief);
    } else {
      skipped.push(q.id);
    }
  }

  console.log(`Generated ${briefs.length} image briefs`);
  console.log(`Skipped ${skipped.length} questions (no concepts or excluded type)\n`);

  return {
    quizId: quiz.id,
    subject,
    briefs,
    skipped,
  };
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node generate-image-briefs.js <quiz-file.json>');
    console.log('\nExample:');
    console.log('  node generate-image-briefs.js ../data/biologie/h4-stevigheid-beweging-proeftoets.json');
    process.exit(1);
  }

  const quizPath = path.resolve(args[0]);

  if (!fs.existsSync(quizPath)) {
    console.error(`File not found: ${quizPath}`);
    process.exit(1);
  }

  const result = generateQuizBriefs(quizPath);

  if (result) {
    // Output briefs
    console.log('=== IMAGE BRIEFS ===\n');
    for (const brief of result.briefs) {
      console.log(`${brief.questionId}:`);
      console.log(`  Concepts: ${brief.concepts.join(', ')}`);
      console.log(`  Search: ${brief.searchTerms.join(' | ')}`);
      console.log(`  Type: ${brief.preferredType}`);
      console.log('');
    }

    // Save to file
    const outputPath = quizPath.replace('.json', '-image-briefs.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nSaved to: ${outputPath}`);
  }
}

module.exports = { generateQuizBriefs, SUBJECT_VOCABULARY };
