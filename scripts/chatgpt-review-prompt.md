# ChatGPT Review: AI-Powered Image Selection (v3.4) - Lessons Learned

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor middelbare scholieren. Na zes iteraties heb ik nu een v3.4 systeem. Dit document beschrijft wat we geleerd hebben.

**Belangrijk:** Ik gebruik Gemini **Tier 1** (niet gratis tier), dus er is meer ruimte voor extra AI calls als dat nodig is.

## Resultaten Vergelijking

| Versie | Biologie | Geschiedenis | Latijn | Aardrijkskunde | Gemiddeld |
|--------|----------|--------------|--------|----------------|-----------|
| v1 | ~50% | - | - | - | ~50% |
| v2 | 75% | - | - | - | 75% |
| v3 | 87.5% | - | - | - | 87.5% |
| v3.1 | 95.8% | 100% | - | - | 97.8% |
| v3.2 | 93.75% | 100% | 83.1% | 98.9% | 92.8% |
| v3.3 | 100% | 97.8% | 100% | 100% | 99.5% |
| **v3.4** | **100%** | **97.8%** | **100%** | **100%** | **99.5%** |

*v3.4: Verbeterde beeldkwaliteit door multi-source search (Unsplash, Pexels, Commons)*
*Latijn: 33 images voor verhalende vragen + 86 grammaticavragen (imagePolicy="none")*
*Aardrijkskunde: H1 100% (49/49) + H2 100% (46/46) = 100% totaal*

## Wat Werkte (v3.4 Verbeteringen)

### 1. Multi-source image search
Naast Wikimedia Commons worden nu ook Unsplash en Pexels doorzocht voor hoogwaardige foto's.

```javascript
const UNSPLASH_API = 'https://api.unsplash.com';
const PEXELS_API = 'https://api.pexels.com/v1';

// Professional photo sources get +50 scoring bonus
async function searchUnsplash(searchTerm, limit = 10) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return [];
  // Fetches high-quality photos with proper attribution
  return results.map(photo => ({
    title: photo.description || photo.alt_description,
    imageUrl: photo.urls?.regular,
    source: 'unsplash',
    attribution: `Photo by ${photo.user?.name} on Unsplash`,
  }));
}

async function searchPexels(searchTerm, limit = 10) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];
  // Fetches high-quality photos with proper attribution
  return results.map(photo => ({
    title: photo.alt || searchTerm,
    imageUrl: photo.src?.large,
    source: 'pexels',
    attribution: `Photo by ${photo.photographer} on Pexels`,
  }));
}
```

### 2. Photo preference voor biologie en aardrijkskunde
Sommige vakken profiteren meer van echte foto's dan van abstracte diagrammen.

```javascript
async function findBestImage(brief, usedImages, subject = null, questionText = '') {
  const subjectLower = (subject || '').toLowerCase();
  const preferPhotos = subjectLower === 'biologie' || subjectLower === 'aardrijkskunde';

  // Try Unsplash and Pexels FIRST for photo-preferred subjects
  if (preferPhotos && queries.length > 0) {
    const photoQuery = queries[0];
    const unsplashResults = await searchUnsplash(photoQuery, 5);
    const pexelsResults = await searchPexels(photoQuery, 5);

    // +50 bonus for professional photo sources
    for (const candidate of [...unsplashResults, ...pexelsResults]) {
      candidate.score = (candidate.score || 100) + 50;
    }
  }
}
```

### 3. Source-based attribution
Automatische bronvermelding per image source.

```javascript
// Caption attribution per source
let caption = 'Bron: Wikimedia Commons';
if (result.source === 'unsplash') {
  caption = result.attribution || 'Bron: Unsplash';
} else if (result.source === 'pexels') {
  caption = result.attribution || 'Bron: Pexels';
}
```

### 4. imagePolicy="none" voor grammaticavragen (v3.3)
Latijnse grammatica/vertaalvragen krijgen geen afbeelding meer - alleen verhalende (culturele/mythologische) vragen.

