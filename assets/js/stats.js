/* ===========================================
   Adamus - Stats Module
   Score tracking, localStorage, history
   Spaced repetition tracking per question
   =========================================== */

const STORAGE_PREFIX = 'adamus:';

/* ===========================================
   Spaced Repetition System
   Each question has a "box" (1-5):
   - Box 1: Show every session (new/difficult)
   - Box 2: Show every 2 sessions
   - Box 3: Show every 4 sessions
   - Box 4: Show every 8 sessions
   - Box 5: Mastered (rarely show)

   Correct answer: move up one box
   Wrong answer: move back to box 1
   =========================================== */

/**
 * Get spaced repetition data for a subject
 */
export function getSpacedData(subjectId) {
  const key = `${STORAGE_PREFIX}${subjectId}:spaced`;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : { questions: {}, sessionCount: 0 };
  } catch (e) {
    console.warn('Error reading spaced data:', e);
    return { questions: {}, sessionCount: 0 };
  }
}

/**
 * Save spaced repetition data
 */
export function saveSpacedData(subjectId, data) {
  const key = `${STORAGE_PREFIX}${subjectId}:spaced`;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('Error saving spaced data:', e);
  }
}

/**
 * Update question box after answering
 * @param {string} subjectId
 * @param {string} questionId
 * @param {boolean} correct
 */
export function updateQuestionBox(subjectId, questionId, correct) {
  const data = getSpacedData(subjectId);

  // Initialize question if not exists
  if (!data.questions[questionId]) {
    data.questions[questionId] = { box: 1, correct: 0, wrong: 0, lastSeen: 0 };
  }

  const q = data.questions[questionId];
  q.lastSeen = data.sessionCount;

  if (correct) {
    q.correct++;
    // Move up one box (max 5)
    q.box = Math.min(q.box + 1, 5);
  } else {
    q.wrong++;
    // Move back to box 1
    q.box = 1;
  }

  saveSpacedData(subjectId, data);
  return q;
}

/**
 * Increment session count (call at start of quiz)
 */
export function incrementSession(subjectId) {
  const data = getSpacedData(subjectId);
  data.sessionCount++;
  saveSpacedData(subjectId, data);
  return data.sessionCount;
}

/**
 * Get questions that should be shown this session based on spaced repetition
 * @param {string} subjectId
 * @param {Array} allQuestions - All available questions
 * @returns {Array} Questions to show (prioritized)
 */
export function getSpacedQuestions(subjectId, allQuestions) {
  const data = getSpacedData(subjectId);
  const session = data.sessionCount;

  // Box intervals: how many sessions between reviews
  const intervals = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

  const prioritized = allQuestions.map(q => {
    const qData = data.questions[q.id] || { box: 1, lastSeen: -999 };
    const interval = intervals[qData.box] || 1;
    const sessionsSince = session - qData.lastSeen;
    const isDue = sessionsSince >= interval;

    // Priority: lower box = higher priority, due questions first
    const priority = isDue ? (6 - qData.box) * 100 : (6 - qData.box);

    return { ...q, _spacedData: qData, _priority: priority, _isDue: isDue };
  });

  // Sort by priority (highest first), then shuffle within same priority
  prioritized.sort((a, b) => b._priority - a._priority);

  return prioritized;
}

/**
 * Get mastery stats for a subject
 */
export function getMasteryStats(subjectId, totalQuestions) {
  const data = getSpacedData(subjectId);
  const boxes = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  Object.values(data.questions).forEach(q => {
    boxes[q.box] = (boxes[q.box] || 0) + 1;
  });

  // Questions not yet seen are in "box 0"
  const seen = Object.values(data.questions).length;
  const unseen = Math.max(0, totalQuestions - seen);

  return {
    unseen,
    learning: boxes[1] + boxes[2],
    reviewing: boxes[3] + boxes[4],
    mastered: boxes[5],
    total: totalQuestions,
    sessionCount: data.sessionCount
  };
}

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
