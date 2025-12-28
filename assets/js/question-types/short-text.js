/* ===========================================
   Adamus - Short Text Question Type
   Single line text input
   =========================================== */

import { $ } from "../utils.js";
import {
  getState,
  checkAcceptList,
  showFeedback,
  awardPoints,
  updateSpacedRepetition,
  addToHistory,
  getQuestionPoints,
  isExamMode,
  setCheckButtonEnabled,
} from "./shared.js";

/**
 * Render short text question
 */
export function render(container, q) {
  container.innerHTML = `
    <div class="question-title">${q.prompt_html || q.q}</div>
    <div class="short-text-wrap">
      <input type="text"
             id="shortInput"
             class="short-input"
             placeholder="Typ je antwoord..."
             autocomplete="off"
             autocorrect="off"
             autocapitalize="off"
             spellcheck="false">
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  const input = $("shortInput");
  if (input) {
    input.addEventListener("input", () => {
      setCheckButtonEnabled(input.value.trim().length > 0);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim().length > 0) {
        e.preventDefault();
        const checkBtn = $("checkBtn");
        if (checkBtn) checkBtn.click();
      }
    });
    input.focus();
  }

  setCheckButtonEnabled(false);
}

/**
 * Check short text answer
 */
export function check(q) {
  const state = getState();
  const input = $("shortInput");
  const value = input ? input.value.trim() : "";
  const isCorrect = checkAcceptList(q.accept || [], value, q.caseSensitive);

  awardPoints(q.id, isCorrect);
  updateSpacedRepetition(isCorrect, q.id);

  if (input) {
    input.classList.add(isCorrect ? "input-correct" : "input-wrong");
    input.disabled = true;
  }

  addToHistory({
    question: q.prompt_html || q.q,
    type: "short_text",
    userAnswer: value,
    correctAnswer: q.accept?.[0] || "",
    correct: isCorrect,
    explanation: q.explanation,
    points: isExamMode() ? getQuestionPoints(q.id) : 1,
  });

  showFeedback(isCorrect, q.explanation, q.accept?.[0]);

  return {
    correct: isCorrect,
    score: isCorrect ? (q.points || 1) : 0,
    maxScore: q.points || 1,
  };
}
