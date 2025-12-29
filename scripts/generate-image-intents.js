/**
 * Generate Image Intents for Quiz Questions
 *
 * This script creates structured "image intents" that describe
 * WHAT should be shown, not just search terms.
 *
 * Each intent includes:
 * - Primary concept
 * - Specific focus
 * - Preferred view/representation
 * - Exclusions (what NOT to show)
 * - Educational reason
 *
 * Usage: node generate-image-intents.js <quiz-file.json>
 */

const fs = require('fs');
const path = require('path');

// Question types that should NOT get images
const NO_IMAGE_TYPES = [
  "matching",
  "table_parse",
  "ratio_table",
  "data_table",
  "wiskunde_multi_part",
  "info_card", // Usually text-focused
];

// Concept categories for biologie
const BIOLOGIE_CONCEPTS = {
  skeleton: {
    keywords: ["skelet", "bot", "botten", "schedel", "wervelkolom", "bekken", "ribbenkast"],
    imageType: "anatomisch diagram of skeletmodel",
  },
  joints: {
    keywords: ["gewricht", "kraakbeen", "kapsel", "scharniergewricht", "kogelgewricht", "rolgewricht"],
    imageType: "anatomisch diagram doorsnede",
  },
  muscles: {
    keywords: ["spier", "spiervezel", "pees", "biceps", "triceps", "samentrek", "antagonist"],
    imageType: "anatomisch diagram of foto",
  },
  boneStructure: {
    keywords: ["botweefsel", "botcel", "kalkzout", "collageen", "kring"],
    imageType: "microscopisch schema of doorsnede",
  },
  movement: {
    keywords: ["beweging", "coördinatie", "motorisch", "automatisch"],
    imageType: "foto of illustratie",
  },
  exercise: {
    keywords: ["warming-up", "cooling-down", "rekken", "training", "conditie"],
    imageType: "foto demonstratie",
  },
  injury: {
    keywords: ["rsi", "blessure", "spierpijn", "overbelasting", "houding"],
    imageType: "diagram of illustratie",
  },
  penguin: {
    keywords: ["pinguïn", "vleugel", "flipper", "kiel", "borstbeen vogel"],
    imageType: "foto of anatomisch diagram",
  },
};

/**
 * Detect which concept category a question belongs to
 */
function detectCategory(text) {
  const lower = text.toLowerCase();

  for (const [category, config] of Object.entries(BIOLOGIE_CONCEPTS)) {
    for (const keyword of config.keywords) {
      if (lower.includes(keyword)) {
        return { category, ...config };
      }
    }
  }

  return null;
}

/**
 * Generate image intent for a question
 */
function generateIntent(question, usedConcepts = new Set()) {
  // Skip certain types
  if (NO_IMAGE_TYPES.includes(question.type)) {
    return {
      questionId: question.id,
      image: null,
      reason: `Type "${question.type}" - beeld voegt geen functionele informatie toe`,
    };
  }

  const text = question.q || question.question || "";
  if (!text || text.length < 10) {
    return {
      questionId: question.id,
      image: null,
      reason: "Onvoldoende tekst om concept te bepalen",
    };
  }

  const catInfo = detectCategory(text);
  if (!catInfo) {
    return {
      questionId: question.id,
      image: null,
      reason: "Geen herkenbaar biologisch concept gevonden",
    };
  }

  // Extract specific focus from question text
  const specificFocus = extractSpecificFocus(text, catInfo.category, question);

  // Determine exclusions based on what's already used
  const exclude = [];
  if (usedConcepts.has("volledig skelet")) {
    exclude.push("volledig skelet overzicht");
  }

  // Build the intent
  const intent = {
    questionId: question.id,
    imageIntent: {
      primaryConcept: catInfo.category,
      specificFocus,
      representation: catInfo.imageType,
      exclude,
      educationalReason: generateEducationalReason(question, catInfo.category),
    },
  };

  return intent;
}

/**
 * Extract specific focus from question text
 */