```javascript
const LATIN_GRAMMAR_KEYWORDS = [
  // Grammar terms
  'accusativus', 'accusatief', 'dativus', 'datief', 'genitivus', 'genitief',
  'ablativus', 'ablatief', 'nominativus', 'nominatief', 'vocativus', 'vocatief',
  'vervoeging', 'verbuiging', 'coniugatio', 'conjugatie', 'declinatio', 'declinatie',
  // Translation terms
  'vertaal', 'vertaling', 'betekent', 'betekenis',
  // Vocabulary terms
  'woordsoort', 'zelfstandig naamwoord', 'werkwoord', 'bijvoeglijk',
  // Sentence analysis
  'ontleed', 'ontleding', 'zinsdeel', 'onderwerp', 'lijdend voorwerp',
];

// Narrative questions still get images
const narrativeKeywords = [
  'romulus', 'remus', 'vestaalse', 'vesta', 'numa', 'tarquinius',
  'sabijnse', 'aeneas', 'troje', 'jupiter', 'mars', 'venus',
  'mythe', 'sage', 'legende', 'verhaal', 'geschiedenis',
];
```

### 5. Per-question AI escalation (v3.3)
Bij gefaalde zoekopdrachten wordt een extra AI call gedaan voor creatieve alternatieve queries (max 10 per quiz).

```javascript
const MAX_ESCALATIONS_PER_QUIZ = 10;

async function escalateWithAI(question, subject, chapterContext) {
  // Generates new commonsQueries and categoryHints for failed questions
  // Uses synonyms, alternative terminology, related concepts
}
```

## Architectuur v3.4

```
┌─────────────────────────────────────────────────────────────┐
│                    BATCH AI (12 vragen)                      │
│                                                              │
│  Output per vraag:                                           │
│  • imageIntent: labeled_diagram/concept_diagram/photo/...   │
│  • commonsQueries: ["strict", "relaxed", "broad"]           │
│  • categoryHints: ["Gray's Anatomy plates", ...]            │
│  • riskProfile: human_vs_animal/thematic_vs_tourist/...     │
│  • topicKeywords: ["skull", "fontanelle"]                   │
│  • wikipediaFallback: "Article_name"                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              IMAGE POLICY CHECK (v3.3+)                      │
│                                                              │
│  • Latin grammar/translation → imagePolicy="none" (skip)    │
│  • Narrative questions → imagePolicy="required"             │
│  • Other subjects → imagePolicy="required"                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              MULTI-SOURCE SEARCH (v3.4)                      │
│                                                              │
│  Photo-preferred subjects (biologie, aardrijkskunde):       │
│  1. [NEW] Unsplash search (+50 bonus)                       │
│  2. [NEW] Pexels search (+50 bonus)                         │
│  3. Category search (categoryHints)                          │
│  4. Text search (commonsQueries)                            │
│                                                              │
│  Other subjects:                                             │
│  1. Category search (categoryHints)                          │
│  2. Text search (commonsQueries)                            │
│  3. Negation ladder: retry zonder negaties                   │
│  4. Wikipedia fallback bij lage score                        │
│  5. Broader search als nog steeds te laag                    │
│  6. AI escalation bij failure (max 10/quiz)                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              DETERMINISTIC SCORING (v3.4)                    │
│                                                              │
│  Photo source bonuses:                                       │
│  • Unsplash: +50 (professional photography)                 │
│  • Pexels: +50 (professional photography)                   │
│                                                              │
│  Subject-specific thresholds:                                │
│  • Biologie concept_diagram: 60 (was 70)                    │
│  • Geschiedenis historical_illustration: 80 (was 70)        │
│  • Aardrijkskunde map: 80 (was 70)                          │
│                                                              │
│  BONUSSEN & PENALTIES: (unchanged from v3.2)                │
└─────────────────────────────────────────────────────────────┘
```

