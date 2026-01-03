# ChatGPT Review: AI-Powered Image Selection (v3.5) - Testresultaten

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor Nederlandse middelbare scholieren. Na zeven iteraties heb ik nu een v3.5 systeem getest. Dit document beschrijft de resultaten en vraagt om feedback.

**Belangrijk:** Ik gebruik Gemini **Tier 1** (niet gratis tier), dus er is meer ruimte voor extra AI calls als dat nodig is.

## v3.5 Testresultaten (Biologie Quiz - 50 vragen)

### Samenvatting
- **47/48 vragen verwerkt** (98% success rate op papier)
- **Maar: 23 van 50 afbeeldingen kloppen NIET** (46% fout!)
- De AI valideert te oppervlakkig

### Handmatige Controle (50 vragen gecontroleerd, 23 fouten gevonden)

| Vraag | Wat AI selecteerde | Wat er mis is | Root cause |
|-------|-------------------|---------------|------------|
| **q001** | Borstklier (dissected lactating breast) | Vraag gaat over SKELET functie, niet borstklier | AI zag "human anatomy" maar controleerde niet of het de JUISTE anatomie was |
| **q003** | Flowchart diagram (Composition of bone) | Ik wil een FOTO, geen diagram | Intent was `labeled_diagram` maar gebruiker wil eigenlijk foto |
| **q004** | Bot doorsnede met Oekraïense tekst | Tekst is niet Nederlands/Engels | **Geen taalcontrole** |
| **q007** | Vaag symbool/icoon | Onduidelijk, deel van grotere afbeelding | Te kleine/vage afbeelding goedgekeurd |
| **q008** | Vage foto van losse botten | Slechte kwaliteit, niet educatief | Lage beeldkwaliteit niet afgewezen |
| **q010** | **Soep** (collagen bone broth) | Vraag over collageen in botweefsel, kreeg foto van soep | AI faalde alle validaties, fallback op text-score |
| **q015** | Skelet met **Poolse** labels | Tekst is niet Nederlands/Engels | **Geen taalcontrole** |
| **q017** | Netwerk/graph diagram | Vraag over gewrichtssmeer, toont een abstract netwerk | **Compleet irrelevant** - AI herkende niet wat het was |
| **q018** | Knie diagram met **Poolse** labels | Tekst is niet Nederlands/Engels | **Geen taalcontrole** |
| **q023** | Abstracte kunst (gekleurde touwen) | Vraag over spier samentrekken | **Compleet irrelevant** - AI herkende niet dat dit kunst is, geen anatomie |
| **q024** | **Litouwse** woordenlijst/tabel | Vraag over antagonistisch spierpaar | **Geen taalcontrole** + geen anatomische afbeelding |
| **q026** | Complex zenuwstelsel diagram (Eng) | Vraag over onbewuste beweging | **Te complex** voor middelbare scholier |
| **q028** | Caffeine effecten diagram | Vraag over motorisch geheugen | **Verkeerd onderwerp** - caffeine ≠ motorisch geheugen |
| **q029** | Abstracte kunst (gekleurde touwen) | Vraag over coördinatie | **Compleet irrelevant** - zelfde foute afbeelding als q023 |
| **q037** | Onbekend diagram | Vraag over RSI | **Compleet irrelevant** - heeft niets met RSI te maken |
| **q038** | Onduidelijke foto | Onbekend wat dit voorstelt | **Onherkenbaar** - geen idee wat de foto inhoudt |
| **q039** | Onduidelijke afbeelding | Onduidelijk verband met lesstof | **Compleet irrelevant** - geen duidelijk verband met de vraag |
| **q040** | Veel kleine plaatjes in één afbeelding | Te gedetailleerd, onoverzichtelijk | **Te klein/complex** - individuele plaatjes zijn niet leesbaar |
| **q041** | Persoon op fiets | Vraag over zithouding | **Verkeerd onderwerp** - fietsen ≠ zithouding (op stoel) |
| **q042** | Diabetes afbeelding | Vraag over RSI | **Verkeerd onderwerp** - diabetes ≠ RSI |
| **q048** | Kaart/plattegrond met lijnen | Vraag over training onderdelen | **Compleet irrelevant** - lijkt op een spoorwegkaart, niets met sport/training |
| **q049** | Keyboard/muziekstudio | Vraag over RSI | **Compleet irrelevant** - muziekinstrument heeft niets met RSI te maken |
| **q050** | Scientific method diagram | Vraag over effect squats op spieren | **Compleet irrelevant** - wetenschappelijke methode ≠ spiertraining |

### Analyse van de Problemen

#### Probleem 1: AI valideert "menselijk" maar niet "juiste anatomie"
- q001 vraagt over skeletfuncties → AI zag borstklier → "dit is menselijke anatomie" → GOEDGEKEURD
- q028: vraag over motorisch geheugen → toont caffeine effecten diagram
- **De AI moet niet alleen "human vs animal" checken, maar ook of de SPECIFIEKE anatomie/onderwerp past bij de vraag**

#### Probleem 2: Geen taalcontrole (GROOT PROBLEEM)
Meerdere afbeeldingen hebben tekst in vreemde talen:
- q004: Oekraïens
- q015: Pools
- q018: Pools
- q024: Litouws
- **Nodig**: Hard reject voor niet-Nederlandse/Engelse tekst in afbeeldingen

#### Probleem 3: Compleet irrelevante afbeeldingen worden geaccepteerd
- q017: Netwerk/graph diagram voor vraag over gewrichtssmeer
- q023 & q029: **Abstracte kunst** (gekleurde touwen) voor spier/coördinatie vragen
- q024: Een woordenlijst/tabel voor anatomie vraag
- **De AI herkent niet dat sommige afbeeldingen NIETS met het onderwerp te maken hebben**

