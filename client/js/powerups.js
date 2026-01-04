// Power-ups rendering (bonus feature - feature flag enabled)
let powerupsEnabled = false;

function initPowerups() {
  // Check if power-ups are enabled via feature flags
  if (typeof featureFlags !== 'undefined' && featureFlags.powerups) {
    powerupsEnabled = true;
  }
}

function renderPowerups(gameState) {
  if (!powerupsEnabled || !gameState.powerups) {
    return;
  }

  gameState.powerups.forEach(powerup => {
    const cell = getCell(powerup.x, powerup.y);
    if (cell) {
      cell.classList.add('powerup');
      cell.classList.add(`powerup-${powerup.type}`);
      cell.dataset.powerupType = powerup.type;
    }
  });
}

function getPowerupColor(type) {
  const colors = {
    'speed_boost': '#FFC107', // Bright Gold
    'shield': '#00E5FF', // Bright Cyan
    'shrink': '#FF1493', // Bright Pink
    'slow_others': '#9C27B0' // Bright Purple
  };
  return colors[type] || '#FFFFFF';
}

function getPowerupIcon(type) {
  // Normalize type string (handle any case or spacing issues)
  const normalizedType = String(type).toLowerCase().trim();
  
  const icons = {
    'speed_boost': '⚡',
    'speedboost': '⚡',
    'shield': '🛡️',
    'shrink': '📉',
    'slow_others': '🐌',
    'slowothers': '🐌',
    'slowed': '🐌'
  };
  
  const icon = icons[normalizedType];
  if (!icon) {
    console.warn('Unknown power-up type:', type, 'normalized:', normalizedType, 'available keys:', Object.keys(icons));
    // Try to find partial match
    for (const key in icons) {
      if (normalizedType.includes(key) || key.includes(normalizedType)) {
        return icons[key];
      }
    }
  }
  return icon || '⚡'; // Default to lightning instead of ?
}

// Update game.js renderGame function to include power-ups
function updateRenderGameForPowerups() {
  if (!powerupsEnabled) return;

  // This will be called from game.js after rendering snakes
  // Power-ups are rendered in renderGame function
}

// Show power-up indicator for active power-ups
function renderActivePowerups(gameState, currentPlayerId) {
  if (!powerupsEnabled || !gameState) return;

  const player = gameState.players[currentPlayerId];
  if (!player || !player.activePowerups) return;

  // Create or update power-up indicators
  let indicatorsContainer = document.getElementById('powerupIndicators');
  if (!indicatorsContainer) {
    indicatorsContainer = document.createElement('div');
    indicatorsContainer.id = 'powerupIndicators';
    indicatorsContainer.className = 'powerup-indicators';
    // Insert in the game-header (top center, between score-board and header-stats)
    const gameHeader = document.querySelector('.game-header');
    if (gameHeader) {
      gameHeader.appendChild(indicatorsContainer);
    }
  }

  indicatorsContainer.innerHTML = '';

  Object.keys(player.activePowerups).forEach(type => {
    const endTime = player.activePowerups[type];
    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));

    if (remaining > 0) {
      const indicator = document.createElement('div');
      indicator.className = 'powerup-indicator';
      const icon = getPowerupIcon(type);
      const typeName = type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
      indicator.innerHTML = `
        <span class="powerup-icon">${icon}</span>
        <span class="powerup-name">${typeName}</span>
        <span class="powerup-time">${remaining}s</span>
      `;
      indicator.title = typeName;
      indicatorsContainer.appendChild(indicator);
    }
  });
}

// Initialize power-ups on page load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      initPowerups();
    }, 100);
  });
}
