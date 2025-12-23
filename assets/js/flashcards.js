/* ===========================================
   Adamus - Flashcards Module
   Interactive flashcard learning mode
   =========================================== */

import { $, loadJSON, getUrlParam, shuffle } from './utils.js';
import { getSpacedData, updateQuestionBox, incrementSession, getMasteryStats } from './stats.js';

// State
let state = {
  subjectId: null,
  subjectMeta: null,
  cards: [],
  currentIndex: 0,
  flipped: false,
  correct: 0,
  wrong: 0,
  phase: 'learning' // 'learning' | 'summary'
};

let subjects = [];
let subjectMap = {};

/**
 * Initialize flashcards
 */
async function init() {
  // Load subjects
  try {
    const data = await loadJSON('data/subjects.json');
    subjects = data.subjects || data || [];
    subjects.forEach(s => { subjectMap[s.id] = s; });
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

  state.subjectId = subjectId;
  state.subjectMeta = subjectMap[subjectId];

  // Update page title
  document.title = `Flashcards - ${state.subjectMeta.title}`;
  const titleEl = $('subjectTitle');
  if (titleEl) titleEl.textContent = `Flashcards: ${state.subjectMeta.label}`;

  // Update back link
  const backBtn = $('btnBack');
  if (backBtn) backBtn.href = `subject.html?subject=${encodeURIComponent(state.subjectMeta.subject)}`;

  // Setup event listeners
  setupEventListeners();

  // Load cards
  await loadCards();
}

/**
 * Load flashcards from subject data
 */
async function loadCards() {
  try {
    const meta = state.subjectMeta;
    const data = await loadJSON(meta.file);

    // Extract questions
    let questions = [];
    if (meta.schema === 'toets') {
      questions = data.questions || [];
    } else {
      questions = data.questions || data || [];
    }

    if (!questions.length) {
      showError('Geen vragen gevonden');
      return;
    }

    // Convert questions to flashcards
    // Front: question, Back: answer + explanation
    state.cards = questions.map(q => {
      let front = q.q || q.prompt_html || q.question || '';
      let back = '';
      let explanation = q.explanation || q.e || '';

      // Determine answer based on question type
      if (q.type === 'mc' && Array.isArray(q.answers)) {
        back = q.answers[q.correctIndex] || q.answers[q.c] || '';
      } else if (q.accept && q.accept.length > 0) {
        back = q.accept[0];
      } else if (q.answer?.accepted) {
        back = q.answer.accepted[0] || '';
      } else if (Array.isArray(q.a)) {
        back = q.a[q.c || 0] || '';
      }

      return {
        id: q.id,
        front,
        back,
        explanation
      };
    }).filter(c => c.front && c.back);

    // Increment session for spaced repetition
    incrementSession(state.subjectId);

    // Prioritize based on spaced repetition data
    const spacedData = getSpacedData(state.subjectId);
    state.cards = prioritizeCards(state.cards, spacedData);

    // Reset state
    state.currentIndex = 0;
    state.flipped = false;
    state.correct = 0;
    state.wrong = 0;
    state.phase = 'learning';

    // Update UI
    updateMasteryBar();
    renderCard();

  } catch (error) {
    showError('Kan vragen niet laden: ' + error.message);
  }
}

/**
 * Prioritize cards based on spaced repetition
 */
function prioritizeCards(cards, spacedData) {
  const session = spacedData.sessionCount;
  const intervals = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

  const withPriority = cards.map(card => {
    const qData = spacedData.questions[card.id] || { box: 1, lastSeen: -999 };
    const interval = intervals[qData.box] || 1;
    const sessionsSince = session - qData.lastSeen;
    const isDue = sessionsSince >= interval;
    const priority = isDue ? (6 - qData.box) * 100 : (6 - qData.box);

    return { ...card, _priority: priority, _box: qData.box };
  });

  // Sort by priority (highest first)
  withPriority.sort((a, b) => b._priority - a._priority);

  return withPriority;
}

/**
 * Render current card
 */
function renderCard() {
  const card = state.cards[state.currentIndex];
  if (!card) {
    showSummary();
    return;
  }

  const flashcard = $('flashcard');
  const frontEl = $('cardFront');
  const backEl = $('cardBack');
  const explanationEl = $('cardExplanation');
  const progressEl = $('cardProgress');

  // Reset flip state
  state.flipped = false;
  flashcard?.classList.remove('flipped');

  // Set content
  if (frontEl) frontEl.innerHTML = card.front;
  if (backEl) backEl.innerHTML = card.back;
  if (explanationEl) {
    explanationEl.innerHTML = card.explanation || '';
    explanationEl.style.display = card.explanation ? 'block' : 'none';
  }

  // Update progress
  if (progressEl) {
    progressEl.textContent = `${state.currentIndex + 1} / ${state.cards.length}`;
  }

  // Update button states
  updateButtons();
}

/**
 * Flip the card
 */
function flipCard() {
  if (state.phase !== 'learning') return;

  state.flipped = !state.flipped;
  const flashcard = $('flashcard');
  if (flashcard) {
    flashcard.classList.toggle('flipped', state.flipped);
  }
  updateButtons();
}

/**
 * Mark current card as correct
 */
function markCorrect() {
  if (!state.flipped || state.phase !== 'learning') return;

  const card = state.cards[state.currentIndex];
  state.correct++;

  // Update spaced repetition
  if (card.id) {
    updateQuestionBox(state.subjectId, card.id, true);
  }

  nextCard();
}

/**
 * Mark current card as wrong (need to review again)
 */
function markWrong() {
  if (!state.flipped || state.phase !== 'learning') return;

  const card = state.cards[state.currentIndex];
  state.wrong++;

  // Update spaced repetition
  if (card.id) {
    updateQuestionBox(state.subjectId, card.id, false);
  }

  // Add card back to end of deck for this session
  state.cards.push({ ...card });

  nextCard();
}

/**
 * Go to next card
 */
function nextCard() {
  state.currentIndex++;
  updateMasteryBar();

  if (state.currentIndex >= state.cards.length) {
    showSummary();
  } else {
    renderCard();
  }
}

/**
 * Update mastery progress bar
 */
function updateMasteryBar() {
  const stats = getMasteryStats(state.subjectId, state.cards.length);

  const total = stats.total || 1;
  const newPct = (stats.unseen / total) * 100;
  const learningPct = (stats.learning / total) * 100;
  const reviewingPct = (stats.reviewing / total) * 100;
  const masteredPct = (stats.mastered / total) * 100;

  const newEl = $('masteryNew');
  const learningEl = $('masteryLearning');
  const reviewingEl = $('masteryReviewing');
  const masteredEl = $('masteryMastered');

  if (newEl) newEl.style.width = `${newPct}%`;
  if (learningEl) learningEl.style.width = `${learningPct}%`;
  if (reviewingEl) reviewingEl.style.width = `${reviewingPct}%`;
  if (masteredEl) masteredEl.style.width = `${masteredPct}%`;
}

/**
 * Update button states
 */
function updateButtons() {
  const btnCorrect = $('btnCorrect');
  const btnWrong = $('btnWrong');

  // Buttons only active when card is flipped
  if (btnCorrect) btnCorrect.disabled = !state.flipped;
  if (btnWrong) btnWrong.disabled = !state.flipped;
}

/**
 * Show summary
 */
function showSummary() {
  state.phase = 'summary';

  const flashcardArea = $('flashcardArea');
  const controls = document.querySelector('.flashcard-controls');
  const summary = $('summary');

  if (flashcardArea) flashcardArea.style.display = 'none';
  if (controls) controls.style.display = 'none';
  if (summary) summary.style.display = 'block';

  const correctEl = $('summaryCorrect');
  const wrongEl = $('summaryWrong');

  if (correctEl) correctEl.textContent = state.correct;
  if (wrongEl) wrongEl.textContent = state.wrong;
}

/**
 * Restart flashcards
 */
function restart() {
  const flashcardArea = $('flashcardArea');
  const controls = document.querySelector('.flashcard-controls');
  const summary = $('summary');

  if (flashcardArea) flashcardArea.style.display = 'block';
  if (controls) controls.style.display = 'block';
  if (summary) summary.style.display = 'none';

  loadCards();
}

/**
 * Show error
 */
function showError(message) {
  const area = $('flashcardArea');
  if (area) {
    area.innerHTML = `
      <div class="alert alert-error">
        <span class="alert-icon">&#9888;</span>
        <span>${message}</span>
      </div>
    `;
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Flashcard click/tap
  const flashcard = $('flashcard');
  if (flashcard) {
    flashcard.addEventListener('click', flipCard);
    flashcard.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        flipCard();
      }
    });
  }

  // Correct/Wrong buttons
  const btnCorrect = $('btnCorrect');
  const btnWrong = $('btnWrong');
  const btnRestart = $('btnRestart');

  if (btnCorrect) btnCorrect.addEventListener('click', markCorrect);
  if (btnWrong) btnWrong.addEventListener('click', markWrong);
  if (btnRestart) btnRestart.addEventListener('click', restart);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (state.phase !== 'learning') return;

    switch (e.key) {
      case ' ':
        if (document.activeElement !== flashcard) {
          e.preventDefault();
          flipCard();
        }
        break;
      case 'ArrowRight':
      case 'j':
        if (state.flipped) markCorrect();
        break;
      case 'ArrowLeft':
      case 'k':
        if (state.flipped) markWrong();
        break;
    }
  });
}

// Initialize on load
init();
