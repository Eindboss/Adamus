/* ===========================================
   Adamus - Info Card Question Type
   Information display (no answer required)
   =========================================== */

// This is a stub - will be migrated from quiz.js

export function render(container, q) {
  console.warn("info-card.render() stub called");
}

export function check(q) {
  // Info cards are always "correct" (just acknowledged)
  return { correct: true, score: 0, maxScore: 0 };
}
