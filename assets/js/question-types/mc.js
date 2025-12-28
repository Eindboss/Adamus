/* ===========================================
   Adamus - Multiple Choice Question Type
   =========================================== */

import { $, $$, $$$ } from "../utils.js";
import {
  getState,
  selectOption,
  showFeedback,
  awardPoints,
  updateSpacedRepetition,
  addToHistory,
  wrapWithImageLayout,
  getQuestionPoints,
  isExamMode,
} from "./shared.js";

/**
 * Render multiple choice question
 * @param {HTMLElement} container - Quiz area container
 * @param {Object} q - Question data
 *   q.q - Question text
 *   q.answers - Array of answer options
 *   q.correctIndex - Index of correct answer
 *   q.image - Optional image URL
 *   q.explanation - Optional explanation
 */
export function render(container, q) {
  const optionsHtml = q.answers
    .map(
      (answer, idx) => `
    <div class="option" data-idx="${idx}" tabindex="0" role="radio" aria-checked="false">
      <span class="option-marker">${String.fromCharCode(65 + idx)}</span>
      <span class="option-text">${answer}</span>
    </div>
  `
    )
    .join("");

  const contentHtml = `
    <div class="question-title">${q.q}</div>
    <div class="options-list" role="radiogroup">
      ${optionsHtml}
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  container.innerHTML = wrapWithImageLayout(contentHtml, q);

  // Add click handlers to options
  $$$(".option", container).forEach((el) => {
    el.addEventListener("click", () => selectOption(el));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectOption(el);
      }
    });
  });

  // Focus first option
  const first = $$(".option", container);
  if (first) first.focus();
}

/**
 * Check multiple choice answer
 * @param {Object} q - Question data
 * @returns {Object} Result with correct, score, feedback
 */
export function check(q) {
  const state = getState();
  const isCorrect = state.selectedOption === q.correctIndex;

  // Mark options visually
  $$$(".option").forEach((el, idx) => {
    el.classList.add("disabled");
    if (idx === q.correctIndex) {
      el.classList.add("correct");
    }
    if (idx === state.selectedOption && !isCorrect) {
      el.classList.add("wrong");
    }
  });

  // Update stats and spaced repetition
  awardPoints(q.id, isCorrect);
  updateSpacedRepetition(isCorrect, q.id);

  // Add to history
  addToHistory({
    question: q.q,
    type: "mc",
    userAnswer: q.answers[state.selectedOption],
    correctAnswer: q.answers[q.correctIndex],
    correct: isCorrect,
    explanation: q.explanation,
    points: isExamMode() ? getQuestionPoints(q.id) : 1,
  });

  // Show feedback
  showFeedback(isCorrect, q.explanation, q.answers[q.correctIndex]);

  return {
    correct: isCorrect,
    score: isCorrect ? (q.points || 1) : 0,
    maxScore: q.points || 1,
  };
}
