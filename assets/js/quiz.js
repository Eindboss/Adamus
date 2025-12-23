/* ===========================================
   Adamus - Quiz Engine
   Core quiz logic and state management
   =========================================== */

import {
  $,
  $$,
  $$$,
  shuffle,
  loadJSON,
  htmlToText,
  getUrlParam,
  normalizeAnswer,
  matchesAcceptList,
  countFillableCells,
  countGroupedInputs,
  showConfetti,
  updateTimerWarning,
  showError as showErrorUI,
  showLoading,
  saveQuizProgress,
  loadQuizProgress,
  clearQuizProgress,
  hasQuizProgress,
} from "./utils.js";
import {
  startTimer,
  stopTimer,
  resetTimer,
  pauseTimer,
  resumeTimer,
  initTimer,
} from "./timer.js";
import {
  readStats,
  writeStats,
  updateStats,
  createSessionHistory,
  updateQuestionBox,
  incrementSession,
  getSpacedQuestions,
  getMasteryStats,
} from "./stats.js";
import { createCoordinateSystem } from "./graph.js";

// Constants
const QUESTION_SECONDS = 90;

// State
let state = {
  subjectId: null,
  subjectMeta: null,
  questions: [],
  currentIndex: 0,
  score: 0,
  wrong: 0,
  skipped: 0,
  phase: "question", // 'question' | 'feedback' | 'summary'
  answered: false,
  selectedOption: null,
  history: null,
  // For complex question types
  cellAnswers: {}, // table_parse cell values
  groupAnswers: {}, // grouped question values
  partialScore: 0, // partial points earned
  maxPartialScore: 0, // max possible partial points
};

let subjects = [];
let subjectMap = {};

/**
 * Initialize the quiz
 */
export async function initQuiz() {
  // Load subjects
  try {
    const data = await loadJSON("data/subjects.json");
    subjects = data.subjects || data || [];

    // Build subject map
    subjects.forEach((s) => {
      subjectMap[s.id] = s;
    });
  } catch (error) {
    showError("Kan vakken niet laden: " + error.message);
    return;
  }

  // Get subject from URL
  const subjectId = getUrlParam("subject");
  if (!subjectId || !subjectMap[subjectId]) {
    showError("Onbekend vak. Ga terug naar de homepage.");
    return;
  }

  // Initialize
  state.subjectId = subjectId;
  state.subjectMeta = subjectMap[subjectId];
  state.history = createSessionHistory();

  // Setup timer callbacks
  initTimer({
    onTimeUp: handleTimeUp,
  });

  // Setup event listeners
  setupEventListeners();

  // Check for saved progress
  const savedProgress = loadQuizProgress(subjectId);
  if (savedProgress && savedProgress.currentIndex > 0) {
    showResumePrompt(savedProgress);
  } else {
    // Load questions and start fresh
    await loadQuestions();
  }
}

/**
 * Show resume prompt for saved progress
 */
function showResumePrompt(savedProgress) {
  const container = $("quizArea");
  if (!container) return;

  const percentage =
    savedProgress.totalQuestions > 0
      ? Math.round(
          (savedProgress.currentIndex / savedProgress.totalQuestions) * 100,
        )
      : 0;

  container.innerHTML = `
    <div class="card" style="text-align: center; padding: var(--space-6);">
      <h3 style="margin-bottom: var(--space-3);">Voortgang gevonden</h3>
      <p style="color: var(--muted); margin-bottom: var(--space-4);">
        Je was bij vraag ${savedProgress.currentIndex + 1} van ${savedProgress.totalQuestions} (${percentage}% voltooid).<br>
        Score: ${savedProgress.score} goed, ${savedProgress.wrong} fout
      </p>
      <div style="display: flex; gap: var(--space-3); justify-content: center;">
        <button class="btn btn-primary" id="resumeQuizBtn">Doorgaan</button>
        <button class="btn" id="restartQuizBtn">Opnieuw beginnen</button>
      </div>
    </div>
  `;

  $("resumeQuizBtn")?.addEventListener("click", async () => {
    await loadQuestions(savedProgress);
  });

  $("restartQuizBtn")?.addEventListener("click", async () => {
    clearQuizProgress(state.subjectId);
    await loadQuestions();
  });
}

/**
 * Load questions for current subject
 */
async function loadQuestions(savedProgress = null) {
  // Show loading state
  const container = $("quizArea");
  if (container) {
    showLoading(container, "Vragen laden...");
  }

  try {
    const meta = state.subjectMeta;
    const data = await loadJSON(meta.file);

    // Extract questions based on schema
    let questions = [];
    if (meta.schema === "toets") {
      if (Array.isArray(data.questions)) {
        questions = data.questions;
      } else if (Array.isArray(data.toets)) {
        data.toets.forEach((section) => {
          if (section.vragen) {
            questions.push(...section.vragen);
          }
        });
      }
    } else {
      questions = data.questions || data || [];
    }

    if (!questions.length) {
      throw new Error("Geen vragen gevonden");
    }

    // Normalize questions
    let normalized = questions.map((q) =>
      normalizeQuestion(q, meta.schema === "quiz"),
    );

    // Increment session and apply spaced repetition
    incrementSession(state.subjectId);
    normalized = getSpacedQuestions(state.subjectId, normalized);

    // Only shuffle for quizzes, not for toets (structured tests need fixed order)
    if (meta.schema !== "toets") {
      shuffle(normalized);
    }

    // Shuffle MC answers (only for quizzes)
    state.questions = normalized.map((q) => {
      if (q.type === "mc" && meta.schema !== "toets") {
        return shuffleMCAnswers(q);
      }
      return q;
    });

    // Restore or reset state
    if (savedProgress && savedProgress.questions) {
      // Restore saved state
      state.questions = savedProgress.questions;
      state.currentIndex = savedProgress.currentIndex;
      state.score = savedProgress.score;
      state.wrong = savedProgress.wrong;
      state.skipped = savedProgress.skipped || 0;
    } else {
      // Fresh start
      state.currentIndex = 0;
      state.score = 0;
      state.wrong = 0;
      state.skipped = 0;
    }
    state.phase = "question";
    state.history.clear();

    // Render current question
    renderQuestion();
    updateUI();
  } catch (error) {
    showError("Kan vragen niet laden: " + error.message);
  }
}

