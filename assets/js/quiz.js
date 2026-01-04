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
  setTimerMode,
} from "./timer.js";
import {
  updateStats,
  createSessionHistory,
  updateQuestionBox,
  incrementSession,
  getSpacedQuestions,
  getMasteryStats,
} from "./stats.js";
import {
  createCoordinateSystem,
  createLineGraph,
  createGlobalGraph,
} from "./graph.js";
import {
  initV2QuestionTypes,
  renderFillBlank,
  renderShortAnswer,
  renderMatching,
  renderNumeric,
  renderDataTable,
  renderMultipart,
  checkFillBlank,
  checkShortAnswer,
  checkMatching,
  checkNumeric,
  checkDataTable,
  checkMultipart,
  checkOrderingV2,
  // English question types
  renderVocabList,
  checkVocabList,
  renderGrammarTransform,
  checkGrammarTransform,
  renderGrammarFill,
  checkGrammarFill,
  renderSentenceCorrection,
  checkSentenceCorrection,
} from "./question-types-v2.js";
import {
  normalizeQuestion,
  shuffleMCAnswers,
  convertV2ToV1,
  selectQuestionsForSession,
  orderQuestionsForExam,
  expandCaseLabel,
  getCorrectAnswer,
} from "./quiz-utils.js";
import { checkAnswerWithAI, isAICheckingAvailable } from "./gemini.js";

// Constants
const QUESTION_SECONDS = 90;
const QUESTION_SECONDS_MULTIPART = 120;
const EXAM_DURATION_MINUTES = 60;
const EXAM_DURATION_SECONDS = EXAM_DURATION_MINUTES * 60; // 3600 seconds

/**
 * Award points for correct answer (updates score counters)
 * @param {string} questionId - The question ID
 * @param {boolean|number} correctAmount - true/false for simple questions, or fraction (0-1) for partial credit
 */
function awardPoints(questionId, correctAmount) {
  // Convert boolean to number
  let correctParts, wrongParts;
  if (typeof correctAmount === "boolean") {
    correctParts = correctAmount ? 1 : 0;
    wrongParts = correctAmount ? 0 : 1;
  } else {
    // correctAmount is a fraction (0-1) representing portion correct
    correctParts = correctAmount;
    wrongParts = 1 - correctAmount;
  }

  state.score += correctParts;
  state.wrong += wrongParts;

  // Track wrong questions for retry in practice mode (if any part was wrong)
  if (wrongParts > 0) {
    const q = state.questions[state.currentIndex];
    if (state.mode === "practice" && q?.id && !state.wrongQuestions.find(wq => wq.id === q.id)) {
      state.wrongQuestions.push(q);
    }
  }
}

// Grade calculation removed - only showing percentages now
// The old point-based grade system was broken for quizzes other than the original g-001 exam

// State
let state = {
  subjectId: null,
  subjectMeta: null,
  questions: [],
  currentIndex: 0,
  score: 0,
  wrong: 0,
  skipped: 0,
  phase: "question", // 'question' | 'feedback' | 'summary' | 'mode-select'
  answered: false,
  selectedOption: null,
  history: null,
  // For complex question types
  cellAnswers: {}, // table_parse cell values
  groupAnswers: {}, // grouped question values
  partialScore: 0, // partial points earned
  maxPartialScore: 0, // max possible partial points
  // Timer toggle
  timerEnabled: true,
  // Quiz mode: 'practice' (default) or 'exam'
  mode: "practice",
  // For retry wrong questions
  wrongQuestions: [],
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

  // Initialize v2 question types module
  initV2QuestionTypes(state, showFeedback, resetForNextPart);

  // Setup event listeners
  setupEventListeners();

  // Check for saved progress or show mode selection
  const savedProgress = loadQuizProgress(subjectId);
  if (savedProgress && savedProgress.currentIndex > 0) {
    showResumePrompt(savedProgress);
  } else {
    // Show mode selection screen
    showModeSelection();
  }
}

/**
 * Determine quiz mode from URL or subject config
 * Returns "practice", "exam", or null if mode selection should be shown
 */
function determineQuizMode() {
  const meta = state.subjectMeta;

  // Check URL parameter first (from subject page mode buttons)
  const urlMode = getUrlParam("mode");
  if (urlMode === "practice" || urlMode === "exam") {
    return urlMode;
  }

  // If subject is exam-only, always start exam
  if (meta?.examOnly) {
    return "exam";
  }

  // If subject supports both modes (has questionsPerSession AND examDurationMinutes),
  // but no URL mode was specified, default to practice
  if (meta?.questionsPerSession && meta?.examDurationMinutes) {
    return "practice"; // Default to practice if accessed without mode param
  }

  // Otherwise default to practice
  return "practice";
}

/**
 * Show mode selection or start quiz directly based on config
 */
function showModeSelection() {
  const mode = determineQuizMode();
  startQuiz(mode);
}

/**
 * Start quiz in selected mode
 */
