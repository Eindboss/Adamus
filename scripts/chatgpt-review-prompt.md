# ChatGPT Review: AI-Powered Wikimedia Commons Image Selection (v3.2) - Lessons Learned

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor middelbare scholieren. Na vier iteraties heb ik nu een v3.2 systeem. Dit document beschrijft wat we geleerd hebben.

**Belangrijk:** Ik gebruik Gemini **Tier 1** (niet gratis tier), dus er is meer ruimte voor extra AI calls als dat nodig is.

## Resultaten Vergelijking

| Versie | Biologie | Geschiedenis | Latijn | Aardrijkskunde | Gemiddeld |
|--------|----------|--------------|--------|----------------|-----------|
| v1 | ~50% | - | - | - | ~50% |
| v2 | 75% | - | - | - | 75% |
| v3 | 87.5% | - | - | - | 87.5% |
| v3.1 | 95.8% | 100% | - | - | 97.8% |
| **v3.2** | **93.75%** | **100%** | **83.1%** | **98.9%** | **92.8%** |

*Aardrijkskunde: H1 100% (49/49) + H2 97.8% (45/46) = 98.9% totaal*
*Note: v3.2 heeft lagere biologie score door hogere MIN_ACCEPT_SCORE thresholds voor betere kwaliteit.*

## Wat Werkte (v3.2 Verbeteringen)

### 1. Subject profiles (vakprofielen)
Per-vak defaults voor intent, categoryHints en riskProfile.

```javascript
const SUBJECT_PROFILES = {
  biologie: {
    defaultIntent: 'labeled_diagram',
    categoryHints: ['Gray\'s Anatomy plates', 'Human anatomy diagrams', ...],
    riskProfile: 'human_vs_animal',
  },
  geschiedenis: {
    defaultIntent: 'historical_illustration',
    categoryHints: ['Historical maps', 'Ancient Rome', 'Ancient Greece', ...],
    riskProfile: 'historical_vs_modern',
  },
  aardrijkskunde: {
    defaultIntent: 'map',
    categoryHints: ['Physical maps', 'Thematic maps', 'Climate diagrams', ...],
    riskProfile: 'thematic_vs_tourist',
  },
  latijn: {
    defaultIntent: 'historical_illustration',
    categoryHints: ['Ancient Rome', 'Roman mythology', 'Roman mosaics', ...],
    riskProfile: 'mythology_vs_popculture',
  },
};
```

### 2. concept_diagram intent voor abstracte concepten
Nieuwe intent voor reflexen, homeostase, coördinatie, etc.

```javascript
const CONCEPT_DIAGRAM_TOKENS = ['schematic', 'flowchart', 'pathway', 'cycle', 'model',
  'infographic', 'process', 'mechanism', 'regulation', 'feedback'];

const ABSTRACT_CONCEPT_KEYWORDS = ['coördinatie', 'coordination', 'rusttoestand', 'reflex',
  'regeling', 'homeostase', 'homeostasis', 'prikkel', 'stimulus', ...];
```

### 3. Nieuwe riskProfiles
- `thematic_vs_tourist` - penaliseert metro/subway/tourist maps
- `mythology_vs_popculture` - penaliseert Disney/Marvel/games/films

### 4. Educational quality scoring
```javascript
const EDUCATIONAL_TOKENS = ['identification', 'field guide', 'distribution', 'range map',
  'habitat', 'taxonomy', 'specimen', 'labeled', 'annotated', 'educational', 'textbook'];

const STOCK_TOKENS = ['shutterstock', 'getty', 'istock', 'stock photo', ...];
const POPCULTURE_TOKENS = ['disney', 'marvel', 'game', 'movie', 'film', 'lego', 'toy', ...];
```

### 5. Map legibility bonus
Grotere kaarten (width >= 1200) krijgen +20, kleinere (< 800) krijgen -20.

### 6. Hogere MIN_ACCEPT_SCORE thresholds
```javascript
const MIN_ACCEPT_SCORE = {
  labeled_diagram: 100,  // was 80
  diagram: 70,           // was 60
  concept_diagram: 70,
  photo: 35,            // was 30
  map: 70,              // was 50
  historical_illustration: 70,  // was 50
  micrograph: 70,
  default: 35,
};
```

## Wat Nog Niet Werkt

### Probleem 1: Latijn grammatica vragen (15/89 = 16.9% gefaald)
Vragen over Latijnse grammatica (verbuigingen, vervoegingen, woordsoorten) hebben vaak geen geschikte afbeeldingen op Commons.

**Gefaalde vragen:**
- q028, q031, q034-q037: Grammaticavragen over accusatief, datief, etc.
- q051-q053, q059-q060, q071, q074, q076-q077: Verbuigings/vervoegingsvragen

**Mogelijke oplossing:**
- Voor grammaticavragen: Wikipedia fallback naar artikelen over Latijnse grammatica
- Of: Accepteren dat sommige taalkundige vragen geen afbeelding nodig hebben

### Probleem 2: Biologie abstracte concepten (3/48 = 6.25%)
Ondanks concept_diagram intent, blijven sommige abstracte vragen lastig.

