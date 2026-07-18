// Diamond Proxy v3 - Main Application Logic

let tabs = [];
let activeTabId = null;
let tabCounter = 0;

// DOM Elements
const tabsList = document.getElementById('tabsList');
const newTabBtn = document.getElementById('newTabBtn');
const addressBar = document.getElementById('addressBar');
const goBtn = document.getElementById('goBtn');
const backBtn = document.getElementById('backBtn');
const forwardBtn = document.getElementById('forwardBtn');
const refreshBtn = document.getElementById('refreshBtn');
const homeBtn = document.getElementById('homeBtn');
const proxyFrame = document.getElementById('proxyFrame');
const secureIcon = document.getElementById('secureIcon');
const mainSearchInput = document.getElementById('mainSearchInput');
const mainSearchBtn = document.getElementById('mainSearchBtn');
const adminModal = document.getElementById('adminModal');
const adminBtn = document.getElementById('adminBtn');
const closeAdmin = document.getElementById('closeAdmin');
const adminPassword = document.getElementById('adminPassword');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const adminError = document.getElementById('adminError');
const adminLoginView = document.getElementById('adminLoginView');
const adminControlsView = document.getElementById('adminControlsView');
const motdInput = document.getElementById('motdInput');
const motdToggle = document.getElementById('motdToggle');
const saveMotdBtn = document.getElementById('saveMotdBtn');
const maintenanceToggle = document.getElementById('maintenanceToggle');
const restartServerBtn = document.getElementById('restartServerBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    createNewTab();
    setupEventListeners();
    checkAdminSession();
    
    // Hide proxy frame initially
    if (proxyFrame) {
        proxyFrame.classList.remove('active');
    }
});

function setupEventListeners() {
    // Tab controls
    newTabBtn.addEventListener('click', createNewTab);
    
    // Navigation
    goBtn.addEventListener('click', navigateToUrl);
    addressBar.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') navigateToUrl();
    });
    
    backBtn.addEventListener('click', () => {
        if (activeTabId && tabs[activeTabId]) {
            proxyFrame.contentWindow.history.back();
        }
    });
    
    forwardBtn.addEventListener('click', () => {
        if (activeTabId && tabs[activeTabId]) {
            proxyFrame.contentWindow.history.forward();
        }
    });
    
    refreshBtn.addEventListener('click', () => {
        if (activeTabId && tabs[activeTabId]) {
            proxyFrame.contentWindow.location.reload();
        }
    });
    
    homeBtn.addEventListener('click', showWelcomeScreen);
    
    // Main search
    mainSearchBtn.addEventListener('click', () => {
        const query = mainSearchInput.value.trim();
        if (query) {
            handleSearchOrNavigate(query);
        }
    });
    
    mainSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = mainSearchInput.value.trim();
            if (query) {
                handleSearchOrNavigate(query);
            }
        }
    });
    
    // Quick links
    document.querySelectorAll('.quick-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const url = link.getAttribute('data-url');
            if (url) {
                handleSearchOrNavigate(url);
            }
        });
    });
    
    // Admin panel
    adminBtn.addEventListener('click', toggleAdminModal);
    closeAdmin.addEventListener('click', () => {
        adminModal.classList.remove('active');
    });
    
    adminLoginBtn.addEventListener('click', adminLogin);
    adminPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') adminLogin();
    });
    
    saveMotdBtn.addEventListener('click', saveMotd);
    // maintenanceToggle uses onchange directly in HTML
    restartServerBtn.addEventListener('click', restartServer);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+Shift+B for admin panel
        if (e.ctrlKey && e.shiftKey && e.key === 'B') {
            e.preventDefault();
            toggleAdminModal();
        }
        
        // Ctrl+T for new tab
        if (e.ctrlKey && e.key === 't') {
            e.preventDefault();
            createNewTab();
        }
        
        // Ctrl+W to close current tab
        if (e.ctrlKey && e.key === 'w') {
            e.preventDefault();
            if (activeTabId) {
                closeTab(activeTabId);
            }
        }
        
        // Ctrl+L to focus address bar
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            addressBar.focus();
            addressBar.select();
        }
    });
    
    // Close modal on outside click
    adminModal.addEventListener('click', (e) => {
        if (e.target === adminModal) {
            adminModal.classList.remove('active');
        }
    });
}

