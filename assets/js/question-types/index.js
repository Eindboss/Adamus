/* ===========================================
   Adamus - Question Types Registry
   Central module for all question type handlers

   HOW TO ADD A NEW QUESTION TYPE:
   1. Create a new file in this folder (e.g., my-type.js)
   2. Export render() and check() functions
   3. Import and register it in the QUESTION_TYPES object below
   4. Add CSS styles in assets/css/question-types/ if needed
   =========================================== */

// Import all question types
import * as mc from "./mc.js";
import * as open from "./open.js";
import * as shortText from "./short-text.js";
import * as tableParse from "./table-parse.js";
import * as groupedShortText from "./grouped-short-text.js";
import * as groupedTranslation from "./grouped-translation.js";
import * as groupedSelect from "./grouped-select.js";
import * as translationOpen from "./translation-open.js";
import * as wiskundeMultiPart from "./wiskunde-multi-part.js";
import * as ordering from "./ordering.js";
import * as ratioTable from "./ratio-table.js";
import * as infoCard from "./info-card.js";
import * as fillBlank from "./fill-blank.js";
import * as shortAnswer from "./short-answer.js";
import * as matching from "./matching.js";
import * as numeric from "./numeric.js";
import * as dataTable from "./data-table.js";
import * as multipart from "./multipart.js";

/**
 * Registry of all question types
 * Each type must have: render(container, question) and check(question)
 */
export const QUESTION_TYPES = {
  // Core types (from quiz.js)
  mc,
  open,
  short_text: shortText,
  table_parse: tableParse,
  grouped_short_text: groupedShortText,
  grouped_translation: groupedTranslation,
  grouped_select: groupedSelect,
  translation_open: translationOpen,
  wiskunde_multi_part: wiskundeMultiPart,
  ordering,
  ratio_table: ratioTable,
  info_card: infoCard,

  // Extended types (from question-types-v2.js)
  fill_blank: fillBlank,
  short_answer: shortAnswer,
  matching,
  numeric,
  data_table: dataTable,
  multipart,
};

/**
 * State reference - shared across all question types
 */
let sharedState = null;
let sharedShowFeedback = null;
let sharedResetForNextPart = null;

/**
 * Initialize all question types with shared state
 * Called once from quiz.js on startup
 */
export function initQuestionTypes(state, showFeedback, resetForNextPart) {
  sharedState = state;
  sharedShowFeedback = showFeedback;
  sharedResetForNextPart = resetForNextPart;

  // Initialize each type that needs state
  Object.values(QUESTION_TYPES).forEach(type => {
    if (typeof type.init === "function") {
      type.init(state, showFeedback, resetForNextPart);
    }
  });
}

/**
 * Get state reference (for question type modules)
 */
export function getState() {
  return sharedState;
}

/**
 * Get showFeedback function (for question type modules)
 */
export function getShowFeedback() {
  return sharedShowFeedback;
}

/**
 * Get resetForNextPart function (for question type modules)
 */
export function getResetForNextPart() {
  return sharedResetForNextPart;
}

/**
 * Render a question by type
 * @param {string} type - Question type identifier
 * @param {HTMLElement} container - Container to render into
 * @param {Object} question - Question data
 * @returns {boolean} - True if rendered, false if unknown type
 */
export function renderQuestion(type, container, question) {
  const handler = QUESTION_TYPES[type];
  if (handler && typeof handler.render === "function") {
    handler.render(container, question);
    return true;
  }
  return false;
}

/**
 * Check answer for a question by type
 * @param {string} type - Question type identifier
 * @param {Object} question - Question data
 * @returns {Object|null} - Check result or null if unknown type
 */
export function checkQuestion(type, question) {
  const handler = QUESTION_TYPES[type];
  if (handler && typeof handler.check === "function") {
    return handler.check(question);
  }
  return null;
}

/**
 * Check if a question type exists
 * @param {string} type - Question type identifier
 * @returns {boolean}
 */
export function hasQuestionType(type) {
  return type in QUESTION_TYPES;
}

/**
 * Get list of all registered question types
 * @returns {string[]}
 */
export function getQuestionTypes() {
  return Object.keys(QUESTION_TYPES);
}

/**
 * Check if a type is multi-part (needs longer timer)
 * @param {string} type - Question type identifier
 * @returns {boolean}
 */
export function isMultiPartType(type) {
  const multiPartTypes = [
    "wiskunde_multi_part",
    "table_parse",
    "grouped_short_text",
    "grouped_select",
    "ratio_table",
    "ordering",
    "multipart",
    "matching",
    "data_table",
  ];
  return multiPartTypes.includes(type);
}
