# ChatGPT Review: Wikimedia Image Selection System (v4.1)

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor middelbare scholieren. Elke vraag moet een relevante afbeelding krijgen van Wikimedia Commons. Het systeem is geüpgraded naar v4.1 met verbeterde query-ladder, parallel batching, en margin-based early stopping.

## Huidige Architectuur (v4.1)

### Nieuwe Features in v4.1:
- **Parallel batch processing**: 3 queries tegelijk voor snellere searches
- **Margin-based early stopping**: Stop alleen als score >= 40 EN margin >= 8 EN repFit >= 5
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

### Domain Profiles (multi-vak):
```javascript
const CHAPTER_PROFILES = {
  // BIOLOGY
  muscles: { prefer: ["diagram", "labelled", "anatomy"], avoid: ["bodybuilder", "gym"] },
  skeleton: { prefer: ["diagram", "labelled", "bone"], avoid: ["dinosaur", "museum"] },
  joints: { prefer: ["diagram", "cross-section", "synovial"], avoid: ["x-ray", "surgery"] },
  cells: { prefer: ["microscope", "micrograph", "diagram"], avoid: ["prison", "battery"] },
  health: { prefer: ["ergonomic", "posture", "diagram"], avoid: ["advertisement", "product"] },

  // GEOGRAPHY (NEW)
  maps: { prefer: ["map", "topographic", "thematic"], avoid: ["game", "fantasy"] },
  climate: { prefer: ["climate", "Köppen", "diagram", "chart"], avoid: ["forecast", "app"] },
  urbanization: { prefer: ["city", "urban", "aerial view"], avoid: ["game", "minecraft"] },
  wind: { prefer: ["wind", "pressure", "isobar", "diagram"], avoid: ["wind turbine"] },
  precipitation: { prefer: ["rain", "orographic", "diagram"], avoid: ["umbrella", "product"] },
  landscape: { prefer: ["landscape", "terrain", "relief"], avoid: ["painting", "wallpaper"] },

  // HISTORY
  historical: { prefer: ["historical", "artifact"], avoid: ["movie", "reenactment"] },
  archaeology: { prefer: ["archaeological", "excavation"], avoid: ["game", "movie"] },

  // SCIENCE
  chemistry: { prefer: ["molecule", "structure", "diagram"], avoid: ["stock photo"] },
  physics: { prefer: ["physics", "diagram", "force"], avoid: ["stock photo"] }
};
```

### Parallel Batch Processing + Margin-Based Early Stop:
```javascript
async function getMediaForQuery(query, opts) {
  const domain = detectDomain(query, intent);
  const ladder = generateQueryLadder(query, { representation, domain });

  const GOOD_SCORE_THRESHOLD = 40;
  const MARGIN_THRESHOLD = 8;  // Must beat #2 by this much
  const MIN_REP_FIT = 5;       // Minimum representation layer score
  const BATCH_SIZE = 3;

  for (let i = 0; i < ladder.length; i += BATCH_SIZE) {
    const batch = ladder.slice(i, i + BATCH_SIZE);

    // Run batch in parallel
    const batchResults = await Promise.all(batch.map(({ query, weight }) =>
      commonsTextSearch(query).then(candidates => ({ query, weight, candidates }))
    ));

    // Score all candidates
    for (const { query, weight, candidates } of batchResults) {
      scoreBatch(candidates, query, weight);
      allCandidates.push(...candidates);
    }

    // Margin-based early stop
    if (shouldEarlyStop(allCandidates)) break;
  }

  // Depicts boost if not enough good candidates
  if (qids.length > 0 && topScore < GOOD_SCORE_THRESHOLD) {
    const depictsCandidates = await commonsStructuredDataSearch(qids, { textQuery: query });
    // ...
  }
}

function shouldEarlyStop(candidates) {
  const sorted = candidates.sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const second = sorted[1];
  const margin = second ? best.score - second.score : 100;

  return best.score >= GOOD_SCORE_THRESHOLD &&
         margin >= MARGIN_THRESHOLD &&
         best.repFit >= MIN_REP_FIT;
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

**Verbeterd in v4.1:**
- Parallel batching: ~3x sneller dan sequential
- Margin-based early stop voorkomt "net goed genoeg" afbeeldingen
- Synonym expansion vindt betere resultaten voor Nederlandse queries
- Skip embedded content: geen dubbele afbeeldingen
- Geography domains werken goed voor aardrijkskunde vragen

**Nog steeds problematisch:**
- Sommige zeer specifieke concepten vinden moeilijk educatieve diagrammen
- Balans tussen snelheid (early stop) en kwaliteit (doorzoeken)

## Open Vragen

### 1. Early Stop Tuning
De margin-based early stop is conservatiever dan pure threshold. Is de huidige config optimaal?
- `GOOD_SCORE_THRESHOLD = 40`
- `MARGIN_THRESHOLD = 8`
- `MIN_REP_FIT = 5`

### 2. Synonym Coverage
De DOMAIN_SYNONYMS zijn handmatig gecureerd. Moeten we:
- Wikidata labels automatisch ophalen?
- Meer synoniemen toevoegen voor specifieke vakgebieden?
- Engels/Nederlands detectie automatiseren?

### 3. Batch Size vs Latency
Met `BATCH_SIZE = 3` hebben we goede parallelisatie maar early stop werkt per batch.
- Zou `BATCH_SIZE = 2` sneller stoppen bij goede eerste hit?
- Of is 3 de sweet spot?

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
- Caching: LocalStorage met 30 dagen TTL (key: `mediaCache:v4.1`)
- Concurrency: 3 parallel batches
- Fallback: Wikipedia artikel thumbnail

**Performance vereiste:** Afbeeldingen moeten snel laden. De quiz wordt live gebruikt door scholieren - lange laadtijden verstoren de flow. Daarom:
- Early stopping om onnodige API calls te vermijden
- Parallel batches voor snellere eerste resultaten
- Caching voor herhaalde vragen
- Thumbnail URLs (800px) in plaats van full-size afbeeldingen

## Gewenste Output

1. **Feedback op v4.1 verbeteringen** - Zijn parallel batching en margin-based early stop goed geïmplementeerd?
2. **Threshold tuning** - Zijn de huidige waarden (40/8/5) optimaal?
3. **Synonym expansion** - Hoe kunnen we dit verbeteren zonder handmatig werk?
4. **Edge case handling** - Tips voor problematische query types?
