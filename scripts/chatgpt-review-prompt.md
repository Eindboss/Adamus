# ChatGPT Review: Wikimedia Image Selection System (v4.3)

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor middelbare scholieren. Elke vraag moet een relevante afbeelding krijgen van Wikimedia Commons. Het systeem is geüpgraded naar v4.3 met verbeterde early stopping, anti-answer-reveal filtering, en phase-based threshold relaxation.

## Huidige Architectuur (v4.3)

### Nieuwe Features in v4.3 (t.o.v. v4.2):
- **Anti-answer-reveal filtering**: Automatisch blokkeren van termen uit het correcte antwoord zodat afbeeldingen het antwoord niet onthullen
- **HARD_STOP safety floors**: HARD_STOP vereist nu ook repFit >= MIN_REP_FIT + 2 om premature stops te voorkomen
- **Phase-based threshold relaxation**: Later in de query ladder worden thresholds verlaagd (max 10 punten) omdat goede afbeeldingen zeldzamer zijn
- **Getuned MIN_CANDIDATES**: diagram/cross-section → 12, microscopy → 6 (zeldzamer)
- **Getuned MARGIN**: photo → 7, diagram → 6, default → 7

### Features behouden van v4.2:
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

### Domain-Specifieke Threshold Profiles (v4.3 tuned):
```javascript
const THRESHOLD_PROFILES = {
  // Diagram-based (anatomy, biology) - need more candidates to compare
  diagram: {
    GOOD_SCORE: 42,
    MARGIN: 6,              // v4.3: lowered from 7
    MIN_REP_FIT: 8,
    MIN_EDU: 10,
    MIN_CANDIDATES: 12,     // v4.3: raised from 10
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
  // Microscopy - good candidates are rare, be less strict
  microscopy: {
    GOOD_SCORE: 35,
    MARGIN: 6,
    MIN_REP_FIT: 5,
    MIN_EDU: 8,
    MIN_CANDIDATES: 6,      // v4.3: lowered from 8 (rare images)
    HARD_STOP: 48
  },
  // Photos - easier to find, can be stricter
  photo: {
    GOOD_SCORE: 45,
    MARGIN: 7,              // v4.3: lowered from 8
    MIN_REP_FIT: 5,
    MIN_EDU: 10,
    MIN_CANDIDATES: 12,
    HARD_STOP: 58
  },
  // Cross-sections - similar to diagrams, need more candidates
  "cross-section": {
    GOOD_SCORE: 40,
    MARGIN: 6,              // v4.3: lowered from 7
    MIN_REP_FIT: 8,
    MIN_EDU: 10,
    MIN_CANDIDATES: 12,     // v4.3: raised from 10
    HARD_STOP: 52
  },
  // Default fallback
  default: {
    GOOD_SCORE: 40,
    MARGIN: 7,              // v4.3: lowered from 8
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

// v4.3: Phase-based threshold relaxation
function shouldEarlyStop(candidates, ladderPhase = 0) {
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

  // v4.3: Phase-based threshold relaxation
  // Later in the ladder = harder to find good images, relax requirements
  const phaseBonus = Math.min(ladderPhase * 2, 10); // Max 10 point relaxation
  const adjustedGoodScore = GOOD_SCORE - phaseBonus;
  const adjustedMargin = Math.max(MARGIN - Math.floor(ladderPhase / 2), 3); // Min margin 3

  // v4.3: HARD_STOP with safety floors - prevent stopping on weak but high-scoring
  if (best.score >= HARD_STOP &&
      best.repFit >= MIN_REP_FIT + 2 &&  // Must exceed minimum by 2
      best.eduScore >= MIN_EDU) {
    return true;
  }

  // Regular early stop: good score AND clear margin (phase-adjusted)
  return best.score >= adjustedGoodScore && margin >= adjustedMargin;
}
```