async function startQuiz(mode) {
  state.mode = mode;

  // Set timer mode based on quiz mode
  if (mode === "exam") {
    setTimerMode("exam");
  } else {
    setTimerMode("question");
  }

  await loadQuestions();
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

  // Format scores for display (fractional scores from sub-questions)
  const scoreDisplay = formatScore(savedProgress.score);
  const wrongDisplay = formatScore(savedProgress.wrong);

  container.innerHTML = `
    <div class="card" style="text-align: center; padding: var(--space-6);">
      <h3 style="margin-bottom: var(--space-3);">Voortgang gevonden</h3>
      <p style="color: var(--muted); margin-bottom: var(--space-4);">
        Je was bij vraag ${savedProgress.currentIndex + 1} van ${savedProgress.totalQuestions} (${percentage}% voltooid).<br>
        Score: ${scoreDisplay} goed, ${wrongDisplay} fout
      </p>
      <div style="display: flex; gap: var(--space-3); justify-content: center;">
        <button class="btn btn-primary" id="resumeQuizBtn">Doorgaan</button>
        <button class="btn" id="restartQuizBtn">Opnieuw beginnen</button>
      </div>
    </div>
  `;

  $("resumeQuizBtn")?.addEventListener("click", async () => {
    // Restore mode from saved progress, or determine from config
    const mode = savedProgress.mode || determineQuizMode();
    state.mode = mode;
    if (mode === "exam") {
      setTimerMode("exam");
    } else {
      setTimerMode("question");
    }
    await loadQuestions(savedProgress);
  });

  $("restartQuizBtn")?.addEventListener("click", async () => {
    clearQuizProgress(state.subjectId);
    // Always determine correct mode (respects examOnly flag)
    const mode = determineQuizMode();
    state.mode = mode;
    if (mode === "exam") {
      setTimerMode("exam");
    } else {
      setTimerMode("question");
    }
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

    // Detect v2 schema (ChatGPT extended format)
    if (data.schema_version?.startsWith("2.") && Array.isArray(data.question_bank)) {
      // Convert v2 back to v1 using the preserved source.raw data
      questions = data.question_bank.map((q) => {
        // Use the original v1 format if available
        if (q.source?.raw) {
          return { ...q.source.raw, quiz_group: parseInt(q.group_id) || q.source.raw.quiz_group };
        }
        // Fallback: reconstruct from v2 payload
        return convertV2ToV1(q);
      });
    } else if (meta.schema === "toets") {
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

    // Handle based on quiz mode
    if (state.mode === "exam") {
      // EXAM MODE: All questions in fixed didactic order
      normalized = orderQuestionsForExam(normalized, state.subjectMeta, state.subjectId);
      // Don't shuffle MC answers in exam mode - keep them predictable
      state.questions = normalized;
    } else {
      // PRACTICE MODE: Subset with rotation and spaced repetition

      // Apply quiz rotation if questionsPerSession is set
      if (meta.questionsPerSession && normalized.length > meta.questionsPerSession) {
        normalized = selectQuestionsForSession(normalized, meta.questionsPerSession, state.subjectId);
      }

      // Increment session and apply spaced repetition
      incrementSession(state.subjectId);
      normalized = getSpacedQuestions(state.subjectId, normalized);

      // Shuffle for practice mode
      shuffle(normalized);

      // Limit to 10 questions for practice mode
      normalized = normalized.slice(0, 10);

      // Shuffle MC answers for practice mode
      state.questions = normalized.map((q) => {
        if (q.type === "mc") {
          return shuffleMCAnswers(q);
        }
        return q;
      });
    }

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
      state.wrongQuestions = [];
    }

    state.phase = "question";
    state.history.clear();

    // For exam mode: start the total timer once at the beginning
    if (state.mode === "exam") {
      // Use custom exam duration if specified, otherwise default
      const examMinutes = meta?.examDurationMinutes || EXAM_DURATION_MINUTES;
      const examSeconds = examMinutes * 60;
      resetTimer(examSeconds);
      startTimer();
    }

    // Render current question
    renderQuestion();
    updateUI();
  } catch (error) {
    showError("Kan vragen niet laden: " + error.message);
  }
}


/**
 * Render current question
 */
async function renderQuestion() {
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

  // Load image from static media array in JSON
  if (!q.image && Array.isArray(q.media) && q.media[0]?.type === "image" && q.media[0]?.src) {
    q.image = q.media[0].src;
    q.imageAlt = q.media[0].alt || "Afbeelding bij vraag";
  }

  // Toggle wider layout for questions with images
  const quizPage = document.querySelector(".quiz-page");
  if (quizPage) {
    quizPage.classList.toggle("has-image", !!q.image);
  }

  // Timer handling: exam mode uses total timer, practice mode uses per-question timer
  if (state.mode !== "exam") {
    // Practice mode: reset timer per question
    const isMultiPart = q.type === "wiskunde_multi_part" || q.type === "table_parse" ||
                        q.type === "grouped_short_text" || q.type === "grouped_select" ||
                        q.type === "ratio_table" || q.type === "ordering" ||
                        q.type === "multipart" || q.type === "matching" || q.type === "data_table" ||
                        // English question types with multiple inputs
                        q.type === "vocab_list" || q.type === "grammar_transform" ||
                        q.type === "grammar_fill" || q.type === "sentence_correction";
    resetTimer(isMultiPart ? QUESTION_SECONDS_MULTIPART : QUESTION_SECONDS);
    if (state.timerEnabled) startTimer();
  }
  // Exam mode: timer keeps running from loadQuestions()

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
    case "wiskunde_multi_part":
      renderWiskundeMultiPart(container, q);
      break;
    case "ordering":
      renderOrdering(container, q);
      break;
    case "ratio_table":
      renderRatioTable(container, q);
      break;
    case "info_card":
      renderInfoCard(container, q);
      break;
    // ChatGPT v2 question types
    case "fill_blank":
    case "fill_blank_dropdown":
      renderFillBlank(container, q);
      break;
    case "short_answer":
      renderShortAnswer(container, q);
      break;
    case "matching":
      renderMatching(container, q);
      break;
    case "numeric":
      renderNumeric(container, q);
      break;
    case "data_table":
      renderDataTable(container, q);
      break;
    case "multipart":
      renderMultipart(container, q);
      break;
    // English question types
    case "vocab_list":
      renderVocabList(container, q);
      break;
    case "grammar_transform":
      renderGrammarTransform(container, q);
      break;
    case "grammar_fill":
      renderGrammarFill(container, q);
      break;
    case "sentence_correction":
      renderSentenceCorrection(container, q);
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
  // Check if all options are short (for 2-column grid layout)
  const maxLength = 20;
  const allShort = q.answers.every((a) => a.length <= maxLength);
  const gridClass = allShort ? "options-grid" : "";

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

  const contentHtml = `
    <div class="question-title">${q.q}</div>
    <div class="options-list ${gridClass}" role="radiogroup">
      ${optionsHtml}
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
  const contentHtml = `
    <div class="question-title">${q.q}</div>
    ${q.graph ? '<div id="graphContainer" class="graph-container"></div>' : ""}
    <div class="open-input-wrap">
      <input type="text" id="openInput" class="open-input" placeholder="Typ je antwoord..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
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

  // Get row labels from first block (expand abbreviations)
  const rowLabels = blocks[0]?.rows?.map((r) => expandCaseLabel(r.veld)) || [];

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

  // Check if this is a table-style question (items have subheaders and question labels like "naamval", "getal", "verklaring")
  const isTableStyle = items.some(item => item.subheader) &&
    items.some(item => ["naamval", "getal", "verklaring"].includes(item.question?.toLowerCase()));

  if (isTableStyle) {
    // Group items by subheader - items without subheader belong to the previous group
    const groups = [];
    let currentGroup = null;

    items.forEach((item, idx) => {
      if (item.subheader) {
        // Start new group
        currentGroup = { subheader: item.subheader, items: [{ ...item, originalIdx: idx }] };
        groups.push(currentGroup);
      } else if (currentGroup) {
        // Add to current group
        currentGroup.items.push({ ...item, originalIdx: idx });
      }
    });

    // Build table HTML
    const tableHtml = `
      <table class="latin-analysis-table">
        <thead>
          <tr>
            <th>Woord</th>
            <th>naamval</th>
            <th>getal</th>
            <th>verklaring</th>
          </tr>
        </thead>
        <tbody>
          ${groups.map((group, gIdx) => `
            <tr>
              <td class="latin-word-cell">${group.subheader}</td>
              ${group.items.map((item, iIdx) => `
                <td>
                  <input type="text"
                         id="word-${item.originalIdx}"
                         class="grouped-input table-input"
                         data-word="${item.originalIdx}"
                         placeholder="..."
                         autocomplete="off">
                </td>
              `).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    const totalInputs = countGroupedInputs(items);

    container.innerHTML = `
      <div class="question-title">${q.prompt_html || "Vul de tabel in."}</div>
      ${tableHtml}
      <div class="group-progress">
        <span id="groupFilled">0</span> / <span>${totalInputs}</span> ingevuld
      </div>
      <div id="feedback" class="feedback" style="display: none;"></div>
    `;
  } else {
    // Original rendering for non-table style
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

        // Check if this item has a subheader (for grouping items under a sentence)
        const subheaderHtml = item.subheader ? `<div class="grouped-subheader">${item.subheader}</div>` : '';

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
      <div class="question-title">${q.prompt_html || "Vertaal de woorden."}</div>
      <div class="grouped-list">
        ${itemsHtml}
      </div>
      <div class="group-progress">
        <span id="groupFilled">0</span> / <span>${totalInputs}</span> ingevuld
      </div>
      <div id="feedback" class="feedback" style="display: none;"></div>
    `;
  }

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

/* ===========================================
   Ordering Question Type
   =========================================== */

/**
 * Render ordering question (put items in correct sequence)
 * Uses drag-and-drop or number inputs to arrange items
 */
function renderOrdering(container, q) {
  const items = q.items || [];
  const prompt = q.instruction || q.prompt_html || q.prompt || "Zet de items in de juiste volgorde.";

  // Shuffle items for display (store original indices)
  const shuffledItems = items.map((item, idx) => ({ text: item, originalIdx: idx }));
  shuffle(shuffledItems);

  const itemsHtml = shuffledItems
    .map(
      (item, idx) => `
    <div class="ordering-item" data-idx="${idx}" data-original="${item.originalIdx}" draggable="true">
      <span class="ordering-handle">☰</span>
      <span class="ordering-number">${idx + 1}</span>
      <span class="ordering-text">${item.text}</span>
      <input type="number" class="ordering-input" data-idx="${idx}" min="1" max="${items.length}" placeholder="${idx + 1}">
    </div>
  `,
    )
    .join("");

  const contentHtml = `
    <div class="question-title">${prompt}</div>
    <div class="ordering-instructions">Sleep de items of vul nummers in (1 = eerste)</div>
    <div class="ordering-list" id="orderingList">
      ${itemsHtml}
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
  setupOrderingDragDrop();

  // Setup number inputs
  $$$(".ordering-input", container).forEach((input) => {
    input.addEventListener("input", updateOrderingProgress);
  });

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = false; // Always enabled - can check current order
}

/**
 * Setup drag and drop for ordering items
 */
function setupOrderingDragDrop() {
  const list = $("orderingList");
  if (!list) return;

  let draggedItem = null;

  $$$(".ordering-item").forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      draggedItem = item;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      draggedItem = null;
      updateOrderingNumbers();
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedItem && draggedItem !== item) {
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          list.insertBefore(draggedItem, item);
        } else {
          list.insertBefore(draggedItem, item.nextSibling);
        }
      }
    });
  });
}

