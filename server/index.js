const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const gameLogic = require('./gameLogic');
const npcAI = require('./npcAI');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Dev mode detection
const isDevMode = process.env.NODE_ENV !== 'production' || process.argv.includes('--dev');

// Helper function to format timestamp
function formatTimestamp() {
  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const time = now.toTimeString().split(' ')[0]; // HH:MM:SS
  return `${date} ${time}`;
}

// Helper function to create session ID in DDMMYY/HH:MM format
function createSessionId() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0'); // getMonth() returns 0-11
  const year = String(now.getFullYear()).slice(-2); // Last 2 digits of year
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${day}${month}${year}/${hours}:${minutes}`;
}

// Dev mode logging utility
const devLog = {
  log: (...args) => {
    if (isDevMode) {
      const timestamp = formatTimestamp();
      console.log(`[DEV ${timestamp}]`, ...args);
    }
  },
  error: (...args) => {
    if (isDevMode) {
      const timestamp = formatTimestamp();
      console.error(`[DEV ERROR ${timestamp}]`, ...args);
    }
  },
  warn: (...args) => {
    if (isDevMode) {
      const timestamp = formatTimestamp();
      console.warn(`[DEV WARN ${timestamp}]`, ...args);
    }
  }
};

// Parse feature flags from command line or environment
// Feature flags: Chat and Accessibility enabled by default, Power-ups optional
// To disable: set ENABLE_CHAT=false or ENABLE_ACCESSIBILITY=false, or use --disable-chat/--disable-accessibility
const featureFlags = {
  chat: !process.argv.includes('--disable-chat') && process.env.ENABLE_CHAT !== 'false',
  powerups: process.argv.includes('--enable-powerups') || process.env.ENABLE_POWERUPS === 'true',
  accessibility: !process.argv.includes('--disable-accessibility') && process.env.ENABLE_ACCESSIBILITY !== 'false'
};

function createPlayerId() {
  return `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPlayerIdFromSocket(room, socketId) {
  if (!room) {
    return null;
  }
  if (room.socketToPlayerId && room.socketToPlayerId.has(socketId)) {
    return room.socketToPlayerId.get(socketId);
  }
  for (const [playerId, player] of room.players.entries()) {
    if (player.socketId === socketId) {
      return playerId;
    }
  }
  return null;
}

function getPlayerBySocket(room, socketId) {
  const playerId = getPlayerIdFromSocket(room, socketId);
  return playerId ? room.players.get(playerId) : null;
}

function mapSocketToPlayer(room, socketId, playerId) {
  if (!room.socketToPlayerId) {
    room.socketToPlayerId = new Map();
  }
  room.socketToPlayerId.set(socketId, playerId);
}

function getHostName(room) {
  if (!room || !room.players) return 'Host';
  const hostPlayer = Array.from(room.players.values()).find(p => p.isHost);
  return hostPlayer ? hostPlayer.name : 'Host';
}

// Helper function to update gameState when host changes
function updateGameStateHost(room, newHostId) {
  if (!room || !room.gameState || !room.gameState.players) {
    return;
  }
  
  // Clear all host flags first
  Object.values(room.gameState.players).forEach(p => {
    p.isHost = false;
  });
  
  // Set new host
  if (room.gameState.players[newHostId]) {
    room.gameState.players[newHostId].isHost = true;
  }
}

function shouldRoomBePublic(room) {
  if (!room) return false;
  if (room.gameMode !== 'multi-player') return false;
  if (!room.isPublic) return false;
  if (room.isGameActive) return false;
  if (room.countdownActive) return false;
  if (!room.players || room.players.size === 0) return false;
  if (room.players.size >= 4) return false;
  return true;
}

function addOrUpdatePublicRoom(room) {
  if (!shouldRoomBePublic(room)) {
    if (room?.code) {
      publicRooms.delete(room.code);
    }
    return;
  }

  const createdAt = room.publicCreatedAt || Date.now();
  room.publicCreatedAt = createdAt;

  publicRooms.set(room.code, {
    roomCode: room.code,
    hostName: getHostName(room),
    playerCount: room.players.size,
    maxPlayers: 4,
    createdAt
  });
}

function removePublicRoom(roomCode) {
  if (roomCode) {
    publicRooms.delete(roomCode);
  }
}

function buildPublicRoomsList() {
  for (const [code] of publicRooms.entries()) {
    const room = rooms.get(code);
    if (!room || !shouldRoomBePublic(room)) {
      publicRooms.delete(code);
    } else {
      addOrUpdatePublicRoom(room);
    }
  }
  return Array.from(publicRooms.values());
}

function broadcastPublicRooms(ioInstance) {
  const roomsList = buildPublicRoomsList();
  ioInstance.emit('publicRoomsUpdated', { rooms: roomsList });
}

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '../client')));

// Endpoint to get server network IP addresses
app.get('/api/server-info', (req, res) => {
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  const allAddresses = [];
  Object.keys(networkInterfaces).forEach((iface) => {
    networkInterfaces[iface].forEach((addr) => {
      if (addr.family === 'IPv4' && !addr.internal) {
        allAddresses.push(addr.address);
      }
    });
  });
  
  res.json({
    port: PORT,
    addresses: allAddresses,
    // Provide connection URLs for each address
    connectionUrls: allAddresses.map(addr => `http://${addr}:${PORT}`)
  });
});

// Game rooms management
const rooms = new Map();
// Track room cleanup timeouts for active games
const roomCleanupTimeouts = new Map();
const npcInstances = new Map(); // roomCode -> Map of npcId -> npc object
// Track public rooms for discovery (multiplayer waiting rooms only)
const publicRooms = new Map(); // roomCode -> { roomCode, hostName, playerCount, maxPlayers, createdAt }

// Game session tracking for dev mode
let gameSessionCount = 0;
const gameSessions = new Map(); // sessionId -> { roomCode, startTime, endTime, winner, players }

// Helper function to mark session as ended when room is deleted or game crashes
function markSessionAsEnded(roomCode, reason = 'ended') {
  // Find session by roomCode and mark it as ended
  for (const [sessionId, session] of gameSessions.entries()) {
    if (session.roomCode === roomCode && !session.endTime) {
      session.endTime = Date.now();
      session.endReason = reason; // 'ended', 'crashed', 'disconnected', etc.
      devLog.log(`[SESSION ENDED] Session ${sessionId} marked as ended`, {
        roomCode,
        reason,
        duration: `${Math.floor((session.endTime - session.startTime) / 1000)}s`
      });
      break;
    }
  }
}

// Periodic cleanup: Mark sessions as ended if their rooms no longer exist
function cleanupOrphanedSessions() {
  const now = Date.now();
  const MAX_SESSION_AGE = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [sessionId, session] of gameSessions.entries()) {
    // Mark old sessions as ended (older than 24 hours)
    if (!session.endTime && (now - session.startTime) > MAX_SESSION_AGE) {
      session.endTime = now;
      session.endReason = 'timeout';
      devLog.log(`[SESSION CLEANUP] Old session ${sessionId} marked as ended (timeout)`);
    }
    
    // Mark sessions as ended if their room no longer exists
    if (!session.endTime && session.roomCode && !rooms.has(session.roomCode)) {
      session.endTime = now;
      session.endReason = 'room_deleted';
      devLog.log(`[SESSION CLEANUP] Session ${sessionId} marked as ended (room deleted)`, {
        roomCode: session.roomCode
      });
    }
  }
}

// Run cleanup every 30 seconds
setInterval(cleanupOrphanedSessions, 30000);

