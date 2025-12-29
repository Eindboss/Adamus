/**
 * Extended vocabulary with Wikidata QIDs
 *
 * This vocabulary maps Dutch terms to:
 * - Wikidata QIDs (for depicts/structured data queries)
 * - English search terms (fallback)
 * - Preferred image types
 * - Negative terms to avoid
 *
 * QIDs enable searching Commons via "depicts" (P180) which is much more precise
 * than text-based search.
 */

const VOCABULARY_BIOLOGIE = {
  // === SKELETON & BONES ===
  "skelet": {
    qids: ["Q12107251"], // human skeleton
    searchTerms: ["human skeleton anatomy", "skeletal system"],
    preferredType: "labeled diagram",
    negativeTerms: ["dinosaur", "fossil", "museum"]
  },
  "bot": {
    qids: ["Q265868"], // bone (anatomy)
    searchTerms: ["bone anatomy", "bone structure"],
    preferredType: "diagram",
    negativeTerms: ["dinosaur", "fossil"]
  },
  "ribbenkast": {
    qids: ["Q193304"], // rib cage
    searchTerms: ["rib cage sternum human anatomy", "thoracic cage"],
    preferredType: "labeled diagram",
    negativeTerms: ["dinosaur", "armor"]
  },
  "borstbeen": {
    qids: ["Q103148"], // sternum
    searchTerms: ["sternum breastbone anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "wervelkolom": {
    qids: ["Q182524"], // vertebral column
    searchTerms: ["vertebral column spine anatomy"],
    preferredType: "labeled diagram",
    negativeTerms: ["scoliosis", "disease"]
  },
  "schedel": {
    qids: ["Q13147"], // human skull
    searchTerms: ["human skull anatomy cranium"],
    preferredType: "labeled diagram",
    negativeTerms: ["dinosaur", "fossil"]
  },
  "fontanel": {
    qids: ["Q590684"], // fontanelle
    searchTerms: ["infant skull fontanelle diagram", "fontanelle baby"],
    preferredType: "labeled diagram",
    negativeTerms: ["surgery", "trauma"]
  },
  "bekken": {
    qids: ["Q339767"], // pelvis
    searchTerms: ["pelvis anatomy pelvic bone"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "dijbeen": {
    qids: ["Q172517"], // femur
    searchTerms: ["femur thigh bone anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "knieschijf": {
    qids: ["Q181221"], // patella
    searchTerms: ["patella kneecap anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "scheenbeen": {
    qids: ["Q182140"], // tibia
    searchTerms: ["tibia shinbone anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "kuitbeen": {
    qids: ["Q182168"], // fibula
    searchTerms: ["fibula anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "spaakbeen": {
    qids: ["Q181946"], // radius
    searchTerms: ["radius bone forearm anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "ellepijp": {
    qids: ["Q182251"], // ulna
    searchTerms: ["ulna bone forearm anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "sleutelbeen": {
    qids: ["Q181940"], // clavicle
    searchTerms: ["clavicle collarbone anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "schouderblad": {
    qids: ["Q182209"], // scapula
    searchTerms: ["scapula shoulder blade anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },

  // === JOINTS & CONNECTIVE TISSUE ===
  "gewricht": {
    qids: ["Q3359045"], // synovial joint
    searchTerms: ["joint anatomy synovial joint"],
    preferredType: "cross-section diagram",
    negativeTerms: ["arthritis", "disease"]
  },
  "kraakbeen": {
    qids: ["Q181600"], // cartilage
    searchTerms: ["cartilage articular cartilage"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "gewrichtskapsel": {
    qids: ["Q847019"], // joint capsule
    searchTerms: ["joint capsule synovium diagram"],
    preferredType: "diagram",
    negativeTerms: ["surgery"]
  },
  "gewrichtssmeer": {
    qids: ["Q192825"], // synovial fluid
    searchTerms: ["synovial fluid lubrication diagram"],
    preferredType: "diagram",
    negativeTerms: ["arthritis"]
  },
  "kogelgewricht": {
    qids: ["Q1199023"], // ball and socket joint
    searchTerms: ["ball and socket joint shoulder anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "scharniergewricht": {
    qids: ["Q1367188"], // hinge joint
    searchTerms: ["hinge joint knee elbow anatomy"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "rolgewricht": {
    qids: ["Q1464028"], // pivot joint
    searchTerms: ["pivot joint rotation diagram"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "tussenwervelschijf": {
    qids: ["Q212808"], // intervertebral disc
    searchTerms: ["intervertebral disc diagram spine"],
    preferredType: "diagram",
    negativeTerms: ["hernia", "MRI"]
  },

  // === MUSCLES ===
  "spier": {
    qids: ["Q7365"], // muscle
    searchTerms: ["muscle anatomy skeletal muscle"],
    preferredType: "diagram",
    negativeTerms: ["bodybuilder"]
  },
  "spiervezel": {
    qids: ["Q192030"], // muscle fiber
    searchTerms: ["muscle fiber myocyte"],
    preferredType: "microscope diagram",
    negativeTerms: []
  },
  "pees": {
    qids: ["Q82356"], // tendon
    searchTerms: ["tendon anatomy attachment"],
    preferredType: "diagram",
    negativeTerms: ["surgery", "injury"]
  },
  "biceps": {
    qids: ["Q182494"], // biceps brachii
    searchTerms: ["biceps brachii arm flexor"],
    preferredType: "diagram",
    negativeTerms: ["bodybuilder"]
  },
  "triceps": {
    qids: ["Q182614"], // triceps brachii
    searchTerms: ["triceps brachii arm extensor"],
    preferredType: "diagram",
    negativeTerms: ["bodybuilder"]
  },
  "antagonist": {
    qids: ["Q2853065"], // antagonist muscle
    searchTerms: ["antagonist muscles biceps triceps pair"],
    preferredType: "diagram",
    negativeTerms: []
  },

  // === BONE TISSUE ===
  "botweefsel": {
    qids: ["Q1412687"], // bone tissue
    searchTerms: ["bone tissue osseous tissue"],
    preferredType: "microscope diagram",
    negativeTerms: []
  },
  "kalkzouten": {
    qids: ["Q271960"], // calcium phosphate (bone mineral)
    searchTerms: ["bone mineralization calcium"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "collageen": {
    qids: ["Q83375"], // collagen
    searchTerms: ["collagen fibers bone matrix"],
    preferredType: "diagram",
    negativeTerms: ["skin cosmetic"]
  },
  "botcel": {
    qids: ["Q179610"], // osteocyte
    searchTerms: ["osteocyte bone cell haversian"],
    preferredType: "microscope diagram",
    negativeTerms: []
  },
  "osteon": {
    qids: ["Q1115467"], // osteon / Haversian system
    searchTerms: ["osteon haversian system labeled"],
    preferredType: "microscope diagram",
    negativeTerms: []
  },

  // === MOVEMENT & HEALTH ===
  "warming-up": {
    qids: ["Q912831"], // warm-up
    searchTerms: ["warm up exercise dynamic stretching"],
    preferredType: "photo",
    negativeTerms: ["logo", "brand"]
  },
  "cooling-down": {
    qids: ["Q1783697"], // cool down
    searchTerms: ["cool down exercise recovery stretching"],
    preferredType: "photo",
    negativeTerms: ["logo"]
  },
  "rsi": {
    qids: ["Q831706"], // repetitive strain injury
    searchTerms: ["repetitive strain injury RSI typing"],
    preferredType: "photo",
    negativeTerms: ["x-ray", "surgery"]
  },
  "blessure": {
    qids: ["Q193078"], // sports injury
    searchTerms: ["sports injury ankle brace"],
    preferredType: "photo",
    negativeTerms: ["blood", "surgery"]
  },
  "spierpijn": {
    qids: ["Q1198311"], // muscle soreness / DOMS
    searchTerms: ["muscle soreness after exercise"],
    preferredType: "photo",
    negativeTerms: ["injury"]
  },
  "motorisch geheugen": {
    qids: ["Q1334970"], // motor memory
    searchTerms: ["motor memory muscle memory cycling"],
    preferredType: "photo",
    negativeTerms: []
  },
  "coordinatie": {
    qids: ["Q1347667"], // motor coordination
    searchTerms: ["motor coordination balance movement"],
    preferredType: "photo",
    negativeTerms: ["stunt"]
  },

  // === ANIMALS ===
  "pinguïn": {
    qids: ["Q14943"], // penguin
    searchTerms: ["penguin swimming underwater"],
    preferredType: "photo",
    negativeTerms: ["cartoon", "logo"]
  },
  "pinguïnskelet": {
    qids: ["Q14943"], // penguin (anatomy context)
    searchTerms: ["penguin skeleton flipper bones"],
    preferredType: "diagram",
    negativeTerms: ["cartoon"]
  },
  "kiel": {
    qids: ["Q1318814"], // keel (bird anatomy)
    searchTerms: ["bird sternum keel diagram"],
    preferredType: "diagram",
    negativeTerms: ["cooking", "food"]
  }
};

const VOCABULARY_GESCHIEDENIS = {
  // === PREHISTORY ===
  "prehistorie": {
    qids: ["Q11756"], // prehistory
    searchTerms: ["prehistory prehistoric era"],
    preferredType: "illustration",
    negativeTerms: []
  },
  "steentijd": {
    qids: ["Q7430"], // Stone Age
    searchTerms: ["Stone Age paleolithic tools"],
    preferredType: "photo artifact",
    negativeTerms: []
  },
  "bronstijd": {
    qids: ["Q11761"], // Bronze Age
    searchTerms: ["Bronze Age artifacts"],
    preferredType: "photo artifact",
    negativeTerms: []
  },
  "ijzertijd": {
    qids: ["Q11764"], // Iron Age
    searchTerms: ["Iron Age artifacts weapons"],
    preferredType: "photo artifact",
    negativeTerms: []
  },

  // === ANCIENT EGYPT ===
  "egypte": {
    qids: ["Q11768"], // ancient Egypt
    searchTerms: ["ancient Egypt"],
    preferredType: "photo",
    negativeTerms: []
  },
  "piramide": {
    qids: ["Q12506"], // pyramid
    searchTerms: ["Egyptian pyramid Giza"],
    preferredType: "photo",
    negativeTerms: []
  },
  "farao": {
    qids: ["Q41567"], // pharaoh
    searchTerms: ["pharaoh Egyptian statue"],
    preferredType: "photo artifact",
    negativeTerms: []
  },
  "mummie": {
    qids: ["Q40424"], // mummy
    searchTerms: ["Egyptian mummy sarcophagus"],
    preferredType: "photo museum",
    negativeTerms: []
  },
  "hierogliefen": {
    qids: ["Q82003"], // hieroglyphics
    searchTerms: ["hieroglyphics Egyptian writing"],
    preferredType: "photo",
    negativeTerms: []
  },
  "nijl": {
    qids: ["Q3392"], // Nile
    searchTerms: ["Nile River Egypt aerial"],
    preferredType: "photo",
    negativeTerms: []
  },

  // === MESOPOTAMIA ===
  "mesopotamie": {
    qids: ["Q11767"], // Mesopotamia
    searchTerms: ["Mesopotamia ancient"],
    preferredType: "map or photo",
    negativeTerms: []
  },
  "spijkerschrift": {
    qids: ["Q37574"], // cuneiform
    searchTerms: ["cuneiform tablet Sumerian"],
    preferredType: "photo artifact",
    negativeTerms: []
  },

  // === ANCIENT GREECE ===
  "griekenland": {
    qids: ["Q11772"], // ancient Greece
    searchTerms: ["ancient Greece"],
    preferredType: "photo ruins",
    negativeTerms: []
  },
  "democratie": {
    qids: ["Q127995"], // Athenian democracy
    searchTerms: ["Athenian democracy Pnyx voting"],
    preferredType: "illustration",
    negativeTerms: ["modern", "protest"]
  },
  "polis": {
    qids: ["Q212916"], // polis
    searchTerms: ["Greek polis city state acropolis"],
    preferredType: "photo ruins",
    negativeTerms: []
  },

  // === ANCIENT ROME ===
  "rome": {
    qids: ["Q18656668"], // ancient Rome
    searchTerms: ["ancient Rome"],
    preferredType: "photo ruins",
    negativeTerms: []
  },
  "colosseum": {
    qids: ["Q10285"], // Colosseum
    searchTerms: ["Colosseum Rome amphitheater"],
    preferredType: "photo",
    negativeTerms: []
  },
  "aquaduct": {
    qids: ["Q474"], // aqueduct
    searchTerms: ["Roman aqueduct Pont du Gard"],
    preferredType: "photo",
    negativeTerms: []
  },
  "keizer": {
    qids: ["Q842606"], // Roman emperor
    searchTerms: ["Roman emperor statue bust"],
    preferredType: "photo statue",
    negativeTerms: []
  }
};

const VOCABULARY_AARDRIJKSKUNDE = {
  // === PHYSICAL GEOGRAPHY ===
  "aarde": {
    qids: ["Q2"], // Earth
    searchTerms: ["Earth from space planet"],
    preferredType: "photo",
    negativeTerms: ["diagram", "cartoon"]
  },
  "continent": {
    qids: ["Q5107"], // continent
    searchTerms: ["world continents map"],
    preferredType: "map",
    negativeTerms: []
  },
  "oceaan": {
    qids: ["Q9430"], // ocean
    searchTerms: ["ocean world map"],
    preferredType: "map or photo",
    negativeTerms: []
  },
  "vulkaan": {
    qids: ["Q8072"], // volcano
    searchTerms: ["volcano eruption"],
    preferredType: "photo",
    negativeTerms: []
  },
  "woestijn": {
    qids: ["Q8514"], // desert
    searchTerms: ["desert landscape Sahara"],
    preferredType: "photo",
    negativeTerms: []
  },
  "regenwoud": {
    qids: ["Q177567"], // tropical rainforest
    searchTerms: ["tropical rainforest Amazon"],
    preferredType: "photo",
    negativeTerms: []
  },
  "klimaat": {
    qids: ["Q7937"], // climate
    searchTerms: ["climate zones world map"],
    preferredType: "map",
    negativeTerms: []
  },

  // === HUMAN GEOGRAPHY ===
  "bevolking": {
    qids: ["Q33829"], // population
    searchTerms: ["world population density map"],
    preferredType: "map",
    negativeTerms: []
  },
  "migratie": {
    qids: ["Q177626"], // human migration
    searchTerms: ["human migration world map"],
    preferredType: "map",
    negativeTerms: ["crisis", "refugees"]
  },

  // === MAPS & TOOLS ===
  "kaart": {
    qids: ["Q4006"], // map
    searchTerms: ["world map geographic"],
    preferredType: "map",
    negativeTerms: []
  },
  "globe": {
    qids: ["Q131122"], // globe
    searchTerms: ["globe Earth model"],
    preferredType: "photo",
    negativeTerms: []
  },
  "kompas": {
    qids: ["Q17416"], // compass
    searchTerms: ["compass navigation"],
    preferredType: "photo",
    negativeTerms: ["logo"]
  },
  "breedtegraad": {
    qids: ["Q34027"], // latitude
    searchTerms: ["latitude lines globe"],
    preferredType: "diagram",
    negativeTerms: []
  },
  "lengtegraad": {
    qids: ["Q36477"], // longitude
    searchTerms: ["longitude lines globe"],
    preferredType: "diagram",
    negativeTerms: []
  }
};

/**
 * Get vocabulary for a subject
 */
function getVocabulary(subject) {
  switch (subject?.toLowerCase()) {
    case 'biologie':
      return VOCABULARY_BIOLOGIE;
    case 'geschiedenis':
      return VOCABULARY_GESCHIEDENIS;
    case 'aardrijkskunde':
      return VOCABULARY_AARDRIJKSKUNDE;
    default:
      return null;
  }
}

/**
 * Look up a term in the vocabulary
 */
function lookupTerm(term, subject) {
  const vocab = getVocabulary(subject);
  if (!vocab) return null;

  const lower = term.toLowerCase();

  // Direct match
  if (vocab[lower]) {
    return { term: lower, ...vocab[lower] };
  }

  // Partial match
  for (const [key, value] of Object.entries(vocab)) {
    if (lower.includes(key) || key.includes(lower)) {
      return { term: key, ...value };
    }
  }

  return null;
}

/**
 * Extract all matching vocabulary entries from text
 */
function extractFromText(text, subject) {
  const vocab = getVocabulary(subject);
  if (!vocab) return [];

  const lower = text.toLowerCase();
  const matches = [];

  for (const [term, data] of Object.entries(vocab)) {
    if (lower.includes(term)) {
      matches.push({ term, ...data });
    }
  }

  return matches;
}

module.exports = {
  VOCABULARY_BIOLOGIE,
  VOCABULARY_GESCHIEDENIS,
  VOCABULARY_AARDRIJKSKUNDE,
  getVocabulary,
  lookupTerm,
  extractFromText
};
