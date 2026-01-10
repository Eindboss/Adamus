/* ===========================================
   Adamus - Quiz Utilities
   Helper functions for question normalization and conversion
   =========================================== */

import { shuffle } from "./utils.js";

/**
 * Normalize question to standard format
 */
export function normalizeQuestion(raw, preferMC = false) {
  // Special types stay as-is
  const richTypes = [
    "short_text",
    "grouped_short_text",
    "translation_open",
    "grouped_translation",
    "table_parse",
    "grouped_select",
    "wiskunde_multi_part",
    "ordering",
    "ratio_table",
    "info_card",
    // ChatGPT v2 question types
    "fill_blank",
    "fill_blank_dropdown",
    "short_answer",
    "matching",
    "numeric",
    "data_table",
    "multipart",
    // English question types
    "vocab_list",
    "grammar_transform",
    "grammar_fill",
    "sentence_correction",
  ];
  if (richTypes.includes(raw.type)) {
    return raw;
  }

  // Detect new wiskunde format (has render and/or parts)
  if (Array.isArray(raw.parts)) {
    return {
      ...raw,
      type: "wiskunde_multi_part",
    };
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
      quiz_group: raw.quiz_group,
      q: raw.q || raw.question || "",
      answers,
      correctIndex,
      explanation: raw.explanation || raw.why || raw.e || "",
      graph: raw.graph || null,
      image: raw.image || null,
      media: raw.media || null,
    };
  }

  // Open question
  return {
    id: raw.id,
    type: "open",
    quiz_group: raw.quiz_group,
    q: raw.q || raw.question || raw.vraag || "",
    accept: raw.accept || raw.accepted || raw.accepted_answers || [],
    caseSensitive: !!raw.caseSensitive,
    explanation: raw.explanation || raw.e || "",
    graph: raw.graph || null,
    image: raw.image || null,
    media: raw.media || null,
  };
}

/**
 * Shuffle MC answers while tracking correct index
 */