/**
 * Normalize question to standard format
 */
function normalizeQuestion(raw, preferMC = false) {
  // Special types stay as-is
  const richTypes = [
    "short_text",
    "grouped_short_text",
    "translation_open",
    "grouped_translation",
    "table_parse",
    "grouped_select",
  ];
  if (richTypes.includes(raw.type)) {
    return raw;
  }

  // Detect MC
  const hasMC =
    Array.isArray(raw.answers) ||
    Array.isArray(raw.options) ||
    Array.isArray(raw.a);

  if ((preferMC && hasMC) || raw.type === "mc" || hasMC) {
    const answers = raw.answers || raw.a || [];
    let correctIndex = raw.correctIndex ?? raw.c ?? null;

    // Extract from options format
    if (Array.isArray(raw.options)) {
      raw.options.forEach((opt, idx) => {
        answers.push(opt.text ?? "");
        if (opt.correct && correctIndex === null) {
          correctIndex = idx;
        }
      });
    }

    return {
      id: raw.id,
      type: "mc",
      q: raw.q || raw.question || "",
      answers,
      correctIndex,
      explanation: raw.explanation || raw.why || raw.e || "",
      graph: raw.graph || null,
      image: raw.image || null,
    };
  }

  // Open question
  return {
    id: raw.id,
    type: "open",
    q: raw.q || raw.question || raw.vraag || "",
    accept: raw.accept || [],
    caseSensitive: !!raw.caseSensitive,
    explanation: raw.explanation || raw.e || "",
    graph: raw.graph || null,
    image: raw.image || null,
  };
}

/**
 * Shuffle MC answers while tracking correct index
 */
function shuffleMCAnswers(q) {
  if (q.type !== "mc" || !Array.isArray(q.answers)) return q;

  const indices = q.answers.map((_, i) => i);
  shuffle(indices);

  const newAnswers = [];
  let newCorrectIndex = null;

  indices.forEach((oldIdx, newIdx) => {
    newAnswers.push(q.answers[oldIdx]);
    if (oldIdx === q.correctIndex) {
      newCorrectIndex = newIdx;
    }
  });

  return {
    ...q,
    answers: newAnswers,
    correctIndex: newCorrectIndex,
  };
}

/**
 * Render current question
 */
function renderQuestion() {
  const q = state.questions[state.currentIndex];
  if (!q) {
    renderSummary();
    return;
  }

  const container = $("quizArea");
  if (!container) return;

  state.phase = "question";
  state.answered = false;
  state.selectedOption = null;
  state.cellAnswers = {};
  state.groupAnswers = {};
  state.partialScore = 0;
  state.maxPartialScore = 0;

  // Reset timer
  resetTimer(QUESTION_SECONDS);
  startTimer();

  // Render based on type
  switch (q.type) {
    case "mc":
      renderMC(container, q);
      break;
    case "open":
      renderOpen(container, q);
      break;
    case "short_text":
      renderShortText(container, q);
      break;
    case "table_parse":
      renderTableParse(container, q);
      break;
    case "grouped_short_text":
      renderGroupedShortText(container, q);
      break;
    case "grouped_translation":
      renderGroupedTranslation(container, q);
      break;
    case "grouped_select":
      renderGroupedSelect(container, q);
      break;
    case "translation_open":
      renderTranslationOpen(container, q);
      break;
    default:
      // Fallback for unknown types
      renderOpen(container, {
        q: q.prompt_html || q.prompt || q.q || "Vraag",
        accept: [],
        explanation: "",
      });
  }

  // Update controls
  updateControls();
}

/**
 * Render multiple choice question
 */
function renderMC(container, q) {
  const optionsHtml = q.answers
    .map(
      (answer, idx) => `
    <div class="option" data-idx="${idx}" tabindex="0" role="radio" aria-checked="false">
      <span class="option-marker">${String.fromCharCode(65 + idx)}</span>
      <span class="option-text">${answer}</span>
    </div>
  `,
    )
    .join("");

  container.innerHTML = `
    <div class="question-title">${q.q}</div>
    <div class="options-list" role="radiogroup">
      ${optionsHtml}
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

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
 * Render open question
 */
function renderOpen(container, q) {
  container.innerHTML = `
    <div class="question-title">${q.q}</div>
    ${q.graph ? '<div id="graphContainer" class="graph-container"></div>' : ""}
    ${q.image ? `<div class="question-image"><img src="${q.image}" alt="Afbeelding bij vraag"></div>` : ""}
    <div class="open-input-wrap">
      <input type="text" id="openInput" class="open-input" placeholder="Typ je antwoord..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  // Render graph if present
  if (q.graph) {
    renderGraph($("graphContainer"), q.graph);
  }

  const input = $("openInput");
  if (input) {
    input.addEventListener("input", () => {
      const checkBtn = $("checkBtn");
      if (checkBtn) {
        checkBtn.disabled = input.value.trim().length === 0;
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim().length > 0) {
        e.preventDefault();
        checkAnswer();
      }
    });
    input.focus();
  }

  // Disable check button initially
  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Render a graph/coordinate system
 */
function renderGraph(container, config) {
  if (!container || !config) return;

  const graph = createCoordinateSystem({
    width: 320,
    height: 320,
    xMin: config.xMin ?? -6,
    xMax: config.xMax ?? 6,
    yMin: config.yMin ?? -6,
    yMax: config.yMax ?? 6,
    showGrid: config.showGrid !== false,
    showLabels: config.showLabels !== false,
  });

  // Add points
  if (Array.isArray(config.points)) {
    config.points.forEach((p) => {
      graph.addPoint(p.x, p.y, {
        label: p.label || "",
        color: p.color || "#6366f1",
      });
    });
  }

  // Add lines
  if (Array.isArray(config.lines)) {
    config.lines.forEach((l) => {
      graph.addLine(l.x1, l.y1, l.x2, l.y2, {
        color: l.color || "#6366f1",
        dashed: l.dashed || false,
      });
    });
  }

  // Add functions (parsed from string)
  if (Array.isArray(config.functions)) {
    config.functions.forEach((f) => {
      try {
        // Simple function parser: "2*x+1" -> (x) => 2*x+1
        const fn = new Function("x", `return ${f.expr}`);
        graph.addFunction(fn, { color: f.color || "#ef4444" });
      } catch (e) {
        console.warn("Invalid function:", f.expr);
      }
    });
  }

  container.appendChild(graph.svg);
}

/* ===========================================
   Complex Question Type Renderers
   =========================================== */

/**
 * Render short_text question (single-line input)
 */
function renderShortText(container, q) {
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
      const checkBtn = $("checkBtn");
      if (checkBtn) {
        checkBtn.disabled = input.value.trim().length === 0;
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim().length > 0) {
        e.preventDefault();
        checkAnswer();
      }
    });
    input.focus();
  }

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Render table_parse question (declension tables)
 */
