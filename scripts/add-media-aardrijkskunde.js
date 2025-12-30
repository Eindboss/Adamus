/**
 * Add media queries to Aardrijkskunde H2 quiz questions
 *
 * Run with: node scripts/add-media-aardrijkskunde.js
 */

const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', 'data', 'aardrijkskunde', 'h2-de-wereld-quiz.json');
const outputPath = inputPath; // Overwrite

// Read the quiz
const quiz = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// Media mappings based on question content
const mediaMap = {
  // Seizoenen en aardas
  'h2-002': {
    query: 'earth rotation day night diagram',
    alt: 'aarde draait om as, dag en nacht',
    representation: 'diagram',
    negativeTerms: ['cartoon', 'kids'],
    qids: ['Q3441']
  },
  'h2-003': {
    query: 'earth axial tilt seasons diagram',
    alt: 'schuine stand aardas en seizoenen',
    representation: 'diagram',
    negativeTerms: ['cartoon'],
    qids: ['Q193757']
  },
  'h2-004': {
    query: 'tropic of cancer map',
    alt: 'Kreeftskeerkring op wereldkaart',
    representation: 'map',
    negativeTerms: ['zodiac'],
    qids: ['Q183273']
  },
  'h2-005': {
    query: 'tropic of capricorn world map',
    alt: 'Steenbokskeerkring op wereldkaart',
    representation: 'map',
    negativeTerms: ['zodiac'],
    qids: ['Q194308']
  },
  'h2-006': {
    query: 'equator climate temperature map',
    alt: 'klimaat bij de evenaar',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q23538']
  },
  'h2-007': {
    query: 'sun angle solar radiation diagram',
    alt: 'invalshoek zonnestralen',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q107']
  },
  // Temperatuur en hoogte
  'h2-008': {
    query: 'atmospheric temperature lapse rate altitude diagram',
    alt: 'temperatuurdaling per 1000 meter hoogte',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q11466']
  },
  // Golfstroom en zeeklimaat
  'h2-009': {
    query: 'gulf stream atlantic ocean current map',
    alt: 'Golfstroom warme zeestroming',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q193770']
  },
  // Wind
  'h2-010': {
    query: 'sea breeze land breeze diagram',
    alt: 'aanlandige en aflandige wind',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q190380', 'Q2374844']
  },
  'h2-011': {
    query: 'high pressure low pressure wind diagram',
    alt: 'hoge en lage druk wind',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q190101', 'Q83188']
  },
  'h2-012': {
    query: 'coastal sea breeze cooling diagram',
    alt: 'verkoelend effect zeewind',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q190380']
  },
  // Neerslag
  'h2-013': {
    query: 'condensation water cycle cloud formation diagram',
    alt: 'condensatie wolkenvorming',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q191768']
  },
  'h2-014': {
    query: 'orographic precipitation relief rainfall diagram',
    alt: 'stuwingsregen loef lijzijde',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q902098']
  },
  'h2-015': {
    query: 'frontal rainfall warm cold front diagram',
    alt: 'frontale neerslag koude warme lucht',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q192022']
  },
  'h2-016': {
    query: 'sahara desert high pressure subsidence diagram',
    alt: 'woestijn hoge druk dalende lucht',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q6583']
  },
  'h2-017': {
    query: 'koppen climate classification world map',
    alt: 'Köppen klimaatclassificatie',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q220826']
  },
  'h2-018': {
    query: 'tropical climate zone world map koppen',
    alt: 'tropisch klimaat A-zone',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q180753']
  },
  'h2-019': {
    query: 'desert climate BWh world map',
    alt: 'droog klimaat woestijn B-zone',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q185291']
  },
  'h2-021': {
    query: 'mediterranean climate Cs map',
    alt: 'mediterraan klimaat Cs',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q181885']
  },
  'h2-022': {
    query: 'mount kilimanjaro snow altitude temperature',
    alt: 'Kilimanjaro sneeuw op hoogte',
    representation: 'photo',
    negativeTerms: [],
    qids: ['Q7296']
  },
  // Klimaatgrafieken
  'h2-023': {
    query: 'climate graph temperature precipitation diagram',
    alt: 'klimaatgrafiek temperatuur neerslag',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q917641']
  },
  'h2-024': {
    query: 'southern hemisphere seasons diagram',
    alt: 'seizoenen zuidelijk halfrond',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q41228']
  },
  // Kaartvaardigheden
  'h2-027': {
    query: 'map scale ratio explanation diagram',
    alt: 'kaartschaal uitleg',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q483247']
  },
  'h2-028': {
    query: 'map scale comparison detail',
    alt: 'vergelijking kaartschaal detail',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q483247']
  },
  'h2-029': {
    query: 'map orientation north arrow compass',
    alt: 'kaart oriëntatie noorden',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q39621']
  },
  'h2-030': {
    query: 'thematic map vs topographic map comparison',
    alt: 'thematische vs topografische kaart',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q4288304', 'Q592665']
  },
  // Poolnacht
  'h2-031': {
    query: 'polar night arctic circle diagram',
    alt: 'poolnacht poolcirkel',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q466775']
  },
  // Moesson
  'h2-033': {
    query: 'monsoon india rain diagram',
    alt: 'moesson India regenpatroon',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q40382']
  },
  // Klimaatvergelijking
  'h2-034': {
    query: 'mediterranean climate Cs vs oceanic Cf comparison',
    alt: 'mediterraan vs oceaanklimaat',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q181885', 'Q3336240']
  },
  // Inzichtvragen
  'h2-036': {
    query: 'climate factors altitude ocean currents map',
    alt: 'klimaatfactoren hoogte zeestroming',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q7934']
  },
  'h2-037': {
    query: 'gulf stream europe climate effect map',
    alt: 'Golfstroom effect West-Europa',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q193770']
  },
  'h2-038': {
    query: 'hadley cell equator 30 degrees circulation diagram',
    alt: 'atmosferische circulatie evenaar 30 graden',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q189569']
  },
  'h2-039': {
    query: 'koppen climate classification system world',
    alt: 'Köppen systeem wereldwijd',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q220826']
  },
  'h2-040': {
    query: 'map legend symbols explanation',
    alt: 'legenda kaart symbolen',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q1885504']
  },
  // Nieuwe vragen
  'h2-new-005': {
    query: 'rain shadow orographic precipitation diagram',
    alt: 'regenschaduw lijzijde',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q902098']
  },
  'h2-new-008': {
    query: 'climate zones latitude world map',
    alt: 'klimaatzones breedteligging',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q125199']
  },
  'h2-new-009': {
    query: 'Cfb oceanic climate map europe',
    alt: 'Cfb zeeklimaat Europa',
    representation: 'map',
    negativeTerms: [],
    qids: ['Q3336240']
  },
  'h2-new-010': {
    query: 'Cs vs Cf climate comparison mediterranean oceanic',
    alt: 'Cs mediterraan vs Cf zeeklimaat',
    representation: 'diagram',
    negativeTerms: [],
    qids: ['Q181885', 'Q3336240']
  }
};

// Skip these question types
const skipTypes = ['matching', 'ordering', 'data_table', 'multipart', 'table_parse'];

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