### Anti-Answer-Reveal Filtering (v4.3):
```javascript
/**
 * v4.3: Extract answer terms that should not appear in the image
 * This prevents images from revealing the correct answer
 */
function extractAnswerTerms(question) {
  const answerTerms = [];

  // Get correct answer(s)
  if (question.type === "mc" || question.type === "multiple_choice") {
    const correctIdx = question.correct;
    if (typeof correctIdx === "number" && question.options?.[correctIdx]) {
      const answer = question.options[correctIdx];
      // Extract significant terms (3+ chars)
      const terms = (typeof answer === "string" ? answer : answer.text || "")
        .toLowerCase()
        .split(/[\s,;:]+/)
        .filter(t => t.length >= 3);
      answerTerms.push(...terms);
    }
  } else if (question.type === "short_answer" || question.type === "fill_blank") {
    const answers = question.answers || question.acceptedAnswers || [];
    for (const ans of answers) {
      const terms = String(ans).toLowerCase().split(/[\s,;:]+/).filter(t => t.length >= 3);
      answerTerms.push(...terms);
    }
  }

  // Filter out common words that wouldn't give away answers
  const commonWords = new Set([
    "the", "een", "het", "de", "van", "voor", "met", "naar", "door", "uit",
    "zijn", "worden", "hebben", "kunnen", "zal", "zou", "moet", "mag"
  ]);

  return [...new Set(answerTerms.filter(t => !commonWords.has(t)))];
}

// In loadQuestionImage:
async function loadQuestionImage(question, opts = {}) {
  // v4.3: Extract answer terms to prevent answer reveal in images
  const answerTerms = extractAnswerTerms(question);
  const baseNegativeTerms = media.negativeTerms ?? [];
  const negativeTerms = [...baseNegativeTerms, ...answerTerms];

  if (answerTerms.length > 0) {
    console.log(`[wikimedia] Anti-reveal: blocking terms ${answerTerms.join(", ")} for q${question.id}`);
  }
  // ...
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

**Verbeterd in v4.3:**
- Anti-answer-reveal filtering: afbeeldingen tonen niet meer het antwoord op de vraag
- HARD_STOP safety floors: voorkomt premature stops op zwakke kandidaten met hoge scores
- Phase-based relaxation: later in de ladder worden thresholds verlaagd voor moeilijke concepten
- Getuned MIN_CANDIDATES: diagram/cross-section nu 12 (was 10), microscopy nu 6 (was 8)
- Getuned MARGIN: photo nu 7, diagram nu 6, default nu 7

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
- Edge cases bij anti-answer-reveal (als antwoord hetzelfde concept is als de vraag)

## Open Vragen

### 1. Threshold Profile Tuning (v4.3 values)
De domain-specifieke thresholds zijn getuned op basis van v4.2 ervaringen:

| Type | GOOD_SCORE | MARGIN | MIN_REP_FIT | MIN_EDU | MIN_CANDIDATES | HARD_STOP |
|------|------------|--------|-------------|---------|----------------|-----------|
| diagram | 42 | 6 | 8 | 10 | 12 | 55 |
| map | 40 | 5 | 6 | 8 | 15 | 52 |
| microscopy | 35 | 6 | 5 | 8 | 6 | 48 |
| photo | 45 | 7 | 5 | 10 | 12 | 58 |
| cross-section | 40 | 6 | 8 | 10 | 12 | 52 |
| default | 40 | 7 | 5 | 8 | 12 | 55 |

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

### Biologie
| Vraag | Gewenst | Ongewenst |
|-------|---------|-----------|
| Biceps beweging | Gelabeld anatomisch diagram arm | Bodybuilder, stock foto |
| Osteon (Havers-systeem) | Microscoop beeld of schema met labels | Oude medische tekst |
| RSI preventie | Ergonomische werkplek diagram | Kantoormeubel reclame |

### Aardrijkskunde
| Vraag | Gewenst | Ongewenst |
|-------|---------|-----------|
| Köppen klimaatzones | Wereld klimaatkaart met zones | Fantasy game map |
| Stuwingsregen | Diagram loef/lijzijde bergen | Foto regendruppels |
| Urbanisatie Nederland | Luchtfoto Randstad of diagram | Minecraft screenshot |
| Golfstroom effect | Kaart met warme zeestroming naar Europa | Stockfoto golven |
| Hoge/lage druk wind | Diagram luchtdruk en windrichting | Weerinstrumenten foto |
| Dag en nacht rotatie | Diagram aarde draait om as | Cartoon/kids illustratie |

### Geschiedenis
| Vraag | Gewenst | Ongewenst |
|-------|---------|-----------|
| Slag bij Marathon | Historische kaart 490 v.C. | Marathon hardlopen foto |
| Piramides van Gizeh | Foto piramides met context | Moderne toeristen |
| Atheense democratie | Diagram/illustratie volksvergadering | Modern parlement |
| Alexander de Grote rijk | Historische kaart veroveringen | Film screenshot |
| Mummificatie | Educatief diagram/museum foto | Horror/movie beeld |
| Paard van Troje | Historische illustratie/reconstructie | Computer virus icon |

## Nieuwe Uitdagingen per Vakgebied

### Aardrijkskunde-specifiek
- **Kaarten vs diagrammen**: Veel vragen vereisen kaarten (klimaatzones, zeestromingen) maar ook conceptuele diagrammen (luchtdruk, seizoenen)
- **Geografische ambiguïteit**: "Golfstroom" kan verward worden met "golf" (sport) - negativeTerms essentieel
- **Schaalvragen**: Afbeeldingen over kaartschaal zijn lastig - vaak te abstract
- **Nederlandse termen**: Köppen, stuwingsregen, loef/lijzijde - synoniemen naar Engels cruciaal

### Geschiedenis-specifiek
- **Historische context**: Modern recreaties vs authentieke artefacten - moeilijk te onderscheiden
- **Film/entertainment vervuiling**: "Sparta", "Troje", "Alexander" geven vaak filmstills
- **Jaartallen in queries**: "490 BC" helpt bij Marathon, maar niet altijd beschikbaar
- **Artefacten vs reconstructies**: Narmer-palet (echt) vs Paard van Troje (altijd reconstructie)
- **Religieuze/culturele gevoeligheid**: Mummificatie afbeeldingen kunnen te grafisch zijn

## Aanbevolen Uitbreidingen

### Nieuwe CHAPTER_PROFILES nodig
```javascript
// HISTORY
ancient_egypt: { prefer: ["pharaoh", "pyramid", "hieroglyph", "mummy"], avoid: ["horror", "movie", "modern"] },
ancient_greece: { prefer: ["ancient", "classical", "polis", "temple"], avoid: ["modern", "film", "reenactment"] },
battles: { prefer: ["battle", "map", "ancient", "historical"], avoid: ["game", "movie", "sport"] },

