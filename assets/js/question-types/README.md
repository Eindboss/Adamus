# Adamus Question Types

Dit is de modulaire structuur voor vraagtypen in Adamus.

## Structuur

```
question-types/
├── index.js          # Registry van alle vraagtypen
├── shared.js         # Gedeelde functies (state, feedback, etc.)
├── _template.js      # Template voor nieuwe vraagtypen
├── mc.js             # Multiple choice ✓
├── open.js           # Open vraag ✓
├── short-text.js     # Kort antwoord ✓
├── grouped-short-text.js  # Gegroepeerde invulvragen ✓
├── table-parse.js    # Verbuigingstabellen (stub)
├── grouped-translation.js # Vertaling in context (stub)
├── grouped-select.js # Dropdowns per zin (stub)
├── translation-open.js    # Lange vertaling (stub)
├── wiskunde-multi-part.js # Wiskunde meerdelig (stub)
├── ordering.js       # Volgorde (stub)
├── ratio-table.js    # Verhoudingstabel (stub)
├── info-card.js      # Informatiekaart (stub)
├── fill-blank.js     # Invullen in tekst (stub)
├── short-answer.js   # Kort antwoord v2 (stub)
├── matching.js       # Koppelen (stub)
├── numeric.js        # Numeriek (stub)
├── data-table.js     # Data tabel (stub)
└── multipart.js      # Meerdelig (stub)
```

## Nieuw vraagtype toevoegen

### 1. Kopieer de template
```bash
cp _template.js mijn-type.js
```

### 2. Implementeer render() en check()
```javascript
export function render(container, q) {
  // Render de vraag HTML
}

export function check(q) {
  // Check het antwoord
  return { correct: true/false, score: X, maxScore: Y };
}
```

### 3. Registreer in index.js
```javascript
import * as mijnType from "./mijn-type.js";

export const QUESTION_TYPES = {
  // ...
  mijn_type: mijnType,
};
```

### 4. Voeg CSS toe (optioneel)
Maak `assets/css/question-types/mijn-type.css` en importeer in `index.css`.

## Migratiestatus

| Type | Status | Bestand |
|------|--------|---------|
| mc | ✅ Gemigreerd | mc.js |
| open | ✅ Gemigreerd | open.js |
| short_text | ✅ Gemigreerd | short-text.js |
| grouped_short_text | ✅ Gemigreerd | grouped-short-text.js |
| table_parse | ⏳ Stub | table-parse.js |
| grouped_translation | ⏳ Stub | grouped-translation.js |
| grouped_select | ⏳ Stub | grouped-select.js |
| translation_open | ⏳ Stub | translation-open.js |
| wiskunde_multi_part | ⏳ Stub | wiskunde-multi-part.js |
| ordering | ⏳ Stub | ordering.js |
| ratio_table | ⏳ Stub | ratio-table.js |
| info_card | ⏳ Stub | info-card.js |
| fill_blank | ⏳ Stub | fill-blank.js |
| short_answer | ⏳ Stub | short-answer.js |
| matching | ⏳ Stub | matching.js |
| numeric | ⏳ Stub | numeric.js |
| data_table | ⏳ Stub | data-table.js |
| multipart | ⏳ Stub | multipart.js |

**Stub** = Bestand bestaat, maar gebruikt nog de oude quiz.js implementatie.

## Shared functies (shared.js)

- `getState()` - Krijg huidige quiz state
- `showFeedback(correct, explanation, answer)` - Toon feedback
- `awardPoints(id, correct)` - Ken punten toe
- `updateSpacedRepetition(correct, id)` - Update spaced repetition
- `addToHistory(entry)` - Voeg toe aan geschiedenis
- `checkAcceptList(list, input, caseSensitive)` - Check tegen acceptlijst
- `setCheckButtonEnabled(enabled)` - Enable/disable check knop
- `wrapWithImageLayout(html, q)` - Wrap met afbeelding layout
- `getQuestionText(q)` - Haal vraagtekst uit verschillende schema's
