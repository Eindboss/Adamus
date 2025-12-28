/* ===========================================
   Adamus - Open Question Type
   =========================================== */

import { $, $$, $$$ } from "../utils.js";
import {
  getState,
  checkAcceptList,
  showFeedback,
  awardPoints,
  updateSpacedRepetition,
  addToHistory,
  wrapWithImageLayout,
  getQuestionPoints,
  isExamMode,
  setCheckButtonEnabled,
} from "./shared.js";

/**
 * Render open question (text input)
 * @param {HTMLElement} container - Quiz area container
 * @param {Object} q - Question data
 *   q.q - Question text
 *   q.accept - Array of accepted answers
 *   q.image - Optional image URL
 *   q.explanation - Optional explanation
 */
export function render(container, q) {
  const contentHtml = `
    <div class="question-title">${q.q}</div>
    <div class="open-input-wrap">
      <input type="text" class="open-input short-input" id="openInput"
        placeholder="Type je antwoord..."
        autocomplete="off" autocorrect="off" spellcheck="false">
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  container.innerHTML = wrapWithImageLayout(contentHtml, q);

  // Focus input and setup listeners
  const input = $("openInput");
  if (input) {
    input.focus();

    input.addEventListener("input", () => {
      setCheckButtonEnabled(input.value.trim().length > 0);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        const checkBtn = $("checkBtn");
        if (checkBtn && !checkBtn.disabled) {
          checkBtn.click();
        }
      }
    });
  }

  setCheckButtonEnabled(false);
}

/**
 * Check open answer
 * @param {Object} q - Question data
 * @returns {Object} Result with correct, score, feedback
 */
export function check(q) {
  const state = getState();
  const input = $("openInput");
  const value = input ? input.value.trim() : "";
  const isCorrect = checkAcceptList(q.accept || [], value, q.caseSensitive);

  awardPoints(q.id, isCorrect);
  updateSpacedRepetition(isCorrect, q.id);

  // Visual feedback
  if (input) {
    input.classList.add(isCorrect ? "input-correct" : "input-wrong");
    input.disabled = true;
  }

  // Add to history
  addToHistory({
    question: q.q,
    type: "open",
    userAnswer: value,
    correctAnswer: q.accept?.[0] || "",
    correct: isCorrect,
    explanation: q.explanation,
    points: isExamMode() ? getQuestionPoints(q.id) : 1,
  });

  // Show feedback
  showFeedback(isCorrect, q.explanation, q.accept?.[0]);

  return {
    correct: isCorrect,
    score: isCorrect ? (q.points || 1) : 0,
    maxScore: q.points || 1,
  };
}