function renderTableParse(container, q) {
  const blocks = q.blocks || [];

  if (blocks.length === 0) {
    // Fallback for table variant without blocks
    renderOpen(container, { q: q.prompt_html || "Vraag", accept: [] });
    return;
  }

  // Build table header with lemma names
  const headerCells = blocks
    .map((b) => `<th class="table-lemma">${b.lemma}</th>`)
    .join("");

  // Get row labels from first block
  const rowLabels = blocks[0]?.rows?.map((r) => r.veld) || [];

  // Build table rows
  const rowsHtml = rowLabels
    .map((label, rowIdx) => {
      const cells = blocks
        .map((block, blockIdx) => {
          const row = block.rows[rowIdx];
          const cellId = `cell-${blockIdx}-${rowIdx}`;

          if (row.invulbaar) {
            return `
          <td class="table-cell table-cell-input">
            <input type="text"
                   id="${cellId}"
                   data-block="${blockIdx}"
                   data-row="${rowIdx}"
                   class="table-input"
                   placeholder="..."
                   autocomplete="off">
          </td>`;
          } else {
            return `<td class="table-cell table-cell-given">${row.given || ""}</td>`;
          }
        })
        .join("");

      return `<tr><td class="table-row-label">${label}</td>${cells}</tr>`;
    })
    .join("");

  const fillableCount = countFillableCells(blocks);

  container.innerHTML = `
    <div class="question-title">${q.prompt_html || "Vul de tabel in."}</div>
    <div class="table-scroll-wrap">
      <table class="declension-table question-table">
        <thead>
          <tr>
            <th class="table-corner"></th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
    <div class="table-progress">
      <span id="tableFilled">0</span> / <span id="tableTotal">${fillableCount}</span> ingevuld
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  // Track input changes and update progress
  $$$(".table-input", container).forEach((input) => {
    input.addEventListener("input", () => {
      state.cellAnswers[input.id] = input.value;
      updateTableProgress();
    });
  });

  // Focus first input
  const firstInput = $$(".table-input", container);
  if (firstInput) firstInput.focus();

  // Disable check button initially
  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Update table progress indicator
 */
function updateTableProgress() {
  const filled = $$$(".table-input").filter(
    (i) => i.value.trim().length > 0,
  ).length;
  const filledEl = $("tableFilled");
  if (filledEl) filledEl.textContent = filled;

  // Enable check if at least one cell filled
  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = filled === 0;
}

/**
 * Render grouped_short_text question (vocabulary translations)
 */
function renderGroupedShortText(container, q) {
  const items = q.words || q.items || [];

  const itemsHtml = items
    .map((item, idx) => {
      const hasSubfields =
        Array.isArray(item.subfields) && item.subfields.length > 0;
      const latinText = item.latijn || item.vraag || "";

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
      `,
          )
          .join("");

        return `
        <div class="grouped-item" data-idx="${idx}">
          <div class="grouped-latin">${latinText}</div>
          <div class="grouped-subfields">${subfieldsHtml}</div>
        </div>
      `;
      }

      return `
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
    <div class="question-title">${q.prompt_html || "Vertaal de woorden."}</div>
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

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Render grouped_translation question (translate underlined words in context)
 */
function renderGroupedTranslation(container, q) {
  const items = q.items || [];

  const itemsHtml = items
    .map(
      (item, idx) => `
    <div class="translation-item" data-idx="${idx}">
      <div class="translation-sentence">${item.latijn_html}</div>
      <input type="text"
             id="trans-${idx}"
             class="translation-input grouped-input"
             data-idx="${idx}"
             placeholder="Vertaling van het onderstreepte woord..."
             autocomplete="off">
    </div>
  `,
    )
    .join("");

  container.innerHTML = `
    <div class="question-title">${q.prompt_html || "Vertaal de onderstreepte woorden."}</div>
    <div class="translation-list">
      ${itemsHtml}
    </div>
    <div class="group-progress">
      <span id="groupFilled">0</span> / <span>${items.length}</span> ingevuld
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  $$$(".translation-input", container).forEach((input) => {
    input.addEventListener("input", updateGroupProgress);
  });

  const firstInput = $$(".translation-input", container);
  if (firstInput) firstInput.focus();

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Render grouped_select question (dropdown selectors for grammatical analysis)
 */
