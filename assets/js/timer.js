/* ===========================================
   Adamus - Timer Module
   =========================================== */

import { $, updateTimerWarning } from "./utils.js";

const DEFAULT_SECONDS = 90;

let timerId = null;
let remaining = DEFAULT_SECONDS;
let totalSeconds = DEFAULT_SECONDS;
let isPaused = false;
let onTimeUp = null;

/**
 * Initialize timer with callbacks
 */
export function initTimer(callbacks = {}) {
  onTimeUp = callbacks.onTimeUp || null;
}

/**
 * Start the timer
 */
export function startTimer() {
  stopTimer();
  updateTimerUI();

  timerId = setInterval(() => {
    if (isPaused) return;

    remaining--;
    updateTimerUI();

    if (remaining <= 0) {
      remaining = 0;
      stopTimer();
      if (onTimeUp) onTimeUp();
    }
  }, 1000);
}

/**
 * Stop the timer
 */
export function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

/**
 * Reset the timer to default
 */
export function resetTimer(seconds = DEFAULT_SECONDS) {
  remaining = seconds;
  totalSeconds = seconds;
  updateTimerUI();
}

/**
 * Pause the timer
 */
export function pauseTimer() {
  isPaused = true;
  updateTimerUI();
}

/**
 * Resume the timer
 */
export function resumeTimer() {
  isPaused = false;
  updateTimerUI();
}

/**
 * Get remaining seconds
 */
export function getRemaining() {
  return remaining;
}

/**
 * Check if timer is paused
 */
export function getIsPaused() {
  return isPaused;
}

// Mode: 'question' (per-question timer) or 'exam' (total exam timer)
let timerMode = "question";

/**
 * Set timer mode
 */
export function setTimerMode(mode) {
  timerMode = mode;
}

/**
 * Get timer mode
 */
export function getTimerMode() {
  return timerMode;
}

/**
 * Update timer UI elements
 */
function updateTimerUI() {
  const countdownEl = $("countdown");
  const dotEl = $("timerDot");
  const metaEl = $("timerMeta");
  const timerDisplayEl = $("timerDisplay");

  if (countdownEl) {
    // Format based on mode
    if (timerMode === "exam") {
      // Show mm:ss format for exam mode
      countdownEl.textContent = formatTime(remaining);
    } else {
      // Show seconds only for question mode
      countdownEl.textContent = String(remaining);
    }

    // Apply warning animations
    updateTimerWarning(countdownEl, metaEl, remaining, totalSeconds);
  }

  // Update display label for exam mode
  if (timerDisplayEl && timerMode === "exam") {
    const label = timerDisplayEl.childNodes[0];
    if (label && label.nodeType === Node.TEXT_NODE) {
      label.textContent = "Tijd: ";
    }
  }

  if (dotEl) {
    if (isPaused) {
      dotEl.className = "stat-dot paused";
    } else if (timerMode === "exam") {
      // Exam mode: warning at 5 min, critical at 2 min
      if (remaining <= 120) {
        dotEl.className = "stat-dot critical";
      } else if (remaining <= 300) {
        dotEl.className = "stat-dot warning";
      } else {
        dotEl.className = "stat-dot";
      }
    } else {
      // Question mode: warning at 15 sec, critical at 10 sec
      if (remaining <= 10) {
        dotEl.className = "stat-dot critical";
      } else if (remaining <= 15) {
        dotEl.className = "stat-dot warning";
      } else {
        dotEl.className = "stat-dot";
      }
    }
  }
}

/**
 * Format seconds as mm:ss
 */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
