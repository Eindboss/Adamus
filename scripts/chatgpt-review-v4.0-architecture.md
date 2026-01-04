# ChatGPT Review: Fundamentele Herziening Image Selection Architectuur (v4.0)

## Context

Ik bouw **Adamus**, een educatieve quiz-applicatie voor Nederlandse middelbare scholieren (14-16 jaar). Het doel is om automatisch passende afbeeldingen te selecteren voor quizvragen.

**Huidige situatie:**
- 69% success rate (33/48 vragen krijgen een afbeelding)
- 0% foute afbeeldingen (strikte quality gates werken)
- Maar: 31% van vragen heeft GEEN afbeelding

**De vraag:** Hoe kunnen we de architectuur fundamenteel herzien om zowel **hoge coverage (90%+)** ALS **hoge kwaliteit** te krijgen?

---

## Beschikbare Resources

### 1. APIs en Services

| Service | Type | Limiet | Kosten |
|---------|------|--------|--------|
| **Google Cloud (betaald account)** | Vision AI, Custom Search, Storage | Ruim | Per-call |
| **Gemini 2.0 Flash** | Vision + Text AI | 15 RPM (Tier 1) | Gratis tier |
| **Unsplash** | Stock foto's | 50/uur (demo) | Gratis |
| **Pexels** | Stock foto's | 200/uur | Gratis |
| **Wikimedia Commons** | Educatieve content | Onbeperkt | Gratis |
| **Wikipedia** | Artikelafbeeldingen | Onbeperkt | Gratis |

### 2. Lesmateriaal (Volledig Beschikbaar)

Ik heb **alle 52 pagina's** van het tekstboek gefotografeerd en geïndexeerd:
- **73 begrippen** met NL→EN vertalingen
- Synoniemen, gerelateerde termen
- Sectiereferenties (waar in het boek)
- Visual concepts (welk type afbeelding past)

**Voorbeeld begrippen-index entry:**
```json
{
  "kogelgewricht": {
    "nl": "kogelgewricht",
    "en": ["ball and socket joint", "ball-and-socket joint"],
    "examples": ["heupgewricht", "schoudergewricht"],
    "related": ["gewricht", "beweging"],
    "visualConcepts": ["ball_socket_joint", "hip_joint", "shoulder_joint"],
    "section": "4.3"
  },
  "rsi": {
    "nl": "RSI",
    "en": ["RSI", "repetitive strain injury"],
    "symptoms": ["pijn", "tintelingen", "vermoeidheid"],
    "causes": ["herhaalde beweging", "beeldschermgebruik"],
    "visualConcepts": ["rsi_ergonomics", "computer_posture", "typing"],
    "section": "4.6"
  }
}
```

### 3. Quiz Data Structuur

```json
{
  "id": "q014",
  "type": "multiple_choice",
  "q": "Welk type gewricht is het heupgewricht?",
  "options": ["Kogelgewricht", "Scharniergewricht", "Draaigewricht"],
  "correct": "Kogelgewricht"
}
```

---

## Huidige Architectuur (v3.9)

```
┌─────────────────────────────────────────────────────────────┐
│                    BATCH AI (Gemini)                         │
│  Input: 10 vragen + begrippen context                        │
│  Output: zoektermen, intent, riskProfile per vraag          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              MULTI-SOURCE SEARCH                             │
│  1. Unsplash/Pexels (genormaliseerde queries)               │
│  2. Commons categories                                       │
│  3. Commons text search                                      │
│  4. Wikipedia fallback                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              AI VISION VALIDATION (Gemini)                   │
│  8 hard reject gates:                                        │
│  - Language (NL/EN only)                                     │
│  - Content type (no abstract art)                           │
│  - Concept match                                             │
│  - Human vs animal                                           │
│  - Readability                                               │
│  - Age appropriate                                           │
│  FAIL-CLOSED: geen fallback naar slechte afbeeldingen       │
└─────────────────────────────────────────────────────────────┘
```

### Wat Werkt

