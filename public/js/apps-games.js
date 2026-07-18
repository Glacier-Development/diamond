// Diamond Proxy v3 - Apps & Games Module

// Get references to elements - these are defined in app.js, access via document or window
let appsTabBtn, gamesTabBtn, settingsBtn, appsScreen, gamesScreen, settingsScreen, appsGrid, gamesGrid;

let appsData = [];
let gamesData = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Get element references
    appsTabBtn = document.getElementById('appsTabBtn');
    gamesTabBtn = document.getElementById('gamesTabBtn');
    settingsBtn = document.getElementById('settingsBtn');
    appsScreen = document.getElementById('appsScreen');
    gamesScreen = document.getElementById('gamesScreen');
    settingsScreen = document.getElementById('settingsScreen');
    appsGrid = document.getElementById('appsGrid');
    gamesGrid = document.getElementById('gamesGrid');
    
    setupEventListeners();
    await loadAppsAndGames();
});

function setupEventListeners() {
    if (appsTabBtn) {
        appsTabBtn.addEventListener('click', showAppsScreen);
    }
    
    if (gamesTabBtn) {
        gamesTabBtn.addEventListener('click', showGamesScreen);
    }
    
    if (settingsBtn) {
        settingsBtn.addEventListener('click', showSettingsScreen);
    }
}

async function loadAppsAndGames() {
    try {
        // Load apps
        const appsResponse = await fetch('/data/apps.json');
        if (appsResponse.ok) {
            appsData = await appsResponse.json();
            renderApps();
        }
        
        // Load games
        const gamesResponse = await fetch('/data/games.json');
        if (gamesResponse.ok) {
            gamesData = await gamesResponse.json();
            renderGames();
        }
    } catch (error) {
        console.error('[Apps/Games] Failed to load data:', error);
    }
}

function renderApps() {
    if (!appsGrid) return;
    
    appsGrid.innerHTML = '';
    
    const categoryIcons = {
        'search': 'fa-search',
        'media': 'fa-play-circle',
        'social': 'fa-comments',
        'productivity': 'fa-briefcase',
        'development': 'fa-code'
    };
    
    appsData.forEach(app => {
        const card = document.createElement('div');
        card.className = 'app-card';
        card.innerHTML = `
            <div class="card-thumbnail">
                <i class="fas ${categoryIcons[app.category] || 'fa-globe'}"></i>
            </div>
            <h3 class="card-title">${escapeHtml(app.title)}</h3>
            <p class="card-description">${escapeHtml(app.description)}</p>
            <div class="card-tags">
                ${app.tags.map(tag => `<span class="card-tag">${escapeHtml(tag)}</span>`).join('')}
            </div>
        `;
        
        card.addEventListener('click', () => {
            launchAppOrGame(app.proxy_url, app.title);
        });
        
        appsGrid.appendChild(card);
    });
}

function renderGames() {
    if (!gamesGrid) return;
    
    gamesGrid.innerHTML = '';
    
    const categoryIcons = {
        'puzzle': 'fa-puzzle-piece',
        'strategy': 'fa-chess',
        'educational': 'fa-graduation-cap',
        'multiplayer': 'fa-users',
        'action': 'fa-rocket',
        'arcade': 'fa-gamepad'
    };
    
    gamesData.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.innerHTML = `
            <div class="card-thumbnail">
                <i class="fas ${categoryIcons[game.category] || 'fa-gamepad'}"></i>
            </div>
            <h3 class="card-title">${escapeHtml(game.title)}</h3>
            <p class="card-description">${escapeHtml(game.description)}</p>
            <div class="card-tags">
                ${game.tags.map(tag => `<span class="card-tag">${escapeHtml(tag)}</span>`).join('')}
            </div>
        `;
        
        card.addEventListener('click', () => {
            launchAppOrGame(game.proxy_url, game.title);
        });
        
        gamesGrid.appendChild(card);
    });
}

function showAppsScreen() {
    hideAllScreens();
    if (appsScreen) {
        appsScreen.classList.remove('hidden');
        appsScreen.classList.add('active');
    }
}

function showGamesScreen() {
    hideAllScreens();
    if (gamesScreen) {
        gamesScreen.classList.remove('hidden');
        gamesScreen.classList.add('active');
    }
}

function showSettingsScreen() {
    hideAllScreens();
    if (settingsScreen) {
        settingsScreen.classList.remove('hidden');
        settingsScreen.classList.add('active');
    }
}

function showWelcomeScreen() {
    hideAllScreens();
    const ws = document.getElementById('welcomeScreen');
    if (ws) {
        ws.classList.remove('hidden');
        ws.classList.add('active');
    }
}

function hideAllScreens() {
    const ws = document.getElementById('welcomeScreen');
    if (ws) {
        ws.classList.add('hidden');
        ws.classList.remove('active');
    }
    if (appsScreen) {
        appsScreen.classList.add('hidden');
        appsScreen.classList.remove('active');
    }
    if (gamesScreen) {
        gamesScreen.classList.add('hidden');
        gamesScreen.classList.remove('active');
    }
    const settingsScreen = document.getElementById('settingsScreen');
    if (settingsScreen) {
        settingsScreen.classList.add('hidden');
        settingsScreen.classList.remove('active');
    }
    const pf = document.getElementById('proxyFrame');
    if (pf) {
        pf.classList.remove('active');
    }
}

function launchAppOrGame(url, title) {
    if (!url) return;
    
    // Hide all screens and show proxy frame
    hideAllScreens();
    
    // Encode URL for proxy
    const encodedUrl = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    
    const pf = document.getElementById("proxyFrame");
    if (pf) {
        pf.src = '/proxy/~/' + encodedUrl;
        pf.classList.add('active');
    }
    
    // Update address bar if available
    const addressBar = document.getElementById('addressBar');
    if (addressBar) {
        addressBar.value = url;
    }
    
    console.log(`[Apps/Games] Launched: ${title} -> ${url}`);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export functions for global access
window.DiamondAppsGames = {
    showAppsScreen,
    showGamesScreen,
    showSettingsScreen,
    showWelcomeScreen,
    launchAppOrGame,
    hideAllScreens
};