function renderGroupedSelect(container, q) {
  const items = q.items || [];
  const legend = q.legend || {};

  const naamvalOptions = (legend.naamval_options || [])
    .map((opt) => `<option value="${opt}">${opt}</option>`)
    .join("");

  const getalOptions = (legend.getal_options || [])
    .map((opt) => `<option value="${opt}">${opt}</option>`)
    .join("");

  const verklaringOptions = (legend.verklaring_options || [])
    .map((opt) => `<option value="${opt}">${opt}</option>`)
    .join("");

  const itemsHtml = items
    .map(
      (item, idx) => `
    <div class="select-item" data-idx="${idx}">
      <div class="select-sentence">${item.latijn_html}</div>
      <div class="select-row">
        <div class="select-group">
          <label class="select-label">Naamval</label>
          <select id="naamval-${idx}" class="select-input" data-idx="${idx}" data-field="naamval">
            <option value="">Kies...</option>
            ${naamvalOptions}
          </select>
        </div>
        <div class="select-group">
          <label class="select-label">Getal</label>
          <select id="getal-${idx}" class="select-input" data-idx="${idx}" data-field="getal">
            <option value="">Kies...</option>
            ${getalOptions}
          </select>
        </div>
        <div class="select-group">
          <label class="select-label">Verklaring</label>
          <select id="verklaring-${idx}" class="select-input" data-idx="${idx}" data-field="verklaring">
            <option value="">Kies...</option>
            ${verklaringOptions}
          </select>
        </div>
      </div>
    </div>
  `,
    )
    .join("");

  container.innerHTML = `
    <div class="question-title">${q.prompt_html || "Bepaal naamval, getal en verklaring."}</div>
    <div class="select-list">
      ${itemsHtml}
    </div>
    <div class="group-progress">
      <span id="selectProgress">0</span> / <span>${items.length}</span> volledig ingevuld
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  $$$(".select-input", container).forEach((select) => {
    select.addEventListener("change", updateSelectProgress);
  });

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Render translation_open question (full sentence translation)
 */
function renderTranslationOpen(container, q) {
  const rubric = q.rubric || "";

  container.innerHTML = `
    <div class="question-title">${q.prompt_html || "Vertaal de zin."}</div>
    <div class="translation-open-wrap">
      <textarea id="translationInput"
                class="open-input translation-textarea"
                placeholder="Typ je vertaling..."
                autocomplete="off"
                autocorrect="off"
                spellcheck="false"></textarea>
    </div>
    ${
      rubric
        ? `
      <details class="rubric-hint">
        <summary>💡 Hint voor nakijken</summary>
        <p>${rubric}</p>
      </details>
    `
        : ""
    }
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  const input = $("translationInput");
  if (input) {
    input.addEventListener("input", () => {
      const checkBtn = $("checkBtn");
      if (checkBtn) {
        checkBtn.disabled = input.value.trim().length === 0;
      }
    });
    input.focus();
  }

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Update group progress indicator (for grouped_short_text, grouped_translation)
 */
function updateGroupProgress() {
  const filled = $$$(".grouped-input").filter(
    (i) => i.value.trim().length > 0,
  ).length;
  const filledEl = $("groupFilled");
  if (filledEl) filledEl.textContent = filled;

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = filled === 0;
}

/**
 * Update select progress indicator (for grouped_select)
 */
function updateSelectProgress() {
  const items = $$$(".select-item");
  let completeCount = 0;

  items.forEach((item) => {
    const selects = $$$(".select-input", item);
    const allFilled = selects.every((s) => s.value !== "");
    if (allFilled) completeCount++;
  });

  const progressEl = $("selectProgress");
  if (progressEl) progressEl.textContent = completeCount;

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = completeCount === 0;
}

/**
 * Select an MC option
 */
function selectOption(el) {
  if (state.answered) return;

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
 * Check the answer
 */
export function checkAnswer() {
  if (state.answered) return;

  const q = state.questions[state.currentIndex];
  stopTimer();

  switch (q.type) {
    case "mc":
      checkMCAnswer(q);
      break;
    case "open":
      checkOpenAnswer(q);
      break;
    case "short_text":
      checkShortText(q);
      break;
    case "table_parse":
      checkTableParse(q);
      break;
    case "grouped_short_text":
      checkGroupedShortText(q);
      break;
    case "grouped_translation":
      checkGroupedTranslation(q);
      break;
    case "grouped_select":
      checkGroupedSelect(q);
      break;
    case "translation_open":
      checkTranslationOpen(q);
      break;
    default:
      checkOpenAnswer(q);
  }

  state.answered = true;
  state.phase = "feedback";
  updateControls();
}

/**
 * Check MC answer
 */
function checkMCAnswer(q) {
  const isCorrect = state.selectedOption === q.correctIndex;

  // Mark options
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
  if (isCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, isCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, isCorrect);

  // Add to history
  state.history.add({
    question: q.q,
    type: "mc",
    userAnswer: q.answers[state.selectedOption],
    correctAnswer: q.answers[q.correctIndex],
    correct: isCorrect,
    explanation: q.explanation,
  });

  // Show feedback
  showFeedback(isCorrect, q.explanation, q.answers[q.correctIndex]);
}

/**
 * Check open answer
 */
function checkOpenAnswer(q) {
  const input = $("openInput");
  const value = input ? input.value.trim() : "";
  const isCorrect = checkAcceptList(q.accept || [], value, q.caseSensitive);

  if (isCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, isCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, isCorrect);

  // Add to history
  state.history.add({
    question: q.q,
    type: "open",
    userAnswer: value,
    correctAnswer: q.accept[0] || "",
    correct: isCorrect,
    explanation: q.explanation,
  });

  showFeedback(isCorrect, q.explanation, q.accept[0]);
}

/**
 * Check if answer matches accept list
 */
function checkAcceptList(acceptList, input, caseSensitive = false) {
  const normalized = caseSensitive ? input.trim() : input.trim().toLowerCase();

  for (const accept of acceptList) {
    // Check for regex pattern
    if (
      typeof accept === "string" &&
      accept.startsWith("/") &&
      accept.lastIndexOf("/") > 0
    ) {
      try {
        const lastSlash = accept.lastIndexOf("/");
        const pattern = accept.slice(1, lastSlash);
        const flags = accept.slice(lastSlash + 1);
        const regex = new RegExp(pattern, flags);
        if (regex.test(input)) return true;
      } catch (e) {
        // Invalid regex, skip
      }
    } else {
      // Plain string comparison
      const target = caseSensitive
        ? String(accept).trim()
        : String(accept).trim().toLowerCase();
      if (normalized === target) return true;
    }
  }

  return false;
}

/* ===========================================
   Complex Question Type Checkers
   =========================================== */

/**
 * Check short_text answer
 */
function checkShortText(q) {
  const input = $("shortInput");
  const value = input?.value?.trim() || "";

  const answer = q.answer || {};
  const accepted = answer.accepted || [];
  const opts = {
    lowercase: !answer.case_sensitive,
    normalize_diacritics: answer.normalize_diacritics,
    trim: answer.trim !== false,
  };

  const isCorrect = matchesAcceptList(value, accepted, {}, opts);

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
    question: htmlToText(q.prompt_html || q.q),
    type: "short_text",
    userAnswer: value,
    correctAnswer: accepted[0] || "",
    correct: isCorrect,
  });

  showFeedback(isCorrect, "", accepted[0]);
}

