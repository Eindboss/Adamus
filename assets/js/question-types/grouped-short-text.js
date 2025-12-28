/* ===========================================
   Adamus - Grouped Short Text Question Type
   Multiple text inputs with optional subfields
   Used for: vocabulary, declensions, grammar analysis
   =========================================== */

import { $, $$, $$$ } from "../utils.js";
import {
  getState,
  showFeedback,
  awardPoints,
  updateSpacedRepetition,
  addToHistory,
  setCheckButtonEnabled,
} from "./shared.js";

/**
 * Count total inputs in grouped items
 */
function countGroupedInputs(items) {
  return items.reduce((total, item) => {
    if (Array.isArray(item.subfields) && item.subfields.length > 0) {
      return total + item.subfields.length;
    }
    return total + 1;
  }, 0);
}

/**
 * Update progress counter
 */
function updateGroupProgress() {
  const inputs = $$$(".grouped-input");
  const filled = inputs.filter((i) => i.value.trim().length > 0).length;
  const counter = $("groupFilled");
  if (counter) counter.textContent = filled;
  setCheckButtonEnabled(filled > 0);
}

/**
 * Match value against accepted answers
 */
function matchesAcceptList(value, acceptList, options = {}) {
  if (!value || !acceptList || acceptList.length === 0) return false;
  const normalized = value.toLowerCase().trim();
  return acceptList.some((accepted) => {
    if (!accepted) return false;
    return normalized === String(accepted).toLowerCase().trim();
  });
}

/**
 * Render grouped short text question
 */
export function render(container, q) {
  const items = q.words || q.items || [];

  const itemsHtml = items
    .map((item, idx) => {
      const hasSubfields =
        Array.isArray(item.subfields) && item.subfields.length > 0;
      const latinText = item.latijn || item.vraag || item.question || "";

      if (hasSubfields) {
        const subfieldsHtml = item.subfields
          .map(
            (sf, sfIdx) => `
        <div class="subfield-row">
          <label class="subfield-label">${sf.label}:</label>
          <input type="text"
                 id="word-${idx}-sf-${sfIdx}"
                 class="grouped-input subfield-input"
                 data-word="${idx}"
                 data-subfield="${sfIdx}"
                 placeholder="..."
                 autocomplete="off">
        </div>
      `
          )
          .join("");

        return `
        <div class="grouped-item" data-idx="${idx}">
          <div class="grouped-latin">${latinText}</div>
          <div class="grouped-subfields">${subfieldsHtml}</div>
        </div>
      `;
      }

      // Check if this item has a subheader (for grouping items under a sentence)
      const subheaderHtml = item.subheader
        ? `<div class="grouped-subheader">${item.subheader}</div>`
        : "";

      return `
      ${subheaderHtml}
      <div class="grouped-item" data-idx="${idx}">
        <label class="grouped-latin">${latinText}</label>
        <input type="text"
               id="word-${idx}"
               class="grouped-input"
               data-word="${idx}"
               placeholder="..."
               autocomplete="off">
      </div>
    `;
    })
    .join("");

  const totalInputs = countGroupedInputs(items);

  container.innerHTML = `
    <div class="question-title">${q.prompt_html || q.prompt?.html || "Vertaal de woorden."}</div>
    <div class="grouped-list">
      ${itemsHtml}
    </div>
    <div class="group-progress">
      <span id="groupFilled">0</span> / <span>${totalInputs}</span> ingevuld
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  // Track inputs
  $$$(".grouped-input", container).forEach((input) => {
    input.addEventListener("input", updateGroupProgress);
  });

  // Focus first input
  const firstInput = $$(".grouped-input", container);
  if (firstInput) firstInput.focus();

  setCheckButtonEnabled(false);
}

/**
 * Show grouped feedback with results per item
 */
function showGroupedFeedback(correctCount, totalCount, results) {
  const feedbackEl = $("feedback");
  if (!feedbackEl) return;

  const isFullyCorrect = correctCount === totalCount;
  const percentage = Math.round((correctCount / totalCount) * 100);

  let resultClass = "feedback-error";
  let icon = "❌";
  let headerText = "Niet helemaal goed";

  if (isFullyCorrect) {
    resultClass = "feedback-success";
    icon = "✓";
    headerText = "Helemaal goed!";
  } else if (correctCount >= totalCount / 2) {
    resultClass = "feedback-partial";
    icon = "◐";
    headerText = "Gedeeltelijk goed";
  }

  const wrongItems = results.filter((r) => !r.correct);
  const wrongHtml =
    wrongItems.length > 0
      ? `
    <div class="feedback-results">
      <div class="feedback-results-title">Verbeteringen:</div>
      <div class="feedback-results-list">
        ${wrongItems
          .map(
            (r) => `
          <div class="feedback-result-item wrong">
            <span class="feedback-icon">✗</span>
            <span><strong>${r.latin}${r.label ? ` (${r.label})` : ""}</strong>:
            "${r.value || "(leeg)"}" → ${r.expected}</span>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `
      : "";

  feedbackEl.className = `feedback ${resultClass}`;
  feedbackEl.innerHTML = `
    <div class="feedback-header"><span>${icon}</span> ${headerText}</div>
    <div class="feedback-score">${correctCount} / ${totalCount} correct (${percentage}%)</div>
    ${wrongHtml}
  `;
  feedbackEl.style.display = "block";
}

/**
 * Check grouped short text answers
 */
export function check(q) {
  const state = getState();
  const items = q.words || q.items || [];
  let totalCorrect = 0;
  let totalItems = 0;
  const results = [];

  items.forEach((item, idx) => {
    // Get accepted answers from various schema formats
    const itemAccepted = item.accepted || item.accepted_answers || [];

    if (Array.isArray(item.subfields) && item.subfields.length > 0) {
      item.subfields.forEach((sf, sfIdx) => {
        totalItems++;
        const input = $(`word-${idx}-sf-${sfIdx}`);
        const value = input?.value?.trim() || "";
        const sfAccepted = sf.accepted || sf.accepted_answers || [];
        const isCorrect = matchesAcceptList(value, sfAccepted);

        input?.classList.add(isCorrect ? "input-correct" : "input-wrong");
        if (input) input.disabled = true;
        if (isCorrect) totalCorrect++;

        results.push({
          latin: item.latijn || item.vraag || item.question,
          label: sf.label,
          value,
          correct: isCorrect,
          expected: sfAccepted[0],
        });
      });
    } else {
      totalItems++;
      const input = $(`word-${idx}`);
      const value = input?.value?.trim() || "";
      const isCorrect = matchesAcceptList(value, itemAccepted);

      input?.classList.add(isCorrect ? "input-correct" : "input-wrong");
      if (input) input.disabled = true;
      if (isCorrect) totalCorrect++;

      results.push({
        latin: item.latijn || item.vraag || item.question,
        value,
        correct: isCorrect,
        expected: itemAccepted[0],
      });
    }
  });

  const isFullyCorrect = totalCorrect === totalItems;
  const isPassingScore = totalCorrect >= totalItems / 2;

  awardPoints(q.id, isPassingScore);
  updateSpacedRepetition(isFullyCorrect, q.id);

  addToHistory({
    question: q.prompt_html || q.prompt?.html || "Grouped short text",
    type: "grouped_short_text",
    correctCount: totalCorrect,
    totalCount: totalItems,
    correct: isFullyCorrect,
  });

  showGroupedFeedback(totalCorrect, totalItems, results);

  return {
    correct: isFullyCorrect,
    score: totalCorrect,
    maxScore: totalItems,
    partial: totalCorrect > 0 && totalCorrect < totalItems,
  };
}
