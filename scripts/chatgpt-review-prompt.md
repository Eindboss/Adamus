# ChatGPT Review: Wikimedia Image Selection System (v4.2)

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor middelbare scholieren. Elke vraag moet een relevante afbeelding krijgen van Wikimedia Commons. Het systeem is geüpgraded naar v4.2 met domain-specifieke threshold profiles, adaptive batch sizing, en verbeterde early stopping.

## Huidige Architectuur (v4.2)

### Nieuwe Features in v4.2 (t.o.v. v4.1):
- **Domain-specifieke threshold profiles**: Aparte drempels per afbeeldingstype (diagram, map, photo, microscopy)
- **Adaptive batch sizing**: Start met 2 queries, breid uit naar 3 als geen goede resultaten
- **MIN_CANDIDATES requirement**: Wacht op voldoende kandidaten voordat early stop beslist
- **MIN_EDU floor**: Minimale educatieve score vereist voor early stop
- **HARD_STOP score**: Bij uitzonderlijk goede match direct stoppen
- **repFit en eduScore tracking**: Elke kandidaat krijgt expliciete scores voor representation fit en educational quality

### Features behouden van v4.1:
- **Parallel batch processing**: 2-3 queries tegelijk
- **Margin-based early stopping**: Stop alleen als margin voldoende groot is
- **Domain-aware synonym expansion**: Nederlandse termen naar Engels
- **Skip embedded visual content**: Vragen met "afbeelding 1", "tabel", "grafiek" krijgen geen extra afbeelding
- **Multi-subject support**: Biology, Geography, History, Science domains

### Data structuur per vraag:
```json
{
  "id": "q025",
  "q": "Biceps en triceps vormen een antagonistisch paar. Welke beweging hoort het best bij de biceps?",
  "a": ["Arm strekken", "Arm buigen", "Pols draaien", "Schouder optrekken"],
  "c": 1,
  "e": "De biceps is een armbuigspier. De triceps is een armstrekspier.",
  "media": {
    "query": "biceps elbow flexion diagram",
    "alt": "elleboog buigen (flexie) door biceps",
    "negativeTerms": ["cartoon", "bodybuilder"],
    "qids": ["Q182494"],
    "_intent": {
      "primaryConcept": "biceps beweging",
      "specificFocus": "elleboog buigen (flexie) door biceps",
      "representation": "diagram"
    }
  }
}
```

### Domain-Specifieke Threshold Profiles:
```javascript
const THRESHOLD_PROFILES = {
  // Diagram-based (anatomy, biology) - stricter on rep fit
  diagram: {
    GOOD_SCORE: 42,
    MARGIN: 7,
    MIN_REP_FIT: 8,
    MIN_EDU: 10,
    MIN_CANDIDATES: 10,
    HARD_STOP: 55
  },
  // Maps - lower margin (similar scores common)
  map: {
    GOOD_SCORE: 40,
    MARGIN: 5,
    MIN_REP_FIT: 6,
    MIN_EDU: 8,
    MIN_CANDIDATES: 15,
    HARD_STOP: 52
  },
  // Microscopy - good candidates are rare
  microscopy: {
    GOOD_SCORE: 35,
    MARGIN: 6,
    MIN_REP_FIT: 5,
    MIN_EDU: 8,
    MIN_CANDIDATES: 8,
    HARD_STOP: 48
  },
  // Photos - easier to find, can be stricter
  photo: {
    GOOD_SCORE: 45,
    MARGIN: 8,
    MIN_REP_FIT: 5,
    MIN_EDU: 10,
    MIN_CANDIDATES: 12,
    HARD_STOP: 58
  },
  // Cross-sections - similar to diagrams
  "cross-section": {
    GOOD_SCORE: 40,
    MARGIN: 7,
    MIN_REP_FIT: 8,
    MIN_EDU: 10,
    MIN_CANDIDATES: 10,
    HARD_STOP: 52
  },
  // Default fallback
  default: {
    GOOD_SCORE: 40,
    MARGIN: 8,
    MIN_REP_FIT: 5,
    MIN_EDU: 8,
    MIN_CANDIDATES: 12,
    HARD_STOP: 55
  }
};
```