/**
 * Check table_parse answer (declension tables)
 */
function checkTableParse(q) {
  const blocks = q.blocks || [];
  const grading = q.grading || { per_cell_points: 0.5 };
  let correctCount = 0;
  let totalFillable = 0;
  const results = [];

  blocks.forEach((block, blockIdx) => {
    block.rows.forEach((row, rowIdx) => {
      if (row.invulbaar) {
        totalFillable++;
        const cellId = `cell-${blockIdx}-${rowIdx}`;
        const input = $(cellId);
        const value = input?.value?.trim() || "";
        const isCorrect = matchesAcceptList(
          value,
          row.accepted || [],
          {},
          { lowercase: true },
        );

        if (isCorrect) {
          correctCount++;
          input?.classList.add("input-correct");
        } else {
          input?.classList.add("input-wrong");
        }

        results.push({
          veld: row.veld,
          lemma: block.lemma,
          value,
          correct: isCorrect,
          expected: row.accepted[0],
        });
      }
    });
  });

  // Calculate partial score
  const earnedPoints = correctCount * (grading.per_cell_points || 0.5);
  const maxPoints = totalFillable * (grading.per_cell_points || 0.5);
  const isFullyCorrect = correctCount === totalFillable;

  // Update score (count as correct if > 50%)
  if (correctCount >= totalFillable / 2) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, isFullyCorrect);

  state.partialScore = earnedPoints;
  state.maxPartialScore = maxPoints;

  state.history.add({
    question: htmlToText(q.prompt_html),
    type: "table_parse",
    correctCount,
    totalCount: totalFillable,
    correct: isFullyCorrect,
    partialScore: earnedPoints,
  });

  showTableFeedback(
    correctCount,
    totalFillable,
    results,
    earnedPoints,
    maxPoints,
  );
}

/**
 * Check grouped_short_text answer (vocabulary translations)
 */
function checkGroupedShortText(q) {
  const items = q.words || q.items || [];
  let totalCorrect = 0;
  let totalItems = 0;
  const results = [];

  items.forEach((item, idx) => {
    if (Array.isArray(item.subfields) && item.subfields.length > 0) {
      item.subfields.forEach((sf, sfIdx) => {
        totalItems++;
        const input = $(`word-${idx}-sf-${sfIdx}`);
        const value = input?.value?.trim() || "";
        const isCorrect = matchesAcceptList(
          value,
          sf.accepted || [],
          {},
          { lowercase: true },
        );

        input?.classList.add(isCorrect ? "input-correct" : "input-wrong");
        if (isCorrect) totalCorrect++;

        results.push({
          latin: item.latijn || item.vraag,
          label: sf.label,
          value,
          correct: isCorrect,
          expected: sf.accepted?.[0],
        });
      });
    } else {
      totalItems++;
      const input = $(`word-${idx}`);
      const value = input?.value?.trim() || "";
      const isCorrect = matchesAcceptList(
        value,
        item.accepted || [],
        {},
        { lowercase: true },
      );

      input?.classList.add(isCorrect ? "input-correct" : "input-wrong");
      if (isCorrect) totalCorrect++;

      results.push({
        latin: item.latijn || item.vraag,
        value,
        correct: isCorrect,
        expected: item.accepted?.[0],
      });
    }
  });

  const isFullyCorrect = totalCorrect === totalItems;
  if (totalCorrect >= totalItems / 2) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, isFullyCorrect);

  state.history.add({
    question: htmlToText(q.prompt_html),
    type: "grouped_short_text",
    correctCount: totalCorrect,
    totalCount: totalItems,
    correct: isFullyCorrect,
  });

  showGroupedFeedback(totalCorrect, totalItems, results);
}

/**
 * Check grouped_translation answer
 */
function checkGroupedTranslation(q) {
  const items = q.items || [];
  let correctCount = 0;
  const results = [];

  items.forEach((item, idx) => {
    const input = $(`trans-${idx}`);
    const value = input?.value?.trim() || "";
    const isCorrect = matchesAcceptList(
      value,
      item.accepted || [],
      {},
      { lowercase: true },
    );

    input?.classList.add(isCorrect ? "input-correct" : "input-wrong");
    if (isCorrect) correctCount++;

    results.push({
      sentence: item.latijn_html,
      value,
      correct: isCorrect,
      expected: item.accepted?.[0],
    });
  });

  const isFullyCorrect = correctCount === items.length;
  if (correctCount >= items.length / 2) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, isFullyCorrect);

  state.history.add({
    question: htmlToText(q.prompt_html),
    type: "grouped_translation",
    correctCount,
    totalCount: items.length,
    correct: isFullyCorrect,
  });

  showGroupedFeedback(correctCount, items.length, results);
}

