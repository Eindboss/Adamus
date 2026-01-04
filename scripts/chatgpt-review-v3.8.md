# ChatGPT Review: AI-Powered Image Selection (v3.8) - Lesstof Indexering

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor Nederlandse middelbare scholieren (14-16 jaar). Na v3.7 heb ik nu de **volledige lesstof geïndexeerd** door alle 52 pagina's van het tekstboek te lezen en een begrippen-index te maken. Dit document vraagt om advies hoe we deze index kunnen integreren.

**Gemini Tier:** Tier 1 (strikte rate limits: ~15 RPM)

---

## v3.7 Testresultaten (Biologie Quiz - 50 vragen)

### Samenvatting
- **33/48 vragen** succesvol (69% success rate)
- **15 vragen** zonder afbeelding (FAIL-CLOSED)
- **0 foute afbeeldingen** geaccepteerd (gates werken!)
- **68 vision validaties** (was ~144 in v3.6)
- **21 cache hits** (vision cache werkt)
- **3 rate limits** (graceful handling met 65s cooldown)

### Wat v3.7 goed doet:
- TokenBucketLimiter voorkomt de meeste 429 errors
- Vision cache reduceert duplicate API calls
- Auto-accept voor hoge scores (10 vragen)
- FAIL-CLOSED verwijdert oude slechte afbeeldingen

### Wat v3.7 NIET goed doet:
De **gefaalde vragen** zijn bijna allemaal van dezelfde categorieën:

| Categorie | Gefaald | Voorbeeld zoektermen |
|-----------|---------|---------------------|
| RSI/Ergonomie | q037-q042 | "RSI symptoms human", "ergonomics mobile phone" |
| Warming-up/Cooling-down | q031, q034 | "warming up exercise human", "cooling down exercise" |
| Spierpijn/Blessures | q035, q036 | "muscle soreness diagram", "sports injury human" |
| Pinguïn anatomie | q045, q046 | "penguin wing anatomy diagram", "penguin skeleton keel" |
| Kraakbeen | q003, q005 | "cartilage human anatomy", "bone composition" |

**Kernprobleem:** De AI genereert **generieke Engelse zoektermen** zonder kennis van de specifieke lesinhoud.

---

## Nieuwe Asset: Begrippen-Index (h4-begrippen-index.json)

Ik heb nu een **volledige begrippen-index** gemaakt door alle 52 pagina's van het tekstboek te lezen:

### Structuur:
```json
{
  "begrippen": {
    "tussenwervelschijf": {
      "nl": "tussenwervelschijf",
      "en": ["intervertebral disc", "spinal disc"],
      "related": ["wervelkolom", "wervels", "hernia"],
      "visualConcepts": ["intervertebral_disc", "spinal_disc_diagram"],
      "section": "4.5"
    },
    "rsi": {
      "nl": "RSI",
      "en": ["RSI", "repetitive strain injury"],
      "symptoms": ["pijn", "tintelingen", "vermoeidheid"],
      "causes": ["herhaalde beweging", "beeldschermgebruik", "telefoon"],
      "visualConcepts": ["rsi_ergonomics", "computer_posture", "typing"],
      "section": "4.6"
    },
    "pinguin": {
      "nl": "pinguïn",
      "en": ["penguin"],
      "species": "Adéliepinguïn",
      "anatomy": ["kiel", "vleugels", "zwemmen", "lopen"],
      "visualConcepts": ["penguin", "penguin_skeleton", "penguin_swimming"],
      "section": "extra"
    }
  },
  "visualTypes": {
    "skeleton_diagram": {
      "searchTerms": ["human skeleton diagram labeled", "skeleton anatomy chart"]
    },
    "ball_socket_joint": {
      "searchTerms": ["ball and socket joint diagram", "hip joint anatomy"]
    }
  }
}
```

### Wat de index bevat:
- **75+ begrippen** met Nederlandse en Engelse termen
- **Synoniemen** (bijv. "geraamte" voor "skelet")
- **Gerelateerde termen** voor context
- **Visual concepts** (welk type afbeelding past)
- **Sectie referenties** (waar in het hoofdstuk)
- **Pre-defined search terms** voor moeilijke concepten

---

## Voorgestelde Integratie Strategie

### Optie A: Keyword Enrichment
Bij het genereren van zoektermen:
1. Extract Nederlandse keywords uit de vraag
2. Match tegen begrippen-index
3. Gebruik de Engelse vertalingen + visualConcepts als zoektermen

**Voorbeeld:**
```
Vraag: "Wat is de functie van de tussenwervelschijf?"
Huidige: "intervertebral disc function diagram"
Met index: "intervertebral disc anatomy diagram" + "spinal disc cross section"
```

### Optie B: Fallback Search Terms
Als de AI geen resultaten vindt:
1. Check of vraag begrippen uit de index bevat
2. Gebruik pre-defined searchTerms uit visualTypes

**Voorbeeld:**
```
Vraag over RSI → index lookup → ["RSI ergonomics", "computer posture", "typing"]
```

