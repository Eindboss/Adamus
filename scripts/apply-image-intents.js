/**
 * Apply image intents to quiz JSON
 *
 * Takes an image intents file and applies the search_terms + negative_terms
 * to the corresponding quiz questions as media.query + media.negativeTerms
 *
 * Usage: node apply-image-intents.js <intents-file.json> <quiz-file.json>
 */

const fs = require('fs');
const path = require('path');

function applyIntents(intentsPath, quizPath) {
  const intents = JSON.parse(fs.readFileSync(intentsPath, 'utf8'));
  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));

  // Build map of question id -> intent
  const intentMap = new Map();
  for (const intent of intents.intents || []) {
    if (intent.image && intent.image.search_terms) {
      intentMap.set(intent.id, intent.image);
    }
  }

  let applied = 0;
  let skipped = 0;

  for (const q of quiz.questions || []) {
    const intent = intentMap.get(q.id);

    if (!intent) {
      skipped++;
      continue;
    }

    // Use first search term as primary query
    const query = intent.search_terms[0];
    if (!query) {
      skipped++;
      continue;
    }

    // Build media object
    q.media = {
      query: query,
      alt: intent.specific_focus || intent.primary_concept,
    };

    // Add negative terms if present
    if (intent.negative_terms && intent.negative_terms.length > 0) {
      q.media.negativeTerms = intent.negative_terms;
    }

    // Store intent metadata for debugging
    q.media._intent = {
      primaryConcept: intent.primary_concept,
      specificFocus: intent.specific_focus,
      representation: intent.representation,
      uniquenessKey: intent.uniqueness_key,
    };

    applied++;
    console.log(`${q.id}: "${query}"`);
    if (intent.negative_terms?.length > 0) {
      console.log(`  negatives: ${intent.negative_terms.join(', ')}`);
    }
  }

  console.log(`\nApplied: ${applied} questions`);
  console.log(`Skipped: ${skipped} questions (no intent or no search terms)`);

  return quiz;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node apply-image-intents.js <intents-file.json> <quiz-file.json>');
    console.log('\nExample:');
    console.log('  node apply-image-intents.js \\');
    console.log('    ../data/biologie/h4-stevigheid-beweging-image-intents.json \\');
    console.log('    ../data/biologie/h4-stevigheid-beweging-proeftoets.json');
    process.exit(1);
  }

  const intentsPath = path.resolve(args[0]);
  const quizPath = path.resolve(args[1]);

  if (!fs.existsSync(intentsPath)) {
    console.error(`Intents file not found: ${intentsPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(quizPath)) {
    console.error(`Quiz file not found: ${quizPath}`);
    process.exit(1);
  }

  const updatedQuiz = applyIntents(intentsPath, quizPath);

  // Save updated quiz
  fs.writeFileSync(quizPath, JSON.stringify(updatedQuiz, null, 2), 'utf8');
  console.log(`\nSaved: ${quizPath}`);
}

module.exports = { applyIntents };