/**
 * Update ordering numbers after drag
 */
function updateOrderingNumbers() {
  $$$(".ordering-item").forEach((item, idx) => {
    const numEl = $$(".ordering-number", item);
    if (numEl) numEl.textContent = idx + 1;
    const input = $$(".ordering-input", item);
    if (input) input.placeholder = idx + 1;
  });
}

/**
 * Update ordering progress
 */
function updateOrderingProgress() {
  // Always allow checking since drag order is valid
  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = false;
}

/**
 * Check ordering answer
 */
function checkOrdering(q) {
  const items = q.items || [];

  // Support both index-based (v1) and text-based (v2/ChatGPT) correct_order formats
  let correctOrderIndices;

  if (q.correct_order && typeof q.correct_order[0] === "string") {
    // Text-based format: ["Eerste item", "Tweede item", ...]
    // Convert to indices
    correctOrderIndices = q.correct_order.map((text) => items.indexOf(text));
  } else if (q.correct_order) {
    // Index-based format: [0, 2, 1, 3]
    correctOrderIndices = q.correct_order;
  } else if (q.answer?.order) {
    correctOrderIndices = q.answer.order;
  } else {
    // Default: items are already in correct order
    correctOrderIndices = items.map((_, i) => i);
  }

  const list = $("orderingList");

  // Get current order from DOM (after any drag operations)
  const currentItems = $$$(".ordering-item", list);
  const userOrder = currentItems.map((item) => parseInt(item.dataset.original, 10));

  // Check if order matches
  const isCorrect = userOrder.every((val, idx) => val === correctOrderIndices[idx]);

  // Mark items as correct/wrong
  currentItems.forEach((item, idx) => {
    const userIdx = parseInt(item.dataset.original, 10);
    const expectedIdx = correctOrderIndices[idx];
    if (userIdx === expectedIdx) {
      item.classList.add("ordering-correct");
    } else {
      item.classList.add("ordering-wrong");
    }
  });

  awardPoints(q.id, isCorrect);
  updateStats(state.subjectId, isCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, isCorrect);

  state.history.add({
    question: htmlToText(q.instruction || q.prompt_html || q.prompt || "Ordering"),
    type: "ordering",
    correct: isCorrect,
  });

  // Don't give away the correct order
  showFeedback(isCorrect, q.explanation || q.e || "", "");
}

/* ===========================================
   Ratio Table Question Type
   =========================================== */

/**
 * Render ratio table (verhoudingstabel) question
 */
function renderRatioTable(container, q) {
  const table = q.table || {};
  const headers = table.headers || [];
  const rows = table.rows || [];
  const prompt = q.prompt_html || q.prompt || "Vul de verhoudingstabel in.";

  // Build table
  const headerHtml = headers.map((h) => `<th>${h}</th>`).join("");
  const rowsHtml = rows
    .map(
      (row, rowIdx) => `
    <tr>
      ${row
        .map((cell, colIdx) => {
          if (cell === null || cell === "?") {
            return `
            <td class="ratio-cell ratio-cell-input">
              <input type="text"
                     id="ratio-${rowIdx}-${colIdx}"
                     class="ratio-input"
                     data-row="${rowIdx}"
                     data-col="${colIdx}"
                     placeholder="?"
                     autocomplete="off">
            </td>`;
          } else {
            return `<td class="ratio-cell ratio-cell-given">${cell}</td>`;
          }
        })
        .join("")}
    </tr>
  `,
    )
    .join("");

  const fillableCount = rows.flat().filter((c) => c === null || c === "?").length;

  container.innerHTML = `
    <div class="question-title">${prompt}</div>
    <div class="ratio-table-wrap">
      <table class="ratio-table">
        <thead>
          <tr>${headerHtml}</tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
    <div class="ratio-progress">
      <span id="ratioFilled">0</span> / <span>${fillableCount}</span> ingevuld
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  // Setup input listeners
  $$$(".ratio-input", container).forEach((input) => {
    input.addEventListener("input", updateRatioProgress);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const allInputs = $$$(".ratio-input");
        const currentIdx = allInputs.indexOf(input);
        if (currentIdx < allInputs.length - 1) {
          allInputs[currentIdx + 1].focus();
        }
      }
    });
  });

  // Focus first input
  const firstInput = $$(".ratio-input", container);
  if (firstInput) firstInput.focus();

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Update ratio table progress
 */
function updateRatioProgress() {
  const filled = $$$(".ratio-input").filter((i) => i.value.trim().length > 0).length;
  const filledEl = $("ratioFilled");
  if (filledEl) filledEl.textContent = filled;

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = filled === 0;
}

/**
 * Check ratio table answer
 */
function checkRatioTable(q) {
  const answers = q.answer?.values || {};
  let correctCount = 0;
  let totalCount = 0;
  const results = [];

  $$$(".ratio-input").forEach((input) => {
    totalCount++;
    const row = input.dataset.row;
    const col = input.dataset.col;
    const key = `${row}-${col}`;
    const userValue = input.value.trim();
    const expectedValue = answers[key];

    // Normalize numbers for comparison
    const normalizedUser = userValue.replace(/,/g, ".").replace(/\s/g, "");
    const normalizedExpected = String(expectedValue).replace(/,/g, ".").replace(/\s/g, "");

    const isCorrect = normalizedUser === normalizedExpected ||
      parseFloat(normalizedUser) === parseFloat(normalizedExpected);

    if (isCorrect) {
      correctCount++;
      input.classList.add("input-correct");
    } else {
      input.classList.add("input-wrong");
    }

    results.push({
      position: `rij ${parseInt(row) + 1}, kolom ${parseInt(col) + 1}`,
      value: userValue,
      expected: expectedValue,
      correct: isCorrect,
    });
  });

  const isFullyCorrect = correctCount === totalCount;
  // Award fractional credit based on correct answers
  const fractionCorrect = totalCount > 0 ? correctCount / totalCount : 0;
  awardPoints(q.id, fractionCorrect);
  updateStats(state.subjectId, isFullyCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, isFullyCorrect);

  state.history.add({
    question: htmlToText(q.prompt_html || q.prompt),
    type: "ratio_table",
    correctCount,
    totalCount,
    correct: isFullyCorrect,
  });

  showGroupedFeedback(correctCount, totalCount, results.filter((r) => !r.correct).map((r) => ({
    latin: r.position,
    value: r.value,
    expected: r.expected,
    correct: false,
  })));
}

/* ===========================================
   Info Card Question Type
   =========================================== */

/**
 * Render info card (no answer required, just display info)
 */
function renderInfoCard(container, q) {
  const title = q.title || "Informatie";
  const content = q.content_html || q.content || "";
  const image = q.image || null;

  container.innerHTML = `
    <div class="info-card">
      <div class="info-card-header">
        <span class="info-icon">ℹ️</span>
        <span class="info-title">${title}</span>
      </div>
      <div class="info-card-content">
        ${content}
      </div>
      ${image ? `<div class="info-card-image"><img src="${image}" alt="Afbeelding"></div>` : ""}
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  // Info cards don't need checking - just show "next" immediately
  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.textContent = "Begrepen";
  if (checkBtn) checkBtn.disabled = false;
}

