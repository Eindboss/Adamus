/* ===========================================
   Adamus - Utility Functions
   =========================================== */

/**
 * Strict text normalization for comparison
 * Always: lowercase, remove accents, punctuation to space, normalize whitespace
 * Used by answer-checker.js and other modules that need consistent normalization
 */
export function normalizeStrict(text) {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^\w\s]/g, " ")        // punctuation to space
    .replace(/\s+/g, " ")            // normalize whitespace
    .trim();
}

/**
 * DOM Helpers
 */
export function $(id) {
  return document.getElementById(id);
}

export function $$(selector, root = document) {
  return root.querySelector(selector);
}

export function $$$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * Shuffle array in place (Fisher-Yates)
 */
export function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Load JSON file
 */
export async function loadJSON(path) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load ${path} (${response.status})`);
    }
    return await response.json();
  } catch (error) {
    console.error("loadJSON error:", error);
    throw error;
  }
}

/**
 * Strip HTML tags from string
 */
export function htmlToText(html) {
  if (typeof html !== "string") return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Get URL parameter
 */
export function getUrlParam(name) {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Set URL parameter without reload
 */
export function setUrlParam(name, value) {
  const url = new URL(window.location);
  url.searchParams.set(name, value);
  window.history.replaceState({}, "", url);
}

/**
 * Escape HTML entities
 */
export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Debounce function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Format number with leading zero
 */
export function pad(num, size = 2) {
  let s = String(num);
  while (s.length < size) s = "0" + s;
  return s;
}

/**
 * Check if arrays are equal (shallow)
 */
export function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Get accent colors for subject
 * All subjects now use unified brand colors (teal)
 */
export function getSubjectAccent(subject) {
  // Unified brand colors for all subjects
  return {
    color: "#0d9488",
    light: "#ccfbf1",
    dark: "#0f766e",
    name: "brand",
  };
}

/**
 * Get icon SVG for subject
 */
export function getSubjectIcon(subject) {
  const s = String(subject || "").toLowerCase();

  if (s.startsWith("aardrijkskunde")) {
    // Globe / wereldbol
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M2 12h20"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`;
  }

  if (s.startsWith("geschiedenis")) {
    // Greek/Roman temple with columns
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 21h18"/>
      <path d="M5 21v-10"/>
      <path d="M9 21v-10"/>
      <path d="M15 21v-10"/>
      <path d="M19 21v-10"/>
      <path d="M2 11l10-8 10 8"/>
      <path d="M4 11h16"/>
    </svg>`;
  }

  if (s.startsWith("latijn")) {
    // Roman laurel wreath
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 8c0-2 1-4 3-5 0 2-1 4-3 5z"/>
      <path d="M4 12c-1-2-1-4 1-6 1 2 1 4-1 6z"/>
      <path d="M5 16c-2-1-3-3-2-5 2 0 3 3 2 5z"/>
      <path d="M8 19c-2 0-4-1-5-3 2-1 4 0 5 3z"/>
      <path d="M19 8c0-2-1-4-3-5 0 2 1 4 3 5z"/>
      <path d="M20 12c1-2 1-4-1-6-1 2-1 4 1 6z"/>
      <path d="M19 16c2-1 3-3 2-5-2 0-3 3-2 5z"/>
      <path d="M16 19c2 0 4-1 5-3-2-1-4 0-5 3z"/>
      <path d="M12 19v3"/>
    </svg>`;
  }

  if (s.startsWith("biologie")) {
    // DNA helix
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 15c6.667-6 13.333 0 20-6"/>
      <path d="M9 22c1.8-2 2.5-4 2.8-6"/>
      <path d="M15 2c-1.8 2-2.5 4-2.8 6"/>
      <path d="M17 6l-2.5 2.5"/>
      <path d="M14 8l-1.5 1.5"/>
      <path d="M7 18l2.5-2.5"/>
      <path d="M3.5 14.5l1 -1"/>
      <path d="M20.5 9.5l-1 1"/>
      <path d="M10 16l1.5-1.5"/>
      <path d="M2 9c6.667 6 13.333 0 20 6"/>
    </svg>`;
  }

  if (s.startsWith("engels")) {
    // Speech bubble / conversation
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <path d="M8 9h8"/>
      <path d="M8 13h6"/>
    </svg>`;
  }

  if (s.startsWith("frans")) {
    // Eiffel Tower
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2L8 22"/>
      <path d="M12 2l4 20"/>
      <path d="M6 10h12"/>
      <path d="M7 16h10"/>
      <path d="M10 6h4"/>
      <path d="M4 22h16"/>
    </svg>`;
  }

  if (s.startsWith("nederlands")) {
    // Pen / writing
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
      <path d="m15 5 4 4"/>
    </svg>`;
  }

  if (s.startsWith("wiskunde")) {
    // Compass / passer
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="5" r="3"/>
      <path d="M12 8v2"/>
      <path d="M8 10l-5 12"/>
      <path d="M16 10l5 12"/>
      <path d="M6 16h12"/>
    </svg>`;
  }

  // Default book icon
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
    <path d="M8 7h6"/>
    <path d="M8 11h8"/>
  </svg>`;
}