function extractSpecificFocus(text, category, question) {
  const lower = text.toLowerCase();

  // Get answer context if available (helps determine what's being asked)
  const answers = question.a || question.answers || [];
  const correctIdx = question.c ?? question.correctIndex ?? 0;
  const correctAnswer = answers[correctIdx] || "";
  const explanation = question.e || question.explanation || "";

  // Combine all text for keyword detection
  const fullContext = `${lower} ${correctAnswer.toLowerCase()} ${explanation.toLowerCase()}`;

  // Specific mappings based on keywords - ordered by specificity
  const focusMappings = [
    // Very specific (check first)
    { pattern: /ribbenkast|ribben.*romp|romp.*ribben|borstbeen/, focus: "ribbenkast met ribben en borstbeen (vooraanzicht)" },
    { pattern: /fontanel|open.*schedel/, focus: "fontanellen bij baby schedel" },
    { pattern: /naad.*schedel|schedel.*naad|schedelbeen/, focus: "schedelnaden (suturae)" },
    { pattern: /kraakbeenlaag|laagjes.*gewricht/, focus: "kraakbeenlaagjes in gewricht (doorsnede)" },
    { pattern: /gewrichtskapsel|kapsel.*gewricht/, focus: "gewrichtskapsel met synoviaal vloeistof" },
    { pattern: /gewrichtssmeer|synoviaal/, focus: "gewricht met synoviaal vloeistof" },
    { pattern: /kogelgewricht|schouder.*gewricht|heup.*gewricht/, focus: "kogelgewricht (schouder of heup)" },
    { pattern: /scharniergewricht|knie.*gewricht|elleboog/, focus: "scharniergewricht (knie)" },
    { pattern: /rolgewricht|spaakbeen.*ellepijp|draaien.*onderarm/, focus: "rolgewricht spaakbeen/ellepijp" },
    { pattern: /tussenwervelschijf|schijf.*wervel/, focus: "tussenwervelschijf (doorsnede)" },
    { pattern: /s-vorm|dubbele.*s|wervelkolom.*kracht/, focus: "S-vormige wervelkolom (zijaanzicht)" },
    { pattern: /botcel.*kring|kring.*kanaal/, focus: "botstructuur met osteocyten in kringen (microscoop)" },
    { pattern: /kalkzout|hardheid.*bot/, focus: "compacte botstructuur (kalkzouten)" },
    { pattern: /collageen|buigzaam.*bot|kind.*bot/, focus: "botweefsel met collageen vezels" },
    { pattern: /pees.*bot|aanhechting|vast.*bot/, focus: "spier-pees-bot aanhechting" },
    { pattern: /biceps.*triceps|antagonist|buig.*strek/, focus: "biceps en triceps als antagonisten" },
    { pattern: /biceps.*buig|arm.*buig/, focus: "biceps spiercontractie bij armbuiging" },
    { pattern: /triceps|arm.*strek/, focus: "triceps spiercontractie bij armstrekking" },
    { pattern: /korter.*dikker|samentrek/, focus: "spiercontractie (korter en dikker)" },
    { pattern: /glad.*spier|darm.*spier|orgaan.*spier/, focus: "gladde spieren in organen" },
    { pattern: /haar.*spier|kippenvel/, focus: "haarspiertje (arrector pili)" },
    { pattern: /warming-up|warm.*spier|bloed.*spier/, focus: "warming-up oefeningen" },
    { pattern: /cooling-down|afkoelen|afvalstoffen.*spier/, focus: "cooling-down stretching" },
    { pattern: /rekoefen|stretching/, focus: "rekoefeningen/stretching" },
    { pattern: /rsi|repetitive|beeldscherm/, focus: "RSI preventie (ergonomische werkplek)" },
    { pattern: /zithouding|rechte.*hoek/, focus: "ergonomische zithouding (90 graden)" },
    { pattern: /pinguïn.*zwem|flipper|vleugel.*water/, focus: "pinguïn zwemmend (vleugels als flippers)" },
    { pattern: /pinguïn.*loop|waggel/, focus: "pinguïn lopend (waggelende gang)" },
    { pattern: /kiel.*borst|borstspier.*vogel/, focus: "vogelskelet met kiel (sternum)" },

    // More general (check last)
    { pattern: /skelet/, focus: "menselijk skelet overzicht" },
    { pattern: /gewricht/, focus: "gewricht doorsnede" },
    { pattern: /spier/, focus: "skeletspier anatomie" },
    { pattern: /bot/, focus: "bot anatomie" },
  ];

  for (const mapping of focusMappings) {
    if (mapping.pattern.test(fullContext)) {
      return mapping.focus;
    }
  }

  // Fallback based on category
  const categoryDefaults = {
    skeleton: "menselijk skelet",
    joints: "gewricht anatomie",
    muscles: "spieranatomie",
    boneStructure: "botweefsel structuur",
    movement: "beweging en coördinatie",
    exercise: "sport en training",
    injury: "blessure of overbelasting",
    penguin: "pinguïn anatomie",
  };

  return categoryDefaults[category] || "algemeen concept";
}

