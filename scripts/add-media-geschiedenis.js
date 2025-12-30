/**
 * Add media queries to Geschiedenis H2P2-H3 quiz questions
 *
 * Run with: node scripts/add-media-geschiedenis.js
 */

const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', 'data', 'geschiedenis', 'h2p2-h3-quiz.json');
const outputPath = inputPath; // Overwrite

// Read the quiz
const quiz = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// Media mappings based on question content
const mediaMap = {
  // Egypte - Narmer en vereniging
  'g-003': {
    query: 'narmer palette ancient egypt unification',
    alt: 'Narmer-palet Egypte vereniging',
    representation: 'photo',
    negativeTerms: ['replica', 'modern'],
    qids: ['Q208291']
  },
  // Atheense democratie
  'g-004': {
    query: 'athenian democracy agora voting',
    alt: 'Atheense democratie volksvergadering',
    representation: 'diagram',
    negativeTerms: ['modern'],
    qids: ['Q145449']
  },
  'g-005': {
    query: 'athenian democracy citizens slaves excluded',
    alt: 'beperkte democratie Athene',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q145449']
  },
  // Griekse mythen
  'g-006': {
    query: 'greek mythology olympus gods illustration',
    alt: 'Griekse mythologie goden',
    representation: 'diagram',
    negativeTerms: ['disney', 'cartoon'],
    qids: ['Q33927']
  },
  // Wetenschap en mythen
  'g-008': {
    query: 'greek philosophy science thales natural explanation',
    alt: 'Griekse filosofie wetenschap',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q122393']
  },
  // Marathon
  'g-009': {
    query: 'battle of marathon 490 BC map',
    alt: 'Slag bij Marathon 490 v.C.',
    representation: 'map',
    negativeTerms: ['running', 'sport'],
    qids: ['Q205588']
  },
  // Steen van Rosetta
  'g-010': {
    query: 'rosetta stone hieroglyphics demotic greek',
    alt: 'Steen van Rosetta hiërogliefen',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q80930']
  },
  // Athene vs Sparta
  'g-011': {
    query: 'athens sparta comparison ancient greece map',
    alt: 'Athene vs Sparta vergelijking',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q1524', 'Q5765']
  },
  // Sociale structuur Athene
  'g-012': {
    query: 'athenian social classes citizens metics slaves diagram',
    alt: 'sociale klassen Athene burgers metoiken slaven',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q1524']
  },
  // Mummificatie
  'g-013': {
    query: 'egyptian mummification afterlife ka ba',
    alt: 'Egyptische mummificatie hiernamaals',
    representation: 'diagram',
    negativeTerms: ['horror', 'movie'],
    qids: ['Q178885']
  },
  // Loting Athene
  'g-015': {
    query: 'athenian democracy sortition lottery kleroterion',
    alt: 'loting Atheense democratie',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q378174']
  },
  // Olympische Spelen
  'g-016': {
    query: 'ancient olympic games olympia zeus temple',
    alt: 'antieke Olympische Spelen Olympia',
    representation: 'photo',
    negativeTerms: ['modern', '2024'],
    qids: ['Q8447']
  },
  'g-017': {
    query: 'ancient olympics sacred truce greece map',
    alt: 'heilige wapenstilstand Olympische Spelen',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q8447']
  },
  // Griekse kolonisatie
  'g-018': {
    query: 'greek colonization mediterranean map colonies',
    alt: 'Griekse kolonisatie Middellandse Zee',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q9242711']
  },
  // Egyptische ambtenaren/schrijvers
  'g-020': {
    query: 'ancient egypt scribe administration hieroglyphics',
    alt: 'Egyptische schrijvers administratie',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q333573']
  },
  // Alexander de Grote
  'g-021': {
    query: 'alexander the great empire map hellenism',
    alt: 'Alexander de Grote rijk hellenisme',
    representation: 'map',
    negativeTerms: ['movie'],
    qids: ['Q8409']
  },
  'g-022': {
    query: 'hellenistic period greek culture spread map',
    alt: 'hellenisme verspreiding Griekse cultuur',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q102248']
  },
  // Piramides
  'g-023': {
    query: 'pyramids of giza ancient egypt pharaoh',
    alt: 'piramides van Gizeh farao',
    representation: 'photo',
    negativeTerms: ['modern'],
    qids: ['Q37200']
  },
  // Narmer-palet
  'g-024': {
    query: 'narmer palette upper lower egypt unification',
    alt: 'Narmer-palet Boven- en Beneden-Egypte',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q208291']
  },
  // Olympische Spelen start
  'g-027': {
    query: 'ancient olympia stadium 776 BC reconstruction',
    alt: 'Olympia stadion 776 v.C.',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q6100']
  },
  // Pytheas
  'g-028': {
    query: 'pytheas voyage exploration thule map',
    alt: 'Pytheas reis naar Thule',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q310170']
  },
  // Olympus en Delphi
  'g-029': {
    query: 'mount olympus greece delphi oracle apollo',
    alt: 'Olympus en Delphi orakel',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q1941', 'Q26456']
  },
  // Nijl
  'g-031': {
    query: 'nile river egypt flooding agriculture kemet',
    alt: 'Nijl overstroming vruchtbaar land',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q3392']
  },
  // Salamis
  'g-032': {
    query: 'battle of salamis 480 BC map naval',
    alt: 'zeeslag bij Salamis 480 v.C.',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q131212']
  },
  'g-033': {
    query: 'battle of salamis strait tactics trireme',
    alt: 'Salamis zeestraat strategie',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q131212']
  },
  // Barbaren
  'g-034': {
    query: 'ancient greece barbarians concept map',
    alt: 'Grieken en barbaren concept',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q37956']
  },
  // Tirannie
  'g-035': {
    query: 'greek tyranny tyrant ancient greece',
    alt: 'Griekse tirannie machthebber',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q181138']
  },
  // Vaasafbeeldingen
  'g-036': {
    query: 'greek vase painting red figure black figure',
    alt: 'Griekse vaasschildering',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q738680']
  },
  // Asklepios
  'g-037': {
    query: 'asclepius rod of asclepius medicine symbol',
    alt: 'Asklepios esculaapstaf geneeskunde',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q107575']
  },
  // Peloponnesische oorlog
  'g-039': {
    query: 'peloponnesian war athens sparta map',
    alt: 'Peloponnesische oorlog Athene Sparta',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q165139']
  },
  // Vierspan
  'g-040': {
    query: 'ancient greek chariot racing quadriga vase',
    alt: 'Grieks wagenrennen vierspan',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q36920']
  },
  // Olympische Spelen vergelijking
  'g-041': {
    query: 'ancient vs modern olympic games comparison',
    alt: 'antieke vs moderne Olympische Spelen',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q8447', 'Q5389']
  },
  // Paard van Troje
  'g-043': {
    query: 'trojan horse ancient greece troy',
    alt: 'Paard van Troje',
    representation: 'photo',
    negativeTerms: ['computer', 'virus', 'malware'],
    qids: ['Q82355']
  },
  // Democratie
  'g-045': {
    query: 'athenian democracy pnyx assembly voting',
    alt: 'Atheense democratie volksvergadering',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q145449']
  },
  // Architectuur zuilenordes
  'g-047': {
    query: 'greek column orders doric ionic corinthian parthenon',
    alt: 'Griekse zuilenordes Dorisch Ionisch Korinthisch',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q170177', 'Q182957', 'Q176126']
  },
  // Narmer jaartal
  'g-048': {
    query: 'narmer ancient egypt 3100 BC unification',
    alt: 'Narmer 3100 v.C. Egypte',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q183109']
  },
  // Mythe
  'g-049': {
    query: 'greek mythology characteristics oral tradition',
    alt: 'Griekse mythologie kenmerken',
    representation: 'diagram',
    negativeTerms: ['disney'],
    qids: ['Q33927']
  }
};

// Skip these question types
const skipTypes = ['matching', 'ordering', 'multipart', 'short_answer', 'fill_blank_dropdown'];

// Process questions
let addedCount = 0;
quiz.questions.forEach(q => {
  // Skip if already has media
  if (q.media) return;

  // Skip certain types
  if (skipTypes.includes(q.type)) return;

  // Check if we have a mapping
  const mediaInfo = mediaMap[q.id];
  if (mediaInfo) {
    q.media = {
      query: mediaInfo.query,
      alt: mediaInfo.alt,
      negativeTerms: mediaInfo.negativeTerms || [],
      qids: mediaInfo.qids || [],
      _intent: {
        primaryConcept: mediaInfo.alt,
        specificFocus: mediaInfo.alt,
        representation: mediaInfo.representation || 'diagram'
      }
    };
    addedCount++;
    console.log(`Added media to ${q.id}: ${mediaInfo.query}`);
  }
});

// Write output
fs.writeFileSync(outputPath, JSON.stringify(quiz, null, 2), 'utf8');
console.log(`\nDone! Added media to ${addedCount} questions.`);
