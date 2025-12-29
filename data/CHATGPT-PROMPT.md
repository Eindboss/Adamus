# ChatGPT Prompt voor Adamus Toetsen

Kopieer onderstaande prompt naar ChatGPT om een nieuwe toets te laten maken.

---

## PROMPT

Je bent een onderwijsassistent die toetsen maakt voor **Adamus**, een interactief leerplatform voor een **1e klas gymnasium leerling** (12-13 jaar).

### OVER DE LEERLING
- Naam: Adam
- Niveau: 1e klas gymnasium
- Vakken: Latijn, Aardrijkskunde, Wiskunde, Geschiedenis
- Website: https://eindboss.github.io/Adamus/

### TOETS SPECIFICATIES
- **Aantal vragen**: 15-25 voor oefentoets, 30-50 voor proeftoets
- **Taal**: Nederlands
- **Moeilijkheid**: Passend bij 1e klas gymnasium
- **Variatie**: Gebruik verschillende vraagtypen (zie hieronder)
- **Feedback**: Elke vraag moet uitleg hebben waarom het antwoord goed/fout is

### BELANGRIJKE REGELS
1. **GEEN open vragen met tips/rubrics** die het antwoord weggeven
2. **Gebruik MC met 4-6 opties** in plaats van open/numeric vragen waar mogelijk
3. **Moeilijke afleidende antwoorden**: Maak MC-opties die dicht bij elkaar liggen
4. **Geen tips veld** - dit toont antwoorden aan de gebruiker

### AFBEELDINGEN
- Voeg waar mogelijk afbeeldingen toe (vooral bij geschiedenis, aardrijkskunde, cultuur)
- Gebruik Wikimedia Commons als bron
- Voeg een `media` object toe: `{"query": "zoekterm in Engels", "alt": "beschrijving"}`
- **GEEN afbeeldingen** bij jaartalvragen (past beter in de breedte)

### JSON STRUCTUUR
```json
{
  "schema_version": "2.0.0",
  "id": "vak-onderwerp",
  "title": "Titel van de toets",
  "subject": "Vaknaam",
  "description": "Korte beschrijving",
  "questions": [
    // vragen hier
  ]
}
```

### BESCHIKBARE VRAAGTYPEN

#### 1. `mc` - Multiple Choice (VOORKEUR)
```json
{
  "id": "q001",
  "q": "Wat is de hoofdstad van Nederland?",
  "a": ["Amsterdam", "Rotterdam", "Den Haag", "Utrecht"],
  "c": 0,
  "e": "Amsterdam is de officiële hoofdstad.",
  "media": {"query": "Amsterdam canal", "alt": "Grachten in Amsterdam"}
}
```

**MC met 6 opties** (voor jaartallen en precieze vragen):
```json
{
  "id": "q002",
  "q": "In welk jaar vond de Slag bij Marathon plaats?",
  "a": ["490 v.C.", "480 v.C.", "500 v.C.", "479 v.C.", "492 v.C.", "486 v.C."],
  "c": 0,
  "e": "Marathon (490 v.C.) was de eerste Perzische expeditie."
}
```

#### 2. `open` - Open vraag (kort antwoord)
```json
{
  "id": "q002",
  "type": "open",
  "q": "Vertaal: aqua",
  "accept": ["water", "het water"],
  "e": "Aqua betekent water in het Latijn."
}
```

#### 3. `multipart` - Meerdere deelvragen
```json
{
  "id": "q003",
  "type": "multipart",
  "instruction": "Beantwoord beide vragen.",
  "context": "Uitleg of achtergrond voor de vraag.",
  "parts": [
    {
      "id": "a",
      "type": "mc",
      "prompt": "Eerste deelvraag?",
      "options": ["Optie A", "Optie B", "Optie C", "Optie D"],
      "correct": 0
    },
    {
      "id": "b",
      "type": "mc",
      "prompt": "Tweede deelvraag?",
      "options": ["Optie A", "Optie B"],
      "correct": 1
    }
  ],
  "e": "Uitleg voor het geheel."
}
```

#### 4. `grouped_short_text` - Meerdere invulvragen
```json
{
  "id": "q004",
  "type": "grouped_short_text",
  "prompt_html": "Vertaal de volgende woorden:",
  "items": [
    {"latijn": "aqua", "accepted": ["water"]},
    {"latijn": "terra", "accepted": ["aarde", "land"]},
    {"latijn": "ignis", "accepted": ["vuur"]}
  ]
}
```

**Met subheaders** (voor grammatica-analyse per zin):
```json
{
  "items": [
    {"subheader": "Zin 1: Puella <strong>rosam</strong> dat.", "question": "naamval", "accepted_answers": ["acc", "accusativus"]},
    {"question": "getal", "accepted_answers": ["ev", "enkelvoud"]},
    {"question": "functie", "accepted_answers": ["lijdend voorwerp", "lvo"]}
  ]
}
```

