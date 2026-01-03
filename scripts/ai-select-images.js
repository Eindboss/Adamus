/**
 * AI-powered image selection for quiz questions
 *
 * Uses Gemini AI to generate optimal Wikipedia search terms,
 * then fetches images from Wikipedia.
 *
 * Usage:
 *   GEMINI_API_KEY=key node ai-select-images.js --quiz <quiz-file.json>
 *   GEMINI_API_KEY=key node ai-select-images.js --quiz <quiz-file.json> --apply
 */

const fs = require('fs');
const path = require('path');

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.0-flash-exp';

// Rate limiting (Tier 1: 1000 RPM, 4M TPM)
const DELAY_BETWEEN_AI_REQUESTS = 1000; // 1 second delay
let lastAIRequestTime = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function rateLimitedAICall(fn) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastAIRequestTime;
  if (timeSinceLastRequest < DELAY_BETWEEN_AI_REQUESTS) {
    await sleep(DELAY_BETWEEN_AI_REQUESTS - timeSinceLastRequest);
  }
  lastAIRequestTime = Date.now();
  return fn();
}

/**
 * Use AI to generate the best Wikipedia search term for a question
 */
async function generateSearchTermWithAI(questionText, subject) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable not set');
  }

  const prompt = `Je bent een expert in het vinden van educatieve afbeeldingen op Wikipedia voor een Nederlandse quiz-app.

VAK: ${subject}
VRAAG: ${questionText}

Genereer DE BESTE Engelse Wikipedia-zoekterm om een relevante, educatieve afbeelding te vinden.

Regels:
- Gebruik Engelse termen (Wikipedia EN heeft betere afbeeldingen)
- Focus op het HOOFDCONCEPT van de vraag
- Voor biologie: zoek anatomische/wetenschappelijke diagrammen (bijv. "human skeleton", "muscle anatomy")
- Voor geschiedenis: zoek historische illustraties, portretten of kaarten
- Voor aardrijkskunde: zoek kaarten, landschappen of diagrammen
- Vermijd: merken, beroemdheden, films, games, logo's
- De zoekterm moet leiden naar een Wikipedia-pagina MET een goede thumbnail

Geef je antwoord als JSON:
{
  "searchTerm": "beste Engelse Wikipedia zoekterm",
  "fallbackTerm": "alternatieve zoekterm",
  "concept": "het hoofdconcept in 1-2 woorden"
}

Geef ALLEEN de JSON.`;

  const response = await fetch(`${GEMINI_API_URL}/${MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 150,
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse AI response');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Search Wikipedia and get page with image
 */
async function searchWikipediaForImage(searchTerm) {
  // Search for pages
  const searchParams = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: searchTerm,
    srlimit: '5',
    format: 'json',
    origin: '*',
  });

  const searchRes = await fetch(`${WIKIPEDIA_API}?${searchParams}`);
  if (!searchRes.ok) return null;

  const searchData = await searchRes.json();
  const results = searchData.query?.search || [];

  // Try each result until we find one with an image
  for (const result of results) {
    const imageParams = new URLSearchParams({
      action: 'query',
      prop: 'pageimages|info',
      inprop: 'url',
      titles: result.title,
      pithumbsize: '800',
      format: 'json',
      origin: '*',
    });

    const imageRes = await fetch(`${WIKIPEDIA_API}?${imageParams}`);
    if (!imageRes.ok) continue;

    const imageData = await imageRes.json();
    const page = Object.values(imageData.query?.pages || {})[0];

    if (page?.thumbnail?.source) {
      return {
        title: page.title,
        imageUrl: page.thumbnail.source,
        pageUrl: page.fullurl,
      };
    }
  }

  return null;
}

/**
 * Process a single question
 */
async function processQuestion(question, subject, usedImages) {
  const questionText = question.q || question.instruction || question.prompt?.text || question.prompt?.html || '';
  if (!questionText || questionText.length < 15) {
    return { success: false, reason: 'Question too short' };
  }

  // Clean HTML
  const cleanText = questionText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    // Step 1: Ask AI for best search term
    const aiResult = await rateLimitedAICall(() =>
      generateSearchTermWithAI(cleanText, subject)
    );

    // Step 2: Search Wikipedia with AI's term
    let wikiResult = await searchWikipediaForImage(aiResult.searchTerm);

    // Step 3: Try fallback if needed
    if (!wikiResult && aiResult.fallbackTerm) {
      wikiResult = await searchWikipediaForImage(aiResult.fallbackTerm);
    }

    if (!wikiResult) {
      return { success: false, reason: 'No Wikipedia image found', searchTerm: aiResult.searchTerm };
    }

    // Check for duplicates
    if (usedImages.has(wikiResult.imageUrl)) {
      return { success: false, reason: 'Duplicate image', searchTerm: aiResult.searchTerm };
    }

    usedImages.add(wikiResult.imageUrl);

    return {
      success: true,
      questionId: question.id,
      searchTerm: aiResult.searchTerm,
      concept: aiResult.concept,
      title: wikiResult.title,
      imageUrl: wikiResult.imageUrl,
      pageUrl: wikiResult.pageUrl,
    };

  } catch (err) {
    return { success: false, reason: err.message };
  }
}

/**
 * Main function: process quiz file
 */
async function processQuiz(quizPath, applyChanges = false) {
  const quiz = JSON.parse(fs.readFileSync(quizPath, 'utf8'));
  const questions = quiz.questions || quiz.question_bank || [];
  const subject = quiz.subject || path.basename(path.dirname(quizPath));

  console.log(`\nProcessing: ${path.basename(quizPath)}`);
  console.log(`Subject: ${subject}`);
  console.log(`Questions: ${questions.length}\n`);

  const usedImages = new Set();
  const results = [];
  let successCount = 0;

  // Find questions that need images
  const needsImage = questions.filter(q => {
    const mediaItems = Array.isArray(q.media) ? q.media : (q.media ? [q.media] : []);
    const hasImage = mediaItems.some(m => m.type === 'image' && m.src);

    // Skip certain types
    const skipTypes = ['matching', 'table_parse', 'ratio_table', 'data_table', 'fill_blank'];
    if (skipTypes.includes(q.type)) return false;

    return !hasImage;
  });

  console.log(`Questions needing images: ${needsImage.length}\n`);

  for (let i = 0; i < needsImage.length; i++) {
    const q = needsImage[i];
    process.stdout.write(`[${i + 1}/${needsImage.length}] ${q.id}: `);

    const result = await processQuestion(q, subject, usedImages);
    results.push({ ...result, questionId: q.id });

    if (result.success) {
      console.log(`✓ ${result.title}`);
      successCount++;
    } else {
      console.log(`✗ ${result.reason}`);
    }
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`SUMMARY: ${successCount}/${needsImage.length} images found`);
  console.log(`${'='.repeat(50)}`);

  // Apply changes if requested
  if (applyChanges && successCount > 0) {
    const successResults = results.filter(r => r.success);
    const resultMap = new Map(successResults.map(r => [r.questionId, r]));

    for (const q of questions) {
      const result = resultMap.get(q.id);
      if (result) {
        q.media = [{
          type: 'image',
          src: result.imageUrl,
          alt: result.title,
          caption: `Bron: Wikipedia - ${result.title}`,
          _source: 'wikipedia-ai',
          _searchTerm: result.searchTerm,
        }];
      }
    }

    fs.writeFileSync(quizPath, JSON.stringify(quiz, null, 2));
    console.log(`\n✓ Applied ${successCount} images to ${path.basename(quizPath)}`);
  }

  // Save results
  const outputPath = quizPath.replace('.json', '-ai-selections.json');
  fs.writeFileSync(outputPath, JSON.stringify({ results, successCount, total: needsImage.length }, null, 2));
  console.log(`Results saved to: ${path.basename(outputPath)}`);

  return { results, successCount };
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (!process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY not set\n');
    console.error('Usage:');
    console.error('  GEMINI_API_KEY=key node ai-select-images.js --quiz <file.json>');
    console.error('  GEMINI_API_KEY=key node ai-select-images.js --quiz <file.json> --apply');
    process.exit(1);
  }

  const quizIndex = args.indexOf('--quiz');
  if (quizIndex === -1 || !args[quizIndex + 1]) {
    console.error('Please specify a quiz file with --quiz <file.json>');
    process.exit(1);
  }

  const quizPath = path.resolve(args[quizIndex + 1]);
  if (!fs.existsSync(quizPath)) {
    console.error(`File not found: ${quizPath}`);
    process.exit(1);
  }

  const applyChanges = args.includes('--apply');

  await processQuiz(quizPath, applyChanges);
}

main().catch(console.error);