/**
 * Check info card (always "correct" - just acknowledge)
 */
function checkInfoCard(q) {
  // Info cards are always considered "seen"
  state.history.add({
    question: q.title || "Informatie",
    type: "info_card",
    correct: true,
    skipped: false,
  });

  // Don't add to score, just show positive feedback
  const feedbackEl = $("feedback");
  if (feedbackEl) {
    feedbackEl.className = "feedback feedback-info";
    feedbackEl.innerHTML = `
      <div class="feedback-header">
        <span>✓</span>
        <span>Gelezen</span>
      </div>
    `;
    feedbackEl.style.display = "block";
  }
}

/* ===========================================
   Wiskunde Multi-Part Question Renderer
   =========================================== */

/**
 * Render wiskunde question with multiple parts (a, b, c, ...)
 * Supports render types: grid, grid_graph, global_graph, table, text
 */
function renderWiskundeMultiPart(container, q) {
  const render = q.render || {};
  const parts = q.parts || [];

  // Build render area based on type
  let renderHtml = "";
  switch (render.type) {
    case "grid":
      renderHtml = '<div id="wiskundeGraph" class="wiskunde-graph"></div>';
      break;
    case "grid_graph":
      renderHtml = '<div id="wiskundeGraph" class="wiskunde-graph"></div>';
      break;
    case "global_graph":
      renderHtml = '<div id="wiskundeGraph" class="wiskunde-graph wiskunde-graph-global"></div>';
      break;
    case "table":
      renderHtml = renderMathTable(render.table);
      break;
    case "text":
      renderHtml = renderTextBlocks(render.blocks);
      break;
    case "instruction":
      // Instruction type with optional table and grid
      if (render.table) {
        renderHtml += renderMathTable(render.table);
      }
      if (render.ui_instructions?.grid_spec) {
        renderHtml += '<div id="wiskundeGraph" class="wiskunde-graph"></div>';
      }
      break;
    default:
      renderHtml = "";
  }

  // Build parts HTML
  const partsHtml = parts
    .map((part, idx) => {
      const partId = part.id || String.fromCharCode(97 + idx); // a, b, c...
      return renderPart(part, partId, idx);
    })
    .join("");

  container.innerHTML = `
    <div class="wiskunde-question">
      <div class="wiskunde-title">${q.title || "Vraag"}</div>
      ${renderHtml}
      <div class="wiskunde-parts">
        ${partsHtml}
      </div>
      <div class="wiskunde-progress">
        <span id="wiskundeFilled">0</span> / <span id="wiskundeTotal">${parts.length}</span> ingevuld
      </div>
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  // Render graph after container is in DOM
  if (render.type === "grid") {
    renderCoordinateGrid($("wiskundeGraph"), render);
  } else if (render.type === "grid_graph") {
    renderLineGraph($("wiskundeGraph"), render);
  } else if (render.type === "global_graph") {
    renderGlobalGraph($("wiskundeGraph"), render);
  } else if (render.type === "instruction" && render.ui_instructions?.grid_spec) {
    // Render grid from instruction spec
    renderInstructionGrid($("wiskundeGraph"), render.ui_instructions.grid_spec);
  }

  // Setup event listeners for inputs
  setupWiskundeInputListeners();

  // Focus first input
  const firstInput = $$(".wiskunde-input", container);
  if (firstInput) firstInput.focus();

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Render a single part based on its type
 */
function renderPart(part, partId, idx) {
  const prompt = part.prompt || "";
  const type = part.type || "text";

  let inputHtml = "";
  switch (type) {
    case "text":
      inputHtml = `
        <input type="text"
               id="part-${idx}"
               class="wiskunde-input"
               data-part="${idx}"
               placeholder="..."
               autocomplete="off"
               autocorrect="off"
               spellcheck="false">
      `;
      break;

    case "mcq":
      const options = part.options || [];
      inputHtml = `
        <div class="wiskunde-mcq" data-part="${idx}">
          ${options
            .map(
              (opt, optIdx) => `
            <label class="wiskunde-mcq-option">
              <input type="radio" name="part-${idx}" value="${optIdx}" class="wiskunde-radio" data-part="${idx}">
              <span>${opt}</span>
            </label>
          `,
            )
            .join("")}
        </div>
      `;
      break;

    case "multi_select":
      const msOptions = part.options || [];
      inputHtml = `
        <div class="wiskunde-multi-select" data-part="${idx}">
          ${msOptions
            .map(
              (opt, optIdx) => `
            <label class="wiskunde-ms-option">
              <input type="checkbox" value="${optIdx}" class="wiskunde-checkbox" data-part="${idx}">
              <span>${opt}</span>
            </label>
          `,
            )
            .join("")}
        </div>
      `;
      break;

    case "point":
      // For point placement, we'll use text input as fallback
      // Interactive point placement would require canvas/SVG interaction
      inputHtml = `
        <div class="wiskunde-point-input">
          <span class="point-label">x =</span>
          <input type="number" id="part-${idx}-x" class="wiskunde-input wiskunde-coord" data-part="${idx}" data-coord="x" placeholder="0">
          <span class="point-label">y =</span>
          <input type="number" id="part-${idx}-y" class="wiskunde-input wiskunde-coord" data-part="${idx}" data-coord="y" placeholder="0">
        </div>
      `;
      break;

    case "table_fill":
      // Table with fillable cells
      const cells = part.cells || [];
      inputHtml = `
        <div class="wiskunde-table-fill" data-part="${idx}">
          ${cells
            .map(
              (cell, cellIdx) => `
            <div class="table-fill-cell">
              <span class="cell-label">${cell.label || ""}</span>
              <input type="text"
                     id="part-${idx}-cell-${cellIdx}"
                     class="wiskunde-input wiskunde-cell"
                     data-part="${idx}"
                     data-cell="${cellIdx}"
                     placeholder="...">
            </div>
          `,
            )
            .join("")}
        </div>
      `;
      break;

    case "table_coords":
      // Table with coordinate inputs per row
      const tableData = part.table || {};
      const columns = tableData.columns || ["x", "y"];
      const rows = tableData.rows || [];
      inputHtml = `
        <div class="wiskunde-table-coords" data-part="${idx}">
          <table class="wiskunde-table wiskunde-table-input">
            <thead>
              <tr>
                ${columns.map((col) => `<th>${col}</th>`).join("")}
                <th>Coördinaat</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (row, rowIdx) => `
                <tr>
                  ${row.map((cell) => `<td>${cell}</td>`).join("")}
                  <td class="coord-input-cell">
                    <input type="text"
                           id="part-${idx}-coord-${rowIdx}"
                           class="wiskunde-input wiskunde-coord-input"
                           data-part="${idx}"
                           data-row="${rowIdx}"
                           placeholder="(${row[0]},${row[1]})"
                           autocomplete="off">
                  </td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `;
      break;

    default:
      inputHtml = `
        <input type="text"
               id="part-${idx}"
               class="wiskunde-input"
               data-part="${idx}"
               placeholder="..."
               autocomplete="off">
      `;
  }

  return `
    <div class="wiskunde-part" data-part-idx="${idx}">
      <div class="part-label">${partId})</div>
      <div class="part-content">
        <div class="part-prompt">${prompt}</div>
        <div class="part-answer">
          ${inputHtml}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render coordinate grid (for assenstelsel questions)
 */
function renderCoordinateGrid(container, render) {
  if (!container) return;

  const grid = render.grid || {};
  const points = render.points || [];

  const graph = createCoordinateSystem({
    width: 350,
    height: 350,
    xMin: grid.x_min ?? -6,
    xMax: grid.x_max ?? 6,
    yMin: grid.y_min ?? -6,
    yMax: grid.y_max ?? 6,
    showGrid: true,
    showLabels: true,
    gridStep: grid.step || 1,
  });

  // Add points with labels
  points.forEach((p) => {
    graph.addPoint(p.x, p.y, {
      label: p.label || "",
      color: "#6366f1",
    });
  });

  container.appendChild(graph.svg);
}

/**
 * Render line graph (for grid_graph questions)
 */
function renderLineGraph(container, render) {
  if (!container) return;

  const axes = render.axes || {};
  const polyline = render.polyline || [];

  const graph = createLineGraph({
    width: 400,
    height: 280,
    xMin: axes.x_min ?? 0,
    xMax: axes.x_max ?? 10,
    yMin: axes.y_min ?? 0,
    yMax: axes.y_max ?? 100,
    xStep: axes.x_step ?? 1,
    yStep: axes.y_step ?? 10,
    xLabel: axes.x_label || "x",
    yLabel: axes.y_label || "y",
    showGrid: true,
  });

  // Add the data line
  if (polyline.length > 0) {
    graph.addPolyline(polyline, {
      color: "#c9a227",
      width: 3,
      showPoints: true,
    });
  }

  container.appendChild(graph.svg);
}

/**
 * Render global/sketch graph (for global_graph questions)
 */
function renderGlobalGraph(container, render) {
  if (!container) return;

  const curve = render.curve || [];
  const axes = render.axes || {};

  // Generate x-axis ticks from curve data points
  let xTicks = null;
  if (curve.length > 0) {
    const xValues = curve.map((p) => p.x);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    // Create ticks at every 2 units (0, 2, 4, 6, 8)
    xTicks = [];
    for (let x = minX; x <= maxX; x += 2) {
      xTicks.push(x);
    }
  }

  const graph = createGlobalGraph({
    width: 380,
    height: 200,
    xLabel: axes.x_label || "tijd",
    yLabel: axes.y_label || "waarde",
    xTicks,
  });

  // Add the curve
  if (curve.length > 0) {
    graph.addCurve(curve, {
      color: "#c9a227",
      width: 3,
    });
  }

  container.appendChild(graph.svg);
}

/**
 * Render instruction grid (empty grid for drawing)
 */
function renderInstructionGrid(container, gridSpec) {
  if (!container) return;

  const graph = createLineGraph({
    width: 400,
    height: 300,
    xMin: gridSpec.x_min ?? 0,
    xMax: gridSpec.x_max ?? 10,
    yMin: gridSpec.y_min ?? 0,
    yMax: gridSpec.y_max ?? 100,
    xStep: gridSpec.x_step ?? 1,
    yStep: gridSpec.y_step ?? 10,
    xLabel: gridSpec.x_label || "x",
    yLabel: gridSpec.y_label || "y",
    showGrid: true,
  });

  container.appendChild(graph.svg);
}

/**
 * Render a math table
 */
function renderMathTable(tableData) {
  if (!tableData) return "";

  const columns = tableData.columns || [];
  const rows = tableData.rows || [];

  const headerHtml = columns.map((col) => `<th>${col}</th>`).join("");
  const rowsHtml = rows
    .map(
      (row) => `
    <tr>
      ${row.map((cell) => `<td>${cell}</td>`).join("")}
    </tr>
  `,
    )
    .join("");

  return `
    <div class="wiskunde-table-wrap">
      <table class="wiskunde-table">
        <thead>
          <tr>${headerHtml}</tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Render text blocks
 */