### Optie C: Context Injection
Geef de AI extra context in de batch prompt:
```
For this chapter (Stevigheid en beweging), key concepts include:
- tussenwervelschijf → "intervertebral disc", "spinal disc"
- kogelgewricht → "ball and socket joint"
- RSI → "repetitive strain injury", "ergonomics"
```

---

## Specifieke Probleemvragen Analyse

### q037-q042: RSI/Ergonomie cluster
**Huidige zoektermen:**
- "RSI symptoms human"
- "ergonomics mobile phone use"
- "computer break exercise"

**Probleem:** Commons heeft weinig RSI-specifieke content.

**Mogelijke oplossing met index:**
```json
"rsi": {
  "en": ["RSI", "repetitive strain injury"],
  "visualConcepts": ["rsi_ergonomics", "computer_posture", "typing"],
  "alternativeSearches": [
    "office ergonomics diagram",
    "correct sitting posture computer",
    "wrist pain typing"
  ]
}
```

### q045-q046: Pinguïn anatomie
**Huidige zoektermen:**
- "penguin wing anatomy diagram"
- "penguin skeleton keel"

**Probleem:** Weinig gelabelde pinguïn anatomie diagrammen beschikbaar.

**Mogelijke oplossing:**
- Accept foto van pinguïn (lager risico)
- Of zoek "bird skeleton keel" (algemener)

### q003, q005: Kraakbeen/Botsamenstelling
**Huidige zoektermen:**
- "bone composition diagram hardness"
- "cartilage human anatomy"

**Probleem:** Abstracte concepten, moeilijk te visualiseren.

**Mogelijke oplossing:**
- Verlaag minScore voor deze categorieën
- Of markeer als "no image needed"

---

## Vragen aan ChatGPT

### 1. Integratie Aanpak
Welke van de drie opties (A/B/C) zou je aanraden, of een combinatie?

**Trade-offs:**
- A (Keyword Enrichment): Meest impact, maar vereist prompt wijziging
- B (Fallback): Minder invasief, maar alleen voor failures
- C (Context Injection): Simpelst, maar verhoogt token usage

### 2. Implementatie in Batch Prompt
Hoe zou je de begrippen-index integreren in de bestaande batch prompt?

**Huidige batch prompt structuur:**
```
For each question, generate search terms...
Expected concepts: {expectedConcepts from CONCEPT_VOCABULARY}
```

**Vraag:** Moet de index direct in de prompt, of als aparte lookup stap?

### 3. Fallback Strategie voor Moeilijke Concepten
Sommige concepten (RSI, warming-up, cooling-down) hebben weinig goede afbeeldingen beschikbaar.

**Opties:**
- A) Accept lower quality images (verlaag minScore)
- B) Accept related concepts (RSI → computer/typing foto)
- C) Mark as "no image needed" in quiz data
- D) Use stock photo sites meer (Unsplash/Pexels)

### 4. Anatomie Fallbacks
Voor anatomie vragen die falen (pinguïn kiel, kraakbeen):

**Opties:**
- A) Zoek op algemener concept ("bird skeleton" i.p.v. "penguin skeleton")
- B) Accept foto i.p.v. diagram
- C) Pre-populate met handmatig geselecteerde afbeeldingen

### 5. Prompt Engineering
Gegeven de begrippen-index, hoe zou je de AI prompt aanpassen om betere zoektermen te genereren?

**Specifiek:**
- Moet de hele index in de prompt?
- Of alleen relevante begrippen per batch?
- Hoe voorkom je dat de prompt te lang wordt?

---

## Technische Context

- **Platform:** Browser-based quiz app (HTML/JS)
- **Doelgroep:** Nederlandse middelbare scholieren (14-16 jaar)
- **AI:** Gemini 2.0 Flash Exp (Tier 1 - 15 RPM limit)
- **Quiz grootte:** 30-100 vragen per quiz
- **Begrippen-index:** ~75 entries, ~15KB JSON

## Huidige Success Rate Breakdown

| Categorie | Succes | Gefaald | Rate |
|-----------|--------|---------|------|
| Skelet anatomie | 10/10 | 0 | 100% |
| Gewrichten | 8/8 | 0 | 100% |
| Spieren | 7/8 | 1 | 88% |
| Wervelkolom | 4/4 | 0 | 100% |
| RSI/Ergonomie | 1/7 | 6 | 14% |
| Beweging/Training | 3/7 | 4 | 43% |
| Pinguïn | 2/4 | 2 | 50% |
| Botten samenstelling | 1/3 | 2 | 33% |

---

## Gewenste Verbeteringen voor v3.8

1. **Begrippen-index integratie** - Betere zoektermen door kennis van lesinhoud
2. **Fallback search terms** - Pre-defined searches voor moeilijke concepten
3. **Category-aware minScore** - Lagere drempel voor abstracte concepten
4. **Improved photo acceptance** - Foto's als fallback voor diagrammen

Graag feedback op:
1. Beste integratie aanpak
2. Prompt engineering suggesties
3. Fallback strategieën voor moeilijke concepten
4. Trade-offs die ik moet overwegen
