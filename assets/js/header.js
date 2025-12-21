/* ===========================================
   Adamus - Header Loader
   Loads topbar partial into page
   =========================================== */

(function() {
  'use strict';

  async function loadHeader() {
    const root = document.getElementById('topbar-root');
    if (!root) return;

    try {
      const response = await fetch('partials/topbar.html');
      if (!response.ok) throw new Error('Failed to load header');
      const html = await response.text();
      root.innerHTML = html;
    } catch (error) {
      console.warn('Could not load header:', error);
      // Fallback inline header
      root.innerHTML = `
        <div class="topbar">
          <div class="topbar-inner">
            <a class="topbar-link" href="index.html">
              <div class="brand-text">
                <span class="brand-title">ADAMUS</span>
                <span class="brand-sub">Leren met inzicht.</span>
              </div>
            </a>
          </div>
        </div>
      `;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadHeader);
  } else {
    loadHeader();
  }
})();
