/**
 * Gemini AI Service for semantic answer checking
 */
import { config } from "./config.js";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Check if a student's answer is semantically correct
 * @param {string} question - The question that was asked
 * @param {string} studentAnswer - The student's answer
 * @param {string[]} acceptedAnswers - List of accepted answers
 * @param {string[]} keywords - Optional keywords that should be present
 * @returns {Promise<{correct: boolean, feedback: string}>}
 */
export async function checkAnswerWithAI(question, studentAnswer, acceptedAnswers, keywords = []) {
  // Skip empty answers
  if (!studentAnswer || studentAnswer.trim().length === 0) {
    return { correct: false, feedback: "Geen antwoord gegeven." };
  }

  // First try exact/keyword matching (cheaper, faster)
  const normalizedStudent = studentAnswer.toLowerCase().trim();
  for (const accepted of acceptedAnswers) {
    if (normalizedStudent === accepted.toLowerCase().trim()) {
      return { correct: true, feedback: "Correct!" };
    }
  }

  // Check keywords if provided (2+ keywords = likely correct)
  if (keywords && keywords.length > 0) {
    const matchedKeywords = keywords.filter(kw =>
      normalizedStudent.includes(kw.toLowerCase())
    );
    if (matchedKeywords.length >= 2) {
      return { correct: true, feedback: "Correct! (bevat kernwoorden)" };
    }
  }

  // Use AI for semantic check
  try {
    const result = await callGeminiAPI(question, studentAnswer, acceptedAnswers);
    return result;
  } catch (error) {
    console.error("Gemini API error:", error);
    // Fallback: be lenient if AI fails
    return {
      correct: false,
      feedback: "Kon antwoord niet controleren. Vergelijk zelf met het modelantwoord.",
      aiError: true
    };
  }
}

/**
 * Call Gemini API to check answer
 */
async function callGeminiAPI(question, studentAnswer, acceptedAnswers) {
  const { apiKey, model } = config.gemini;

  const prompt = `Je bent een docent die antwoorden nakijkt. Beoordeel of het antwoord van de leerling inhoudelijk correct is.

Vraag: ${question}

Modelantwoorden (correct):
${acceptedAnswers.map(a => `- ${a}`).join("\n")}

Antwoord leerling: ${studentAnswer}

Beoordeel ALLEEN of de leerling dezelfde inhoud/betekenis geeft als de modelantwoorden.
- Spelfouten, hoofdletters, en formulering maken niet uit
- Het gaat om de inhoudelijke correctheid
- Wees mild maar eerlijk

Antwoord in dit exacte JSON-formaat:
{"correct": true/false, "feedback": "korte uitleg in 1 zin"}`;

  const response = await fetch(`${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 150,
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();

  // Extract text from response
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("No response from Gemini");
  }

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = text;
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1] || jsonMatch[0];
  }

  try {
    const result = JSON.parse(jsonStr);
    return {
      correct: result.correct === true,
      feedback: result.feedback || (result.correct ? "Correct!" : "Niet correct."),
      aiChecked: true
    };
  } catch (e) {
    // If JSON parsing fails, try to interpret the response
    const isCorrect = text.toLowerCase().includes('"correct": true') ||
                      text.toLowerCase().includes('"correct":true');
    return {
      correct: isCorrect,
      feedback: isCorrect ? "Correct!" : "Niet correct.",
      aiChecked: true
    };
  }
}

/**
 * Check if AI checking is available
 */
export function isAICheckingAvailable() {
  return !!(config.gemini?.apiKey);
}