// GEOGRAPHY (aanvullingen)
seasons: { prefer: ["earth", "axis", "tilt", "diagram"], avoid: ["cartoon", "kids"] },
ocean_currents: { prefer: ["current", "stream", "atlantic", "map"], avoid: ["surfing", "waves"] },
atmospheric: { prefer: ["pressure", "wind", "diagram", "circulation"], avoid: ["weather app", "forecast"] }
```

### Nieuwe DOMAIN_SYNONYMS nodig
```javascript
history: {
  "farao": ["pharaoh", "Egyptian king"],
  "hiërogliefen": ["hieroglyphics", "Egyptian writing"],
  "mummificatie": ["mummification", "embalming"],
  "polis": ["city-state", "Greek polis"],
  "democratie": ["democracy", "Athenian democracy"],
  "hellenisme": ["Hellenism", "Hellenistic period"]
},
seasons: {
  "aardas": ["earth axis", "axial tilt"],
  "seizoenen": ["seasons", "seasonal"],
  "keerkring": ["tropic", "tropics"],
  "poolcirkel": ["arctic circle", "polar circle"]
}
```

## Technische Context

- Platform: Browser-based quiz app
- API: Wikimedia Commons API + Wikidata SPARQL
- Caching: LocalStorage met 30 dagen TTL (key: `mediaCache:v4.3`)
- Concurrency: 2-3 parallel batches (adaptive)
- Fallback: Wikipedia artikel thumbnail

**Performance vereiste:** Afbeeldingen moeten snel laden. De quiz wordt live gebruikt door scholieren - lange laadtijden verstoren de flow. Daarom:
- Early stopping om onnodige API calls te vermijden
- Adaptive batching: start klein (2), schaal op indien nodig (3)
- Phase-based relaxation: verlaag thresholds na meerdere mislukte batches
- Caching voor herhaalde vragen
- Thumbnail URLs (800px) in plaats van full-size afbeeldingen

**Antwoord-veiligheid:** Afbeeldingen mogen het antwoord niet onthullen:
- Automatisch blokkeren van termen uit het correcte antwoord
- negativeTerms uitgebreid met answer terms
- Logging van geblokkeerde termen voor debugging

## Gewenste Output

1. **Feedback op v4.3 verbeteringen** - Is de anti-answer-reveal logica robuust? Zijn er edge cases?
2. **Phase-based relaxation tuning** - Is phaseBonus = ladderPhase * 2 (max 10) optimaal? Is min margin 3 te laag?
3. **HARD_STOP safety floors** - Is repFit >= MIN_REP_FIT + 2 een goede safety margin?
4. **Anti-answer-reveal edge cases** - Wat als het antwoord hetzelfde concept is als waar de vraag over gaat? (bijv. "Wat is de biceps?" met antwoord "armbuigspier" - dan willen we geen afbeelding blokkeren omdat "armbuigspier" erin staat)
5. **Threshold profile tuning** - Zijn de getuned waarden per type logisch? Welke zouden verder aangepast moeten worden?
