// Game rendering and state management
let GRID_WIDTH = 30;
let GRID_HEIGHT = 30;
let CELL_SIZE = 20; // pixels

const DEBUG = false; // Set to true for debugging

let gameState = null;
let previousSnakePositions = new Map(); // playerId -> Set of "x,y" strings
let previousFoodPositions = new Set(); // "x,y" strings
let currentPlayerId = '';
let currentRoomCode = '';
let currentGameMode = null; // Track current game mode ('single-player' or 'multi-player')
let isCountdownActive = false; // Track if countdown is active (prevents snake movement rendering)

// Expose gameState globally so menu.js can access it
window.gameState = null;
window.currentPlayerId = '';
window.isHost = false; // Track if current player is host

let gameBoard = null;
let cells = [];
let lastUpdateTime = 0;
let animationFrameId = null;
let fps = 0;
let fpsLastTime = performance.now();
let fpsFrames = 0;
let previousScores = {};
let previousFoodCount = 0;
let gameEndedShown = false; // Track if game ended overlay has been shown to prevent duplicates
let playerKicked = false; // Track if player was kicked (to stop rendering)
let gridConfigKey = `${GRID_WIDTH}x${GRID_HEIGHT}x${CELL_SIZE}`;

function applyGridConfig(state) {
  if (!state) {
    return;
  }
  const width = Number(state.gridWidth);
  const height = Number(state.gridHeight);
  const size = Number(state.cellSize);
  if (Number.isFinite(width) && width > 0) {
    GRID_WIDTH = width;
  }
  if (Number.isFinite(height) && height > 0) {
    GRID_HEIGHT = height;
  }
  if (Number.isFinite(size) && size > 0) {
    CELL_SIZE = size;
  }
  const nextKey = `${GRID_WIDTH}x${GRID_HEIGHT}x${CELL_SIZE}`;
  if (nextKey !== gridConfigKey) {
    gridConfigKey = nextKey;
    if (gameBoard) {
      initializeGameBoard();
    }
  }
}
// Update wall mode visual indicator
function updateWallModeIndicator() {
  if (!gameBoard) return;
  
  if (gameState && gameState.wallMode === true) {
    gameBoard.classList.add('wall-mode');
  } else {
    gameBoard.classList.remove('wall-mode');
  }
}

// Function to update sound toggle icon
function updateSoundToggleIcon() {
  const soundToggleIcon = document.getElementById('soundToggleIcon');
  const soundToggleButton = document.getElementById('soundToggleButton');
  if (soundToggleIcon && audioManager) {
    if (audioManager.enabled) {
      soundToggleIcon.textContent = '🔊';
      if (soundToggleButton) {
        soundToggleButton.title = 'Sound: ON (Click to mute)';
        soundToggleButton.style.opacity = '1';
      }
    } else {
      soundToggleIcon.textContent = '🔇';
      if (soundToggleButton) {
        soundToggleButton.title = 'Sound: OFF (Click to unmute)';
        soundToggleButton.style.opacity = '0.6';
      }
    }
  }
}

// Function to setup sound toggle button
function setupSoundToggle() {
  const soundToggleButton = document.getElementById('soundToggleButton');
  const soundToggleIcon = document.getElementById('soundToggleIcon');
  
  if (!soundToggleButton || !soundToggleIcon) {
    return;
  }
  
  // Load sound preference from localStorage
  const soundEnabled = localStorage.getItem('gameSoundEnabled');
  if (soundEnabled !== null && typeof audioManager !== 'undefined') {
    audioManager.enabled = soundEnabled === 'true';
  }
  
  // Update icon based on current state
  updateSoundToggleIcon();
  
  // Remove any existing listeners by cloning
  const newButton = soundToggleButton.cloneNode(true);
  soundToggleButton.parentNode.replaceChild(newButton, soundToggleButton);
  
  // Add click handler
  newButton.addEventListener('click', () => {
    if (typeof audioManager !== 'undefined') {
      audioManager.enabled = !audioManager.enabled;
      localStorage.setItem('gameSoundEnabled', audioManager.enabled.toString());
      updateSoundToggleIcon();
    }
  });
}

// Initialize game
document.addEventListener('DOMContentLoaded', () => {
  // Get room and player from URL
  const urlParams = new URLSearchParams(window.location.search);
  currentRoomCode = urlParams.get('room');
  currentPlayerId = urlParams.get('player');
  
  // Check if there's a pending game state from join.js redirect
  const pendingGameState = sessionStorage.getItem('pendingGameState');
  if (pendingGameState) {
    try {
      const pending = JSON.parse(pendingGameState);
      if (pending.gameState) {
        // Use the pending game state immediately (roomCode might not match yet)
        gameState = pending.gameState;
        applyGridConfig(gameState);
        window.gameState = gameState;
        currentPlayerId = pending.playerId || currentPlayerId;
        window.currentPlayerId = currentPlayerId;
        if (pending.roomCode) {
          currentRoomCode = pending.roomCode;
        }
        updateWallModeIndicator();
        sessionStorage.removeItem('pendingGameState');
        
        // Initialize board and render immediately if we have game state
        setTimeout(() => {
          if (gameBoard && cells.length === 0) {
            initializeGameBoard();
          }
          if (gameState) {
            updateUI();
            renderGame();
          }
        }, 100);
      }
    } catch (e) {
      console.error('Error parsing pending game state:', e);
      sessionStorage.removeItem('pendingGameState');
    }
  }
  
  // Get control scheme from URL or localStorage
  const controlSchemeParam = urlParams.get('controls');
  let currentControlScheme = 'wasd';
  
  if (controlSchemeParam) {
    currentControlScheme = controlSchemeParam;
    if (typeof setPlayerControlScheme === 'function') {
      setPlayerControlScheme(controlSchemeParam);
    }
  } else {
    // Try to get from localStorage
    const savedScheme = localStorage.getItem('snakeGameControlScheme');
    if (savedScheme) {
      currentControlScheme = savedScheme;
      if (typeof setPlayerControlScheme === 'function') {
        setPlayerControlScheme(savedScheme);
      }
    }
  }
  
  // Update controls display immediately
  function updateControlsDisplay(scheme) {
    const controlSchemeDisplay = document.getElementById('controlSchemeDisplay');
    if (controlSchemeDisplay) {
      if (scheme === 'wasd') {
        controlSchemeDisplay.textContent = 'WASD (W/A/S/D)';
      } else if (scheme === 'arrows') {
        controlSchemeDisplay.textContent = 'Arrow Keys (↑/↓/←/→)';
      }
    }
  }
  
  updateControlsDisplay(currentControlScheme);

  if (!currentRoomCode || !currentPlayerId) {
    alert('Invalid game session. Redirecting to join screen.');
    window.location.href = '/';
    return;
  }

  gameBoard = document.getElementById('gameBoard');
  if (!gameBoard) {
    console.error('Game board element not found!');
    return;
  }

  initializeGameBoard();
  
  // Initialize sound toggle (but keep it hidden until game starts)
  setupSoundToggle();
  
  // Leave game button (multiplayer only)
  const leaveGameButton = document.getElementById('leaveGameButton');
  if (leaveGameButton) {
    leaveGameButton.addEventListener('click', () => {
      if (confirm('Are you sure you want to leave the game?')) {
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        
        if (socket && socket.connected && roomCode) {
          socket.emit('quitGame', {
            roomCode: roomCode,
            leaveType: 'alone'
          });
          showNotification('Leaving game...');
          setTimeout(() => {
            window.location.href = '/';
          }, 500);
        } else {
          window.location.href = '/';
        }
      }
    });
  }
  
  // Set up countdown listener IMMEDIATELY when socket is available
  // This ensures we catch countdown events even if they arrive before other listeners are set up
  // Wait for socket to be initialized before setting up listeners
  function waitForSocket() {
    if (typeof socket === 'undefined' || socket === null) {
      if (DEBUG) console.log('Waiting for socket initialization...');
      setTimeout(waitForSocket, 50);
      return;
    }
    
    // Wait for socket to be connected
    if (!socket.connected) {
      if (DEBUG) console.log('Socket exists but not connected, waiting...');
      socket.on('connect', () => {
        if (DEBUG) console.log('Socket connected, setting up listeners');
        setupSocketListeners();
        startGameLoop();
        // Request game state if we missed the gameStarted event
        requestGameState();
      });
      return;
    }
    
    if (DEBUG) console.log('Socket ready and connected, setting up listeners');
    setupSocketListeners();
    startGameLoop();
    
    // Request game state in case we missed the gameStarted event (reduced delay)
    setTimeout(() => {
      if (!gameState) {
        if (DEBUG) console.log('No game state received after 500ms, requesting...');
        requestGameState();
      }
    }, 500); // Reduced from 1000ms to 500ms
  }
  
  waitForSocket();
  
  // Function to request current game state from server
  function requestGameState() {
    if (!socket || !socket.connected) {
      console.error('Cannot request game state: socket not connected');
      // Try again after a delay
      setTimeout(() => {
        if (socket && socket.connected && !gameState) {
          requestGameState();
        }
      }, 500);
      return;
    }
    
    if (!currentRoomCode) {
      console.error('Cannot request game state: no room code');
      return;
    }
    
    if (DEBUG) console.log('Requesting game state from server for room:', currentRoomCode);
    socket.emit('requestGameState', {
      roomCode: currentRoomCode,
      playerToken: typeof getOrCreatePlayerToken === 'function' ? getOrCreatePlayerToken() : null
    });
    
    // If still no game state after 1 second, try again (but limit retries)
    let retryCount = 0;
    const maxRetries = 2; // Reduced from 3 to 2
    const retryTimeout = setTimeout(() => {
      if (!gameState && retryCount < maxRetries) {
        retryCount++;
        if (DEBUG) console.log(`Still no game state, retrying... (${retryCount}/${maxRetries})`);
        requestGameState();
      } else if (!gameState && retryCount >= maxRetries) {
        console.error('Failed to get game state after multiple retries. Redirecting to join screen.');
        showOverlay('Connection Error', 'Could not connect to game. Redirecting to join screen...', () => {
          window.location.href = '/';
        });
        setTimeout(() => {
          window.location.href = '/';
        }, 1500); // Reduced from 2000ms to 1500ms
      }
    }, 1000); // Reduced from 2000ms to 1000ms
  }
  
  // Handle game state errors from server
  socket.on('gameStateError', (data) => {
    console.error('Game state error:', data.message);
    showOverlay('Game Error', data.message || 'Could not load game state. Redirecting to join screen...', () => {
      window.location.href = '/';
    });
    setTimeout(() => {
      window.location.href = '/';
    }, 3000);
  });
});