### Query-Ladder met Representation Templates:
```javascript
const REPRESENTATION_TEMPLATES = {
  diagram: [
    "{concept} labelled diagram",
    "{concept} anatomy diagram",
    "{concept} schematic",
    "{concept} educational diagram"
  ],
  photo: ["{concept} photo", "{concept} photograph"],
  microscopy: ["{concept} micrograph", "{concept} histology"],
  "cross-section": ["{concept} cross-section diagram", "{concept} cutaway"],
  map: ["{concept} map", "{concept} thematic map"]
};

function generateQueryLadder(baseQuery, { representation, concepts, domain }) {
  const templates = REPRESENTATION_TEMPLATES[representation] || REPRESENTATION_TEMPLATES.diagram;
  const synonymExpansions = expandWithSynonyms(baseQuery, domain);

  return [
    { query: templates[0].replace("{concept}", baseQuery), weight: 1.0 },
    { query: templates[1]?.replace("{concept}", baseQuery), weight: 0.95 },
    ...synonymExpansions.map(q => ({ query: templates[0].replace("{concept}", q), weight: 0.9 })),
    { query: baseQuery, weight: 0.8 },
    // ... progressively broader queries
  ];
}
```

### Domain-Aware Synonym Expansion:
```javascript
const DOMAIN_SYNONYMS = {
  muscles: {
    "biceps": ["biceps brachii", "arm flexor"],
    "pees": ["tendon"],
    "spier": ["muscle"]
  },
  climate: {
    "klimaat": ["climate", "climate zone"],
    "neerslag": ["precipitation", "rainfall"],
    "stuwingsregen": ["orographic precipitation", "relief rainfall"],
    "moesson": ["monsoon", "monsoon climate"]
  },
  urbanization: {
    "urbanisatie": ["urbanization", "urban growth"],
    "agglomeratie": ["agglomeration", "metropolitan area"],
    "bevolkingsdichtheid": ["population density"]
  },
  // ... more domains
};
```

### 3-Laags Scoring Systeem:
```javascript
function scoreCandidate(candidate, query, opts) {
  // LAYER 1: Representation Fit (-30 to +30)
  // Matcht de afbeelding het gewenste type? (diagram vs foto vs microscopie)

  // LAYER 2: Educational Quality (-40 to +60)
  // Is het educatief bruikbaar? (labels, depicts match, categorieën)
  // Depicts match (Wikidata P180) geeft +40 bonus

  // LAYER 3: Domain/Chapter Fit (-50 to +30)
  // Past het bij het onderwerp? (muscles, joints, skeleton, etc.)
  // Gebruikt CHAPTER_PROFILES met prefer/avoid lijsten

  return layer1 + layer2 + layer3;
}
```

### Score Batch met repFit en eduScore:
```javascript
function scoreBatch(candidates, ladderQuery, weight) {
  for (const c of candidates) {
    c.score = scoreCandidate(c, ladderQuery, { ...scoreOpts, queryWeight: weight });
    c.ladderQuery = ladderQuery;
    c.ladderWeight = weight;

    const combined = (c.title + " " + c.categories.join(" ")).toLowerCase();

    // Calculate representation fit
    const repConfig = {
      diagram: ["diagram", "labelled", "labeled", "schema", "illustration"],
      photo: ["photo", "photograph", "image"],
      microscopy: ["micrograph", "histology", "microscope"],
      // ...
    }[representation];
    const repMatches = repConfig.filter(term => combined.includes(term)).length;
    c.repFit = Math.min(repMatches * 5, 15);

    // Calculate educational score
    const eduTerms = ["labelled", "labeled", "annotated", "educational", "anatomy"];
    const eduMatches = eduTerms.filter(term => combined.includes(term)).length;
    c.eduScore = Math.min(eduMatches * 4, 16);

    // SVG bonus (usually cleaner diagrams)
    if (c.mime === "image/svg+xml") {
      c.repFit += 3;
      c.eduScore += 2;
    }
  }
}
```