/**
 * Check grouped_select answer (grammatical analysis)
 */
function checkGroupedSelect(q) {
  const items = q.items || [];
  const grading = q.grading || {};
  const results = [];
  let totalPoints = 0;
  let maxPoints = 0;

  items.forEach((item, idx) => {
    const naamval = $(`naamval-${idx}`)?.value || "";
    const getal = $(`getal-${idx}`)?.value || "";
    const verklaring = $(`verklaring-${idx}`)?.value || "";

    const correct = item.correct || {};
    let matchCount = 0;

    const naamvalCorrect = naamval === correct.naamval;
    const getalCorrect = getal === correct.getal;
    const verklaringCorrect = verklaring === correct.verklaring;

    if (naamvalCorrect) matchCount++;
    if (getalCorrect) matchCount++;
    if (verklaringCorrect) matchCount++;

    // Calculate points based on grading rules
    const itemPoints = item.points || 1;
    maxPoints += itemPoints;
    let earnedPoints = 0;

    if (matchCount >= (grading.full_points_if || 3)) {
      earnedPoints = itemPoints;
    } else if (matchCount >= (grading.half_points_if || 2)) {
      earnedPoints = itemPoints / 2;
    }
    totalPoints += earnedPoints;

    // Mark the item container
    const container = $$(`[data-idx="${idx}"].select-item`);
    if (container) {
      if (matchCount === 3) {
        container.classList.add("item-correct");
      } else if (matchCount > 0) {
        container.classList.add("item-partial");
      } else {
        container.classList.add("item-wrong");
      }
    }

    results.push({
      sentence: item.latijn_html,
      user: { naamval, getal, verklaring },
      correct: item.correct,
      matchCount,
      earnedPoints,
      details: {
        naamval: naamvalCorrect,
        getal: getalCorrect,
        verklaring: verklaringCorrect,
      },
    });
  });

  const isFullyCorrect = totalPoints === maxPoints;
  if (totalPoints >= maxPoints / 2) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, isFullyCorrect);

  state.history.add({
    question: htmlToText(q.prompt_html),
    type: "grouped_select",
    results,
    correct: isFullyCorrect,
    totalPoints,
    maxPoints,
  });

  showSelectFeedback(results, totalPoints, maxPoints);
}

/**
 * Check translation_open answer
 */
function checkTranslationOpen(q) {
  const input = $("translationInput");
  const value = input?.value?.trim() || "";

  const answer = q.answer || {};
  const normalizeOpts = answer.normalize || {};

  const opts = {
    lowercase: normalizeOpts.lowercase,
    strip_punctuation: normalizeOpts.strip_punctuation,
    collapse_whitespace: normalizeOpts.collapse_whitespace,
  };

  // Normalize user input
  const normalizedValue = normalizeAnswer(value, opts);

  // Check against accepted_any (array of arrays)
  let isCorrect = false;
  const acceptedAny = answer.accepted_any || [];

  for (const acceptGroup of acceptedAny) {
    for (const accept of acceptGroup) {
      if (normalizedValue === normalizeAnswer(accept, opts)) {
        isCorrect = true;
        break;
      }
    }
    if (isCorrect) break;
  }

  if (isCorrect) {
    state.score++;
    input?.classList.add("input-correct");
  } else {
    state.wrong++;
    input?.classList.add("input-wrong");
  }
  updateStats(state.subjectId, isCorrect);

  state.history.add({
    question: htmlToText(q.prompt_html),
    type: "translation_open",
    userAnswer: value,
    correct: isCorrect,
  });

  const expectedAnswer = acceptedAny[0]?.[0] || "";
  showFeedback(isCorrect, q.rubric || "", expectedAnswer);
}

/* ===========================================
   Feedback Display Functions
   =========================================== */

/**
 * Show feedback for table_parse questions
 */
