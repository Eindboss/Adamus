# ChatGPT Review: AI-Powered Image Selection (v3.6) - Testresultaten

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor Nederlandse middelbare scholieren (14-16 jaar). Na de v3.5 review heb ik v3.6 geïmplementeerd met alle ChatGPT aanbevelingen. Dit document beschrijft de nieuwe resultaten en vraagt om verdere feedback.

**Gemini Tier:** Tier 1 (niet gratis tier, maar nog steeds strikte rate limits: ~15 RPM)

## v3.6 Geïmplementeerde Verbeteringen

### Wat is gebouwd (op basis van vorige ChatGPT review):

1. **CONCEPT VOCABULARY**: 50+ biologie termen met expectedConcept/allowedConcepts
   ```javascript
   skelet: { expectedConcept: 'skeleton', allowedConcepts: ['skeleton', 'bone', 'skull', 'spine', ...] }
   collageen: { expectedConcept: 'collagen', allowedConcepts: ['collagen', 'bone_tissue', 'connective_tissue', 'fibers'] }
   rsi: { expectedConcept: 'rsi', allowedConcepts: ['rsi', 'repetitive_strain', 'ergonomics', 'wrist', 'posture'] }
   ```

2. **LANGUAGE GATE**: Hard reject voor non-NL/EN tekst
   - **Werkt!** Voorbeeld: `[AI:REJECT:Non-NL/EN text detec]`

3. **CONTENT-TYPE GATE**: Reject abstract_art, network_graph, table_wordlist, food_drink, etc.
   - **Werkt!** Voorbeeld: `[AI:REJECT:Banned content type:]`

4. **CONCEPT MATCHING**: Vergelijk predicted_concept met allowedConcepts
   - **Werkt!** Voorbeeld: `[AI:REJECT:Concept mismatch: ex]`

5. **FAIL-CLOSED FALLBACK**: Geen afbeelding is beter dan een foute
   - **Werkt!** Voorbeeld: `[FAIL-CLOSED: all 5 candidates rejected]`

6. **CANONICAL DEDUP**: Via pageid/title in plaats van URL
   - Geen duplicaten meer!

7. **8 HARD REJECT GATES** in de vision prompt:
   - Language, Content-type, Concept match, Human vs Animal, Diagram intent, Readability, Age-appropriate, Explicit reject

## v3.6 Testresultaten (Biologie Quiz - 50 vragen)

### Samenvatting
- **32/48 vragen** geselecteerd (67% success rate)
- **16 vragen** zonder afbeelding (FAIL-CLOSED of rate limit errors)
- **0 foute afbeeldingen** geaccepteerd (gates werken!)

### Vergelijking v3.5 vs v3.6

| Metric | v3.5 | v3.6 |
|--------|------|------|
| Success rate | 98% | 67% |
| Foute afbeeldingen | 46% (23/50) | 0% |
| Taalfouten (PL/UK/LT) | 4+ | 0 (rejected) |
| Irrelevante afbeeldingen | 10+ | 0 (rejected) |
| Duplicaten | 2 paar | 0 |

### Wat nu GOED werkt:

✅ **Taalcontrole**: Pools/Oekraïens/Litouws wordt afgewezen
✅ **Concept matching**: Geen "borstklier voor skelet vraag" meer
✅ **Content-type filtering**: Geen abstracte kunst of soep meer
✅ **Fail-closed**: Geen foute fallback-afbeeldingen
✅ **Deduplicatie**: Elke vraag krijgt unieke afbeelding

### Problemen die nog bestaan:

#### Probleem 1: Rate Limiting (KRITIEK - 429 errors)
```
[AI validation error: 429]
[AI:REJECT:API error: 429]
[gemini] Rate limited, waiting 3s before retry...
```

**Huidige configuratie:**
- VISION_DELAY = 500ms tussen validaties
- BATCH_DELAY = 5000ms tussen batches
- BATCH_SIZE = 10 vragen per batch
- MAX_CANDIDATES = 5 per vraag

**Impact:** ~30% van vragen faalt puur door rate limits, niet door kwaliteit.

**Berekening:**
- 48 vragen × gemiddeld 3 validaties = 144 vision calls
- Gemini Tier 1 = ~15 requests per minuut
- 144 calls / 15 RPM = 9.6 minuten minimum
- Huidige runtime: ~5 minuten → veel 429 errors

#### Probleem 2: Image Download Failures (~25% van kandidaten)
```
[AI:REJECT:Could not download i]
```

**Oorzaken:**
- Wikimedia Commons thumburl format issues
- Unsplash/Pexels CDN blocks of timeouts
- Sommige URLs zijn 404 of redirect loops

**Huidige mitigatie:**
- 10s timeout
- User-Agent header toegevoegd
- `redirect: 'follow'` enabled

#### Probleem 3: Lage Success Rate door Strikte Gates
- 67% success is lager dan gewenst
- Maar: 0% fouten is beter dan v3.5's 46% fouten
- **Trade-off**: Kwaliteit vs Kwantiteit

## Voorbeelden van Output