function initializeGameBoard() {
  // Create grid cells
  cells = [];
  if (gameBoard) {
    gameBoard.innerHTML = '';
  }
  gameBoard.style.gridTemplateColumns = `repeat(${GRID_WIDTH}, ${CELL_SIZE}px)`;
  gameBoard.style.gridTemplateRows = `repeat(${GRID_HEIGHT}, ${CELL_SIZE}px)`;
  
  // Ensure explicit sizing for browser compatibility
  // Calculate: 30 columns * 20px + 29 gaps * 1px + 4px padding + 4px border
  const gridWidth = GRID_WIDTH * CELL_SIZE + (GRID_WIDTH - 1) * 1 + 4 + 4; // gap is 1px
  const gridHeight = GRID_HEIGHT * CELL_SIZE + (GRID_HEIGHT - 1) * 1 + 4 + 4;
  gameBoard.style.width = `${gridWidth}px`;
  gameBoard.style.height = `${gridHeight}px`;
  gameBoard.style.minWidth = `${gridWidth}px`;
  gameBoard.style.maxWidth = `${gridWidth}px`;
  gameBoard.style.minHeight = `${gridHeight}px`;
  gameBoard.style.maxHeight = `${gridHeight}px`;
  gameBoard.style.boxSizing = 'border-box';
  gameBoard.style.gap = '1px'; // 1px gap for thin grid lines

  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      // Ensure cells maintain exact size
      cell.style.width = `${CELL_SIZE}px`;
      cell.style.height = `${CELL_SIZE}px`;
      cell.style.minWidth = `${CELL_SIZE}px`;
      cell.style.minHeight = `${CELL_SIZE}px`;
      cell.style.maxWidth = `${CELL_SIZE}px`;
      cell.style.maxHeight = `${CELL_SIZE}px`;
      cell.style.boxSizing = 'border-box';
      gameBoard.appendChild(cell);
      cells.push(cell);
    }
  }
}

