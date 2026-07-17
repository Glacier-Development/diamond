/**
 * Diamond Proxy - Browser/Omnibox Functionality
 * Handles URL input, proxy navigation, and iframe management
 */

(function() {
  'use strict';

  // DOM Elements
  const elements = {
    omniboxForm: document.getElementById('omnibox-form'),
    omniboxInput: document.getElementById('omnibox-input'),
    browserFrame: document.getElementById('browser-frame'),
    browserIframe: document.getElementById('browser-iframe'),
    browserUrl: document.getElementById('browser-url'),
    browserBack: document.getElementById('browser-back'),
    browserForward: document.getElementById('browser-forward'),
    browserRefresh: document.getElementById('browser-refresh'),
    browserClose: document.getElementById('browser-close'),
    quickLinks: document.querySelectorAll('.quick-link')
  };

  // State
  let currentUrl = '';
  let historyStack = [];
  let historyIndex = -1;

  /**
   * Initialize browser functionality
   */
  function init() {
    setupOmnibox();
    setupBrowserControls();
    setupQuickLinks();
  }

  /**
   * Setup omnibox form handling
   */
  function setupOmnibox() {
    if (!elements.omniboxForm || !elements.omniboxInput) return;

    elements.omniboxForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = elements.omniboxInput.value.trim();
      if (url) {
        navigateTo(url);
      }
    });

    // Auto-focus on load
    elements.omniboxInput.focus();
  }

  /**
   * Setup browser toolbar controls
   */
  function setupBrowserControls() {
    if (elements.browserClose) {
      elements.browserClose.addEventListener('click', closeBrowserFrame);
    }

    if (elements.browserRefresh) {
      elements.browserRefresh.addEventListener('click', refreshFrame);
    }

    if (elements.browserBack) {
      elements.browserBack.addEventListener('click', goBack);
    }

    if (elements.browserForward) {
      elements.browserForward.addEventListener('click', goForward);
    }
  }

  /**
   * Setup quick link buttons
   */
  function setupQuickLinks() {
    elements.quickLinks.forEach(link => {
      link.addEventListener('click', () => {
        const url = link.dataset.url;
        if (url) {
          navigateTo(url);
        }
      });
    });
  }

  /**
   * Navigate to a URL through the proxy
   */
  function navigateTo(url, title = '') {
    // Normalize URL
    let normalizedUrl = normalizeUrl(url);
    
    // Update history
    if (normalizedUrl !== currentUrl) {
      // Remove any forward history
      historyStack = historyStack.slice(0, historyIndex + 1);
      historyStack.push(normalizedUrl);
      historyIndex = historyStack.length - 1;
    }

    currentUrl = normalizedUrl;
    
    // Update URL display
    if (elements.browserUrl) {
      elements.browserUrl.textContent = normalizedUrl;
    }

    // Encode URL for proxy path
    const encodedUrl = encodeUrl(normalizedUrl);
    const proxyUrl = `/proxy/${encodedUrl}`;

    // Show browser frame
    showBrowserFrame();

    // Load in iframe
    if (elements.browserIframe) {
      elements.browserIframe.src = proxyUrl;
    }

    // Clear omnibox input
    if (elements.omniboxInput) {
      elements.omniboxInput.value = '';
    }
  }

  /**
   * Normalize and validate URL input
   */
  function normalizeUrl(input) {
    let url = input.trim();
    
    // Check if it's already a valid URL
    if (/^https?:\/\//i.test(url)) {
      return url;
    }
    
    // Check if it looks like a domain (contains dots, no spaces)
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(url)) {
      return 'https://' + url;
    }
    
    // Otherwise treat as search query (use Google as default)
    const encodedQuery = encodeURIComponent(url);
    return `https://www.google.com/search?q=${encodedQuery}`;
  }

  /**
   * Encode URL - use encodeURIComponent for proper handling
   */
  function encodeUrl(str) {
    return encodeURIComponent(str);
  }

  /**
   * Decode URL from encoded format
   */
  function decodeUrl(str) {
    try {
      return decodeURIComponent(str);
    } catch (e) {
      return str;
    }
  }

  /**
   * Show the browser frame overlay
   */
  function showBrowserFrame() {
    if (elements.browserFrame) {
      elements.browserFrame.classList.remove('hidden');
    }
  }

  /**
   * Close the browser frame
   */
  function closeBrowserFrame() {
    if (elements.browserFrame) {
      elements.browserFrame.classList.add('hidden');
    }
    
    // Clear iframe src to stop any media/requests
    if (elements.browserIframe) {
      elements.browserIframe.src = 'about:blank';
    }
    
    currentUrl = '';
  }

  /**
   * Refresh the current frame
   */
  function refreshFrame() {
    if (elements.browserIframe && currentUrl) {
      const encodedUrl = encodeUrl(currentUrl);
      elements.browserIframe.src = `/proxy/${encodedUrl}`;
    } else if (elements.browserIframe) {
      elements.browserIframe.contentWindow.location.reload();
    }
  }

  /**
   * Go back in history
   */
  function goBack() {
    if (historyIndex > 0) {
      historyIndex--;
      const url = historyStack[historyIndex];
      currentUrl = url;
      
      if (elements.browserUrl) {
        elements.browserUrl.textContent = url;
      }
      
      if (elements.browserIframe) {
        const encodedUrl = encodeUrl(url);
        elements.browserIframe.src = `/proxy/${encodedUrl}`;
      }
    }
  }

  /**
   * Go forward in history
   */
  function goForward() {
    if (historyIndex < historyStack.length - 1) {
      historyIndex++;
      const url = historyStack[historyIndex];
      currentUrl = url;
      
      if (elements.browserUrl) {
        elements.browserUrl.textContent = url;
      }
      
      if (elements.browserIframe) {
        const encodedUrl = encodeUrl(url);
        elements.browserIframe.src = `/proxy/${encodedUrl}`;
      }
    }
  }

  // Expose functions globally
  window.openBrowserFrame = navigateTo;
  window.closeBrowserFrame = closeBrowserFrame;

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
