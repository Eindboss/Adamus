/**
 * Apply image selections to quiz JSON
 *
 * Takes an image selections file and adds the media objects
 * to the corresponding quiz questions.
 *
 * Usage: node apply-image-selections.js <selections-file.json> <quiz-file.json>
 */

const fs = require('fs');
const path = require('path');

function applySelections(selectionsPath, quizPath) {
  const selectionsData = JSON.parse(fs.readFileSync(selectionsPath, 'utf8'));
  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));

  // Build map of question id -> selection
  const selectionMap = new Map();
  for (const sel of selectionsData.selections || []) {
    if (sel.imageUrl) {
      selectionMap.set(sel.questionId, sel);
    }
  }

  // Support both 'questions' array and 'question_bank' array
  const questions = quiz.questions || quiz.question_bank || [];
  const questionKey = quiz.questions ? 'questions' : 'question_bank';

  let applied = 0;
  let skipped = 0;
  let alreadyHasMedia = 0;

  for (const q of questions) {
    const sel = selectionMap.get(q.id);

    if (!sel) {
      skipped++;
      continue;
    }

    // Skip if question already has media
    if (q.media && q.media.length > 0) {
      alreadyHasMedia++;
      continue;
    }

    // Add media array with image
    q.media = [{
      type: "image",
      src: sel.imageUrl,
      alt: sel.title,
      caption: `Bron: Wikipedia - ${sel.title}`,
      _source: {
        wikipedia: sel.pageUrl,
        searchTerm: sel.searchTerm,
        score: sel.score,
      }
    }];

    applied++;
    console.log(`  ${q.id}: Added "${sel.title}"`);
  }

  // Write updated quiz
  const outputPath = quizPath.replace('.json', '-with-images.json');
  fs.writeFileSync(outputPath, JSON.stringify(quiz, null, 2));

  console.log(`\nApplied ${applied} images`);
  console.log(`Skipped ${skipped} questions (no selection)`);
  console.log(`Already had media: ${alreadyHasMedia} questions`);
  console.log(`\nSaved to: ${outputPath}`);

  return { applied, skipped, alreadyHasMedia, outputPath };
}

// Also support applying directly to the original quiz file
function applySelectionsInPlace(selectionsPath, quizPath) {
  const selectionsData = JSON.parse(fs.readFileSync(selectionsPath, 'utf8'));
  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));

  // Build map of question id -> selection
  const selectionMap = new Map();
  for (const sel of selectionsData.selections || []) {
    if (sel.imageUrl) {
      selectionMap.set(sel.questionId, sel);
    }
  }

  // Support both 'questions' array and 'question_bank' array
  const questions = quiz.questions || quiz.question_bank || [];

  let applied = 0;
  let skipped = 0;
  let alreadyHasMedia = 0;

  for (const q of questions) {
    const sel = selectionMap.get(q.id);

    if (!sel) {
      skipped++;
      continue;
    }

    // Skip if question already has media
    if (q.media && q.media.length > 0) {
      alreadyHasMedia++;
      continue;
    }

    // Add media array with image
    q.media = [{
      type: "image",
      src: sel.imageUrl,
      alt: sel.title,
      caption: `Bron: Wikipedia - ${sel.title}`,
      _source: {
        wikipedia: sel.pageUrl,
        searchTerm: sel.searchTerm,
        score: sel.score,
      }
    }];

    applied++;
    console.log(`  ${q.id}: Added "${sel.title}"`);
  }

  // Write back to original quiz file
  fs.writeFileSync(quizPath, JSON.stringify(quiz, null, 2));

  console.log(`\nApplied ${applied} images`);
  console.log(`Skipped ${skipped} questions (no selection)`);
  console.log(`Already had media: ${alreadyHasMedia} questions`);
  console.log(`\nUpdated: ${quizPath}`);

  return { applied, skipped, alreadyHasMedia };
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node apply-image-selections.js <selections-file.json> <quiz-file.json> [--in-place]');
    console.log('\nOptions:');
    console.log('  --in-place    Modify the original quiz file instead of creating a new one');
    process.exit(1);
  }

  const selectionsPath = path.resolve(args[0]);
  const quizPath = path.resolve(args[1]);
  const inPlace = args.includes('--in-place');

  if (!fs.existsSync(selectionsPath)) {
    console.error(`Selections file not found: ${selectionsPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(quizPath)) {
    console.error(`Quiz file not found: ${quizPath}`);
    process.exit(1);
  }

  console.log(`Applying selections from: ${path.basename(selectionsPath)}`);
  console.log(`To quiz: ${path.basename(quizPath)}`);
  console.log(`Mode: ${inPlace ? 'in-place' : 'new file'}\n`);

  if (inPlace) {
    applySelectionsInPlace(selectionsPath, quizPath);
  } else {
    applySelections(selectionsPath, quizPath);
  }
}

module.exports = { applySelections, applySelectionsInPlace };