// Set dev mode references in gameLogic module (after variables are declared)
gameLogic.setDevModeRefs(rooms, gameSessions, () => gameSessionCount);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Send feature flags to client
  socket.emit('featureFlags', featureFlags);

  // Handle server URL changes
  socket.on('serverUrlChanged', (data) => {
    const { oldUrl, newUrl, action } = data || {};
    const clientInfo = {
      socketId: socket.id,
      oldUrl: oldUrl || 'unknown',
      newUrl: newUrl || 'unknown',
      action: action || 'changed',
      timestamp: new Date().toISOString()
    };
    devLog.log(`[SERVER URL CHANGED]`, clientInfo);
    console.log(`[SERVER URL CHANGED] Client ${socket.id} ${action} server URL: ${oldUrl} → ${newUrl}`);
  });

  socket.on('requestSessionHistory', () => {
    // Clean up orphaned sessions before sending history
    cleanupOrphanedSessions();
    
    const sessions = Array.from(gameSessions.entries())
      .map(([sessionId, session]) => {
        // Ensure sessionId is stored in session object (for backward compatibility)
        if (!session.sessionId) {
          session.sessionId = sessionId;
        }
        
        // Check if room still exists - if not, mark as ended
        const roomExists = session.roomCode && rooms.has(session.roomCode);
        let endTime = session.endTime || null;
        
        // If session already has endTime (marked as ended on disconnect), use it
        // Otherwise, check if game is still active
        let isGameActuallyStarted = false;
        let shouldMarkAsEnded = false;
        
        // Only check game status if session doesn't already have an endTime
        if (!endTime && roomExists) {
          const room = rooms.get(session.roomCode);
          
          // Check if game loop is actually running (access gameLoops from gameLogic)
          const gameLoops = gameLogic.gameLoops || new Map();
          const hasGameLoop = gameLoops.has(session.roomCode);
          
          // Game is active ONLY if:
          // 1. Game loop is actually running (isGameActive === true)
          // 2. AND game loop interval exists (hasGameLoop === true)
          // 3. AND there are connected players
          const hasConnectedPlayers = room && room.players && Array.from(room.players.values()).some(p => p.socketId && !p.disconnected);
          
          isGameActuallyStarted = room && room.isGameActive === true && hasGameLoop && hasConnectedPlayers;
          
          // If room exists but game is not active, and game had started (startTime > 0), mark as ended
          if (room && (!room.isGameActive || !hasGameLoop || !hasConnectedPlayers) && room.gameState && room.gameState.startTime && room.gameState.startTime > 0) {
            // Game started but is no longer active - mark session as ended
            shouldMarkAsEnded = true;
          }
        }
        
        // Session is active only if: no endTime, room exists, AND game loop is actually running
        // Don't mark as active if game is in ready phase (hasn't started yet)
        let gameHasStarted = false;
        if (roomExists) {
          const roomForCheck = rooms.get(session.roomCode);
          gameHasStarted = roomForCheck && roomForCheck.gameState && roomForCheck.gameState.startTime && roomForCheck.gameState.startTime > 0;
        }
        const isActuallyActive = !endTime && roomExists && isGameActuallyStarted && gameHasStarted;
        
        // If session has no endTime but room doesn't exist, mark it as ended
        if (!endTime && !roomExists && session.roomCode) {
          endTime = Date.now();
          session.endTime = endTime;
          session.endReason = 'room_not_found';
        } else if (!endTime && shouldMarkAsEnded) {
          // Room exists but game is not active (game ended)
          endTime = Date.now();
          session.endTime = endTime;
          session.endReason = 'game_ended';
        }
        
        // If session has no endTime, room exists, but game hasn't started yet, don't mark as active
        // (game is in waiting/countdown phase) - this is correct, don't show as "in progress"
        
        const finalEndTime = endTime || null;
        const durationMs = (finalEndTime || Date.now()) - session.startTime;
        return {
          sessionId: session.sessionId || sessionId, // Use sessionId from object or Map key
          roomCode: session.roomCode,
          gameMode: session.gameMode || 'multi-player',
          winnerName: session.winner ? session.winner.name : null,
          winnerScore: session.winner ? session.winner.score : null,
          durationSeconds: Math.floor(durationMs / 1000),
          isActive: isActuallyActive
        };
      })
      .sort((a, b) => {
        // Sort by startTime (need to get from original session)
        const sessionA = gameSessions.get(a.sessionId);
        const sessionB = gameSessions.get(b.sessionId);
        return (sessionB?.startTime || 0) - (sessionA?.startTime || 0);
      })
      .slice(0, 5);

    socket.emit('sessionHistory', { sessions });
  });

  // Public rooms: host toggles room visibility
  socket.on('togglePublicRoom', (data) => {
    const { roomCode, isPublic: desiredPublicState } = data || {};
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('publicRoomStatus', { roomCode, isPublic: false, error: 'Room not found' });
      return;
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player || !player.isHost) {
      socket.emit('publicRoomStatus', { roomCode, isPublic: room.isPublic || false, error: 'Only host can toggle public status' });
      return;
    }

    if (room.gameMode !== 'multi-player') {
      socket.emit('publicRoomStatus', { roomCode, isPublic: false, error: 'Public rooms are for multiplayer only' });
      return;
    }

    const nextState = typeof desiredPublicState === 'boolean' ? desiredPublicState : !room.isPublic;

    if (nextState) {
      if (room.isGameActive || room.countdownActive) {
        socket.emit('publicRoomStatus', { roomCode, isPublic: room.isPublic || false, error: 'Cannot make room public after game start' });
        return;
      }
      if (room.players.size >= 4) {
        socket.emit('publicRoomStatus', { roomCode, isPublic: room.isPublic || false, error: 'Room is full' });
        return;
      }
    }

    room.isPublic = nextState;

    if (room.isPublic) {
      addOrUpdatePublicRoom(room);
    } else {
      removePublicRoom(roomCode);
    }

    socket.emit('publicRoomStatus', { roomCode, isPublic: room.isPublic });
    broadcastPublicRooms(io);
  });

  // Public rooms: request current list
  socket.on('requestPublicRooms', () => {
    const roomsList = buildPublicRoomsList();
    socket.emit('publicRoomsUpdated', { rooms: roomsList });
  });

  // Handle game options request
  socket.on('requestGameOptions', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    
    if (room && room.gameOptions) {
      socket.emit('gameOptionsUpdated', {
        gameOptions: room.gameOptions
      });
    }
  });

  // Handle game options update (host only)
  socket.on('updateGameOptions', (data) => {
    const { roomCode, gameOptions } = data;
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player || !player.isHost) {
      socket.emit('error', { message: 'Only host can update game options' });
      return;
    }

    // Validate and update game options
    if (gameOptions.wallMode !== undefined) {
      room.gameOptions.wallMode = Boolean(gameOptions.wallMode);
    }
    
    if (gameOptions.strictMode !== undefined) {
      room.gameOptions.strictMode = Boolean(gameOptions.strictMode);
    }
    
    if (gameOptions.timeLimit !== undefined) {
      // Validate time limit: null or one of [3, 5, 10, 15] minutes
      const validTimeLimits = [null, 3, 5, 10, 15];
      if (validTimeLimits.includes(gameOptions.timeLimit)) {
        room.gameOptions.timeLimit = gameOptions.timeLimit;
      }
    }

    // Broadcast updated options to all players in room
    io.to(roomCode).emit('gameOptionsUpdated', {
      gameOptions: room.gameOptions
    });
  });

  // Handle player joining
  socket.on('joinRoom', (data) => {
    const { playerName, roomCode } = data;
    const playerToken = data.playerToken || createPlayerId();
    const controlScheme = data.controlScheme || 'wasd';
    
    if (!playerName || playerName.trim().length === 0) {
      socket.emit('joinError', { message: 'Player name is required' });
      return;
    }

    // Find or create room
    let room = rooms.get(roomCode);
    if (!room) {
      room = {
        code: roomCode,
        players: new Map(),
        playerTokens: new Map(), // Maps player tokens to player IDs
        socketToPlayerId: new Map(), // Maps socket.id to gameState player ID
        lastChatAt: new Map(),
        gameState: null,
        gameMode: 'multi-player',
        isGameActive: false,
        isPaused: false,
        pausedBy: null,
        gameOptions: {
          wallMode: false,        // Default: wrapping
          strictMode: false,      // Default: body segments can be walked over
          timeLimit: null,        // null = disabled, or minutes (3/5/10/15)
          maxPauseTime: 15 * 60 * 1000  // 15 minutes in ms
        },
        isPublic: false,
        publicCreatedAt: null
      };
      rooms.set(roomCode, room);
      
      // Log room creation in dev mode
      devLog.log(`[ROOM CREATED]`, {
        timestamp: new Date().toISOString(),
        roomCode: roomCode,
        gameMode: room.gameMode || 'multi-player',
        playerCount: room.players.size,
        totalRooms: rooms.size,
        allRooms: Array.from(rooms.keys())
      });
    }

    if (room.isPublic === undefined) {
      room.isPublic = false;
      room.publicCreatedAt = null;
    }

    // Reconnection disabled for active games - sessions expire immediately on refresh/disconnect
    // BUT: Allow reconnection during ready phase (before game starts) for multiplayer
    // Check if player token exists and game hasn't started yet
    if (room.playerTokens && room.playerTokens.has(playerToken)) {
      const existingPlayerId = room.playerTokens.get(playerToken);
      const existingPlayer = room.players.get(existingPlayerId);
      if (existingPlayer) {
        // Check if game has started - only allow reconnection if game hasn't started
        const gameHasStarted = room.gameState && room.gameState.startTime && room.gameState.startTime > 0;
        
        if (!gameHasStarted && room.gameMode === 'multi-player') {
          // Game hasn't started yet - allow reconnection during ready phase
          if (existingPlayer.disconnectTimeoutId) {
            clearTimeout(existingPlayer.disconnectTimeoutId);
            existingPlayer.disconnectTimeoutId = null;
          }
          existingPlayer.socketId = socket.id;
          existingPlayer.controlScheme = controlScheme || existingPlayer.controlScheme;
          existingPlayer.disconnected = false;
          existingPlayer.disconnectedAt = null;

          mapSocketToPlayer(room, socket.id, existingPlayerId);
          socket.join(roomCode);

          socket.emit('joinedRoom', {
            playerId: existingPlayerId,
            isHost: existingPlayer.isHost,
            roomCode,
            gameMode: room.gameMode,
            gameOptions: room.gameOptions,
            playerToken,
            isPublic: room.isPublic || false
          });

          devLog.log(`Player ${existingPlayer.name} reconnected to room ${roomCode} during ready phase`);
          
          // Send gameStarted event so they see the rules screen
          if (room.gameState) {
            socket.emit('gameStarted', {
              gameState: room.gameState,
              roomCode: roomCode,
              playerId: existingPlayerId,
              gameMode: room.gameMode,
              isHost: existingPlayer.isHost
            });
          }
          
          return;
        } else {
          // Game has started - reconnection not allowed, token was deleted
          devLog.log(`Reconnection blocked for ${existingPlayer.name} - game has started`);
        }
      }
    }

    // Check if room is in single-player mode
    if (room.gameMode === 'single-player') {
      socket.emit('joinError', { message: 'Room is in single-player mode' });
      return;
    }

    // Check if countdown has started or game is actively running
    // Allow joining if game state exists but countdown hasn't started yet (ready phase)
    if (room.countdownActive || (room.gameState && room.gameState.startTime && room.gameState.startTime > 0)) {
      socket.emit('joinError', { message: 'Game is already in progress' });
      return;
    }

    // Check if room is full (max 4 players)
    if (room.players.size >= 4) {
      socket.emit('joinError', { message: 'Room is full (max 4 players)' });
      return;
    }

    // Check for duplicate names
    const nameExists = Array.from(room.players.values()).some(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (nameExists) {
      socket.emit('joinError', { message: 'Player name already taken' });
      return;
    }

    // Add player to room
    const playerId = createPlayerId();
    const isHost = room.players.size === 0;
    
    room.players.set(playerId, {
      id: playerId,
      name: playerName,
      socketId: socket.id,
      token: playerToken,
      type: 'human',
      isHost: isHost,
      controlScheme: controlScheme || 'wasd'
    });
    room.playerTokens.set(playerToken, playerId);
    
    // Map socket.id to playerId (for reconnection handling)
    mapSocketToPlayer(room, socket.id, playerId);

    socket.join(roomCode);
    socket.emit('joinedRoom', {
      playerId,
      isHost,
      roomCode,
      gameMode: room.gameMode,
      gameOptions: room.gameOptions,
      playerToken
    });

    // Notify all players in room
    io.to(roomCode).emit('playerJoined', {
      playerId,
      playerName,
      isHost,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost
      }))
    });

    console.log(`Player ${playerName} joined room ${roomCode}`);
  });

  // Handle game start
  socket.on('startGame', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player || !player.isHost) {
      socket.emit('error', { message: 'Only host can start the game' });
      return;
    }

    if (room.players.size < 2) {
      socket.emit('error', { message: 'Need at least 2 players to start' });
      return;
    }

    if (room.players.size > 4) {
      socket.emit('error', { message: 'Maximum 4 players allowed' });
      return;
    }

    // Once the host starts the game, remove from public listing
    if (room.isPublic) {
      room.isPublic = false;
      removePublicRoom(roomCode);
      broadcastPublicRooms(io);
    }

    // Initialize game state
    const playersArray = Array.from(room.players.values());
    devLog.log('Creating game state with players:', playersArray.map(p => ({ id: p.id, name: p.name, isHost: p.isHost })));
    room.gameState = gameLogic.createGameState(playersArray, featureFlags.powerups, room.gameOptions.wallMode, room.gameOptions.timeLimit, room.gameOptions.strictMode || false);
    
    // Track game session start for multiplayer
    gameSessionCount++;
    const sessionId = createSessionId();
    room.sessionId = sessionId;
    devLog.log(`[SESSION ID SET] Multiplayer room ${roomCode}`, { sessionId, roomCode });
    gameSessions.set(sessionId, {
      sessionId: sessionId, // Store sessionId in the session object
      roomCode: roomCode,
      startTime: Date.now(),
      endTime: null,
      winner: null,
      players: playersArray.map(p => ({ id: p.id, name: p.name, type: p.type || 'human' })),
      gameMode: room.gameMode || 'multi-player'
    });
    
    // Log game session start
    devLog.log(`[GAME SESSION ${gameSessionCount}] Started (Multi-Player)`, {
      timestamp: new Date().toISOString(),
      sessionId: sessionId,
      roomCode: roomCode,
      gameMode: room.gameMode || 'multi-player',
      playerCount: playersArray.length,
      players: playersArray.map(p => ({ id: p.id, name: p.name, type: p.type || 'human' })),
      totalRooms: rooms.size,
      activeRooms: Array.from(rooms.keys())
    });
    
    // Verify all players are alive in gameState
    Object.keys(room.gameState.players).forEach(playerId => {
      const player = room.gameState.players[playerId];
      devLog.log(`Player in gameState: ${player.name} (${playerId}), isAlive: ${player.isAlive}, type: ${player.type}`);
      if (!player.isAlive) {
        devLog.error(`WARNING: Player ${player.name} (${playerId}) is marked as DEAD in gameState!`);
      }
    });
    
    room.enablePowerups = featureFlags.powerups;
    room.isPaused = false;
    // Initialize ready players tracking
    room.readyPlayers = new Set();

    // Send initial ready status to all players (empty - no one is ready yet)
    io.to(roomCode).emit('playerReadyStatus', {
      readyPlayers: []
    });

    // Send gameStarted immediately so players redirect to game board
    const playersToNotify = Array.from(room.players.values());
    
    // Notify all players with their player IDs - redirect them to game board first
    devLog.log(`Sending gameStarted to ${playersToNotify.length} players:`, playersToNotify.map(p => p.id));
    
    for (const player of playersToNotify) {
      if (!player || !player.socketId) {
        devLog.warn(`Player missing socketId in room ${roomCode}`, player?.id);
        continue;
      }
      
      // Verify player exists in gameState
      const gameStatePlayer = room.gameState.players[player.id];
      devLog.log(`Sending gameStarted to player ${player.name}:`, {
        socketId: player.socketId,
        playerId: player.id,
        playerInRoom: !!player,
        playerInGameState: !!gameStatePlayer,
        gameStatePlayerIsAlive: gameStatePlayer?.isAlive,
        gameStatePlayerIds: Object.keys(room.gameState.players)
      });
      
      if (gameStatePlayer && !gameStatePlayer.isAlive) {
        devLog.error(`WARNING: Player ${player.name} (${player.id}) is DEAD in gameState when sending gameStarted!`);
      }
      
      // Get the socket object and emit directly to it (more reliable than io.to)
      const socketObj = io.sockets.sockets.get(player.socketId);
      if (socketObj && socketObj.connected) {
        socketObj.emit('gameStarted', {
          gameState: room.gameState,
          roomCode: roomCode,
          playerId: player.id,
          gameMode: room.gameMode
        });
        devLog.log(`Sent gameStarted to ${player.name} (${player.id})`);
      } else {
        // Fallback: emit to socket ID
        io.to(player.socketId).emit('gameStarted', {
          gameState: room.gameState,
          roomCode: roomCode,
          playerId: player.id,
          isHost: player.isHost,
          gameMode: room.gameMode
        });
        devLog.log(`Sent gameStarted to ${player.name} (${player.id}) via fallback`);
      }
    }

    // Store countdown state in room so reconnecting players can receive it
    room.countdownActive = false; // Will be set to true when countdown starts
    room.countdownValue = null;
    room.countdownInterval = null;
    
    // Send initial ready status (all players not ready)
    io.to(roomCode).emit('playerReadyStatus', {
      readyPlayers: []
    });
  });

  // Handle single-player game start
  socket.on('startSinglePlayer', (data) => {
    devLog.log('startSinglePlayer event received:', {
      playerName: data.playerName,
      npcCount: data.npcCount,
      controlScheme: data.controlScheme,
      gameOptions: data.gameOptions,
      socketId: socket.id
    });
    
    const { playerName, npcCount, gameOptions, gameMode } = data;
    const playerToken = data.playerToken || createPlayerId();
    const controlScheme = data.controlScheme || 'wasd';
    
    if (!playerName || playerName.trim().length === 0) {
      devLog.error('startSinglePlayer: Player name is required');
      socket.emit('error', { message: 'Player name is required' });
      return;
    }

    // Allow npcCount to be 0 for solo mode
    if (npcCount < 0 || npcCount > 3) {
      devLog.error('startSinglePlayer: Invalid NPC count:', npcCount);
      socket.emit('error', { message: 'NPC count must be between 0 and 3' });
      return;
    }

    // Determine game mode: solo if npcCount is 0 or gameMode is 'solo', otherwise single-player
    const actualGameMode = (npcCount === 0 || gameMode === 'solo') ? 'solo' : 'single-player';

    // Create a unique room code for single-player
    const roomCode = 'SP' + Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Use gameOptions from client if provided, otherwise use defaults
    const wallMode = gameOptions && gameOptions.wallMode !== undefined ? Boolean(gameOptions.wallMode) : false;
    const timeLimit = gameOptions && gameOptions.timeLimit !== undefined ? gameOptions.timeLimit : null;
    
    const room = {
      code: roomCode,
      players: new Map(),
      playerTokens: new Map(), // Maps player tokens to player IDs
      socketToPlayerId: new Map(), // Maps socket.id to player ID
      gameState: null,
      gameMode: actualGameMode, // Use determined game mode (solo or single-player)
      isGameActive: false,
      isPaused: false,
      pausedBy: null,
      npcs: new Map(),
      lastChatAt: new Map(),
      gameOptions: {
        wallMode: wallMode,        // From client or default: wrapping
        strictMode: false,         // Default: body segments can be walked over
        timeLimit: timeLimit,      // From client or default: null (disabled)
        maxPauseTime: 15 * 60 * 1000  // 15 minutes in ms
      },
      isPublic: false,
      publicCreatedAt: null
    };

    // Add human player
    const playerId = createPlayerId();
    room.players.set(playerId, {
      id: playerId,
      name: playerName,
      socketId: socket.id,
      token: playerToken,
      type: 'human',
      isHost: true,
      controlScheme: controlScheme || 'wasd'
    });
    room.playerTokens.set(playerToken, playerId);
    
    // Map socket.id to playerId (for reconnection handling)
    mapSocketToPlayer(room, socket.id, playerId);

    // Create NPCs only if not solo mode
    if (actualGameMode === 'single-player' && npcCount > 0) {
      const npcNames = ['Bot-Alpha', 'Bot-Beta', 'Bot-Gamma'];
      const difficulties = ['easy', 'medium', 'hard'];
      
      for (let i = 0; i < npcCount; i++) {
        const npcId = `npc-${roomCode}-${i}`;
        const npcName = npcNames[i];
        const difficulty = difficulties[i] || 'medium';
        
        room.players.set(npcId, {
          id: npcId,
          name: npcName,
          socketId: null,
          type: 'npc',
          isHost: false
        });

        // Create NPC AI instance
        const npc = npcAI.createNPC(npcId, npcName, difficulty);
        room.npcs.set(npcId, npc);
      }
    }

    rooms.set(roomCode, room);
    socket.join(roomCode);

    // Defensive check: ensure gameOptions exists (should be set above, but safety check)
    if (!room.gameOptions) {
      room.gameOptions = {
        wallMode: false,
        strictMode: false,
        timeLimit: null,
        maxPauseTime: 15 * 60 * 1000
      };
    }
    
    // Initialize game state
    room.gameState = gameLogic.createGameState(Array.from(room.players.values()), featureFlags.powerups, room.gameOptions.wallMode, room.gameOptions.timeLimit, room.gameOptions.strictMode || false);
    room.enablePowerups = featureFlags.powerups;
    room.isPaused = false;
    
    // Track game session start for single-player
    gameSessionCount++;
    const sessionId = createSessionId();
    room.sessionId = sessionId;
    devLog.log(`[SESSION ID SET] Single-player room ${roomCode}`, { sessionId, roomCode });
    const playersArray = Array.from(room.players.values());
    gameSessions.set(sessionId, {
      sessionId: sessionId, // Store sessionId in the session object
      roomCode: roomCode,
      startTime: Date.now(),
      endTime: null,
      winner: null,
      players: playersArray.map(p => ({ id: p.id, name: p.name, type: p.type || 'human' })),
      gameMode: actualGameMode
    });
    
    // Log game session start
    devLog.log(`[GAME SESSION ${gameSessionCount}] Started (${actualGameMode === 'solo' ? 'Solo' : 'Single-Player'})`, {
      timestamp: new Date().toISOString(),
      sessionId: sessionId,
      roomCode: roomCode,
      gameMode: actualGameMode,
      playerCount: playersArray.length,
      players: playersArray.map(p => ({ id: p.id, name: p.name, type: p.type || 'human' })),
      npcCount: npcCount,
      totalRooms: rooms.size,
      activeRooms: Array.from(rooms.keys())
    });
    
    // Initialize ready players tracking (for solo/single-player, only human player needs to be ready)
    room.readyPlayers = new Set();
    // Don't set isGameActive yet - wait for player to be ready

    // Send initial game state (for rendering before countdown)
    const player = room.players.get(playerId);
    // Send gameStarted immediately so player redirects to game board
    socket.emit('gameStarted', {
      gameState: room.gameState,
      roomCode: roomCode,
      playerId: playerId,
      gameMode: room.gameMode,
      isHost: true // Single-player player is always host
    });
    
    // Send initial ready status (empty - no one is ready yet)
    socket.emit('playerReadyStatus', {
      readyPlayers: []
    });

    // Store countdown state in room so reconnecting player can receive it
    room.countdownActive = false; // Will be set to true when countdown starts
    room.countdownValue = null;
    room.countdownInterval = null;
    
    devLog.log(`${actualGameMode === 'solo' ? 'Solo' : 'Single-player'} game started in room ${roomCode}${actualGameMode === 'single-player' ? ` with ${npcCount} NPCs` : ''}`);
    console.log(`${actualGameMode === 'solo' ? 'Solo' : 'Single-player'} game started in room ${roomCode}${actualGameMode === 'single-player' ? ` with ${npcCount} NPCs` : ''}`);
  });

  // Helper function to start countdown for a room
  function startCountdownForRoom(room, roomCode, io, isSinglePlayer = false) {
    if (room.countdownActive || room.countdownInterval) {
      // Countdown already started
      return;
    }

    room.countdownActive = true;
    let countdown = 5;
    room.countdownValue = countdown;

    // Emit initial countdown
    io.to(roomCode).emit('gameCountdown', { countdown });

    const countdownInterval = setInterval(() => {
      countdown--;
      room.countdownValue = countdown;
      if (countdown > 0) {
        io.to(roomCode).emit('gameCountdown', { countdown });
      } else {
        // Emit countdown 0 before clearing interval
        io.to(roomCode).emit('gameCountdown', { countdown: 0 });
        clearInterval(countdownInterval);

        // Mark countdown as inactive
        room.countdownActive = false;
        room.countdownValue = null;
        room.countdownInterval = null;

        // Countdown finished - start the game loop
        room.isGameActive = true;
        if (isSinglePlayer) {
          gameLogic.startGameLoop(room, io, featureFlags.powerups, room.npcs);
        } else {
          gameLogic.startGameLoop(room, io, featureFlags.powerups, null);
        }

        // Send initial game state update immediately with timer = 0
        if (room.gameState) {
          room.gameState.timer = 0;
          io.to(roomCode).emit('gameStateUpdate', { gameState: room.gameState });
        }

        console.log(`Game started in room ${roomCode}`);
      }
    }, 1000);
    room.countdownInterval = countdownInterval;
  }

  // Helper function to start resume countdown for a room
  function startResumeCountdownForRoom(room, roomCode, io, resumedBy) {
    if (room.resumeCountdownActive || room.resumeCountdownInterval) {
      // Resume countdown already started
      return;
    }

    room.resumeCountdownActive = true;
    let countdown = 5;
    room.resumeCountdownValue = countdown;

    // Emit initial resume countdown
    io.to(roomCode).emit('resumeCountdown', { countdown, resumedBy });

    const countdownInterval = setInterval(() => {
      countdown--;
      room.resumeCountdownValue = countdown;
      if (countdown > 0) {
        io.to(roomCode).emit('resumeCountdown', { countdown, resumedBy });
      } else {
        // Emit countdown 0 before clearing interval
        io.to(roomCode).emit('resumeCountdown', { countdown: 0, resumedBy });
        clearInterval(countdownInterval);

        // Mark resume countdown as inactive
        room.resumeCountdownActive = false;
        room.resumeCountdownValue = null;
        room.resumeCountdownInterval = null;

        // Countdown finished - actually resume the game
        const resumeSuccess = gameLogic.resumeGame(room, io);
        
        if (!resumeSuccess) {
          // Pause limit exceeded - game ended
          io.to(roomCode).emit('resumeError', { message: 'Pause time limit exceeded. Game ended.' });
          return;
        }
        
        room.isPaused = false;
        room.pausedBy = null;

        io.to(roomCode).emit('gameResumed', {
          resumedBy: resumedBy
        });
        
        // Send gameStateUpdate to ensure all players sync resume state
        if (room.gameState) {
          io.to(roomCode).emit('gameStateUpdate', {
            gameState: room.gameState
          });
        }

        console.log(`Game resumed in room ${roomCode} after countdown`);
      }
    }, 1000);
    room.resumeCountdownInterval = countdownInterval;
  }

  // Handle player ready
  socket.on('playerReady', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      devLog.error('playerReady: Room not found', { roomCode, socketId: socket.id });
      return;
    }
    
    const playerIdFromData = data.currentPlayerId;
    let playerId = null;
    if (playerIdFromData && room.players.has(playerIdFromData)) {
      playerId = playerIdFromData;
    } else {
      playerId = getPlayerIdFromSocket(room, socket.id);
    }

    const player = playerId ? room.players.get(playerId) : null;

    if (player && player.socketId !== socket.id) {
      player.socketId = socket.id;
      mapSocketToPlayer(room, socket.id, player.id);
    }
    
    if (!player) {
      socket.emit('error', { message: 'Player not found in room' });
      devLog.error('playerReady: Player not found', { roomCode, socketId: socket.id, playersInRoom: Array.from(room.players.keys()) });
      return;
    }
    
    // Ensure gameState exists (game must have been started)
    if (!room.gameState) {
      socket.emit('error', { message: 'Game has not started yet' });
      devLog.error('playerReady: Game state not found', { roomCode, socketId: socket.id });
      return;
    }
    
    // Initialize readyPlayers if it doesn't exist (should be initialized in startGame, but ensure it exists)
    if (!room.readyPlayers) {
      room.readyPlayers = new Set();
      devLog.log('Initialized readyPlayers set for room:', roomCode);
    }
    
    // Add player to ready set (use player.id for consistency)
    room.readyPlayers.add(player.id);

    devLog.log('Player marked as ready:', {
      roomCode,
      playerId: player.id,
      playerName: player.name,
      socketId: socket.id,
      readyPlayers: Array.from(room.readyPlayers),
      totalPlayers: room.players.size
    });
    
    const isSinglePlayer = room.gameMode === 'single-player' || room.gameMode === 'solo';
    const humanPlayers = Array.from(room.players.values()).filter(p => p.type === 'human');
    // Convert to strings for consistent comparison
    const readyPlayerIds = Array.from(room.readyPlayers).map(id => String(id));
    const humanPlayerIds = humanPlayers.map(p => String(p.id));
    const allHumanPlayersReady = humanPlayers.length > 0 && humanPlayerIds.length > 0 &&
      humanPlayerIds.every(playerId => readyPlayerIds.includes(playerId));

    // For multiplayer: check if all players are ready
    // For solo/single-player: check if human player is ready
    if (isSinglePlayer) {
      // Solo/single-player: start countdown immediately when human player is ready
      if (allHumanPlayersReady) {
        io.to(roomCode).emit('allPlayersReady');
        // Small delay to ensure UI updates
        setTimeout(() => {
          startCountdownForRoom(room, roomCode, io, true);
        }, 300);
      }
    } else {
      // Multiplayer: check if all players are ready
      // Only check human players (exclude NPCs if any)
      const allPlayers = Array.from(room.players.values()).filter(p => p.type === 'human');
      
      // Ensure we're comparing strings consistently
      const readyPlayerIds = Array.from(room.readyPlayers).map(id => String(id));
      const allPlayerIds = allPlayers.map(p => String(p.id));
      
      // Check if all players are ready (using string comparison)
      const allPlayersReady = allPlayers.length > 0 &&
        allPlayers.length === readyPlayerIds.length &&
        allPlayerIds.every(playerId => readyPlayerIds.includes(playerId));

      // Debug logging
      devLog.log('Player ready check (multiplayer):', {
        roomCode,
        playerId: player.id,
        playerName: player.name,
        socketId: socket.id,
        readyPlayers: readyPlayerIds,
        allPlayerIds: allPlayerIds,
        allPlayersReady,
        readyCount: room.readyPlayers.size,
        totalHumanPlayers: allPlayers.length,
        playerDetails: allPlayers.map(p => ({ 
          id: String(p.id), 
          name: p.name, 
          socketId: p.socketId,
          isReady: readyPlayerIds.includes(String(p.id))
        }))
      });
      
      // Broadcast ready status to all players (convert to strings for consistent comparison)
      const readyStatusPayload = {
        readyPlayers: Array.from(room.readyPlayers).map(id => String(id))
      };

      io.to(roomCode).emit('playerReadyStatus', readyStatusPayload);
      
      if (allPlayersReady) {
        devLog.log('All players ready, starting countdown for room:', roomCode);
        io.to(roomCode).emit('allPlayersReady');
        // Small delay to ensure UI updates
        setTimeout(() => {
          startCountdownForRoom(room, roomCode, io, false);
        }, 300);
      } else {
        const missingPlayers = allPlayers.filter(p => !readyPlayerIds.includes(String(p.id)));
        devLog.log('Not all players ready yet:', {
          readyCount: room.readyPlayers.size,
          totalPlayers: allPlayers.length,
          missingPlayers: missingPlayers.map(p => ({ 
            id: String(p.id), 
            name: p.name, 
            socketId: p.socketId 
          }))
        });
      }
    }
  });

  // Handle game state request (if client missed gameStarted event)
  socket.on('requestGameState', (data) => {
    const { roomCode, playerToken } = data;
    
    const room = rooms.get(roomCode);
    
    devLog.log(`requestGameState: socket=${socket.id}, roomCode=${roomCode}, roomExists=${!!room}, hasGameState=${!!room?.gameState}, isGameActive=${room?.isGameActive}`);
    
    if (!room) {
      devLog.warn(`Room ${roomCode} not found for requestGameState from socket ${socket.id}`);
      socket.emit('gameStateError', {
        message: 'Room not found. Please join a room first.',
        roomCode: roomCode
      });
      return;
    }
    
    if (!room.gameState) {
      devLog.warn(`Game state not found for room ${roomCode}`);
      socket.emit('gameStateError', {
        message: 'Game has not started yet. Please wait for the game to begin.',
        roomCode: roomCode
      });
      return;
    }
    
    // For multiplayer games, ensure player is in room
    // Allow reconnection during ready phase (before game starts) via playerToken
    if (room.gameMode === 'multi-player' && room.gameState) {
      let playerId = getPlayerIdFromSocket(room, socket.id);
      
      // Try to find player by token if not found by socket (reconnection during ready phase)
      const gameStartedForReconnect = room.gameState.startTime && room.gameState.startTime > 0;
      if (!playerId && playerToken && room.playerTokens && room.playerTokens.has(playerToken) && !gameStartedForReconnect) {
        playerId = room.playerTokens.get(playerToken);
        devLog.log(`Reconnecting player via token during ready phase: playerId=${playerId}, socket=${socket.id}`);
      }

      const player = playerId ? room.players.get(playerId) : null;
      
      // If player doesn't exist, they need to join first
      if (!player) {
        socket.emit('gameStateError', {
          message: 'Player not found. Please rejoin the room.',
          roomCode: roomCode
        });
        return;
      }

      // Allow reconnection during ready phase (game not started)
      if (player.disconnected && !gameStartedForReconnect) {
        // Reconnect player during ready phase
        player.disconnected = false;
        player.disconnectedAt = null;
        player.socketId = socket.id;
        mapSocketToPlayer(room, socket.id, playerId);
        socket.join(roomCode);
        devLog.log(`Reconnected player ${player.name} during ready phase via requestGameState`);
      } else if (player.disconnected && gameStartedForReconnect) {
        // Game has started - reconnection not allowed
        socket.emit('gameStateError', {
          message: 'Session expired. Please rejoin the room.',
          roomCode: roomCode
        });
        return;
      }

      // Player is connected and not disconnected - allow access
      if (player.disconnectTimeoutId) {
        clearTimeout(player.disconnectTimeoutId);
        player.disconnectTimeoutId = null;
      }
      player.socketId = socket.id;
      mapSocketToPlayer(room, socket.id, playerId);
      socket.join(roomCode);
      if (room.countdownActive && room.countdownValue !== null) {
        socket.emit('gameCountdown', { countdown: room.countdownValue });
      }
      
      // Restart game loop if it's not active but game state exists (only for currently connected players)
      // BUT: Don't start if countdown is active or game hasn't started yet
      const gameLoops = gameLogic.gameLoops || new Map();
      const hasGameLoop = gameLoops.has(roomCode);
      const isCountdownActive = room.countdownActive === true;
      const gameHasStarted = room.gameState && room.gameState.startTime && room.gameState.startTime > 0;

      // Log detailed state for debugging
      devLog.log(`[GAME LOOP RESTART CHECK] Room ${roomCode}`, {
        isGameActive: room.isGameActive,
        hasGameState: !!room.gameState,
        hasGameLoop: hasGameLoop,
        isCountdownActive: isCountdownActive,
        gameHasStarted: gameHasStarted,
        startTime: room.gameState?.startTime || 0
      });

      if (!room.isGameActive && room.gameState && !hasGameLoop && !isCountdownActive && gameHasStarted) {
        room.isGameActive = true;
        room.isPaused = false;
        gameLogic.startGameLoop(room, io, room.enablePowerups || false, null);
        console.log(`Restarted game loop for multiplayer room ${roomCode} after player reconnection`);
      } else if (!room.isGameActive && room.gameState && hasGameLoop && !isCountdownActive && gameHasStarted) {
        // Game loop exists but room is marked inactive - just reactivate
        room.isGameActive = true;
        room.isPaused = false;
        console.log(`Reactivated multiplayer room ${roomCode} after player reconnection`);
      } else if (!room.isGameActive && room.gameState && !isCountdownActive && gameHasStarted) {
        // Room exists but game loop doesn't - restart it (only if game has started)
        room.isGameActive = true;
        room.isPaused = false;
        gameLogic.startGameLoop(room, io, room.enablePowerups || false, null);
        console.log(`Restarted game loop for multiplayer room ${roomCode} (game loop was missing)`);
      } else {
        // Log why we're skipping - with detailed reason
        let skipReason = '';
        if (isCountdownActive) {
          skipReason = 'countdown active';
        } else if (!gameHasStarted) {
          skipReason = 'game not started';
        } else if (room.isGameActive) {
          skipReason = 'game already active';
        } else if (!room.gameState) {
          skipReason = 'no game state';
        } else {
          skipReason = 'unknown reason';
        }
        console.log(`Skipping game loop restart for room ${roomCode} - ${skipReason}`);
        devLog.log(`[GAME LOOP SKIP] Room ${roomCode}`, {
          reason: skipReason,
          isGameActive: room.isGameActive,
          hasGameState: !!room.gameState,
          hasGameLoop: hasGameLoop,
          isCountdownActive: isCountdownActive,
          gameHasStarted: gameHasStarted
        });
      }
      
      // Send game state to player
      const socketObj = io.sockets.sockets.get(socket.id);
      if (socketObj) {
        socketObj.emit('gameStarted', {
          gameState: room.gameState,
          roomCode: roomCode,
          playerId: playerId,
          gameMode: room.gameMode
        });
      } else {
        io.to(socket.id).emit('gameStarted', {
          gameState: room.gameState,
          roomCode: roomCode,
          playerId: playerId,
          isHost: player ? player.isHost : false,
          gameMode: room.gameMode
        });
      }
      return;
    }
    
    // For single-player and solo games, always ensure player is in room and game loop is running
    if ((room.gameMode === 'single-player' || room.gameMode === 'solo') && room.gameState) {
      const gameLoops = gameLogic.gameLoops || new Map();
      const hasGameLoop = gameLoops.has(roomCode);
      
      let playerId = getPlayerIdFromSocket(room, socket.id);
      // Removed playerToken reconnection - player must be connected via socket ID
      // If player disconnected, their token was deleted and they cannot reconnect

      let player = playerId ? room.players.get(playerId) : null;
      
      // For single-player/solo, find the human player if not found by socket
      if (!player) {
        player = Array.from(room.players.values()).find(p => p.type === 'human') || null;
        playerId = player ? player.id : null;
      }

      if (!player || !playerId) {
        socket.emit('gameStateError', {
          message: 'Player not found. Please start a new game.',
          roomCode: roomCode
        });
        return;
      }

      // For single-player/solo: allow reconnection to own game (it's their solo game)
      // For multiplayer: reconnection disabled - sessions expire immediately on refresh
      if (player.disconnected && room.gameMode === 'multi-player') {
        socket.emit('gameStateError', {
          message: 'Session expired. Please rejoin the room.',
          roomCode: roomCode
        });
        return;
      }

      // For single-player/solo: allow reconnection, clear disconnected status, restore alive status
      if (player.disconnected) {
        player.disconnected = false;
        player.disconnectedAt = null;
        
        // Restore player's alive status if game state exists
        if (room.gameState && room.gameState.players[playerId]) {
          room.gameState.players[playerId].isAlive = true;
          devLog.log(`Restored alive status for reconnected player ${player.name} in single-player game`);
        }
        
        devLog.log(`Reconnected player ${player.name} to single-player game in room ${roomCode}`);
      }

      player.socketId = socket.id;
      mapSocketToPlayer(room, socket.id, playerId);
      socket.join(roomCode);
      if (room.countdownActive && room.countdownValue !== null) {
        socket.emit('gameCountdown', { countdown: room.countdownValue });
      }
      
      // Always restart game loop if not active or if loop doesn't exist
      // BUT: Don't start if countdown is active or game hasn't started yet
      const isCountdownActiveSP = room.countdownActive === true;
      const gameHasStartedSP = room.gameState && room.gameState.startTime && room.gameState.startTime > 0;
      
      // Log detailed state for debugging
      devLog.log(`[GAME LOOP RESTART CHECK] Single-player room ${roomCode}`, {
        isGameActive: room.isGameActive,
        hasGameState: !!room.gameState,
        hasGameLoop: hasGameLoop,
        isCountdownActive: isCountdownActiveSP,
        gameHasStarted: gameHasStartedSP,
        startTime: room.gameState?.startTime || 0
      });
      
      if ((!room.isGameActive || !hasGameLoop) && !isCountdownActiveSP && gameHasStartedSP) {
        room.isGameActive = true;
        room.isPaused = false;
        // Restart game loop
        gameLogic.startGameLoop(room, io, room.enablePowerups || false, room.npcs);
        console.log(`Restarted single-player game for reconnected player ${socket.id} in room ${roomCode}`);
      } else {
        // Log why we're skipping - with detailed reason
        let skipReason = '';
        if (isCountdownActiveSP) {
          skipReason = 'countdown active';
        } else if (!gameHasStartedSP) {
          skipReason = 'game not started';
        } else if (room.isGameActive && hasGameLoop) {
          skipReason = 'game already active and loop exists';
        } else {
          skipReason = 'unknown reason';
        }
        console.log(`Skipping game loop restart for single-player room ${roomCode} - ${skipReason}`);
        devLog.log(`[GAME LOOP SKIP] Single-player room ${roomCode}`, {
          reason: skipReason,
          isGameActive: room.isGameActive,
          hasGameState: !!room.gameState,
          hasGameLoop: hasGameLoop,
          isCountdownActive: isCountdownActiveSP,
          gameHasStarted: gameHasStartedSP
        });
      }
    }
    
    console.log(`Sending game state to ${socket.id} for room ${roomCode}`);
    const player = getPlayerBySocket(room, socket.id);
    socket.emit('gameStarted', {
      gameState: room.gameState,
      roomCode: roomCode,
      playerId: player ? player.id : socket.id,
      isHost: player ? player.isHost : false,
      gameMode: room.gameMode
    });
  });

  // Handle player input
  socket.on('playerInput', (data) => {
    const { roomCode, direction } = data;
    const room = rooms.get(roomCode);
    
    devLog.log('playerInput received:', { socketId: socket.id, roomCode, direction, roomExists: !!room, isGameActive: room?.isGameActive, isPaused: room?.isPaused });
    
    // Reject input if game is not active, paused, or countdown is still active
    if (!room || !room.isGameActive || room.isPaused || (room.countdownActive === true && room.countdownValue !== null && room.countdownValue > 0)) {
      devLog.warn('Input rejected: Game not active, paused, or countdown active', { 
        roomExists: !!room, 
        isGameActive: room?.isGameActive, 
        isPaused: room?.isPaused,
        countdownActive: room?.countdownActive,
        countdownValue: room?.countdownValue
      });
      socket.emit('inputRejected', { reason: room?.countdownActive ? 'Countdown in progress' : 'Game not active or paused' });
      return;
    }

    // First, try to get player ID from socket mapping (for reconnected players)
    const playerId = getPlayerIdFromSocket(room, socket.id);
    const player = playerId ? room.players.get(playerId) : null;
    devLog.log(`Looking for player with playerId: ${playerId}, found: ${!!player}`);
    
    devLog.log(`Player lookup result:`, { 
      playerId, 
      socketId: socket.id, 
      playerFound: !!player, 
      playerName: player?.name, 
      playerType: player?.type,
      isHost: player?.isHost,
      allPlayerIds: Array.from(room.players.keys()),
      socketToPlayerIdMap: room.socketToPlayerId ? Array.from(room.socketToPlayerId.entries()) : []
    });
    
    if (!player || player.type !== 'human') {
      devLog.error(`Input rejected: Player not found or not human`, { playerId, socketId: socket.id, playerExists: !!player, playerType: player?.type });
      socket.emit('inputRejected', { reason: 'Player not found or not human' });
      return;
    }

    // Get player from gameState using playerId
    const gameStatePlayer = room.gameState?.players[playerId];
    const gameStatePlayerId = playerId;
    
    devLog.log(`GameState player lookup:`, {
      playerId,
      gameStatePlayerExists: !!gameStatePlayer,
      gameStatePlayerName: gameStatePlayer?.name,
      gameStatePlayerIsAlive: gameStatePlayer?.isAlive,
      allGameStatePlayerIds: room.gameState ? Object.keys(room.gameState.players) : []
    });

    // Check if player is alive in game state
    if (!gameStatePlayer) {
      devLog.error(`Input rejected: Player not found in gameState`, { playerId, socketId: socket.id, playerName: player.name });
      socket.emit('inputRejected', { reason: 'Player not found in game state' });
      return;
    }

    if (!gameStatePlayer.isAlive) {
      devLog.error(`Input rejected: Player is collided`, { playerId, socketId: socket.id, playerName: player.name, isAlive: gameStatePlayer.isAlive });
      socket.emit('inputRejected', { reason: 'Player has collided' });
      return;
    }

    devLog.log(`Processing input for player ${player.name} (${playerId}): ${direction}`);
    gameLogic.processPlayerInput(room, gameStatePlayerId, direction);
  });

  // Handle pause/resume/quit
  socket.on('pauseGame', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    
    // Check if room exists and game has started (either during countdown or during active gameplay)
    if (!room || !room.gameState || (!room.countdownActive && !room.isGameActive)) {
      socket.emit('pauseError', { message: 'Game not active' });
      return;
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player || player.type !== 'human') {
      socket.emit('pauseError', { message: 'Player not found' });
      return;
    }

    // All players can pause in all modes
    // Solo/single-player: unlimited pause time
    // Multiplayer: 15 minutes max pause time
    const isSoloMode = room.gameMode === 'solo' || room.gameMode === 'single-player';
    
    // Check pause time limit for multiplayer (15 minutes max)
    if (!isSoloMode) {
      const maxPauseTime = 15 * 60 * 1000; // 15 minutes in milliseconds
      const totalPauseTime = room.gameState?.totalPauseTime || 0;
      
      if (totalPauseTime >= maxPauseTime) {
        socket.emit('pauseError', { message: 'Pause time limit (15 min) reached. Cannot pause anymore.' });
        return;
      }
    }

    room.isPaused = true;
    room.pausedBy = player.name;
    gameLogic.pauseGame(room);

    io.to(roomCode).emit('gamePaused', {
      pausedBy: player.name
    });
    
    // Send gameStateUpdate to ensure all players sync pause state
    if (room.gameState) {
      io.to(roomCode).emit('gameStateUpdate', {
        gameState: room.gameState
      });
    }
  });

  socket.on('resumeGame', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    
    // Check if room exists and game has started (either during countdown or during active gameplay)
    if (!room || !room.gameState || (!room.countdownActive && !room.isGameActive)) {
      socket.emit('resumeError', { message: 'Game not active' });
      return;
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player || player.type !== 'human') {
      socket.emit('resumeError', { message: 'Player not found' });
      return;
    }

    // Check if game is actually paused
    if (!room.isPaused && !room.gameState.isPaused) {
      socket.emit('resumeError', { message: 'Game is not paused' });
      return;
    }

    // Start resume countdown (5 seconds) before actually resuming
    startResumeCountdownForRoom(room, roomCode, io, player.name);
  });

  socket.on('quitGame', (data) => {
    const { roomCode, leaveType } = data; // leaveType: 'alone' or 'withParty'
    const room = rooms.get(roomCode);
    
    if (!room) {
      return;
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player || player.type !== 'human') {
      return;
    }
    
    // For solo/single-player modes: always end the game completely
    if (room.gameMode === 'solo' || room.gameMode === 'single-player') {
      console.log(`Player ${player.name} quit ${room.gameMode} game, ending game`);
      
      // Mark player as dead in game state
      if (room.gameState && room.gameState.players[player.id]) {
        const gameStatePlayer = room.gameState.players[player.id];
        gameStatePlayer.isAlive = false;
        if (room.enablePowerups) {
          const powerups = require('./powerups');
          if (powerups && powerups.cancelPlayerPowerUps) {
            powerups.cancelPlayerPowerUps(gameStatePlayer);
          }
        }
      }
      
      // Check win condition (player loses)
      if (room.gameState) {
        gameLogic.checkWinCondition(room.gameState, false, room);
      }
      
      // Stop game loop and end game
      room.isGameActive = false;
      gameLogic.stopGameLoop(room);
      
      // Prepare player status information
      const players = room.gameState ? Object.values(room.gameState.players) : [];
      const alivePlayers = players.filter(p => p.isAlive).map(p => ({ id: p.id, name: p.name, type: p.type, score: p.score }));
      const deadPlayers = players.filter(p => !p.isAlive).map(p => ({ id: p.id, name: p.name, type: p.type, score: p.score }));
      
      // Emit gameEnded event
      if (room.gameState) {
        io.to(roomCode).emit('gameEnded', {
          winner: room.gameState.winner,
          gameState: room.gameState,
          gameMode: room.gameMode,
          alivePlayers: alivePlayers,
          deadPlayers: deadPlayers,
          roomCode: roomCode
        });
      }
      
      // Mark session as ended and clean up
      markSessionAsEnded(roomCode, 'player_quit');
      removePublicRoom(roomCode);
      rooms.delete(roomCode);
      
      return;
    }
    
    if (player.isHost && room.isPublic) {
      room.isPublic = false;
      removePublicRoom(roomCode);
      broadcastPublicRooms(io);
    }

    // If host chooses "leave with party", end game for everyone
    if (player.isHost && leaveType === 'withParty') {
      room.isGameActive = false;
      gameLogic.stopGameLoop(room);
      removePublicRoom(roomCode);
      rooms.delete(roomCode);
      io.to(roomCode).emit('gameQuit', {
        quitBy: player.name,
        reason: 'Host quit and closed the game'
      });
      return;
    }

    // Mark player as dead in game state (their snake stops moving)
    if (room.gameState) {
      // Mark by player ID
      if (room.gameState.players[player.id]) {
        room.gameState.players[player.id].isAlive = false;
        // Cancel power-ups on quit
        if (room.enablePowerups) {
          const powerups = require('./powerups');
          if (powerups && powerups.cancelPlayerPowerUps) {
            powerups.cancelPlayerPowerUps(room.gameState.players[player.id]);
          }
        }
      }
      
      // Also mark by name (in case of reconnection mismatch)
      Object.keys(room.gameState.players).forEach(playerId => {
        if (room.gameState.players[playerId].name === player.name && 
            room.gameState.players[playerId].type === 'human') {
          room.gameState.players[playerId].isAlive = false;
          // Cancel power-ups on quit
          if (room.enablePowerups) {
            const powerups = require('./powerups');
            if (powerups && powerups.cancelPlayerPowerUps) {
              powerups.cancelPlayerPowerUps(room.gameState.players[playerId]);
            }
          }
          devLog.log(`Marked player ${player.name} (${playerId}) as dead on quit`);
        }
      });
      
      devLog.log(`Player ${player.name} quit game, marked as dead`);
      
      // Send gameStateUpdate to all players so they see the snake stop immediately
      if (room.isGameActive && room.gameState) {
        io.to(roomCode).emit('gameStateUpdate', {
          gameState: room.gameState,
          playerId: player.id
        });
      }
    }

    // Store wasHost BEFORE removing player from room
    const wasHost = player.isHost;
    const playerName = player.name;

    // Remove player from room
    room.players.delete(player.id);
    if (room.playerTokens && player.token) {
      room.playerTokens.delete(player.token);
    }
    if (room.socketToPlayerId) {
      room.socketToPlayerId.delete(socket.id);
    }
    socket.leave(roomCode);

    // Check if only one player remains (after removing the quitting player)
    const remainingPlayerCount = room.players.size;
    
    // If only one player left and game is active, end the game
    if (remainingPlayerCount === 1 && room.isGameActive && room.gameState) {
      const lastPlayer = Array.from(room.players.values())[0];
      devLog.log(`Only one player (${lastPlayer.name}) remaining, ending game`);
      
      // Mark all other players as dead in game state (they already are)
      // Check win condition to determine winner
      gameLogic.checkWinCondition(room.gameState, false, room);
      
      // Stop game loop
      room.isGameActive = false;
      gameLogic.stopGameLoop(room);
      
      // Emit gameEnded event
      const alivePlayers = Object.values(room.gameState.players).filter(p => p.isAlive);
      const deadPlayers = Object.values(room.gameState.players).filter(p => !p.isAlive);
      
      io.to(roomCode).emit('gameEnded', {
        winner: room.gameState.winner,
        gameState: room.gameState,
        gameMode: room.gameMode,
        alivePlayers: alivePlayers,
        deadPlayers: deadPlayers,
        roomCode: roomCode
      });
      
      // Clean up room after delay
      setTimeout(() => {
        const checkRoom = rooms.get(roomCode);
        if (checkRoom && !checkRoom.isGameActive) {
          removePublicRoom(roomCode);
          markSessionAsEnded(roomCode, 'game_ended');
          rooms.delete(roomCode);
        }
      }, 10000);
      
      return;
    }

    // Only end game if host quit and no other players, OR if all players quit
    if (wasHost && remainingPlayerCount === 0) {
      // Host quit and no other players - end game and close room
      room.isGameActive = false;
      gameLogic.stopGameLoop(room);
      removePublicRoom(roomCode);
      markSessionAsEnded(roomCode, 'host_quit_no_players');
      rooms.delete(roomCode);
      io.to(roomCode).emit('gameQuit', {
        quitBy: playerName,
        reason: 'Host quit and room closed'
      });
    } else if (remainingPlayerCount === 0) {
      // All players quit - end game
      room.isGameActive = false;
      gameLogic.stopGameLoop(room);
      removePublicRoom(roomCode);
      markSessionAsEnded(roomCode, 'all_players_quit');
      rooms.delete(roomCode);
      io.to(roomCode).emit('gameQuit', {
        quitBy: playerName,
        reason: 'All players quit'
      });
    } else {
      // Player quit but others still playing - notify them
      devLog.log(`Emitting playerQuit for ${playerName} (wasHost: ${wasHost}) to room ${roomCode}`);
      io.to(roomCode).emit('playerQuit', {
        playerName: playerName,
        reason: 'quit',
        wasHost: wasHost, // Include wasHost flag
        players: Array.from(room.players.values()).map(p => ({
          id: p.id,
          name: p.name,
          isHost: p.isHost
        }))
      });
      
      // If host quit AND game has started, assign new host randomly
      if (wasHost && remainingPlayerCount > 0 && room.isGameActive) {
        const remainingPlayers = Array.from(room.players.values());
        const randomIndex = Math.floor(Math.random() * remainingPlayers.length);
        const newHost = remainingPlayers[randomIndex];
        newHost.isHost = true;
        
        // Update gameState to reflect new host
        updateGameStateHost(room, newHost.id);
        
        devLog.log(`Assigned new host randomly: ${newHost.name} (${newHost.id}) - game was active`);
        io.to(roomCode).emit('hostChanged', {
          newHostId: newHost.id,
          newHostName: newHost.name
        });
        
        // Send updated gameState to all players
        if (room.gameState) {
          io.to(roomCode).emit('gameStateUpdate', {
            gameState: room.gameState
          });
        }
      } else if (wasHost && remainingPlayerCount > 0 && !room.isGameActive) {
        // Host quit before game started - assign first player as host
        const newHost = Array.from(room.players.values())[0];
        newHost.isHost = true;
        devLog.log(`Assigned new host: ${newHost.name} (${newHost.id}) - game not started yet`);
        io.to(roomCode).emit('hostChanged', {
          newHostId: newHost.id,
          newHostName: newHost.name
        });
      }
    }
  });

  // Handle chat (if enabled)
  if (featureFlags.chat) {
    socket.on('chatMessage', (data) => {
      const { roomCode, message } = data;
      const room = rooms.get(roomCode);
      
      if (!room) {
        devLog.warn('Chat: Room not found:', roomCode);
        return;
      }

      const player = getPlayerBySocket(room, socket.id);
      
      if (!player) {
        devLog.warn('Chat: Player not found for socket:', socket.id, 'in room:', roomCode);
        devLog.warn('Chat: Available players:', Array.from(room.players.entries()).map(([id, p]) => ({ socketId: id, playerId: p.id, name: p.name, socketIdField: p.socketId })));
        devLog.warn('Chat: socketToPlayerId map:', room.socketToPlayerId ? Array.from(room.socketToPlayerId.entries()) : 'null');
        return;
      }

      const now = Date.now();
      const lastChatAt = room.lastChatAt ? room.lastChatAt.get(player.id) : 0;
      if (lastChatAt && now - lastChatAt < 800) {
        return;
      }
      if (room.lastChatAt) {
        room.lastChatAt.set(player.id, now);
      }

      const trimmedMessage = String(message || '').trim().slice(0, 200);
      if (!trimmedMessage) {
        return;
      }

      devLog.log(`Chat: ${player.name} sent message: ${trimmedMessage.substring(0, 50)}`);

      io.to(roomCode).emit('chatMessage', {
        playerName: player.name,
        message: trimmedMessage,
        timestamp: Date.now()
      });
    });
  }

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    
    for (const [roomCode, room] of rooms.entries()) {
      const playerId = getPlayerIdFromSocket(room, socket.id);
      if (!playerId) {
        continue;
      }

      const player = room.players.get(playerId);
      if (!player) {
        continue;
      }

       // If the host disconnects, make room private and remove from listing
       if (player.isHost && room.isPublic) {
         room.isPublic = false;
         removePublicRoom(roomCode);
         broadcastPublicRooms(io);
       }

      // Immediately mark session as ended when player disconnects (page refresh)
      // BUT: Only if game has actually started (not during ready phase)
      if (room.sessionId && gameSessions.has(room.sessionId)) {
        const session = gameSessions.get(room.sessionId);
        // Only mark as ended if game has started (startTime > 0)
        // During ready phase (before game starts), don't mark session as ended yet
        const gameHasStarted = room.gameState && room.gameState.startTime && room.gameState.startTime > 0;
        if (!session.endTime && gameHasStarted) {
          session.endTime = Date.now();
          session.endReason = 'page_refresh_disconnect';
          devLog.log(`Session ${room.sessionId} marked as ended immediately on disconnect (game had started)`);
        } else if (!session.endTime && !gameHasStarted) {
          // Game hasn't started yet - player can still rejoin during ready phase
          devLog.log(`Session ${room.sessionId} - player disconnected during ready phase, session not ended yet`);
        }
      }

      if (room.socketToPlayerId) {
        room.socketToPlayerId.delete(socket.id);
      }

      // Delete player token immediately on disconnect to prevent reconnection
      // BUT: Keep token during ready phase (before game starts) for multiplayer to allow reconnection
      const gameHasStarted = room.gameState && room.gameState.startTime && room.gameState.startTime > 0;
      if (room.playerTokens && player.token) {
        if (gameHasStarted || room.gameMode !== 'multi-player') {
          // Game has started OR not multiplayer - delete token (no reconnection)
          room.playerTokens.delete(player.token);
          devLog.log(`Deleted player token for ${player.name} on disconnect - session expired (game started or not multiplayer)`);
        } else {
          // Game hasn't started yet (ready phase) - keep token for reconnection
          devLog.log(`Keeping player token for ${player.name} - game hasn't started yet (ready phase)`);
        }
      }

      if (room.isGameActive) {
        player.disconnected = true;
        player.disconnectedAt = Date.now();
        player.socketId = null;

        // For solo/single-player modes: pause game on disconnect, allow reconnection
        // (Multiplayer: sessions expire immediately, no reconnection)
        if (room.gameMode === 'solo' || room.gameMode === 'single-player') {
          console.log(`Player ${player.name} disconnected from ${room.gameMode} game, pausing game (allowing reconnection)`);
          
          // Pause the game instead of ending it - player can reconnect
          room.isGameActive = false;
          room.isPaused = true;
          gameLogic.stopGameLoop(room);
          
          // Don't mark player as dead or end game - allow reconnection
          // Don't continue with disconnect logic - just pause
          break;
        } else if (room.gameMode === 'multi-player') {
          // Store wasHost BEFORE any changes
          const wasHost = player.isHost;
          const playerName = player.name;
          
          // For multiplayer: Mark player as dead when they disconnect
          if (room.gameState && room.gameState.players[player.id]) {
            const gameStatePlayer = room.gameState.players[player.id];
            gameStatePlayer.isAlive = false;
            if (room.enablePowerups) {
              const powerups = require('./powerups');
              if (powerups && powerups.cancelPlayerPowerUps) {
                powerups.cancelPlayerPowerUps(gameStatePlayer);
              }
            }
            devLog.log(`Marked player ${playerName} (${player.id}) as dead on disconnect`);
          }

          devLog.log(`Player ${playerName} disconnected from multiplayer game, marked as dead`);

          // Check connected players (excluding the one disconnecting)
          const remainingConnectedPlayers = Array.from(room.players.values()).filter(p => p.socketId && p.id !== player.id);
          
          // If only one connected player left and game is active, end the game
          if (remainingConnectedPlayers.length === 1 && room.isGameActive && room.gameState) {
            const lastPlayer = remainingConnectedPlayers[0];
            devLog.log(`Only one connected player (${lastPlayer.name}) remaining after disconnect, ending game`);
            
            // Check win condition to determine winner
            gameLogic.checkWinCondition(room.gameState, false, room);
            
            // Stop game loop
            room.isGameActive = false;
            gameLogic.stopGameLoop(room);
            
            // Emit gameEnded event
            const alivePlayers = Object.values(room.gameState.players).filter(p => p.isAlive);
            const deadPlayers = Object.values(room.gameState.players).filter(p => !p.isAlive);
            
            io.to(roomCode).emit('gameEnded', {
              winner: room.gameState.winner,
              gameState: room.gameState,
              gameMode: room.gameMode,
              alivePlayers: alivePlayers,
              deadPlayers: deadPlayers,
              roomCode: roomCode
            });
            
            // Clean up room after delay
            setTimeout(() => {
              const checkRoom = rooms.get(roomCode);
              if (checkRoom && !checkRoom.isGameActive) {
                removePublicRoom(roomCode);
                markSessionAsEnded(roomCode, 'game_ended');
                rooms.delete(roomCode);
              }
            }, 10000);
            
            // Don't continue with disconnect logic since game ended
            break;
          }

          if (remainingConnectedPlayers.length > 0) {
            devLog.log(`Emitting playerLeft for ${playerName} (wasHost: ${wasHost}) to room ${roomCode}`);
            io.to(roomCode).emit('playerLeft', {
              playerName: playerName,
              reason: 'disconnected',
              wasHost: wasHost,
              players: remainingConnectedPlayers.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost
              }))
            });
            
            // If host disconnected AND game has started, assign new host randomly from connected players
            if (wasHost && remainingConnectedPlayers.length > 0 && room.isGameActive) {
              const randomIndex = Math.floor(Math.random() * remainingConnectedPlayers.length);
              const newHost = remainingConnectedPlayers[randomIndex];
              newHost.isHost = true;
              
              // Update gameState to reflect new host
              updateGameStateHost(room, newHost.id);
              
              devLog.log(`Assigned new host randomly: ${newHost.name} (${newHost.id}) - game was active`);
              io.to(roomCode).emit('hostChanged', {
                newHostId: newHost.id,
                newHostName: newHost.name
              });
              
              // Send updated gameState to all players
              if (room.gameState) {
                io.to(roomCode).emit('gameStateUpdate', {
                  gameState: room.gameState
                });
              }
            }
          }

          const connectedPlayers = Array.from(room.players.values()).filter(p => p.socketId && p.id !== player.id);
          if (connectedPlayers.length === 0) {
            room.isGameActive = false;
            gameLogic.stopGameLoop(room);
            console.log(`All players left room ${roomCode}, game paused (waiting for reconnection)`);

            if (roomCleanupTimeouts.has(roomCode)) {
              clearTimeout(roomCleanupTimeouts.get(roomCode));
            }

            // For ready phase (game not started), give more time for reconnection
            const gameStartedForCleanup = room.gameState && room.gameState.startTime && room.gameState.startTime > 0;
            const roomCleanupTimeout = gameStartedForCleanup ? 10000 : 30000; // 30 seconds during ready phase, 10 seconds after game starts
            devLog.log(`Setting room cleanup timeout for ${roomCode}: ${roomCleanupTimeout}ms (gameStarted: ${gameStartedForCleanup})`);
            
            const timeoutId = setTimeout(() => {
              const checkRoom = rooms.get(roomCode);
              const activePlayers = checkRoom ? Array.from(checkRoom.players.values()).filter(p => p.socketId) : [];
              if (checkRoom && activePlayers.length === 0) {
              removePublicRoom(roomCode);
                markSessionAsEnded(roomCode, 'all_players_disconnected');
                rooms.delete(roomCode);
                roomCleanupTimeouts.delete(roomCode);
                console.log(`Room ${roomCode} deleted after timeout (no reconnection)`);
              }
            }, roomCleanupTimeout);

            roomCleanupTimeouts.set(roomCode, timeoutId);
          }
        }
      } else if (room.gameState && room.gameMode === 'multi-player') {
        // Pre-start multiplayer: keep token during ready phase, delete only if game started
        const gameHasStarted = room.gameState.startTime && room.gameState.startTime > 0;
        if (room.playerTokens && player.token) {
          if (gameHasStarted) {
            // Game has started - delete token (no reconnection)
            room.playerTokens.delete(player.token);
            devLog.log(`Deleted player token for ${player.name} on pre-start disconnect - game started`);
          } else {
            // Game hasn't started yet (ready phase) - keep token for reconnection
            devLog.log(`Keeping player token for ${player.name} on pre-start disconnect - ready phase`);
          }
        }
        player.disconnected = true;
        player.disconnectedAt = Date.now();
        player.socketId = null;

        if (player.disconnectTimeoutId) {
          clearTimeout(player.disconnectTimeoutId);
        }

        // For ready phase (game not started), give more time for reconnection
        const gameStartedForTimeout = room.gameState && room.gameState.startTime && room.gameState.startTime > 0;
        const disconnectTimeout = gameStartedForTimeout ? 10000 : 30000; // 30 seconds during ready phase, 10 seconds after game starts
        
        player.disconnectTimeoutId = setTimeout(() => {
          const currentRoom = rooms.get(roomCode);
          if (!currentRoom) {
            return;
          }
          const currentPlayer = currentRoom.players.get(playerId);
          if (!currentPlayer || currentPlayer.socketId || !currentPlayer.disconnected) {
            return;
          }

          const wasHost = currentPlayer.isHost;
          currentRoom.players.delete(playerId);
          // Only delete token if game has started (keep during ready phase for reconnection)
          if (currentRoom.playerTokens && currentPlayer.token) {
            const gameStarted = currentRoom.gameState && currentRoom.gameState.startTime && currentRoom.gameState.startTime > 0;
            if (gameStarted) {
              currentRoom.playerTokens.delete(currentPlayer.token);
            }
          }
          if (currentRoom.readyPlayers) {
            currentRoom.readyPlayers.delete(playerId);
          }

          if (wasHost && currentRoom.players.size > 0) {
            const newHost = Array.from(currentRoom.players.values())[0];
            newHost.isHost = true;
            
            // Update gameState if game is active
            if (currentRoom.isGameActive) {
              updateGameStateHost(currentRoom, newHost.id);
            }
            
            io.to(roomCode).emit('hostChanged', {
              newHostId: newHost.id,
              newHostName: newHost.name
            });
            
            // Send updated gameState if game is active
            if (currentRoom.isGameActive && currentRoom.gameState) {
              io.to(roomCode).emit('gameStateUpdate', {
                gameState: currentRoom.gameState
              });
            }
          }

          io.to(roomCode).emit('playerLeft', {
            playerName: currentPlayer.name,
            reason: 'disconnected',
            wasHost,
            players: Array.from(currentRoom.players.values()).map(p => ({
              id: p.id,
              name: p.name,
              isHost: p.isHost
            }))
          });

          if (currentRoom.readyPlayers) {
            io.to(roomCode).emit('playerReadyStatus', {
              readyPlayers: Array.from(currentRoom.readyPlayers).map(id => String(id))
            });
          }

          if (currentRoom.players.size === 0) {
            if (roomCleanupTimeouts.has(roomCode)) {
              clearTimeout(roomCleanupTimeouts.get(roomCode));
            }

            const timeoutId = setTimeout(() => {
              const checkRoom = rooms.get(roomCode);
              const activePlayers = checkRoom ? Array.from(checkRoom.players.values()).filter(p => p.socketId) : [];
              if (checkRoom && activePlayers.length === 0) {
                removePublicRoom(roomCode);
                markSessionAsEnded(roomCode, 'all_players_disconnected');
                rooms.delete(roomCode);
                roomCleanupTimeouts.delete(roomCode);
                console.log(`Room ${roomCode} deleted after timeout (no reconnection)`);
              }
            }, 5000);

            roomCleanupTimeouts.set(roomCode, timeoutId);
          }
        }, 5000);
      } else if (room.gameState && (room.gameMode === 'single-player' || room.gameMode === 'solo')) {
        player.disconnected = true;
        player.disconnectedAt = Date.now();
        player.socketId = null;
      } else {
        room.players.delete(playerId);
        if (room.playerTokens && player.token) {
          room.playerTokens.delete(player.token);
        }

        if (player.isHost && room.players.size > 0) {
          const newHost = Array.from(room.players.values())[0];
          newHost.isHost = true;
          
          // Update gameState if game is active
          if (room.isGameActive) {
            updateGameStateHost(room, newHost.id);
          }
          
          io.to(roomCode).emit('hostChanged', {
            newHostId: newHost.id,
            newHostName: newHost.name
          });
          
          // Send updated gameState if game is active
          if (room.isGameActive && room.gameState) {
            io.to(roomCode).emit('gameStateUpdate', {
              gameState: room.gameState
            });
          }
        }

        io.to(roomCode).emit('playerLeft', {
          playerName: player.name,
          players: Array.from(room.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost
          }))
        });

        if (room.players.size === 0 && !room.isGameActive && !room.gameState) {
          if (roomCleanupTimeouts.has(roomCode)) {
            clearTimeout(roomCleanupTimeouts.get(roomCode));
            roomCleanupTimeouts.delete(roomCode);
          }
          removePublicRoom(roomCode);
          markSessionAsEnded(roomCode, 'room_empty');
          rooms.delete(roomCode);
        }
      }

      break;
    }
  });
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Display available IP addresses for network connections
const os = require('os');
const networkInterfaces = os.networkInterfaces();
const allAddresses = [];
Object.keys(networkInterfaces).forEach((iface) => {
  networkInterfaces[iface].forEach((addr) => {
    if (addr.family === 'IPv4' && !addr.internal) {
      allAddresses.push(addr.address);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  if (allAddresses.length > 0) {
    console.log(`Available IP addresses:`, allAddresses.join(', '));
  }
  devLog.log(`Feature flags:`, featureFlags);
  devLog.log(`Dev mode: ${isDevMode ? 'ENABLED' : 'DISABLED'}`);
  
  // Log game session summary periodically in dev mode
  if (isDevMode) {
    setInterval(() => {
      // Only count sessions as active if game has actually started (not just created)
      const activeSessions = Array.from(gameSessions.values()).filter(s => {
        if (s.endTime) return false; // Already ended
        if (!s.roomCode || !rooms.has(s.roomCode)) return false; // Room doesn't exist
        const room = rooms.get(s.roomCode);
        // Game is active only if game loop is running or game has actually started
        return room && (
          room.isGameActive === true || 
          (room.gameState && room.gameState.startTime && room.gameState.startTime > 0)
        );
      });
      devLog.log(`[GAME SESSION SUMMARY]`, {
        timestamp: new Date().toISOString(),
        totalSessions: gameSessionCount,
        activeSessions: activeSessions.length,
        completedSessions: gameSessionCount - activeSessions.length,
        activeRooms: rooms.size,
        roomCodes: Array.from(rooms.keys()),
        recentSessions: Array.from(gameSessions.entries())
          .map(([sessionId, s]) => ({
            sessionId: s.sessionId || sessionId, // Use sessionId from object or Map key
            roomCode: s.roomCode,
            gameMode: s.gameMode,
            startTime: new Date(s.startTime).toISOString(),
            endTime: s.endTime ? new Date(s.endTime).toISOString() : null,
            duration: s.endTime ? `${Math.floor((s.endTime - s.startTime) / 1000)}s` : 'active',
            winner: s.winner,
            playerCount: s.players.length
          }))
          .slice(-5)
      });
    }, 30000); // Every 30 seconds
  }
});