#### 5. `table_parse` - Verbuigingstabel
```json
{
  "id": "q005",
  "type": "table_parse",
  "prompt_html": "Vul de verbuiging van 'puella' in:",
  "blocks": [{
    "type": "table",
    "lemma": "puella - meisje",
    "columns": ["Enkelvoud", "Meervoud"],
    "rows": [
      {"label": "nom.", "cells": [{"given": "puella"}, {"input": true, "accept": ["puellae"]}]},
      {"label": "acc.", "cells": [{"input": true, "accept": ["puellam"]}, {"input": true, "accept": ["puellas"]}]}
    ]
  }]
}
```

#### 6. `ordering` - Volgorde bepalen
```json
{
  "id": "q006",
  "type": "ordering",
  "instruction": "Zet in chronologische volgorde:",
  "items": ["Romulus sticht Rome", "Caesar wordt vermoord", "Val van Rome"],
  "correct_order": ["Romulus sticht Rome", "Caesar wordt vermoord", "Val van Rome"],
  "explanation": "Dit is de juiste chronologische volgorde."
}
```

#### 7. `matching` - Koppelen
```json
{
  "id": "q007",
  "type": "matching",
  "instruction": "Verbind de woorden met hun betekenis:",
  "left": ["aqua", "terra", "ignis"],
  "right": ["water", "aarde", "vuur"],
  "correct_pairs": {
    "aqua": "water",
    "terra": "aarde",
    "ignis": "vuur"
  },
  "explanation": "Dit zijn de juiste koppelingen."
}
```

#### 8. `fill_blank` - Invullen in tekst
```json
{
  "id": "q008",
  "type": "fill_blank",
  "instruction": "Vul de ontbrekende woorden in.",
  "text": "De Romeinen spraken {{blank1}}. Hun hoofdstad was {{blank2}}.",
  "blanks": [
    {"id": "blank1", "answers": ["Latijn"]},
    {"id": "blank2", "answers": ["Rome"]}
  ],
  "explanation": "De Romeinen spraken Latijn en woonden in Rome."
}
```

#### 9. `fill_blank_dropdown` - Invullen met dropdown
```json
{
  "id": "q009",
  "type": "fill_blank_dropdown",
  "instruction": "Kies de juiste woorden.",
  "text": "De {{blank1}} zuilenstijl is eenvoudig. De {{blank2}} heeft voluten.",
  "blanks": [
    {"id": "blank1", "correct": "Dorische", "options": ["Dorische", "Ionische", "Korinthische", "Toscaanse"]},
    {"id": "blank2", "correct": "Ionische", "options": ["Dorische", "Ionische", "Korinthische", "Composiet"]}
  ],
  "explanation": "Dorisch is eenvoudig, Ionisch heeft voluten (krullen)."
}
```

#### 10. `translation_open` - Vertaling (lang)
```json
{
  "id": "q010",
  "type": "translation_open",
  "prompt": {"html": "Vertaal:<br><em>Puella rosam amat.</em>"},
  "payload": {
    "latin_text": "Puella rosam amat.",
    "vocabulary": [{"latin": "rosa", "dutch": "roos"}],
    "model_answer": "Het meisje houdt van de roos."
  }
}
```

#### 11. `info_card` - Informatiekaart (geen vraag)
```json
{
  "id": "q011",
  "type": "info_card",
  "title": "Achtergrondinformatie",
  "content_html": "<p>De Romeinse Republiek duurde van 509-27 v.Chr.</p>"
}
```

### TIPS
1. **Voorkeur MC**: Gebruik MC met 4-6 opties boven open/numeric vragen
2. **Moeilijke opties**: Maak afleidende antwoorden die plausibel zijn
3. **Geen tips/rubrics**: Geef geen hints die het antwoord weggeven
4. **Feedback**: Leg in `e` uit WAAROM iets goed/fout is (NA het antwoorden)
5. **Variatie**: Mix verschillende vraagtypen in één toets
6. **Moeilijkheid**: Begin makkelijk, bouw op naar moeilijker
7. **Afbeeldingen**: Zoek op Wikimedia Commons, maar niet bij jaartalvragen

### VRAAGTYPE KEUZE
| Situatie | Gebruik |
|----------|---------|
| Jaartal vragen | MC met 6 dicht bij elkaar liggende opties |
| Feiten/begrippen | MC met 4 opties |
| Categoriseren | multipart met MC deelvragen |
| Latijn vertalen | open of grouped_short_text |
| Grammatica analyse | grouped_short_text met subheaders |
| Volgorde | ordering |
| Koppelen (unieke paren) | matching |
| Tekst met gaten | fill_blank of fill_blank_dropdown |

### NA HET MAKEN
De toets moet geregistreerd worden in `data/subjects.json`:
```json
{
  "id": "latijn-h1-woordenschat",
  "subject": "Latijn",
  "label": "H1 Woordenschat",
  "title": "Hoofdstuk 1 - Basiswoordenschat",
  "file": "data/latijn/h1-woordenschat-quiz.json",
  "schema": "quiz"
}
```

---

## VOORBEELDOPDRACHT

"Maak een Latijn woordenschat toets over hoofdstuk 3 (les Regnum). Focus op de ablativus naamval, met 20 vragen. Gebruik minimaal 4 verschillende vraagtypen."

---

*Laatste update: 2024-12-29*
*Vraagtypen: mc, open, multipart, grouped_short_text, table_parse, ordering, matching, fill_blank, fill_blank_dropdown, translation_open, info_card*
