/* ===========================================
   Adamus - Home Page Script
   Display subjects on homepage
   =========================================== */

import {
  loadJSON,
  extractSubject,
  getSubjectAccent,
  getSubjectIcon,
} from "./utils.js";

/**
 * Initialize homepage
 */
async function init() {
  const listEl = document.getElementById("list");
  if (!listEl) return;

  try {
    // Show loading skeletons
    listEl.innerHTML = `
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    `;

    // Load subjects
    const data = await loadJSON("data/subjects.json");
    const subjects = data.subjects || data || [];

    // Get unique subjects
    const subjectMap = new Map();
    subjects.forEach((meta) => {
      const subject = extractSubject(meta);
      if (!subjectMap.has(subject)) {
        subjectMap.set(subject, meta);
      }
    });

    // Sort subjects alphabetically
    const sortedSubjects = [...subjectMap.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], "nl")
    );

    // Render subject cards
    listEl.innerHTML = "";

    sortedSubjects.forEach(([subject, meta]) => {
      const accent = getSubjectAccent(subject);
      const icon = getSubjectIcon(subject);

      const card = document.createElement("a");
      card.className = "subject-card";
      card.href = `subject.html?subject=${encodeURIComponent(subject.toLowerCase())}`;
      card.style.setProperty("--accent", accent.color);
      card.style.setProperty("--accent-dark", accent.dark);

      card.innerHTML = `
        <div class="icon-wrap">
          ${icon}
        </div>
        <span class="subject-name">${subject}</span>
      `;

      listEl.appendChild(card);
    });
  } catch (error) {
    console.error("Error loading subjects:", error);
    listEl.innerHTML = `
      <div class="alert alert-error">
        <span class="alert-icon">⚠️</span>
        <span>Kan vakken niet laden: ${error.message}</span>
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
