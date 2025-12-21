/* ===========================================
   Adamus - Quiz Engine
   Core quiz logic and state management
   =========================================== */

import { $, $$, $$$, shuffle, loadJSON, htmlToText, getUrlParam } from './utils.js';
import { startTimer, stopTimer, resetTimer, pauseTimer, resumeTimer, initTimer } from './timer.js';
import { readStats, writeStats, updateStats, createSessionHistory } from './stats.js';

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
  phase: 'question', // 'question' | 'feedback' | 'summary'
  answered: false,
  selectedOption: null,
  history: null
};

let subjects = [];
let subjectMap = {};

/**
 * Initialize the quiz
 */
export async function initQuiz() {
  // Load subjects
  try {
    const data = await loadJSON('data/subjects.json');
    subjects = data.subjects || data || [];

    // Build subject map
    subjects.forEach(s => {
      subjectMap[s.id] = s;
    });
  } catch (error) {
    showError('Kan vakken niet laden: ' + error.message);
    return;
  }

  // Get subject from URL
  const subjectId = getUrlParam('subject');
  if (!subjectId || !subjectMap[subjectId]) {
    showError('Onbekend vak. Ga terug naar de homepage.');
    return;
  }

  // Initialize
  state.subjectId = subjectId;
  state.subjectMeta = subjectMap[subjectId];
  state.history = createSessionHistory();

  // Setup timer callbacks
  initTimer({
    onTimeUp: handleTimeUp
  });

  // Setup event listeners
  setupEventListeners();

  // Load questions and start
  await loadQuestions();
}

/**
 * Load questions for current subject
 */
async function loadQuestions() {
  try {
    const meta = state.subjectMeta;
    const data = await loadJSON(meta.file);

    // Extract questions based on schema
    let questions = [];
    if (meta.schema === 'toets') {
      if (Array.isArray(data.questions)) {
        questions = data.questions;
      } else if (Array.isArray(data.toets)) {
        data.toets.forEach(section => {
          if (section.vragen) {
            questions.push(...section.vragen);
          }
        });
      }
    } else {
      questions = data.questions || data || [];
    }

    if (!questions.length) {
      throw new Error('Geen vragen gevonden');
    }

    // Normalize and optionally shuffle
    state.questions = questions.map(q => normalizeQuestion(q, meta.schema === 'quiz'));

    // Shuffle MC answers
    state.questions = state.questions.map(q => {
      if (q.type === 'mc') {
        return shuffleMCAnswers(q);
      }
      return q;
    });

    // Reset state
    state.currentIndex = 0;
    state.score = 0;
    state.wrong = 0;
    state.skipped = 0;
    state.phase = 'question';
    state.history.clear();

    // Render first question
    renderQuestion();
    updateUI();

  } catch (error) {
    showError('Kan vragen niet laden: ' + error.message);
  }
}

/**
 * Normalize question to standard format
 */
function normalizeQuestion(raw, preferMC = false) {
  // Special types stay as-is
  const richTypes = ['short_text', 'grouped_short_text', 'translation_open', 'grouped_translation', 'table_parse', 'grouped_select'];
  if (richTypes.includes(raw.type)) {
    return raw;
  }

  // Detect MC
  const hasMC = Array.isArray(raw.answers) || Array.isArray(raw.options) || Array.isArray(raw.a);

  if (preferMC && hasMC || raw.type === 'mc' || hasMC) {
    const answers = raw.answers || raw.a || [];
    let correctIndex = raw.correctIndex ?? raw.c ?? null;

    // Extract from options format
    if (Array.isArray(raw.options)) {
      raw.options.forEach((opt, idx) => {
        answers.push(opt.text ?? '');
        if (opt.correct && correctIndex === null) {
          correctIndex = idx;
        }
      });
    }

    return {
      type: 'mc',
      q: raw.q || raw.question || '',
      answers,
      correctIndex,
      explanation: raw.explanation || raw.why || raw.e || ''
    };
  }

  // Open question
  return {
    type: 'open',
    q: raw.q || raw.question || raw.vraag || '',
    accept: raw.accept || [],
    caseSensitive: !!raw.caseSensitive,
    explanation: raw.explanation || raw.e || ''
  };
}

/**
 * Shuffle MC answers while tracking correct index
 */
function shuffleMCAnswers(q) {
  if (q.type !== 'mc' || !Array.isArray(q.answers)) return q;

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
    correctIndex: newCorrectIndex
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

  const container = $('quizArea');
  if (!container) return;

  state.phase = 'question';
  state.answered = false;
  state.selectedOption = null;

  // Reset timer
  resetTimer(QUESTION_SECONDS);
  startTimer();

  // Render based on type
  if (q.type === 'mc') {
    renderMC(container, q);
  } else if (q.type === 'open') {
    renderOpen(container, q);
  } else {
    renderOpen(container, { q: q.prompt || q.q || 'Vraag', accept: [], explanation: '' });
  }

  // Update controls
  updateControls();
}

