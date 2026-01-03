# ChatGPT Review: AI-Powered Image Selection (v3.5) - Testresultaten

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor middelbare scholieren. Na zeven iteraties heb ik nu een v3.5 systeem getest. Dit document beschrijft de resultaten en vraagt om feedback.

**Belangrijk:** Ik gebruik Gemini **Tier 1** (niet gratis tier), dus er is meer ruimte voor extra AI calls als dat nodig is.

## v3.5 Testresultaten (Biologie Quiz - 50 vragen)

### Samenvatting
- **47/48 vragen verwerkt** (98% success rate)
- **1 vraag gefaald** (q046 - geen geschikte afbeelding gevonden)
- Veel vragen vonden pas bij kandidaat 4 of 5 een valide afbeelding

### Positieve Resultaten

| Vraag | AI Detectie | Afbeelding | Opmerking |
|-------|-------------|------------|-----------|
| q002 | `AI:90✓ human` | Human skeleton (svg template).svg | Correct menselijk skelet |
| q006 | `AI:95✓ human` | Fontanelle-dt.JPG | Fontanel baby correct |
| q021 | `AI:90✓ human` | Hand bones numbered.png | Handbotten correct |
| q043 | `AI:90✓ animal` | Zoo photography - penguin swimming | Correct dier voor pinguïnvraag |
| q044 | `AI:85✓ animal` | Adelie penguin walking | Correct voor pinguïnvraag |
| q030 | `AI:90✓ human` | Couple jogging together (Unsplash) | Unsplash integratie werkt |

### Escalation Successen
De top 3 → top 5 escalation werkt:
- **q005**: v1-v3 gefaald, **v4 succesvol** (Gray859.png)
- **q012**: v1-v3 gefaald, **v4 succesvol** (Muscular tissue on a joint)
- **q014**: v1-v3 gefaald, **v5 succesvol** (Bursae shoulder joint)
- **q026**: v1-v3 gefaald, **v4 succesvol** (Autonomic Nervous System)

### Problemen Geïdentificeerd

#### 1. Rate Limiting (429 errors)
```
q048: [AI validation error: 429] [AI validation error: 429] [AI validation error: 429]
```
Te veel API calls in korte tijd. Huidige delay is 200ms tussen validaties.

#### 2. Fallback op Text-Score bij AI Falen
Sommige vragen falen ALLE 5 AI validaties maar worden toch geselecteerd op text-score:

| Vraag | AI Resultaten | Geselecteerde Afbeelding | Probleem |
|-------|---------------|--------------------------|----------|
| q007 | v1-v5 allemaal 0-40 score | "Ancient Meitei character HOOK" | Volledig verkeerde afbeelding |
| q008 | v1-v5 allemaal 0-40 score | "Joint with deposits of urate of soda" | Medisch correct maar onduidelijk |
| q010 | v1-v5 allemaal 0 score | "collagen bone broth.jpg" | Eten in plaats van anatomie |
| q023 | v1-v4 allemaal 0 score | "AI illustration" | Generieke AI kunst |

#### 3. Labeled Diagram Intent Te Streng
q046 gefaald omdat `intent=labeled_diagram` alles afwees:
```
q046: [AI:REJECT:Image type photo, no] [AI:REJECT:Image type photo, no] [AI:REJECT:Image type photo, no]
```
De vraag vereiste een gelabeld diagram maar alle kandidaten waren foto's.

#### 4. "Unknown" Detected Subject
Bij veel diagrammen geeft AI `detected_subject: unknown` omdat het geen persoon/dier is, maar een schematische tekening.

## Huidige Architectuur v3.5

```
┌─────────────────────────────────────────────────────────────┐
│                    BATCH AI (12 vragen)                      │
│  → Genereert zoektermen, categoryHints, riskProfile, etc.   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              MULTI-SOURCE SEARCH (v3.4)                      │
│  → Unsplash, Pexels, Commons, Wikipedia                     │
│  → Text-based scoring van kandidaten                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              AI VISION VALIDATION (v3.5)                     │
│                                                              │
│  Phase 1: Valideer top 3 kandidaten                         │
│  Phase 2: Escalate naar top 5 als geen valide gevonden     │
│                                                              │
│  Per kandidaat:                                             │
│  1. Download afbeelding als base64                          │
│  2. Stuur naar Gemini met vraagcontext                      │
│  3. Gemini BEKIJKT de afbeelding en beoordeelt:            │
│     - observations: wat zie je?                             │
│     - detected_subject: human/animal/mixed/unknown         │
│     - image_type: photo/diagram/labeled_diagram/etc.       │
│     - readability: good/ok/poor                            │
│     - score: 0-100                                         │
│  4. Hard reject rules:                                      │
│     - human_vs_animal risk + niet human → reject           │
│     - labeled_diagram intent + niet diagram → reject       │
│     - poor readability → reject                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              FALLBACK (als alle AI validaties falen)        │
│                                                              │
│  → Selecteer beste kandidaat op text-score                  │
│  → Markeer met _aiValidationFailed = true                   │
│  [PROBLEEM: Dit levert soms slechte afbeeldingen op]       │
└─────────────────────────────────────────────────────────────┘
```

