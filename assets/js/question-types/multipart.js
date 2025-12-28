/* ===========================================
   Adamus - Multipart Question Type
   Questions with multiple sequential parts
   =========================================== */

// This is a stub - will be migrated from question-types-v2.js

export function render(container, q) {
  console.warn("multipart.render() stub called");
}

export function check(q) {
  console.warn("multipart.check() stub called");
  return { correct: false, score: 0, maxScore: 1 };
}