function renderTextBlocks(blocks) {
  if (!blocks || !Array.isArray(blocks)) return "";

  return blocks
    .map((block) => {
      switch (block.type) {
        case "p":
          return `<p class="wiskunde-text">${block.text}</p>`;
        case "formula":
          return `<div class="wiskunde-formula">${block.text}</div>`;
        case "instruction":
          return `<div class="wiskunde-instruction">${block.text}</div>`;
        default:
          return `<p>${block.text || ""}</p>`;
      }
    })
    .join("");
}

/**
 * Setup event listeners for wiskunde inputs
 */
function setupWiskundeInputListeners() {
  // Text inputs
  $$$(".wiskunde-input").forEach((input) => {
    input.addEventListener("input", updateWiskundeProgress);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Move to next input or check
        const allInputs = $$$(".wiskunde-input");
        const currentIdx = allInputs.indexOf(input);
        if (currentIdx < allInputs.length - 1) {
          allInputs[currentIdx + 1].focus();
        } else {
          const checkBtn = $("checkBtn");
          if (checkBtn && !checkBtn.disabled) {
            checkAnswer();
          }
        }
      }
    });
  });

  // Radio buttons (MCQ)
  $$$(".wiskunde-radio").forEach((radio) => {
    radio.addEventListener("change", updateWiskundeProgress);
  });

  // Checkboxes (multi-select)
  $$$(".wiskunde-checkbox").forEach((cb) => {
    cb.addEventListener("change", updateWiskundeProgress);
  });
}

/**
 * Update wiskunde progress indicator
 */
