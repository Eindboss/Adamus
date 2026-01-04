# UI/Styling Review Prompt voor Adamus (v2)

## Context

Adamus is een educatieve quiz-webapp voor middelbare scholieren (gymnasium niveau). De app heeft een "museum-inspired" design met een warm goud/amber kleurenpalet en een donkergroene header. De app ondersteunt light/dark mode.

**Doelgroep:** Middelbare scholieren (12-18 jaar)
**Doel:** Leren door quizzen te maken voor vakken als Latijn, Wiskunde, Biologie, etc.

## Live Preview

De app draait op: https://www.lerenmetadamus.nl/

---

## Eerdere Review & Doorgevoerde Fixes

Na een eerdere UI review (ChatGPT + Claude second opinion) zijn de volgende verbeteringen doorgevoerd:

### Opgeloste issues

| Issue | Oplossing |
|-------|-----------|
| `.btn-primary` contrast te laag (wit op goud) | Gewijzigd naar donkere tekst `#1a1815` |
| `--muted` kleur te licht voor WCAG | Donkerder gemaakt: `#7a7568` → `#5a5548` |
| Timer toggle te klein voor touch | Vergroot van 36x20px naar 44x24px |
| Quiz stats moeilijk leesbaar | Kleur gewijzigd naar `--text-light` met `font-weight: 500` |

### Bevestigd correct (geen actie nodig)

- Focus states (`:focus-visible`) zijn aanwezig op buttons en cards
- `--border` en `--shadow-color` zijn correct gedefinieerd
- Touch targets op buttons (48px min-height) zijn voldoende
- CSS custom properties worden consistent gebruikt
- Responsive breakpoints dekken alle schermgroottes (640px, 480px, 375px)

---

## Vraag voor Vervolg-Review

Review de UI en styling opnieuw, met focus op **wat er nog verbeterd kan worden**. De basis-toegankelijkheid is nu in orde.

Focus op:

1. **Quiz controls op mobile** - 5 knoppen in één rij is veel. Hoe kan dit beter?
2. **Visuele feedback bij goed/fout** - Zijn de huidige animaties/kleuren voldoende?
3. **Micro-interacties** - Welke subtiele animaties zouden de app "levendiger" maken?
4. **Dark mode** - Is de dark mode uitvoering goed of zijn er verbeterpunten?
5. **Consistentie** - Zijn er nog inconsistenties in spacing, kleuren, of componenten?

---

## Actueel Design System (base.css)

```css
/* CSS Variables - UPDATED */
:root {
  /* Colors - Warm, Museum-inspired palette */
  --bg: #f7f5f0;
  --bg-alt: #ebe8e0;
  --card: #ffffff;
  --text: #1a1815;
  --text-light: #4a4740;
  --muted: #5a5548;  /* ✓ Verbeterd voor contrast */

  /* Brand Colors - Gold/Amber theme */
  --brand: #c9a227;
  --brand-light: #f5ecd0;
  --brand-dark: #a68618;

  /* Feedback Colors */
  --success: #2e7d52;
  --success-light: #e3f2e8;
  --error: #c43e3e;
  --error-light: #fce8e8;

  /* Header Colors */
  --header-bg: #1f4a38;
  --header-text: #f9f8f5;
  --header-accent: #d4af37;

  /* UI Colors */
  --border: rgba(0, 0, 0, 0.1);
  --shadow-color: rgba(0, 0, 0, 0.08);

  /* Typography */
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-display: "Plus Jakarta Sans", var(--font-sans);

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 40px;

  /* Borders */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px var(--shadow-color);
  --shadow-md: 0 4px 12px var(--shadow-color);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.12);
}

/* Dark Mode */
[data-theme="dark"] {
  --bg: #1a1815;
  --bg-alt: #252220;
  --card: #2a2725;
  --text: #f5f3ef;
  --text-light: #c9c5bd;
  --muted: #8a8578;
  --brand: #d4af37;
  --brand-light: #3d3520;
  --header-bg: #0f251c;
  --border: rgba(255, 255, 255, 0.1);
  --shadow-color: rgba(0, 0, 0, 0.3);
}
```

---

## Actuele Components

### Primary Button (UPDATED)
```css
.btn-primary {
  background: linear-gradient(135deg, var(--brand) 0%, var(--brand-dark) 100%);
  color: #1a1815;  /* ✓ Donkere tekst voor contrast */
  border-color: transparent;
  box-shadow: 0 2px 8px rgba(201, 162, 39, 0.3);
}
```

### Timer Toggle (UPDATED)
```css
.timer-toggle {
  position: relative;
  width: 44px;   /* ✓ Vergroot voor touch */
  height: 24px;  /* ✓ Vergroot voor touch */
  min-width: 44px;
  min-height: 24px;
  background: var(--border-strong);
  border-radius: var(--radius-full);
  cursor: pointer;
}

.timer-toggle::after {
  width: 20px;   /* ✓ Aangepast aan nieuwe grootte */
  height: 20px;
}
```

### Quiz Stats (UPDATED)
```css
.quiz-meta #stat {
  color: var(--text-light);  /* ✓ Betere leesbaarheid */
  font-weight: 500;
}
```

---

## HTML Structuur

### Quiz Page (quiz.html)
```html
<body data-page="quiz">
  <div id="topbar-root"></div>
  <main class="wrap quiz-page">
    <!-- Stats & Timer -->
    <div class="quiz-meta">
      <div id="timerDot" class="stat-dot"></div>
      <div id="stat">0 goed / 0 fout / 0 overgeslagen</div>
      <div class="timer">Resterend: <strong id="countdown">90</strong> s</div>
      <div class="timer-toggle-wrap">
        <span class="timer-toggle-label">Timer</span>
        <div class="timer-toggle" role="switch" aria-checked="true" tabindex="0"></div>
      </div>
    </div>

    <!-- Progress -->
    <div class="quiz-progress">
      <div class="progress">
        <div class="progress-bar" id="progressBar"></div>
      </div>
    </div>

    <!-- Question Area -->
    <div class="question-card" id="quizArea">
      <!-- Dynamisch geladen -->
    </div>

    <!-- Controls - 5 knoppen, mogelijk te veel voor mobile -->
    <div class="quiz-controls">
      <button class="btn">Opnieuw</button>
      <button class="btn">Pauze</button>
      <button class="btn">Overslaan</button>
      <button class="btn">Weet het niet</button>
      <button class="btn btn-primary">Controleer</button>
    </div>
  </main>
</body>
```

---

## Specifieke Vragen

1. **Quiz controls op mobile**: 5 knoppen is overweldigend. Suggesties?
   - Dropdown/menu voor secundaire acties?
   - Icon-only knoppen?
   - Andere layout?

2. **Feedback animaties**: Hoe kan visuele feedback bij goed/fout antwoorden sterker?

3. **Dark mode details**: Zijn er subtiele verbeteringen mogelijk?

4. **Whitespace**: Is de balans goed of kan dit beter?

5. **Wat missen we nog?**: Welke UX-verbeteringen zouden de leerervaring verbeteren?
