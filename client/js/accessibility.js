// Accessibility features (bonus feature - feature flag enabled)
let accessibilityEnabled = false;
let colorblindMode = false;
let highContrastMode = false;
let fontSize = 16;

// Colorblind-friendly color schemes
const COLORBLIND_COLORS = {
  scheme1: ['#E6194B', '#3CB44B', '#FFE119', '#4363D8'], // Red, Green, Yellow, Blue
  scheme2: ['#F58231', '#911EB4', '#46F0F0', '#F032E6'], // Orange, Purple, Cyan, Magenta
  scheme3: ['#000000', '#808080', '#FFFFFF', '#FF0000'] // Black, Gray, White, Red (high contrast)
};

function initAccessibility() {
  // Check if accessibility is enabled via feature flags
  if (typeof featureFlags !== 'undefined' && featureFlags.accessibility) {
    accessibilityEnabled = true;
    createAccessibilityUI();
    loadAccessibilitySettings();
  }
}

function createAccessibilityUI() {
  // Create accessibility settings panel
  const settingsPanel = document.createElement('div');
  settingsPanel.id = 'accessibilityPanel';
  settingsPanel.className = 'accessibility-panel';
  settingsPanel.innerHTML = `
    <div class="accessibility-header">
      <h3>Accessibility Settings</h3>
      <button id="closeAccessibility" class="close-btn">×</button>
    </div>
    <div class="accessibility-content">
      <div class="setting-group">
        <label>
          <input type="checkbox" id="colorblindMode">
          Colorblind Mode
        </label>
        <select id="colorScheme" style="display: none;">
          <option value="scheme1">Scheme 1 (Red/Green/Yellow/Blue)</option>
          <option value="scheme2">Scheme 2 (Orange/Purple/Cyan/Magenta)</option>
          <option value="scheme3">Scheme 3 (High Contrast)</option>
        </select>
      </div>
      
      <div class="setting-group">
        <label>
          <input type="checkbox" id="highContrastMode">
          High Contrast Mode
        </label>
      </div>
      
      <div class="setting-group">
        <label>
          Font Size: <span id="fontSizeValue">16</span>px
          <input type="range" id="fontSizeSlider" min="12" max="24" value="16">
        </label>
      </div>
      
      <div class="setting-group">
        <button id="resetAccessibility" class="btn-secondary">Reset to Defaults</button>
      </div>
    </div>
  `;

  document.body.appendChild(settingsPanel);

  // Event listeners
  document.getElementById('colorblindMode').addEventListener('change', (e) => {
    colorblindMode = e.target.checked;
    document.getElementById('colorScheme').style.display = colorblindMode ? 'block' : 'none';
    applyColorblindMode();
    saveAccessibilitySettings();
  });

  document.getElementById('colorScheme').addEventListener('change', (e) => {
    applyColorblindMode(e.target.value);
    saveAccessibilitySettings();
  });

  document.getElementById('highContrastMode').addEventListener('change', (e) => {
    highContrastMode = e.target.checked;
    applyHighContrastMode();
    saveAccessibilitySettings();
  });

  document.getElementById('fontSizeSlider').addEventListener('input', (e) => {
    fontSize = parseInt(e.target.value);
    document.getElementById('fontSizeValue').textContent = fontSize;
    applyFontSize();
    saveAccessibilitySettings();
  });

  document.getElementById('resetAccessibility').addEventListener('click', () => {
    resetAccessibilitySettings();
  });

  document.getElementById('closeAccessibility').addEventListener('click', () => {
    settingsPanel.style.display = 'none';
  });

  // Add accessibility button to game screen
  if (document.querySelector('.game-container')) {
    const accessibilityBtn = document.createElement('button');
    accessibilityBtn.id = 'accessibilityBtn';
    accessibilityBtn.className = 'accessibility-btn';
    accessibilityBtn.textContent = '⚙️ Accessibility';
    accessibilityBtn.setAttribute('aria-label', 'Open accessibility settings');
    accessibilityBtn.addEventListener('click', () => {
      settingsPanel.style.display = 'block';
    });
    document.querySelector('.game-container').appendChild(accessibilityBtn);
  }
}