## Intent-Specifieke Thresholds

```javascript
const MIN_AI_SCORE_BY_INTENT = {
  labeled_diagram: 75,  // Streng voor anatomische diagrammen
  diagram: 70,
  concept_diagram: 65,
  map: 70,
  historical_illustration: 70,
  micrograph: 65,
  photo: 60,
  default: 60,
};
```

## Validation Prompt (huidige versie)

```javascript
const prompt = `Je bent een strenge beoordelaar van educatieve afbeeldingen.

VAK: ${subject}
VRAAG: ${questionText}
INTENT: ${intent}
TOPIC KEYWORDS: ${topicKeywordsStr}
RISK PROFILE: ${riskProfile}

HARD REJECT RULES:
- Als RISK PROFILE = human_vs_animal: als je GEEN mens ziet → valid=false.
- Als INTENT = labeled_diagram: als het geen (gelabeld) diagram is → valid=false.
- Als het vooral tekst/flowchart/poster is → valid=false.
- Als de afbeelding onleesbaar of te klein is → valid=false.

WERKWIJZE:
1) Beschrijf kort wat je ziet (max 2 zinnen).
2) Bepaal image_type: photo / labeled_diagram / diagram / map / text_heavy / unknown.
3) Geef per topicKeyword: true/false of het zichtbaar is.
4) Score: Relevantie (0-40), Correctheid (0-30), Educatieve waarde (0-30).

Antwoord als JSON:
{
  "valid": true/false,
  "score": 0-100,
  "observations": "wat zie je",
  "detected_subject": "human|animal|mixed|unknown",
  "image_type": "photo|labeled_diagram|diagram|map|text_heavy|unknown",
  "readability": "good|ok|poor",
  "issues": ["probleem 1", "probleem 2"],
  "reason": "korte uitleg"
}

Wees STRENG. Bij twijfel: valid=false.`;
```

## Kosten v3.5 (gemeten)

**Voor 48 vragen:**
- 4 batch calls (12 vragen per batch)
- ~150 vision validation calls (gemiddeld 3 per vraag)
- 10+ escalation calls
- Rate limiting bij q048 (429 errors)

## Vragen aan ChatGPT

### 1. Fallback Strategie
Wat moet ik doen als ALLE 5 kandidaten AI validation falen?
- Huidige aanpak: fallback op text-score (levert soms slechte afbeeldingen)
- Optie A: Geen afbeelding selecteren (betere kwaliteit, maar meer gaps)
- Optie B: Automatisch nieuwe zoekstrategie met andere queries
- Optie C: Lagere threshold voor "last resort" kandidaat

### 2. Rate Limiting
Hoe kan ik 429 errors voorkomen?
- Huidige delay: 200ms tussen validaties
- Opties: hogere delay, exponential backoff, parallel batching?

### 3. Labeled Diagram Intent
Intent `labeled_diagram` is te streng - alle foto's worden afgewezen. Moet ik:
- Een soft fallback naar `photo` toevoegen?
- De intent automatisch downgraden als geen diagram gevonden?
- De prompt aanpassen om "anatomische foto's met labels" ook te accepteren?

### 4. "Unknown" Detected Subject
Voor diagrammen is `detected_subject: unknown` vaak correct (het is geen persoon).
Moet ik de hard reject rule voor `human_vs_animal` aanpassen om `unknown` toe te staan bij diagram intents?

### 5. Algemene Verbeteringen
Andere suggesties om de 47/48 naar 48/48 te krijgen en de fallback-kwaliteit te verbeteren?

## Technische Context

- **Platform:** Browser-based quiz app (HTML/JS)
- **AI:** Gemini 2.0 Flash (**Tier 1** - niet gratis tier)
- **Vision API:** Gemini inline_data met base64 images
- **Quiz grootte:** 30-100 vragen
- **Image APIs:**
  - Wikimedia Commons (gratis)
  - Unsplash API (gratis tier, nu actief)
  - Pexels API (gratis tier, nu actief)

## Conclusie v3.5

**Verbeteringen t.o.v. v3.4:**
- ✅ Geen kattenskeletten meer voor menselijke anatomie
- ✅ AI detecteert correct human vs animal
- ✅ Escalation strategie vindt vaak alsnog goede afbeelding
- ✅ Unsplash/Pexels integratie levert mooie foto's

**Nog te verbeteren:**
- ❌ Fallback bij AI falen levert soms slechte afbeeldingen
- ❌ Rate limiting bij grote quizzes
- ❌ labeled_diagram intent is te streng
- ❌ 1 vraag gefaald (q046)
