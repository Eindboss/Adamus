/* ===========================================
   Adamus - ChatGPT V2 Question Types
   Centralized module for extended question types
   =========================================== */

import { $, $$, $$$, shuffle, htmlToText } from "./utils.js";
import { updateStats, updateQuestionBox } from "./stats.js";
import { smartCheck, checkShortAnswerWithKeywords, isAIAvailable } from "./answer-checker.js";

/**
 * State reference - will be set by quiz.js
 */
let state = null;
let showFeedbackFn = null;
let resetForNextPartFn = null;

/**
 * Initialize the module with quiz state
 */
export function initV2QuestionTypes(quizState, showFeedback, resetForNextPart) {
  state = quizState;
  showFeedbackFn = showFeedback;
  resetForNextPartFn = resetForNextPart;
}

/**
 * Generic progress update for multi-input question types
 * Counts filled inputs and enables/disables check button
 * @param {HTMLElement[]|NodeList} inputs - Input elements to check
 * @param {string|null} counterId - Optional element ID to display filled count
 */
function updateInputProgress(inputs, counterId = null) {
  const inputArray = Array.isArray(inputs) ? inputs : Array.from(inputs);
  const filled = inputArray.filter(i => i.value.trim().length > 0).length;

  if (counterId) {
    const counterEl = $(counterId);
    if (counterEl) counterEl.textContent = filled;
  }

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = filled === 0;
}

/**
 * Show feedback with partial support for multi-item questions
 * @param {number} correctCount - Number of correct answers
 * @param {number} totalCount - Total number of items
 * @param {string} explanation - Optional explanation text
 */
function showGroupedItemFeedback(correctCount, totalCount, explanation = "") {
  const feedbackEl = $("feedback");
  if (!feedbackEl) return;

  const questionCard = $("quizArea");
  const allCorrect = correctCount === totalCount;
  const noneCorrect = correctCount === 0;
  
  // Determine state: correct, partial, or wrong
  let icon, title, className, cardClass;
  
  if (allCorrect) {
    icon = "✓";
    title = "Alles goed!";
    className = "feedback-success";
    cardClass = "is-correct";
  } else if (noneCorrect) {
    icon = "✗";
    title = "Niet goed";
    className = "feedback-error";
    cardClass = "is-wrong";
  } else {
    icon = "◐";
    title = "Gedeeltelijk goed";
    className = "feedback-partial";
    cardClass = "is-partial";
  }
  
  // Update card state
  if (questionCard) {
    questionCard.classList.remove("is-correct", "is-wrong", "is-partial");
    questionCard.classList.add(cardClass);
  }
  
  // Progress bar bump animation on fully correct
  if (allCorrect) {
    const progressBar = $("progressBar");
    if (progressBar) {
      progressBar.classList.remove("progress-bump");
      void progressBar.offsetWidth;
      progressBar.classList.add("progress-bump");
    }
  }
  
  let html = `
    <div class="feedback-header">
      <span>${icon}</span>
      <span>${title}</span>
    </div>
    <div class="feedback-score">${correctCount} / ${totalCount} goed</div>
  `;

  if (explanation) {
    html += `<div class="feedback-body">${explanation}</div>`;
  }

  feedbackEl.className = `feedback ${className}`;
  feedbackEl.innerHTML = html;
  feedbackEl.style.display = "block";
}

/* ===========================================
   Fill Blank Question Type
   =========================================== */

/**
 * Render fill_blank question
 * Text with {{blank1}}, {{blank2}} placeholders replaced by input fields or dropdowns
 */
