/**
 * Test the depicts (P180) search via Commons haswbstatement
 *
 * This tests whether we can find images that actually depict specific concepts
 * using Wikidata QIDs instead of just text search.
 *
 * Usage: node test-depicts-search.js [QID]
 * Example: node test-depicts-search.js Q12107251
 */

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

const TEST_CASES = [
  {
    name: "Human skeleton",
    qids: ["Q12107251"],
    query: "human skeleton anatomy",
    negativeTerms: ["dinosaur", "museum"]
  },
  {
    name: "Rib cage + sternum",
    qids: ["Q193304", "Q103148"],
    query: "rib cage sternum human anatomy",
    negativeTerms: ["dinosaur"]
  },
  {
    name: "Osteon (Haversian system)",
    qids: ["Q1115467"],
    query: "haversian system osteon labeled",
    negativeTerms: []
  },
  {
    name: "Ball and socket joint",
    qids: ["Q1199023"],
    query: "ball and socket joint shoulder anatomy",
    negativeTerms: []
  },
  {
    name: "Biceps brachii",
    qids: ["Q182494"],
    query: "biceps brachii arm flexor",
    negativeTerms: ["bodybuilder"]
  },
  {
    name: "Penguin",
    qids: ["Q14943"],
    query: "penguin swimming underwater",
    negativeTerms: ["cartoon", "logo"]
  },
  {
    name: "RSI",
    qids: ["Q831706"],
    query: "repetitive strain injury RSI typing",
    negativeTerms: ["x-ray"]
  },
  {
    name: "Vertebral column",
    qids: ["Q182524"],
    query: "human spine double S curve diagram",
    negativeTerms: ["scoliosis"]
  }
];

function containsAny(haystack, needles) {
  const h = (haystack || "").toLowerCase();
  return needles.some(n => h.includes(n.toLowerCase()));
}

/**
 * Search Commons using haswbstatement for depicts + text query
 */
async function depictsSearch(qids, { limit = 10, minWidth = 600, textQuery = "" } = {}) {
  const depicts = qids.map(q => `P180=${q}`).join("|");

  // Combine depicts with text query for better precision
  let searchQuery = `haswbstatement:${depicts}`;
  if (textQuery) {
    const skipWords = new Set(["the", "a", "an", "of", "in", "on", "at", "to", "for", "with", "and", "or", "human", "anatomy", "diagram", "photo", "image"]);
    const keyTerms = textQuery.toLowerCase()
      .split(/\s+/)
      .filter(t => t.length >= 3 && !skipWords.has(t))
      .slice(0, 3);
    if (keyTerms.length > 0) {
      searchQuery = `${keyTerms.join(" ")} ${searchQuery}`;
    }
  }

  const url = `${COMMONS_API}?` + new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: searchQuery,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo|categories",
    iiprop: "url|size|mime",
    iiurlwidth: "800",
    cllimit: "5",
    format: "json",
    origin: "*"
  });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const json = await res.json();

  const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
  return pages.map(p => {
    const ii = p?.imageinfo?.[0];
    return {
      title: p?.title?.replace(/^File:/, ""),
      width: ii?.width || 0,
      height: ii?.height || 0,
      mime: ii?.mime || "",
      thumbUrl: ii?.thumburl,
      categories: (p?.categories || []).map(c => c.title.replace(/^Category:/, "")).slice(0, 3)
    };
  }).filter(p => p.width >= minWidth);
}

/**
 * Text search in Commons
 */
async function textSearch(query, { limit = 10, minWidth = 600 } = {}) {
  const url = `${COMMONS_API}?` + new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo|categories",
    iiprop: "url|size|mime",
    iiurlwidth: "800",
    cllimit: "5",
    format: "json",
    origin: "*"
  });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const json = await res.json();

  const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
  return pages.map(p => {
    const ii = p?.imageinfo?.[0];
    return {
      title: p?.title?.replace(/^File:/, ""),
      width: ii?.width || 0,
      height: ii?.height || 0,
      mime: ii?.mime || "",
      thumbUrl: ii?.thumburl,
      categories: (p?.categories || []).map(c => c.title.replace(/^Category:/, "")).slice(0, 3)
    };
  }).filter(p => p.width >= minWidth);
}

async function runTest(testCase) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Test: ${testCase.name}`);
  console.log(`QIDs: ${testCase.qids.join(", ")}`);
  console.log(`Query: "${testCase.query}"`);
  console.log(`Negative terms: ${testCase.negativeTerms.join(", ") || "(none)"}`);
  console.log("=".repeat(70));

  // Depicts + text search (combined)
  console.log("\n[DEPICTS+TEXT SEARCH] (text + haswbstatement:P180=QID)");
  try {
    const depictsResults = await depictsSearch(testCase.qids, { limit: 5, textQuery: testCase.query });
    if (depictsResults.length === 0) {
      console.log("  (no results)");
    } else {
      depictsResults.forEach((r, i) => {
        const hasNegative = containsAny(r.title, testCase.negativeTerms);
        const flag = hasNegative ? " ⚠️ NEGATIVE" : "";
        console.log(`  ${i + 1}. ${r.title.substring(0, 60)}...${flag}`);
        console.log(`     ${r.width}x${r.height} | ${r.mime}`);
      });
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  // Text search
  console.log("\n[TEXT SEARCH] (gsrsearch)");
  try {
    const textResults = await textSearch(testCase.query, { limit: 5 });
    if (textResults.length === 0) {
      console.log("  (no results)");
    } else {
      textResults.forEach((r, i) => {
        const hasNegative = containsAny(r.title, testCase.negativeTerms);
        const flag = hasNegative ? " ⚠️ NEGATIVE" : "";
        console.log(`  ${i + 1}. ${r.title.substring(0, 60)}...${flag}`);
        console.log(`     ${r.width}x${r.height} | ${r.mime}`);
      });
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  // Rate limiting
  await new Promise(r => setTimeout(r, 500));
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0].startsWith("Q")) {
    // Single QID test
    await runTest({
      name: `Custom QID: ${args[0]}`,
      qids: [args[0]],
      query: args.slice(1).join(" ") || args[0],
      negativeTerms: []
    });
  } else {
    // Run all tests
    console.log("Testing depicts (P180) search vs text search");
    console.log(`Running ${TEST_CASES.length} test cases...\n`);

    for (const testCase of TEST_CASES) {
      await runTest(testCase);
    }

    console.log("\n" + "=".repeat(70));
    console.log("Summary:");
    console.log("- Depicts search finds images tagged with specific Wikidata concepts");
    console.log("- Text search finds images matching keywords in title/description");
    console.log("- Depicts search is more precise but may return fewer results");
    console.log("- Best approach: depicts first, then text search as fallback");
    console.log("=".repeat(70));
  }
}

main().catch(console.error);
