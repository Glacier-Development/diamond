// Diamond Proxy v3 - Settings Module

let swRegistration = null;

// DOM Elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const themeSelect = document.getElementById('themeSelect');
const animationsToggle = document.getElementById('animationsToggle');
const checkSwBtn = document.getElementById('checkSwBtn');
const resetSwBtn = document.getElementById('resetSwBtn');
const unregisterSwBtn = document.getElementById('unregisterSwBtn');
const clearDataBtn = document.getElementById('clearDataBtn');
const swStatus = document.getElementById('swStatus');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadSettings();
    checkServiceWorkerStatus();
});

function setupEventListeners() {
    // Settings modal
    if (settingsBtn) {
        settingsBtn.addEventListener('click', toggleSettingsModal);
    }
    
    if (closeSettings) {
        closeSettings.addEventListener('click', () => {
            settingsModal.classList.remove('active');
        });
    }
    
    // Theme selection
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            setTheme(e.target.value);
        });
    }
    
    // Animations toggle
    if (animationsToggle) {
        animationsToggle.addEventListener('change', (e) => {
            setAnimationsEnabled(e.target.checked);
        });
    }
    
    // Service Worker buttons
    if (checkSwBtn) {
        checkSwBtn.addEventListener('click', checkServiceWorkerStatus);
    }
    
    if (resetSwBtn) {
        resetSwBtn.addEventListener('click', resetServiceWorker);
    }
    
    if (unregisterSwBtn) {
        unregisterSwBtn.addEventListener('click', unregisterServiceWorker);
    }
    
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', clearBrowsingData);
    }
    
    // Close modal on outside click
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.remove('active');
            }
        });
    }
}

function toggleSettingsModal() {
    if (settingsModal) {
        settingsModal.classList.toggle('active');
        if (settingsModal.classList.contains('active')) {
            checkServiceWorkerStatus();
        }
    }
}

function loadSettings() {
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('diamond_theme') || 'glassy';
    setTheme(savedTheme);
    
    // Load animations setting
    const animationsEnabled = localStorage.getItem('diamond_animations') !== 'false';
    setAnimationsEnabled(animationsEnabled);
}

function setTheme(theme) {
    document.body.classList.remove('theme-glassy', 'theme-modern');
    document.body.classList.add(`theme-${theme}`);
    localStorage.setItem('diamond_theme', theme);
    
    if (themeSelect) {
        themeSelect.value = theme;
    }
    
    console.log(`[Settings] Theme set to: ${theme}`);
}

function setAnimationsEnabled(enabled) {
    if (enabled) {
        document.body.classList.remove('no-animations');
    } else {
        document.body.classList.add('no-animations');
    }
    localStorage.setItem('diamond_animations', enabled.toString());
    
    if (animationsToggle) {
        animationsToggle.checked = enabled;
    }
    
    console.log(`[Settings] Animations ${enabled ? 'enabled' : 'disabled'}`);
}

async function checkServiceWorkerStatus() {
    if (!swStatus) return;
    
    swStatus.textContent = 'Checking...';
    
    try {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration('/');
            
            if (registration) {
                swRegistration = registration;
                const state = registration.active ? 'Active' : (registration.installing ? 'Installing' : 'Waiting');
                swStatus.textContent = `Status: ${state} | Scope: ${registration.scope}`;
                swStatus.style.color = 'var(--success)';
            } else {
                swStatus.textContent = 'Not registered';
                swStatus.style.color = 'var(--text-secondary)';
            }
        } else {
            swStatus.textContent = 'Service Workers not supported';
            swStatus.style.color = 'var(--danger)';
        }
    } catch (error) {
        swStatus.textContent = `Error: ${error.message}`;
        swStatus.style.color = 'var(--danger)';
        console.error('[SW] Status check error:', error);
    }
}

async function resetServiceWorker() {
    if (!confirm('This will unregister and re-register the service worker. Continue?')) {
        return;
    }
    
    try {
        if ('serviceWorker' in navigator && swRegistration) {
            await swRegistration.unregister();
            console.log('[SW] Unregistered successfully');
            
            // Wait a moment then re-register
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const newRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            swRegistration = newRegistration;
            console.log('[SW] Re-registered successfully');
            
            swStatus.textContent = 'Reset complete! Refreshing...';
            swStatus.style.color = 'var(--success)';
            
            // Reload to apply changes
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            // Just register if not already registered
            const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            swRegistration = registration;
            console.log('[SW] Registered successfully');
            
            swStatus.textContent = 'Registered successfully';
            swStatus.style.color = 'var(--success)';
        }
    } catch (error) {
        swStatus.textContent = `Error: ${error.message}`;
        swStatus.style.color = 'var(--danger)';
        console.error('[SW] Reset error:', error);
        alert('Failed to reset service worker: ' + error.message);
    }
}

async function unregisterServiceWorker() {
    if (!confirm('This will completely unregister the service worker. Some features may stop working. Continue?')) {
        return;
    }
    
    try {
        if ('serviceWorker' in navigator && swRegistration) {
            const success = await swRegistration.unregister();
            
            if (success) {
                swRegistration = null;
                swStatus.textContent = 'Unregistered successfully';
                swStatus.style.color = 'var(--warning)';
                console.log('[SW] Unregistered successfully');
                
                // Clear related caches
                const cacheNames = await caches.keys();
                for (const cacheName of cacheNames) {
                    await caches.delete(cacheName);
                }
                console.log('[Cache] All caches cleared');
            } else {
                throw new Error('Unregister failed');
            }
        } else {
            swStatus.textContent = 'No service worker registered';
            swStatus.style.color = 'var(--text-secondary)';
        }
    } catch (error) {
        swStatus.textContent = `Error: ${error.message}`;
        swStatus.style.color = 'var(--danger)';
        console.error('[SW] Unregister error:', error);
        alert('Failed to unregister service worker: ' + error.message);
    }
}

async function clearBrowsingData() {
    if (!confirm('This will clear all browsing data including cookies, cache, and local storage. Continue?')) {
        return;
    }
    
    try {
        // Clear localStorage (except settings)
        const theme = localStorage.getItem('diamond_theme');
        const animations = localStorage.getItem('diamond_animations');
        localStorage.clear();
        if (theme) localStorage.setItem('diamond_theme', theme);
        if (animations) localStorage.setItem('diamond_animations', animations);
        
        // Clear sessionStorage
        sessionStorage.clear();
        
        // Clear caches
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
            if (!cacheName.startsWith('diamond-')) {
                await caches.delete(cacheName);
            }
        }
        
        // Clear cookies
        document.cookie.split(";").forEach(c => {
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
        });
        
        alert('Browsing data cleared successfully!');
        console.log('[Data] All browsing data cleared');
    } catch (error) {
        console.error('[Data] Clear error:', error);
        alert('Failed to clear browsing data: ' + error.message);
    }
}

// Export functions for global access
window.DiamondSettings = {
    setTheme,
    setAnimationsEnabled,
    checkServiceWorkerStatus,
    resetServiceWorker,
    unregisterServiceWorker,
    clearBrowsingData
};