function updateWiskundeProgress() {
  const parts = $$$(".wiskunde-part");
  let filledCount = 0;

  parts.forEach((part) => {
    const idx = part.dataset.partIdx;

    // Check text inputs
    const textInputs = $$$(".wiskunde-input:not(.wiskunde-coord):not(.wiskunde-cell)", part);
    const textFilled = textInputs.some((i) => i.value.trim().length > 0);

    // Check coordinate inputs
    const coordInputs = $$$(".wiskunde-coord", part);
    const coordFilled =
      coordInputs.length === 0 ||
      coordInputs.every((i) => i.value.trim().length > 0);

    // Check radio buttons
    const radios = $$$(".wiskunde-radio", part);
    const radioFilled = radios.length === 0 || radios.some((r) => r.checked);

    // Check checkboxes
    const checkboxes = $$$(".wiskunde-checkbox", part);
    const checkboxFilled =
      checkboxes.length === 0 || checkboxes.some((c) => c.checked);

    // Check cell inputs
    const cellInputs = $$$(".wiskunde-cell", part);
    const cellsFilled =
      cellInputs.length === 0 ||
      cellInputs.every((i) => i.value.trim().length > 0);

    if (
      (textInputs.length > 0 && textFilled) ||
      (coordInputs.length > 0 && coordFilled) ||
      (radios.length > 0 && radioFilled) ||
      (checkboxes.length > 0 && checkboxFilled) ||
      (cellInputs.length > 0 && cellsFilled)
    ) {
      filledCount++;
    }
  });

  const filledEl = $("wiskundeFilled");
  if (filledEl) filledEl.textContent = filledCount;

  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = filledCount === 0;
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
export async function checkAnswer() {
  if (state.answered) return;

  const q = state.questions[state.currentIndex];

  // Practice mode: stop timer for this question
  // Exam mode: keep timer running
  if (state.mode !== "exam") {
    stopTimer();
  }

  switch (q.type) {
    case "mc":
      checkMCAnswer(q);
      break;
    case "open":
      await checkOpenAnswer(q);
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
    case "wiskunde_multi_part":
      checkWiskundeMultiPart(q);
      break;
    case "ordering":
      checkOrdering(q);
      break;
    case "ratio_table":
      checkRatioTable(q);
      break;
    case "info_card":
      checkInfoCard(q);
      break;
    // ChatGPT v2 question types
    case "fill_blank":
    case "fill_blank_dropdown":
      checkFillBlank(q);
      break;
    case "short_answer":
      checkShortAnswer(q);
      break;
    case "matching":
      checkMatching(q);
      break;
    case "numeric":
      checkNumeric(q);
      break;
    case "data_table":
      checkDataTable(q);
      break;
    case "multipart":
      checkMultipart(q);
      break;
    // English question types
    case "vocab_list":
      checkVocabList(q);
      break;
    case "grammar_transform":
      checkGrammarTransform(q);
      break;
    case "grammar_fill":
      checkGrammarFill(q);
      break;
    case "sentence_correction":
      checkSentenceCorrection(q);
      break;
    default:
      await checkOpenAnswer(q);
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
  awardPoints(q.id, isCorrect);
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
 * Check open answer (with optional AI semantic check)
 */
async function checkOpenAnswer(q) {
  const input = $("openInput");
  const value = input ? input.value.trim() : "";

  // First check exact matches
  let isCorrect = checkAcceptList(q.accept || [], value, q.caseSensitive);
  let aiFeedback = null;

  // If not exact match and keywords are defined, check if answer contains required keywords
  if (!isCorrect && q.keywords && q.keywords.length > 0) {
    const valueLower = value.toLowerCase();
    // Count how many keywords are present
    const matchedKeywords = q.keywords.filter(kw => valueLower.includes(kw.toLowerCase()));
    // Accept if at least 2 keywords match (to avoid single-word guesses)
    isCorrect = matchedKeywords.length >= 2;
  }

  // If still not correct and AI checking is available, try semantic check
  if (!isCorrect && value.length > 0 && isAICheckingAvailable() && q.useAI !== false) {
    try {
      // Show loading indicator
      const checkBtn = $("checkAnswer");
      if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.textContent = "Controleren...";
      }

      const aiResult = await checkAnswerWithAI(
        q.q,
        value,
        q.accept || [],
        q.keywords || []
      );

      isCorrect = aiResult.correct;
      aiFeedback = aiResult.feedback;

      if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.textContent = "Controleer";
      }
    } catch (error) {
      console.error("AI check failed:", error);
      // Continue with non-AI result
    }
  }

  awardPoints(q.id, isCorrect);
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
    aiFeedback,
  });

  // Show feedback with AI info if applicable
  const explanation = aiFeedback
    ? `${q.explanation || ""}\n\n🤖 AI-beoordeling: ${aiFeedback}`
    : q.explanation;

  showFeedback(isCorrect, explanation, q.accept[0]);
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

  awardPoints(q.id, isCorrect);
  if (isCorrect) {
    input?.classList.add("input-correct");
  } else {
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

  // Update score with fractional credit based on correct answers
  const fractionCorrect = totalFillable > 0 ? correctCount / totalFillable : 0;
  awardPoints(q.id, fractionCorrect);
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
  // Award fractional credit based on correct answers
  const fractionCorrect = totalItems > 0 ? totalCorrect / totalItems : 0;
  awardPoints(q.id, fractionCorrect);
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
  // Award fractional credit based on correct answers
  const fractionCorrect = items.length > 0 ? correctCount / items.length : 0;
  awardPoints(q.id, fractionCorrect);
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
  // Award fractional credit based on points earned
  const fractionCorrect = maxPoints > 0 ? totalPoints / maxPoints : 0;
  awardPoints(q.id, fractionCorrect);
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

  awardPoints(q.id, isCorrect);
  if (isCorrect) {
    input?.classList.add("input-correct");
  } else {
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

/**
 * Check wiskunde multi-part answer
 */
function checkWiskundeMultiPart(q) {
  const parts = q.parts || [];
  const results = [];
  let correctCount = 0;
  let totalPoints = 0;
  let maxPoints = 0;

  parts.forEach((part, idx) => {
    const partResult = checkWiskundePart(part, idx);
    results.push(partResult);

    if (partResult.correct) {
      correctCount++;
    }
    totalPoints += partResult.earnedPoints;
    maxPoints += partResult.maxPoints;

    // Mark input as correct/wrong
    markPartResult(part, idx, partResult.correct);
  });

  const isFullyCorrect = correctCount === parts.length;

  // Award fractional credit based on correct parts
  const fractionCorrect = parts.length > 0 ? correctCount / parts.length : 0;
  awardPoints(q.id, fractionCorrect);
  updateStats(state.subjectId, isFullyCorrect);
  if (q.id) updateQuestionBox(state.subjectId, q.id, isFullyCorrect);

  state.partialScore = totalPoints;
  state.maxPartialScore = maxPoints;

  // Build user answer summary from results
  const userAnswerSummary = results.map((r) => `${r.partId}) ${r.userAnswer}`).join(", ");

  state.history.add({
    question: q.title || "Wiskunde vraag",
    type: "wiskunde_multi_part",
    userAnswer: userAnswerSummary,
    correctCount,
    totalCount: parts.length,
    correct: isFullyCorrect,
    totalPoints,
    maxPoints,
  });

  showWiskundeFeedback(correctCount, parts.length, results, totalPoints, maxPoints);
}

/**
 * Check a single wiskunde part
 */
function checkWiskundePart(part, idx) {
  const type = part.type || "text";
  const answer = part.answer || {};
  const points = part.points || 1;

  let userAnswer = "";
  let isCorrect = false;
  let expectedAnswer = "";

  switch (type) {
    case "text": {
      const input = $(`part-${idx}`);
      userAnswer = input?.value?.trim() || "";
      const acceptList = [answer.value, ...(answer.accept || [])].filter(Boolean);
      expectedAnswer = answer.value || acceptList[0] || "";

      // Normalize comparison (case insensitive, trim whitespace)
      isCorrect = acceptList.some((acc) => {
        const normalizedUser = userAnswer.toLowerCase().replace(/\s+/g, "");
        const normalizedAcc = String(acc).toLowerCase().replace(/\s+/g, "");
        return normalizedUser === normalizedAcc;
      });
      break;
    }

    case "mcq": {
      const selected = $$(`input[name="part-${idx}"]:checked`);
      const selectedIdx = selected ? parseInt(selected.value, 10) : -1;
      userAnswer = selectedIdx >= 0 ? part.options[selectedIdx] : "(geen keuze)";
      const correctIdx = answer.correct_index ?? 0;
      expectedAnswer = part.options[correctIdx] || "";
      isCorrect = selectedIdx === correctIdx;
      break;
    }

    case "multi_select": {
      const checkboxes = $$$(`input[data-part="${idx}"].wiskunde-checkbox`);
      const selectedIndices = checkboxes
        .filter((cb) => cb.checked)
        .map((cb) => parseInt(cb.value, 10));
      const correctIndices = answer.correct_indices || [];

      userAnswer = selectedIndices.map((i) => part.options[i]).join(", ") || "(geen keuze)";
      expectedAnswer = correctIndices.map((i) => part.options[i]).join(", ");

      // Check if selected matches correct (order doesn't matter)
      isCorrect =
        selectedIndices.length === correctIndices.length &&
        selectedIndices.every((i) => correctIndices.includes(i));
      break;
    }

    case "point": {
      const xInput = $(`part-${idx}-x`);
      const yInput = $(`part-${idx}-y`);
      const userX = parseFloat(xInput?.value) || 0;
      const userY = parseFloat(yInput?.value) || 0;
      userAnswer = `(${userX}, ${userY})`;
      expectedAnswer = `(${answer.x}, ${answer.y})`;
      isCorrect = userX === answer.x && userY === answer.y;
      break;
    }

    case "table_fill": {
      const cells = part.cells || [];
      let cellsCorrect = 0;
      cells.forEach((cell, cellIdx) => {
        const cellInput = $(`part-${idx}-cell-${cellIdx}`);
        const cellValue = cellInput?.value?.trim() || "";
        const cellAccept = [cell.value, ...(cell.accept || [])].filter(Boolean);
        const cellCorrect = cellAccept.some(
          (acc) => cellValue.toLowerCase() === String(acc).toLowerCase(),
        );
        if (cellCorrect) cellsCorrect++;
      });
      userAnswer = `${cellsCorrect}/${cells.length} cellen`;
      expectedAnswer = "alle cellen correct";
      isCorrect = cellsCorrect === cells.length;
      break;
    }

    case "table_coords": {
      const tableData = part.table || {};
      const rows = tableData.rows || [];
      const expectedCoords = answer.coords || [];
      let coordsCorrect = 0;
      const userCoords = [];

      rows.forEach((row, rowIdx) => {
        const coordInput = $(`part-${idx}-coord-${rowIdx}`);
        const coordValue = coordInput?.value?.trim() || "";
        userCoords.push(coordValue);

        // Normalize coordinate: remove spaces, handle parentheses
        const normalizedUser = coordValue.replace(/\s+/g, "").toLowerCase();
        const expectedCoord = expectedCoords[rowIdx] || `(${row[0]},${row[1]})`;
        const normalizedExpected = expectedCoord.replace(/\s+/g, "").toLowerCase();

        // Check against expected and also allow the auto-generated format
        const autoFormat = `(${row[0]},${row[1]})`;
        if (normalizedUser === normalizedExpected || normalizedUser === autoFormat) {
          coordsCorrect++;
        }
      });

      userAnswer = `${coordsCorrect}/${rows.length} coördinaten`;
      expectedAnswer = expectedCoords.join(", ") || rows.map((r) => `(${r[0]},${r[1]})`).join(", ");
      isCorrect = coordsCorrect === rows.length;
      break;
    }

    default:
      userAnswer = "(onbekend type)";
      isCorrect = false;
  }

  return {
    partId: part.id || String.fromCharCode(97 + idx),
    prompt: part.prompt || "",
    type,
    userAnswer,
    expectedAnswer,
    correct: isCorrect,
    earnedPoints: isCorrect ? points : 0,
    maxPoints: points,
  };
}

/**
 * Mark part input as correct or wrong
 */
function markPartResult(part, idx, isCorrect) {
  const type = part.type || "text";
  const className = isCorrect ? "input-correct" : "input-wrong";

  switch (type) {
    case "text": {
      const input = $(`part-${idx}`);
      input?.classList.add(className);
      break;
    }
    case "mcq":
    case "multi_select": {
      const container = $$(`.wiskunde-part[data-part-idx="${idx}"]`);
      container?.classList.add(isCorrect ? "part-correct" : "part-wrong");
      break;
    }
    case "point": {
      $(`part-${idx}-x`)?.classList.add(className);
      $(`part-${idx}-y`)?.classList.add(className);
      break;
    }
    case "table_fill": {
      const cellInputs = $$$(`input[data-part="${idx}"].wiskunde-cell`);
      cellInputs.forEach((input) => {
        input.classList.add(className);
      });
      break;
    }
    case "table_coords": {
      const coordInputs = $$$(`input[data-part="${idx}"].wiskunde-coord-input`);
      coordInputs.forEach((input) => {
        input.classList.add(className);
      });
      break;
    }
  }
}

/**
 * Show feedback for wiskunde questions
 */
function showWiskundeFeedback(correctCount, totalCount, results, totalPoints, maxPoints) {
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
            <span><strong>${r.partId})</strong> ${r.userAnswer || "(leeg)"} → <strong>${r.expectedAnswer}</strong></span>
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
    <div class="feedback-score">${correctCount} / ${totalCount} goed (${totalPoints.toFixed(1)} / ${maxPoints.toFixed(1)} punten)</div>
    ${wrongHtml}
  `;
  feedbackEl.style.display = "block";
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
 * Reset state for next multipart sub-question
 * Called when moving to next part within a multipart question
 */
function resetForNextPart() {
  state.answered = false;
  state.phase = "answering";
  updateControls();
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

  // Exam mode: time is up for entire exam
  if (state.mode === "exam") {
    handleExamTimeUp();
    return;
  }

  // Practice mode: time up for single question
  const q = state.questions[state.currentIndex];

  state.wrong++;
  state.answered = true;
  state.phase = "feedback";

  // Get the correct answer to show
  const correctAnswer = getCorrectAnswer(q);

  state.history.add({
    question: q.q || q.title || htmlToText(q.prompt_html) || "Vraag",
    type: q.type,
    userAnswer: "(tijd op)",
    correctAnswer: correctAnswer,
    correct: false,
    timedOut: true,
  });

  // Show feedback with the correct answer
  const feedbackEl = $("feedback");
  if (feedbackEl) {
    feedbackEl.className = "feedback feedback-error";
    feedbackEl.innerHTML = `
      <div class="feedback-header">
        <span>⏱️</span>
        <span>Tijd voorbij!</span>
      </div>
      ${correctAnswer ? `<div class="feedback-body">Het juiste antwoord was: <strong>${correctAnswer}</strong></div>` : ""}
    `;
    feedbackEl.style.display = "block";
  }

  updateControls();
}

/**
 * Handle exam time up - end the entire exam
 */
function handleExamTimeUp() {
  // Mark all remaining questions as wrong (0 points)
  for (let i = state.currentIndex; i < state.questions.length; i++) {
    const q = state.questions[i];
    if (!q._revisited) { // Don't double-count skipped questions
      state.wrong++;
      state.history.add({
        question: q.q || q.title || htmlToText(q.prompt_html) || "Vraag",
        type: q.type,
        userAnswer: "(tijd op)",
        correct: false,
        timedOut: true,
      });
    }
  }

  // Show summary
  renderSummary();
}

/**
 * Skip question
 */
export function skipQuestion() {
  const q = state.questions[state.currentIndex];

  // Practice mode: stop timer for this question
  // Exam mode: keep timer running
  if (state.mode !== "exam") {
    stopTimer();
  }

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
 * Give up on current question (show answer without points)
 * In practice mode: question is tracked for retry
 * In exam mode: 0 points, question does NOT return, timer keeps running
 */
export function giveUp() {
  if (state.answered) return;

  const q = state.questions[state.currentIndex];

  // Practice mode: stop timer for this question
  // Exam mode: keep timer running (total exam time)
  if (state.mode !== "exam") {
    stopTimer();
  }

  // Mark as wrong
  state.wrong++;

  // Track wrong questions for retry (practice mode only)
  if (state.mode === "practice" && q.id) {
    state.wrongQuestions.push(q);
  }

  // Get correct answer for display
  let correctAnswer = "";
  if (q.type === "mc") {
    correctAnswer = q.answers[q.correctIndex] || "";
  } else if (q.accept && q.accept.length > 0) {
    correctAnswer = q.accept[0];
  } else if (q.correct_answer !== undefined) {
    correctAnswer = String(q.correct_answer);
  }

  state.history.add({
    question: q.q || htmlToText(q.prompt_html) || "Vraag",
    type: q.type,
    userAnswer: "(wist het niet)",
    correct: false,
    skipped: false,
  });

  // Show the answer
  showFeedback(false, q.e || q.explanation || "", correctAnswer);

  state.answered = true;
  state.phase = "feedback";
  updateControls();
}

/**
 * Go to next question
 */
export function nextQuestion() {
  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex++;

    // Auto-save progress (including mode for proper restoration)
    saveQuizProgress(state.subjectId, {
      currentIndex: state.currentIndex,
      totalQuestions: state.questions.length,
      questions: state.questions,
      score: state.score,
      wrong: state.wrong,
      skipped: state.skipped,
      mode: state.mode,
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

  // Use fractional scores from state (includes partial credit for sub-questions)
  const totalAnswered = state.score + state.wrong;
  const correct = state.score;
  const wrong = state.wrong;
  const skipped = state.skipped;
  const percentage = totalAnswered > 0 ? Math.round((correct / totalAnswered) * 100) : 0;

  // Format scores for display (show decimals only if needed)
  const correctDisplay = formatScore(correct);
  const wrongDisplay = formatScore(wrong);

  // Check if this is exam mode
  const isExam = state.mode === "exam";

  // Show confetti for good scores (70%+)
  if (percentage >= 70) {
    showConfetti(4000);
  }

  // Get total from history for the table display
  const total = state.history.getTotal();

  // Build history table with points column for exam mode
  const historyRows = state.history
    .getAll()
    .map(
      (h, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${h.question.substring(0, 50)}${h.question.length > 50 ? "..." : ""}</td>
      <td>${h.userAnswer || "-"}</td>
      <td>
        ${h.correct ? '<span class="badge badge-success">Goed</span>' : ""}
        ${h.skipped ? '<span class="badge">Overgeslagen</span>' : ""}
        ${!h.correct && !h.skipped ? '<span class="badge badge-error">Fout</span>' : ""}
      </td>
    </tr>
  `,
    )
    .join("");

  // Different titles for exam vs practice
  const title = isExam ? "Toets voltooid!" : "Oefenronde voltooid!";

  // Retry wrong questions button (practice mode only)
  const hasWrongQuestions = state.wrongQuestions.length > 0;
  const retryButton = !isExam && hasWrongQuestions ? `
    <button class="btn btn-block" id="retryWrongBtn">
      Herhaal ${state.wrongQuestions.length} foute ${state.wrongQuestions.length === 1 ? "vraag" : "vragen"}
    </button>
  ` : "";

  container.innerHTML = `
    <div class="summary-card">
      <h2 class="summary-title">${title}</h2>

      <div class="summary-score">
        <div class="summary-stat correct">
          <div class="value">${correctDisplay}</div>
          <div class="label">Goed</div>
        </div>
        <div class="summary-stat wrong">
          <div class="value">${wrongDisplay}</div>
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

      <div class="summary-actions">
        ${retryButton}
        <button class="btn btn-primary btn-block" onclick="location.reload()">Opnieuw beginnen</button>
      </div>
    </div>
  `;

  // Add event listener for retry button
  const retryBtn = $("retryWrongBtn");
  if (retryBtn) {
    retryBtn.addEventListener("click", retryWrongQuestions);
  }

  updateControls();
}

