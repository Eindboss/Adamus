# ChatGPT Review: AI-Powered Image Selection (v3.9) - Zoekresultaten Probleem

## Context

Ik bouw een educatieve quiz-applicatie (Adamus) voor Nederlandse middelbare scholieren (14-16 jaar). Na v3.8 implementatie zijn de resultaten **slechter** geworden, niet beter. Dit document vraagt om analyse van het kernprobleem.

**Gemini Tier:** Tier 1 (strikte rate limits: ~15 RPM)

---

## Resultaten Vergelijking

| Versie | Success Rate | Afbeeldingen gevonden |
|--------|--------------|----------------------|
| v3.7   | 69% (33/48)  | 33 vragen            |
| v3.8   | 21% (10/48)  | 10 vragen            |

**Conclusie:** v3.8 presteert VEEL slechter dan v3.7.

---

## Wat v3.8 Heeft Geïmplementeerd

Op basis van jouw eerdere advies hebben we geïmplementeerd:

### 1. Begrippen Index (h4-begrippen-index.json)
- 73 begrippen met NL→EN vertalingen
- `alternativeSearches` voor moeilijke concepten
- `minScoreAdjust` voor lagere drempels (-15 voor RSI, warming-up, etc.)
- `allowedConcepts` voor proxy matching

### 2. Keyword Enrichment
- `BegrippenIndex.matchQuestion()` matcht vraag tegen index
- Retourneert Engelse termen, visual concepts, fallback searches

### 3. Micro-Context Injection
- Relevante begrippen worden in batch prompt geïnjecteerd
- Max 20 begrippen per batch

### 4. Fallback Searches
- Na reguliere AI + escalation, probeer `alternativeSearches` uit index
- Voorbeeld: RSI vraag → ["office ergonomics diagram", "correct sitting posture computer"]

### 5. MinScore Adjustments
- RSI/warming-up/cooling-down krijgen -15 op minScore
- Drempel van 50 → 35 voor deze concepten

---

## Het Kernprobleem: "No candidates found"

De meeste vragen falen met **"No candidates found"** - de zoektermen geven helemaal geen resultaten terug van de image sources (Unsplash, Pexels, Wikimedia Commons).

### Log Analyse v3.8:

```
q003: [FAIL-CLOSED: all 0 candidates rejected]
q004: [FAIL-CLOSED: all 0 candidates rejected]
q007: ✗ No suitable image (min: 70)
q008: [FAIL-CLOSED: all 0 candidates rejected]
q011: ✗ No suitable image (min: 70)
...
q031: [index-fallback]✗ No suitable image (min: 35)
q032: [index-fallback]✗ No suitable image (min: 45)
```

### Voorbeeld Gefaalde Zoektermen:

**q037 (RSI):**
```json
"queries": [
  "RSI ergonomics computer posture",
  "repetitive strain injury ergonomics",
  "RSI computer"
]
```
→ 0 resultaten op Unsplash/Pexels/Commons

**q031 (Warming-up):**
```json
"queries": [
  "warm-up exercises stretching -animal",
  "warming up stretching exercises -animal",
  "exercise stretching -animal"
]
```
→ 0 resultaten

**q014 (Kogelgewricht):**
```json
"queries": [
  "incategory:\"Human skeleton diagrams\" ball and socket joint -animal -insect -fish",
  "human ball and socket joint diagram -animal -insect -fish",
  "hip joint anatomy human -animal"
]
```
→ 0 resultaten

---

## Waarom v3.7 Beter Werkte

In v3.7 waren de zoektermen **simpeler** en **werkten ze wel**:

| v3.7 Zoekterm | Resultaat |
|---------------|-----------|
| "human skeleton diagram" | ✓ Gevonden |
| "spine curvature" | ✓ Gevonden |
| "penguin swimming" | ✓ Gevonden |

In v3.8 zijn de zoektermen **te specifiek** of **te complex**:

| v3.8 Zoekterm | Resultaat |
|---------------|-----------|
| "incategory:\"Human skeleton diagrams\" ball and socket joint -animal" | ✗ 0 hits |
| "RSI ergonomics computer posture" | ✗ 0 hits |
| "warm-up exercises stretching -animal" | ✗ 0 hits |

---

## Hypotheses

### Hypothese A: Te Specifieke Zoektermen
De batch AI genereert te specifieke queries die geen matches vinden.
- `incategory:` werkt alleen op Commons, niet op Unsplash/Pexels
- Negaties (`-animal -insect -fish`) kunnen te restrictief zijn
- Meerdere keywords samen zijn te specifiek

### Hypothese B: Image Source Limitaties
- Unsplash/Pexels hebben weinig medische/anatomische diagrammen
- Commons heeft ze wel, maar de zoek-API is beperkt
- De fallback searches zijn ook te specifiek

### Hypothese C: Batch Prompt Probleem
De micro-context injection verandert hoe de AI zoektermen genereert op een negatieve manier.

