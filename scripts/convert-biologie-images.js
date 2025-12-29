/**
 * Convert biologie quiz from static image URLs to dynamic media.query
 * This allows the Wikimedia API to find relevant images per question
 */

const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, '../data/biologie/h4-stevigheid-beweging-proeftoets.json');
const outputFile = inputFile; // Overwrite

// Map question IDs to appropriate search queries based on content
const queryMap = {
  'q001': 'human skeleton anatomy',
  'q002': 'human ribcage sternum',
  'q003': 'bone tissue calcium',
  'q004': 'child bone flexibility collagen',
  'q005': 'human ear cartilage',
  'q006': 'baby fontanelle skull',
  'q007': 'skull sutures cranial',
  'q008': 'rib cartilage connection',
  'q009': 'bone cell osteon haversian',
  'q010': 'collagen bone flexibility',
  'q011': 'synovial joint anatomy',
  'q012': 'articular cartilage joint',
  'q013': 'joint capsule synovial fluid',
  'q014': 'shoulder ball socket joint',
  'q015': 'radius ulna rotation',
  'q016': 'knee hinge joint anatomy',
  'q017': 'synovial fluid joint lubrication',
  'q018': 'ligament joint stability',
  'q019': 'intervertebral disc spine',
  'q020': 'spine S curve vertebral column',
  'q021': 'muscle tendon attachment bone',
  'q022': 'muscle contraction movement',
  'q023': 'muscle fiber contraction',
  'q024': 'biceps triceps antagonist muscles',
  'q025': 'biceps arm flexion',
  'q026': 'smooth muscle intestine',
  'q027': 'arrector pili muscle hair',
  'q028': 'motor memory cycling',
  'q029': 'muscle coordination movement',
  'q030': 'exercise physical health',
  'q031': 'warm up exercise stretching',
  'q032': 'muscle warm up blood flow',
  'q033': 'stretching exercise proper form',
  'q034': 'cool down exercise recovery',
  'q035': 'muscle soreness lactic acid',
  'q036': 'sports injury muscle',
  'q037': 'RSI repetitive strain injury',
  'q038': 'RSI symptoms tingling',
  'q039': 'ergonomic workspace posture',
  'q040': 'computer ergonomics posture',
  'q041': 'proper sitting posture ergonomic',
  'q042': 'smartphone break RSI prevention',
  'q043': 'penguin swimming flipper',
  'q044': 'penguin walking waddle',
  'q045': 'penguin flipper anatomy',
  'q046': 'bird keel sternum breast muscle',
  'q047': null, // matching question - no image
  'q048': null, // ordering question - can have image
  'q049': 'RSI keyboard computer',
  'q050': 'sprinter training athletics'
};

// Alt text in Dutch
const altMap = {
  'q001': 'Menselijk skelet',
  'q002': 'Ribbenkast en borstbeen',
  'q003': 'Botweefsel met kalkzouten',
  'q004': 'Botopbouw bij kinderen',
  'q005': 'Kraakbeen in het oor',
  'q006': 'Fontanellen bij baby',
  'q007': 'Schedelnaden',
  'q008': 'Kraakbeenverbinding ribben',
  'q009': 'Botcellen in kringen',
  'q010': 'Collageen in botweefsel',
  'q011': 'Gewricht doorsnede',
  'q012': 'Kraakbeenlaag in gewricht',
  'q013': 'Gewrichtskapsel',
  'q014': 'Kogelgewricht schouder',
  'q015': 'Rolgewricht onderarm',
  'q016': 'Scharniergewricht knie',
  'q017': 'Gewrichtssmeer',
  'q018': 'Kapselbanden',
  'q019': 'Tussenwervelschijf',
  'q020': 'Wervelkolom S-vorm',
  'q021': 'Spier en pees',
  'q022': 'Spiercontractie',
  'q023': 'Spiervezels',
  'q024': 'Biceps en triceps',
  'q025': 'Biceps armbuiging',
  'q026': 'Gladde spieren darmen',
  'q027': 'Haarspiertje',
  'q028': 'Fietsen motorisch geheugen',
  'q029': 'Spiercoordinatie',
  'q030': 'Lichaamsbeweging gezondheid',
  'q031': 'Warming-up oefeningen',
  'q032': 'Bloedtoevoer spieren',
  'q033': 'Rekoefeningen',
  'q034': 'Cooling-down',
  'q035': 'Spierpijn',
  'q036': 'Sportblessure',
  'q037': 'RSI klachten',
  'q038': 'RSI symptomen',
  'q039': 'Ergonomische werkplek',
  'q040': 'Goede houding beeldscherm',
  'q041': 'Goede zithouding',
  'q042': 'Pauze van telefoon',
  'q043': 'Zwemmende pinguin',
  'q044': 'Lopende pinguin',
  'q045': 'Pinguinvleugel',
  'q046': 'Borstbeen vogel',
  'q047': null,
  'q048': 'Training schema',
  'q049': 'RSI preventie',
  'q050': 'Sprinter training'
};

// Read the quiz
const quiz = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// Process questions
quiz.questions = quiz.questions.map(q => {
  // Remove existing image field
  delete q.image;

  // Add media.query if we have one for this question
  const query = queryMap[q.id];
  const alt = altMap[q.id];

  if (query) {
    q.media = {
      query: query,
      alt: alt || 'Afbeelding bij vraag'
    };
  }

  return q;
});

// Write back
fs.writeFileSync(outputFile, JSON.stringify(quiz, null, 2), 'utf8');

console.log('Done! Converted', quiz.questions.length, 'questions');
console.log('Questions with media.query:', quiz.questions.filter(q => q.media?.query).length);
