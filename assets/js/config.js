/**
 * Adamus Configuration
 * API keys are loaded at runtime from environment
 */

// Try to load config from runtime-injected script
const runtimeConfig = window.__ADAMUS_CONFIG__ || {};

export const config = {
  gemini: {
    apiKey: runtimeConfig.GEMINI_API_KEY || "",
    model: "gemini-2.0-flash-exp",
    // Rate limiting
    maxRequestsPerMinute: 15,
  },
};