export function renderFillBlank(container, q) {
  const instruction = q.instruction || "Vul de ontbrekende woorden in.";
  let text = q.text || "";
  const blanks = q.blanks || [];
  const isDropdown = q.type === "fill_blank_dropdown" || blanks.some(b => b.options);

  // Replace {{blankX}} with input fields or dropdowns
  blanks.forEach((blank, idx) => {
    const placeholder = `{{${blank.id}}}`;
    let inputHtml;

    if (blank.options) {
      // Dropdown mode
      const shuffledOptions = [...blank.options];
      shuffle(shuffledOptions);
      const optionsHtml = shuffledOptions.map(opt =>
        `<option value="${opt}">${opt}</option>`
      ).join("");

      inputHtml = `<select
        class="fill-blank-dropdown"
        id="blank-${blank.id}"
        data-blank-id="${blank.id}">
        <option value="">Kies...</option>
        ${optionsHtml}
      </select>`;
    } else {
      // Text input mode
      inputHtml = `<input type="text"
        class="fill-blank-input"
        id="blank-${blank.id}"
        data-blank-id="${blank.id}"
        placeholder="..."
        autocomplete="off"
        autocorrect="off"
        spellcheck="false">`;
    }
    text = text.replace(placeholder, inputHtml);
  });

  const contentHtml = `
    <div class="question-instruction">${instruction}</div>
    <div class="fill-blank-text">${text}</div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  if (q.image) {
    const altText = q.imageAlt || q.media?.alt || "Afbeelding bij vraag";
    container.innerHTML = `
      <div class="question-layout">
        <div class="question-image"><img src="${q.image}" alt="${altText}"></div>
        <div class="question-content">${contentHtml}</div>
      </div>
    `;
  } else {
    container.innerHTML = contentHtml;
  }

  // Setup input/dropdown listeners
  const inputs = $$$(".fill-blank-input", container);
  const dropdowns = $$$(".fill-blank-dropdown", container);
  const allFields = [...inputs, ...dropdowns];

  inputs.forEach((input, idx) => {
    input.addEventListener("input", () => updateFillBlankProgress(allFields));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        }
      }
    });
  });

  dropdowns.forEach((dropdown, idx) => {
    dropdown.addEventListener("change", () => updateFillBlankProgress(allFields));
    // Prevent page scroll when using arrow keys in dropdown
    dropdown.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        // Manually change selection
        const options = dropdown.options;
        const currentIdx = dropdown.selectedIndex;
        if (e.key === "ArrowDown" && currentIdx < options.length - 1) {
          dropdown.selectedIndex = currentIdx + 1;
        } else if (e.key === "ArrowUp" && currentIdx > 0) {
          dropdown.selectedIndex = currentIdx - 1;
        }
        // Trigger change event for progress update
        dropdown.dispatchEvent(new Event("change"));
      } else if (e.key === "Enter" || e.key === "Tab") {
        // Move to next dropdown on Enter/Tab
        if (e.key === "Enter") e.preventDefault();
        const nextDropdown = dropdowns[idx + 1];
        if (nextDropdown) {
          nextDropdown.focus();
        }
      }
    });
  });

  // Focus first field
  if (allFields.length > 0) allFields[0].focus();

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

function updateFillBlankProgress(inputs) {
  updateInputProgress(inputs);
}

/**
 * Check fill_blank answer (supports both text inputs and dropdowns)
 */
export function checkFillBlank(q) {
  const blanks = q.blanks || [];
  let correctCount = 0;
  const results = [];

  blanks.forEach((blank) => {
    const field = $(`blank-${blank.id}`);
    if (!field) return;

    const userValue = field.value.trim();
    const isDropdown = blank.options !== undefined;

    let isCorrect = false;

    if (isDropdown) {
      // Dropdown mode: check against correct value
      isCorrect = userValue === blank.correct;
    } else {
      // Text input mode: check against accepted answers
      const acceptedAnswers = blank.answers || [];
      const caseSensitive = blank.case_sensitive !== false;

      isCorrect = acceptedAnswers.some(accepted => {
        if (caseSensitive) {
          return userValue === accepted;
        }
        return userValue.toLowerCase() === accepted.toLowerCase();
      });
    }

    if (isCorrect) {
      correctCount++;
      field.classList.add(isDropdown ? "dropdown-correct" : "input-correct");
    } else {
      field.classList.add(isDropdown ? "dropdown-wrong" : "input-wrong");
    }

    results.push({
      blankId: blank.id,
      userValue,
      expected: isDropdown ? blank.correct : (blank.answers?.[0] || ""),
      correct: isCorrect,
    });
  });

  const allCorrect = correctCount === blanks.length;

  if (allCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, allCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, allCorrect);

  state.history.add({
    question: htmlToText(q.text),
    type: "fill_blank",
    correct: allCorrect,
    details: `${correctCount}/${blanks.length} correct`,
  });

  // Don't give away answers - just show count
  const hint = allCorrect ? "" : `${correctCount} van ${blanks.length} goed ingevuld.`;

  showFeedbackFn(allCorrect, q.explanation || q.e || "", hint);
}

/* ===========================================
   Short Answer Question Type
   =========================================== */

/**
 * Render short_answer question (open question with keywords)
 */
export function renderShortAnswer(container, q) {
  const question = q.q || q.prompt || "";

  const contentHtml = `
    <div class="question-title">${question}</div>
    <div class="short-answer-wrap">
      <textarea id="shortAnswerInput"
        class="short-answer-input"
        placeholder="Typ je antwoord..."
        rows="3"
        autocomplete="off"
        spellcheck="true"></textarea>
    </div>
    ${q.rubric ? `<div class="rubric-hint"><strong>Tip:</strong> ${q.rubric}</div>` : ""}
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  if (q.image) {
    const altText = q.imageAlt || q.media?.alt || "Afbeelding bij vraag";
    container.innerHTML = `
      <div class="question-layout">
        <div class="question-image"><img src="${q.image}" alt="${altText}"></div>
        <div class="question-content">${contentHtml}</div>
      </div>
    `;
  } else {
    container.innerHTML = contentHtml;
  }

  const input = $("shortAnswerInput");
  if (input) {
    input.addEventListener("input", () => {
      const checkBtn = $("checkBtn");
      if (checkBtn) checkBtn.disabled = input.value.trim().length === 0;
    });
    input.focus();
  }

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Check short_answer answer using smart checker (fuzzy + AI)
 */
export async function checkShortAnswer(q) {
  const input = $("shortAnswerInput");
  const userAnswer = input ? input.value.trim() : "";
  const keywords = q.keywords || [];
  const modelAnswer = q.example_answer || q.answer || "";
  const minKeywords = q.min_keywords || Math.ceil(keywords.length / 2);

  // Use smart keyword checking with fuzzy matching + synonyms
  const keywordResult = checkShortAnswerWithKeywords(userAnswer, keywords, {
    minKeywords,
    fuzzyThreshold: 0.75,
  });

  let isCorrect = keywordResult.match;
  let feedbackExtra = "";
  let aiUsed = false;

  // If keyword check fails but AI is available, try semantic check
  if (!isCorrect && isAIAvailable() && modelAnswer) {
    const aiResult = await smartCheck(
      userAnswer,
      modelAnswer,
      { question: q.prompt || q.instruction || "" },
      { useAI: true }
    );

    if (aiResult.match) {
      isCorrect = true;
      aiUsed = true;
      if (aiResult.feedback) {
        feedbackExtra = `<br><em>${aiResult.feedback}</em>`;
      }
    }
  }

  if (isCorrect) {
    state.score++;
    input?.classList.add("input-correct");
  } else {
    state.wrong++;
    input?.classList.add("input-wrong");
  }
  updateStats(state.subjectId, isCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, isCorrect);

  state.history.add({
    question: htmlToText(q.prompt || q.instruction || ""),
    type: "short_answer",
    userAnswer: userAnswer,
    correctAnswer: modelAnswer,
    correct: isCorrect,
    keywordMatches: `${keywordResult.matchedKeywords.length}/${keywords.length}`,
    aiUsed,
  });

  // Don't give away any hints - only show AI feedback if available
  showFeedbackFn(isCorrect, q.explanation || q.e || "", feedbackExtra);
}

/* ===========================================
   Matching Question Type
   =========================================== */

/**
 * Render matching question (connect left items to right items)
 */
// Store matching state for drag-drop
let matchingState = {
  pairs: {}, // leftIdx -> rightOriginalIdx
  leftItems: [],
  rightItems: [],
  shuffledRight: []
};

export function renderMatching(container, q) {
  const prompt = q.instruction || q.prompt || "Koppel de begrippen aan elkaar.";
  const leftItems = q.left || [];
  const rightItems = q.right || [];

  // Shuffle right items for display
  const shuffledRight = rightItems.map((item, idx) => ({ text: item, originalIdx: idx }));
  shuffle(shuffledRight);

  // Store state for checking
  matchingState = {
    pairs: {},
    leftItems,
    rightItems,
    shuffledRight
  };

  // Left side: begrippen with drop zones
  const leftHtml = leftItems.map((item, idx) => `
    <div class="match-pair" data-left-idx="${idx}">
      <div class="match-begrip">
        <span class="match-label">${idx + 1}.</span>
        <span class="match-text">${item}</span>
      </div>
      <div class="match-dropzone" data-left-idx="${idx}">
        <span class="dropzone-hint">Sleep hier</span>
      </div>
    </div>
  `).join("");

  // Right side: draggable betekenissen
  const rightHtml = shuffledRight.map((item, displayIdx) => `
    <div class="match-betekenis" draggable="true" data-original-idx="${item.originalIdx}" data-display-idx="${displayIdx}">
      <span class="match-drag-handle">⋮⋮</span>
      <span class="match-text">${item.text}</span>
    </div>
  `).join("");

  const contentHtml = `
    <div class="question-title">${prompt}</div>
    <div class="matching-drag-container">
      <div class="matching-pairs">
        ${leftHtml}
      </div>
      <div class="matching-pool">
        <div class="matching-pool-header">Sleep naar begrip</div>
        ${rightHtml}
      </div>
    </div>
    <div class="matching-progress">
      <span id="matchingFilled">0</span> / <span>${leftItems.length}</span> gekoppeld
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  if (q.image) {
    const altText = q.imageAlt || q.media?.alt || "Afbeelding bij vraag";
    container.innerHTML = `
      <div class="question-layout">
        <div class="question-image"><img src="${q.image}" alt="${altText}"></div>
        <div class="question-content">${contentHtml}</div>
      </div>
    `;
  } else {
    container.innerHTML = contentHtml;
  }

  // Setup drag and drop
  setupMatchingDragDrop();

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

function setupMatchingDragDrop() {
  let draggedEl = null;

  // Draggable items (betekenissen)
  $$$(".match-betekenis").forEach(el => {
    el.addEventListener("dragstart", (e) => {
      draggedEl = el;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", el.dataset.originalIdx);
    });

    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      draggedEl = null;
      $$$(".match-dropzone").forEach(dz => dz.classList.remove("drag-over"));
    });

    // Click to remove from paired state
    el.addEventListener("click", () => {
      if (el.closest(".match-dropzone")) {
        returnToPool(el);
      }
    });
  });

  // Drop zones
  $$$(".match-dropzone").forEach(dropzone => {
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      dropzone.classList.add("drag-over");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("drag-over");
    });

    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");

      if (!draggedEl) return;

      const leftIdx = parseInt(dropzone.dataset.leftIdx);
      const rightOriginalIdx = parseInt(draggedEl.dataset.originalIdx);

      // If dropzone already has an item, return it to pool
      const existing = dropzone.querySelector(".match-betekenis");
      if (existing) {
        returnToPool(existing);
      }

      // Move dragged item to dropzone
      dropzone.innerHTML = "";
      dropzone.appendChild(draggedEl);
      draggedEl.classList.add("paired");

      // Store pairing
      matchingState.pairs[leftIdx] = rightOriginalIdx;

      updateMatchingProgress();
    });

    // Click on dropzone to return item
    dropzone.addEventListener("click", (e) => {
      if (e.target === dropzone || e.target.classList.contains("dropzone-hint")) {
        const item = dropzone.querySelector(".match-betekenis");
        if (item) returnToPool(item);
      }
    });
  });
}

function returnToPool(el) {
  const pool = $$(".matching-pool");
  if (!pool) return;

  // Find which left it was paired with and remove
  const leftIdx = el.closest(".match-dropzone")?.dataset.leftIdx;
  if (leftIdx !== undefined) {
    delete matchingState.pairs[parseInt(leftIdx)];
  }

  // Restore dropzone hint
  const dropzone = el.closest(".match-dropzone");
  if (dropzone) {
    dropzone.innerHTML = '<span class="dropzone-hint">Sleep hier</span>';
  }

  // Return to pool
  el.classList.remove("paired");
  pool.appendChild(el);

  updateMatchingProgress();
}

function updateMatchingProgress() {
  const filled = Object.keys(matchingState.pairs).length;
  const total = matchingState.leftItems.length;

  const progressEl = $("matchingFilled");
  if (progressEl) progressEl.textContent = filled;

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = filled === 0;
}

/**
 * Check matching answer
 * Supports both index-based pairs ({0: 0, 1: 1}) and text-based correct_pairs ({"Zeus": "hemel"})
 */
export function checkMatching(q) {
  const leftItems = q.left || [];
  const rightItems = q.right || [];

  // Build correct pairs map: leftIdx -> rightIdx
  let correctPairsMap = {};

  if (q.correct_pairs) {
    // Text-based format: {"Zeus": "hemel, bliksem, oppergod"}
    for (const [leftText, rightText] of Object.entries(q.correct_pairs)) {
      const leftIdx = leftItems.findIndex(item => item === leftText);
      const rightIdx = rightItems.findIndex(item => item === rightText);
      if (leftIdx !== -1 && rightIdx !== -1) {
        correctPairsMap[leftIdx] = rightIdx;
      }
    }
  } else if (q.pairs) {
    // Index-based format: {0: 0, 1: 1}
    correctPairsMap = q.pairs;
  }

  let correctCount = 0;
  const totalPairs = leftItems.length;

  // Check each pairing using matchingState
  $$$(".match-pair").forEach((pairEl) => {
    const leftIdx = parseInt(pairEl.dataset.leftIdx);
    const dropzone = pairEl.querySelector(".match-dropzone");
    const droppedItem = dropzone?.querySelector(".match-betekenis");

    const userRightIdx = droppedItem ? parseInt(droppedItem.dataset.originalIdx) : null;
    const expectedRightIdx = correctPairsMap[leftIdx];

    const isCorrect = userRightIdx === expectedRightIdx;

    if (isCorrect) {
      correctCount++;
      pairEl.classList.add("match-correct");
    } else {
      pairEl.classList.add("match-wrong");
      // Show correct answer
      if (expectedRightIdx !== undefined) {
        const correctText = rightItems[expectedRightIdx];
        const hint = document.createElement("div");
        hint.className = "match-hint";
        hint.textContent = correctText;
        dropzone.appendChild(hint);
      }
    }
  });

  const allCorrect = correctCount === totalPairs;

  if (allCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, allCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, allCorrect);

  state.history.add({
    question: htmlToText(q.instruction || q.prompt || "Matching"),
    type: "matching",
    correct: allCorrect,
    details: `${correctCount}/${totalPairs} correct`,
  });

  showGroupedItemFeedback(correctCount, totalPairs, q.explanation || q.e || "");
}

/* ===========================================
   Numeric Question Type
   =========================================== */

/**
 * Render numeric question (answer with tolerance)
 */
export function renderNumeric(container, q) {
  const question = q.q || q.prompt || "";
  const unit = q.unit || "";

  const contentHtml = `
    <div class="question-title">${question}</div>
    <div class="numeric-input-wrap">
      <input type="text"
        id="numericInput"
        class="numeric-input"
        placeholder="Getal..."
        autocomplete="off"
        inputmode="decimal">
      ${unit ? `<span class="numeric-unit">${unit}</span>` : ""}
    </div>
    ${q.rounding ? `<div class="rounding-hint">Afronden: ${q.rounding}</div>` : ""}
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  if (q.image) {
    const altText = q.imageAlt || q.media?.alt || "Afbeelding bij vraag";
    container.innerHTML = `
      <div class="question-layout">
        <div class="question-image"><img src="${q.image}" alt="${altText}"></div>
        <div class="question-content">${contentHtml}</div>
      </div>
    `;
  } else {
    container.innerHTML = contentHtml;
  }

  const input = $("numericInput");
  if (input) {
    input.addEventListener("input", () => {
      const checkBtn = $("checkBtn");
      if (checkBtn) checkBtn.disabled = input.value.trim().length === 0;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim().length > 0) {
        e.preventDefault();
        // Trigger check
        const checkBtn = $("checkBtn");
        if (checkBtn) checkBtn.click();
      }
    });
    input.focus();
  }

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Check numeric answer
 */
export function checkNumeric(q) {
  const input = $("numericInput");
  const userValue = input ? input.value.trim().replace(",", ".") : "";
  const expectedValue = q.answer;
  const tolerance = q.tolerance || 0;
  const unit = q.unit || "";

  const userNum = parseFloat(userValue);
  const expectedNum = parseFloat(expectedValue);

  // Check if within tolerance
  const isCorrect = !isNaN(userNum) && !isNaN(expectedNum) &&
    Math.abs(userNum - expectedNum) <= tolerance;

  if (isCorrect) {
    state.score++;
    input?.classList.add("input-correct");
  } else {
    state.wrong++;
    input?.classList.add("input-wrong");
  }
  updateStats(state.subjectId, isCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, isCorrect);

  state.history.add({
    question: htmlToText(q.q || q.prompt),
    type: "numeric",
    userAnswer: `${userValue} ${unit}`,
    correctAnswer: `${expectedValue} ${unit}`,
    correct: isCorrect,
  });

  // Don't give away the answer
  showFeedbackFn(isCorrect, q.explanation || q.e || "", "");
}

/* ===========================================
   Data Table Question Type
   =========================================== */

/**
 * Render data_table question (table with calculations)
 */
export function renderDataTable(container, q) {
  const prompt = q.prompt || "Vul de ontbrekende waarden in.";
  const table = q.table || {};
  const columns = table.columns || [];
  const rows = table.rows || [];

  const headerHtml = columns.map(col => `<th>${col}</th>`).join("");

  const rowsHtml = rows.map((row, rowIdx) => {
    const cells = columns.map((col, colIdx) => {
      const key = col.replace(/ \(.*\)/, "").trim(); // Remove units from key
      const value = row[key];

      if (value === null || value === undefined) {
        // This is an input cell
        return `
          <td class="data-cell data-cell-input">
            <input type="text"
              class="data-input"
              id="data-${rowIdx}-${colIdx}"
              data-row="${rowIdx}"
              data-col="${col}"
              data-month="${row.Maand || ''}"
              placeholder="?"
              autocomplete="off"
              inputmode="decimal">
          </td>`;
      } else {
        return `<td class="data-cell data-cell-given">${value}</td>`;
      }
    }).join("");

    return `<tr>${cells}</tr>`;
  }).join("");

  const inputCount = rows.flat ?
    rows.reduce((count, row) => count + columns.filter(col => {
      const key = col.replace(/ \(.*\)/, "").trim();
      return row[key] === null || row[key] === undefined;
    }).length, 0) : 0;

  container.innerHTML = `
    <div class="question-title">${prompt}</div>
    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>${headerHtml}</tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
    <div class="data-progress">
      <span id="dataFilled">0</span> / <span>${inputCount}</span> ingevuld
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  // Setup input listeners
  $$$(".data-input", container).forEach((input, idx) => {
    input.addEventListener("input", updateDataTableProgress);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const allInputs = $$$(".data-input");
        if (idx < allInputs.length - 1) {
          allInputs[idx + 1].focus();
        }
      }
    });
  });

  // Focus first input
  const firstInput = $$(".data-input", container);
  if (firstInput) firstInput.focus();

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

function updateDataTableProgress() {
  updateInputProgress($$$(".data-input"), "dataFilled");
}

/**
 * Check data_table answer
 */
export function checkDataTable(q) {
  const answerKey = q.answer_key || {};
  const tolerance = q.tolerance || 0.5;
  let correctCount = 0;
  let totalCount = 0;

  $$$(".data-input").forEach((input) => {
    totalCount++;
    const month = input.dataset.month;
    const userValue = input.value.trim().replace(",", ".");
    const expectedValue = answerKey[month];

    if (expectedValue === undefined) return;

    const userNum = parseFloat(userValue);
    const expectedNum = parseFloat(expectedValue);

    const isCorrect = !isNaN(userNum) && !isNaN(expectedNum) &&
      Math.abs(userNum - expectedNum) <= tolerance;

    if (isCorrect) {
      correctCount++;
      input.classList.add("input-correct");
    } else {
      input.classList.add("input-wrong");
      // Show expected value
      const hint = document.createElement("span");
      hint.className = "data-hint";
      hint.textContent = ` (${expectedValue})`;
      input.parentNode.appendChild(hint);
    }
  });

  const allCorrect = correctCount === totalCount;

  if (allCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, allCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, allCorrect);

  state.history.add({
    question: htmlToText(q.prompt),
    type: "data_table",
    correct: allCorrect,
    details: `${correctCount}/${totalCount} correct`,
  });

  showGroupedItemFeedback(correctCount, totalCount, q.e || "");
}

/* ===========================================
   Multipart Question Type
   =========================================== */

/**
 * State for multipart question
 */
let multipartState = {
  currentPart: 0,
  parts: [],
  partResults: [],
};

/**
 * Render multipart question (multiple sub-questions)
 */
export function renderMultipart(container, q) {
  const intro = q.context || q.intro || q.instruction || "";
  const parts = q.parts || [];

  // Initialize multipart state
  multipartState = {
    currentPart: 0,
    parts: parts,
    partResults: [],
  };

  const contentHtml = `
    <div class="multipart-intro">${intro}</div>
    <div class="multipart-progress">
      Deelvraag <span id="currentPart">1</span> van <span>${parts.length}</span>
    </div>
    <div id="multipartContent" class="multipart-content"></div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  if (q.image) {
    const altText = q.imageAlt || q.media?.alt || "Afbeelding bij vraag";
    container.innerHTML = `
      <div class="question-layout">
        <div class="question-image"><img src="${q.image}" alt="${altText}"></div>
        <div class="question-content">${contentHtml}</div>
      </div>
    `;
  } else {
    container.innerHTML = contentHtml;
  }

  // Render first part
  renderMultipartPart(0);
}

function renderMultipartPart(partIdx) {
  const part = multipartState.parts[partIdx];
  if (!part) return;

  const content = $("multipartContent");
  if (!content) return;

  // Update progress
  const currentPartEl = $("currentPart");
  if (currentPartEl) currentPartEl.textContent = partIdx + 1;

  const question = part.q || part.prompt || "";

  // Render based on part type
  if (part.type === "numeric") {
    content.innerHTML = `
      <div class="part-question">${question}</div>
      <div class="numeric-input-wrap">
        <input type="text"
          id="partInput"
          class="numeric-input"
          placeholder="Getal..."
          autocomplete="off"
          inputmode="decimal">
        ${part.unit ? `<span class="numeric-unit">${part.unit}</span>` : ""}
      </div>
    `;
  } else if (part.type === "mc" && (part.a || part.options)) {
    // Support both part.a (v1) and part.options (ChatGPT format)
    const options = part.a || part.options || [];
    const optionsHtml = options.map((answer, idx) => `
      <div class="option part-option" data-idx="${idx}" tabindex="0" role="radio" aria-checked="false">
        <span class="option-marker">${String.fromCharCode(65 + idx)}</span>
        <span class="option-text">${answer}</span>
      </div>
    `).join("");

    content.innerHTML = `
      <div class="part-question">${question}</div>
      <div class="options-list" role="radiogroup">${optionsHtml}</div>
    `;

    // Add click handlers
    $$$(".part-option", content).forEach((el) => {
      el.addEventListener("click", () => selectPartOption(el));
    });
  } else {
    // Default: short_answer
    content.innerHTML = `
      <div class="part-question">${question}</div>
      <div class="short-answer-wrap">
        <textarea id="partInput"
          class="short-answer-input"
          placeholder="Typ je antwoord..."
          rows="2"></textarea>
      </div>
    `;
  }

  // Focus input
  const input = $("partInput");
  if (input) {
    input.addEventListener("input", () => {
      const checkBtn = $("checkBtn");
      if (checkBtn) checkBtn.disabled = input.value.trim().length === 0;
    });
    input.focus();
  }

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

function selectPartOption(el) {
  $$$(".part-option").forEach((opt) => {
    opt.classList.remove("selected");
    opt.setAttribute("aria-checked", "false");
  });

  el.classList.add("selected");
  el.setAttribute("aria-checked", "true");
  multipartState.selectedOption = parseInt(el.dataset.idx, 10);

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = false;
}

/**
 * Check multipart answer
 */
export function checkMultipart(q) {
  const part = multipartState.parts[multipartState.currentPart];
  if (!part) return;

  let isCorrect = false;
  let userAnswer = "";
  let correctAnswer = "";

  if (part.type === "numeric") {
    const input = $("partInput");
    userAnswer = input ? input.value.trim().replace(",", ".") : "";
    const userNum = parseFloat(userAnswer);
    const expectedNum = parseFloat(part.answer);
    const tolerance = part.tolerance || 0;

    isCorrect = !isNaN(userNum) && !isNaN(expectedNum) &&
      Math.abs(userNum - expectedNum) <= tolerance;
    correctAnswer = `${part.answer} ${part.unit || ""}`;

    if (input) {
      input.classList.add(isCorrect ? "input-correct" : "input-wrong");
    }
  } else if (part.type === "mc" && part.a) {
    const selectedIdx = multipartState.selectedOption;
    isCorrect = selectedIdx === part.c;
    userAnswer = part.a[selectedIdx] || "";
    correctAnswer = part.a[part.c] || "";

    $$$(".part-option").forEach((el, idx) => {
      el.classList.add("disabled");
      if (idx === part.c) el.classList.add("correct");
      if (idx === selectedIdx && !isCorrect) el.classList.add("wrong");
    });
  } else {
    // short_answer
    const input = $("partInput");
    userAnswer = input ? input.value.trim().toLowerCase() : "";
    const keywords = part.keywords || [];
    correctAnswer = part.answer || "";

    const keywordMatches = keywords.filter(kw =>
      userAnswer.includes(kw.toLowerCase())
    ).length;

    isCorrect = keywordMatches >= Math.ceil(keywords.length / 2);

    if (input) {
      input.classList.add(isCorrect ? "input-correct" : "input-wrong");
    }
  }

  // Store result
  multipartState.partResults.push({
    partId: part.id,
    correct: isCorrect,
    userAnswer,
    correctAnswer,
  });

  // Check if more parts
  if (multipartState.currentPart < multipartState.parts.length - 1) {
    // Show part feedback and continue button
    const feedback = $("feedback");
    if (feedback) {
      feedback.style.display = "block";
      feedback.className = `feedback ${isCorrect ? "correct" : "wrong"}`;
      feedback.innerHTML = `
        <div class="feedback-icon">${isCorrect ? "✓" : "✗"}</div>
        <div class="feedback-text">
          ${isCorrect ? "Goed!" : `Fout. Juiste antwoord: ${correctAnswer}`}
          ${part.e ? `<div class="feedback-explanation">${part.e}</div>` : ""}
        </div>
        <button class="btn btn-primary" id="nextPartBtn">Volgende deelvraag →</button>
      `;
    }

    $("nextPartBtn")?.addEventListener("click", () => {
      multipartState.currentPart++;
      multipartState.selectedOption = null;
      const feedbackEl = $("feedback");
      if (feedbackEl) feedbackEl.style.display = "none";

      // Reset state for next part so controls work correctly
      if (resetForNextPartFn) resetForNextPartFn();

      renderMultipartPart(multipartState.currentPart);
    });

    // Don't update global state yet - wait for all parts
    return;
  }

  // All parts done - calculate final score
  const correctParts = multipartState.partResults.filter(r => r.correct).length;
  const totalParts = multipartState.parts.length;
  const allCorrect = correctParts === totalParts;

  if (allCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, allCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, allCorrect);

  state.history.add({
    question: htmlToText(q.intro),
    type: "multipart",
    correct: allCorrect,
    details: `${correctParts}/${totalParts} deelvragen correct`,
  });

  showGroupedItemFeedback(correctParts, totalParts, q.e || "");
}

/* ===========================================
   Extended Ordering (with correct_order array)
   =========================================== */

/**
 * Check ordering with correct_order array format
 */
export function checkOrderingV2(q) {
  const items = q.items || [];
  const correctOrder = q.correct_order || items.map((_, i) => i);
  const list = $("orderingList");

  // Get current order from DOM
  const currentItems = $$$(".ordering-item", list);
  const userOrder = currentItems.map((item) => parseInt(item.dataset.original, 10));

  // Check if order matches
  const isCorrect = userOrder.every((val, idx) => val === correctOrder[idx]);

  // Mark items
  currentItems.forEach((item, idx) => {
    const userIdx = parseInt(item.dataset.original, 10);
    const expectedIdx = correctOrder[idx];
    if (userIdx === expectedIdx) {
      item.classList.add("ordering-correct");
    } else {
      item.classList.add("ordering-wrong");
    }
  });

  if (isCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, isCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, isCorrect);

  state.history.add({
    question: htmlToText(q.prompt),
    type: "ordering",
    correct: isCorrect,
  });

  // Don't give away the correct order
  showFeedbackFn(isCorrect, q.explanation || q.e || "", "");
}

/* ===========================================
   Vocab List Question Type (Engels)
   For vocabulary practice with NL-EN / EN-NL
   =========================================== */

/**
 * Render vocab_list question
 * Supports direction: "nl-en", "en-nl", "nl-fr", "fr-nl", "mixed"
 */
export function renderVocabList(container, q) {
  const instruction = q.instruction || "Vertaal de woorden:";
  const direction = q.direction || "nl-en";
  const items = q.items || [];

  let itemsHtml = "";

  items.forEach((item, idx) => {
    let prompt, placeholder;

    if (direction === "nl-en") {
      prompt = item.nl;
      placeholder = "Engels...";
    } else if (direction === "en-nl") {
      prompt = item.en;
      placeholder = "Nederlands...";
    } else if (direction === "nl-fr") {
      prompt = item.nl;
      placeholder = "Frans...";
    } else if (direction === "fr-nl") {
      prompt = item.fr;
      placeholder = "Nederlands...";
    } else {
      // mixed
      prompt = item.prompt;
      placeholder = item.direction === "nl-en" ? "Engels..." : "Nederlands...";
    }

    itemsHtml += `
      <div class="vocab-item" data-idx="${idx}">
        <span class="vocab-prompt">${prompt}</span>
        <input type="text"
          class="vocab-input"
          id="vocab-${idx}"
          data-idx="${idx}"
          placeholder="${placeholder}"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false">
      </div>
    `;
  });

  const contentHtml = `
    <div class="question-instruction">${instruction}</div>
    <div class="vocab-list">${itemsHtml}</div>
    <div class="vocab-progress">
      <span id="vocabFilled">0</span> / <span>${items.length}</span> ingevuld
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  container.innerHTML = contentHtml;

  // Setup input listeners
  const inputs = $$$(".vocab-input", container);
  inputs.forEach((input, idx) => {
    input.addEventListener("input", () => updateVocabProgress(inputs));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        }
      }
    });
  });

  if (inputs.length > 0) inputs[0].focus();

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

function updateVocabProgress(inputs) {
  updateInputProgress(inputs, "vocabFilled");
}

/**
 * Check vocab_list answer
 */
export function checkVocabList(q) {
  const direction = q.direction || "nl-en";
  const items = q.items || [];
  let correctCount = 0;

  items.forEach((item, idx) => {
    const input = $(`vocab-${idx}`);
    if (!input) return;

    const userAnswer = input.value.trim().toLowerCase();

    // Get accepted answers based on direction
    let acceptedAnswers;
    if (direction === "nl-en") {
      acceptedAnswers = item.en || [];
    } else if (direction === "en-nl") {
      acceptedAnswers = item.nl || [];
    } else if (direction === "nl-fr") {
      acceptedAnswers = item.fr || [];
    } else if (direction === "fr-nl") {
      acceptedAnswers = item.nl || [];
    } else {
      // mixed
      acceptedAnswers = item.accept || [];
    }

    // Ensure array
    if (!Array.isArray(acceptedAnswers)) {
      acceptedAnswers = [acceptedAnswers];
    }

    // Check if user answer matches any accepted answer (case insensitive)
    const isCorrect = acceptedAnswers.some(accepted =>
      userAnswer === accepted.toLowerCase()
    );

    if (isCorrect) {
      correctCount++;
      input.classList.add("input-correct");
    } else {
      input.classList.add("input-wrong");
      // Show one correct answer as hint
      const hint = document.createElement("span");
      hint.className = "vocab-hint";
      hint.textContent = ` → ${acceptedAnswers[0]}`;
      input.parentNode.appendChild(hint);
    }
  });

  const allCorrect = correctCount === items.length;
  const totalCount = items.length;

  // Award fractional credit based on correct answers
  const fractionCorrect = totalCount > 0 ? correctCount / totalCount : 0;
  state.score += fractionCorrect;
  state.wrong += 1 - fractionCorrect;

  updateStats(state.subjectId, allCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, allCorrect);

  state.history.add({
    question: htmlToText(q.instruction || "Vocab list"),
    type: "vocab_list",
    correct: allCorrect,
    correctCount,
    totalCount,
    details: `${correctCount}/${totalCount} correct`,
  });

  // Use grouped feedback for partial results
  showGroupedItemFeedback(correctCount, totalCount, q.explanation || q.e || "");
}

/* ===========================================
   Grammar Transform Question Type (Engels)
   For verb tenses, plurals, comparisons
   =========================================== */

/**
 * Render grammar_transform question
 * Supports category: "verb_tense", "plural", "comparison"
 */
export function renderGrammarTransform(container, q) {
  const instruction = q.instruction || "Vul de juiste vorm in:";
  const category = q.category || "verb_tense";
  const items = q.items || [];

  let itemsHtml = "";

  items.forEach((item, idx) => {
    let prompt, placeholder;

    if (category === "verb_tense") {
      prompt = `${item.base} → <em>${item.tense}</em>`;
      placeholder = "...";
    } else if (category === "plural") {
      prompt = item.singular;
      placeholder = "meervoud...";
    } else if (category === "comparison") {
      // Comparison has two fields
      prompt = item.base;
      itemsHtml += `
        <div class="grammar-item grammar-comparison" data-idx="${idx}">
          <span class="grammar-prompt">${prompt}</span>
          <div class="comparison-inputs">
            <input type="text"
              class="grammar-input"
              id="grammar-${idx}-comp"
              data-idx="${idx}"
              data-field="comparative"
              placeholder="vergrotende trap..."
              autocomplete="off">
            <input type="text"
              class="grammar-input"
              id="grammar-${idx}-super"
              data-idx="${idx}"
              data-field="superlative"
              placeholder="overtreffende trap..."
              autocomplete="off">
          </div>
        </div>
      `;
      return;
    }

    itemsHtml += `
      <div class="grammar-item" data-idx="${idx}">
        <span class="grammar-prompt">${prompt}</span>
        <input type="text"
          class="grammar-input"
          id="grammar-${idx}"
          data-idx="${idx}"
          placeholder="${placeholder}"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false">
      </div>
    `;
  });

  const contentHtml = `
    <div class="question-instruction">${instruction}</div>
    <div class="grammar-list">${itemsHtml}</div>
    <div class="grammar-progress">
      <span id="grammarFilled">0</span> / <span id="grammarTotal">${items.length}</span> ingevuld
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  container.innerHTML = contentHtml;

  // Setup input listeners
  const inputs = $$$(".grammar-input", container);
  inputs.forEach((input, idx) => {
    input.addEventListener("input", () => updateGrammarProgress(inputs, category, items.length));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        }
      }
    });
  });

  if (inputs.length > 0) inputs[0].focus();

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

