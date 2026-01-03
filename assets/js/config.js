/**
 * Adamus Configuration
 * API keys are restricted by HTTP referrer to lerenmetadamus.nl
 */
export const config = {
  gemini: {
    apiKey: "AIzaSyCHOh0FrlVakGfwg36eXKASAeICDKMLUeQ",
    model: "gemini-2.0-flash-exp",
    // Rate limiting
    maxRequestsPerMinute: 15,
  },
};