| Categorie | Success | Waarom |
|-----------|---------|--------|
| Anatomie (skelet, gewrichten) | 95% | Veel diagrammen beschikbaar op Commons |
| Pinguïn vragen | 100% | Duidelijke zoektermen, veel foto's |
| Fitness foto's (warming-up) | 70% | Stock sites hebben dit |

### Wat Niet Werkt

| Categorie | Success | Waarom |
|-----------|---------|--------|
| Spiercontractie/antagonisten | 20% | Te specifieke diagrammen, weinig beschikbaar |
| RSI/ergonomie | 15% | "RSI" als zoekterm geeft 0 hits |
| Abstracte concepten | 30% | "coördinatie", "motoriek" lastig te visualiseren |

---

## Analyse: Waarom 31% Faalt

### Probleem 1: Zoektermen → 0 Resultaten

De meeste failures zijn **"No candidates found"** - de zoektermen vinden helemaal niets:

```
q022: "muscle contraction diagram human" → 0 hits
q024: "antagonist muscles diagram" → 0 hits
q037: "RSI ergonomics computer" → 0 hits
```

**Root cause:** De concepten zijn te specifiek voor generieke image databases.

### Probleem 2: Beschikbaarheid Gap

Sommige educatieve concepten hebben simpelweg **geen goede afbeeldingen** online:
- Biceps-triceps antagonisme diagram (wel animaties, geen statische diagrammen)
- RSI symptomen (medische databases, niet publiek)
- Spiercontractie microscopisch (research papers, niet Commons)

### Probleem 3: Search vs Browse Mismatch

Onze aanpak is **"search and hope"**:
1. Genereer zoekterm
2. Zoek op meerdere bronnen
3. Hoop dat er iets goeds tussen zit

Maar educatieve content is vaak beter te vinden via **browsen**:
- Commons categorieën (bijv. "Gray's Anatomy plates")
- Wikipedia artikelen met bekende afbeeldingen
- Curated educational image sets

---

## Mogelijke Nieuwe Architecturen

### Optie A: Pre-Curated Image Database

**Concept:** Bouw vooraf een database van goede afbeeldingen per begrip.

```
┌─────────────────────────────────────────────────────────────┐
│           PRE-CURATION FASE (eenmalig per hoofdstuk)        │
│  1. Loop door alle begrippen in index                        │
│  2. Zoek + valideer afbeeldingen per begrip                  │
│  3. Sla goede matches op in database                         │
│  4. Handmatige review voor moeilijke concepten              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│           RUNTIME MATCHING (snel, deterministisch)           │
│  1. Match vraag tegen begrippen                              │
│  2. Haal pre-gecureerde afbeelding op                        │
│  3. Kies beste match (of random uit set)                     │
└─────────────────────────────────────────────────────────────┘
```

**Voordelen:**
- 100% coverage mogelijk (handmatig aanvullen waar nodig)
- Snelle runtime (geen API calls)
- Consistente kwaliteit

**Nadelen:**
- Eenmalige grote investering per hoofdstuk
- Onderhoud bij nieuwe content

### Optie B: Hybrid Search + Curated Fallback

**Concept:** Probeer eerst automatisch, val terug op curated set.

```
┌─────────────────────────────────────────────────────────────┐
│                    TIER 1: Automatisch                       │
│  Huidige v3.9 logica (AI search + validation)               │
│  Success? → Klaar                                            │
└─────────────────────────────────────────────────────────────┘
                              │ Fail
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    TIER 2: Curated Fallback                  │
│  Lookup in pre-built database per begrip                    │
│  "antagonist" → [afbeelding1.png, afbeelding2.png]          │
└─────────────────────────────────────────────────────────────┘
                              │ Fail
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    TIER 3: Generic Fallback                  │
│  Gerelateerd begrip of sectie-afbeelding                    │
│  "spiercontractie" → generic "spier" afbeelding             │
└─────────────────────────────────────────────────────────────┘
```

**Voordelen:**
- Bouwt voort op bestaande code
- Incrementeel verbeterbaar
- Automatisch waar mogelijk, handmatig waar nodig