### Adaptive Batch Processing + Domain-Based Early Stop:
```javascript
async function getMediaForQuery(query, opts) {
  const domain = detectDomain(query, intent);
  const representation = intent.representation || "diagram";
  const ladder = generateQueryLadder(query, { representation, domain });

  // v4.2: Get domain-specific thresholds
  const thresholds = getThresholds(representation);

  // v4.2: Adaptive batch sizing
  const BATCH_SIZE_INITIAL = 2;
  const BATCH_SIZE_EXPANDED = 3;
  let batchSize = BATCH_SIZE_INITIAL;

  for (let i = 0; i < ladder.length; i += batchSize) {
    const batch = ladder.slice(i, i + batchSize);

    // Run batch in parallel
    const batchResults = await Promise.all(batch.map(({ query, weight }) =>
      commonsTextSearch(query).then(candidates => ({ query, weight, candidates }))
    ));

    // Score all candidates with repFit and eduScore
    for (const { query, weight, candidates } of batchResults) {
      scoreBatch(candidates, query, weight);
      allCandidates.push(...candidates);
    }

    // v4.2: Domain-specific early stop
    if (shouldEarlyStop(allCandidates)) break;

    // v4.2: Expand batch size if no good candidates
    const currentBest = Math.max(...allCandidates.map(c => c.score));
    if (currentBest < 25 && batchSize === BATCH_SIZE_INITIAL) {
      batchSize = BATCH_SIZE_EXPANDED;
    }
  }

  // Depicts boost if not enough good candidates
  if (qids.length > 0 && topScore < thresholds.GOOD_SCORE) {
    const depictsCandidates = await commonsStructuredDataSearch(qids, { textQuery: query });
    // ...
  }
}

function shouldEarlyStop(candidates) {
  const { GOOD_SCORE, MARGIN, MIN_REP_FIT, MIN_EDU, MIN_CANDIDATES, HARD_STOP } = thresholds;

  const unused = candidates
    .filter(c => !usedFileTitles?.has(c.title))
    .sort((a, b) => b.score - a.score);

  // Need minimum candidates before deciding
  if (unused.length < MIN_CANDIDATES) return false;

  const best = unused[0];
  const second = unused[1];
  const margin = second ? best.score - second.score : 100;

  // Check quality floors
  if (best.repFit < MIN_REP_FIT) return false;
  if (best.eduScore < MIN_EDU) return false;

  // HARD_STOP: exceptional hit, stop immediately
  if (best.score >= HARD_STOP) return true;

  // Regular early stop: good score AND clear margin
  return best.score >= GOOD_SCORE && margin >= MARGIN;
}
```

### Skip Embedded Visual Content:
```javascript
function hasEmbeddedVisualContent(question) {
  const textToCheck = [question.q, question.text, question.intro, question.prompt].join(" ");

  const patterns = [
    /\bafbeelding\s*\d*\b/i,  // "afbeelding 1"
    /\btabel\s*\d*\b/i,       // "tabel"
    /\bgrafiek\s*\d*\b/i,     // "grafiek"
    /\bbron\s*\d+\b/i,        // "bron 1" (numbered sources)
    // ... more patterns
  ];

  return patterns.some(p => p.test(textToCheck));
}

// Questions with embedded content don't get Wikimedia images
const skipTypes = ["matching", "ordering", "data_table", "table_parse"];
```

## Huidige Resultaten

**Verbeterd in v4.2:**
- Domain-specifieke thresholds: betere afstemming per afbeeldingstype
- MIN_CANDIDATES voorkomt te vroege beslissingen op kleine sample
- MIN_EDU floor voorkomt niet-educatieve afbeeldingen
- HARD_STOP zorgt voor snelle stops bij uitstekende matches
- Adaptive batching: start efficiënt, schaal op indien nodig