/**
 * Render multiple choice question
 */
function renderMC(container, q) {
  const optionsHtml = q.answers.map((answer, idx) => `
    <div class="option" data-idx="${idx}" tabindex="0" role="radio" aria-checked="false">
      <span class="option-marker">${String.fromCharCode(65 + idx)}</span>
      <span class="option-text">${answer}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="question-title">${q.q}</div>
    <div class="options-list" role="radiogroup">
      ${optionsHtml}
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  // Add click handlers to options
  $$$('.option', container).forEach(el => {
    el.addEventListener('click', () => selectOption(el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectOption(el);
      }
    });
  });

  // Focus first option
  const first = $$('.option', container);
  if (first) first.focus();
}

/**
 * Render open question
 */
function renderOpen(container, q) {
  container.innerHTML = `
    <div class="question-title">${q.q}</div>
    <div class="open-input-wrap">
      <textarea id="openInput" class="open-input" placeholder="Typ je antwoord..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
    </div>
    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  const input = $('openInput');
  if (input) {
    input.addEventListener('input', () => {
      const checkBtn = $('checkBtn');
      if (checkBtn) {
        checkBtn.disabled = input.value.trim().length === 0;
      }
    });
    input.focus();
  }

  // Disable check button initially
  const checkBtn = $('checkBtn');
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Select an MC option
 */
function selectOption(el) {
  if (state.answered) return;

  // Deselect all
  $$$('.option').forEach(opt => {
    opt.classList.remove('selected');
    opt.setAttribute('aria-checked', 'false');
  });

  // Select this one
  el.classList.add('selected');
  el.setAttribute('aria-checked', 'true');
  state.selectedOption = parseInt(el.dataset.idx, 10);

  // Enable check button
  const checkBtn = $('checkBtn');
  if (checkBtn) checkBtn.disabled = false;
}

/**
 * Check the answer
 */
export function checkAnswer() {
  if (state.answered) return;

  const q = state.questions[state.currentIndex];
  stopTimer();

  if (q.type === 'mc') {
    checkMCAnswer(q);
  } else {
    checkOpenAnswer(q);
  }

  state.answered = true;
  state.phase = 'feedback';
  updateControls();
}

/**
 * Check MC answer
 */
function checkMCAnswer(q) {
  const isCorrect = state.selectedOption === q.correctIndex;

  // Mark options
  $$$('.option').forEach((el, idx) => {
    el.classList.add('disabled');
    if (idx === q.correctIndex) {
      el.classList.add('correct');
    }
    if (idx === state.selectedOption && !isCorrect) {
      el.classList.add('wrong');
    }
  });

  // Update stats
  if (isCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, isCorrect);

  // Add to history
  state.history.add({
    question: q.q,
    type: 'mc',
    userAnswer: q.answers[state.selectedOption],
    correctAnswer: q.answers[q.correctIndex],
    correct: isCorrect,
    explanation: q.explanation
  });

  // Show feedback
  showFeedback(isCorrect, q.explanation, q.answers[q.correctIndex]);
}

/**
 * Check open answer
 */
function checkOpenAnswer(q) {
  const input = $('openInput');
  const value = input ? input.value.trim() : '';
  const isCorrect = checkAcceptList(q.accept || [], value, q.caseSensitive);

  if (isCorrect) {
    state.score++;
  } else {
    state.wrong++;
  }
  updateStats(state.subjectId, isCorrect);

  // Add to history
  state.history.add({
    question: q.q,
    type: 'open',
    userAnswer: value,
    correctAnswer: q.accept[0] || '',
    correct: isCorrect,
    explanation: q.explanation
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
    if (typeof accept === 'string' && accept.startsWith('/') && accept.lastIndexOf('/') > 0) {
      try {
        const lastSlash = accept.lastIndexOf('/');
        const pattern = accept.slice(1, lastSlash);
        const flags = accept.slice(lastSlash + 1);
        const regex = new RegExp(pattern, flags);
        if (regex.test(input)) return true;
      } catch (e) {
        // Invalid regex, skip
      }
    } else {
      // Plain string comparison
      const target = caseSensitive ? String(accept).trim() : String(accept).trim().toLowerCase();
      if (normalized === target) return true;
    }
  }

  return false;
}

/**
 * Show feedback
 */
function showFeedback(isCorrect, explanation, correctAnswer) {
  const feedbackEl = $('feedback');
  if (!feedbackEl) return;

  const icon = isCorrect ? '✓' : '✗';
  const title = isCorrect ? 'Goed!' : 'Niet goed';
  const className = isCorrect ? 'feedback-success' : 'feedback-error';

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
  feedbackEl.style.display = 'block';
}

/**
 * Handle time up
 */
function handleTimeUp() {
  if (state.answered) return;

  const q = state.questions[state.currentIndex];

  state.wrong++;
  state.answered = true;
  state.phase = 'feedback';

  state.history.add({
    question: q.q || htmlToText(q.prompt_html) || 'Vraag',
    type: q.type,
    userAnswer: '(tijd op)',
    correct: false,
    timedOut: true
  });

  // Show feedback
  const feedbackEl = $('feedback');
  if (feedbackEl) {
    feedbackEl.className = 'feedback feedback-error';
    feedbackEl.innerHTML = `
      <div class="feedback-header">
        <span>⏱️</span>
        <span>Tijd voorbij!</span>
      </div>
    `;
    feedbackEl.style.display = 'block';
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
    question: q.q || htmlToText(q.prompt_html) || 'Vraag',
    type: q.type,
    userAnswer: '(overgeslagen)',
    correct: false,
    skipped: true
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
  state.phase = 'summary';

  const container = $('quizArea');
  if (!container) return;

  const total = state.history.getTotal();
  const correct = state.history.getCorrectCount();
  const wrong = state.history.getWrongCount();
  const skipped = state.history.getSkippedCount();
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Build history table
  const historyRows = state.history.getAll().map((h, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${h.question.substring(0, 50)}${h.question.length > 50 ? '...' : ''}</td>
      <td>${h.userAnswer}</td>
      <td>
        ${h.correct ? '<span class="badge badge-success">Goed</span>' : ''}
        ${h.skipped ? '<span class="badge">Overgeslagen</span>' : ''}
        ${!h.correct && !h.skipped ? '<span class="badge badge-error">Fout</span>' : ''}
      </td>
    </tr>
  `).join('');

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

      ${total > 0 ? `
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
      ` : ''}

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
  const overlay = $('pauseOverlay');
  const page = $$('.quiz-page');
  if (overlay) overlay.classList.add('show');
  if (page) page.classList.add('page-blur');
}

export function hidePause() {
  resumeTimer();
  const overlay = $('pauseOverlay');
  const page = $$('.quiz-page');
  if (overlay) overlay.classList.remove('show');
  if (page) page.classList.remove('page-blur');
}

/**
 * Update UI elements
 */
function updateUI() {
  updateMeta();
  updateProgress();
}

function updateMeta() {
  const statEl = $('stat');
  if (statEl) {
    const total = state.questions.length;
    const current = Math.min(state.currentIndex + 1, total);
    statEl.textContent = `${state.score} goed / ${state.wrong} fout / ${state.skipped} overgeslagen • vraag ${current} van ${total}`;
  }
}

function updateProgress() {
  const bar = $('progressBar');
  if (bar) {
    const total = state.questions.length;
    const pct = total > 0 ? Math.round((state.currentIndex / total) * 100) : 0;
    bar.style.width = `${pct}%`;
  }
}

function updateControls() {
  const checkBtn = $('checkBtn');
  const nextBtn = $('nextBtn');
  const skipBtn = $('skipBtn');
  const pauseBtn = $('pauseBtn');
  const rowMain = $('rowMain');
  const rowNext = $('rowNext');

  if (state.phase === 'summary') {
    if (rowMain) rowMain.style.display = 'none';
    if (rowNext) rowNext.style.display = 'none';
    return;
  }

  if (state.phase === 'feedback') {
    if (rowMain) rowMain.style.display = 'none';
    if (rowNext) rowNext.style.display = 'grid';
  } else {
    if (rowMain) rowMain.style.display = 'grid';
    if (rowNext) rowNext.style.display = 'none';
  }

  // Update next button text
  if (nextBtn) {
    nextBtn.textContent = state.currentIndex >= state.questions.length - 1 ? 'Resultaat' : 'Volgende';
  }
}

/**
 * Show error message
 */
function showError(message) {
  const container = $('quizArea');
  if (container) {
    container.innerHTML = `
      <div class="alert alert-error">
        <span class="alert-icon">⚠️</span>
        <span>${message}</span>
      </div>
    `;
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  const checkBtn = $('checkBtn');
  const nextBtn = $('nextBtn');
  const skipBtn = $('skipBtn');
  const pauseBtn = $('pauseBtn');
  const resumeBtn = $('resumeBtn');
  const restartBtn = $('btn-restart');

  if (checkBtn) checkBtn.addEventListener('click', checkAnswer);
  if (nextBtn) nextBtn.addEventListener('click', nextQuestion);
  if (skipBtn) skipBtn.addEventListener('click', skipQuestion);
  if (pauseBtn) pauseBtn.addEventListener('click', showPause);
  if (resumeBtn) resumeBtn.addEventListener('click', hidePause);
  if (restartBtn) restartBtn.addEventListener('click', () => {
    if (confirm('Weet je zeker dat je opnieuw wilt beginnen?')) {
      location.reload();
    }
  });
}

// Export state for debugging
export function getState() {
  return { ...state };
}