function setupSocketListeners() {
  // Wait for socket to be initialized
  if (!socket) {
    console.error('Socket not initialized in game.js');
    setTimeout(setupSocketListeners, 100);
    return;
  }

  // Clean up all listeners before setting up new ones to prevent duplicates
  socket.off('gameCountdown');
  socket.off('gamePreStart');
  socket.off('gameStarted');
  socket.off('gameStateUpdate');
  socket.off('gameEnded');
  socket.off('playerQuit');
  socket.off('playerLeft');
  socket.off('gamePaused');
  socket.off('gameResumed');
  socket.off('resumeCountdown');
  socket.off('inactivityWarning');
  socket.off('error');
  socket.off('playerKicked');
  socket.off('playerReadyStatus');
  socket.off('allPlayersReady');
  socket.off('playerCollided');
  socket.off('playerWon');

  // Set up countdown listener FIRST, before any other listeners
  // This ensures we catch countdown events even if they arrive early
  
  socket.on('gameCountdown', (data) => {
    const countdown = data && data.countdown !== undefined ? data.countdown : (data || 0);
    if (DEBUG) console.log('Countdown received in game.js:', countdown, data);
    
    const countdownTimerBox = document.getElementById('countdownTimerBox');
    const countdownTimerNumber = document.getElementById('countdownTimerNumber');
    const countdownTimerLabel = document.getElementById('countdownTimerLabel');
    
    if (countdown > 0) {
      // Countdown is active - hide rules screen and show countdown
      hideRulesScreen();
      isCountdownActive = true;
      // Show countdown timer box instead of full overlay
      if (countdownTimerBox && countdownTimerNumber) {
        countdownTimerNumber.textContent = countdown;
        countdownTimerBox.style.display = 'flex';
        countdownTimerBox.classList.add('countdown-blinking');
        if (countdownTimerLabel) {
          countdownTimerLabel.textContent = 'Get Ready!';
        }
      }
    } else {
      // Countdown finished - allow game state updates
      isCountdownActive = false;
      // Hide countdown timer box when countdown reaches 0
      if (countdownTimerBox) {
        countdownTimerBox.style.display = 'none';
        countdownTimerBox.classList.remove('countdown-blinking');
        if (countdownTimerLabel) {
          countdownTimerLabel.textContent = 'Get Ready!';
        }
      }
      hideOverlay();
      
      // Show pause button when game starts (after countdown)
      const urlParams = new URLSearchParams(window.location.search);
      const roomCode = urlParams.get('room');
      const isSoloMode = !roomCode || roomCode.startsWith('SP');
      const canControlPause = window.isHost || isSoloMode;
      
      if (canControlPause) {
        const pauseButton = document.getElementById('pauseButton');
        if (pauseButton) {
          pauseButton.style.display = 'inline-block';
        }
        
      }
      
      // Show sound toggle button when game starts (after countdown)
      const soundToggleButton = document.getElementById('soundToggleButton');
      if (soundToggleButton) {
        soundToggleButton.style.display = 'flex';
      }
    }
  });

  // Handle player ready status updates (multiplayer)
  socket.on('playerReadyStatus', (data) => {
    console.log('playerReadyStatus received:', data);
    if (data && data.readyPlayers) {
      // Convert readyPlayers to strings for consistent comparison
      const readyPlayerIds = data.readyPlayers.map(id => String(id));
      
      // Update ready status for each player
      if (gameState && gameState.players) {
        Object.keys(gameState.players).forEach(playerId => {
          const playerIdStr = String(playerId);
          const isReady = readyPlayerIds.includes(playerIdStr);
          updatePlayerReadyStatus(playerIdStr, isReady);
        });
      } else {
        // GameState not available yet, but we can still update if readyStatusList exists
        // This might happen if ready status arrives before gameState is set
        const readyStatusList = document.getElementById('readyStatusList');
        if (readyStatusList) {
          const items = readyStatusList.querySelectorAll('.ready-status-item');
          items.forEach(item => {
            const playerId = String(item.dataset.playerId || '');
            if (playerId) {
              const isReady = readyPlayerIds.includes(playerId);
              const indicator = item.querySelector('.ready-indicator');
              if (indicator) {
                if (isReady) {
                  item.classList.add('ready');
                  indicator.classList.add('is-ready');
                  indicator.textContent = 'Ready ✓';
                } else {
                  item.classList.remove('ready');
                  indicator.classList.remove('is-ready');
                  indicator.textContent = 'Not Ready';
                }
              }
            }
          });
        } else {
          // If readyStatusList doesn't exist, try to create it
          console.log('playerReadyStatus: readyStatusList not found, calling updateReadyStatus');
          updateReadyStatus();
        }
      }
    }
  });

  // Handle all players ready (multiplayer countdown starts)
  socket.on('allPlayersReady', (data) => {
    console.log('All players ready event received');
    hideRulesScreen();
    // Countdown will start via gameCountdown event
  });

  // Handle pre-start (game state before countdown)
  socket.on('gamePreStart', (data) => {
    // Update currentPlayerId to match the socket ID from server
    if (data.playerId) {
      currentPlayerId = data.playerId;
    } else if (socket && socket.id) {
      // Fallback: use socket ID if playerId not provided
      currentPlayerId = socket.id;
    }
    
    // Update host status
    if (data.isHost !== undefined) {
      window.isHost = data.isHost;
    }
    
    // Clear any pending game state from sessionStorage since we got it via socket
    sessionStorage.removeItem('pendingGameState');
    
    // Update room code if provided
    if (data.roomCode) {
      currentRoomCode = data.roomCode;
    }
    
    if (data.gameState) {
      gameState = data.gameState;
      applyGridConfig(gameState);
      window.gameState = gameState; // Update global reference for menu.js
      window.currentPlayerId = data.playerId || currentPlayerId; // Update global reference for menu.js
      currentPlayerId = data.playerId || currentPlayerId;
      previousSnakePositions.clear();
      previousFoodPositions.clear();
      lastUpdateTime = performance.now();
      
      // Remove loading message immediately
      const loadingMsg = document.querySelector('.loading-message');
      if (loadingMsg) {
        loadingMsg.remove();
      }
      
      // Don't call renderGame() here - startGameLoop() handles rendering
      // Just initialize board if needed
      if (!gameBoard || cells.length === 0) {
        initializeGameBoard();
      }
    } else {
      console.error('gamePreStart event received but no gameState!');
    }
  });

  socket.on('gameStarted', (data) => {
    // Dev logging
    if (typeof window !== 'undefined' && window.devLog) {
      window.devLog.log('gameStarted event received:', {
        roomCode: data.roomCode,
        playerId: data.playerId,
        gameMode: data.gameMode,
        hasGameState: !!data.gameState
      });
    }
    
    // Don't hide overlay yet - countdown will happen on game board after redirect
    // hideOverlay();
    
    // Reset game ended flag for new game
    gameEndedShown = false;
    
    // Update room code if provided
    if (data.roomCode) {
      currentRoomCode = data.roomCode;
    }
    
    // Store game mode
    if (data.gameMode) {
      currentGameMode = data.gameMode;
      if (typeof window !== 'undefined' && window.devLog) {
        window.devLog.log('Game mode set to:', currentGameMode);
      }
    }
    
    if (data.gameState) {
      const oldPlayerId = currentPlayerId;
      const newPlayerId = data.playerId || currentPlayerId;
      const playerPositions = {};
      Object.keys(data.gameState.players || {}).forEach(pid => {
        const p = data.gameState.players[pid];
        if (p && p.snake && p.snake.length > 0) {
          playerPositions[pid] = {x: p.snake[0].x, y: p.snake[0].y, type: p.type, isAlive: p.isAlive};
        }
      });
      
      gameState = data.gameState;
      applyGridConfig(gameState);
      window.gameState = gameState; // Update global reference for menu.js
      window.currentPlayerId = data.playerId || currentPlayerId; // Update global reference for menu.js
      currentPlayerId = data.playerId || currentPlayerId;
      previousSnakePositions.clear();
      previousFoodPositions.clear();
      lastUpdateTime = performance.now();
      
      // Remove loading message immediately
      const loadingMsg = document.querySelector('.loading-message');
      if (loadingMsg) {
        loadingMsg.remove();
      }
      
      // Initialize game board immediately if not already done
      if (!gameBoard || cells.length === 0) {
        initializeGameBoard();
      }
       // Update wall mode indicator after board is initialized
       setTimeout(() => updateWallModeIndicator(), 0);
      
      
      // startGameLoop() will handle rendering, don't call renderGame() here
      // Just ensure the loop is started if not already running
      if (!animationFrameId) {
        startGameLoop();
      }
      
      // Show rules screen before countdown starts (for all game modes including single-player)
      // Use setTimeout to ensure DOM is fully ready (fixes hard refresh issue)
      setTimeout(() => showRulesScreen(currentGameMode), 100);
      
      // Show leave button only in multiplayer mode
      const leaveGameButton = document.getElementById('leaveGameButton');
      if (leaveGameButton) {
        if (currentGameMode === 'multi-player') {
          leaveGameButton.style.display = 'block';
        } else {
          leaveGameButton.style.display = 'none';
        }
      }
      
      // Show sound toggle button when game starts
      setupSoundToggle();
      
      // Play game start sound after rendering
      if (typeof playGameStartSound === 'function') {
        playGameStartSound();
      }
    } else {
      console.error('gameStarted event received but no gameState!');
    }
  });

  // Track inactivity warning state
  let lastInactivityWarningState = false;

  socket.on('gameStateUpdate', (data) => {
    if (!data || !data.gameState) {
      console.error('Invalid gameStateUpdate received:', data);
      return;
    }
    
    // Add timestamp to track update delay for lag handling
    const updateTimestamp = performance.now();
    const timeSinceLastUpdate = lastUpdateTime > 0 ? updateTimestamp - lastUpdateTime : 0;
    
    // For laggy connections, log warning if gap is too large (helps with debugging)
    // Still process the update to prevent game from appearing frozen
    if (timeSinceLastUpdate > 200) { // More than 200ms since last update
      if (DEBUG) {
        console.warn('Large gap between updates detected:', Math.round(timeSinceLastUpdate), 'ms - possible network lag');
      }
    }
    
    // Store previous gameState for event detection before updating
    const previousGameStateForEvents = gameState;
    
    // Store previous positions before updating (lightweight, only positions)
    previousSnakePositions.clear();
    previousFoodPositions.clear();
    
    if (gameState) {
      // Store previous snake positions
      Object.values(gameState.players).forEach(player => {
        if (player && player.isAlive && player.snake) {
          const positions = new Set();
          player.snake.forEach(segment => {
            if (segment && typeof segment.x === 'number' && typeof segment.y === 'number') {
              positions.add(`${segment.x},${segment.y}`);
            }
          });
          previousSnakePositions.set(player.id, positions);
        }
      });
      
      // Store previous food positions
      if (gameState.food && Array.isArray(gameState.food)) {
        gameState.food.forEach(food => {
          if (food && typeof food.x === 'number' && typeof food.y === 'number') {
            previousFoodPositions.add(`${food.x},${food.y}`);
          }
        });
      }
    }
    
    // Preserve local pause state if pause was initiated locally and incoming state says unpaused
    // This prevents server updates from overwriting a local pause
    const wasLocallyPaused = gameState?._pauseInitiatedLocally && gameState?.isPaused;
    const incomingIsPaused = data.gameState.isPaused;
    
    gameState = data.gameState;
    applyGridConfig(gameState);
    
    // Update wall mode indicator after gameState is updated
    updateWallModeIndicator();
    

    // If we had a local pause and incoming state says unpaused, preserve the pause
    if (wasLocallyPaused && !incomingIsPaused) {
      gameState.isPaused = true;
      gameState._pauseInitiatedLocally = true;
    } else if (incomingIsPaused) {
      // Server confirms pause, clear local flag
      gameState._pauseInitiatedLocally = false;
    }
    
    window.gameState = gameState; // Update global reference for menu.js
    lastUpdateTime = updateTimestamp; // Update with current timestamp for lag tracking
    
    // Detect changes for sound effects (using previous state)
    if (previousGameStateForEvents) {
      detectGameEvents(previousGameStateForEvents, gameState);
    }
    
    // Check if inactivity warning was cleared (player moved)
    if (gameState && gameState.inactivityWarnings && currentPlayerId) {
      const hasWarning = gameState.inactivityWarnings[currentPlayerId] === true;
      const overlay = document.getElementById('gameOverlay');
      const overlayTitle = document.getElementById('overlayTitle');
      
      // If warning was cleared (was true, now false/undefined), hide overlay
      if (lastInactivityWarningState && !hasWarning && overlay && overlay.style.display !== 'none') {
        if (overlayTitle && overlayTitle.textContent.includes('Inactivity Warning')) {
          hideOverlay();
          // Reset pointer events
          overlay.style.pointerEvents = '';
          const overlayContent = overlay.querySelector('.overlay-content');
          if (overlayContent) {
            overlayContent.style.pointerEvents = '';
          }
        }
      }
      
      // Update last state
      lastInactivityWarningState = hasWarning;
    } else if (lastInactivityWarningState) {
      // If inactivityWarnings doesn't exist or playerId not found, clear state
      lastInactivityWarningState = false;
    }
    
    // Server is the ONLY authority for game end - don't check winner here
    // Game over will be handled by 'gameEnded' socket event only
  });

  socket.on('inactivityWarning', (data) => {
    // Show warning to player about inactivity (multiplayer only)
    if (data && data.message) {
      // Show persistent warning overlay (non-blocking - allows input to pass through)
      const overlay = document.getElementById('gameOverlay');
      if (overlay) {
        // Make overlay non-blocking so player can still press keys
        overlay.style.pointerEvents = 'none';
        const overlayContent = overlay.querySelector('.overlay-content');
        if (overlayContent) {
          overlayContent.style.pointerEvents = 'auto'; // Content is still clickable
        }
      }
      showOverlay('⚠️ Inactivity Warning', data.message);
      lastInactivityWarningState = true; // Track that warning is active
      // Auto-hide after 10 seconds, but player can dismiss it
      setTimeout(() => {
        const overlay = document.getElementById('gameOverlay');
        if (overlay && overlay.style.display !== 'none') {
          // Only hide if it's still showing the inactivity warning
          const overlayTitle = document.getElementById('overlayTitle');
          if (overlayTitle && overlayTitle.textContent.includes('Inactivity Warning')) {
            hideOverlay();
            lastInactivityWarningState = false;
            // Reset pointer events
            overlay.style.pointerEvents = '';
            const overlayContent = overlay.querySelector('.overlay-content');
            if (overlayContent) {
              overlayContent.style.pointerEvents = '';
            }
          }
        }
      }, 10000);
    }
  });

  // Handle error events (including inactive kick)
  socket.on('error', (data) => {
    if (data && data.message) {
      // Check if this is an inactive kick
      if (data.message.includes('kicked out for being inactive') || 
          data.message.includes('inactive') || 
          (data.reason === 'inactive' || data.kicked === true)) {
        // Mark player as kicked
        playerKicked = true;
        
        // Stop game rendering
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
        
        // Show overlay with Play Again button
        showOverlayWithPlayAgain(
          '⚠️ You Were Kicked',
          'You were kicked out for being inactive for 60+ seconds.',
          () => {
            window.location.href = '/';
          }
        );
        
        // Mark game as ended to prevent further updates
        gameEndedShown = true;
        return;
      }
      
      // For other errors, just show notification
      if (typeof showNotification === 'function') {
        showNotification(data.message, 'error');
      } else {
        showOverlay('Error', data.message);
      }
    }
  });

  // Handle playerKicked event (specific event for kicks)
  socket.on('playerKicked', (data) => {
    if (data && (data.reason === 'inactive' || data.message)) {
      // Mark player as kicked
      playerKicked = true;
      
      // Stop game rendering
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      
      // Show overlay with Play Again button
      showOverlayWithPlayAgain(
        '⚠️ You Were Kicked',
        data.message || 'You were kicked out for being inactive for 60+ seconds.',
        () => {
          window.location.href = '/';
        }
      );
      
      // Mark game as ended to prevent further updates
      gameEndedShown = true;
    }
  });

  socket.on('gamePaused', (data) => {
    // Update gameState
    if (gameState) {
      gameState.isPaused = true;
      window.gameState = gameState;
    }
    
    // Show notification instead of overlay so countdown timer remains visible
    const pauseMessage = data.pausedBy ? `${data.pausedBy} paused the game` : 'Game paused';
    if (typeof showNotification === 'function') {
      showNotification(pauseMessage);
    }
    // Menu is already shown by menu.js when game is paused, so we don't need to show overlay
  });

  socket.on('resumeCountdown', (data) => {
    const countdown = data && data.countdown !== undefined ? data.countdown : (data || 0);
    const resumedBy = data && data.resumedBy ? data.resumedBy : '';
    
    const countdownTimerBox = document.getElementById('countdownTimerBox');
    const countdownTimerNumber = document.getElementById('countdownTimerNumber');
    const countdownTimerLabel = document.getElementById('countdownTimerLabel');
    
    if (countdown > 0) {
      // Resume countdown is active - show countdown
      if (countdownTimerBox && countdownTimerNumber) {
        countdownTimerNumber.textContent = countdown;
        countdownTimerBox.style.display = 'flex';
        countdownTimerBox.classList.add('countdown-blinking');
        if (countdownTimerLabel) {
          countdownTimerLabel.textContent = `Resuming in ${countdown}...`;
        }
      }
    } else {
      // Resume countdown finished
      if (countdownTimerBox) {
        countdownTimerBox.style.display = 'none';
        countdownTimerBox.classList.remove('countdown-blinking');
        if (countdownTimerLabel) {
          countdownTimerLabel.textContent = 'Get Ready!';
        }
      }
    }
  });

  socket.on('gameResumed', (data) => {
    // Update gameState
    if (gameState) {
      gameState.isPaused = false;
      gameState._pauseInitiatedLocally = false; // Clear local pause flag
      window.gameState = gameState;
    }
    
    // Update HUD button visibility
    
    // Hide countdown timer box
    const countdownTimerBox = document.getElementById('countdownTimerBox');
    if (countdownTimerBox) {
      countdownTimerBox.style.display = 'none';
      countdownTimerBox.classList.remove('countdown-blinking');
    }
    
    hideOverlay();
  });

  // Handle player collision notifications
  socket.on('playerCollided', (data) => {
    if (data && data.playerName) {
      const message = `${data.playerName} collided!`;
      if (typeof showNotification === 'function') {
        showNotification(message);
      } else {
        showOverlay('Collision', message);
        setTimeout(() => {
          hideOverlay();
        }, 2000);
      }
    }
  });

  // Handle winner announcement
  socket.on('playerWon', (data) => {
    if (data && data.playerName) {
      const message = `${data.playerName} won the game!`;
      if (typeof showNotification === 'function') {
        showNotification(message, 'success');
      } else {
        showOverlay('Winner', message);
        // Don't auto-hide for winner announcement - let game over screen handle it
      }
    }
  });

  socket.on('playerQuit', (data) => {
    // Show notification that a player quit
    if (data.playerName) {
      // Show overlay for host quit
      if (data.players && data.players.length > 0 && data.players.some(p => p.isHost)) {
        const newHost = data.players.find(p => p.isHost);
        showOverlay('Host Left', `${data.playerName} (host) left. ${newHost ? newHost.name + ' is now the host.' : ''}`);
      } else {
        // Show notification only
        showNotification(`${data.playerName} quit the game`);
      }
    }
  });

  socket.on('gameQuit', (data) => {
    showOverlay('Game Quit', `${data.quitBy} quit the game`, () => {
      window.location.href = '/';
    });
  });

  socket.on('gameEnded', (data) => {
    // Dev logging
    if (typeof window !== 'undefined' && window.devLog) {
      window.devLog.log('gameEnded event received:', {
        winner: data.winner,
        gameMode: data.gameMode,
        currentGameMode: currentGameMode,
        hasGameState: !!data.gameState
      });
    }
    
    // Prevent duplicate Game Over overlays
    if (gameEndedShown) {
      if (typeof window !== 'undefined' && window.devLog) {
        window.devLog.warn('gameEnded already shown, ignoring duplicate event');
      }
      return;
    }
    gameEndedShown = true;
    
    // Update gameState if provided
    if (data.gameState) {
      gameState = data.gameState;
      applyGridConfig(gameState);
      window.gameState = gameState;
      updateWallModeIndicator();
    }
    
    // Stop rendering when game ends
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    
    // Check if this is a single-player game by checking gameMode (from event or stored)
    const isSinglePlayer = (data.gameMode === 'single-player') || (currentGameMode === 'single-player');
    
    // Also check localStorage for single-player game data
    const storedGameData = localStorage.getItem('singlePlayerGameData');
    const hasStoredGameData = storedGameData !== null;
    
    // Update currentGameMode if provided in event
    if (data.gameMode) {
      currentGameMode = data.gameMode;
    }
    
    if (typeof window !== 'undefined' && window.devLog) {
      window.devLog.log('Game end detection:', {
        isSinglePlayer: isSinglePlayer,
        hasStoredGameData: hasStoredGameData,
        gameModeFromEvent: data.gameMode,
        currentGameMode: currentGameMode
      });
    }
    
    // Build player status message with HTML formatting
    let playerStatusHTML = '';
    if (data.alivePlayers && data.alivePlayers.length > 0) {
      playerStatusHTML += '<div style="margin-top: 15px;"><strong style="color: #4CAF50;">Active:</strong><ul style="margin: 5px 0; padding-left: 20px;">';
      data.alivePlayers.forEach(player => {
        const playerType = player.type === 'npc' ? 'Bot' : 'Player';
        playerStatusHTML += `<li style="margin: 3px 0;">${player.name} (${playerType}) - Score: ${player.score}</li>`;
      });
      playerStatusHTML += '</ul></div>';
    }
    if (data.deadPlayers && data.deadPlayers.length > 0) {
      playerStatusHTML += '<div style="margin-top: 15px;"><strong style="color: #f44336;">Collided:</strong><ul style="margin: 5px 0; padding-left: 20px;">';
      data.deadPlayers.forEach(player => {
        const playerType = player.type === 'npc' ? 'Bot' : 'Player';
        playerStatusHTML += `<li style="margin: 3px 0;">${player.name} (${playerType}) - Score: ${player.score}</li>`;
      });
      playerStatusHTML += '</ul></div>';
    }
    
    if (data.winner) {
      const winnerMessage = `Winner: ${data.winner.name} (Score: ${data.winner.score})${playerStatusHTML}`;
      if (isSinglePlayer) {
        // Single-player mode - show Play Again button
        showOverlayWithPlayAgain('Game Over!', winnerMessage, () => {
          window.location.href = '/';
        });
      } else {
        // Multi-player mode - show OK button only
        showOverlay('Game Over!', winnerMessage, () => {
          window.location.href = '/';
        });
      }
    } else {
      const endMessage = (data.reason || 'Game ended') + playerStatusHTML;
      if (isSinglePlayer) {
        // Single-player mode - show Play Again button
        showOverlayWithPlayAgain('Game Over', endMessage, () => {
          window.location.href = '/';
        });
      } else {
        // Multi-player mode - show OK button only
        showOverlay('Game Over', endMessage, () => {
          window.location.href = '/';
        });
      }
    }
  });


  socket.on('playerLeft', (data) => {
    // Show notification
    const reason = data.reason || 'left';
    let title = 'Player Left';
    let message = '';
    
    if (reason === 'disconnected') {
      title = 'Player Disconnected';
      message = `${data.playerName} disconnected (marked as collided)`;
    } else if (reason === 'quit') {
      title = 'Player Quit';
      message = `${data.playerName} quit the game`;
    } else if (reason === 'inactive') {
      title = '⚠️ Player Kicked';
      message = `${data.playerName} was kicked out for being inactive (60+ seconds)`;
    } else {
      message = `${data.playerName} left the game`;
    }
    
    // Add host info if applicable
    if (data.wasHost) {
      message += ' (was host)';
      // If host left, show host transfer info
      if (data.players && data.players.length > 0) {
        const newHost = data.players.find(p => p.isHost);
        if (newHost) {
          message += `. ${newHost.name} is now the host.`;
        }
      }
    }
    
    if (typeof window !== 'undefined' && window.devLog) {
      window.devLog.log('Player left event:', { playerName: data.playerName, reason, wasHost: data.wasHost });
    }
    
    // Show notification - use a more persistent approach
    // First try showNotification if available (less intrusive)
    if (typeof showNotification === 'function') {
      showNotification(message);
    }
    
    // Also show overlay for important cases (inactive, host left)
    if (reason === 'inactive' || data.wasHost) {
      showOverlay(title, message);
      
      // Auto-hide after 6 seconds (longer for important notifications)
      setTimeout(() => {
        // Only hide if it's still showing the playerLeft message
        const overlay = document.getElementById('gameOverlay');
        const overlayTitle = document.getElementById('overlayTitle');
        if (overlay && overlayTitle && overlayTitle.textContent === title) {
          hideOverlay();
        }
      }, 6000);
    } else {
      // For less critical cases, just show notification
      // But still show overlay briefly
      showOverlay(title, message);
      setTimeout(() => {
        const overlay = document.getElementById('gameOverlay');
        const overlayTitle = document.getElementById('overlayTitle');
        if (overlay && overlayTitle && overlayTitle.textContent === title) {
          hideOverlay();
        }
      }, 4000);
    }
    
    // Don't mutate gameState - server will send updated state via gameStateUpdate
    // Just show notification
    if (gameState && data.playerName) {
      // Wait for server to send updated gameState via gameStateUpdate
      // Don't mutate state or force render here
    }
  });
  
  // Listen for hostChanged event to update HUD pause button and notify new host
  if (typeof socket !== 'undefined') {
    socket.on('hostChanged', (data) => {
      const wasHost = window.isHost;
      window.isHost = (data.newHostId === window.currentPlayerId);
      
      // Update gameState to reflect new host
      if (gameState && gameState.players) {
        // Clear all host flags first
        Object.values(gameState.players).forEach(p => {
          p.isHost = false;
        });
        // Set new host
        if (gameState.players[data.newHostId]) {
          gameState.players[data.newHostId].isHost = true;
        }
        // Force scoreboard update by resetting lastScores
        lastScores = null; // Reset to force re-render
        // Immediately update UI to show new host icon
        if (typeof updateUI === 'function') {
          updateUI();
        }
      }
      
      // Update HUD pause button visibility
      if (window.isHost) {
        showOverlay('You are now the host', 'You can now pause/resume the game for everyone.');
      }
      // Show notification for all
      if (typeof showNotification === 'function') {
        showNotification(`New host: ${data.newHostName}`);
      }
    });
  }
}