## Architectuur v3.2

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
│              SEARCH STRATEGY (v3.2)                          │
│                                                              │
│  1. Category search (categoryHints)                          │
│  2. Text search (commonsQueries)                            │
│  3. Negation ladder: retry zonder negaties                   │
│  4. Score candidates met subject-aware scoring               │
│  5. Wikipedia fallback bij lage score                        │
│  6. Broader search als nog steeds te laag                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              DETERMINISTIC SCORING (v3.2)                    │
│                                                              │
│  BONUSSEN:                                                   │
│  • Category match + topic: +60, zonder: +20                 │
│  • Good category + topic: +30, zonder: +10                   │
│  • SVG format: +20 extra                                     │
│  • Concept diagram signals: +40                              │
│  • Map legibility (width >= 1200): +20                       │
│  • Educational tokens: +20                                   │
│  • Ancient/Roman/Mosaic (latijn): +30                        │
│                                                              │
│  PENALTIES:                                                  │
│  • Animal token bij human_vs_animal: -80                     │
│  • Modern indicator bij historical: -50                      │
│  • Stock photo tokens: -80                                   │
│  • Popculture tokens: -40 (global), -80 (latijn)            │
│  • Tourist map tokens: -60                                   │
│  • Concept diagram zonder teaching signals: -60              │
│  • Map te klein (< 800): -20                                 │
│  • Reeds gebruikt: -1000                                     │
└─────────────────────────────────────────────────────────────┘
```

## Kosten

**v3.2 kosten:** Gemini Tier 1
- 4-8 AI calls per ~50 vragen (batches van 12)
- Tier 1 geeft meer ruimte voor retries en extra calls
- Mogelijkheid voor per-question AI calls bij moeilijke vragen

## Concrete Successen per Vak

### Biologie (93.75%)
| Type | Voorbeeld | Score |
|------|-----------|-------|
| Anatomie | Human arm bones diagram-es.svg | 220 |
| Gewrichten | Ball and Socket Joint (Hip joint).svg | 230 |
| Spieren | Skeletal muscle and fiber.jpg | 160 |

### Geschiedenis (100%)
| Type | Voorbeeld | Score |
|------|-----------|-------|
| Mummificatie | Diagram showing method of packing for mummifi... | 290 |
| Grieken | Ancient Egypt. Mummy of woman from Thebes... | 260 |
| Mythologie | A Short Depiction of King Midas... | 240 |

### Aardrijkskunde (100%)
| Type | Voorbeeld | Score |
|------|-----------|-------|
| Tijdzones | World - time zones map (2014).svg | 250 |
| Coördinaten | Latitude and Longitude of the Earth.svg | 180 |
| Bevolking | Russia Population Density Map 2021.png | 240 |

### Latijn (83.1%)
| Type | Voorbeeld | Score |
|------|-----------|-------|
| Romulus/Remus | Maria Saal Dom Grabrelief Romulus und Remus... | 230 |
| Vestaalse maagd | Virgo Vestalis (Musgrave).jpg | 230 |
| Slavernij | Jean-Léon Gérôme - A Roman Slave Market... | 180 |

## Vakken en Toepasbaarheid

| Vak | v3.1 | v3.2 | Probleem |
|-----|------|------|----------|
| Biologie | 95.8% | **93.75%** | Hogere thresholds, minder false positives |
| Geschiedenis | 100% | **100%** | Werkt uitstekend |
| Aardrijkskunde | - | **100%** | thematic_vs_tourist effectief |
| Latijn | - | **83.1%** | Grammaticavragen hebben geen afbeeldingen |

*Dit zijn de vier vakken waarvoor afbeeldingen worden gezocht.*

## Technische Context

- **Platform:** Browser-based quiz app (HTML/JS)
- **AI:** Gemini 2.0 Flash (**Tier 1** - niet gratis tier)
- **Quiz grootte:** 30-100 vragen
- **AI kosten:** 4-8 calls per ~50 vragen (batches van 12)
- **API kosten:** Gratis (Commons/Wikipedia APIs)

## Vragen voor Verdere Optimalisatie

1. **Latijn grammatica:** Moeten we voor grammaticavragen een "no_image_needed" flag toevoegen? Of een speciale grammatica-diagram generator?

2. **Per-question AI calls:** Met Tier 1 budget, is het zinvol om voor gefaalde vragen een extra dedicated AI call te doen?

3. **Semantic similarity:** Kunnen we embedding-based matching toevoegen om betere afbeeldingen te vinden voor abstracte concepten?

4. **Score thresholds:** De hogere thresholds geven betere kwaliteit maar lagere coverage. Wat is de optimale balans?

## Conclusie

**Grootste winst v3.2:** Subject profiles en nieuwe riskProfiles maakten aardrijkskunde (100%) en latijn (83.1%) mogelijk zonder handmatige configuratie.

**Resterende uitdaging:** Latijn grammaticavragen (17%) hebben geen geschikte afbeeldingen op Commons. Dit is mogelijk inherent aan het probleem - niet elke vraag heeft een afbeelding nodig.

**Tier 1 mogelijkheden:** Met Tier 1 budget kunnen we overwegen:
- Extra AI call voor gefaalde vragen
- Langere/rijkere prompts
- Semantic search met embeddings
