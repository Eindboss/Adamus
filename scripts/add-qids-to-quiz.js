/**
 * Add Wikidata QIDs to quiz questions based on their image intents
 *
 * This script maps specific concepts to their Wikidata QIDs for use with
 * the depicts (P180) search in Commons.
 *
 * Usage: node add-qids-to-quiz.js <quiz-file.json>
 */

const fs = require('fs');
const path = require('path');

// Map uniqueness_key / concept to Wikidata QIDs
// These are the precise entities that should be depicted in the images
const CONCEPT_TO_QIDS = {
  // Skeleton
  "skeleton-full-body": ["Q12107251"], // human skeleton
  "thorax-ribcage-sternum": ["Q193304", "Q103148"], // rib cage, sternum
  "bone-osteon": ["Q1115467"], // osteon (Haversian system)
  "bone-collagen-vs-mineral": ["Q83375", "Q271960"], // collagen, calcium phosphate
  "cartilage-ear-or-nose": ["Q181600", "Q7362"], // cartilage, ear
  "infant-fontanelle": ["Q590684"], // fontanelle
  "skull-sutures": ["Q1313458"], // cranial suture
  "cartilage-connection": ["Q212808"], // intervertebral disc (as example)
  "haversian-system": ["Q1115467"], // osteon
  "bone-collagen-fibers": ["Q83375"], // collagen

  // Joints
  "articular-cartilage": ["Q2432244"], // articular cartilage
  "joint-capsule": ["Q847019"], // joint capsule
  "ball-socket-joint": ["Q1199023"], // ball and socket joint
  "pivot-joint-radius-ulna": ["Q1464028", "Q181946"], // pivot joint, radius
  "joint-types-comparison": ["Q1199023", "Q1367188"], // ball-socket, hinge joint
  "joint-lubrication": ["Q192825"], // synovial fluid
  "ligaments-knee": ["Q843885", "Q187947"], // ligament, knee
  "intervertebral-disc": ["Q212808"], // intervertebral disc
  "spine-s-curve": ["Q182524"], // vertebral column

  // Muscles
  "tendon-attachment": ["Q82356"], // tendon
  "muscle-pulls-bone": ["Q7365", "Q82356"], // muscle, tendon
  "muscle-contraction-macro": ["Q1411410"], // muscle contraction
  "antagonistic-biceps-triceps": ["Q182494", "Q182614"], // biceps, triceps
  "biceps-flexion": ["Q182494"], // biceps brachii
  "peristalsis": ["Q1056396"], // peristalsis
  "arrector-pili": ["Q605686"], // arrector pili muscle

  // Movement & health
  "bicycle-automatic-movement": ["Q11442"], // bicycle
  "coordination-example": ["Q30953"], // balance / coordination
  "exercise-health-general": ["Q476028"], // jogging
  "warm-up": ["Q912831"], // warm-up
  "stopwatch-training": ["Q178794"], // stopwatch
  "stretching-safe": ["Q622508"], // stretching
  "cooling-down": ["Q1783697"], // cool down
  "muscle-soreness": ["Q1198311"], // delayed onset muscle soreness
  "sports-injury-general": ["Q193078"], // sports injury

  // RSI
  "rsi-typing": ["Q831706"], // repetitive strain injury
  "rsi-symptom-wrist": ["Q831706"], // RSI
  "rsi-prevention-break": ["Q831706"], // RSI
  "ergonomics-head-upright": ["Q134574"], // ergonomics
  "ergonomics-90-degrees": ["Q134574"], // ergonomics
  "phone-break": ["Q22645"], // smartphone
  "rsi-workstation": ["Q831706", "Q68"], // RSI, computer

  // Penguin
  "penguin-underwater": ["Q14943"], // penguin
  "penguin-waddle": ["Q14943"], // penguin
  "penguin-flipper-skeleton": ["Q14943"], // penguin
  "keel-sternum": ["Q1318814", "Q103148"], // keel (bird), sternum

  // Training
  "training-sequence": ["Q912831", "Q1783697"], // warm-up, cool-down
  "sprinter-training-casus": ["Q210393"], // sprinting
};

function addQidsToQuiz(quizPath) {
  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
  let updated = 0;
  let skipped = 0;

  for (const q of quiz.questions || []) {
    if (!q.media?._intent?.uniquenessKey) {
      skipped++;
      continue;
    }

    const key = q.media._intent.uniquenessKey;
    const qids = CONCEPT_TO_QIDS[key];

    if (qids && qids.length > 0) {
      q.media.qids = qids;
      updated++;
      console.log(`${q.id}: ${key} → ${qids.join(", ")}`);
    } else {
      skipped++;
      console.log(`${q.id}: ${key} → (no QIDs mapped)`);
    }
  }

  console.log(`\nUpdated: ${updated} questions with QIDs`);
  console.log(`Skipped: ${skipped} questions`);

  return quiz;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node add-qids-to-quiz.js <quiz-file.json>');
    process.exit(1);
  }

  const quizPath = path.resolve(args[0]);

  if (!fs.existsSync(quizPath)) {
    console.error(`File not found: ${quizPath}`);
    process.exit(1);
  }

  const updatedQuiz = addQidsToQuiz(quizPath);
  fs.writeFileSync(quizPath, JSON.stringify(updatedQuiz, null, 2), 'utf8');
  console.log(`\nSaved: ${quizPath}`);
}

module.exports = { addQidsToQuiz, CONCEPT_TO_QIDS };