function startGameLoop() {
  function render() {
    // Stop rendering if player was kicked
    if (playerKicked) {
      return;
    }
    
    const now = performance.now();
    
    // Calculate FPS
    fpsFrames++;
    if (now - fpsLastTime >= 1000) {
      fps = fpsFrames;
      fpsFrames = 0;
      fpsLastTime = now;
      const fpsCounter = document.getElementById('fpsCounter');
      if (fpsCounter) {
        fpsCounter.textContent = `FPS: ${fps}`;
      }
    }

    if (gameState) {
      // Remove loading message if it exists
      const loadingMsg = document.querySelector('.loading-message');
      if (loadingMsg) {
        loadingMsg.remove();
      }
      // Only render if game is not paused AND countdown is not active - when paused or during countdown, snakes should not move
      if (!gameState.isPaused && !isCountdownActive) {
        renderGame();
      }
      updateUI();
    } else {
      // Show loading if no game state
      if (!document.querySelector('.loading-message')) {
        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'loading-message';
        loadingMsg.textContent = 'Waiting for game state...';
        loadingMsg.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px; z-index: 1000; background: rgba(0,0,0,0.8); padding: 20px; border-radius: 10px;';
        const container = gameBoard ? gameBoard.parentElement : document.body;
        if (container) {
          container.style.position = 'relative';
          container.appendChild(loadingMsg);
        }
      }
    }

    animationFrameId = requestAnimationFrame(render);
  }

  render();
}

