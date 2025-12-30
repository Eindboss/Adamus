# ChatGPT Review: Wikimedia Image Selection System (v4)

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor middelbare scholieren. Elke vraag moet een relevante afbeelding krijgen van Wikimedia Commons. Het systeem is nu geüpgraded naar v4 met query-ladder en 3-laags scoring.

## Huidige Architectuur (v4)

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

### Query-Ladder Strategie:
```javascript
// Genereer queries van specifiek naar breed
function generateQueryLadder(baseQuery, { representation, concepts }) {
  return [
    { query: "biceps elbow flexion labelled diagram", weight: 1.0 },  // Meest specifiek
    { query: "biceps elbow flexion diagram", weight: 0.9 },
    { query: "biceps elbow flexion", weight: 0.8 },
    { query: "biceps elbow", weight: 0.7 },
    { query: "biceps anatomy", weight: 0.6 },
    { query: "biceps", weight: 0.5 }  // Meest breed (fallback)
  ];
}

// Early stopping: stop zodra score >= 40
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
  muscles: {
    prefer: ["diagram", "labelled", "anatomy", "muscle", "flexion"],
    avoid: ["bodybuilder", "fitness", "gym"],
    preferCategories: ["Diagrams", "Anatomy", "Muscles"],
    avoidCategories: ["Bodybuilding", "Fitness models"]
  },
  skeleton: { ... },
  joints: { ... },
  cells: { ... },
  plants: { ... },
  animals: { ... },

  // GEOGRAPHY
  maps: { ... },
  climate: { ... },
  landscape: { ... },

  // HISTORY
  historical: { ... },
  archaeology: { ... },

  // SCIENCE
  chemistry: { ... },
  physics: { ... }
};

// Automatische detectie op basis van keywords in query
function detectDomain(query, intent) {
  if (containsAny(combined, ["muscle", "biceps", "triceps"])) return "muscles";
  if (containsAny(combined, ["map", "kaart", "atlas"])) return "maps";
  // etc...
}
```

### Zoekstrategie:
```javascript
async function getMediaForQuery(query, opts) {
  // 1. Detecteer domain voor context-aware scoring
  const domain = detectDomain(query, intent);

  // 2. Genereer query ladder
  const ladder = generateQueryLadder(query, { representation, concepts });

  // 3. Loop door ladder, stop early bij goede score
  for (const { query, weight } of ladder) {
    const candidates = await commonsTextSearch(query);
    // Re-score met 3-laags systeem
    for (const c of candidates) {
      c.score = scoreCandidate(c, query, { domain, representation, queryWeight: weight });
    }
    // Early stop als score >= 40
    if (bestCandidate.score >= 40) break;
  }

  // 4. Depicts boost als weinig resultaten
  if (qids.length > 0 && candidates.length < 5) {
    const depictsCandidates = await commonsStructuredDataSearch(qids);
    // Depicts geeft +40 bonus in layer 2
  }

  // 5. Wikipedia fallback als laatste redmiddel
}
```

## Huidige Resultaten

**Verbeterd:**
- Query "biceps elbow flexion diagram" → 0 resultaten, maar ladder relaxeert naar "biceps anatomy" → goede resultaten
- Domain-aware scoring voorkomt bodybuilder foto's bij spiervragen
- Depicts (P180) geeft semantische boost

**Nog steeds problematisch:**
- Sommige zeer specifieke concepten (bijv. "osteon haversian system labeled") vinden moeilijk educatieve diagrammen
- Nederlands-specifieke termen worden niet altijd gevonden

## Vraag 1: Query Optimalisatie

De query-ladder werkt, maar kunnen we de initiële queries slimmer maken?

Ideeën:
- Automatisch Engels/Nederlands synoniemen toevoegen?
- Wikidata labels gebruiken voor betere zoektermen?
- Query expansie met gerelateerde concepten?

## Vraag 2: Scoring Fine-tuning

De 3-laags scoring werkt redelijk, maar:
- Zijn de gewichten goed? (representation ±30, quality ±60, domain ±50)
- Moeten we meer/andere categorieën detecteren?
- Is de early-stop threshold (40) te hoog/laag?

## Vraag 3: Depicts Coverage

Wikidata depicts (P180) is krachtig maar sparse:
- Veel educatieve afbeeldingen missen P180 tags
- Moeten we een fallback naar SPARQL category queries bouwen?
- Of is het beter om op text search te focussen?

## Vraag 4: Edge Cases

Hoe om te gaan met:
- Microscopie beelden vs schema's (osteon, cellen)
- Historische afbeeldingen (authenticiteit vs kwaliteit)
- Kaarten (topografisch vs politiek vs thematisch)

## Vraag 5: AI-Integratie (Gemini Vision)

Ik heb toegang tot Google Cloud met Gemini Vision API. Mogelijke use cases:

### A. Post-filtering met Vision:
```javascript
// Na Commons search, laat Gemini de top-5 beoordelen
const candidates = await commonsSearch(query);
const ratings = await Promise.all(candidates.slice(0, 5).map(c =>
  geminiVision.analyze(c.thumbUrl, {
    prompt: `Rate this image for educational use in a biology quiz about ${topic}.
             Score 1-10 on: relevance, clarity, educational value, age-appropriateness.`
  })
));
```

### B. Query generation met AI:
```javascript
// Laat Gemini betere queries genereren op basis van vraag context
const betterQuery = await gemini.generate({
  prompt: `Given this quiz question about ${topic}: "${questionText}"
           Generate 3 Wikimedia Commons search queries that would find
           an educational diagram. Focus on scientific/anatomical terms.`
});
```

### C. Fallback image description:
```javascript
// Als geen goede afbeelding gevonden, genereer beschrijving
if (bestScore < 20) {
  const description = await gemini.generate({
    prompt: `Describe what an ideal educational image would show for: ${topic}`
  });
  // Gebruik beschrijving als alt-text of voor nieuwe search
}
```

**Vragen over Gemini integratie:**
1. Is post-filtering de moeite waard? (extra API calls, latency, kosten)
2. Of is het beter om de metadata-based scoring eerst te perfectioneren?
3. Welke use case zou de meeste impact hebben op kwaliteit?
4. Hoe om te gaan met rate limits en caching?

## Voorbeelden van Gewenste vs Ongewenste Afbeeldingen

| Vraag | Gewenst | Ongewenst |
|-------|---------|-----------|
| Biceps beweging | Gelabeld anatomisch diagram arm | Bodybuilder, stock foto |
| Osteon (Havers-systeem) | Microscoop beeld of schema met labels | Oude medische tekst |
| RSI preventie | Ergonomische werkplek diagram | Kantoormeubel reclame |
| Gewrichtskraakbeen | Doorsnede gewricht met labels | Röntgenfoto |
| Klimaatzone's | Wereld klimaatkaart | Fantasy game map |
| Middeleeuwen | Historische afbeelding/artifact | Film screenshot |

## Gewenste Output

1. **Feedback op huidige architectuur** - Is de 3-laags aanpak goed?
2. **Query optimalisatie tips** - Hoe kunnen we queries verbeteren?
3. **Scoring verbeteringen** - Welke gewichten/thresholds aanpassen?
4. **Gemini strategie** - Wel of niet integreren, en zo ja, hoe?
5. **Edge case handling** - Specifieke tips per type afbeelding

## Technische Context

- Platform: Browser-based quiz app
- API: Wikimedia Commons API + Wikidata SPARQL
- Caching: LocalStorage met 30 dagen TTL
- Concurrency: 3 parallel fetches
- Fallback: Wikipedia artikel thumbnail
