/**
 * Diamond Proxy - Service Worker Registration
 * Handles SW registration with proper error handling and fallbacks
 */

(function() {
  'use strict';

  /**
   * Register the Service Worker
   */
  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[SW] Service Workers not supported in this browser');
      window.dispatchEvent(new CustomEvent('sw-error', {
        detail: { message: 'Service Workers are not supported in your browser' }
      }));
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none'
      });

      console.log('[SW] Service Worker registered:', registration.scope);

      // Check if already active
      if (registration.active) {
        console.log('[SW] Service Worker already active');
        window.dispatchEvent(new CustomEvent('sw-registered'));
        return true;
      }

      // Wait for activation
      return new Promise((resolve) => {
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              console.log('[SW] Service Worker activated');
              window.dispatchEvent(new CustomEvent('sw-registered'));
              resolve(true);
            } else if (newWorker.state === 'redundant') {
              console.error('[SW] Service Worker became redundant');
              window.dispatchEvent(new CustomEvent('sw-error', {
                detail: { message: 'Service Worker installation failed' }
              }));
              resolve(false);
            }
          });
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          console.warn('[SW] Registration timeout');
          resolve(false);
        }, 10000);
      });

    } catch (error) {
      console.error('[SW] Registration failed:', error);
      window.dispatchEvent(new CustomEvent('sw-error', {
        detail: { message: 'Failed to register Service Worker: ' + error.message }
      }));
      return false;
    }
  }

  /**
   * Check if Service Worker is currently registered and active
   */
  async function checkServiceWorkerStatus() {
    if (!('serviceWorker' in navigator)) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      return !!(registration && registration.active);
    } catch (error) {
      console.error('[SW] Status check failed:', error);
      return false;
    }
  }

  /**
   * Update Service Worker if a new version is available
   */
  async function updateServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        const update = await registration.update();
        if (update) {
          console.log('[SW] Service Worker updated');
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('[SW] Update failed:', error);
      return false;
    }
  }

  // Auto-register Service Worker on page load
  async function autoRegister() {
    const isActive = await checkServiceWorkerStatus();
    
    if (!isActive) {
      // Small delay to not block initial page render
      setTimeout(registerServiceWorker, 1000);
    } else {
      console.log('[SW] Service Worker already active, skipping registration');
      window.dispatchEvent(new CustomEvent('sw-registered'));
    }
  }

  // Expose functions globally
  window.registerServiceWorker = registerServiceWorker;
  window.checkServiceWorkerStatus = checkServiceWorkerStatus;
  window.updateServiceWorker = updateServiceWorker;

  // Start auto-registration
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoRegister);
  } else {
    autoRegister();
  }
})();
