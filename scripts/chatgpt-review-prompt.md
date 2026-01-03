# ChatGPT Review: AI-Powered Wikimedia Commons Image Selection (v3.3) - Lessons Learned

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor middelbare scholieren. Na vijf iteraties heb ik nu een v3.3 systeem. Dit document beschrijft wat we geleerd hebben.

**Belangrijk:** Ik gebruik Gemini **Tier 1** (niet gratis tier), dus er is meer ruimte voor extra AI calls als dat nodig is.

## Resultaten Vergelijking

| Versie | Biologie | Geschiedenis | Latijn | Aardrijkskunde | Gemiddeld |
|--------|----------|--------------|--------|----------------|-----------|
| v1 | ~50% | - | - | - | ~50% |
| v2 | 75% | - | - | - | 75% |
| v3 | 87.5% | - | - | - | 87.5% |
| v3.1 | 95.8% | 100% | - | - | 97.8% |
| v3.2 | 93.75% | 100% | 83.1% | 98.9% | 92.8% |
| **v3.3** | **100%** | **97.8%** | **100%** | **100%** | **99.5%** |

*v3.3: Latijn 100% = 15 images voor verhalende vragen + 74 grammaticavragen (imagePolicy="none")*
*Aardrijkskunde: H1 100% (49/49) + H2 100% (46/46) = 100% totaal*

## Wat Werkte (v3.3 Verbeteringen)

### 1. imagePolicy="none" voor grammaticavragen
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

### 2. Per-question AI escalation
Bij gefaalde zoekopdrachten wordt een extra AI call gedaan voor creatieve alternatieve queries (max 10 per quiz).

```javascript
const MAX_ESCALATIONS_PER_QUIZ = 10;

async function escalateWithAI(question, subject, chapterContext) {
  // Generates new commonsQueries and categoryHints for failed questions
  // Uses synonyms, alternative terminology, related concepts
}
```

### 3. Subject-specific threshold overrides
Vakspecifieke drempelwaarden voor betere balans tussen kwaliteit en coverage.

```javascript
const SUBJECT_THRESHOLDS = {
  biologie: {
    labeled_diagram: 100,
    concept_diagram: 60, // Lower for abstract concepts
  },
  geschiedenis: {
    historical_illustration: 80, // Higher for better quality
  },
  aardrijkskunde: {
    map: 80, // Higher for legibility
  },
  latijn: {
    historical_illustration: 70,
    photo: 40,
  },
};
```

## Architectuur v3.3

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
│              IMAGE POLICY CHECK (v3.3)                       │
│                                                              │
│  • Latin grammar/translation → imagePolicy="none" (skip)    │
│  • Narrative questions → imagePolicy="required"             │
│  • Other subjects → imagePolicy="required"                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              SEARCH STRATEGY (v3.3)                          │
│                                                              │
│  1. Category search (categoryHints)                          │
│  2. Text search (commonsQueries)                            │
│  3. Negation ladder: retry zonder negaties                   │
│  4. Score candidates met subject-aware scoring               │
│  5. Wikipedia fallback bij lage score                        │
│  6. Broader search als nog steeds te laag                    │
│  7. [NEW] AI escalation bij failure (max 10/quiz)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              DETERMINISTIC SCORING (v3.3)                    │
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

**v3.3 kosten:** Gemini Tier 1
- 4-8 AI calls per ~50 vragen (batches van 12)
- + max 10 escalation calls voor moeilijke vragen
- Tier 1 geeft ruimte voor deze extra calls

## Concrete Successen per Vak

### Biologie (100%)
| Type | Voorbeeld | Score |
|------|-----------|-------|
| Anatomie | Axial skeleton diagram blank.svg | 200 |
| Gewrichten | Ball and Socket Joint (Hip joint).svg | 180 |
| Spieren | Skeletal muscle and fiber.jpg | 170 |
| Concept | Muscle Contraction.svg | 240 |

### Geschiedenis (97.8%)
| Type | Voorbeeld | Score |
|------|-----------|-------|
| Mummificatie | Mummification simple.png | 220 |
| Grieken | Map of Ancient Greece (as drawn in 1903).jpg | 190 |
| Olympische Spelen | Museum of the History of the Ancient Olympic... | 170 |

### Aardrijkskunde (100%)
| Type | Voorbeeld | Score |
|------|-----------|-------|
| Tijdzones | World - time zones map (2014).svg | 220 |
| Coördinaten | Latitude and Longitude of the Earth.svg | 180 |
| Klimaat | Köppen-Geiger Climate Classification Map... | 220 |

### Latijn (100%)
| Type | Resultaat |
|------|-----------|
| Verhalende vragen | 15 images (Romulus, Remus, Vesta, etc.) |
| Grammaticavragen | 74 (imagePolicy="none") |

## Vakken en Toepasbaarheid

| Vak | v3.2 | v3.3 | Verbetering |
|-----|------|------|-------------|
| Biologie | 93.75% | **100%** | Subject-specific thresholds + escalation |
| Geschiedenis | 100% | **97.8%** | 1 edge case |
| Aardrijkskunde | 98.9% | **100%** | Escalation helped |
| Latijn | 83.1% | **100%** | imagePolicy="none" voor grammatica |

*Dit zijn de vier vakken waarvoor afbeeldingen worden gezocht.*

## Technische Context

- **Platform:** Browser-based quiz app (HTML/JS)
- **AI:** Gemini 2.0 Flash (**Tier 1** - niet gratis tier)
- **Quiz grootte:** 30-100 vragen
- **AI kosten:** 4-8 batch calls + max 10 escalation calls per quiz
- **API kosten:** Gratis (Commons/Wikipedia APIs)

## Opgeloste Problemen

### ✅ Probleem 1: Latijn grammatica vragen
**Oplossing:** `imagePolicy="none"` voor grammatica/vertaalvragen. Alleen verhalende vragen krijgen afbeeldingen.

### ✅ Probleem 2: Moeilijke zoekopdrachten
**Oplossing:** Per-question AI escalation genereert creatieve alternatieve queries voor gefaalde vragen.

### ✅ Probleem 3: Suboptimale thresholds
**Oplossing:** Subject-specific threshold overrides voor betere balans per vak.

## Conclusie

**v3.3 bereikt ~99.5% success rate** door:
1. **imagePolicy="none"** voor niet-visuele vragen (grammatica/vertaling)
2. **Per-question AI escalation** voor moeilijke zoekopdrachten
3. **Subject-specific thresholds** voor optimale balans per vak

Het systeem is nu productierijp voor alle vier vakken.