function showTableFeedback(
  correctCount,
  totalCount,
  results,
  earnedPoints,
  maxPoints,
) {
  const feedbackEl = $("feedback");
  if (!feedbackEl) return;

  const isFullyCorrect = correctCount === totalCount;
  const isPartial = correctCount > 0 && !isFullyCorrect;

  let className = "feedback-error";
  let icon = "✗";
  let title = "Niet goed";

  if (isFullyCorrect) {
    className = "feedback-success";
    icon = "✓";
    title = "Alles goed!";
  } else if (isPartial) {
    className = "feedback-partial";
    icon = "◐";
    title = "Gedeeltelijk goed";
  }

  const wrongResults = results.filter((r) => !r.correct);
  const wrongHtml =
    wrongResults.length > 0
      ? `
    <div class="feedback-results">
      <div class="feedback-results-title">Verbeteringen:</div>
      <div class="feedback-results-list">
        ${wrongResults
          .map(
            (r) => `
          <div class="feedback-result-item wrong">
            <span class="feedback-icon">✗</span>
            <span><strong>${r.lemma}</strong> (${r.veld}): ${r.value || "(leeg)"} → <strong>${r.expected}</strong></span>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `
      : "";

  feedbackEl.className = `feedback ${className}`;
  feedbackEl.innerHTML = `
    <div class="feedback-header">
      <span>${icon}</span>
      <span>${title}</span>
    </div>
    <div class="feedback-score">${correctCount} / ${totalCount} goed (${earnedPoints.toFixed(1)} / ${maxPoints.toFixed(1)} punten)</div>
    ${wrongHtml}
  `;
  feedbackEl.style.display = "block";
}

/**
 * Show feedback for grouped questions
 */
function showGroupedFeedback(correctCount, totalCount, results) {
  const feedbackEl = $("feedback");
  if (!feedbackEl) return;

  const isFullyCorrect = correctCount === totalCount;
  const isPartial = correctCount > 0 && !isFullyCorrect;

  let className = "feedback-error";
  let icon = "✗";
  let title = "Niet goed";

  if (isFullyCorrect) {
    className = "feedback-success";
    icon = "✓";
    title = "Alles goed!";
  } else if (isPartial) {
    className = "feedback-partial";
    icon = "◐";
    title = "Gedeeltelijk goed";
  }

  const wrongResults = results.filter((r) => !r.correct);
  const wrongHtml =
    wrongResults.length > 0
      ? `
    <div class="feedback-results">
      <div class="feedback-results-title">Verbeteringen:</div>
      <div class="feedback-results-list">
        ${wrongResults
          .map(
            (r) => `
          <div class="feedback-result-item wrong">
            <span class="feedback-icon">✗</span>
            <span><strong>${r.latin || ""}</strong>${r.label ? ` (${r.label})` : ""}: ${r.value || "(leeg)"} → <strong>${r.expected}</strong></span>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `
      : "";

  feedbackEl.className = `feedback ${className}`;
  feedbackEl.innerHTML = `
    <div class="feedback-header">
      <span>${icon}</span>
      <span>${title}</span>
    </div>
    <div class="feedback-score">${correctCount} / ${totalCount} goed</div>
    ${wrongHtml}
  `;
  feedbackEl.style.display = "block";
}

/**
 * Show feedback for grouped_select questions
 */
function showSelectFeedback(results, totalPoints, maxPoints) {
  const feedbackEl = $("feedback");
  if (!feedbackEl) return;

  const perfectCount = results.filter((r) => r.matchCount === 3).length;
  const isFullyCorrect = perfectCount === results.length;
  const isPartial = totalPoints > 0 && !isFullyCorrect;

  let className = "feedback-error";
  let icon = "✗";
  let title = "Niet goed";

  if (isFullyCorrect) {
    className = "feedback-success";
    icon = "✓";
    title = "Alles goed!";
  } else if (isPartial) {
    className = "feedback-partial";
    icon = "◐";
    title = "Gedeeltelijk goed";
  }

  const incorrectResults = results.filter((r) => r.matchCount < 3);
  const detailsHtml =
    incorrectResults.length > 0
      ? `
    <div class="feedback-results">
      <div class="feedback-results-title">Verbeteringen:</div>
      <div class="feedback-results-list">
        ${incorrectResults
          .map((r) => {
            const corrections = [];
            if (!r.details.naamval)
              corrections.push(`naamval: ${r.correct.naamval}`);
            if (!r.details.getal) corrections.push(`getal: ${r.correct.getal}`);
            if (!r.details.verklaring)
              corrections.push(`verklaring: ${r.correct.verklaring}`);
            return `
            <div class="feedback-result-item ${r.matchCount > 0 ? "partial" : "wrong"}">
              <span class="feedback-icon">${r.matchCount > 0 ? "◐" : "✗"}</span>
              <span>${r.matchCount}/3 goed → ${corrections.join(", ")}</span>
            </div>
          `;
          })
          .join("")}
      </div>
    </div>
  `
      : "";

  feedbackEl.className = `feedback ${className}`;
  feedbackEl.innerHTML = `
    <div class="feedback-header">
      <span>${icon}</span>
      <span>${title}</span>
    </div>
    <div class="feedback-score">${perfectCount} / ${results.length} volledig goed (${totalPoints.toFixed(1)} / ${maxPoints.toFixed(1)} punten)</div>
    ${detailsHtml}
  `;
  feedbackEl.style.display = "block";
}

/**
 * Show feedback
 */
function showFeedback(isCorrect, explanation, correctAnswer) {
  const feedbackEl = $("feedback");
  if (!feedbackEl) return;

  const icon = isCorrect ? "✓" : "✗";
  const title = isCorrect ? "Goed!" : "Niet goed";
  const className = isCorrect ? "feedback-success" : "feedback-error";

  let html = `
    <div class="feedback-header">
      <span>${icon}</span>
      <span>${title}</span>
    </div>
  `;

  if (!isCorrect && correctAnswer) {
    html += `<div class="feedback-body">Het juiste antwoord is: <strong>${correctAnswer}</strong></div>`;
  }

  if (explanation) {
    html += `<div class="feedback-body">${explanation}</div>`;
  }

  feedbackEl.className = `feedback ${className}`;
  feedbackEl.innerHTML = html;
  feedbackEl.style.display = "block";
}

/**
 * Handle time up
 */
function handleTimeUp() {
  if (state.answered) return;

  const q = state.questions[state.currentIndex];

  state.wrong++;
  state.answered = true;
  state.phase = "feedback";

  state.history.add({
    question: q.q || htmlToText(q.prompt_html) || "Vraag",
    type: q.type,
    userAnswer: "(tijd op)",
    correct: false,
    timedOut: true,
  });

  // Show feedback
  const feedbackEl = $("feedback");
  if (feedbackEl) {
    feedbackEl.className = "feedback feedback-error";
    feedbackEl.innerHTML = `
      <div class="feedback-header">
        <span>⏱️</span>
        <span>Tijd voorbij!</span>
      </div>
    `;
    feedbackEl.style.display = "block";
  }

  updateControls();
}

/**
 * Skip question
 */
export function skipQuestion() {
  const q = state.questions[state.currentIndex];
  stopTimer();

  state.skipped++;

  state.history.add({
    question: q.q || htmlToText(q.prompt_html) || "Vraag",
    type: q.type,
    userAnswer: "(overgeslagen)",
    correct: false,
    skipped: true,
  });

  // Move skipped question to end (optional revisit)
  if (!q._revisited) {
    const clone = { ...q, _revisited: true };
    state.questions.push(clone);
  }

  nextQuestion();
}

/**
 * Go to next question
 */
export function nextQuestion() {
  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex++;

    // Auto-save progress
    saveQuizProgress(state.subjectId, {
      currentIndex: state.currentIndex,
      totalQuestions: state.questions.length,
      questions: state.questions,
      score: state.score,
      wrong: state.wrong,
      skipped: state.skipped,
    });

    renderQuestion();
  } else {
    renderSummary();
  }
  updateUI();
}

/**
 * Render summary
 */
function renderSummary() {
  stopTimer();
  state.phase = "summary";

  // Clear saved progress since quiz is complete
  clearQuizProgress(state.subjectId);

  const container = $("quizArea");
  if (!container) return;

  const total = state.history.getTotal();
  const correct = state.history.getCorrectCount();
  const wrong = state.history.getWrongCount();
  const skipped = state.history.getSkippedCount();
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Show confetti for good scores (70%+)
  if (percentage >= 70) {
    showConfetti(4000);
  }

  // Build history table
  const historyRows = state.history
    .getAll()
    .map(
      (h, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${h.question.substring(0, 50)}${h.question.length > 50 ? "..." : ""}</td>
      <td>${h.userAnswer}</td>
      <td>
        ${h.correct ? '<span class="badge badge-success">Goed</span>' : ""}
        ${h.skipped ? '<span class="badge">Overgeslagen</span>' : ""}
        ${!h.correct && !h.skipped ? '<span class="badge badge-error">Fout</span>' : ""}
      </td>
    </tr>
  `,
    )
    .join("");

  container.innerHTML = `
    <div class="summary-card">
      <h2 class="summary-title">Ronde voltooid!</h2>

      <div class="summary-score">
        <div class="summary-stat correct">
          <div class="value">${correct}</div>
          <div class="label">Goed</div>
        </div>
        <div class="summary-stat wrong">
          <div class="value">${wrong}</div>
          <div class="label">Fout</div>
        </div>
        <div class="summary-stat">
          <div class="value">${percentage}%</div>
          <div class="label">Score</div>
        </div>
      </div>

      ${
        total > 0
          ? `
        <table class="summary-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Vraag</th>
              <th>Antwoord</th>
              <th>Resultaat</th>
            </tr>
          </thead>
          <tbody>
            ${historyRows}
          </tbody>
        </table>
      `
          : ""
      }

      <div class="mt-5">
        <button class="btn btn-primary btn-block" onclick="location.reload()">Opnieuw</button>
      </div>
    </div>
  `;

  updateControls();
}

/**
 * Show/hide pause overlay
 */
export function showPause() {
  pauseTimer();
  const overlay = $("pauseOverlay");
  const page = $$(".quiz-page");
  if (overlay) overlay.classList.add("show");
  if (page) page.classList.add("page-blur");
}

export function hidePause() {
  resumeTimer();
  const overlay = $("pauseOverlay");
  const page = $$(".quiz-page");
  if (overlay) overlay.classList.remove("show");
  if (page) page.classList.remove("page-blur");
}

/**
 * Update UI elements
 */
function updateUI() {
  updateMeta();
  updateProgress();
}

function updateMeta() {
  const statEl = $("stat");
  if (statEl) {
    const total = state.questions.length;
    const current = Math.min(state.currentIndex + 1, total);
    statEl.textContent = `${state.score} goed / ${state.wrong} fout / ${state.skipped} overgeslagen • vraag ${current} van ${total}`;
  }
}

function updateProgress() {
  const bar = $("progressBar");
  if (bar) {
    const total = state.questions.length;
    const pct = total > 0 ? Math.round((state.currentIndex / total) * 100) : 0;
    bar.style.width = `${pct}%`;
  }
}

function updateControls() {
  const checkBtn = $("checkBtn");
  const nextBtn = $("nextBtn");
  const skipBtn = $("skipBtn");
  const pauseBtn = $("pauseBtn");
  const rowMain = $("rowMain");
  const rowNext = $("rowNext");

  if (state.phase === "summary") {
    if (rowMain) rowMain.style.display = "none";
    if (rowNext) rowNext.style.display = "none";
    return;
  }

  if (state.phase === "feedback") {
    if (rowMain) rowMain.style.display = "none";
    if (rowNext) rowNext.style.display = "grid";
  } else {
    if (rowMain) rowMain.style.display = "grid";
    if (rowNext) rowNext.style.display = "none";
  }

  // Update next button text
  if (nextBtn) {
    nextBtn.textContent =
      state.currentIndex >= state.questions.length - 1
        ? "Resultaat"
        : "Volgende";
  }
}

/**
 * Show error message with retry option
 */
function showError(message) {
  const container = $("quizArea");
  if (container) {
    showErrorUI(container, message, () => {
      // Retry loading questions
      loadQuestions();
    });
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  const checkBtn = $("checkBtn");
  const nextBtn = $("nextBtn");
  const skipBtn = $("skipBtn");
  const pauseBtn = $("pauseBtn");
  const resumeBtn = $("resumeBtn");
  const restartBtn = $("btn-restart");

  if (checkBtn) checkBtn.addEventListener("click", checkAnswer);
  if (nextBtn) nextBtn.addEventListener("click", nextQuestion);
  if (skipBtn) skipBtn.addEventListener("click", skipQuestion);
  if (pauseBtn) pauseBtn.addEventListener("click", showPause);
  if (resumeBtn) resumeBtn.addEventListener("click", hidePause);
  if (restartBtn)
    restartBtn.addEventListener("click", () => {
      if (confirm("Weet je zeker dat je opnieuw wilt beginnen?")) {
        location.reload();
      }
    });
}

// Export state for debugging
export function getState() {
  return { ...state };
}
