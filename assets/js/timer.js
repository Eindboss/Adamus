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

/**
 * Update timer UI elements
 */
function updateTimerUI() {
  const countdownEl = $("countdown");
  const dotEl = $("timerDot");
  const metaEl = $("timerMeta");

  if (countdownEl) {
    countdownEl.textContent = String(remaining);

    // Apply warning animations
    updateTimerWarning(countdownEl, metaEl, remaining, totalSeconds);
  }

  if (dotEl) {
    if (isPaused) {
      dotEl.className = "stat-dot paused";
    } else if (remaining <= 10) {
      dotEl.className = "stat-dot danger";
    } else {
      dotEl.className = "stat-dot";
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
