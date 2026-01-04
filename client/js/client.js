// Socket.io client connection
let socket = null;
let featureFlags = {};

const PLAYER_TOKEN_KEY = 'snakeGamePlayerToken';

function getOrCreatePlayerToken() {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  let token = localStorage.getItem(PLAYER_TOKEN_KEY);
  if (!token) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      token = crypto.randomUUID();
    } else {
      token = `token-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    localStorage.setItem(PLAYER_TOKEN_KEY, token);
  }
  return token;
}

function normalizeServerUrl(url) {
  if (!url) return null;
  // Remove whitespace
  url = url.trim();
  // If URL doesn't start with http:// or https://, add http://
  if (url && !url.match(/^https?:\/\//i)) {
    url = 'http://' + url;
  }
  return url;
}

function getServerUrl() {
  const currentOrigin = window.location.origin;
  const isLocalhost = currentOrigin.includes('localhost') || currentOrigin.includes('127.0.0.1');
  
  // Check URL parameter first (e.g., ?server=http://192.168.1.100:3000)
  const urlParams = new URLSearchParams(window.location.search);
  const serverParam = urlParams.get('server');
  if (serverParam) {
    const normalizedUrl = normalizeServerUrl(serverParam);
    // Save normalized URL to localStorage
    localStorage.setItem('gameServerUrl', normalizedUrl);
    return normalizedUrl;
  }
  
  // Check localStorage
  const savedUrl = localStorage.getItem('gameServerUrl');
  if (savedUrl) {
    const normalizedUrl = normalizeServerUrl(savedUrl);
    
    // If on localhost, ignore saved URL that points to a different IP and use same origin instead
    if (isLocalhost) {
      try {
        const savedUrlObj = new URL(normalizedUrl);
        const currentHost = window.location.hostname;
        // If saved URL has a different hostname than current origin, use same origin instead
        if (savedUrlObj.hostname !== currentHost && savedUrlObj.hostname !== 'localhost' && savedUrlObj.hostname !== '127.0.0.1') {
          // Clear the invalid saved URL
          localStorage.removeItem('gameServerUrl');
          return null; // Use same origin
        }
      } catch (e) {
        // Invalid URL in localStorage, clear it
        localStorage.removeItem('gameServerUrl');
        return null; // Use same origin
      }
    }
    
    // Update localStorage with normalized URL if it changed
    if (normalizedUrl !== savedUrl) {
      localStorage.setItem('gameServerUrl', normalizedUrl);
    }
    return normalizedUrl;
  }
  
  // Default: connect to same origin
  return null;
}

function initSocket() {
  // Disconnect existing socket if any
  if (socket && socket.connected) {
    socket.disconnect();
  }
  
  const serverUrl = getServerUrl();
  
  // Connect to specified server URL or same origin
  if (serverUrl) {
    console.log('Connecting to server:', serverUrl);
    socket = io(serverUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });
  } else {
    socket = io({
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });
  }
  
  // Make socket globally accessible
  window.socket = socket;
  
  // Set up countdown listener IMMEDIATELY when socket is created
  // This ensures we catch countdown events even if they arrive before game.js or join.js loads
  socket.off('gameCountdown'); // Remove any existing listener
  socket.on('gameCountdown', (data) => {
    console.log('Countdown received in client.js:', data);
    // Store countdown data globally so game.js can access it
    window.lastCountdown = data;
    window.lastCountdownTime = Date.now();
    
    const countdown = data && data.countdown !== undefined ? data.countdown : (data || 0);
    
    // Try to update immediately
    updateCountdownTimerBox(countdown);

    // If not present, set up a MutationObserver to update when DOM is ready
    if (!document.getElementById('countdownTimerBox')) {
      const observer = new MutationObserver(() => {
        updateCountdownTimerBox(countdown);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 2000); // disconnect after 2s
    }
  });

  socket.on('connect', () => {
    console.log('Connected to server', serverUrl || '(same origin)');
    window.socket = socket; // Update global reference
    // Clear any error messages on successful connection
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
      errorDiv.style.display = 'none';
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });

  socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    let errorMsg = '';
    if (serverUrl) {
      errorMsg = `Failed to connect to server: ${serverUrl}\n\n`;
      errorMsg += 'Troubleshooting:\n';
      errorMsg += '1. Make sure the server is running on the host computer\n';
      errorMsg += '2. Check that both devices are on the same WiFi network\n';
      errorMsg += '3. Verify the IP address is correct (check Server Configuration)\n';
      errorMsg += '4. Check firewall settings on the host computer\n';
      try {
        const urlObj = new URL(serverUrl);
        errorMsg += `5. Try accessing ${serverUrl} in a browser\n\n`;
      } catch (e) {
        errorMsg += `5. Try accessing the server URL in a browser\n\n`;
      }
      errorMsg += `Error: ${error.message}`;
    } else {
      errorMsg = 'Failed to connect to server. Please check if the server is running.\n\n';
      errorMsg += 'If connecting from another device, you need to:\n';
      errorMsg += '1. Find the host computer\'s IP address (check Server Configuration)\n';
      errorMsg += '2. Enter it in the Server URL field: http://[IP]:3000\n';
      errorMsg += '3. Click "Save & Reconnect"';
    }
    showError(errorMsg);
  });

  socket.on('featureFlags', (flags) => {
    featureFlags = flags;
    window.featureFlags = flags; // Make globally accessible
  });

  socket.on('error', (data) => {
    console.error('Error:', data.message);
    showError(data.message);
  });

  return socket;
}

function showError(message) {
  const errorDiv = document.getElementById('errorMessage');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => {
      errorDiv.style.display = 'none';
    }, 5000);
  }
}

function updateCountdownTimerBox(countdown) {
  const countdownTimerBox = document.getElementById('countdownTimerBox');
  const countdownTimerNumber = document.getElementById('countdownTimerNumber');
  if (countdownTimerBox && countdownTimerNumber) {
    if (countdown > 0) {
      countdownTimerNumber.textContent = countdown;
      countdownTimerBox.style.display = 'flex';
      countdownTimerBox.classList.add('countdown-blinking');
    } else {
      countdownTimerBox.style.display = 'none';
      countdownTimerBox.classList.remove('countdown-blinking');
    }
  }
}

if (typeof window !== 'undefined') {
  window.getOrCreatePlayerToken = getOrCreatePlayerToken;
}

// Initialize socket immediately (before DOMContentLoaded)
if (typeof window !== 'undefined') {
  // Initialize socket synchronously so it's available when join.js runs
  initSocket();

  // Ensure socket is available globally ASAP
  window.socket = socket;

  window.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded fired, socket initialized:', !!socket);

    // Always update countdown timer box if countdown is in progress
    if (window.lastCountdown !== undefined) {
      updateCountdownTimerBox(
        window.lastCountdown && window.lastCountdown.countdown !== undefined
          ? window.lastCountdown.countdown
          : window.lastCountdown
      );
    }
  });
}
