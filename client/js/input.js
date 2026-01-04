// Keyboard input handling
let lastDirection = null;
let keyState = {};

// Player's selected control scheme (wasd or arrows)
let playerControlScheme = 'wasd'; // Default to WASD

// Map key codes to directions based on selected control scheme
const KEY_TO_DIRECTION = {
  // WASD keys
  'KeyW': 'up',
  'KeyS': 'down',
  'KeyA': 'left',
  'KeyD': 'right',
  // Arrow keys
  'ArrowUp': 'up',
  'ArrowDown': 'down',
  'ArrowLeft': 'left',
  'ArrowRight': 'right'
};

// Opposite directions (prevent reversal)
const OPPOSITES = {
  'up': 'down',
  'down': 'up',
  'left': 'right',
  'right': 'left'
};

// Function to set player's control scheme
function setPlayerControlScheme(scheme) {
  if (scheme === 'wasd' || scheme === 'arrows') {
    playerControlScheme = scheme;
    localStorage.setItem('snakeGameControlScheme', scheme);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Get control scheme from URL first, then localStorage
  const urlParams = new URLSearchParams(window.location.search);
  const controlSchemeParam = urlParams.get('controls');
  
  if (controlSchemeParam && (controlSchemeParam === 'wasd' || controlSchemeParam === 'arrows')) {
    setPlayerControlScheme(controlSchemeParam);
  } else {
    // Try to get control scheme from localStorage
    const savedScheme = localStorage.getItem('snakeGameControlScheme');
    if (savedScheme) {
      setPlayerControlScheme(savedScheme);
    }
  }
  
  // Wait for socket to be initialized
  function waitForSocket() {
    if (typeof window.socket === 'undefined' || window.socket === null) {
      setTimeout(waitForSocket, 100);
      return;
    }
    
    setupInputHandlers();
  }
  
  waitForSocket();
});

function setupInputHandlers() {
  
  // Use keydown for immediate response
  document.addEventListener('keydown', (e) => {
    handleKeyDown(e);
  });

  document.addEventListener('keyup', (e) => {
    handleKeyUp(e);
  });

  // Prevent default behavior for game keys (but not when typing in input fields)
  document.addEventListener('keydown', (e) => {
    const key = e.code;
    
    // Don't prevent default if user is typing in an input field
    const activeElement = document.activeElement;
    const isTyping = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable ||
      activeElement.contentEditable === 'true'
    );
    
    if (isTyping) {
      return; // Allow normal typing behavior
    }
    
    // Check if key matches player's control scheme
    if (playerControlScheme === 'wasd' && (key === 'KeyW' || key === 'KeyS' || key === 'KeyA' || key === 'KeyD')) {
      e.preventDefault();
    } else if (playerControlScheme === 'arrows' && key.startsWith('Arrow')) {
      e.preventDefault();
    }
  });

  // Setup mobile touch controls
  setupMobileControls();
  
  // Setup landscape fullscreen controls
  setupLandscapeControls();
  
  // Setup landscape/fullscreen detection
  setupLandscapeFullscreenDetection();
}

function setupMobileControls() {
  const mobileControls = document.getElementById('mobileControls');
  if (!mobileControls) return;

  // Make controls draggable
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  const dragStart = (e) => {
    if (e.type === 'touchstart') {
      initialX = e.touches[0].clientX - xOffset;
      initialY = e.touches[0].clientY - yOffset;
    } else {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
    }

    if (e.target.classList.contains('arrow-btn')) {
      return; // Don't drag when clicking arrow buttons
    }

    if (mobileControls.contains(e.target)) {
      isDragging = true;
      mobileControls.classList.add('draggable');
    }
  };

  const drag = (e) => {
    if (!isDragging) return;

    e.preventDefault();

    if (e.type === 'touchmove') {
      currentX = e.touches[0].clientX - initialX;
      currentY = e.touches[0].clientY - initialY;
    } else {
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
    }

    xOffset = currentX;
    yOffset = currentY;

    mobileControls.style.transform = `translate(${currentX}px, ${currentY}px)`;
  };

  const dragEnd = () => {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
    mobileControls.classList.remove('draggable');
  };

  // Touch events
  mobileControls.addEventListener('touchstart', dragStart, { passive: false });
  mobileControls.addEventListener('touchmove', drag, { passive: false });
  mobileControls.addEventListener('touchend', dragEnd);

  // Mouse events (for testing on desktop)
  mobileControls.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);

  // Arrow button touch handlers
  const arrowButtons = mobileControls.querySelectorAll('.arrow-btn');
  arrowButtons.forEach(btn => {
    btn.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      const direction = btn.getAttribute('data-direction');
      sendInputToServer(direction);
      btn.classList.add('active');
    });

    btn.addEventListener('touchend', (e) => {
      e.stopPropagation();
      btn.classList.remove('active');
    });

    btn.addEventListener('touchcancel', () => {
      btn.classList.remove('active');
    });

    // Mouse events for testing
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const direction = btn.getAttribute('data-direction');
      sendInputToServer(direction);
    });
  });
}