function detectGameEvents(oldState, newState) {
  if (!oldState || !newState) return;

  // Detect food eaten (food count decreased or player score increased)
  Object.keys(newState.players).forEach(playerId => {
    const oldPlayer = oldState.players[playerId];
    const newPlayer = newState.players[playerId];
        
    if (oldPlayer && newPlayer && newPlayer.score > oldPlayer.score) {
      // Player ate food
      if (typeof playFoodEatenSound === 'function') {
        playFoodEatenSound();
      }
    }

    // Detect player death
    if (oldPlayer && oldPlayer.isAlive && !newPlayer.isAlive) {
      if (typeof playPlayerDeathSound === 'function') {
        playPlayerDeathSound();
      }
    }
  });
}

function renderGame() {
  if (!gameState) {
    // Show loading message if no game state yet
    if (!document.querySelector('.loading-message')) {
      const loadingMsg = document.createElement('div');
      loadingMsg.className = 'loading-message';
      loadingMsg.textContent = 'Waiting for game to start...';
      loadingMsg.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px; z-index: 1000;';
      const container = gameBoard.parentElement;
      if (container) {
        container.style.position = 'relative';
        container.appendChild(loadingMsg);
      }
    }
    return;
  }
  
  // Remove loading message once game state is received
  const loadingMsg = document.querySelector('.loading-message');
  if (loadingMsg) {
    loadingMsg.remove();
  }


  // Track which cells need updates (from previous and current positions)
  const cellsToUpdate = new Set();

  // Add previous positions to update set
  previousSnakePositions.forEach((positions) => {
    positions.forEach(posStr => {
      const [x, y] = posStr.split(',').map(Number);
      const index = y * GRID_WIDTH + x;
      if (index >= 0 && index < cells.length) {
        cellsToUpdate.add(index);
      }
    });
  });
  
  previousFoodPositions.forEach(posStr => {
    const [x, y] = posStr.split(',').map(Number);
    const index = y * GRID_WIDTH + x;
    if (index >= 0 && index < cells.length) {
      cellsToUpdate.add(index);
    }
  });

  // Precompute position map for O(1) lookup (O(n) instead of O(n³))
  const positionMap = new Map(); // "x,y" -> { type: 'snake'|'food'|'powerup', player, segmentIndex, powerup }
  
  // Build position map once
  Object.values(gameState.players).forEach(player => {
    if (player && player.isAlive && player.snake && Array.isArray(player.snake)) {
      player.snake.forEach((segment, segIndex) => {
        if (segment && typeof segment.x === 'number' && typeof segment.y === 'number') {
          const posKey = `${segment.x},${segment.y}`;
          const index = segment.y * GRID_WIDTH + segment.x;
          if (index >= 0 && index < cells.length) {
            cellsToUpdate.add(index);
            positionMap.set(posKey, {
              type: 'snake',
              player: player,
              segmentIndex: segIndex
            });
          }
        }
      });
    }
  });

  if (gameState.food && Array.isArray(gameState.food)) {
    gameState.food.forEach(food => {
      if (food && typeof food.x === 'number' && typeof food.y === 'number') {
        const posKey = `${food.x},${food.y}`;
        const index = food.y * GRID_WIDTH + food.x;
        if (index >= 0 && index < cells.length) {
          cellsToUpdate.add(index);
          if (!positionMap.has(posKey)) {
            positionMap.set(posKey, { type: 'food' });
          }
        }
      }
    });
  }

  if (gameState.powerups && Array.isArray(gameState.powerups)) {
    gameState.powerups.forEach(powerup => {
      if (powerup && typeof powerup.x === 'number' && typeof powerup.y === 'number') {
        const posKey = `${powerup.x},${powerup.y}`;
        const index = powerup.y * GRID_WIDTH + powerup.x;
        if (index >= 0 && index < cells.length) {
          cellsToUpdate.add(index);
          if (!positionMap.has(posKey)) {
            positionMap.set(posKey, { type: 'powerup', powerup: powerup });
          }
        }
      }
    });
  }

  // Batch update only changed cells using O(1) lookup
  cellsToUpdate.forEach(index => {
    const cell = cells[index];
    if (!cell) return;

    const x = index % GRID_WIDTH;
    const y = Math.floor(index / GRID_WIDTH);
    const posKey = `${x},${y}`;
    
    // Reset cell
    cell.className = 'cell';
    cell.style.backgroundColor = '';
    
    // O(1) lookup from position map
    const entity = positionMap.get(posKey);
    
    if (entity) {
      if (entity.type === 'snake') {
        const player = entity.player;
        if (entity.segmentIndex === 0) {
          cell.classList.add('snake-head');
        } else {
          cell.classList.add('snake-body');
        }
        cell.style.backgroundColor = player.color || '#FF6B6B';
        cell.style.boxShadow = '';
        
        // Show shield effect if active
        if (player.activePowerups && player.activePowerups.shield && player.activePowerups.shield > Date.now()) {
          cell.style.boxShadow = '0 0 10px rgba(0, 206, 209, 0.8)';
        }
      } else if (entity.type === 'food') {
        cell.classList.add('food');
      } else if (entity.type === 'powerup') {
        cell.classList.add('powerup');
        cell.classList.add(`powerup-${entity.powerup.type}`);
        cell.style.backgroundColor = getPowerupColor(entity.powerup.type);
      }
    }
  });
}

