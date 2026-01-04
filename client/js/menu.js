// Menu system (pause/resume/quit)
let isMenuOpen = false;
let totalPauseTimeUsed = 0; // Track total pause time used in milliseconds

document.addEventListener('DOMContentLoaded', () => {
  const gameMenu = document.getElementById('gameMenu');
  const pauseButton = document.getElementById('pauseButton');
  const resumeButton = document.getElementById('resumeButton');
  const quitButton = document.getElementById('quitButton');

  // ESC key to toggle menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleMenu();
    }
  });

  // Pause button - show for host in multiplayer or any player in solo
  if (pauseButton) {
    pauseButton.style.display = 'none'; // Will be shown when menu opens if allowed
  }

  // Resume/Pause button (toggles pause/resume)
  resumeButton.addEventListener('click', () => {
    const isPaused = (window.gameState && window.gameState.isPaused) || false;
    if (isPaused) {
      resumeGame();
    } else {
      pauseGame();
    }
  });

  // Quit button
  quitButton.addEventListener('click', () => {
    if (confirm('Are you sure you want to quit the game?')) {
      quitGame();
    }
  });

  // Setup socket listeners - wait for socket to be ready
  function setupMenuSocketListeners() {
    const socketToUse = (typeof window !== 'undefined' && window.socket) ? window.socket : socket;
    if (!socketToUse) {
      console.log('Menu: Waiting for socket...');
      setTimeout(setupMenuSocketListeners, 100);
      return;
    }

    console.log('Menu: Setting up socket listeners');
    const socket = socketToUse; // Use the correct socket

    // Socket listeners for menu actions
    socket.on('gamePaused', (data) => {
      // Update gameState if available
      if (window.gameState) {
        window.gameState.isPaused = true;
      }
      
      // Track pause time start for client-side counting
      window.pauseStartTime = Date.now();
      
      // Update button text - change to "Play" when paused
      const pauseButton = document.getElementById('pauseButton');
      const resumeButton = document.getElementById('resumeButton');
      if (pauseButton && resumeButton) {
        pauseButton.style.display = 'none';
        if (resumeButton.style.display !== 'none') {
          resumeButton.textContent = 'Play';
          resumeButton.style.display = 'inline-block';
        }
      }
      
      if (!isMenuOpen) {
        showMenu(`Paused by ${data.pausedBy}`);
      } else {
        updateMenuText(`Paused by ${data.pausedBy}`);
      }
    });

    socket.on('gameResumed', (data) => {
      // Update gameState if available
      if (window.gameState) {
        window.gameState.isPaused = false;
      }
      
      // Track pause time for total calculation
      if (window.pauseStartTime) {
        totalPauseTimeUsed += Date.now() - window.pauseStartTime;
        window.pauseStartTime = null;
      }
      
      // Update button text - change to "Pause" when resumed
      const pauseButton = document.getElementById('pauseButton');
      const resumeButton = document.getElementById('resumeButton');
      if (pauseButton && resumeButton && isMenuOpen) {
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        const isSoloMode = !roomCode || roomCode.startsWith('SP');
        const canControlPause = window.isHost || isSoloMode;
        if (canControlPause) {
          pauseButton.textContent = getPauseButtonText(isSoloMode);
          pauseButton.style.display = 'inline-block';
          resumeButton.style.display = 'none';
        }
      }
      
      // Hide menu and overlay
      hideMenu();
      // Hide any overlay that might be showing
      const overlay = document.getElementById('gameOverlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
      
      if (data.resumedBy) {
        // Show brief notification
        showNotification(`Game resumed by ${data.resumedBy}`);
      }
    });
    
    socket.on('pauseError', (data) => {
      showNotification(data.message || 'Cannot pause game');
    });
    
    socket.on('resumeError', (data) => {
      showNotification(data.message || 'Cannot resume game');
    });
    
    socket.on('hostChanged', (data) => {
      // Update host status
      window.isHost = (data.newHostId === window.currentPlayerId);
      showNotification(`New host: ${data.newHostName}`);
      // Update menu button visibility if menu is open
      if (isMenuOpen) {
        const pauseButton = document.getElementById('pauseButton');
        const resumeButton = document.getElementById('resumeButton');
        if (pauseButton && resumeButton) {
          pauseButton.style.display = window.isHost ? 'inline-block' : 'none';
        }
      }
    });

    socket.on('gameQuit', (data) => {
      showNotification(`Game quit by ${data.quitBy}`);
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    });
  }

  setupMenuSocketListeners();
});

function toggleMenu() {
  // Check if in solo mode (solo or single-player)
  // const urlParams = new URLSearchParams(window.location.search);
  // const roomCode = urlParams.get('room');
  // const isSoloMode = !roomCode || roomCode.startsWith('SP'); // Solo mode rooms start with 'SP'
  
  if (isMenuOpen) {
    hideMenu();
    // If game was paused, resume it when closing menu (all players can resume)
    if (window.gameState && window.gameState.isPaused) {
      resumeGame();
    }
  } else {
    // All players can pause when opening menu (if game is active and not already paused)
    const willPause = window.gameState && !window.gameState.isPaused && window.gameState.players;
    if (willPause) {
      pauseGame();
    } else {
      showMenu();
    }
  }
}