function updateGrammarProgress(inputs, category, itemCount) {
  if (category === "comparison") {
    // For comparison, need both fields filled per item
    const pairs = {};
    inputs.forEach(input => {
      const idx = input.dataset.idx;
      if (!pairs[idx]) pairs[idx] = { comp: false, super: false };
      if (input.dataset.field === "comparative" && input.value.trim()) pairs[idx].comp = true;
      if (input.dataset.field === "superlative" && input.value.trim()) pairs[idx].super = true;
    });
    const filled = Object.values(pairs).filter(p => p.comp && p.super).length;
    const filledEl = $("grammarFilled");
    if (filledEl) filledEl.textContent = filled;
    const checkBtn = $("checkBtn");
    if (checkBtn) checkBtn.disabled = filled === 0;
  } else {
    updateInputProgress(inputs, "grammarFilled");
  }
}

/**
 * Check grammar_transform answer
 */
export function checkGrammarTransform(q) {
  const category = q.category || "verb_tense";
  const items = q.items || [];
  let correctCount = 0;

  items.forEach((item, idx) => {
    if (category === "comparison") {
      // Two fields to check
      const compInput = $(`grammar-${idx}-comp`);
      const superInput = $(`grammar-${idx}-super`);

      const userComp = compInput?.value.trim().toLowerCase() || "";
      const userSuper = superInput?.value.trim().toLowerCase() || "";

      const compCorrect = (item.comparative || []).some(a => userComp === a.toLowerCase());
      const superCorrect = (item.superlative || []).some(a => userSuper === a.toLowerCase());

      if (compCorrect && superCorrect) {
        correctCount++;
        compInput?.classList.add("input-correct");
        superInput?.classList.add("input-correct");
      } else {
        if (compCorrect) {
          compInput?.classList.add("input-correct");
        } else {
          compInput?.classList.add("input-wrong");
          addHint(compInput, item.comparative?.[0]);
        }
        if (superCorrect) {
          superInput?.classList.add("input-correct");
        } else {
          superInput?.classList.add("input-wrong");
          addHint(superInput, item.superlative?.[0]);
        }
      }
    } else {
      const input = $(`grammar-${idx}`);
      if (!input) return;

      const userAnswer = input.value.trim().toLowerCase();
      const acceptedAnswers = item.accept || [];

      const isCorrect = acceptedAnswers.some(a => userAnswer === a.toLowerCase());

      if (isCorrect) {
        correctCount++;
        input.classList.add("input-correct");
      } else {
        input.classList.add("input-wrong");
        addHint(input, acceptedAnswers[0]);
      }
    }
  });

  const allCorrect = correctCount === items.length;

  if (allCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, allCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, allCorrect);

  state.history.add({
    question: htmlToText(q.instruction || "Grammar transform"),
    type: "grammar_transform",
    correct: allCorrect,
    details: `${correctCount}/${items.length} correct`,
  });

  showGroupedItemFeedback(correctCount, items.length, q.explanation || q.e || "");
}