### Hypothese D: Rate Limiting Cascade
429 errors verstoren de flow, waardoor sommige batches niet goed worden verwerkt.

---

## Wat Wel Werkt in v3.8

De **fallback mechanism** werkt wanneer er daadwerkelijk resultaten zijn:

```
q006: [index-fallback]✓ human anatomy figure... (score: 85) [fallback]
q043: [index-fallback]✓ A penguin swimming... (score: 145) [fallback]
q044: [index-fallback]✓ A penguin swims underwater... (score: 140) [fallback]
```

Dit bewijst dat:
1. De begrippen matching werkt (RSI, pinguïn worden herkend)
2. De fallback logica wordt correct getriggerd
3. Als er resultaten zijn, worden ze gevonden

---

## Vragen aan ChatGPT

### 1. Root Cause Analyse
Wat is volgens jou de hoofdoorzaak van de dramatische daling van 69% → 21%?

### 2. Zoekterm Strategie
Hoe moeten we de zoektermen aanpassen zodat ze daadwerkelijk resultaten vinden?

**Opties:**
- A) Simpelere queries (minder keywords, geen negaties)
- B) Per-source queries (Commons vs Unsplash/Pexels)
- C) Query expansion (meerdere varianten proberen)
- D) Fallback-first strategie (begin met simpele queries)

### 3. Source-Specifieke Aanpak
Moet elke image source zijn eigen zoekstrategie krijgen?

**Huidige flow:**
1. Unsplash + Pexels (simpele query)
2. Commons (incategory + negaties)
3. Wikipedia fallback

**Probleem:** De `incategory:` syntax werkt alleen op Commons maar verstoort de andere sources.

### 4. Negatie Strategie
Zijn de negaties (`-animal -insect -fish`) te agressief?

**Opties:**
- A) Verwijder alle negaties
- B) Gebruik negaties alleen op Commons
- C) Maak negaties optioneel (alleen bij high-risk profiles)
- D) Post-filter in plaats van zoek-filter

### 5. Fallback Volgorde
Moet de fallback (simpele queries) eerder komen in plaats van later?

**Huidige volgorde:**
1. AI batch queries (complex)
2. AI escalation (per-vraag)
3. Index fallback (alternativeSearches)

**Alternatief:**
1. Simpele baseline queries eerst
2. AI-enriched queries als verfijning
3. Index fallback als laatste resort

### 6. Image Source Prioriteit
Welke bronnen werken het beste voor welke content?

| Content Type | Beste Bron |
|--------------|------------|
| Anatomie diagrammen | Commons? Wikipedia? |
| Fitness/Sport foto's | Unsplash/Pexels |
| Microscoop afbeeldingen | Commons |
| Lifestyle (RSI/ergonomie) | Unsplash/Pexels |

---

## Technische Details

### Huidige Bronnen:
1. **Unsplash** - Gratis stock foto's, goede kwaliteit
2. **Pexels** - Gratis stock foto's
3. **Wikimedia Commons** - Educatieve content, diagrammen
4. **Wikipedia** - Fallback voor bekende onderwerpen

### API Limitaties:
- Gemini: 15 RPM (Tier 1)
- Unsplash: 50 requests/hour (demo)
- Pexels: 200 requests/hour
- Commons: Geen rate limit maar trage API

### Batch Size:
- 10 vragen per batch
- 5 batches voor 48 vragen

---

## Gewenste Output

Graag concreet advies over:

1. **Quick fix:** Wat kunnen we nu aanpassen om de success rate terug naar 69%+ te krijgen?

2. **Zoekterm formaat:** Geef voorbeelden van zoektermen die WEL werken voor:
   - Anatomie (skelet, gewrichten)
   - Fitness (warming-up, stretching)
   - Medisch (RSI, blessures)
   - Dieren (pinguïn anatomie)

3. **Source routing:** Welke content moet naar welke bron?

4. **Negatie strategie:** Wanneer wel/niet negaties gebruiken?

5. **Prompt aanpassing:** Hoe moet de batch prompt worden aangepast?

---

## Bijlagen

### A. Begrippen Index Voorbeeld (werkend)
```javascript
// Test begrippen matching - dit werkt correct
Q: 'Waarom doe je een warming-up?'
  Matched: warming_up
  Fallbacks: athletes warming up | dynamic stretching exercises

Q: 'RSI ontstaat vooral door'
  Matched: rsi
  Fallbacks: office ergonomics diagram | correct sitting posture computer
```

### B. Succesvolle v3.8 Queries
De queries die WEL werkten:
- `"spine curvature diagram"` → Unsplash hit
- `"penguin swimming underwater"` → Unsplash hit
- `"ergonomics computer posture"` → Unsplash hit
- `"bone tissue microscope"` → Unsplash hit

### C. Gefaalde v3.8 Queries Pattern
De queries die NIET werkten hadden vaak:
- `incategory:"..."` prefix
- Meerdere negaties (`-animal -insect -fish`)
- Te specifieke medische termen
- Combinatie van 3+ keywords
