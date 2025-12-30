/* ===========================================
   Adamus - Subject Page Script
   Display quizzes for a subject
   =========================================== */

import {
  loadJSON,
  extractSubject,
  extractQuizTitle,
  getSubjectAccent,
  getUrlParam,
} from "./utils.js";

/**
 * Initialize subject page
 */
async function init() {
  const listEl = document.getElementById("list");
  const badgeEl = document.getElementById("subjectBadge");
  const titleEl = document.getElementById("subjectTitle");

  if (!listEl) return;

  // Get subject from URL
  const subjectKey = (getUrlParam("subject") || "").toLowerCase();

  if (!subjectKey) {
    listEl.innerHTML = `
      <div class="alert alert-error">
        <span class="alert-icon">⚠️</span>
        <span>Geen vak geselecteerd. <a href="index.html">Ga terug</a></span>
      </div>
    `;
    return;
  }

  try {
    // Show loading
    listEl.innerHTML = `
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>
      <div class="skeleton skeleton-row"></div>
    `;

    // Load subjects
    const data = await loadJSON("data/subjects.json");
    const subjects = data.subjects || data || [];

    // Filter quizzes for this subject (exclude hidden)
    const quizzes = subjects.filter((meta) => {
      if (meta.hidden) return false;
      const subject = extractSubject(meta).toLowerCase();
      return subject === subjectKey || subject.startsWith(subjectKey);
    });

    if (quizzes.length === 0) {
      listEl.innerHTML = `
        <div class="alert alert-error">
          <span class="alert-icon">⚠️</span>
          <span>Geen toetsen gevonden voor dit vak. <a href="index.html">Ga terug</a></span>
        </div>
      `;
      return;
    }

    // Get display name and accent
    const displayName = extractSubject(quizzes[0]);
    const accent = getSubjectAccent(displayName);

    // Update header
    if (badgeEl) {
      badgeEl.textContent = displayName;
      badgeEl.className = `badge badge-${accent.name}`;
    }

    if (titleEl) {
      titleEl.textContent = "";
    }

    // Update page title
    document.title = `${displayName} - Adamus`;

    // Render quiz cards
    listEl.innerHTML = "";

    quizzes.forEach((meta) => {
      const title = extractQuizTitle(meta, displayName);
      const weekBadge = meta.week
        ? `<span class="week-badge">${meta.week}</span>`
        : "";

      // Check if quiz supports both modes (has questionsPerSession AND is not examOnly)
      const supportsBothModes = meta.questionsPerSession && !meta.examOnly && meta.examDurationMinutes;
      const isExamOnly = meta.examOnly;

      if (supportsBothModes) {
        // Render quiz row with two mode buttons
        const row = document.createElement("div");
        row.className = "quiz-row";
        row.style.setProperty("--accent", accent.color);
        row.style.setProperty("--accent-light", accent.light);

        row.innerHTML = `
          <div class="quiz-row-info">
            <div class="icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 11l3 3L22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
            </div>
            <div class="quiz-info">
              <div class="quiz-title">${title}</div>
              <div class="quiz-meta">${meta.schema === "toets" ? "Toets" : "Quiz"}${weekBadge}</div>
            </div>
          </div>
          <div class="quiz-row-actions">
            <a class="mode-btn mode-btn-practice" href="quiz.html?subject=${encodeURIComponent(meta.id)}&mode=practice">
              📚 Oefenen
            </a>
            <a class="mode-btn mode-btn-exam" href="quiz.html?subject=${encodeURIComponent(meta.id)}&mode=exam">
              📝 Volledige toets
            </a>
          </div>
        `;

        listEl.appendChild(row);
      } else {
        // Standard single quiz card (exam only or practice only)
        const card = document.createElement("a");
        card.className = "quiz-card";
        card.href = `quiz.html?subject=${encodeURIComponent(meta.id)}`;
        card.style.setProperty("--accent", accent.color);
        card.style.setProperty("--accent-light", accent.light);

        const modeLabel = isExamOnly ? "Proeftoets" : (meta.schema === "toets" ? "Toets" : "Quiz");

        card.innerHTML = `
          <div class="icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </div>
          <div class="quiz-info">
            <div class="quiz-title">${title}</div>
            <div class="quiz-meta">${modeLabel}${weekBadge}</div>
          </div>
          <span class="arrow">→</span>
        `;

        listEl.appendChild(card);
      }

      // Flashcard link (only if quiz has content and flashcards are not hidden)
      if (meta.file && !meta.hideFlashcards) {
        const flashcardCard = document.createElement("a");
        flashcardCard.className = "quiz-card quiz-card-secondary";
        flashcardCard.href = `flashcards.html?subject=${encodeURIComponent(meta.id)}`;
        flashcardCard.style.setProperty("--accent", accent.color);
        flashcardCard.style.setProperty("--accent-light", accent.light);

        flashcardCard.innerHTML = `
          <div class="icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="M12 8v8M8 12h8"/>
            </svg>
          </div>
          <div class="quiz-info">
            <div class="quiz-title">${title}</div>
            <div class="quiz-meta">Flashcards${weekBadge}</div>
          </div>
          <span class="arrow">→</span>
        `;

        listEl.appendChild(flashcardCard);
      }
    });
  } catch (error) {
    console.error("Error loading quizzes:", error);
    listEl.innerHTML = `
      <div class="alert alert-error">
        <span class="alert-icon">⚠️</span>
        <span>Kan toetsen niet laden: ${error.message}</span>
      </div>
    `;
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
