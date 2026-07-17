/**
 * Diamond Proxy - Authentication Module
 * Handles login, registration, and user management
 */

(function() {
  'use strict';

  const API_BASE = '';
  
  // State
  let currentUser = null;
  let isLoginMode = true;

  // DOM Elements
  const elements = {
    loginBtn: document.getElementById('login-btn'),
    registerBtn: document.getElementById('register-btn'),
    authLoggedOut: document.getElementById('auth-logged-out'),
    authLoggedIn: document.getElementById('auth-logged-in'),
    usernameDisplay: document.getElementById('username-display'),
    userDropdownBtn: document.getElementById('user-dropdown-btn'),
    userDropdown: document.getElementById('user-dropdown'),
    adminLink: document.getElementById('admin-link'),
    logoutBtn: document.getElementById('logout-btn'),
    
    // Auth Modal
    authModal: document.getElementById('auth-modal'),
    authModalClose: document.getElementById('auth-modal-close'),
    authForm: document.getElementById('auth-form'),
    authModalTitle: document.getElementById('auth-modal-title'),
    authUsername: document.getElementById('auth-username'),
    authEmail: document.getElementById('auth-email'),
    authPassword: document.getElementById('auth-password'),
    emailGroup: document.getElementById('email-group'),
    authError: document.getElementById('auth-error'),
    authSubmitBtn: document.getElementById('auth-submit-btn'),
    authSwitchText: document.getElementById('auth-switch-text'),
    authSwitchLink: document.getElementById('auth-switch-link'),
    
    // MOTD Banner
    motdBanner: document.getElementById('motd-banner'),
    motdMessage: document.getElementById('motd-message'),
    motdClose: document.getElementById('motd-close'),
    
    // Admin Modal
    adminModal: document.getElementById('admin-modal'),
    adminModalClose: document.getElementById('admin-modal-close'),
    adminSetMotd: document.getElementById('admin-set-motd'),
    adminMotdMessage: document.getElementById('admin-motd-message'),
    adminMaintenanceToggle: document.getElementById('admin-maintenance-toggle'),
    adminMaintenanceMessage: document.getElementById('admin-maintenance-message'),
    adminUpdateMaintenance: document.getElementById('admin-update-maintenance'),
    adminRestart: document.getElementById('admin-restart'),
    adminEvents: document.getElementById('admin-events')
  };

  /**
   * Initialize authentication module
   */
  async function init() {
    setupEventListeners();
    await checkAuthStatus();
    await loadMotd();
  }

  /**
   * Setup event listeners
   */
  function setupEventListeners() {
    // Auth buttons
    if (elements.loginBtn) {
      elements.loginBtn.addEventListener('click', () => openAuthModal(true));
    }
    if (elements.registerBtn) {
      elements.registerBtn.addEventListener('click', () => openAuthModal(false));
    }

    // User dropdown
    if (elements.userDropdownBtn) {
      elements.userDropdownBtn.addEventListener('click', toggleUserDropdown);
    }

    // Logout
    if (elements.logoutBtn) {
      elements.logoutBtn.addEventListener('click', logout);
    }

    // Admin link
    if (elements.adminLink) {
      elements.adminLink.addEventListener('click', (e) => {
        e.preventDefault();
        openAdminPanel();
      });
    }

    // Auth modal
    if (elements.authModalClose) {
      elements.authModalClose.addEventListener('click', closeAuthModal);
    }
    if (elements.authModal) {
      elements.authModal.addEventListener('click', (e) => {
        if (e.target === elements.authModal) closeAuthModal();
      });
    }

    // Auth form
    if (elements.authForm) {
      elements.authForm.addEventListener('submit', handleAuthSubmit);
    }

    // Auth switch
    if (elements.authSwitchLink) {
      elements.authSwitchLink.addEventListener('click', (e) => {
        e.preventDefault();
        toggleAuthMode();
      });
    }

    // MOTD close
    if (elements.motdClose) {
      elements.motdClose.addEventListener('click', () => {
        elements.motdBanner.classList.add('hidden');
      });
    }

    // Admin modal
    if (elements.adminModalClose) {
      elements.adminModalClose.addEventListener('click', closeAdminPanel);
    }
    if (elements.adminModal) {
      elements.adminModal.addEventListener('click', (e) => {
        if (e.target === elements.adminModal) closeAdminPanel();
      });
    }

    // Admin actions
    if (elements.adminSetMotd) {
      elements.adminSetMotd.addEventListener('click', setMotd);
    }
    if (elements.adminUpdateMaintenance) {
      elements.adminUpdateMaintenance.addEventListener('click', updateMaintenance);
    }
    if (elements.adminRestart) {
      elements.adminRestart.addEventListener('click', restartServer);
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (elements.userDropdown && !elements.userDropdown.contains(e.target) && 
          !elements.userDropdownBtn?.contains(e.target)) {
        elements.userDropdown.classList.add('hidden');
      }
    });
  }

  /**
   * Check current auth status
   */
  async function checkAuthStatus() {
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        currentUser = data.user;
        updateAuthUI();
      } else {
        currentUser = null;
        updateAuthUI();
      }
    } catch (error) {
      console.error('[AUTH] Check status error:', error);
      currentUser = null;
      updateAuthUI();
    }
  }

  /**
   * Update UI based on auth state
   */
  function updateAuthUI() {
    if (currentUser) {
      elements.authLoggedOut?.classList.add('hidden');
      elements.authLoggedIn?.classList.remove('hidden');
      elements.usernameDisplay.textContent = currentUser.username;
      
      if (currentUser.isAdmin) {
        elements.adminLink?.classList.remove('hidden');
      } else {
        elements.adminLink?.classList.add('hidden');
      }
    } else {
      elements.authLoggedOut?.classList.remove('hidden');
      elements.authLoggedIn?.classList.add('hidden');
      elements.adminLink?.classList.add('hidden');
    }
  }

  /**
   * Open auth modal
   */
  function openAuthModal(loginMode = true) {
    isLoginMode = loginMode;
    updateAuthModalUI();
    elements.authModal?.classList.remove('hidden');
    elements.authUsername?.focus();
  }

  /**
   * Close auth modal
   */
  function closeAuthModal() {
    elements.authModal?.classList.add('hidden');
    elements.authError?.classList.add('hidden');
    elements.authForm?.reset();
  }

  /**
   * Update auth modal UI
   */
  function updateAuthModalUI() {
    if (isLoginMode) {
      elements.authModalTitle.textContent = 'Login';
      elements.emailGroup.style.display = 'none';
      elements.authSubmitBtn.textContent = 'Login';
      elements.authSwitchText.textContent = "Don't have an account?";
      elements.authSwitchLink.textContent = 'Sign up';
    } else {
      elements.authModalTitle.textContent = 'Create Account';
      elements.emailGroup.style.display = 'flex';
      elements.authSubmitBtn.textContent = 'Sign Up';
      elements.authSwitchText.textContent = 'Already have an account?';
      elements.authSwitchLink.textContent = 'Login';
    }
  }

  /**
   * Toggle auth mode
   */
  function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    updateAuthModalUI();
    elements.authError.classList.add('hidden');
  }

  /**
   * Handle auth form submission
   */
  async function handleAuthSubmit(e) {
    e.preventDefault();
    
    const username = elements.authUsername.value.trim();
    const email = elements.authEmail.value.trim();
    const password = elements.authPassword.value;
    
    elements.authError.classList.add('hidden');
    elements.authSubmitBtn.disabled = true;
    elements.authSubmitBtn.textContent = 'Processing...';
    
    try {
      const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';
      const body = isLoginMode ? { username, password } : { username, email, password };
      
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }
      
      // Success
      currentUser = data.user;
      updateAuthUI();
      closeAuthModal();
      
      // Reload MOTD after login
      if (!isLoginMode) {
        await loadMotd();
      }
      
    } catch (error) {
      elements.authError.textContent = error.message;
      elements.authError.classList.remove('hidden');
    } finally {
      elements.authSubmitBtn.disabled = false;
      elements.authSubmitBtn.textContent = isLoginMode ? 'Login' : 'Sign Up';
    }
  }

  /**
   * Logout
   */
  async function logout() {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (error) {
      console.error('[AUTH] Logout error:', error);
    }
    
    currentUser = null;
    updateAuthUI();
    elements.userDropdown?.classList.add('hidden');
  }

  /**
   * Toggle user dropdown
   */
  function toggleUserDropdown() {
    elements.userDropdown?.classList.toggle('hidden');
  }

  /**
   * Load MOTD
   */
  async function loadMotd() {
    try {
      const response = await fetch(`${API_BASE}/api/motd`);
      const data = await response.json();
      
      if (data.success && data.motd && data.motd.enabled) {
        elements.motdMessage.textContent = data.motd.message;
        elements.motdBanner?.classList.remove('hidden');
      } else {
        elements.motdBanner?.classList.add('hidden');
      }
    } catch (error) {
      console.error('[MOTD] Load error:', error);
    }
  }

  /**
   * Open admin panel
   */
  function openAdminPanel() {
    elements.adminModal?.classList.remove('hidden');
    elements.userDropdown?.classList.add('hidden');
    loadAdminEvents();
  }

  /**
   * Close admin panel
   */
  function closeAdminPanel() {
    elements.adminModal?.classList.add('hidden');
  }

  /**
   * Set MOTD (admin)
   */
  async function setMotd() {
    const message = elements.adminMotdMessage.value.trim();
    if (!message) {
      alert('Please enter a MOTD message');
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/admin/motd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, enabled: true })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to set MOTD');
      }
      
      alert('MOTD updated successfully!');
      elements.adminMotdMessage.value = '';
      loadMotd();
    } catch (error) {
      alert(error.message);
    }
  }

  /**
   * Update maintenance mode (admin)
   */
  async function updateMaintenance() {
    const enabled = elements.adminMaintenanceToggle.checked;
    const message = elements.adminMaintenanceMessage.value.trim();
    
    try {
      const response = await fetch(`${API_BASE}/api/admin/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled, message: message || undefined })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update maintenance mode');
      }
      
      alert(`Maintenance mode ${enabled ? 'enabled' : 'disabled'}!`);
    } catch (error) {
      alert(error.message);
    }
  }

  /**
   * Restart server (admin)
   */
  async function restartServer() {
    if (!confirm('Are you sure you want to restart the server?')) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/admin/restart`, {
        method: 'POST',
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to restart server');
      }
      
      alert('Server is restarting...');
    } catch (error) {
      alert(error.message);
    }
  }

  /**
   * Load admin events
   */
  async function loadAdminEvents() {
    try {
      const response = await fetch(`${API_BASE}/api/admin/events`, {
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load events');
      }
      
      if (data.events && data.events.length > 0) {
        elements.adminEvents.innerHTML = data.events.map(event => `
          <div class="event-item">
            <span class="event-type">${escapeHtml(event.event_type)}</span>: 
            ${escapeHtml(event.message || '')}
            <div class="event-time">${new Date(event.created_at).toLocaleString()}</div>
          </div>
        `).join('');
      } else {
        elements.adminEvents.innerHTML = '<div class="event-item">No recent events</div>';
      }
    } catch (error) {
      elements.adminEvents.innerHTML = `<div class="event-item">Error loading events: ${error.message}</div>`;
    }
  }

  /**
   * Escape HTML
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Expose globally
  window.openAuthModal = openAuthModal;

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
