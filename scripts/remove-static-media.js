/**
 * Remove static media and image fields from ALL quiz JSON files
 * Images are now auto-generated from question text at runtime
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');

function processDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let totalRemoved = 0;

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      totalRemoved += processDir(fullPath);
    } else if (entry.name.endsWith('.json') && entry.name !== 'subjects.json') {
      const removed = processFile(fullPath);
      if (removed > 0) {
        const relPath = path.relative(dataDir, fullPath);
        console.log(`${relPath}: removed ${removed} media/image fields`);
        totalRemoved += removed;
      }
    }
  }

  return totalRemoved;
}

function processFile(filePath) {
  try {
    const quiz = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let removed = 0;

    if (Array.isArray(quiz.questions)) {
      quiz.questions.forEach(q => {
        if (q.media) {
          delete q.media;
          removed++;
        }
        if (q.image) {
          delete q.image;
          removed++;
        }
        if (q.imageAlt) {
          delete q.imageAlt;
          removed++;
        }
      });
    }

    if (removed > 0) {
      fs.writeFileSync(filePath, JSON.stringify(quiz, null, 2), 'utf8');
    }

    return removed;
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err.message);
    return 0;
  }
}

const total = processDir(dataDir);
console.log(`\nTotal removed: ${total} fields`);
