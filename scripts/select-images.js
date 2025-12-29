/**
 * Select images for quiz questions using image briefs
 *
 * This script takes image briefs and searches Wikipedia for matching images,
 * then ranks candidates and selects the best one per question.
 *
 * Usage: node select-images.js <briefs-file.json>
 */

const fs = require('fs');
const path = require('path');

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

/**
 * Search Wikipedia for pages matching a query
 */
async function searchWikipedia(query) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '5',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  return data.query?.search || [];
}

/**
 * Get page image from Wikipedia
 */
async function getPageImage(title) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'pageimages|info',
    inprop: 'url',
    titles: title,
    pithumbsize: '800',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!res.ok) return null;

  const data = await res.json();
  const pages = data.query?.pages;
  if (!pages) return null;

  const page = Object.values(pages)[0];
  return {
    title: page.title,
    thumbnail: page.thumbnail?.source,
    pageUrl: page.fullurl,
  };
}

/**
 * Score a candidate image against a brief
 */
function scoreCandidate(candidate, brief) {
  if (!candidate.thumbnail) return 0;

  let score = 0;
  const titleLower = candidate.title.toLowerCase();

  // Check if search terms appear in title
  for (const term of brief.searchTerms) {
    const words = term.toLowerCase().split(' ');
    for (const word of words) {
      if (titleLower.includes(word)) {
        score += 10;
      }
    }
  }

  // Prefer anatomical/diagram content for biology
  if (brief.preferredType.includes('diagram') || brief.preferredType.includes('anatomical')) {
    if (titleLower.includes('anatomy') || titleLower.includes('diagram')) {
      score += 20;
    }
  }

  // Penalize for negative terms
  for (const neg of brief.negativeTerms) {
    if (titleLower.includes(neg.toLowerCase())) {
      score -= 50;
    }
  }

  // Bonus for specific vs generic
  if (titleLower.includes('human') && brief.searchTerms.some(t => t.includes('human'))) {
    score += 5;
  }

  return score;
}

/**
 * Select best image for a brief
 */
async function selectImageForBrief(brief, usedImages) {
  const candidates = [];

  // Try each search term
  for (const searchTerm of brief.searchTerms.slice(0, 3)) {
    const results = await searchWikipedia(searchTerm);

    for (const result of results) {
      // Skip if already used
      if (usedImages.has(result.title)) continue;

      const imageData = await getPageImage(result.title);
      if (imageData && imageData.thumbnail) {
        candidates.push({
          ...imageData,
          searchTerm,
          score: scoreCandidate(imageData, brief),
        });
      }
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  if (candidates.length === 0) {
    return null;
  }

  // Sort by score and pick best
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  return {
    questionId: brief.questionId,
    title: best.title,
    imageUrl: best.thumbnail,
    pageUrl: best.pageUrl,
    searchTerm: best.searchTerm,
    score: best.score,
    reason: `Matched "${best.searchTerm}" -> "${best.title}" (score: ${best.score})`,
  };
}

/**
 * Process all briefs and select images
 */
async function selectImagesForQuiz(briefsPath) {
  const data = JSON.parse(fs.readFileSync(briefsPath, 'utf8'));
  const usedImages = new Set();
  const selections = [];
  const failed = [];

  console.log(`Processing ${data.briefs.length} briefs...\n`);

  for (let i = 0; i < data.briefs.length; i++) {
    const brief = data.briefs[i];
    process.stdout.write(`[${i + 1}/${data.briefs.length}] ${brief.questionId}: `);

    try {
      const selection = await selectImageForBrief(brief, usedImages);

      if (selection) {
        selections.push(selection);
        usedImages.add(selection.title);
        console.log(`✓ ${selection.title}`);
      } else {
        failed.push(brief.questionId);
        console.log(`✗ No suitable image found`);
      }
    } catch (err) {
      failed.push(brief.questionId);
      console.log(`✗ Error: ${err.message}`);
    }

    // Rate limiting between questions
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nSelected ${selections.length} images`);
  console.log(`Failed: ${failed.length} questions`);

  return { selections, failed, usedImages: [...usedImages] };
}

/**
 * Apply selections to quiz JSON
 */
function applySelectionsToQuiz(quizPath, selections) {
  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));

  const selectionMap = new Map(selections.map(s => [s.questionId, s]));

  for (const q of quiz.questions) {
    const sel = selectionMap.get(q.id);
    if (sel) {
      q.media = {
        query: sel.searchTerm,
        alt: sel.title,
        _selectedUrl: sel.imageUrl, // For preview/debugging
        _reason: sel.reason,
      };
    }
  }

  return quiz;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node select-images.js <briefs-file.json> [--apply <quiz.json>]');
    process.exit(1);
  }

  const briefsPath = path.resolve(args[0]);

  if (!fs.existsSync(briefsPath)) {
    console.error(`File not found: ${briefsPath}`);
    process.exit(1);
  }

  (async () => {
    const result = await selectImagesForQuiz(briefsPath);

    // Save selections
    const outputPath = briefsPath.replace('-image-briefs.json', '-image-selections.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nSaved selections to: ${outputPath}`);

    // If --apply flag, update the quiz file
    const applyIndex = args.indexOf('--apply');
    if (applyIndex !== -1 && args[applyIndex + 1]) {
      const quizPath = path.resolve(args[applyIndex + 1]);
      const updatedQuiz = applySelectionsToQuiz(quizPath, result.selections);
      fs.writeFileSync(quizPath, JSON.stringify(updatedQuiz, null, 2));
      console.log(`Applied to: ${quizPath}`);
    }
  })();
}

module.exports = { selectImagesForQuiz, applySelectionsToQuiz };