function createNewTab(url = null) {
    const tabId = ++tabCounter;
    const tab = {
        id: tabId,
        title: 'New Tab',
        url: url || '',
        history: [],
        historyIndex: -1
    };
    
    tabs[tabId] = tab;
    
    const tabElement = document.createElement('div');
    tabElement.className = 'tab';
    tabElement.dataset.tabId = tabId;
    tabElement.innerHTML = `
        <i class="fas fa-globe tab-icon"></i>
        <span class="tab-title">New Tab</span>
        <button class="tab-close" onclick="event.stopPropagation(); closeTab(${tabId})">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    tabElement.addEventListener('click', () => switchToTab(tabId));
    
    tabsList.appendChild(tabElement);
    switchToTab(tabId);
    
    if (url) {
        navigateToUrl(url);
    } else {
        showWelcomeScreen();
    }
    
    return tabId;
}

function switchToTab(tabId) {
    if (!tabs[tabId]) return;
    
    // Update active tab styling
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', parseInt(tab.dataset.tabId) === tabId);
    });
    
    activeTabId = tabId;
    const tab = tabs[tabId];
    
    // Update address bar
    addressBar.value = tab.url || '';
    
    // Show/hide appropriate content
    if (tab.url) {
        loadUrlInFrame(tab.url);
    } else {
        showWelcomeScreen();
    }
}

function closeTab(tabId) {
    if (!tabs[tabId]) return;
    
    const tabElement = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (tabElement) {
        tabElement.remove();
    }
    
    delete tabs[tabId];
    
    // If closing active tab, switch to another
    if (activeTabId === tabId) {
        const remainingTabs = Object.keys(tabs).map(Number);
        if (remainingTabs.length > 0) {
            switchToTab(remainingTabs[remainingTabs.length - 1]);
        } else {
            createNewTab();
        }
    }
}

function navigateToUrl(inputValue = null) {
    let input = inputValue || addressBar.value.trim();
    
    if (!input) return;
    
    // Check if it's a URL or search query
    let url;
    if (input.match(/^https?:\/\//i)) {
        url = input;
    } else if (input.includes('.') && !input.includes(' ')) {
        url = 'https://' + input;
    } else {
        // It's a search query
        url = 'https://www.google.com/search?q=' + encodeURIComponent(input);
    }
    
    if (!activeTabId) {
        createNewTab();
    }
    
    // Update tab state
    tabs[activeTabId].url = url;
    tabs[activeTabId].title = url;
    
    // Update UI
    const tabElement = document.querySelector(`.tab[data-tab-id="${activeTabId}"]`);
    if (tabElement) {
        const tabTitle = tabElement.querySelector('.tab-title');
        const domain = new URL(url).hostname.replace('www.', '');
        tabTitle.textContent = domain;
    }
    
    addressBar.value = url;
    loadUrlInFrame(url);
}

// Handle search or navigation from various inputs
function handleSearchOrNavigate(inputValue) {
    let input = inputValue.trim();
    
    if (!input) return;
    
    // Check if it's a URL or search query
    let url;
    if (input.match(/^https?:\/\//i)) {
        url = input;
    } else if (input.includes('.') && !input.includes(' ')) {
        url = 'https://' + input;
    } else {
        // It's a search query
        url = 'https://www.google.com/search?q=' + encodeURIComponent(input);
    }
    
    if (!activeTabId) {
        createNewTab();
    }
    
    // Update tab state
    tabs[activeTabId].url = url;
    tabs[activeTabId].title = url;
    
    // Update address bar
    addressBar.value = url;
    
    // Update tab element
    const tabElement = document.querySelector(`.tab[data-tab-id="${activeTabId}"]`);
    if (tabElement) {
        const tabTitle = tabElement.querySelector('.tab-title');
        try {
            const domain = new URL(url).hostname.replace('www.', '');
            tabTitle.textContent = domain;
        } catch (e) {
            tabTitle.textContent = url;
        }
    }
    
    loadUrlInFrame(url);
}

function loadUrlInFrame(url) {
    const ws1 = document.getElementById('welcomeScreen');
    if (ws1) ws1.classList.add('hidden');
    const appsScreen = document.getElementById('appsScreen');
    if (appsScreen) appsScreen.classList.add('hidden');
    const gamesScreen = document.getElementById('gamesScreen');
    if (gamesScreen) gamesScreen.classList.add('hidden');
    const settingsScreen = document.getElementById('settingsScreen');
    if (settingsScreen) settingsScreen.classList.add('hidden');
    
    proxyFrame.classList.add('active');

    // Encode URL for proxy using base64url encoding
    const encodedUrl = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    proxyFrame.src = '/proxy/~/' + encodedUrl;

    secureIcon.className = 'fas fa-lock secure-icon';
}

function showWelcomeScreen() {
    proxyFrame.classList.remove('active');
    proxyFrame.src = 'about:blank';
    
    // Hide all screens and show welcome screen
    const appsScreen = document.getElementById('appsScreen');
    if (appsScreen) appsScreen.classList.add('hidden');
    const gamesScreen = document.getElementById('gamesScreen');
    if (gamesScreen) gamesScreen.classList.add('hidden');
    const settingsScreen = document.getElementById('settingsScreen');
    if (settingsScreen) settingsScreen.classList.add('hidden');
    
    const ws2 = document.getElementById('welcomeScreen');
    if (ws2) ws2.classList.remove('hidden');
    
    if (activeTabId && tabs[activeTabId]) {
        tabs[activeTabId].url = '';
        tabs[activeTabId].title = 'New Tab';
        addressBar.value = '';
        
        const tabElement = document.querySelector(`.tab[data-tab-id="${activeTabId}"]`);
        if (tabElement) {
            tabElement.querySelector('.tab-title').textContent = 'New Tab';
        }
    }
}

// Admin Panel Functions
function toggleAdminModal() {
    adminModal.classList.toggle('active');
    if (adminModal.classList.contains('active')) {
        setTimeout(() => adminPassword.focus(), 100);
    }
}

async function adminLogin() {
    const password = adminPassword.value;
    if (!password) return;
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            adminLoginView.style.display = 'none';
            adminControlsView.style.display = 'block';
            adminError.textContent = '';
            adminPassword.value = '';
            
            // Load current settings
            loadAdminSettings();
        } else {
            adminError.textContent = data.error || 'Invalid password';
        }
    } catch (error) {
        adminError.textContent = 'Connection error';
        console.error('Admin login error:', error);
    }
}

async function loadAdminSettings() {
    try {
        const response = await fetch('/api/admin/settings');
        if (response.ok) {
            const data = await response.json();
            motdInput.value = data.motd || '';
            motdToggle.checked = data.motdEnabled || false;
            maintenanceToggle.checked = data.maintenanceMode || false;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

async function saveMotd() {
    const message = motdInput.value.trim();
    const enabled = motdToggle.checked;
    
    try {
        const response = await fetch('/api/admin/motd', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, enabled })
        });
        
        const data = await response.json();
        if (response.ok) {
            alert('MOTD saved successfully!');
        } else {
            alert('Failed to save MOTD: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        alert('Connection error');
        console.error('Save MOTD error:', error);
    }
}

async function toggleMaintenance() {
    const enabled = maintenanceToggle.checked;
    
    try {
        const response = await fetch('/api/admin/maintenance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        
        const data = await response.json();
        if (response.ok) {
            alert(`Maintenance mode ${enabled ? 'enabled' : 'disabled'}!`);
        } else {
            alert('Failed to update maintenance mode: ' + (data.error || 'Unknown error'));
            // Revert toggle state on error
            maintenanceToggle.checked = !enabled;
        }
    } catch (error) {
        alert('Connection error');
        console.error('Toggle maintenance error:', error);
        // Revert toggle state on error
        maintenanceToggle.checked = !enabled;
    }
}

async function restartServer() {
    if (!confirm('Are you sure you want to restart the server? This will disconnect all users.')) {
        return;
    }
    
    try {
        const response = await fetch('/api/admin/restart', {
            method: 'POST'
        });
        
        const data = await response.json();
        if (response.ok) {
            alert('Server restart initiated!');
        } else {
            alert('Failed to restart: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        alert('Connection error');
        console.error('Restart error:', error);
    }
}

async function checkAdminSession() {
    try {
        const response = await fetch('/api/admin/session');
        if (response.ok) {
            const data = await response.json();
            if (data.authenticated) {
                adminLoginView.style.display = 'none';
                adminControlsView.style.display = 'block';
                loadAdminSettings();
            }
        }
    } catch (error) {
        // Not authenticated, show login
    }
}

// Listen for frame load events to update security icon
proxyFrame.addEventListener('load', () => {
    if (proxyFrame.src && proxyFrame.src.startsWith('/proxy/')) {
        secureIcon.className = 'fas fa-lock secure-icon';
    }
});
