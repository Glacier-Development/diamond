/**
 * Diamond Proxy - Main Application Logic
 * Handles navigation, page routing, and dynamic content loading
 */

(function() {
  'use strict';

  // State management
  const state = {
    currentPage: 'home',
    swRegistered: false,
    games: [],
    apps: []
  };

  // DOM Elements
  const elements = {
    navLinks: document.querySelectorAll('.nav-links a'),
    pages: document.querySelectorAll('.page'),
    gamesGrid: document.getElementById('games-grid'),
    appsGrid: document.getElementById('apps-grid'),
    swStatus: document.getElementById('sw-status'),
    swRegisterBtn: document.getElementById('sw-register-btn'),
    swUnregisterBtn: document.getElementById('sw-unregister-btn')
  };

  /**
   * Initialize the application
   */
  function init() {
    setupNavigation();
    setupSettings();
    loadGames();
    loadApps();
    
    // Listen for SW registration events
    window.addEventListener('sw-registered', () => {
      state.swRegistered = true;
      updateSWStatus();
    });
    
    window.addEventListener('sw-error', (e) => {
      showError(e.detail.message);
    });
  }

  /**
   * Setup navigation event listeners
   */
  function setupNavigation() {
    elements.navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        navigateTo(page);
      });
    });
  }

  /**
   * Navigate to a specific page
   */
  function navigateTo(pageName) {
    // Update active nav link
    elements.navLinks.forEach(link => {
      link.classList.toggle('active', link.dataset.page === pageName);
    });

    // Update active page
    elements.pages.forEach(page => {
      page.classList.toggle('active', page.id === `page-${pageName}`);
    });

    state.currentPage = pageName;
    
    // Close browser frame if navigating away from home
    if (pageName !== 'home' && window.closeBrowserFrame) {
      window.closeBrowserFrame();
    }
  }

  /**
   * Load games from JSON file
   */
  async function loadGames() {
    try {
      const response = await fetch('/data/games.json');
      if (!response.ok) throw new Error('Failed to load games');
      state.games = await response.json();
      renderGames();
    } catch (error) {
      console.error('[APP] Error loading games:', error);
      elements.gamesGrid.innerHTML = `
        <div class="loading-spinner">
          Failed to load games. Please try again later.
        </div>
      `;
    }
  }

  /**
   * Render games grid
   */
  function renderGames() {
    if (state.games.length === 0) {
      elements.gamesGrid.innerHTML = '<div class="loading-spinner">No games available</div>';
      return;
    }

    elements.gamesGrid.innerHTML = state.games.map(game => `
      <div class="content-card" data-proxy-url="${escapeHtml(game.proxy_url)}">
        <div class="card-thumbnail">
          <img src="${escapeHtml(game.thumbnail_url)}" alt="${escapeHtml(game.title)}" onerror="this.parentElement.textContent='${escapeHtml(game.title.charAt(0).toUpperCase())}'">
        </div>
        <div class="card-content">
          <h3 class="card-title">${escapeHtml(game.title)}</h3>
          <p class="card-description">${escapeHtml(game.description)}</p>
          <div class="card-tags">
            ${game.tags.slice(0, 3).map(tag => `<span class="card-tag">${escapeHtml(tag)}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('');

    // Add click handlers
    elements.gamesGrid.querySelectorAll('.content-card').forEach(card => {
      card.addEventListener('click', () => {
        const url = card.dataset.proxyUrl;
        openInBrowser(url, card.querySelector('.card-title').textContent);
      });
    });
  }

  /**
   * Load apps from JSON file
   */
  async function loadApps() {
    try {
      const response = await fetch('/data/apps.json');
      if (!response.ok) throw new Error('Failed to load apps');
      state.apps = await response.json();
      renderApps();
    } catch (error) {
      console.error('[APP] Error loading apps:', error);
      elements.appsGrid.innerHTML = `
        <div class="loading-spinner">
          Failed to load apps. Please try again later.
        </div>
      `;
    }
  }

  /**
   * Render apps grid
   */
  function renderApps() {
    if (state.apps.length === 0) {
      elements.appsGrid.innerHTML = '<div class="loading-spinner">No apps available</div>';
      return;
    }

    elements.appsGrid.innerHTML = state.apps.map(app => `
      <div class="content-card" data-proxy-url="${escapeHtml(app.proxy_url)}">
        <div class="card-thumbnail">
          <img src="${escapeHtml(app.thumbnail_url)}" alt="${escapeHtml(app.title)}" onerror="this.parentElement.textContent='${escapeHtml(app.title.charAt(0).toUpperCase())}'">
        </div>
        <div class="card-content">
          <h3 class="card-title">${escapeHtml(app.title)}</h3>
          <p class="card-description">${escapeHtml(app.description)}</p>
          <div class="card-tags">
            ${app.tags.slice(0, 3).map(tag => `<span class="card-tag">${escapeHtml(tag)}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('');

    // Add click handlers
    elements.appsGrid.querySelectorAll('.content-card').forEach(card => {
      card.addEventListener('click', () => {
        const url = card.dataset.proxyUrl;
        openInBrowser(url, card.querySelector('.card-title').textContent);
      });
    });
  }

  /**
   * Open URL in browser frame
   */
  function openInBrowser(url, title) {
    if (window.openBrowserFrame) {
      window.openBrowserFrame(url, title);
    }
  }

  /**
   * Setup settings page functionality
   */
  function setupSettings() {
    if (elements.swRegisterBtn) {
      elements.swRegisterBtn.addEventListener('click', () => {
        if (window.registerServiceWorker) {
          window.registerServiceWorker();
        }
      });
    }

    if (elements.swUnregisterBtn) {
      elements.swUnregisterBtn.addEventListener('click', async () => {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration) {
            await registration.unregister();
            state.swRegistered = false;
            updateSWStatus();
            alert('Service Worker unregistered successfully');
          } else {
            alert('No Service Worker registered');
          }
        } catch (error) {
          showError('Failed to unregister Service Worker: ' + error.message);
        }
      });
    }

    // Check initial SW status
    updateSWStatus();
  }

  /**
   * Update Service Worker status display
   */
  async function updateSWStatus() {
    if (!elements.swStatus) return;

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && registration.active) {
        elements.swStatus.textContent = 'Active ✓';
        elements.swStatus.style.color = 'var(--success)';
        state.swRegistered = true;
      } else {
        elements.swStatus.textContent = 'Not Registered';
        elements.swStatus.style.color = 'var(--text-secondary)';
        state.swRegistered = false;
      }
    } catch (error) {
      elements.swStatus.textContent = 'Error';
      elements.swStatus.style.color = 'var(--error)';
    }
  }

  /**
   * Show error modal
   */
  function showError(message) {
    const modal = document.getElementById('error-modal');
    const messageEl = document.getElementById('error-message');
    const closeBtn = document.getElementById('error-close');

    if (modal && messageEl) {
      messageEl.textContent = message;
      modal.classList.remove('hidden');

      if (closeBtn) {
        closeBtn.onclick = () => modal.classList.add('hidden');
      }

      modal.onclick = (e) => {
        if (e.target === modal) {
          modal.classList.add('hidden');
        }
      };
    } else {
      alert(message);
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Expose functions globally for other scripts
  window.showError = showError;
  window.updateSWStatus = updateSWStatus;

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * Admin Panel Controller - Ctrl+B to toggle
 */
(function() {
  'use strict';
  
  const modal = document.getElementById('admin-modal');
  const loginSection = document.getElementById('admin-login-section');
  const controlsSection = document.getElementById('admin-controls-section');
  const passwordInput = document.getElementById('admin-password');
  const loginBtn = document.getElementById('admin-login-btn');
  const loginError = document.getElementById('admin-login-error');
  const logoutBtn = document.getElementById('admin-logout');
  const closeBtn = document.getElementById('admin-modal-close');
  
  let isAdminAuthenticated = false;
  
  // Toggle modal with Ctrl+B
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      toggleAdminModal();
    }
  });
  
  function toggleAdminModal() {
    if (!modal) return;
    
    const isHidden = modal.classList.contains('hidden');
    if (isHidden) {
      modal.classList.remove('hidden');
      if (!isAdminAuthenticated) {
        setTimeout(() => passwordInput?.focus(), 100);
      }
    } else {
      modal.classList.add('hidden');
    }
  }
  
  // Close button
  closeBtn?.addEventListener('click', () => {
    modal.classList.add('hidden');
  });
  
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });
  
  // Login
  loginBtn?.addEventListener('click', async () => {
    const password = passwordInput?.value || '';
    
    if (!password) {
      showLoginError('Password required');
      return;
    }
    
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        isAdminAuthenticated = true;
        loginSection.classList.add('hidden');
        controlsSection.classList.remove('hidden');
        passwordInput.value = '';
        loginError.classList.add('hidden');
      } else {
        showLoginError(data.error || 'Invalid password');
      }
    } catch (error) {
      showLoginError('Login failed: ' + error.message);
    }
  });
  
  function showLoginError(message) {
    if (loginError) {
      loginError.textContent = message;
      loginError.classList.remove('hidden');
    }
  }
  
  // Logout
  logoutBtn?.addEventListener('click', async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
      isAdminAuthenticated = false;
      controlsSection.classList.add('hidden');
      loginSection.classList.remove('hidden');
      passwordInput.value = '';
    } catch (error) {
      console.error('Logout error:', error);
    }
  });
  
  // MOTD toggle
  document.getElementById('admin-set-motd')?.addEventListener('click', async () => {
    const message = document.getElementById('admin-motd-message')?.value || '';
    const enabled = document.getElementById('admin-motd-toggle')?.checked || false;
    
    try {
      const response = await fetch('/api/admin/motd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, enabled })
      });
      
      const data = await response.json();
      if (data.success) {
        alert('MOTD updated successfully!');
      } else {
        alert('Failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  });
  
  // Maintenance toggle
  document.getElementById('admin-update-maintenance')?.addEventListener('click', async () => {
    const message = document.getElementById('admin-maintenance-message')?.value || '';
    const enabled = document.getElementById('admin-maintenance-toggle')?.checked || false;
    
    try {
      const response = await fetch('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, enabled })
      });
      
      const data = await response.json();
      if (data.success) {
        alert('Maintenance mode updated!');
      } else {
        alert('Failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  });
  
  // Restart server
  document.getElementById('admin-restart')?.addEventListener('click', async () => {
    if (!confirm('⚠️ Are you sure you want to restart the server? This will disconnect all users.')) {
      return;
    }
    
    try {
      const response = await fetch('/api/admin/restart', { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        alert('Server restart initiated...');
      } else {
        alert('Failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  });
  
  // Check admin session on load
  async function checkAdminSession() {
    try {
      const response = await fetch('/api/admin/verify');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          isAdminAuthenticated = true;
          loginSection.classList.add('hidden');
          controlsSection.classList.remove('hidden');
        }
      }
    } catch (e) {
      // Not authenticated
    }
  }
  
  checkAdminSession();
})();
