/* ===========================================
   Adamus - Shared Question Type Utilities
   Common functions used by multiple question types
   =========================================== */

import { $, $$, $$$ } from "../utils.js";
import { updateStats, updateQuestionBox } from "../stats.js";

/**
 * Shared state - set by quiz.js
 */
let state = null;
let showFeedbackFn = null;
let awardPointsFn = null;

/**
 * Initialize shared utilities
 */
export function initShared(quizState, showFeedback, awardPoints) {
  state = quizState;
  showFeedbackFn = showFeedback;
  awardPointsFn = awardPoints;
}

/**
 * Get current quiz state
 */
export function getState() {
  return state;
}

/**
 * Get showFeedback function
 */
export function showFeedback(isCorrect, explanation, correctAnswer) {
  if (showFeedbackFn) {
    showFeedbackFn(isCorrect, explanation, correctAnswer);
  }
}

/**
 * Award points for a question
 */
export function awardPoints(questionId, isCorrect) {
  if (awardPointsFn) {
    awardPointsFn(questionId, isCorrect);
  }
}

/**
 * Update spaced repetition stats
 */
export function updateSpacedRepetition(isCorrect, questionId) {
  if (state?.subjectId) {
    updateStats(state.subjectId, isCorrect);
    if (questionId) {
      updateQuestionBox(state.subjectId, questionId, isCorrect);
    }
  }
}

/**
 * Add entry to history
 */
export function addToHistory(entry) {
  if (state?.history) {
    state.history.add(entry);
  }
}

/**
 * Select an MC option
 */
export function selectOption(el) {
  if (state?.answered) return;

  // Deselect all
  $$$(".option").forEach((opt) => {
    opt.classList.remove("selected");
    opt.setAttribute("aria-checked", "false");
  });

  // Select this one
  el.classList.add("selected");
  el.setAttribute("aria-checked", "true");
  state.selectedOption = parseInt(el.dataset.idx, 10);

  // Enable check button
  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = false;
}

/**
 * Check if user input matches any accepted answer
 * @param {string[]} acceptList - List of accepted answers
 * @param {string} input - User's input
 * @param {boolean} caseSensitive - Whether to match case
 * @returns {boolean}
 */
export function checkAcceptList(acceptList, input, caseSensitive = false) {
  if (!acceptList || acceptList.length === 0) return false;
  if (!input) return false;

  const normalizedInput = caseSensitive ? input.trim() : input.trim().toLowerCase();

  return acceptList.some((accepted) => {
    if (!accepted) return false;
    const normalizedAccepted = caseSensitive
      ? String(accepted).trim()
      : String(accepted).trim().toLowerCase();
    return normalizedInput === normalizedAccepted;
  });
}

/**
 * Normalize answer for comparison
 * Removes extra spaces, normalizes diacritics, etc.
 */
export function normalizeAnswer(answer) {
  if (!answer) return "";
  return answer
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Get points for a question (exam mode)
 */
export function getQuestionPoints(questionId) {
  if (!state?.examPointsMap || !questionId) return 1;
  return state.examPointsMap.get(questionId) || 1;
}

/**
 * Check if in exam mode
 */
export function isExamMode() {
  return state?.mode === "exam";
}

/**
 * Enable/disable check button
 */
export function setCheckButtonEnabled(enabled) {
  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = !enabled;
}

/**
 * Build image layout HTML if question has image
 */
export function wrapWithImageLayout(contentHtml, q) {
  if (q.image) {
    const altText = q.imageAlt || q.media?.alt || "Afbeelding bij vraag";
    return `
      <div class="question-layout">
        <div class="question-image"><img src="${q.image}" alt="${altText}"></div>
        <div class="question-content">${contentHtml}</div>
      </div>
    `;
  }
  return contentHtml;
}

/**
 * Get question text from various schema formats
 */
export function getQuestionText(q) {
  return q.prompt?.html || q.prompt?.text || q.q || q.title || "Vraag";
}

/**
 * Get accepted answers from various schema formats
 */
export function getAcceptedAnswers(q) {
  return q.payload?.accepted_answers || q.accept || [];
}

/**
 * Get explanation from various schema formats
 */
export function getExplanation(q) {
  return q.feedback?.explanation || q.explanation || "";
}