**Nadelen:**
- Complexere logica
- Nog steeds curatie nodig voor moeilijke begrippen

### Optie C: Wikipedia-First Strategie

**Concept:** Gebruik Wikipedia artikelen als primaire bron.

```
┌─────────────────────────────────────────────────────────────┐
│           BEGRIP → WIKIPEDIA ARTIKEL MAPPING                 │
│  "kogelgewricht" → "Ball-and-socket_joint"                  │
│  "tussenwervelschijf" → "Intervertebral_disc"               │
│  "RSI" → "Repetitive_strain_injury"                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│           WIKIPEDIA API: HAAL ARTIKEL AFBEELDINGEN          │
│  API: action=query&prop=images&titles=Ball-and-socket_joint │
│  Resultaat: alle afbeeldingen in dat artikel                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│           SELECTEER BESTE AFBEELDING                         │
│  - Filter op type (diagram > foto voor anatomie)            │
│  - Filter op taal (EN labels)                                │
│  - AI validation als tiebreaker                              │
└─────────────────────────────────────────────────────────────┘
```

**Voordelen:**
- Wikipedia heeft curated, educatieve afbeeldingen
- Artikelen zijn al georganiseerd per concept
- Betrouwbare bron

**Nadelen:**
- Niet alle concepten hebben Wikipedia artikel
- Nederlandse artikelen hebben minder afbeeldingen
- Lifestyle concepten (RSI, warming-up) minder goed gedekt

### Optie D: Google Custom Search + Vision AI

**Concept:** Gebruik betaalde Google APIs voor betere resultaten.

```
┌─────────────────────────────────────────────────────────────┐
│           GOOGLE CUSTOM SEARCH (betaald)                     │
│  - Configureer search engine voor educatieve sites          │
│  - Zoek met geoptimaliseerde queries                         │
│  - Meer resultaten, betere relevantie                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│           GOOGLE VISION AI (betaald)                         │
│  - Label detection                                           │
│  - Safe search filtering                                     │
│  - Text detection (voor taalcheck)                           │
│  - Sneller en robuuster dan Gemini voor vision               │
└─────────────────────────────────────────────────────────────┘
```

**Voordelen:**
- Betere zoekresultaten
- Snellere, robuustere vision API
- Geen rate limiting problemen

**Nadelen:**
- Kosten per query
- Nog steeds afhankelijk van wat online beschikbaar is

### Optie E: Handmatige Curatie Tool

**Concept:** Bouw een tool om snel afbeeldingen te cureren.

```
┌─────────────────────────────────────────────────────────────┐
│           CURATIE INTERFACE                                  │
│  1. Toon vraag + begrip                                      │
│  2. Toon AI-gesuggereerde afbeeldingen                       │
│  3. Laat gebruiker kiezen of URL invoeren                    │
│  4. Sla keuze op in database                                 │
└─────────────────────────────────────────────────────────────┘
```

**Voordelen:**
- 100% kwaliteitscontrole
- Kan eigen afbeeldingen uploaden
- Eenmalige investering per vraag

**Nadelen:**
- Handmatig werk
- Niet schaalbaar voor duizenden vragen

---

## Specifieke Vragen

### 1. Architectuur Keuze

Welke architectuur raad je aan gegeven:
- 50 quizzen per schooljaar
- 30-100 vragen per quiz
- Beperkt budget maar wel GCS account
- Alle lesinhoud is geïndexeerd

### 2. Pre-Curatie Strategie

Als we kiezen voor pre-curatie:
- Per begrip of per vraag cureren?
- Hoeveel afbeeldingen per begrip (1 of set)?
- Hoe om te gaan met begrippen zonder goede afbeelding?

### 3. Wikipedia Mapping

Voor Wikipedia-first:
- Moet ik handmatig begrip→artikel mapping maken?
- Of kan AI dit afleiden uit de begrippen-index?
- Hoe om te gaan met Nederlandse vs Engelse Wikipedia?