/**
 * Retry wrong questions (practice mode)
 */
function retryWrongQuestions() {
  if (state.wrongQuestions.length === 0) return;

  // Reset state with wrong questions
  state.questions = state.wrongQuestions.map(q => ({ ...q }));
  state.wrongQuestions = [];
  state.currentIndex = 0;
  state.score = 0;
  state.wrong = 0;
  state.skipped = 0;
  state.phase = "question";
  state.history.clear();

  // Shuffle questions and answers
  shuffle(state.questions);
  state.questions = state.questions.map(q => {
    if (q.type === "mc") {
      return shuffleMCAnswers(q);
    }
    return q;
  });

  renderQuestion();
  updateUI();
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
  updateTimerVisibility();
  updateControls();
}

function updateTimerVisibility() {
  const timerToggleWrap = document.querySelector(".timer-toggle-wrap");
  const timerDisplay = $("timerDisplay");

  if (state.mode === "exam") {
    // Exam mode: hide timer toggle (always on), update label
    if (timerToggleWrap) timerToggleWrap.style.display = "none";
    if (timerDisplay) {
      timerDisplay.style.display = "";
      // Remove disabled styling - timer is always on in exam mode
      timerDisplay.classList.remove("timer-disabled");
      // Update label to show "Tijd:" instead of "Resterend:"
      const labelNode = timerDisplay.childNodes[0];
      if (labelNode && labelNode.nodeType === Node.TEXT_NODE) {
        labelNode.textContent = "Tijd: ";
      }
    }
  } else {
    // Practice mode: show timer toggle
    if (timerToggleWrap) timerToggleWrap.style.display = "";
  }
}

