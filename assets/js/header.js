/* ===========================================
   Adamus - Header Loader
   Loads topbar partial into page + theme toggle
   =========================================== */

(function() {
  'use strict';

  // Apply saved theme immediately to prevent flash
  const savedSettings = localStorage.getItem('adamus-settings');
  if (savedSettings) {
    try {
      const { theme } = JSON.parse(savedSettings);
      if (theme) document.documentElement.setAttribute('data-theme', theme);
    } catch (e) {}
  } else {
    // Check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }

  async function loadHeader() {
    const root = document.getElementById('topbar-root');
    if (!root) return;

    try {
      const response = await fetch('partials/topbar.html');
      if (!response.ok) throw new Error('Failed to load header');
      const html = await response.text();
      root.innerHTML = html;

      // Setup theme toggle after header is loaded
      setupThemeToggle();
    } catch (error) {
      console.warn('Could not load header:', error);
      // Fallback inline header with theme toggle
      root.innerHTML = `
        <div class="topbar">
          <div class="topbar-inner">
            <a class="topbar-link" href="index.html">
              <div class="brand-text">
                <span class="brand-title">ADAMUS</span>
              </div>
            </a>
            <div class="topbar-actions">
              <button class="theme-toggle" aria-label="Thema wisselen">
                <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
      setupThemeToggle();
    }
  }

  function setupThemeToggle() {
    const toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = current === 'dark' ? 'light' : 'dark';

      document.documentElement.setAttribute('data-theme', newTheme);

      // Save preference
      try {
        const settings = JSON.parse(localStorage.getItem('adamus-settings') || '{}');
        settings.theme = newTheme;
        localStorage.setItem('adamus-settings', JSON.stringify(settings));
      } catch (e) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadHeader);
  } else {
    loadHeader();
  }
})();