### Goede selecties:
```
q001: Human skeleton front en.svg ✓ (skelet vraag → skelet diagram, score 247)
q002: Human skeleton back en.svg ✓ (romp vraag → skelet diagram, score 275)
q014: Ball and Socket Joint.svg ✓ (gewricht vraag → gewricht diagram, score 275)
q043: Penguin swimming ✓ (pinguïn vraag → pinguïn foto, score 185)
```

### Correct afgewezen:
```
q005: [AI:REJECT:Non-NL/EN text detec] - Poolse labels
q029: [AI:REJECT:Banned content type:] - Abstracte kunst
q012: [AI:REJECT:Concept mismatch: ex] - Verkeerd anatomisch onderdeel
```

### Rate limit failures:
```
q007: [AI validation error: 429] × 5 → [FAIL-CLOSED]
q016: Alle 5 kandidaten 429 error → geen afbeelding
q020: Rate limited na 2 kandidaten → geen afbeelding
```

## Technische Architectuur v3.6

```
┌─────────────────────────────────────────────────────────────┐
│                    BATCH AI (10 vragen)                      │
│  → Genereert zoektermen + expectedConcept/allowedConcepts   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              MULTI-SOURCE SEARCH                             │
│  → Unsplash, Pexels, Commons, Wikipedia                     │
│  → Canonical dedup via pageid/title                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              AI VISION VALIDATION (v3.6)                     │
│                                                              │
│  8 SEQUENTIAL HARD REJECT GATES:                            │
│  1. Language Gate (non-NL/EN → reject)                      │
│  2. Content-Type Gate (abstract_art → reject)               │
│  3. Concept Match Gate (skeleton ≠ breast → reject)         │
│  4. Human vs Animal Gate                                    │
│  5. Diagram Intent Gate                                     │
│  6. Readability Gate                                        │
│  7. Age-Appropriate Gate                                    │
│  8. Explicit AI Reject Gate                                 │
│                                                              │
│  FAIL-CLOSED: All candidates rejected → return null         │
└─────────────────────────────────────────────────────────────┘
```

## Vragen aan ChatGPT voor v3.7

### 1. Rate Limiting Strategie (PRIORITEIT 1)

**Probleem:** 144 vision calls, 15 RPM limit = 9.6 min minimum, maar script draait 5 min.

**Opties:**
- A) Langere delays (VISION_DELAY = 1000ms, BATCH_DELAY = 10s)
- B) Minder kandidaten valideren (top 2 i.p.v. top 5)
- C) Betere pre-filtering zodat minder kandidaten nodig zijn
- D) Queue systeem met automatic retry
- E) Caching van eerder gevalideerde images

**Vraag:** Welke combinatie zou je aanraden? Is 1 kandidaat valideren met strengere pre-filtering beter dan 5 kandidaten met losse pre-filtering?

### 2. Image Download Optimalisatie (PRIORITEIT 2)

**Probleem:** ~25% van kandidaten faalt op download.

**Opties:**
- A) Probeer originele URL als thumburl faalt
- B) Pre-flight HEAD request om dode URLs te skippen
- C) Parallelle downloads met race condition (eerste die werkt)
- D) Fallback naar andere resolutie (800px → 1200px → original)

**Vraag:** Wat is de beste strategie om download success rate te verhogen?

### 3. Success Rate vs Kwaliteit Trade-off

**Huidige situatie:**
- v3.5: 98% success, 46% fouten
- v3.6: 67% success, 0% fouten

**Vraag:** Is 67% acceptabel? Of moet ik gates versoepelen met risico op meer fouten?

**Optie:** Tiered approach:
1. Eerst strikt valideren
2. Als geen match: versoepel 1-2 gates
3. Als nog geen match: FAIL-CLOSED

### 4. Caching Strategie

**Idee:** Sla validatieresultaten op per image URL.

**Vragen:**
- Hoe lang is cache geldig?
- Moet ik ook "slechte" URLs cachen?
- Bestandsformaat: JSON file? SQLite?

### 5. Batch vs Per-Question AI

**Huidige flow:**
1. Batch AI genereert zoektermen voor 10 vragen tegelijk
2. Per vraag: search + validate

**Alternatief:**
1. Batch AI genereert zoektermen + valideert eerste kandidaat direct
2. Alleen escaleren als nodig

**Vraag:** Is dit efficiënter qua API calls?

## Technische Context

- **Platform:** Browser-based quiz app (HTML/JS)
- **Doelgroep:** Nederlandse middelbare scholieren (14-16 jaar)
- **AI:** Gemini 2.0 Flash Exp (**Tier 1** - 15 RPM limit)
- **Vision API:** Gemini inline_data met base64 images
- **Quiz grootte:** 30-100 vragen
- **Huidige runtime:** ~5 minuten voor 50 vragen

## Gewenste Verbeteringen voor v3.7

1. **Rate limit optimization** - Minder calls met betere pre-filtering
2. **Download reliability** - Fallback URLs en pre-flight checks
3. **Caching** - Validatieresultaten opslaan
4. **Tiered validation** - Strikt → versoepeld → fail-closed

Graag feedback op:
1. Prioriteit van verbeteringen
2. Specifieke implementatie-suggesties
3. Trade-offs die ik moet overwegen