/**
 * Format a score for display (show decimals only if needed)
 */
function formatScore(score) {
  // Round to 1 decimal to avoid floating point issues
  const rounded = Math.round(score * 10) / 10;
  // Check if it's effectively a whole number
  return rounded % 1 === 0 ? rounded : rounded.toFixed(1);
}

function updateMeta() {
  const statEl = $("stat");
  if (statEl) {
    const total = state.questions.length;
    const current = Math.min(state.currentIndex + 1, total);
    // Format scores for display (fractional scoring for sub-questions)
    const scoreDisplay = formatScore(state.score);
    const wrongDisplay = formatScore(state.wrong);
    statEl.textContent = `${scoreDisplay} goed / ${wrongDisplay} fout / ${state.skipped} overgeslagen • vraag ${current} van ${total}`;
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
  const giveUpBtn = $("giveUpBtn");
  const pauseBtn = $("pauseBtn");
  const rowMain = $("rowMain");
  const rowNext = $("rowNext");

  // Hide controls during mode selection or summary
  if (state.phase === "summary" || state.phase === "mode-select") {
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

  // Update button visibility based on mode
  // Both modes: skip and give up are available
  // Exam mode: skip = returns at end, give up = 0 points, no return
  // Practice mode: skip = returns at end, give up = 0 points, tracks for retry
  if (skipBtn) skipBtn.style.display = "";
  if (giveUpBtn) giveUpBtn.style.display = "";

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
  const giveUpBtn = $("giveUpBtn");
  const pauseBtn = $("pauseBtn");
  const resumeBtn = $("resumeBtn");
  const restartBtn = $("btn-restart");
  const timerToggle = $("timerToggle");
  const timerDisplay = $("timerDisplay");

  if (checkBtn) checkBtn.addEventListener("click", checkAnswer);
  if (nextBtn) nextBtn.addEventListener("click", nextQuestion);
  if (skipBtn) skipBtn.addEventListener("click", skipQuestion);
  if (giveUpBtn) giveUpBtn.addEventListener("click", giveUp);

  // Global Enter key to check answer or go to next question
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      // Don't trigger if typing in an input field (those have their own handlers)
      const activeEl = document.activeElement;
      const isInputField = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");
      if (isInputField) return;

      // Don't trigger if paused
      if (state.paused) return;

      // Get current button state (buttons may be re-rendered)
      const currentCheckBtn = $("checkBtn");
      const currentNextBtn = $("nextBtn");

      if (state.phase === "question" && !state.answered) {
        // Check if there's a selection and the check button is enabled
        if (currentCheckBtn && !currentCheckBtn.disabled) {
          e.preventDefault();
          checkAnswer();
        }
      } else if (state.phase === "feedback") {
        // Go to next question
        e.preventDefault();
        nextQuestion();
      }
    }
  });
  if (pauseBtn) pauseBtn.addEventListener("click", showPause);
  if (resumeBtn) resumeBtn.addEventListener("click", hidePause);
  if (restartBtn) {
    restartBtn.addEventListener("click", () => {
      if (confirm("Weet je zeker dat je opnieuw wilt beginnen?")) {
        clearQuizProgress(state.subjectId);
        location.reload();
      }
    });
  }

  // Timer toggle
  if (timerToggle) {
    // Load saved preference
    const savedTimerEnabled = localStorage.getItem("adamus-timer-enabled");
    state.timerEnabled = savedTimerEnabled !== "false"; // Default to true

    // Apply initial state
    updateTimerToggleUI(timerToggle, timerDisplay);

    // Handle click
    timerToggle.addEventListener("click", () => {
      // Timer toggle only works in practice mode
      if (state.mode === "exam") return;

      state.timerEnabled = !state.timerEnabled;
      localStorage.setItem("adamus-timer-enabled", state.timerEnabled);
      updateTimerToggleUI(timerToggle, timerDisplay);

      // Start or stop timer based on new state
      if (state.timerEnabled && state.phase === "question" && !state.answered) {
        startTimer();
      } else if (!state.timerEnabled) {
        stopTimer();
      }
    });

    // Handle keyboard
    timerToggle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        timerToggle.click();
      }
    });
  }
}

/**
 * Update timer toggle UI
 */
function updateTimerToggleUI(toggle, display) {
  if (toggle) {
    toggle.classList.toggle("active", state.timerEnabled);
    toggle.setAttribute("aria-checked", state.timerEnabled);
  }
  if (display) {
    // In exam mode, timer is always enabled (never show disabled state)
    const isDisabled = state.mode !== "exam" && !state.timerEnabled;
    display.classList.toggle("timer-disabled", isDisabled);
  }
}

// Export state for debugging
export function getState() {
  return { ...state };
}