## Kosten

**v3.4 kosten:** Gemini Tier 1
- 4-8 AI calls per ~50 vragen (batches van 12)
- + max 10 escalation calls voor moeilijke vragen
- Tier 1 geeft ruimte voor deze extra calls

**API kosten:**
- Wikimedia Commons: Gratis
- Unsplash: Gratis (50 requests/hour demo, 5000/hour production)
- Pexels: Gratis (200 requests/hour, 20000/month)

## Concrete Successen per Vak

### Biologie (100%)
| Type | Voorbeeld | Bron |
|------|-----------|------|
| Anatomie | Human skeleton photo | Unsplash/Pexels |
| Gewrichten | Joint anatomy illustration | Commons |
| Spieren | Muscle fiber diagram | Commons |
| Microscoop | Laboratory microscope | Pexels |

### Geschiedenis (97.8%)
| Type | Voorbeeld | Bron |
|------|-----------|------|
| Mummificatie | Mummification simple.png | Commons |
| Grieken | Map of Ancient Greece | Commons |
| Olympische Spelen | Ancient Olympic stadium | Commons |

### Aardrijkskunde (100%)
| Type | Voorbeeld | Bron |
|------|-----------|------|
| Tijdzones | World time zones map | Commons |
| Coördinaten | Latitude and Longitude diagram | Commons |
| Steden | City skyline photos | Unsplash/Pexels |
| Landschappen | Geographic features | Unsplash/Pexels |

### Latijn (100%)
| Type | Resultaat |
|------|-----------|
| Verhalende vragen | 33 images (Romulus, Remus, Vesta, etc.) |
| Grammaticavragen | 86 (imagePolicy="none") |

## Vakken en Toepasbaarheid

| Vak | v3.3 | v3.4 | Verbetering |
|-----|------|------|-------------|
| Biologie | 100% | **100%** | Betere foto's door Unsplash/Pexels |
| Geschiedenis | 97.8% | **97.8%** | Ongewijzigd |
| Aardrijkskunde | 100% | **100%** | Betere foto's door Unsplash/Pexels |
| Latijn | 100% | **100%** | Meer proeftoetsen verwerkt |

*Dit zijn de vier vakken waarvoor afbeeldingen worden gezocht.*

## Technische Context

- **Platform:** Browser-based quiz app (HTML/JS)
- **AI:** Gemini 2.0 Flash (**Tier 1** - niet gratis tier)
- **Quiz grootte:** 30-100 vragen
- **AI kosten:** 4-8 batch calls + max 10 escalation calls per quiz
- **Image APIs:**
  - Wikimedia Commons (gratis)
  - Unsplash API (gratis tier)
  - Pexels API (gratis tier)

## Opgeloste Problemen

### v3.3 (behouden in v3.4)
- **imagePolicy="none"** voor grammatica/vertaalvragen
- **Per-question AI escalation** voor moeilijke zoekopdrachten
- **Subject-specific thresholds** voor optimale balans per vak

### v3.4 (nieuw)
- **Abstracte diagrammen** vervangen door echte foto's waar mogelijk
- **Multi-source search** met Unsplash en Pexels als primaire bronnen voor biologie/aardrijkskunde
- **Betere attributie** met source-specific captions

## Conclusie

**v3.4 bereikt ~99.5% success rate** met verbeterde beeldkwaliteit door:
1. **Multi-source search** met Unsplash en Pexels naast Wikimedia Commons
2. **Photo preference** voor biologie en aardrijkskunde (+50 scoring bonus)
3. **Source-based attribution** voor correcte bronvermelding
4. **imagePolicy="none"** voor niet-visuele vragen (grammatica/vertaling)
5. **Per-question AI escalation** voor moeilijke zoekopdrachten

Het systeem is nu productierijp voor alle vier vakken met hogere beeldkwaliteit.