function updateMenuText(statusText) {
  const menuStatus = document.getElementById('menuStatus');
  const menuHint = document.getElementById('menuHint');
  if (menuStatus) {
    menuStatus.textContent = statusText;
  }
  if (menuHint) {
    const isPaused = (window.gameState && window.gameState.isPaused) || false;
    menuHint.textContent = isPaused
      ? 'Press ESC to play'
      : 'Press ESC to pause and open menu';
  }
}

function showMenu(statusText = '') {
  const gameMenu = document.getElementById('gameMenu');
  const pauseButton = document.getElementById('pauseButton');
  const resumeButton = document.getElementById('resumeButton');
  
  isMenuOpen = true;
  gameMenu.style.display = 'flex';
  const isPaused = (window.gameState && window.gameState.isPaused) || false;
  const nextStatus = statusText || (isPaused ? 'Paused' : 'Game Menu');
  updateMenuText(nextStatus);
  
  // Show/hide buttons based on game state
  if (pauseButton && resumeButton) {
    // Check game mode
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    const isSoloMode = !roomCode || roomCode.startsWith('SP'); // Solo mode rooms start with 'SP'
    const canControlPause = window.isHost || isSoloMode;
    
    // All players can pause/resume now
    // Show pause/resume buttons for all players
    if (isPaused) {
      pauseButton.style.display = 'none';
      resumeButton.textContent = 'Play';
      resumeButton.style.display = 'inline-block';
    } else {
      pauseButton.textContent = getPauseButtonText(isSoloMode);
      pauseButton.style.display = 'inline-block';
      resumeButton.style.display = 'none';
    }
  }
  
  // Update game information
  updateGameInfo();
}

function updateGameInfo() {
  // Get current game state (if available)
  let currentLevel = 1;
  let controlScheme = 'WASD';
  let powerupsEnabled = false;
  let players = [];
  let currentPlayerId = '';
  
  // Try to get game state from window (exposed by game.js)
  const hasGameState = typeof window.gameState !== 'undefined' && window.gameState;
  
  if (hasGameState) {
    currentLevel = window.gameState.level || 1;
    // Get all players from game state
    if (window.gameState.players) {
      players = Object.values(window.gameState.players);
    }
  }
  
  // Get current player ID from window (exposed by game.js) or URL
  let currentPlayerIdValue = '';
  if (typeof window.currentPlayerId !== 'undefined' && window.currentPlayerId) {
    currentPlayerIdValue = window.currentPlayerId;
  } else {
    const urlParams = new URLSearchParams(window.location.search);
    currentPlayerIdValue = urlParams.get('player') || '';
  }
  
  // Get control scheme from localStorage or URL
  const savedScheme = localStorage.getItem('snakeGameControlScheme');
  if (savedScheme) {
    controlScheme = savedScheme.toUpperCase();
  } else {
    const urlParams = new URLSearchParams(window.location.search);
    const controlParam = urlParams.get('controls');
    if (controlParam) {
      controlScheme = controlParam === 'arrows' ? 'Arrow Keys' : 'WASD';
    }
  }
  
  // Check if power-ups are enabled (check feature flags)
  if (typeof featureFlags !== 'undefined' && featureFlags.powerups) {
    powerupsEnabled = true;
  }
  
  // Update level display
  const levelDisplay = document.getElementById('menuLevelDisplay');
  if (levelDisplay) {
    levelDisplay.textContent = currentLevel;
  }
  
  // Update control scheme display
  const controlSchemeDisplay = document.getElementById('menuControlScheme');
  if (controlSchemeDisplay) {
    controlSchemeDisplay.textContent = controlScheme;
  }
  
  // Show/hide power-ups section
  const powerupsInfo = document.getElementById('powerupsInfo');
  if (powerupsInfo) {
    powerupsInfo.style.display = powerupsEnabled ? 'block' : 'none';
  }
  
  // Update player colors list
  updatePlayerColorsList(players, currentPlayerIdValue);
}

function updatePlayerColorsList(players, currentPlayerId) {
  const playerColorsList = document.getElementById('playerColorsList');
  if (!playerColorsList) return;
  
  if (!players || players.length === 0) {
    playerColorsList.innerHTML = '<p style="color: #666; margin: 0;">No players in game</p>';
    return;
  }
  
  // Sort players: human players first, then bots
  const sortedPlayers = [...players].sort((a, b) => {
    if (a.type === 'human' && b.type === 'npc') return -1;
    if (a.type === 'npc' && b.type === 'human') return 1;
    return 0;
  });
  
  let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
  sortedPlayers.forEach(player => {
    const isCurrentPlayer = player.id === currentPlayerId;
    const playerType = player.type === 'npc' ? 'Bot' : 'Player';
    const playerLabel = isCurrentPlayer ? ' (You)' : '';
    
    html += `<li style="margin-bottom: 8px; display: flex; align-items: center; gap: 10px;">
      <span class="player-color-indicator" style="
        width: 20px;
        height: 20px;
        background-color: ${player.color};
        border: 2px solid ${isCurrentPlayer ? '#333' : 'rgba(0,0,0,0.2)'};
        border-radius: 3px;
        display: inline-block;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      "></span>
      <span style="color: #666;">
        <strong style="color: ${isCurrentPlayer ? '#667eea' : '#333'};">
          ${player.name}${playerLabel}
        </strong>
        <span style="font-size: 0.9em; opacity: 0.8;"> - ${playerType}</span>
      </span>
    </li>`;
  });
  html += '</ul>';
  
  playerColorsList.innerHTML = html;
}