/**
 * Extract subject name from meta
 */
export function extractSubject(meta) {
  if (meta.subject) return String(meta.subject).trim();

  const raw = meta.label || meta.title || meta.id || "";
  const parts = String(raw).split(/\s[–-]\s/);
  if (parts.length >= 2) return parts[0].trim();

  const id = String(meta.id || "").toLowerCase();
  if (id.startsWith("aardrijkskunde")) return "Aardrijkskunde";
  if (id.startsWith("geschiedenis")) return "Geschiedenis";
  if (id.startsWith("latijn")) return "Latijn";

  return "Vak";
}

/**
 * Extract quiz title from meta (without subject prefix)
 */
export function extractQuizTitle(meta, subject) {
  const raw = meta.label || meta.title || meta.id || "";
  return (
    String(raw)
      .replace(new RegExp(`^\\s*${subject}\\s*[–-]\\s*`, "i"), "")
      .trim() || raw
  );
}

/* ===========================================
   Answer Normalization & Matching
   For complex question types
   =========================================== */

/**
 * Remove diacritics (accents) from text
 * e.g., "café" → "cafe", "naïve" → "naive"
 */
export function removeDiacritics(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalize text for comparison
 * @param {string} text - Input text
 * @param {object} options - Normalization options
 * @param {boolean} options.lowercase - Convert to lowercase
 * @param {boolean} options.strip_punctuation - Remove punctuation
 * @param {boolean} options.collapse_whitespace - Collapse multiple spaces
 * @param {boolean} options.normalize_diacritics - Remove accents
 * @param {boolean} options.trim - Trim whitespace (default: true)
 */
export function normalizeAnswer(text, options = {}) {
  let normalized = String(text);

  // Always trim by default
  if (options.trim !== false) {
    normalized = normalized.trim();
  }

  // Remove diacritics (accents)
  if (options.normalize_diacritics) {
    normalized = removeDiacritics(normalized);
  }

  // Convert to lowercase
  if (options.lowercase) {
    normalized = normalized.toLowerCase();
  }

  // Remove punctuation
  if (options.strip_punctuation) {
    normalized = normalized.replace(
      /[.,!?;:'"()[\]{}<>\/\\@#$%^&*_+=|~`-]/g,
      "",
    );
  }

  // Collapse whitespace
  if (options.collapse_whitespace) {
    normalized = normalized.replace(/\s+/g, " ").trim();
  }

  return normalized;
}

/**
 * Check if user input matches any accepted answer
 * Supports aliases and normalization options
 *
 * @param {string} input - User's answer
 * @param {string[]} accepted - List of accepted answers
 * @param {object} aliases - Optional alias map { "key": ["alias1", "alias2"] }
 * @param {object} options - Normalization options
 * @returns {boolean} - True if input matches any accepted answer
 */
export function matchesAcceptList(
  input,
  accepted = [],
  aliases = {},
  options = {},
) {
  if (!input || !accepted.length) return false;

  // Default options for answer matching
  const opts = {
    lowercase: true,
    trim: true,
    ...options,
  };

  const normalizedInput = normalizeAnswer(input, opts);

  // Check direct matches
  for (const accept of accepted) {
    const normalizedAccept = normalizeAnswer(accept, opts);
    if (normalizedInput === normalizedAccept) {
      return true;
    }

    // Check aliases for this accepted answer
    const aliasesForAccept = aliases[accept];
    if (Array.isArray(aliasesForAccept)) {
      for (const alias of aliasesForAccept) {
        if (normalizedInput === normalizeAnswer(alias, opts)) {
          return true;
        }
      }
    }
  }

  // Also check if input matches any alias key directly
  for (const [key, aliasList] of Object.entries(aliases)) {
    if (Array.isArray(aliasList)) {
      for (const alias of aliasList) {
        if (normalizedInput === normalizeAnswer(alias, opts)) {
          // Check if this key is in accepted list
          if (
            accepted.some(
              (a) => normalizeAnswer(a, opts) === normalizeAnswer(key, opts),
            )
          ) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Count fillable cells in table_parse blocks
 */
export function countFillableCells(blocks) {
  let count = 0;
  for (const block of blocks) {
    for (const row of block.rows || []) {
      if (row.invulbaar) count++;
    }
  }
  return count;
}

/**
 * Count total inputs needed for grouped questions
 */
export function countGroupedInputs(items) {
  let count = 0;
  for (const item of items) {
    if (Array.isArray(item.subfields) && item.subfields.length > 0) {
      count += item.subfields.length;
    } else {
      count++;
    }
  }
  return count;
}

// ===========================================
// Confetti Animation
// ===========================================

const confettiColors = [
  "#0d9488", // brand teal
  "#14b8a6", // teal-500
  "#5eead4", // teal-300
  "#4ade80", // success green
  "#f59e0b", // amber
  "#8b5cf6", // purple
];

/**
 * Show confetti celebration
 */
export function showConfetti(duration = 3000) {
  const container = document.createElement("div");
  container.className = "confetti-container";
  document.body.appendChild(container);

  // Create confetti pieces
  const pieceCount = 50;
  for (let i = 0; i < pieceCount; i++) {
    const confetti = document.createElement("div");
    confetti.className = "confetti";
    confetti.style.cssText = `
      left: ${Math.random() * 100}%;
      background: ${confettiColors[Math.floor(Math.random() * confettiColors.length)]};
      animation-delay: ${Math.random() * 2}s;
      animation-duration: ${2 + Math.random() * 2}s;
      transform: rotate(${Math.random() * 360}deg);
      width: ${5 + Math.random() * 10}px;
      height: ${5 + Math.random() * 10}px;
      border-radius: ${Math.random() > 0.5 ? "50%" : "0"};
    `;
    container.appendChild(confetti);
  }

  // Remove after animation
  setTimeout(() => {
    container.remove();
  }, duration + 1000);
}

// ===========================================
// Timer Warnings
// ===========================================

/**
 * Update timer with warning states
 */
export function updateTimerWarning(timerEl, metaEl, secondsLeft, totalSeconds) {
  if (!timerEl) return;

  const percentage = secondsLeft / totalSeconds;

  // Remove existing classes
  timerEl.classList.remove("timer-warning", "timer-critical");
  if (metaEl) metaEl.classList.remove("timer-urgent");

  if (percentage <= 0.1 || secondsLeft <= 10) {
    // Critical: less than 10% or 10 seconds
    timerEl.classList.add("timer-critical");
    if (metaEl) metaEl.classList.add("timer-urgent");
  } else if (percentage <= 0.25 || secondsLeft <= 30) {
    // Warning: less than 25% or 30 seconds
    timerEl.classList.add("timer-warning");
  }
}

// ===========================================
// Error Boundary
// ===========================================

/**
 * Show error message with retry option
 */
export function showError(container, message, onRetry = null) {
  const errorHtml = `
    <div class="error-boundary">
      <div class="card" style="text-align: center; padding: var(--space-6);">
        <div style="font-size: 3rem; margin-bottom: var(--space-4);">⚠️</div>
        <h3 style="margin-bottom: var(--space-2);">Er ging iets mis</h3>
        <p style="color: var(--muted); margin-bottom: var(--space-4);">${message}</p>
        ${onRetry ? '<button class="btn btn-primary error-retry">Opnieuw proberen</button>' : ""}
      </div>
    </div>
  `;

  if (typeof container === "string") {
    container = document.querySelector(container);
  }

  if (container) {
    container.innerHTML = errorHtml;

    if (onRetry) {
      const retryBtn = container.querySelector(".error-retry");
      if (retryBtn) {
        retryBtn.addEventListener("click", () => {
          container.innerHTML = "";
          onRetry();
        });
      }
    }
  }
}

// ===========================================
// Loading States
// ===========================================

/**
 * Show loading spinner
 */
export function showLoading(container, message = "Laden...") {
  const loadingHtml = `
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>${message}</p>
    </div>
  `;

  if (typeof container === "string") {
    container = document.querySelector(container);
  }

  if (container) {
    container.innerHTML = loadingHtml;
  }
}

/**
 * Show skeleton loading cards
 */
export function showSkeletonCards(container, count = 3) {
  let html = "";
  for (let i = 0; i < count; i++) {
    html += `<div class="skeleton-loading skeleton-card"></div>`;
  }

  if (typeof container === "string") {
    container = document.querySelector(container);
  }

  if (container) {
    container.innerHTML = html;
  }
}

// ===========================================
// Quiz Progress Saving
// ===========================================

const PROGRESS_KEY = "adamus-quiz-progress";

/**
 * Save quiz progress
 */
export function saveQuizProgress(subjectId, data) {
  try {
    const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    progress[subjectId] = {
      ...data,
      savedAt: Date.now(),
    };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (e) {
    console.warn("Failed to save progress:", e);
  }
}

/**
 * Load quiz progress
 */
export function loadQuizProgress(subjectId) {
  try {
    const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    const saved = progress[subjectId];

    // Check if progress is recent (within 24 hours)
    if (saved && Date.now() - saved.savedAt < 24 * 60 * 60 * 1000) {
      return saved;
    }
    return null;
  } catch (e) {
    console.warn("Failed to load progress:", e);
    return null;
  }
}

/**
 * Clear quiz progress
 */
export function clearQuizProgress(subjectId) {
  try {
    const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    delete progress[subjectId];
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (e) {
    console.warn("Failed to clear progress:", e);
  }
}

/**
 * Check if there's saved progress
 */
export function hasQuizProgress(subjectId) {
  return loadQuizProgress(subjectId) !== null;
}