**Verbeterd in v4.1:**
- Parallel batching: ~3x sneller dan sequential
- Margin-based early stop voorkomt "net goed genoeg" afbeeldingen
- Synonym expansion vindt betere resultaten voor Nederlandse queries
- Skip embedded content: geen dubbele afbeeldingen
- Geography domains werken goed voor aardrijkskunde vragen

**Nog steeds problematisch:**
- Sommige zeer specifieke concepten vinden moeilijk educatieve diagrammen
- Threshold tuning per domain is grotendeels op intuïtie gebaseerd

## Open Vragen

### 1. Threshold Profile Tuning
De domain-specifieke thresholds zijn op intuïtie gekozen. Zijn deze waarden optimaal?

| Type | GOOD_SCORE | MARGIN | MIN_REP_FIT | MIN_EDU | MIN_CANDIDATES | HARD_STOP |
|------|------------|--------|-------------|---------|----------------|-----------|
| diagram | 42 | 7 | 8 | 10 | 10 | 55 |
| map | 40 | 5 | 6 | 8 | 15 | 52 |
| microscopy | 35 | 6 | 5 | 8 | 8 | 48 |
| photo | 45 | 8 | 5 | 10 | 12 | 58 |
| cross-section | 40 | 7 | 8 | 10 | 10 | 52 |
| default | 40 | 8 | 5 | 8 | 12 | 55 |

### 2. Adaptive Batch Sizing
We starten met 2 queries en breiden uit naar 3 als beste score < 25.
- Is 25 de juiste threshold voor uitbreiding?
- Zou 4 queries per batch zinvol zijn bij zeer slechte resultaten?

### 3. repFit en eduScore Berekening
De formules zijn simpel (tel matches * factor). Kunnen we dit verbeteren?
- Moeten bepaalde termen zwaarder wegen?
- Zou een gewogen systeem beter werken?

### 4. Synonym Coverage
De DOMAIN_SYNONYMS zijn handmatig gecureerd. Moeten we:
- Wikidata labels automatisch ophalen?
- Meer synoniemen toevoegen voor specifieke vakgebieden?
- Engels/Nederlands detectie automatiseren?

## Voorbeelden van Gewenste vs Ongewenste Afbeeldingen

| Vraag | Gewenst | Ongewenst |
|-------|---------|-----------|
| Biceps beweging | Gelabeld anatomisch diagram arm | Bodybuilder, stock foto |
| Osteon (Havers-systeem) | Microscoop beeld of schema met labels | Oude medische tekst |
| RSI preventie | Ergonomische werkplek diagram | Kantoormeubel reclame |
| Köppen klimaatzones | Wereld klimaatkaart met zones | Fantasy game map |
| Stuwingsregen | Diagram loef/lijzijde bergen | Foto regendruppels |
| Urbanisatie Nederland | Luchtfoto Randstad of diagram | Minecraft screenshot |

## Technische Context

- Platform: Browser-based quiz app
- API: Wikimedia Commons API + Wikidata SPARQL
- Caching: LocalStorage met 30 dagen TTL (key: `mediaCache:v4.2`)
- Concurrency: 2-3 parallel batches (adaptive)
- Fallback: Wikipedia artikel thumbnail

**Performance vereiste:** Afbeeldingen moeten snel laden. De quiz wordt live gebruikt door scholieren - lange laadtijden verstoren de flow. Daarom:
- Early stopping om onnodige API calls te vermijden
- Adaptive batching: start klein (2), schaal op indien nodig (3)
- Caching voor herhaalde vragen
- Thumbnail URLs (800px) in plaats van full-size afbeeldingen

## Gewenste Output

1. **Feedback op v4.2 verbeteringen** - Zijn domain-specifieke thresholds en adaptive batching goed geïmplementeerd?
2. **Threshold profile tuning** - Zijn de waarden per type logisch? Welke zouden aangepast moeten worden?
3. **repFit/eduScore verbetering** - Hoe kunnen we deze berekeningen verfijnen?
4. **Edge case handling** - Tips voor problematische query types?