#### Probleem 4: Te complexe afbeeldingen voor doelgroep
- q026: Complex zenuwstelsel diagram (parasympathicus/sympathicus)
- **Te complex voor middelbare scholier** - moet simpeler

#### Probleem 5: Fallback strategie faalt
- q010: Alle 5 AI validaties faalden (score 0)
- Toch werd "collagen bone broth.jpg" (soep!) geselecteerd op text-score
- **Huidige fallback is gevaarlijk** - beter geen afbeelding dan een foute

#### Probleem 6: Vage/kleine afbeeldingen worden goedgekeurd
- q007: Een klein symbool/icoon werd geselecteerd
- q008: Vage foto van losse botten zonder context
- AI moet strenger zijn op beeldkwaliteit en duidelijkheid

#### Probleem 7: Dubbele afbeeldingen
- q023 en q029 tonen DEZELFDE foute afbeelding (abstracte kunst)
- q033 en q034 tonen ook DEZELFDE afbeelding
- **De `usedImages` check werkt niet goed, of dezelfde afbeelding wordt voor verschillende vragen hergebruikt**

## Huidige Architectuur v3.5

```
┌─────────────────────────────────────────────────────────────┐
│                    BATCH AI (12 vragen)                      │
│  → Genereert zoektermen, categoryHints, riskProfile, etc.   │
│  → Bepaalt "intent" (photo/diagram/labeled_diagram)         │
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
│     - readability: good|ok|poor                            │
│     - score: 0-100                                         │
│  4. Hard reject rules:                                      │
│     - human_vs_animal risk + niet human → reject           │
│     - labeled_diagram intent + niet diagram → reject       │
│     - poor readability → reject                            │
│  [PROBLEEM: Controleert niet of specifieke anatomie klopt] │
│  [PROBLEEM: Geen taalcontrole]                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              FALLBACK (als alle AI validaties falen)        │
│                                                              │
│  → Selecteer beste kandidaat op text-score                  │
│  [PROBLEEM: Levert soep op voor collageen-vraag!]          │
└─────────────────────────────────────────────────────────────┘
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

## Vragen aan ChatGPT

### 1. Specifieke Onderwerp Validatie (KRITIEK)
Hoe kan ik de AI laten controleren of het SPECIFIEKE onderwerp past bij de vraag?
- q001: vraag over skelet → borstklier is NIET relevant (maar wel "human")
- q028: vraag over motorisch geheugen → caffeine diagram is NIET relevant
- **De AI moet begrijpen WAT de vraag vraagt, niet alleen of het "menselijk" is**

### 2. Taalcontrole (KRITIEK)
4+ afbeeldingen hadden Pools/Oekraïens/Litouwse tekst. Hoe fix ik dit?
- Optie A: AI vragen om taal te detecteren in de validation prompt → `"detected_language": "pl|uk|lt|en|nl"`
- Optie B: Alleen zoeken met `language:en` of `language:nl` filters
- Optie C: Hard reject als tekst niet NL/EN is

### 3. Irrelevante Afbeeldingen Detecteren (KRITIEK)
De AI accepteert compleet irrelevante afbeeldingen:
- Abstracte kunst (gekleurde touwen) voor anatomie vragen
- Netwerk/graph diagrammen voor gewrichtssmeer
- Woordenlijsten/tabellen voor anatomie
- **Hoe leer ik de AI om "dit heeft NIETS te maken met het onderwerp" te herkennen?**

### 4. Complexiteit voor Doelgroep
q026 toont een zeer complex zenuwstelsel diagram dat te moeilijk is voor middelbare scholieren.
- Moet ik een "complexity" score toevoegen?
- Of specifiek vragen of het geschikt is voor 14-16 jarigen?

### 5. Fallback Strategie
Wat moet ik doen als ALLE 5 kandidaten AI validation falen?
- **Huidige aanpak**: fallback op text-score → levert soep op voor collageen vraag
- **Optie A**: Geen afbeelding selecteren (betere kwaliteit, maar meer gaps)
- **Optie B**: Markeer als "needs manual review"
- **Wat is beter: geen afbeelding of een foute afbeelding?**

### 6. Dubbele Afbeeldingen
q023/q029 en q033/q034 tonen dezelfde afbeelding.
- De `usedImages` check zou dit moeten voorkomen
- Werkt dit niet correct, of is er een bug?

### 7. Rate Limiting
Ik krijg 429 errors bij grote quizzes. Huidige delay is 200ms.
- Wat is een goede delay tussen API calls?
- Moet ik exponential backoff implementeren?

## Technische Context

- **Platform:** Browser-based quiz app (HTML/JS)
- **Doelgroep:** Nederlandse middelbare scholieren
- **AI:** Gemini 2.0 Flash (**Tier 1** - niet gratis tier)
- **Vision API:** Gemini inline_data met base64 images
- **Quiz grootte:** 30-100 vragen
- **Image APIs:**
  - Wikimedia Commons (gratis)
  - Unsplash API (gratis tier, nu actief)
  - Pexels API (gratis tier, nu actief)

## Gewenste Verbeteringen voor v3.6

1. **Specifieke anatomie matching** - Niet alleen "human" maar ook "skelet" vs "borstklier"
2. **Taalcontrole** - Reject niet-NL/EN tekst
3. **Betere fallback** - Liever geen afbeelding dan een foute
4. **Strengere beeldkwaliteit** - Reject vage/kleine afbeeldingen
5. **Intent flexibiliteit** - Probeer meerdere intents als eerste faalt

Graag feedback op hoe ik deze verbeteringen het beste kan implementeren!
