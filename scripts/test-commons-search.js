/**
 * Test script for Commons-first image search
 *
 * Tests the improved wikimedia.js approach by searching Commons directly
 * and comparing results with the old Wikipedia lead-image approach.
 *
 * Usage: node test-commons-search.js [query]
 * Example: node test-commons-search.js "human rib cage anatomy"
 */

const TEST_QUERIES = [
  // Biologie - skelet
  { query: "human skeleton anatomy", negativeTerms: ["dinosaur", "fossil", "museum"] },
  { query: "human rib cage sternum", negativeTerms: ["dinosaur", "fossil"] },
  { query: "human skull fontanelle baby", negativeTerms: ["fossil", "archaeology"] },
  { query: "vertebral column spine lateral view", negativeTerms: ["dinosaur"] },

  // Biologie - gewrichten
  { query: "synovial joint anatomy cross section", negativeTerms: ["arthritis", "disease"] },
  { query: "ball and socket joint hip shoulder", negativeTerms: [] },
  { query: "hinge joint knee elbow", negativeTerms: [] },
  { query: "intervertebral disc anatomy", negativeTerms: ["herniated", "disease"] },

  // Biologie - spieren
  { query: "biceps triceps antagonist muscles arm", negativeTerms: ["bodybuilder"] },
  { query: "muscle contraction diagram", negativeTerms: [] },
  { query: "tendon bone attachment anatomy", negativeTerms: [] },

  // Biologie - botweefsel
  { query: "bone tissue microscope osteocyte", negativeTerms: ["cancer", "disease"] },
  { query: "compact bone structure diagram", negativeTerms: [] },

  // Biologie - beweging/gezondheid
  { query: "warm up exercise stretching", negativeTerms: ["logo", "brand"] },
  { query: "ergonomic sitting posture computer", negativeTerms: ["logo", "product"] },
  { query: "RSI repetitive strain injury prevention", negativeTerms: ["logo"] },

  // Biologie - dieren
  { query: "penguin swimming flipper wing", negativeTerms: ["cartoon", "logo"] },
  { query: "bird skeleton keel sternum", negativeTerms: ["dinosaur", "fossil"] },
];

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

/**
 * Search Commons directly for files
 */
async function searchCommons(query, { limit = 10, negativeTerms = [] } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6', // File namespace
    gsrlimit: String(limit),
    prop: 'imageinfo|categories',
    iiprop: 'url|size|mime',
    iiurlwidth: '800',
    cllimit: '10',
    format: 'json',
    origin: '*'
  });

  const res = await fetch(`${COMMONS_API}?${params}`);
  if (!res.ok) throw new Error(`Commons search failed: ${res.status}`);
  const json = await res.json();

  const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
  const candidates = [];

  for (const p of pages) {
    const title = p?.title;
    const ii = p?.imageinfo?.[0];
    if (!title || !ii) continue;

    const mime = ii.mime || '';
    const width = ii.width || 0;
    const height = ii.height || 0;

    // Hard filters
    if (width < 400) continue;

    const categories = (p?.categories || []).map(c => c.title.replace(/^Category:/, ''));
    const lowerTitle = title.toLowerCase();

    // Filter junk
    if (['logo', 'icon', 'pictogram', 'flag', 'coat_of_arms'].some(j => lowerTitle.includes(j))) continue;

    // Score
    let score = 0;
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
    for (const tok of tokens) {
      if (lowerTitle.includes(tok)) score += 8;
      if (categories.join(' ').toLowerCase().includes(tok)) score += 4;
    }

    // Penalize negatives
    for (const neg of negativeTerms) {
      if (lowerTitle.includes(neg.toLowerCase())) score -= 40;
      if (categories.join(' ').toLowerCase().includes(neg.toLowerCase())) score -= 20;
    }

    // Penalize maps
    if (['map', 'locator', 'blank_map'].some(m => lowerTitle.includes(m))) score -= 20;

    // Prefer larger images
    const megapixels = (width * height) / 1_000_000;
    score += Math.min(megapixels * 2, 12);

    candidates.push({
      title: title.replace(/^File:/, ''),
      thumbUrl: ii.thumburl || ii.url,
      width,
      height,
      mime,
      score,
      categories: categories.slice(0, 5)
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Old approach: Wikipedia page image
 */
async function searchWikipediaOld(query) {
  // Search
  const searchParams = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '1',
    format: 'json',
    origin: '*'
  });

  const searchRes = await fetch(`${WIKIPEDIA_API}?${searchParams}`);
  if (!searchRes.ok) return null;
  const searchJson = await searchRes.json();
  const top = searchJson?.query?.search?.[0];
  if (!top?.title) return null;

  // Get page image
  const pageParams = new URLSearchParams({
    action: 'query',
    prop: 'pageimages|info',
    inprop: 'url',
    titles: top.title,
    pithumbsize: '800',
    format: 'json',
    origin: '*'
  });

  const pageRes = await fetch(`${WIKIPEDIA_API}?${pageParams}`);
  if (!pageRes.ok) return null;
  const pageJson = await pageRes.json();
  const pages = pageJson?.query?.pages;
  const page = pages ? Object.values(pages)[0] : null;

  return {
    title: top.title,
    thumbUrl: page?.thumbnail?.source,
    pageUrl: page?.fullurl
  };
}

/**
 * Run comparison test
 */
async function runTest(testCase) {
  const { query, negativeTerms } = testCase;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Query: "${query}"`);
  console.log(`Negative terms: ${negativeTerms.length > 0 ? negativeTerms.join(', ') : '(none)'}`);
  console.log('='.repeat(60));

  // Old approach
  console.log('\n[OLD] Wikipedia lead image:');
  try {
    const oldResult = await searchWikipediaOld(query);
    if (oldResult?.thumbUrl) {
      console.log(`  Article: ${oldResult.title}`);
      console.log(`  Image: ${oldResult.thumbUrl.substring(0, 80)}...`);
    } else {
      console.log('  (no image found)');
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  // New approach
  console.log('\n[NEW] Commons direct search (top 3):');
  try {
    const candidates = await searchCommons(query, { limit: 10, negativeTerms });
    if (candidates.length === 0) {
      console.log('  (no candidates found)');
    } else {
      candidates.slice(0, 3).forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.title}`);
        console.log(`     Score: ${c.score} | ${c.width}x${c.height} | ${c.mime}`);
        console.log(`     URL: ${c.thumbUrl.substring(0, 70)}...`);
      });
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  // Rate limiting
  await new Promise(r => setTimeout(r, 300));
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Single query from command line
    await runTest({ query: args.join(' '), negativeTerms: [] });
  } else {
    // Run all test queries
    console.log('Testing Commons-first image search approach');
    console.log(`Running ${TEST_QUERIES.length} test queries...\n`);

    for (const testCase of TEST_QUERIES) {
      await runTest(testCase);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Test complete!');
    console.log('='.repeat(60));
  }
}

main().catch(console.error);
