/**
 * Adamus - Settings Module
 * Dark mode toggle
 */

// Settings state
const settings = {
  theme: "light",
};

/**
 * Initialize settings from localStorage
 */
export function initSettings() {
  // Load saved settings
  const saved = localStorage.getItem("adamus-settings");
  if (saved) {
    try {
      Object.assign(settings, JSON.parse(saved));
    } catch (e) {
      console.warn("Failed to load settings:", e);
    }
  }

  // Check system preference for dark mode if no saved preference
  if (!saved) {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    settings.theme = prefersDark ? "dark" : "light";
  }

  // Apply theme
  applyTheme(settings.theme);

  // Setup theme toggle button
  setupThemeToggle();

  // Listen for system theme changes
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      if (!localStorage.getItem("adamus-settings")) {
        setTheme(e.matches ? "dark" : "light");
      }
    });
}

/**
 * Apply theme to document
 */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  settings.theme = theme;
}

/**
 * Set theme and save preference
 */
export function setTheme(theme) {
  applyTheme(theme);
  saveSettings();
}

/**
 * Toggle between light and dark mode
 */
export function toggleTheme() {
  const newTheme = settings.theme === "dark" ? "light" : "dark";
  setTheme(newTheme);
  return newTheme;
}

/**
 * Setup theme toggle button in topbar
 */
function setupThemeToggle() {
  const toggle = document.querySelector(".theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      toggleTheme();
    });
  }
}

/**
 * Save settings to localStorage
 */
function saveSettings() {
  try {
    localStorage.setItem("adamus-settings", JSON.stringify(settings));
  } catch (e) {
    console.warn("Failed to save settings:", e);
  }
}

/**
 * Get current settings
 */
export function getSettings() {
  return { ...settings };
}

// Auto-initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSettings);
} else {
  initSettings();
}