function setupLandscapeControls() {
  const landscapeControls = document.getElementById('landscapeControls');
  if (!landscapeControls) return;

  const arrowButtons = landscapeControls.querySelectorAll('.arrow-btn-landscape');
  arrowButtons.forEach(btn => {
    btn.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      const direction = btn.getAttribute('data-direction');
      sendInputToServer(direction);
      btn.classList.add('active');
    });

    btn.addEventListener('touchend', (e) => {
      e.stopPropagation();
      btn.classList.remove('active');
    });

    btn.addEventListener('touchcancel', () => {
      btn.classList.remove('active');
    });

    // Mouse events for testing
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const direction = btn.getAttribute('data-direction');
      sendInputToServer(direction);
    });
  });
}

function setupLandscapeFullscreenDetection() {
  const checkLandscapeFullscreen = () => {
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    const isFullscreen = !!document.fullscreenElement || 
                        !!document.webkitFullscreenElement || 
                        !!document.mozFullScreenElement || 
                        !!document.msFullscreenElement;
    
    if (isLandscape && isFullscreen) {
      document.body.classList.add('landscape-fullscreen');
    } else {
      document.body.classList.remove('landscape-fullscreen');
    }
  };

  // Check on load
  checkLandscapeFullscreen();

  // Check on orientation change
  window.addEventListener('orientationchange', checkLandscapeFullscreen);
  
  // Check on resize
  window.addEventListener('resize', checkLandscapeFullscreen);

  // Check on fullscreen change
  document.addEventListener('fullscreenchange', checkLandscapeFullscreen);
  document.addEventListener('webkitfullscreenchange', checkLandscapeFullscreen);
  document.addEventListener('mozfullscreenchange', checkLandscapeFullscreen);
  document.addEventListener('MSFullscreenChange', checkLandscapeFullscreen);
}

function handleKeyDown(e) {
  const key = e.code;
  
  // Don't process game input if user is typing in an input field
  const activeElement = document.activeElement;
  const isTyping = activeElement && (
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA' ||
    activeElement.isContentEditable ||
    activeElement.contentEditable === 'true'
  );
  
  if (isTyping) {
    return; // User is typing, don't process as game input
  }
  
  // Check if key matches player's control scheme FIRST
  let direction = null;
  if (playerControlScheme === 'wasd') {
    // Only accept WASD keys
    if (key === 'KeyW' || key === 'KeyS' || key === 'KeyA' || key === 'KeyD') {
      direction = KEY_TO_DIRECTION[key];
    }
  } else if (playerControlScheme === 'arrows') {
    // Only accept Arrow keys
    if (key.startsWith('Arrow')) {
      direction = KEY_TO_DIRECTION[key];
    }
  }

  if (!direction) {
    return; // Not a game key for this player's control scheme
  }
  
  // Prevent opposite direction change (instant check)
  if (lastDirection && OPPOSITES[direction] === lastDirection) {
    return;
  }

  // Check if key is already pressed (prevents duplicate sends from key repeat)
  if (keyState[key]) {
    return;
  }

  // Check if game is paused BEFORE sending input
  const isPaused = typeof window !== 'undefined' && window.gameState ? window.gameState.isPaused : false;
  if (isPaused) {
    return; // Don't send input when paused
  }

  // Hide inactivity warning overlay immediately when player moves (before server response)
  const overlay = document.getElementById('gameOverlay');
  const overlayTitle = document.getElementById('overlayTitle');
  if (overlay && overlayTitle && overlayTitle.textContent.includes('Inactivity Warning')) {
    // Hide overlay immediately - player is active again
    overlay.style.display = 'none';
    // Reset pointer events
    overlay.style.pointerEvents = '';
    const overlayContent = overlay.querySelector('.overlay-content');
    if (overlayContent) {
      overlayContent.style.pointerEvents = '';
    }
    // Clear blinking animation classes
    overlay.classList.remove('countdown-blinking');
    if (overlayTitle) overlayTitle.classList.remove('countdown-blinking');
    const overlayMessage = document.getElementById('overlayMessage');
    if (overlayMessage) overlayMessage.classList.remove('countdown-blinking');
  }

  // Mark key as pressed and send input IMMEDIATELY - no throttle, no delay
  keyState[key] = true;
  sendInputToServer(direction);
  lastDirection = direction;
}

function handleKeyUp(e) {
  const key = e.code;
  // Check if key matches player's control scheme
  if (playerControlScheme === 'wasd' && (key === 'KeyW' || key === 'KeyS' || key === 'KeyA' || key === 'KeyD')) {
    keyState[key] = false;
  } else if (playerControlScheme === 'arrows' && key.startsWith('Arrow')) {
    keyState[key] = false;
  }
}

function sendInputToServer(direction) {
  const roomCode = typeof window !== 'undefined' && window.currentRoomCode
    ? window.currentRoomCode
    : new URLSearchParams(window.location.search).get('room');
  
  // Try to get socket from global scope (window.socket) or local scope
  const socketToUse = window.socket || socket;
  
  if (!socketToUse || !socketToUse.connected) {
    return;
  }

  const roomCodeParam = roomCode || new URLSearchParams(window.location.search).get('room');
  if (!roomCodeParam) {
    return;
  }
  
  // Send input immediately
  socketToUse.emit('playerInput', {
    roomCode: roomCodeParam,
    direction: direction
  });
}

// Reset input state (useful when game pauses)
function resetInputState() {
  keyState = {};
  lastDirection = null;
}