function applyColorblindMode(scheme = 'scheme1') {
  if (!colorblindMode) {
    // Reset to original colors
    document.documentElement.style.setProperty('--snake-color-1', '#FF6B6B');
    document.documentElement.style.setProperty('--snake-color-2', '#4ECDC4');
    document.documentElement.style.setProperty('--snake-color-3', '#45B7D1');
    document.documentElement.style.setProperty('--snake-color-4', '#FFA07A');
    return;
  }

  const colors = COLORBLIND_COLORS[scheme] || COLORBLIND_COLORS.scheme1;
  document.documentElement.style.setProperty('--snake-color-1', colors[0]);
  document.documentElement.style.setProperty('--snake-color-2', colors[1]);
  document.documentElement.style.setProperty('--snake-color-3', colors[2]);
  document.documentElement.style.setProperty('--snake-color-4', colors[3]);
}

function applyHighContrastMode() {
  if (highContrastMode) {
    document.body.classList.add('high-contrast');
  } else {
    document.body.classList.remove('high-contrast');
  }
}

function applyFontSize() {
  document.documentElement.style.fontSize = `${fontSize}px`;
}

function saveAccessibilitySettings() {
  const settings = {
    colorblindMode,
    highContrastMode,
    fontSize,
    colorScheme: document.getElementById('colorScheme')?.value || 'scheme1'
  };
  localStorage.setItem('accessibilitySettings', JSON.stringify(settings));
}

function loadAccessibilitySettings() {
  const saved = localStorage.getItem('accessibilitySettings');
  if (saved) {
    try {
      const settings = JSON.parse(saved);
      colorblindMode = settings.colorblindMode || false;
      highContrastMode = settings.highContrastMode || false;
      fontSize = settings.fontSize || 16;

      document.getElementById('colorblindMode').checked = colorblindMode;
      document.getElementById('highContrastMode').checked = highContrastMode;
      document.getElementById('fontSizeSlider').value = fontSize;
      document.getElementById('fontSizeValue').textContent = fontSize;

      if (colorblindMode) {
        document.getElementById('colorScheme').style.display = 'block';
        document.getElementById('colorScheme').value = settings.colorScheme || 'scheme1';
      }

      applyColorblindMode(settings.colorScheme || 'scheme1');
      applyHighContrastMode();
      applyFontSize();
    } catch (e) {
      console.error('Error loading accessibility settings:', e);
    }
  }
}

function resetAccessibilitySettings() {
  colorblindMode = false;
  highContrastMode = false;
  fontSize = 16;

  document.getElementById('colorblindMode').checked = false;
  document.getElementById('highContrastMode').checked = false;
  document.getElementById('fontSizeSlider').value = 16;
  document.getElementById('fontSizeValue').textContent = '16';
  document.getElementById('colorScheme').style.display = 'none';

  applyColorblindMode();
  applyHighContrastMode();
  applyFontSize();
  saveAccessibilitySettings();
}

// Screen reader announcements
function announceToScreenReader(message) {
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only';
  announcement.textContent = message;
  
  document.body.appendChild(announcement);
  
  setTimeout(() => {
    announcement.remove();
  }, 1000);
}

// Add ARIA labels to game elements
function addAriaLabels() {
  const gameBoard = document.getElementById('gameBoard');
  if (gameBoard) {
    gameBoard.setAttribute('role', 'grid');
    gameBoard.setAttribute('aria-label', 'Game board');
  }

  const scoresList = document.getElementById('scoresList');
  if (scoresList) {
    scoresList.setAttribute('role', 'list');
    scoresList.setAttribute('aria-label', 'Player scores');
  }
}

// Initialize accessibility on page load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      initAccessibility();
      addAriaLabels();
    }, 100);
  });
}