function addHint(input, correctAnswer) {
  if (!input || !correctAnswer) return;
  const hint = document.createElement("span");
  hint.className = "grammar-hint";
  hint.textContent = ` → ${correctAnswer}`;
  input.parentNode.appendChild(hint);
}

/* ===========================================
   Grammar Fill Question Type (Engels)
   For fill-in-the-blank grammar exercises
   =========================================== */

/**
 * Render grammar_fill question
 * Items contain sentences with {{blank}} placeholders
 */
export function renderGrammarFill(container, q) {
  const instruction = q.instruction || "Vul de juiste vorm in:";
  const context = q.context || "";
  const items = q.items || [];
  const useDropdown = q.use_dropdown || false;

  let itemsHtml = "";

  items.forEach((item, idx) => {
    let sentence = item.sentence || "";

    if (useDropdown && item.options) {
      // Replace {{blank}} with dropdown
      const options = item.options.map(opt =>
        `<option value="${opt}">${opt}</option>`
      ).join("");

      sentence = sentence.replace(/\{\{blank\}\}/g, `
        <select class="grammar-fill-dropdown" id="gfill-${idx}" data-idx="${idx}">
          <option value="">Kies...</option>
          ${options}
        </select>
      `);
    } else {
      // Replace {{blank}} with input
      sentence = sentence.replace(/\{\{blank\}\}/g, `
        <input type="text"
          class="grammar-fill-input"
          id="gfill-${idx}"
          data-idx="${idx}"
          placeholder="..."
          autocomplete="off">
      `);
    }

    itemsHtml += `<div class="grammar-fill-item" data-idx="${idx}">${sentence}</div>`;
  });

  const contentHtml = `
    <div class="question-instruction">${instruction}</div>
    ${context ? `<div class="grammar-context">${context}</div>` : ""}
    <div class="grammar-fill-list">${itemsHtml}</div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  container.innerHTML = contentHtml;

  // Setup listeners
  const inputs = $$$(".grammar-fill-input", container);
  const dropdowns = $$$(".grammar-fill-dropdown", container);
  const allFields = [...inputs, ...dropdowns];

  inputs.forEach((input, idx) => {
    input.addEventListener("input", () => updateGrammarFillProgress(allFields));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const nextInput = inputs[idx + 1] || dropdowns[0];
        if (nextInput) nextInput.focus();
      }
    });
  });

  dropdowns.forEach((dd) => {
    dd.addEventListener("change", () => updateGrammarFillProgress(allFields));
  });

  if (allFields.length > 0) allFields[0].focus();

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

function updateGrammarFillProgress(fields) {
  updateInputProgress(fields);
}

/**
 * Check grammar_fill answer
 */
export function checkGrammarFill(q) {
  const items = q.items || [];
  const useDropdown = q.use_dropdown || false;
  let correctCount = 0;

  items.forEach((item, idx) => {
    const field = $(`gfill-${idx}`);
    if (!field) return;

    const userAnswer = field.value.trim().toLowerCase();
    let isCorrect = false;

    if (useDropdown) {
      isCorrect = userAnswer === (item.correct || "").toLowerCase();
    } else {
      const accepted = item.accept || [];
      isCorrect = accepted.some(a => userAnswer === a.toLowerCase());
    }

    if (isCorrect) {
      correctCount++;
      field.classList.add(useDropdown ? "dropdown-correct" : "input-correct");
    } else {
      field.classList.add(useDropdown ? "dropdown-wrong" : "input-wrong");
      // Show correct answer
      const correctAnswer = useDropdown ? item.correct : (item.accept?.[0] || "");
      const hint = document.createElement("span");
      hint.className = "grammar-fill-hint";
      hint.textContent = ` → ${correctAnswer}`;
      field.parentNode.insertBefore(hint, field.nextSibling);
    }
  });

  const allCorrect = correctCount === items.length;

  if (allCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, allCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, allCorrect);

  state.history.add({
    question: htmlToText(q.instruction || "Grammar fill"),
    type: "grammar_fill",
    correct: allCorrect,
    details: `${correctCount}/${items.length} correct`,
  });

  showGroupedItemFeedback(correctCount, items.length, q.explanation || q.e || "");
}

/* ===========================================
   Sentence Correction Question Type (Engels)
   For identifying and correcting grammar errors
   =========================================== */

/**
 * Render sentence_correction question
 */
export function renderSentenceCorrection(container, q) {
  const instruction = q.instruction || "Verbeter de fout in elke zin:";
  const items = q.items || [];

  let itemsHtml = "";

  items.forEach((item, idx) => {
    itemsHtml += `
      <div class="correction-item" data-idx="${idx}">
        <div class="correction-original">
          <span class="correction-label">Fout:</span>
          <span class="correction-sentence">${item.sentence}</span>
        </div>
        <div class="correction-input-wrap">
          <span class="correction-label">Correct:</span>
          <input type="text"
            class="correction-input"
            id="correction-${idx}"
            data-idx="${idx}"
            placeholder="Typ de correcte zin..."
            autocomplete="off"
            spellcheck="true">
        </div>
      </div>
    `;
  });

  const contentHtml = `
    <div class="question-instruction">${instruction}</div>
    <div class="correction-list">${itemsHtml}</div>
    <div class="correction-progress">
      <span id="correctionFilled">0</span> / <span>${items.length}</span> ingevuld
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  container.innerHTML = contentHtml;

  // Setup listeners
  const inputs = $$$(".correction-input", container);
  inputs.forEach((input, idx) => {
    input.addEventListener("input", () => updateCorrectionProgress(inputs));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        }
      }
    });
  });

  if (inputs.length > 0) inputs[0].focus();

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

