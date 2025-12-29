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
    "short_answer",
    "matching",
    "numeric",
    "data_table",
    "multipart",
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
    accept: raw.accept || [],
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
          accepted: item.accepted_answers,
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
 * Order questions for exam mode (by difficulty phases)
 */
export function orderQuestionsForExam(questions) {
  // Define phases with their quiz groups
  const phases = {
    1: [1, 2],      // Instap
    2: [3, 4, 5],   // Kern
    3: [6, 7, 8, 9, 10, 11], // Toepassen
    4: [12, 13, 14, 15, 16], // Uitdaging
  };

  // Group questions by phase
  const byPhase = { 1: [], 2: [], 3: [], 4: [], ungrouped: [] };

  questions.forEach((q) => {
    const group = q.quiz_group || 0;
    let placed = false;

    for (const [phase, groups] of Object.entries(phases)) {
      if (groups.includes(group)) {
        byPhase[phase].push(q);
        placed = true;
        break;
      }
    }

    if (!placed) {
      byPhase.ungrouped.push(q);
    }
  });

  // Shuffle within each phase
  Object.values(byPhase).forEach((phaseQuestions) => {
    shuffle(phaseQuestions);
  });

  // Concatenate in phase order
  return [
    ...byPhase[1],
    ...byPhase[2],
    ...byPhase[3],
    ...byPhase[4],
    ...byPhase.ungrouped,
  ];
}

/**
 * Expand case abbreviation to full name
 */
export function expandCaseLabel(abbrev) {
  const caseMap = {
    nom: "nominativus",
    gen: "genitivus",
    dat: "dativus",
    acc: "accusativus",
    abl: "ablativus",
    voc: "vocativus",
  };
  const lower = abbrev.toLowerCase().trim();
  return caseMap[lower] || abbrev;
}

/**
 * Get correct answer text for display
 */
export function getCorrectAnswer(q) {
  if (q.type === "mc") {
    return q.answers?.[q.correctIndex] ?? "";
  }
  if (q.type === "open") {
    return q.accept?.[0] ?? "";
  }
  if (q.type === "short_text") {
    return q.payload?.accepted?.[0] ?? "";
  }
  return "";
}