function getPowerupColor(type) {
  const colors = {
    'speed_boost': '#FFD700',
    'shield': '#00CED1',
    'shrink': '#FF69B4',
    'slow_others': '#9370DB'
  };
  return colors[type] || '#FFFFFF';
}

function updateUI() {
  if (!gameState) return;

  // Update level display
  const levelDisplay = document.getElementById('levelDisplay');
  if (levelDisplay && gameState.level) {
    levelDisplay.textContent = gameState.level;
  }

  // Update timer (always update to ensure it shows)
  const timerDisplay = document.getElementById('timerDisplay');
  if (timerDisplay) {
    const timerValue = gameState.timer !== undefined ? gameState.timer : 0;
    // Format timer as HH:MM:SS
    const hours = Math.floor(timerValue / 3600);
    const minutes = Math.floor((timerValue % 3600) / 60);
    const seconds = timerValue % 60;
    const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    timerDisplay.textContent = formattedTime;
  } else {
  }

  // Render active power-ups indicators
  if (typeof renderActivePowerups === 'function') {
    renderActivePowerups(gameState, currentPlayerId);
  }

  // Update scores (only if changed)
  const players = Object.values(gameState.players)
    .sort((a, b) => b.score - a.score);

  let scoresChanged = false;
  players.forEach(player => {
    const prevScore = previousScores[player.id];
    // Check if score, isAlive, or isHost changed
    const scoreChanged = prevScore === undefined || prevScore.score !== player.score;
    const aliveChanged = prevScore === undefined || prevScore.isAlive !== player.isAlive;
    const hostChanged = prevScore === undefined || prevScore.isHost !== player.isHost;
    
    if (scoreChanged || aliveChanged || hostChanged) {
      scoresChanged = true;
      previousScores[player.id] = {
        score: player.score,
        isAlive: player.isAlive,
        isHost: player.isHost || false // Store host status
      };
    }
  });

  if (scoresChanged) {
    const scoresList = document.getElementById('scoresList');
    scoresList.innerHTML = '';

    players.forEach(player => {
      const scoreDiv = document.createElement('div');
      scoreDiv.className = 'score-item';
      if (player.id === currentPlayerId) {
        scoreDiv.classList.add('current-player-score');
      }
      const playerType = player.type === 'npc' ? 'Bot' : 'Player';
      const colorBox = `<span class="score-color-box" style="background-color: ${player.color || '#FF6B6B'}; border: 1px solid rgba(0,0,0,0.2);"></span>`;
      // Show crown icon for host in multiplayer mode
      const hostIcon = (currentGameMode === 'multi-player' && player.isHost) ? '👑 ' : '';
      scoreDiv.innerHTML = `
        ${colorBox}
        <span class="player-name">${hostIcon}${player.name} ${player.id === currentPlayerId ? '(You)' : ''} (${playerType})</span>
        <span class="player-score">${player.score}</span>
        ${!player.isAlive ? '<span class="player-status">(Collided)</span>' : ''}
      `;
      scoresList.appendChild(scoreDiv);
    });
  }
}

