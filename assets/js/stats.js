/* ===========================================
   Adamus - Stats Module
   Score tracking, localStorage, history
   =========================================== */

const STORAGE_PREFIX = 'adamus:';

/**
 * Get storage key for subject
 */
function getStorageKey(subjectId) {
  return `${STORAGE_PREFIX}${subjectId}:stats`;
}

/**
 * Read stats from localStorage
 */
export function readStats(subjectId) {
  const key = getStorageKey(subjectId);
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : { rounds: 0, correct: 0, total: 0 };
  } catch (e) {
    console.warn('Error reading stats:', e);
    return { rounds: 0, correct: 0, total: 0 };
  }
}

/**
 * Write stats to localStorage
 */
export function writeStats(subjectId, stats) {
  const key = getStorageKey(subjectId);
  try {
    localStorage.setItem(key, JSON.stringify(stats));
  } catch (e) {
    console.warn('Error writing stats:', e);
  }
}

/**
 * Update stats after answer
 */
export function updateStats(subjectId, isCorrect) {
  const stats = readStats(subjectId);
  stats.total += 1;
  if (isCorrect) {
    stats.correct += 1;
  }
  writeStats(subjectId, stats);
  return stats;
}

/**
 * Increment round count
 */
export function incrementRounds(subjectId) {
  const stats = readStats(subjectId);
  stats.rounds += 1;
  writeStats(subjectId, stats);
  return stats;
}

/**
 * Clear stats for a subject
 */
export function clearStats(subjectId) {
  const key = getStorageKey(subjectId);
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('Error clearing stats:', e);
  }
}

/**
 * Get all stored stats
 */
export function getAllStats() {
  const stats = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX) && key.endsWith(':stats')) {
        const subjectId = key.replace(STORAGE_PREFIX, '').replace(':stats', '');
        stats[subjectId] = readStats(subjectId);
      }
    }
  } catch (e) {
    console.warn('Error getting all stats:', e);
  }
  return stats;
}

/**
 * Session history tracking
 */
export class SessionHistory {
  constructor() {
    this.history = [];
  }

  add(entry) {
    this.history.push({
      timestamp: Date.now(),
      ...entry
    });
  }

  getAll() {
    return [...this.history];
  }

  clear() {
    this.history = [];
  }

  getCorrectCount() {
    return this.history.filter(h => h.correct).length;
  }

  getWrongCount() {
    return this.history.filter(h => !h.correct && !h.skipped).length;
  }

  getSkippedCount() {
    return this.history.filter(h => h.skipped).length;
  }

  getTotal() {
    return this.history.length;
  }
}

/**
 * Create a new session history instance
 */
export function createSessionHistory() {
  return new SessionHistory();
}