export function shuffleMCAnswers(q) {
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
 * Convert v2 schema question to v1 format (fallback when source.raw is missing)
 */
export function convertV2ToV1(q) {
  const base = {
    id: q.id,
    type: q.type,
    quiz_group: parseInt(q.group_id) || 1,
  };

  switch (q.type) {
    case "mc":
      return {
        ...base,
        q: q.payload?.question || q.prompt?.text || "",
        a: q.payload?.choices?.map((c) => c.text) || [],
        c: q.payload?.choices?.findIndex((c) => c.id === q.payload?.correct_choice_id) ?? 0,
        e: q.feedback?.explanation || "",
      };

    case "open":
      return {
        ...base,
        q: q.payload?.question || q.prompt?.text || "",
        accepted: q.payload?.accepted_answers || [],
        e: q.feedback?.explanation || "",
      };

    case "grouped_short_text":
      return {
        ...base,
        prompt_html: q.payload?.instruction_html || q.prompt?.html || q.prompt?.text || "",
        items: q.payload?.items?.map((item) => ({
          vraag: item.question,
          question: item.question,
          accepted: item.accepted_answers,
          subheader: item.subheader,
          id: item.id,
          points: item.points,
        })) || [],
      };

    case "translation_open":
      return {
        ...base,
        prompt_html: q.prompt?.html || q.prompt?.text || "",
        answer: {
          model_answer: q.payload?.model_answer || "",
          keywords: q.payload?.keywords || [],
        },
        points: q.points || 1,
      };

    default:
      // Return as-is for unknown types
      return { ...base, ...q.payload };
  }
}

/**
 * Select questions for a session using quiz_group rotation
 * Ensures each session includes questions from ALL groups for variety
 */
export function selectQuestionsForSession(questions, perSession, subjectId) {
  // Get current session number from localStorage
  const sessionKey = `adamus_session_${subjectId}`;
  const sessionData = localStorage.getItem(sessionKey);
  let sessionNum = 1;

  if (sessionData) {
    try {
      const parsed = JSON.parse(sessionData);
      sessionNum = (parsed.sessionNum || 0) + 1;
    } catch (e) {
      sessionNum = 1;
    }
  }

  // Save updated session number
  localStorage.setItem(sessionKey, JSON.stringify({ sessionNum }));

  // Group questions by quiz_group
  const grouped = {};
  const noGroup = [];

  questions.forEach((q) => {
    if (q.quiz_group) {
      if (!grouped[q.quiz_group]) {
        grouped[q.quiz_group] = [];
      }
      grouped[q.quiz_group].push(q);
    } else {
      noGroup.push(q);
    }
  });

  const groupKeys = Object.keys(grouped).sort((a, b) => Number(a) - Number(b));
  const numGroups = groupKeys.length;

  if (numGroups === 0) {
    // No quiz_group defined, just shuffle and take first N
    shuffle(questions);
    return questions.slice(0, perSession);
  }

  // Strategy: take 1 question from each group first (round-robin),
  // then fill remaining slots with rotating priority
  const result = [];

  // Shuffle each group and use session number to vary starting position
  const shuffledGroups = {};
  groupKeys.forEach((key) => {
    shuffledGroups[key] = [...grouped[key]];
    shuffle(shuffledGroups[key]);
  });

  // Round 1: Take 1 from each group (ensures all topics represented)
  const basePerGroup = Math.max(1, Math.floor(perSession / numGroups));
  const extraSlots = perSession - basePerGroup * numGroups;

  // Rotate starting group based on session
  const startGroupIdx = (sessionNum - 1) % numGroups;

  for (let i = 0; i < numGroups; i++) {
    const groupIdx = (startGroupIdx + i) % numGroups;
    const groupKey = groupKeys[groupIdx];
    const groupQuestions = shuffledGroups[groupKey];

    // Take base amount, plus 1 extra for first 'extraSlots' groups
    const toTake = basePerGroup + (i < extraSlots ? 1 : 0);
    const available = Math.min(toTake, groupQuestions.length);

    result.push(...groupQuestions.slice(0, available));
  }

  // If we still need more questions, add from ungrouped
  if (result.length < perSession && noGroup.length > 0) {
    shuffle(noGroup);
    result.push(...noGroup.slice(0, perSession - result.length));
  }

  // Final shuffle to mix questions from different groups
  shuffle(result);

  return result;
}

/**
 * Order questions for exam mode
 * @param {Array} questions - Questions to order
 * @param {Object} subjectMeta - Subject metadata (optional)
 * @param {string} subjectId - Subject ID (optional)
 */
export function orderQuestionsForExam(questions, subjectMeta = null, subjectId = null) {
  // Check if subject has preserveOrder flag or is not geschiedenis
  if (subjectMeta?.preserveOrder || !subjectId?.startsWith("geschiedenis")) {
    // Keep original order from JSON file
    return questions;
  }

  // Geschiedenis: didactische volgorde (rustige start, zware vragen naar achteren)
  const examOrder = [
    // FASE 1 - Instap & rust (vraag 1-8): vertrouwen opbouwen, geen overload
    "g-045", "g-005", "g-006", "g-016", "g-009", "g-027", "g-031", "g-049",
    // FASE 2 - Kernkennis & inzicht (vraag 9-22)
    "g-002", "g-007", "g-012", "g-013", "g-014", "g-015", "g-017", "g-018",
    "g-020", "g-021", "g-022", "g-023", "g-025", "g-026",
    // FASE 3 - Toepassen & verbanden (vraag 23-36)
    "g-011", "g-019", "g-028", "g-029", "g-030", "g-032", "g-033", "g-034",
    "g-035", "g-036", "g-037", "g-039", "g-040", "g-041",
    // FASE 4 - Uitdaging & afronding (vraag 37-50): zware chronologie/bronvragen
    "g-001", "g-003", "g-004", "g-008", "g-010", "g-024", "g-038", "g-042",
    "g-043", "g-044", "g-046", "g-047", "g-048", "g-050"
  ];

  const questionMap = new Map(questions.map(q => [q.id, q]));
  const ordered = examOrder.map(id => questionMap.get(id)).filter(Boolean);

  // Add any questions not in the order (fallback)
  const orderedIds = new Set(examOrder);
  const remaining = questions.filter(q => !orderedIds.has(q.id));

  return [...ordered, ...remaining];
}

/**
 * Expand case abbreviation to full name
 */
export function expandCaseLabel(abbrev) {
  const expansions = {
    "nom. ev": "nominativus ev",
    "gen. ev": "genitivus ev",
    "dat. ev": "dativus ev",
    "acc. ev": "accusativus ev",
    "abl. ev": "ablativus ev",
    "nom. mv": "nominativus mv",
    "gen. mv": "genitivus mv",
    "dat. mv": "dativus mv",
    "acc. mv": "accusativus mv",
    "abl. mv": "ablativus mv",
    // Also support short forms
    "nom": "nominativus",
    "gen": "genitivus",
    "dat": "dativus",
    "acc": "accusativus",
    "abl": "ablativus",
    "voc": "vocativus",
  };
  return expansions[abbrev] || expansions[abbrev.toLowerCase().trim()] || abbrev;
}

/**
 * Get correct answer text for display
 */
export function getCorrectAnswer(q) {
  switch (q.type) {
    case "mc":
      return q.answers?.[q.correctIndex] || "";
    case "open":
      return q.accept?.[0] || "";
    case "short_text":
      return q.answer?.accepted?.[0] || q.payload?.accepted?.[0] || "";
    case "wiskunde_multi_part":
      // Show first part's answer as example
      const firstPart = q.parts?.[0];
      if (firstPart) {
        const ans = firstPart.answer;
        if (firstPart.type === "text") return `a) ${ans?.value || ""}`;
        if (firstPart.type === "mcq") return `a) ${firstPart.options?.[ans?.correct_index] || ""}`;
      }
      return "";
    case "ratio_table":
      const vals = Object.values(q.answer?.values || {});
      return vals.length > 0 ? vals.join(", ") : "";
    case "ordering":
      const order = q.answer?.order || [];
      return order.map((idx, pos) => `${pos + 1}. ${q.items?.[idx] || ""}`).join(", ");
    default:
      return "";
  }
}