function showOverlay(title, message, onClose = null, isCountdown = false) {
  const overlay = document.getElementById('gameOverlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayMessage = document.getElementById('overlayMessage');
  
  
  if (!overlay || !overlayTitle || !overlayMessage) {
    console.error('Overlay elements not found!', { overlay: !!overlay, overlayTitle: !!overlayTitle, overlayMessage: !!overlayMessage });
    return;
  }
  
  overlayTitle.textContent = title || '';
  // Check if message contains HTML
  if (message && message.includes('<')) {
    overlayMessage.innerHTML = message || '';
  } else {
    overlayMessage.textContent = message || '';
  }
  
  // Style countdown overlay differently with blinking animation
  if (isCountdown) {
    overlayTitle.style.fontSize = '3em';
    overlayTitle.style.fontWeight = 'bold';
    overlayMessage.style.fontSize = '2em';
    overlayMessage.style.marginTop = '20px';
    // Add blinking animation class
    overlay.classList.add('countdown-blinking');
    overlayTitle.classList.add('countdown-blinking');
    overlayMessage.classList.add('countdown-blinking');
  } else {
    overlayTitle.style.fontSize = '';
    overlayTitle.style.fontWeight = '';
    overlayMessage.style.fontSize = '';
    overlayMessage.style.marginTop = '';
    // Remove blinking animation
    overlay.classList.remove('countdown-blinking');
    overlayTitle.classList.remove('countdown-blinking');
    overlayMessage.classList.remove('countdown-blinking');
  }
  
  const button = document.getElementById('overlayButton');
  const playAgainButton = document.getElementById('playAgainButton');
  
  // Hide Play Again button for regular overlay
  if (playAgainButton) {
    playAgainButton.style.display = 'none';
  }
  
  if (onClose) {
    if (button) {
      button.style.display = 'block';
      button.textContent = 'OK';
      button.onclick = onClose;
    }
  } else {
    if (button) {
      button.style.display = 'none';
    }
  }
  
  overlay.style.display = 'flex';
}

function showOverlayWithPlayAgain(title, message, onClose = null) {
  const overlay = document.getElementById('gameOverlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayMessage = document.getElementById('overlayMessage');
  
  if (!overlay || !overlayTitle || !overlayMessage) {
    console.error('Overlay elements not found!');
    return;
  }
  
  overlayTitle.textContent = title || '';
  // Check if message contains HTML
  if (message && message.includes('<')) {
    overlayMessage.innerHTML = message || '';
  } else {
    overlayMessage.textContent = message || '';
  }
  
  // Remove blinking animation styles
  overlay.classList.remove('countdown-blinking');
  overlayTitle.classList.remove('countdown-blinking');
  overlayMessage.classList.remove('countdown-blinking');
  overlayTitle.style.fontSize = '';
  overlayTitle.style.fontWeight = '';
  overlayMessage.style.fontSize = '';
  overlayMessage.style.marginTop = '';
  
  const button = document.getElementById('overlayButton');
  const playAgainButton = document.getElementById('playAgainButton');
  
  // Show both buttons
  if (button) {
    button.style.display = 'block';
    button.textContent = 'Back to Menu';
    button.onclick = onClose || (() => {
      window.location.href = '/';
    });
  }
  
  if (playAgainButton) {
    playAgainButton.style.display = 'block';
    playAgainButton.onclick = () => {
      // Navigate to game menu (home page) instead of restarting same game
      window.location.href = '/';
    };
  }
  
  overlay.style.display = 'flex';
}

function playAgainSinglePlayer() {
  // Dev logging
  if (typeof window !== 'undefined' && window.devLog) {
    window.devLog.log('Play Again clicked - starting restart process');
  }
  
  // Get stored game initialization data from localStorage
  const gameDataStr = localStorage.getItem('singlePlayerGameData');
  if (!gameDataStr) {
    const errorMsg = 'No single-player game data found in localStorage';
    console.error(errorMsg);
    if (typeof window !== 'undefined' && window.devLog) {
      window.devLog.error(errorMsg);
    }
    window.location.href = '/';
    return;
  }
  
  try {
    const gameData = JSON.parse(gameDataStr);
    
    if (typeof window !== 'undefined' && window.devLog) {
      window.devLog.log('Retrieved game data from localStorage:', gameData);
    }
    
    // Validate game data
    if (!gameData.playerName || !gameData.npcCount) {
      const errorMsg = 'Invalid game data: missing playerName or npcCount';
      console.error(errorMsg, gameData);
      if (typeof window !== 'undefined' && window.devLog) {
        window.devLog.error(errorMsg, gameData);
      }
      window.location.href = '/';
      return;
    }
    
    // Reset game ended flag
    gameEndedShown = false;
    
    // Clear current game state
    gameState = null;
    window.gameState = null;
    previousSnakePositions.clear();
    previousFoodPositions.clear();
    
    // Hide overlay
    hideOverlay();
    
    // Check if socket is available
    const socketToUse = (typeof window !== 'undefined' && window.socket) ? window.socket : socket;
    if (!socketToUse) {
      const errorMsg = 'Socket not available';
      console.error(errorMsg);
      if (typeof window !== 'undefined' && window.devLog) {
        window.devLog.error(errorMsg);
      }
      window.location.href = '/';
      return;
    }
    
    if (!socketToUse.connected) {
      const errorMsg = 'Socket not connected, connection state: ' + socketToUse.connected;
      console.error(errorMsg);
      if (typeof window !== 'undefined' && window.devLog) {
        window.devLog.error(errorMsg);
        window.devLog.log('Attempting to reconnect...');
      }
      
      // Try to reconnect
      if (socketToUse.connect) {
        socketToUse.connect();
      }
      
      // Wait a bit for connection
      setTimeout(() => {
        if (!socketToUse.connected) {
          console.error('Still not connected after retry');
          window.location.href = '/';
          return;
        }
        // Continue with restart after reconnection
        restartGameWithData(socketToUse, gameData);
      }, 1000);
      return;
    }
    
    // Socket is connected, proceed with restart
    restartGameWithData(socketToUse, gameData);
    
  } catch (e) {
    const errorMsg = 'Error parsing game data: ' + e.message;
    console.error(errorMsg, e);
    if (typeof window !== 'undefined' && window.devLog) {
      window.devLog.error(errorMsg, e);
    }
    window.location.href = '/';
  }
}

function restartGameWithData(socketToUse, gameData) {
  
  if (typeof window !== 'undefined' && window.devLog) {
    window.devLog.log('Restarting single-player game with data:', gameData);
    window.devLog.log('Socket connected:', socketToUse.connected);
    window.devLog.log('Socket ID:', socketToUse.id);
  }
  
  // Prepare game data for server (remove timestamp if present)
  const dataToSend = {
    playerName: gameData.playerName,
    npcCount: gameData.npcCount,
    controlScheme: gameData.controlScheme || 'wasd',
    playerToken: gameData.playerToken || (typeof getOrCreatePlayerToken === 'function' ? getOrCreatePlayerToken() : null),
    gameOptions: gameData.gameOptions || { wallMode: false }
  };
  
  if (typeof window !== 'undefined' && window.devLog) {
    window.devLog.log('Emitting startSinglePlayer with data:', dataToSend);
  }
  
  // Emit startSinglePlayer event with stored data
  socketToUse.emit('startSinglePlayer', dataToSend);
  
  // Set up listener for gameStarted event
  const gameStartedHandler = (data) => {
    if (typeof window !== 'undefined' && window.devLog) {
      window.devLog.log('gameStarted event received in Play Again handler:', data);
    }
    
    // Remove this one-time listener
    socketToUse.off('gameStarted', gameStartedHandler);
    
    // Reset game ended flag
    gameEndedShown = false;
    
    // Update game mode
    if (data.gameMode) {
      currentGameMode = data.gameMode;
    }
    
    // Update room code if provided
    if (data.roomCode) {
      currentRoomCode = data.roomCode;
    }
    
    if (data.gameState) {
      const oldPlayerId = currentPlayerId;
      const newPlayerId = data.playerId || currentPlayerId;
      const playerPositions = {};
      Object.keys(data.gameState.players || {}).forEach(pid => {
        const p = data.gameState.players[pid];
        if (p && p.snake && p.snake.length > 0) {
          playerPositions[pid] = {x: p.snake[0].x, y: p.snake[0].y, type: p.type, isAlive: p.isAlive};
        }
      });
      
      gameState = data.gameState;
      applyGridConfig(gameState);
      window.gameState = gameState;
      currentPlayerId = data.playerId || currentPlayerId;
      window.currentPlayerId = currentPlayerId;
      previousSnakePositions.clear();
      previousFoodPositions.clear();
      lastUpdateTime = performance.now();
      updateWallModeIndicator();
      updateWallModeIndicator();
      
      if (typeof window !== 'undefined' && window.devLog) {
        window.devLog.log('Game state updated, restart successful');
      }
    }
  };
  
  // Listen for gameStarted event
  socketToUse.on('gameStarted', gameStartedHandler);
  
  // Fallback timeout - if gameStarted doesn't arrive, redirect
  setTimeout(() => {
    socketToUse.off('gameStarted', gameStartedHandler);
    if (!gameState) {
      const errorMsg = 'Game state not received after 3 seconds, redirecting to menu';
      console.error(errorMsg);
      if (typeof window !== 'undefined' && window.devLog) {
        window.devLog.error(errorMsg);
      }
      window.location.href = '/';
    }
  }, 3000);
}

// Rules screen functions
function showRulesScreen(gameMode) {
  const rulesOverlay = document.getElementById('rulesScreenOverlay');
  const readyButton = document.getElementById('readyButton');
  const readyStatusSection = document.getElementById('readyStatusSection');
  const powerupsRulesSection = document.getElementById('powerupsRulesSection');
  
  if (!rulesOverlay || !readyButton) {
    // Retry after a delay if elements don't exist yet (fixes hard refresh timing issue)
    setTimeout(() => {
      const retryRulesOverlay = document.getElementById('rulesScreenOverlay');
      const retryReadyButton = document.getElementById('readyButton');
      if (retryRulesOverlay && retryReadyButton) {
        showRulesScreen(gameMode);
      }
    }, 200);
    return;
  }
  
  // Show/hide powerups section based on feature flags
  if (powerupsRulesSection) {
    if (typeof featureFlags !== 'undefined' && featureFlags.powerups) {
      powerupsRulesSection.style.display = 'block';
    } else {
      powerupsRulesSection.style.display = 'none';
    }
  }
  
  // Show/hide ready status section for multiplayer
  if (readyStatusSection) {
    if (gameMode === 'multi-player') {
      readyStatusSection.style.display = 'block';
      // Wait a bit for DOM to be ready, then update ready status
      setTimeout(() => {
        updateReadyStatus();
      }, 50);
    } else {
      readyStatusSection.style.display = 'none'; // Hide for solo/single-player
    }
  }
  
  // Display game settings for all game modes
  displayGameSettings();
  
  
  // Enable ready button
  readyButton.disabled = false;
  readyButton.textContent = 'Ready';
  
  // Set up ready button click handler
  readyButton.onclick = () => {
    handleReadyClick(gameMode);
  };
  
  // Show rules overlay
  rulesOverlay.style.display = 'flex';
  
  // Force a reflow to ensure the overlay is displayed
  rulesOverlay.offsetHeight;
  
}

function hideRulesScreen() {
  const rulesOverlay = document.getElementById('rulesScreenOverlay');
  if (rulesOverlay) {
    rulesOverlay.style.display = 'none';
  }
}

function displayGameSettings() {
  const gameSettingsSection = document.getElementById('gameSettingsSection');
  const gameSettingsList = document.getElementById('gameSettingsList');
  
  if (!gameSettingsSection || !gameSettingsList || !gameState) {
    return;
  }
  
  // Clear previous settings
  gameSettingsList.innerHTML = '';
  
  const settings = [];
  
  // Strict Mode
  if (gameState.strictMode !== undefined) {
    settings.push({
      label: 'Strict Mode',
      value: gameState.strictMode ? 'ON ⚠️' : 'OFF'
    });
  }
  
  // Wall Mode
  if (gameState.wallMode !== undefined) {
    settings.push({
      label: 'Wall Mode',
      value: gameState.wallMode ? 'ON (No Wrapping)' : 'OFF (Wrapping)'
    });
  }
  
  // Time Limit
  if (gameState.timeLimit) {
    const minutes = gameState.timeLimit / 60000;
    settings.push({
      label: 'Time Limit',
      value: `${minutes} minute${minutes !== 1 ? 's' : ''}`
    });
  } else if (gameState.timeLimit !== undefined) {
    settings.push({
      label: 'Time Limit',
      value: 'None'
    });
  }
  
  // Power-ups
  if (gameState.enablePowerups !== undefined) {
    settings.push({
      label: 'Power-ups',
      value: gameState.enablePowerups ? 'Enabled' : 'Disabled'
    });
  }
  
  // Render settings
  if (settings.length > 0) {
    settings.forEach(setting => {
      const item = document.createElement('div');
      item.className = 'game-setting-item';
      item.innerHTML = `<strong>${setting.label}:</strong> ${setting.value}`;
      gameSettingsList.appendChild(item);
    });
    
    // Show the game settings section
    gameSettingsSection.style.display = 'block';
  }
}

function handleReadyClick(gameMode) {
  
  const readyButton = document.getElementById('readyButton');
  if (!readyButton || readyButton.disabled) {
    return;
  }
  
  if (gameMode === 'multi-player') {
    // Multiplayer: emit ready to server
    if (!socket || !socket.connected) {
      console.error('Socket not connected');
      readyButton.disabled = false;
      readyButton.textContent = 'Ready';
      return;
    }
    
    if (!currentRoomCode) {
      console.error('No room code available');
      readyButton.disabled = false;
      readyButton.textContent = 'Ready';
      return;
    }
    
    readyButton.disabled = true;
    readyButton.textContent = 'Waiting for others...';
    
    const emitData = {
      roomCode: currentRoomCode
    };
    
    
    console.log('Emitting playerReady:', { 
      roomCode: currentRoomCode, 
      socketId: socket.id,
      currentPlayerId: currentPlayerId,
      gameStatePlayers: gameState ? Object.keys(gameState.players) : null
    });
    
    socket.emit('playerReady', {
      ...emitData,
      currentPlayerId: currentPlayerId // Include currentPlayerId to help server find player
    });
    
    // Also update local ready status immediately (optimistic update)
    if (currentPlayerId) {
      updatePlayerReadyStatus(currentPlayerId, true);
    }
  } else {
    // Solo/Single-player: emit ready to server (server will start countdown)
    
    readyButton.disabled = true;
    readyButton.textContent = 'Starting...';
    
    // Don't hide rules screen yet - wait for countdown to start
    // The countdown will hide the rules screen
    
    // Request countdown start from server
    if (socket && socket.connected) {
      socket.emit('playerReady', {
        roomCode: currentRoomCode,
        currentPlayerId: currentPlayerId
      });
    } else {
      // Fallback: retry after a delay if socket not ready
      setTimeout(() => {
        if (socket && socket.connected) {
          socket.emit('playerReady', {
            roomCode: currentRoomCode,
            currentPlayerId: currentPlayerId
          });
        } else {
          // If socket still not ready, re-enable button
          readyButton.disabled = false;
          readyButton.textContent = 'Ready';
        }
      }, 100);
    }
  }
}

function updateReadyStatus() {
  const readyStatusList = document.getElementById('readyStatusList');
  if (!readyStatusList) return;
  
  // If gameState is not available yet, wait for it
  if (!gameState || !gameState.players) {
    console.log('updateReadyStatus: gameState not available yet, will retry');
    // Retry after a short delay
    setTimeout(() => {
      updateReadyStatus();
    }, 100);
    return;
  }
  
  readyStatusList.innerHTML = '';
  
  const players = Object.values(gameState.players);
  console.log('updateReadyStatus: Creating ready status list for players:', players.map(p => ({ id: p.id, name: p.name })));
  
  players.forEach(player => {
    const statusItem = document.createElement('div');
    statusItem.className = 'ready-status-item';
    // Store player ID as string for consistent comparison
    statusItem.dataset.playerId = String(player.id);
    
    const playerName = document.createElement('span');
    playerName.textContent = player.name + (String(player.id) === String(currentPlayerId) ? ' (You)' : '');
    
    const readyIndicator = document.createElement('span');
    readyIndicator.className = 'ready-indicator';
    readyIndicator.textContent = 'Not Ready';
    
    statusItem.appendChild(playerName);
    statusItem.appendChild(readyIndicator);
    readyStatusList.appendChild(statusItem);
  });
}

function updatePlayerReadyStatus(playerId, isReady) {
  const readyStatusList = document.getElementById('readyStatusList');
  if (!readyStatusList) {
    console.log('updatePlayerReadyStatus: readyStatusList not found');
    return;
  }
  
  // Convert playerId to string for consistent comparison
  const playerIdStr = String(playerId);
  
  const items = readyStatusList.querySelectorAll('.ready-status-item');
  let found = false;
  
  items.forEach(item => {
    const itemPlayerId = String(item.dataset.playerId || '');
    if (itemPlayerId === playerIdStr) {
      found = true;
      const indicator = item.querySelector('.ready-indicator');
      if (indicator) {
        if (isReady) {
          item.classList.add('ready');
          indicator.classList.add('is-ready');
          indicator.textContent = 'Ready ✓';
        } else {
          item.classList.remove('ready');
          indicator.classList.remove('is-ready');
          indicator.textContent = 'Not Ready';
        }
        console.log(`updatePlayerReadyStatus: Updated ${playerIdStr} to ${isReady ? 'Ready' : 'Not Ready'}`);
      }
    }
  });
  
  if (!found) {
    console.warn('updatePlayerReadyStatus: Player not found in ready status list:', playerIdStr, 'Available players:', Array.from(items).map(item => item.dataset.playerId));
    // If player not found, try to update the list
    updateReadyStatus();
  }
}

function hideOverlay() {
  const overlay = document.getElementById('gameOverlay');
  if (overlay) {
    overlay.classList.remove('countdown-blinking');
    const overlayTitle = document.getElementById('overlayTitle');
    const overlayMessage = document.getElementById('overlayMessage');
    if (overlayTitle) overlayTitle.classList.remove('countdown-blinking');
    if (overlayMessage) overlayMessage.classList.remove('countdown-blinking');
    overlay.style.display = 'none';
  }
}

// Helper function to send quitGame for solo/single-player modes
function quitGameOnNavigation() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room');
  
  // Check if this is a solo/single-player game (room code starts with 'SP')
  const isSoloOrSinglePlayer = !roomCode || roomCode.startsWith('SP');
  
  // Only quit if it's solo/single-player and we have an active game
  if (isSoloOrSinglePlayer && roomCode && gameState) {
    const socketToUse = (typeof window !== 'undefined' && window.socket) ? window.socket : socket;
    if (socketToUse && socketToUse.connected) {
      // Send quitGame event to end the game on server
      socketToUse.emit('quitGame', {
        roomCode: roomCode,
        leaveType: 'withParty' // Always end game for solo/single-player
      });
    }
  }
}

// Detect back button navigation
window.addEventListener('popstate', (event) => {
  quitGameOnNavigation();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  
  // Send quitGame for solo/single-player modes before page unloads
  quitGameOnNavigation();
});
