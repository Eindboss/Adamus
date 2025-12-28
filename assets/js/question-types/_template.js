/* ===========================================
   Adamus - Question Type Template

   COPY THIS FILE to create a new question type!

   Steps:
   1. Copy this file and rename to your-type.js
   2. Update the type name in comments
   3. Implement render() and check()
   4. Register in index.js
   5. Add CSS in assets/css/question-types/your-type.css (optional)
   =========================================== */

import { $, $$, $$$ } from "../utils.js";
import { getState, getShowFeedback } from "./index.js";

/**
 * Initialize this question type (optional)
 * Called once when quiz starts
 */
export function init(state, showFeedback, resetForNextPart) {
  // Store references if needed for complex types
  // Most simple types don't need this
}

/**
 * Render the question
 * @param {HTMLElement} container - The quiz area container
 * @param {Object} q - Question data from JSON
 *
 * Required q properties (depends on your type):
 *   q.prompt.html or q.prompt.text - Question text
 *   q.payload - Type-specific data
 *   q.image (optional) - Image URL
 *   q.points - Point value
 */
export function render(container, q) {
  const state = getState();

  // Extract question text (handle both schema 1.0 and 2.0)
  const questionText = q.prompt?.html || q.prompt?.text || q.q || q.title || "Vraag";

  // Build your HTML
  const contentHtml = `
    <div class="question-title">${questionText}</div>

    <!-- YOUR QUESTION UI HERE -->
    <div class="your-type-container">
      <input type="text"
             class="your-type-input"
             id="yourTypeInput"
             placeholder="Type je antwoord..."
             autocomplete="off">
    </div>

    <div id="feedback" class="feedback" style="display: none;"></div>
  `;

  // Handle image layout if present
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

  // Setup event listeners
  const input = $("yourTypeInput");
  if (input) {
    input.focus();
    input.addEventListener("input", () => {
      // Enable/disable check button based on input
      const checkBtn = $("checkBtn");
      if (checkBtn) {
        checkBtn.disabled = input.value.trim().length === 0;
      }
    });

    // Enter key to check
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        const checkBtn = $("checkBtn");
        if (checkBtn && !checkBtn.disabled) {
          checkBtn.click();
        }
      }
    });
  }

  // Disable check button initially if no input
  const checkBtn = $("checkBtn");
  if (checkBtn) checkBtn.disabled = true;
}

/**
 * Check the answer
 * @param {Object} q - Question data from JSON
 * @returns {Object} Result with: correct, score, maxScore, feedback
 *
 * Expected payload properties (depends on your type):
 *   q.payload.accepted_answers - Array of correct answers
 *   q.payload.correct_answer - Single correct answer
 */
export function check(q) {
  const state = getState();

  // Get user's answer
  const input = $("yourTypeInput");
  const userAnswer = input?.value?.trim() || "";

  // Get accepted answers from payload
  const acceptedAnswers = q.payload?.accepted_answers || [q.payload?.correct_answer] || [];

  // Check if correct (case-insensitive)
  const isCorrect = acceptedAnswers.some(accepted =>
    userAnswer.toLowerCase() === accepted?.toLowerCase()
  );

  // Visual feedback on input
  if (input) {
    input.classList.add(isCorrect ? "input-correct" : "input-wrong");
    input.disabled = true;
  }

  // Calculate score
  const maxScore = q.points || 1;
  const score = isCorrect ? maxScore : 0;

  // Build feedback message
  let feedback = "";
  if (!isCorrect && acceptedAnswers.length > 0) {
    feedback = `Het juiste antwoord is: ${acceptedAnswers[0]}`;
  }
  if (q.feedback?.explanation) {
    feedback = q.feedback.explanation;
  }

  return {
    correct: isCorrect,
    score,
    maxScore,
    feedback,
    userAnswer,
  };
}

/* ===========================================
   CSS for this question type
   Add to: assets/css/question-types/your-type.css

   .your-type-container {
     margin: var(--space-4) 0;
   }

   .your-type-input {
     width: 100%;
     padding: var(--space-3) var(--space-4);
     font-size: 1rem;
     border: 2px solid var(--border);
     border-radius: var(--radius-md);
     background: var(--bg);
   }

   .your-type-input:focus {
     outline: none;
     border-color: var(--brand);
     box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.15);
   }

   .your-type-input.input-correct {
     border-color: var(--success);
     background: var(--success-light);
   }

   .your-type-input.input-wrong {
     border-color: var(--error);
     background: var(--error-light);
   }
   =========================================== */

/* ===========================================
   JSON Example for this question type:

   {
     "id": "example-001",
     "type": "your_type",
     "prompt": {
       "text": "Wat is het antwoord?",
       "html": "Wat is het <strong>antwoord</strong>?"
     },
     "points": 1,
     "payload": {
       "accepted_answers": ["antwoord1", "antwoord2"]
     },
     "feedback": {
       "explanation": "Uitleg waarom dit het antwoord is."
     }
   }
   =========================================== */