/**
 * Generate educational reason for the image
 */
function generateEducationalReason(question, category) {
  const reasons = {
    skeleton: "Leerlingen moeten skelletonderdelen kunnen identificeren en lokaliseren",
    joints: "Visuele ondersteuning bij begrip van gewrichtsstructuur en -functie",
    muscles: "Helpt bij begrip van spierwerking en aanhechting",
    boneStructure: "Microscopisch niveau verbinden met macroscopische eigenschappen",
    movement: "Illustratie van bewegingsconcepten",
    exercise: "Praktische toepassing van theorie zichtbaar maken",
    injury: "Bewustwording van blessurepreventie",
    penguin: "Toepassing van menselijke anatomie op dieren (vergelijking)",
  };

  return reasons[category] || "Visuele ondersteuning bij het leren";
}

/**
 * Generate quiz context (toets-brede informatie)
 */
function generateQuizContext(quiz, filePath) {
  return {
    domain: "Biologie – Stevigheid en Beweging",
    level: "Gymnasium 1 / Brugklas",
    didacticStyle: "leerboekachtig, herkenbaar, geen entertainment",
    preferredImageTypes: [
      "duidelijk anatomisch diagram",
      "realistische foto met educatieve focus",
      "schematische doorsnede",
      "gelabeld model",
    ],
    avoidImageTypes: [
      "cartoons of stripfiguren",
      "museumopstellingen",
      "kunstzinnige interpretaties",
      "iconen of pictogrammen",
      "infographics met veel tekst",
      "stockfoto's met irrelevante context",
    ],
    globalConstraints: {
      humanOnly: true,
      noPathologyUnlessExplicit: true,
      noAnimalsUnlessExplicit: true,
    },
  };
}

/**
 * Process entire quiz
 */
function processQuiz(quizPath) {
  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));

  const context = generateQuizContext(quiz, quizPath);
  const usedConcepts = new Set();
  const intents = [];

  console.log(`Processing ${quiz.questions?.length || 0} questions...\n`);

  for (const q of quiz.questions || []) {
    const intent = generateIntent(q, usedConcepts);
    intents.push(intent);

    // Track used concepts to avoid repetition
    if (intent.imageIntent?.specificFocus) {
      usedConcepts.add(intent.imageIntent.specificFocus);
    }
  }

  const withImage = intents.filter(i => i.imageIntent);
  const withoutImage = intents.filter(i => !i.imageIntent);

  console.log(`Generated ${withImage.length} image intents`);
  console.log(`Skipped ${withoutImage.length} questions\n`);

  return {
    quizId: quiz.id,
    context,
    intents,
    usedConcepts: [...usedConcepts],
  };
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node generate-image-intents.js <quiz-file.json>');
    process.exit(1);
  }

  const quizPath = path.resolve(args[0]);

  if (!fs.existsSync(quizPath)) {
    console.error(`File not found: ${quizPath}`);
    process.exit(1);
  }

  const result = processQuiz(quizPath);

  // Print intents
  console.log('=== QUIZ CONTEXT ===\n');
  console.log(JSON.stringify(result.context, null, 2));
  console.log('\n=== IMAGE INTENTS ===\n');

  for (const intent of result.intents) {
    if (intent.imageIntent) {
      console.log(`${intent.questionId}:`);
      console.log(`  Focus: ${intent.imageIntent.specificFocus}`);
      console.log(`  Type: ${intent.imageIntent.representation}`);
      console.log(`  Reason: ${intent.imageIntent.educationalReason}`);
      if (intent.imageIntent.exclude.length > 0) {
        console.log(`  Exclude: ${intent.imageIntent.exclude.join(', ')}`);
      }
      console.log('');
    } else {
      console.log(`${intent.questionId}: [geen afbeelding] - ${intent.reason}`);
    }
  }

  // Save to file
  const outputPath = quizPath.replace('.json', '-image-intents.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nSaved to: ${outputPath}`);
}

module.exports = { processQuiz, generateIntent };