function updateCorrectionProgress(inputs) {
  updateInputProgress(inputs, "correctionFilled");
}

/**
 * Check sentence_correction answer
 */
export function checkSentenceCorrection(q) {
  const items = q.items || [];
  let correctCount = 0;

  items.forEach((item, idx) => {
    const input = $(`correction-${idx}`);
    if (!input) return;

    const userAnswer = input.value.trim().toLowerCase();
    const accepted = item.accept || [];

    // Normalize answers for comparison (remove extra spaces, punctuation variations)
    const normalize = (s) => s.toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/['']/g, "'")
      .trim();

    const isCorrect = accepted.some(a => normalize(userAnswer) === normalize(a));

    if (isCorrect) {
      correctCount++;
      input.classList.add("input-correct");
    } else {
      input.classList.add("input-wrong");
      // Show one correct answer
      const hint = document.createElement("div");
      hint.className = "correction-hint";
      hint.textContent = accepted[0];
      input.parentNode.appendChild(hint);
    }
  });

  const allCorrect = correctCount === items.length;

  if (allCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, allCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, allCorrect);

  state.history.add({
    question: htmlToText(q.instruction || "Sentence correction"),
    type: "sentence_correction",
    correct: allCorrect,
    details: `${correctCount}/${items.length} correct`,
  });

  showGroupedItemFeedback(correctCount, items.length, q.explanation || q.e || "");
}
