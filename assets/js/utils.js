/* ===========================================
   Adamus - Utility Functions
   =========================================== */

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
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load ${path} (${response.status})`);
    }
    return await response.json();
  } catch (error) {
    console.error('loadJSON error:', error);
    throw error;
  }
}

/**
 * Strip HTML tags from string
 */
export function htmlToText(html) {
  if (typeof html !== 'string') return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
  window.history.replaceState({}, '', url);
}

/**
 * Escape HTML entities
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
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
  while (s.length < size) s = '0' + s;
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
 */
export function getSubjectAccent(subject) {
  const s = String(subject || '').toLowerCase();

  if (s.startsWith('aardrijkskunde')) {
    return {
      color: '#3b82f6',
      light: '#dbeafe',
      dark: '#1d4ed8',
      name: 'blue'
    };
  }

  if (s.startsWith('geschiedenis')) {
    return {
      color: '#ef4444',
      light: '#fee2e2',
      dark: '#dc2626',
      name: 'red'
    };
  }

  if (s.startsWith('latijn')) {
    return {
      color: '#22c55e',
      light: '#dcfce7',
      dark: '#16a34a',
      name: 'green'
    };
  }

  // Default purple
  return {
    color: '#8b5cf6',
    light: '#ede9fe',
    dark: '#7c3aed',
    name: 'purple'
  };
}

/**
 * Get icon SVG for subject
 */
export function getSubjectIcon(subject) {
  const s = String(subject || '').toLowerCase();

  if (s.startsWith('aardrijkskunde')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`;
  }

  if (s.startsWith('geschiedenis')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/>
      <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2"/>
      <path d="M12 5v-2"/>
      <path d="M8 21v-4a2 2 0 0 1 4 0v4"/>
    </svg>`;
  }

  if (s.startsWith('latijn')) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
      <path d="M8 7h6M8 11h8"/>
    </svg>`;
  }

  // Default book icon
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
  </svg>`;
}

/**
 * Extract subject name from meta
 */
export function extractSubject(meta) {
  if (meta.subject) return String(meta.subject).trim();

  const raw = meta.label || meta.title || meta.id || '';
  const parts = String(raw).split(/\s[–-]\s/);
  if (parts.length >= 2) return parts[0].trim();

  const id = String(meta.id || '').toLowerCase();
  if (id.startsWith('aardrijkskunde')) return 'Aardrijkskunde';
  if (id.startsWith('geschiedenis')) return 'Geschiedenis';
  if (id.startsWith('latijn')) return 'Latijn';

  return 'Vak';
}

/**
 * Extract quiz title from meta (without subject prefix)
 */
export function extractQuizTitle(meta, subject) {
  const raw = meta.label || meta.title || meta.id || '';
  return String(raw)
    .replace(new RegExp(`^\\s*${subject}\\s*[–-]\\s*`, 'i'), '')
    .trim() || raw;
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
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
    normalized = normalized.replace(/[.,!?;:'"()[\]{}<>\/\\@#$%^&*_+=|~`-]/g, '');
  }

  // Collapse whitespace
  if (options.collapse_whitespace) {
    normalized = normalized.replace(/\s+/g, ' ').trim();
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
export function matchesAcceptList(input, accepted = [], aliases = {}, options = {}) {
  if (!input || !accepted.length) return false;

  // Default options for answer matching
  const opts = {
    lowercase: true,
    trim: true,
    ...options
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
          if (accepted.some(a => normalizeAnswer(a, opts) === normalizeAnswer(key, opts))) {
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
