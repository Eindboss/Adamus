/**
 * Validate images in quiz data using Gemini AI
 *
 * This script scans quiz files and validates:
 * 1. Images that exist - checks if they're readable and relevant
 * 2. Missing images - suggests what kind of image would help
 * 3. Questions without images - flags ones that would benefit from visuals
 *
 * Usage:
 *   GEMINI_API_KEY=your-key node validate-images.js [quiz-file.json]
 *   GEMINI_API_KEY=your-key node validate-images.js --all
 */

const fs = require('fs');
const path = require('path');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.0-flash-exp';

// Rate limiting
const DELAY_BETWEEN_REQUESTS = 4000; // 4 seconds = 15 per minute max
let lastRequestTime = 0;

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Rate-limited API call
 */
async function rateLimitedCall(fn) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < DELAY_BETWEEN_REQUESTS) {
    await sleep(DELAY_BETWEEN_REQUESTS - timeSinceLastRequest);
  }

  lastRequestTime = Date.now();
  return fn();
}

/**
 * Convert image file to base64
 */
function imageToBase64(imagePath) {
  const buffer = fs.readFileSync(imagePath);
  return buffer.toString('base64');
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return mimeTypes[ext] || 'image/png';
}

/**
 * Validate an image with Gemini
 */
async function validateImageWithAI(imagePath, questionContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const base64Image = imageToBase64(imagePath);
  const mimeType = getMimeType(imagePath);

  const prompt = `Je bent een onderwijsexpert die afbeeldingen beoordeelt voor een educatieve quiz-app.

VRAAG CONTEXT:
${questionContext}

BEOORDEEL DEZE AFBEELDING OP:
1. Leesbaarheid - Is de afbeelding scherp en duidelijk?
2. Relevantie - Past de afbeelding bij de vraag?
3. Educatieve waarde - Helpt de afbeelding bij het begrijpen van het concept?
4. Kwaliteit - Zijn er problemen zoals verkeerde labels, lage resolutie, of afleidende elementen?

Geef je antwoord als JSON:
{
  "readable": true/false,
  "relevant": true/false,
  "educational_value": "hoog" | "gemiddeld" | "laag" | "geen",
  "issues": ["lijst van problemen"],
  "recommendation": "behouden" | "vervangen" | "verwijderen",
  "suggestion": "korte suggestie voor verbetering indien nodig"
}

Geef ALLEEN de JSON, geen andere tekst.`;

  const response = await fetch(`${GEMINI_API_URL}/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image
            }
          },
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse response: ${text}`);
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Check if a question would benefit from an image
 */
async function suggestImageForQuestion(question) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const questionText = question.q || question.question || question.instruction || '';
  if (!questionText) return null;

  const prompt = `Je bent een onderwijsexpert. Beoordeel of deze quizvraag baat zou hebben bij een afbeelding.

VRAAG: ${questionText}
TYPE: ${question.type || 'multiple choice'}

Beoordeel:
1. Zou een afbeelding helpen bij het begrijpen van de vraag?
2. Zo ja, wat voor soort afbeelding?

Geef je antwoord als JSON:
{
  "needs_image": true/false,
  "reason": "korte uitleg",
  "suggested_image": "beschrijving van ideale afbeelding" | null,
  "search_terms": ["zoektermen", "voor", "afbeelding"] | null,
  "priority": "hoog" | "gemiddeld" | "laag" | "geen"
}

Geef ALLEEN de JSON, geen andere tekst.`;

  const response = await fetch(`${GEMINI_API_URL}/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 300,
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse response: ${text}`);
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Find all images referenced in a quiz
 */
function findReferencedImages(quiz, quizDir) {
  const images = [];

  const questions = quiz.questions || quiz.question_bank || [];
  for (const q of questions) {
    // Check media array (can be array or object)
    if (q.media) {
      const mediaItems = Array.isArray(q.media) ? q.media : [q.media];
      for (const m of mediaItems) {
        if (m.type === 'image' && m.src) {
          images.push({
            questionId: q.id,
            src: m.src,
            fullPath: m.src.startsWith('http') ? m.src : path.resolve(quizDir, '..', m.src),
            isUrl: m.src.startsWith('http'),
            context: q.q || q.instruction || q.prompt?.text || '',
          });
        }
      }
    }

    // Check img field (some question types)
    if (q.img) {
      images.push({
        questionId: q.id,
        src: q.img,
        fullPath: path.resolve(quizDir, '..', q.img),
        context: q.q || q.instruction || '',
      });
    }
  }

  return images;
}

/**
 * Find questions without images
 */
function findQuestionsWithoutImages(quiz) {
  const questionsWithoutImages = [];

  const questions = quiz.questions || quiz.question_bank || [];
  for (const q of questions) {
    const mediaItems = Array.isArray(q.media) ? q.media : (q.media ? [q.media] : []);
    const hasImage = mediaItems.some(m => m.type === 'image') || q.img;

    if (!hasImage) {
      // Skip certain question types that don't need images
      const skipTypes = ['matching', 'table_parse', 'ratio_table', 'data_table'];
      if (!skipTypes.includes(q.type)) {
        questionsWithoutImages.push(q);
      }
    }
  }

  return questionsWithoutImages;
}

/**
 * Validate a single quiz file
 */
async function validateQuiz(quizPath, options = {}) {
  const { validateExisting = true, suggestNew = false } = options;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Validating: ${path.basename(quizPath)}`);
  console.log('='.repeat(60));

  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
  const quizDir = path.dirname(quizPath);

  const results = {
    quizPath,
    existingImages: [],
    missingImages: [],
    suggestedImages: [],
    summary: {
      total: 0,
      valid: 0,
      issues: 0,
      missing: 0,
      needImages: 0,
    }
  };

  // Find and validate existing images
  const images = findReferencedImages(quiz, quizDir);
  results.summary.total = images.length;

  if (validateExisting && images.length > 0) {
    console.log(`\nFound ${images.length} referenced images. Validating...`);

    for (const img of images) {
      process.stdout.write(`  ${img.questionId}: `);

      // Skip URL images for now (can't validate with base64)
      if (img.isUrl) {
        console.log(`URL (${img.src.substring(0, 50)}...)`);
        results.existingImages.push({
          ...img,
          validation: { recommendation: 'behouden', note: 'URL image - not validated locally' }
        });
        results.summary.valid++;
        continue;
      }

      if (!fs.existsSync(img.fullPath)) {
        console.log('MISSING');
        results.missingImages.push(img);
        results.summary.missing++;
        continue;
      }

      try {
        const validation = await rateLimitedCall(() =>
          validateImageWithAI(img.fullPath, img.context)
        );

        results.existingImages.push({
          ...img,
          validation
        });

        if (validation.recommendation === 'behouden') {
          console.log('OK');
          results.summary.valid++;
        } else {
          console.log(`${validation.recommendation.toUpperCase()} - ${validation.issues?.join(', ') || validation.suggestion}`);
          results.summary.issues++;
        }
      } catch (error) {
        console.log(`ERROR: ${error.message}`);
      }
    }
  }

  // Suggest images for questions without them
  if (suggestNew) {
    const withoutImages = findQuestionsWithoutImages(quiz);

    if (withoutImages.length > 0) {
      console.log(`\nChecking ${withoutImages.length} questions without images...`);

      // Only check first 10 to save API calls
      const toCheck = withoutImages.slice(0, 10);

      for (const q of toCheck) {
        process.stdout.write(`  ${q.id}: `);

        try {
          const suggestion = await rateLimitedCall(() =>
            suggestImageForQuestion(q)
          );

          if (suggestion?.needs_image && suggestion.priority !== 'geen') {
            console.log(`SUGGEST (${suggestion.priority}) - ${suggestion.suggested_image}`);
            results.suggestedImages.push({
              questionId: q.id,
              question: q.q || q.instruction,
              ...suggestion
            });
            results.summary.needImages++;
          } else {
            console.log('OK (no image needed)');
          }
        } catch (error) {
          console.log(`ERROR: ${error.message}`);
        }
      }

      if (withoutImages.length > 10) {
        console.log(`  ... and ${withoutImages.length - 10} more questions not checked`);
      }
    }
  }

  return results;
}

/**
 * Find all quiz files
 */
function findAllQuizFiles(dataDir) {
  const files = [];

  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith('.json') &&
                 !entry.name.includes('image-briefs') &&
                 !entry.name.includes('image-intents') &&
                 !entry.name.includes('subjects')) {
        // Check if it's a quiz file
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          if ((data.questions && Array.isArray(data.questions)) ||
              (data.question_bank && Array.isArray(data.question_bank))) {
            files.push(fullPath);
          }
        } catch (e) {
          // Not a valid JSON or not a quiz
        }
      }
    }
  }

  scan(dataDir);
  return files;
}

/**
 * Print summary
 */
function printSummary(allResults) {
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  let totalImages = 0;
  let totalValid = 0;
  let totalIssues = 0;
  let totalMissing = 0;
  let totalNeedImages = 0;

  for (const result of allResults) {
    totalImages += result.summary.total;
    totalValid += result.summary.valid;
    totalIssues += result.summary.issues;
    totalMissing += result.summary.missing;
    totalNeedImages += result.summary.needImages;
  }

  console.log(`Total images checked: ${totalImages}`);
  console.log(`  Valid: ${totalValid}`);
  console.log(`  Issues: ${totalIssues}`);
  console.log(`  Missing files: ${totalMissing}`);
  console.log(`Questions that would benefit from images: ${totalNeedImages}`);

  // List issues
  const allIssues = allResults.flatMap(r =>
    r.existingImages.filter(i => i.validation?.recommendation !== 'behouden')
  );

  if (allIssues.length > 0) {
    console.log('\n--- IMAGES WITH ISSUES ---');
    for (const img of allIssues) {
      console.log(`\n${img.questionId} (${img.src}):`);
      console.log(`  Recommendation: ${img.validation.recommendation}`);
      if (img.validation.issues?.length) {
        console.log(`  Issues: ${img.validation.issues.join(', ')}`);
      }
      if (img.validation.suggestion) {
        console.log(`  Suggestion: ${img.validation.suggestion}`);
      }
    }
  }

  // List missing
  const allMissing = allResults.flatMap(r => r.missingImages);
  if (allMissing.length > 0) {
    console.log('\n--- MISSING IMAGE FILES ---');
    for (const img of allMissing) {
      console.log(`  ${img.questionId}: ${img.src}`);
    }
  }

  // List suggestions
  const allSuggestions = allResults.flatMap(r =>
    r.suggestedImages.filter(s => s.priority === 'hoog')
  );

  if (allSuggestions.length > 0) {
    console.log('\n--- HIGH PRIORITY IMAGE SUGGESTIONS ---');
    for (const sug of allSuggestions) {
      console.log(`\n${sug.questionId}:`);
      console.log(`  Question: ${sug.question?.substring(0, 80)}...`);
      console.log(`  Suggested: ${sug.suggested_image}`);
      if (sug.search_terms) {
        console.log(`  Search: ${sug.search_terms.join(', ')}`);
      }
    }
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (!process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY environment variable not set');
    console.error('\nUsage:');
    console.error('  GEMINI_API_KEY=your-key node validate-images.js <quiz-file.json>');
    console.error('  GEMINI_API_KEY=your-key node validate-images.js --all');
    console.error('  GEMINI_API_KEY=your-key node validate-images.js --all --suggest-new');
    process.exit(1);
  }

  const suggestNew = args.includes('--suggest-new');
  const validateAll = args.includes('--all');

  const scriptDir = __dirname;
  const dataDir = path.resolve(scriptDir, '..', 'data');

  let quizFiles = [];

  if (validateAll) {
    quizFiles = findAllQuizFiles(dataDir);
    console.log(`Found ${quizFiles.length} quiz files`);
  } else {
    const quizPath = args.find(a => !a.startsWith('--'));
    if (!quizPath) {
      console.error('Please specify a quiz file or use --all');
      process.exit(1);
    }
    quizFiles = [path.resolve(quizPath)];
  }

  const allResults = [];

  for (const quizPath of quizFiles) {
    try {
      const result = await validateQuiz(quizPath, {
        validateExisting: true,
        suggestNew
      });
      allResults.push(result);
    } catch (error) {
      console.error(`Error processing ${quizPath}: ${error.message}`);
    }
  }

  printSummary(allResults);

  // Save results to file
  const outputPath = path.resolve(scriptDir, '..', 'image-validation-report.json');
  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
  console.log(`\nFull report saved to: ${outputPath}`);
}

main().catch(console.error);