### 4. Fallback Hiërarchie

Wat is de ideale fallback volgorde:
1. Exact begrip match
2. Gerelateerd begrip
3. Sectie-niveau afbeelding
4. Geen afbeelding

### 5. "Geen Afbeelding Nodig" Classificatie

Sommige vragen hebben misschien geen afbeelding nodig:
- Puur tekstvragen ("Wat betekent RSI?")
- Rekenvragen
- Definitievragen

Moet ik dit expliciet markeren in de quiz data?

### 6. Cost-Benefit Analyse

Gegeven:
- ~2500 vragen per jaar (50 quizzen × 50 vragen)
- Google Custom Search: $5 per 1000 queries
- Google Vision AI: $1.50 per 1000 images
- Gemini: gratis (maar rate limited)

Wat is de optimale mix van gratis vs betaald?

---

## Technische Details

### Huidige Tech Stack
- **Runtime:** Node.js
- **Quiz format:** JSON files
- **Image sources:** Unsplash, Pexels, Commons, Wikipedia
- **AI:** Gemini 2.0 Flash (gratis tier)
- **Storage:** Lokale files (kan naar GCS)

### Beschikbare GCS Services
- Cloud Storage (voor afbeeldingen hosten)
- Vision AI (label detection, OCR)
- Custom Search API (betere zoekresultaten)
- Cloud Functions (voor background processing)

### Begrippen Index Structuur

```json
{
  "begrippen": {
    "<key>": {
      "nl": "Nederlandse term",
      "en": ["English term 1", "English term 2"],
      "synonyms": ["synoniem1"],
      "related": ["gerelateerd begrip"],
      "visualConcepts": ["concept1", "concept2"],
      "section": "4.3",
      "wikipediaArticle": "Optional: exact article name"
    }
  }
}
```

---

## Gewenste Output

Graag advies over:

1. **Aanbevolen architectuur** met rationale
2. **Implementatie roadmap** (wat eerst, wat later)
3. **Database schema** voor pre-curatie (indien relevant)
4. **Fallback strategie** voor moeilijke concepten
5. **Kosten schatting** voor verschillende opties
6. **Quick wins** die we nu kunnen implementeren

---

## Bijlage: Gefaalde Vragen Analyse

### Categorie 1: Spierwerking (q022-q026)
```
q022: "Waardoor trekt een spier samen?" → muscle contraction diagram
q023: "Wat gebeurt er als een spier samentrekt?" → sarcomere contraction
q024: "Wat zijn antagonisten?" → antagonist muscles diagram
q025: "Welke spier buigt de arm?" → biceps flexion diagram
q026: "Welke spieren kun je niet bewust aanspannen?" → smooth muscle
```
**Probleem:** Te specifieke diagrammen, weinig publiek beschikbaar.
**Mogelijke oplossing:** Gray's Anatomy plates categorie op Commons, of pre-curatie.

### Categorie 2: RSI/Ergonomie (q037-q042)
```
q037: "RSI ontstaat vooral door..." → RSI causes
q038: "Welke klacht past bij RSI?" → RSI symptoms
q039: "Hoe voorkom je RSI?" → RSI prevention
q041: "Goede zithouding kenmerken" → correct sitting posture
q042: "RSI en telefoongebruik" → phone ergonomics
```
**Probleem:** "RSI" als zoekterm geeft 0 hits op stock sites.
**Mogelijke oplossing:** Zoek op proxy concepts ("office ergonomics", "typing", "posture"), of pre-curatie met stock foto's.

### Categorie 3: Abstracte Concepten (q028-q029)
```
q028: "Wat is motorisch leren?" → motor learning
q029: "Wat is coördinatie?" → coordination
```
**Probleem:** Abstracte concepten zijn lastig te visualiseren.
**Mogelijke oplossing:** Markeer als "geen afbeelding nodig" of gebruik generieke sport/beweging foto.

---

*Document opgesteld voor fundamentele architectuur review*
*Doel: 90%+ coverage met behoud van kwaliteit*