function hideMenu() {
  const gameMenu = document.getElementById('gameMenu');
  isMenuOpen = false;
  gameMenu.style.display = 'none';
}

function pauseGame() {
  const roomCode = new URLSearchParams(window.location.search).get('room');
  const socketToUse = (typeof window !== 'undefined' && window.socket) ? window.socket : socket;
  const isSoloMode = !roomCode || roomCode.startsWith('SP');
  
  if (!socketToUse || !socketToUse.connected) {
    if (typeof window !== 'undefined' && window.devLog) {
      window.devLog.warn('Cannot pause: socket not available');
    }
    return;
  }

  // For solo mode, still send pause to server (unlimited pause time, but server needs to know)
  // For multiplayer, send to server with time limit
  if (isSoloMode) {
    // Solo mode: send to server but with unlimited pause time
    // Set local pause state immediately for UI responsiveness
    if (window.gameState) {
      window.gameState.isPaused = true;
      // Mark that pause was initiated locally
      window.gameState._pauseInitiatedLocally = true;
    }
    // Send to server so game loop stops
    socketToUse.emit('pauseGame', {
      roomCode: roomCode
    });
    showMenu('Paused');
  } else {
    // Multiplayer: send to server to enforce 15-min limit
    socketToUse.emit('pauseGame', {
      roomCode: roomCode
    });
    showMenu('Pausing...');
  }
}

function getPauseButtonText(isSoloMode) {
  const maxPauseTime = isSoloMode ? 'Unlimited' : '15 min';
  const remainingTime = isSoloMode ? '' : ` (${getRemainingPauseTime()})`;
  return `Pause ${remainingTime}`;
}

function getRemainingPauseTime() {
  const maxPauseMillis = 15 * 60 * 1000; // 15 minutes
  const remainingMillis = Math.max(0, maxPauseMillis - totalPauseTimeUsed);
  const remainingMins = Math.ceil(remainingMillis / 60000);
  return `${remainingMins}m left`;
}

function resumeGame() {
  const roomCode = new URLSearchParams(window.location.search).get('room');
  const socketToUse = (typeof window !== 'undefined' && window.socket) ? window.socket : socket;
  const isSoloMode = !roomCode || roomCode.startsWith('SP');
  
  if (!socketToUse || !socketToUse.connected) {
    if (typeof window !== 'undefined' && window.devLog) {
      window.devLog.warn('Cannot resume: socket not available');
    }
    return;
  }

  // For solo mode, still send resume to server to sync state
  // For multiplayer, send to server
  if (isSoloMode) {
    // Solo mode: set local state and send to server
    if (window.gameState) {
      window.gameState.isPaused = false;
      window.gameState._pauseInitiatedLocally = false; // Clear local pause flag
    }
    // Send to server to resume game loop
    socketToUse.emit('resumeGame', {
      roomCode: roomCode
    });
    hideMenu();
  } else {
    // Multiplayer: send to server
    socketToUse.emit('resumeGame', {
      roomCode: roomCode
    });
    hideMenu();
  }
}

function quitGame() {
  const roomCode = new URLSearchParams(window.location.search).get('room');
  
  // If host, show options dialog
  if (window.isHost && roomCode && socket && socket.connected) {
    const leaveAlone = confirm('Leave alone (others continue) or Leave with party (end game for all)?\n\nClick OK to leave alone\nClick Cancel to leave with party');
    
    const leaveType = leaveAlone ? 'alone' : 'withParty';
    
    socket.emit('quitGame', {
      roomCode: roomCode,
      leaveType: leaveType
    });
    
    hideMenu();
    if (leaveType === 'alone') {
      showNotification('Leaving game...');
      setTimeout(() => {
        window.location.href = '/';
      }, 500);
    } else {
      showNotification('Closing game for all players...');
      setTimeout(() => {
        window.location.href = '/';
      }, 500);
    }
  } else if (roomCode && socket && socket.connected) {
    // Non-host player - just quit normally
    socket.emit('quitGame', {
      roomCode: roomCode,
      leaveType: 'alone'
    });
    hideMenu();
    showNotification('Quitting game...');
    setTimeout(() => {
      window.location.href = '/';
    }, 500);
  } else {
    // Socket not connected, just redirect immediately
    hideMenu();
    window.location.href = '/';
  }
}

function showNotification(message) {
  // Create temporary notification element
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 10px 20px;
    border-radius: 5px;
    z-index: 10000;
    font-size: 14px;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}
