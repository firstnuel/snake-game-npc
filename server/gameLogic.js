const { GRID_WIDTH, GRID_HEIGHT, CELL_SIZE } = require('./config');

// Access to rooms and gameSessions from index.js (will be set by index.js)
let rooms = null;
let gameSessions = null;
let getGameSessionCount = null;

// Function to set references (called by index.js)
function setDevModeRefs(roomsRef, gameSessionsRef, getGameSessionCountRef) {
  rooms = roomsRef;
  gameSessions = gameSessionsRef;
  getGameSessionCount = getGameSessionCountRef;
}
const BASE_TICK_RATE = 5; // Starting speed (very slow - 5 updates per second)
const SPEED_INCREASE_PER_LEVEL = 2; // Increase by 2 ticks/second per level
const FOOD_PER_LEVEL = 5; // Level increases every 5 food items eaten

// Game state management
let gameLoops = new Map(); // roomCode -> intervalId
let powerupsModule = null;
let npcAIModule = null;

// Lazy load NPC AI module
function getNPCModule() {
  if (!npcAIModule) {
    try {
      npcAIModule = require('./npcAI');
    } catch (e) {
      console.warn('NPC AI module not available');
    }
  }
  return npcAIModule;
}

// Calculate level based on total food eaten
function calculateLevel(totalFoodEaten) {
  return Math.floor(totalFoodEaten / FOOD_PER_LEVEL) + 1;
}

// Calculate total food eaten across all players
function calculateTotalFoodEaten(gameState) {
  return gameState.totalFoodEaten || 0;
}

// Calculate tick rate based on level
function calculateTickRate(level, gameMode = null) {
  const MAX_TICK_RATE = 16;
  let baseTickRate = BASE_TICK_RATE + (level - 1) * SPEED_INCREASE_PER_LEVEL;
  
  // Apply 1.5% speed increase for solo mode
  if (gameMode === 'solo') {
    baseTickRate = baseTickRate * 1.015; // 1.5% faster = multiply by 1.015
  }
  
  return Math.min(baseTickRate, MAX_TICK_RATE);
}

// Lazy load powerups module if feature flag is enabled
function getPowerupsModule() {
  if (!powerupsModule) {
    try {
      powerupsModule = require('./powerups');
    } catch (e) {
      console.warn('Power-ups module not available');
    }
  }
  return powerupsModule;
}

function getPlayerSpeedFactor(player, powerups) {
  let factor = 1;
  if (powerups) {
    if (powerups.hasActivePowerUp(player, 'speedBoost')) {
      factor *= 2;
    }
    if (powerups.hasActivePowerUp(player, 'slowed')) {
      factor *= 0.5;
    }
  }
  return factor;
}

function createGameState(players, enablePowerups = false, wallMode = false, timeLimit = null, strictMode = false) {
  const gameState = {
    players: {},
    food: [],
    timer: 0,
    startTime: 0, // Will be set when game loop actually starts (after countdown)
    pauseStartTime: null, // Track when game was paused
    totalPauseDuration: 0, // Track total pause duration
    totalPauseTime: 0, // Cumulative pause time (for pause limit)
    isPaused: false,
    winner: null,
    level: 1, // Start at level 1
    totalFoodEaten: 0, // Track total food eaten across all players
    wallMode: wallMode, // Wall mode: true = walls kill, false = wrapping
    strictMode: strictMode, // Strict mode: true = all body collisions fatal, false = only head collisions fatal
    timeLimit: timeLimit ? timeLimit * 60 * 1000 : null, // Convert minutes to milliseconds
    lastPlayerInputTime: {}, // Track last input time for each player (for inactivity detection)
    inactivityWarnings: {}, // Track which players have been warned about inactivity
    tickCount: 0,
    lastInputTick: {},
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
    cellSize: CELL_SIZE,
    lastSurvivorSince: null
  };

  if (enablePowerups) {
    gameState.powerups = [];
    gameState.lastPowerUpSpawnTime = undefined; // Will be initialized on first spawn attempt
  }

  // Initialize each player's snake with main colors: Red, Green (sharp), Blue (sharp), Yellow
  const colorPalette = [
    '#FF0000', // Red
    '#00FF00', // Green (sharp)
    '#0000FF', // Blue (sharp)
    '#FFFF00'  // Yellow
  ];
  
  const startPositions = [
    { x: 5, y: 5, dir: 'right' },
    { x: GRID_WIDTH - 6, y: GRID_HEIGHT - 6, dir: 'left' },
    { x: 5, y: GRID_HEIGHT - 6, dir: 'right' },
    { x: GRID_WIDTH - 6, y: 5, dir: 'left' }
  ];

  console.log('[gameLogic] Creating gameState with players:', players.map(p => ({ id: p.id, name: p.name, type: p.type })));

  players.forEach((player, index) => {
    const pos = startPositions[index % startPositions.length];

    // Assign colors in order: Red, Green, Blue, Yellow
    const playerData = {
      id: player.id,
      name: player.name,
      type: player.type || 'human',
      color: colorPalette[index % colorPalette.length],
      snake: [pos],
      direction: pos.dir,
      nextDirection: pos.dir,
      score: 0,
      isAlive: true, // CRITICAL: All players start alive
      survivalStartTime: Date.now(), // Track when player started surviving
      survivalTime: 0, // Will be calculated when player dies
      speedAccumulator: 0,
      isHost: player.isHost || false // Include host status in gameState
    };
    gameState.players[player.id] = playerData;
    // Initialize last input time for inactivity detection
    gameState.lastPlayerInputTime[player.id] = Date.now();
    gameState.lastInputTick[player.id] = -1;
    console.log(`[gameLogic] Created player ${player.name} (${player.id}) in gameState, color: ${playerData.color}, isAlive: ${playerData.isAlive}`);
  });

  // Verify all players are alive
  Object.keys(gameState.players).forEach(playerId => {
    const p = gameState.players[playerId];
    if (!p.isAlive) {
      console.error(`[gameLogic] ERROR: Player ${p.name} (${playerId}) is marked as DEAD in gameState creation!`);
    }
  });

  // Generate initial food
  generateFood(gameState, players.length);

  return gameState;
}

function generateFood(gameState, count = 1) {
  const occupiedCells = new Set();
  
  // Mark all snake cells as occupied
  Object.values(gameState.players).forEach(player => {
    if (player.isAlive) {
      player.snake.forEach(segment => {
        occupiedCells.add(`${segment.x},${segment.y}`);
      });
    }
  });

  // Mark existing food as occupied
  gameState.food.forEach(food => {
    occupiedCells.add(`${food.x},${food.y}`);
  });

  // Generate new food
  for (let i = 0; i < count; i++) {
    let attempts = 0;
    let x, y;
    
    do {
      x = Math.floor(Math.random() * GRID_WIDTH);
      y = Math.floor(Math.random() * GRID_HEIGHT);
      attempts++;
    } while (occupiedCells.has(`${x},${y}`) && attempts < 100);

    if (attempts < 100) {
      gameState.food.push({ x, y });
    }
  }
}

function processPlayerInput(room, playerId, direction) {
  if (!room.gameState || !room.gameState.players[playerId]) {
    return;
  }

  const player = room.gameState.players[playerId];
  if (!player.isAlive) {
    return;
  }

  // Track last input time for inactivity detection
  room.gameState.lastPlayerInputTime[playerId] = Date.now();
  
  // Clear inactivity warning when player moves
  if (room.gameState.inactivityWarnings && room.gameState.inactivityWarnings[playerId]) {
    delete room.gameState.inactivityWarnings[playerId];
  }

  const currentTick = room.gameState.tickCount || 0;
  if (room.gameState.lastInputTick[playerId] === currentTick) {
    return;
  }

  // Validate direction change (prevent opposite direction)
  const opposites = {
    'up': 'down',
    'down': 'up',
    'left': 'right',
    'right': 'left'
  };

  const currentDirection = player.nextDirection || player.direction;
  if (opposites[direction] === currentDirection) {
    return; // Can't reverse direction
  }

  // Queue direction change (will be applied on next tick)
  player.nextDirection = direction;
  room.gameState.lastInputTick[playerId] = currentTick;
}

function advancePlayers(gameState, movingPlayers, room, enablePowerups, ioInstance, powerups) {
  // First pass: Calculate all new head positions
  const newHeads = new Map(); // playerId -> { head, player, hasShield }
  movingPlayers.forEach(player => {
    if (!player.isAlive) {
      return;
    }

    // Apply queued direction change
    player.direction = player.nextDirection;

    // Calculate new head position
    const head = { ...player.snake[0] };
    if (gameState.wallMode) {
      // Wall mode: check bounds, don't wrap
      switch (player.direction) {
        case 'up':
          head.y = head.y - 1;
          break;
        case 'down':
          head.y = head.y + 1;
          break;
        case 'left':
          head.x = head.x - 1;
          break;
        case 'right':
          head.x = head.x + 1;
          break;
      }
    } else {
      // Wrapping mode (default)
      switch (player.direction) {
        case 'up':
          head.y = (head.y - 1 + GRID_HEIGHT) % GRID_HEIGHT;
          break;
        case 'down':
          head.y = (head.y + 1) % GRID_HEIGHT;
          break;
        case 'left':
          head.x = (head.x - 1 + GRID_WIDTH) % GRID_WIDTH;
          break;
        case 'right':
          head.x = (head.x + 1) % GRID_WIDTH;
          break;
      }
    }

    const hasShield = powerups && powerups.hasActivePowerUp(player, 'shield');
    newHeads.set(player.id, { head, player, hasShield });
  });

  // Check for head-to-head collisions
  const headToHeadCollisions = new Set();
  const headPositions = new Map(); // position -> [playerIds]

  newHeads.forEach((data, playerId) => {
    const posKey = `${data.head.x},${data.head.y}`;
    if (!headPositions.has(posKey)) {
      headPositions.set(posKey, []);
    }
    headPositions.get(posKey).push(playerId);
  });

  // Find head-to-head collisions (two or more heads at same position)
  headPositions.forEach((playerIds) => {
    if (playerIds.length >= 2) {
      // In solo mode, skip head-to-head collisions between human and NPC
      if (room?.gameMode === 'single-player') {
        const players = playerIds.map(id => gameState.players[id]);
        const hasHuman = players.some(p => p.type === 'human');
        const hasNPC = players.some(p => p.type === 'npc');

        // Skip collision if it's between human and NPC (they are immune to each other)
        if (hasHuman && hasNPC) {
          return; // Skip this collision - human and NPC are immune to each other
        }
      }

      // In multiplayer with no wall mode and non-strict mode: players are immune to head-to-head collisions
      if (room?.gameMode === 'multi-player' && !gameState.wallMode && !gameState.strictMode) {
        return; // Skip collision - players can walk through each other
      }

      // Head-to-head collision detected - all involved players die
      playerIds.forEach(playerId => {
        const allHaveShield = playerIds.every(id => newHeads.get(id).hasShield);
        if (!allHaveShield) {
          headToHeadCollisions.add(playerId);
        }
      });
    }
  });

  // Process collisions and movement
  movingPlayers.forEach(player => {
    if (!player.isAlive) {
      return;
    }

    const data = newHeads.get(player.id);
    if (!data) {
      return;
    }

    const { head, hasShield } = data;

    // Check head-to-head collision first
    if (headToHeadCollisions.has(player.id)) {
      // Broadcast collision notification to all players
      if (ioInstance) {
        ioInstance.to(room.code).emit('playerCollided', {
          playerName: player.name,
          collisionType: 'head-to-head'
        });
      }
      player.isAlive = false;
      // Don't zero score - keep final score for winner determination
      if (player.survivalStartTime) {
        player.survivalTime = Date.now() - player.survivalStartTime;
      }
      // Cancel power-ups on death
      if (enablePowerups && powerups && powerups.cancelPlayerPowerUps) {
        powerups.cancelPlayerPowerUps(player);
      }
      // Check win condition immediately if player died in solo or single-player mode
      const humanPlayers = Object.values(gameState.players).filter(p => p.type === 'human');
      if (humanPlayers.length === 1 && (room?.gameMode === 'single-player' || room?.gameMode === 'solo')) {
        // In solo/single-player mode, check win condition immediately after any death
        checkWinCondition(gameState, false, room);
        return;
      }
      return;
    }

    // Check other collisions (self, other snakes, walls)
    const collisionResult = checkCollision(gameState, player, head, room);
    const isCollisionDetected = collisionResult !== false && collisionResult !== null && collisionResult !== undefined;

    if (isCollisionDetected && !hasShield) {
      const collisionType = typeof collisionResult === 'object' && collisionResult.type ? collisionResult.type : 'unknown';

      // Broadcast collision notification to all players
      if (ioInstance) {
        ioInstance.to(room.code).emit('playerCollided', {
          playerName: player.name,
          collisionType: collisionType
        });
      }
      player.isAlive = false;
      // Don't zero score - keep final score for winner determination
      if (player.survivalStartTime) {
        player.survivalTime = Date.now() - player.survivalStartTime;
      }
      // Cancel power-ups on death
      if (enablePowerups && powerups && powerups.cancelPlayerPowerUps) {
        powerups.cancelPlayerPowerUps(player);
      }
      // Check win condition immediately if player died in solo or single-player mode
      const humanPlayers = Object.values(gameState.players).filter(p => p.type === 'human');
      if (humanPlayers.length === 1 && (room?.gameMode === 'single-player' || room?.gameMode === 'solo')) {
        // In solo/single-player mode, check win condition immediately after any death
        checkWinCondition(gameState, false, room);
        return;
      }
      return;
    }

    // Add new head
    player.snake.unshift(head);

    // Check if food eaten
    const foodIndex = gameState.food.findIndex(f => f.x === head.x && f.y === head.y);
    if (foodIndex !== -1) {
      // Food eaten - grow snake and increase score
      gameState.food.splice(foodIndex, 1);
      player.score += 10;
      gameState.totalFoodEaten = (gameState.totalFoodEaten || 0) + 1;

      // Update level based on total food eaten
      const newLevel = calculateLevel(gameState.totalFoodEaten);
      if (newLevel !== gameState.level) {
        gameState.level = newLevel;
      }

      generateFood(gameState, 1);
    } else {
      // Remove tail (snake moves forward)
      player.snake.pop();
    }
  });
}

function updateGameState(room, enablePowerups = false, ioInstance = null) {
  const gameState = room.gameState;
  // --- CRITICAL: Don't update game state if paused ---
  if (!gameState || room.isPaused || gameState.isPaused) {
    return;
  }
  
  // CRITICAL: Don't update game state (including collision detection) if countdown is still active
  // or if game hasn't actually started (startTime is 0)
  if (room.countdownActive === true || (gameState.startTime === 0 || gameState.startTime === null)) {
    return;
  }

  gameState.tickCount = (gameState.tickCount || 0) + 1;

  // Update timer (only if startTime is set - game has actually started)
  if (gameState.startTime && gameState.startTime > 0) {
    const currentTime = Date.now();
    const elapsedTime = currentTime - gameState.startTime - (gameState.totalPauseDuration || 0);
    gameState.timer = Math.floor(elapsedTime / 1000);
    
    // Check time limit
    if (gameState.timeLimit && elapsedTime >= gameState.timeLimit) {
      // Time limit reached - trigger game end
      checkWinCondition(gameState, true, room);
      return;
    }
  } else {
    // Game hasn't started yet (still in countdown), timer stays at 0
    gameState.timer = 0;
  }

  const powerups = enablePowerups ? getPowerupsModule() : null;

  // Power-ups system (if enabled)
  if (enablePowerups && gameState.powerups !== undefined && powerups) {
    powerups.spawnPowerUp(gameState);
    powerups.checkPowerUpCollisions(gameState, ioInstance, room.code);
    powerups.updatePowerUps(gameState);
  }
  
  // Store enablePowerups in room for collision detection
  room.enablePowerups = enablePowerups;

  let maxSteps = 0;
  Object.values(gameState.players).forEach(player => {
    if (!player.isAlive) {
      return;
    }
    if (player.speedAccumulator === undefined) {
      player.speedAccumulator = 0;
    }
    const speedFactor = getPlayerSpeedFactor(player, powerups);
    player.speedAccumulator += speedFactor;
    const steps = Math.floor(player.speedAccumulator);
    if (steps > maxSteps) {
      maxSteps = steps;
    }
  });

  for (let step = 0; step < maxSteps; step++) {
    const movingPlayers = Object.values(gameState.players).filter(
      player => player.isAlive && player.speedAccumulator >= 1
    );
    if (movingPlayers.length === 0) {
      break;
    }

    movingPlayers.forEach(player => {
      player.speedAccumulator -= 1;
    });

    advancePlayers(gameState, movingPlayers, room, enablePowerups, ioInstance, powerups);

    if (gameState.winner) {
      break;
    }
  }

  // Don't check win condition if game is paused (prevents game from ending while paused)
  if (!room.isPaused && !gameState.isPaused) {
    checkWinCondition(gameState, false, room);
  }
}

function checkCollision(gameState, player, newHead, room = null) {
  // Don't check collisions if game hasn't started (startTime is 0)
  if (gameState.startTime === 0 || gameState.startTime === null) {
    return false; // No collision if game hasn't started
  }

  // Check wall collision (only if wall mode is enabled)
  if (gameState.wallMode) {
    if (newHead.x < 0 || newHead.x >= GRID_WIDTH || newHead.y < 0 || newHead.y >= GRID_HEIGHT) {
      return { type: 'wall', details: { position: newHead, gridBounds: { width: GRID_WIDTH, height: GRID_HEIGHT } } };
    }
  }
  
  // Check self collision
  // IMPORTANT: Check against CURRENT snake state (before new head is added)
  // The newHead position should NOT collide with segments at indices 1 to length-1
  // Skip index 0 (current head) since we're moving away from it
  for (let i = 1; i < player.snake.length; i++) {
    const segment = player.snake[i];
    if (!segment) {
      continue; // Skip null/undefined segments
    }
    
    // Check if new head position matches this segment position
    if (segment.x === newHead.x && segment.y === newHead.y) {
      return { type: 'self', details: { position: newHead, segmentIndex: i } };
    }
  }

  // Check collision with other snakes
  const otherPlayers = Object.values(gameState.players);
  
  for (let j = 0; j < otherPlayers.length; j++) {
    const otherPlayer = otherPlayers[j];
    if (otherPlayer.id === player.id || !otherPlayer.isAlive) {
      continue;
    }
    
    // In solo mode, human and NPC are immune to each other - skip collision check
    if (room?.gameMode === 'single-player' &&
        ((player.type === 'human' && otherPlayer.type === 'npc') ||
         (player.type === 'npc' && otherPlayer.type === 'human'))) {
      continue; // Skip collision check - human and NPC are immune to each other
    }

    // In multiplayer with no wall mode and non-strict mode: players are immune to each other
    if (room?.gameMode === 'multi-player' && !gameState.wallMode && !gameState.strictMode) {
      continue; // Skip collision check - players can walk through each other
    }

    // Check collision with other snake
    if (otherPlayer.snake.length > 0) {
      // In strict mode: check ALL body segments (not just head)
      // In normal mode: only check head (index 0) - body segments can be walked over
      const segmentsToCheck = gameState.strictMode ? otherPlayer.snake : [otherPlayer.snake[0]];
      
      for (let i = 0; i < segmentsToCheck.length; i++) {
        const segment = segmentsToCheck[i];
        if (segment.x === newHead.x && segment.y === newHead.y) {
          const collisionDetails = {
            playerId: player.id,
            playerType: player.type,
            playerName: player.name,
            otherPlayerId: otherPlayer.id,
            otherPlayerType: otherPlayer.type,
            otherPlayerName: otherPlayer.name,
            collisionPosition: { x: newHead.x, y: newHead.y },
            otherPlayerSnakeSegmentIndex: gameState.strictMode ? i : 0,
            isHeadCollision: i === 0,
            gameMode: room?.gameMode,
            strictMode: gameState.strictMode,
            playerSnakeLength: player.snake.length,
            otherPlayerSnakeLength: otherPlayer.snake.length
          };

          return { type: 'head-to-body', details: collisionDetails };
        }
      }
    }
  }
  
  return false;
}

// Respawn NPCs if needed in single-player mode
function respawnNPCsIfNeeded(room, npcs) {
  if (!room.gameState || !npcs) return;
  
  const gameState = room.gameState;
  const allPlayers = Object.values(gameState.players);
  const humanPlayers = allPlayers.filter(p => p.type === 'human');
  const npcPlayers = allPlayers.filter(p => p.type === 'npc');
  const activeNPCs = npcPlayers.filter(p => p.isAlive);
  
  // Only respawn if we're in single-player mode with NPCs
  if (humanPlayers.length !== 1 || npcPlayers.length === 0) {
    return;
  }
  
  // Only respawn if human player is still alive
  const humanPlayer = humanPlayers[0];
  if (!humanPlayer || !humanPlayer.isAlive) {
    return; // Don't respawn NPCs if human player is dead
  }
  
  // If there are no active NPCs, respawn one
  if (activeNPCs.length === 0 && npcPlayers.length > 0) {
    // Find the first dead NPC to respawn
    const deadNPC = npcPlayers.find(p => !p.isAlive);
    if (deadNPC) {
      // Respawn the NPC with initial position using corner positions
      const startPositions = [
        { x: 5, y: 5, dir: 'right' },
        { x: GRID_WIDTH - 6, y: GRID_HEIGHT - 6, dir: 'left' },
        { x: 5, y: GRID_HEIGHT - 6, dir: 'right' },
        { x: GRID_WIDTH - 6, y: 5, dir: 'left' }
      ];
      
      // Find an available starting position (not occupied by human player or their snake)
      const humanPlayer = humanPlayers[0];
      const occupiedCells = new Set();
      
      // Mark all cells occupied by human player's snake
      if (humanPlayer.snake && Array.isArray(humanPlayer.snake)) {
        humanPlayer.snake.forEach(segment => {
          if (segment && typeof segment.x === 'number' && typeof segment.y === 'number') {
            occupiedCells.add(`${segment.x},${segment.y}`);
          }
        });
      }
      
      // Find a safe position from corner positions
      let respawnPos = null;
      for (const pos of startPositions) {
        const posKey = `${pos.x},${pos.y}`;
        if (!occupiedCells.has(posKey)) {
          respawnPos = pos;
          break;
        }
      }
      
      // If all corner positions are occupied, find a random position
      if (!respawnPos) {
        let attempts = 0;
        while (attempts < 50 && !respawnPos) {
          const x = Math.floor(Math.random() * GRID_WIDTH);
          const y = Math.floor(Math.random() * GRID_HEIGHT);
          const posKey = `${x},${y}`;
          if (!occupiedCells.has(posKey)) {
            respawnPos = { x, y, dir: 'right' };
            break;
          }
          attempts++;
        }
      }
      
      // If still no position found, use the first corner position anyway
      if (!respawnPos) {
        respawnPos = startPositions[0];
      }
      
      // Respawn the NPC
      deadNPC.isAlive = true;
      deadNPC.snake = [respawnPos];
      deadNPC.direction = respawnPos.dir;
      deadNPC.nextDirection = respawnPos.dir;
      deadNPC.score = 0; // Reset score on respawn
      deadNPC.speedAccumulator = 0;
      deadNPC.survivalStartTime = Date.now();
      deadNPC.survivalTime = 0;
      
      console.log(`[NPC Respawn] Respawned ${deadNPC.name} at position (${respawnPos.x}, ${respawnPos.y})`);
    }
  }
}

function checkWinCondition(gameState, timeLimitReached = false, room = null) {
  const alivePlayers = Object.values(gameState.players).filter(p => p.isAlive);
  const allPlayers = Object.values(gameState.players);

  // If time limit reached, end game regardless of alive players
  if (timeLimitReached) {
    // Apply survival bonus to all alive players
    alivePlayers.forEach(player => {
      player.score += 50;
    });
  }
  
  // Check if single-player mode (1 human player + NPCs)
  const humanPlayers = allPlayers.filter(p => p.type === 'human');
  if (humanPlayers.length === 1 && allPlayers.length > 1) {
    // Single-player mode
    const humanPlayer = humanPlayers[0];
    const npcPlayers = allPlayers.filter(p => p.type === 'npc');
    
    // Game continues as long as human player is alive
    if (humanPlayer.isAlive) {
      gameState.winner = null;
      return; // Game continues as long as human player is alive
    }
    
    // Human player died - game ends immediately
    // Human player is declared as the player (even though they lost)
    // This ensures gameEnded event is properly emitted
      gameState.winner = {
      id: humanPlayer.id,
      name: humanPlayer.name,
      score: humanPlayer.score,
      isLoser: true // Mark as loser to indicate game ended due to death
    };
    return;
  }
  
  // Handle solo mode (1 player, no NPCs)
  if (allPlayers.length === 1) {
    const soloPlayer = allPlayers[0];
    // If player is alive, game continues
    if (soloPlayer.isAlive) {
      gameState.winner = null;
      return;
    }
    // If player is dead, game ends (player lost)
    // Set a special marker to indicate game ended (even though no winner)
    // Use a special object structure so gameEnded can be emitted
    gameState.winner = { 
      id: soloPlayer.id, 
      name: soloPlayer.name, 
      score: soloPlayer.score,
      isLoser: true // Mark as loser for solo mode
    };
    return;
  }
  
  // Always determine winner by highest score, regardless of alive status
  // Sort all players by score (highest first)
  let sortedByScore = [...allPlayers].sort((a, b) => {
    // First sort by score (descending)
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // If scores are equal, prefer alive players
    if (a.isAlive && !b.isAlive) return -1;
    if (!a.isAlive && b.isAlive) return 1;
    // Tiebreaker: survival time (longer = better)
    return (b.survivalTime || 0) - (a.survivalTime || 0);
  });
  
  if (alivePlayers.length === 0) {
    // All players died - winner is the one with highest score
    if (sortedByScore.length > 0 && sortedByScore[0].score >= 0) {
      gameState.winner = {
        id: sortedByScore[0].id,
        name: sortedByScore[0].name,
        score: sortedByScore[0].score
      };
    } else {
      gameState.winner = null;
    }
    return;
  }

  if (alivePlayers.length === 1 && allPlayers.length > 1) {
    // One player remaining in multiplayer - check if game should end
    // Only end if there are actually multiple players and one is truly dead (not just disconnected)
    // If all players have score 0 and game just started, don't end yet
    const totalScore = allPlayers.reduce((sum, p) => sum + p.score, 0);
    
    // Don't end game immediately after start (all scores are 0)
    if (totalScore === 0) {
      if (!gameState.lastSurvivorSince) {
        gameState.lastSurvivorSince = Date.now();
      }
      if (Date.now() - gameState.lastSurvivorSince < 5000) {
        gameState.winner = null;
        return;
      }
    } else {
      gameState.lastSurvivorSince = null;
    }
    
    
    // Apply survival bonus (+50 points) to last alive player
    const lastAlivePlayer = alivePlayers[0];
    if (lastAlivePlayer) {
      lastAlivePlayer.score += 50;
      // Re-sort after applying bonus
      sortedByScore = [...allPlayers].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.isAlive && !b.isAlive) return -1;
        if (!a.isAlive && b.isAlive) return 1;
        // Tiebreaker: survival time (longer = better)
        return (b.survivalTime || 0) - (a.survivalTime || 0);
      });
    }
    
    // One player remaining - but check if any dead player has higher score
    const highestScorePlayer = sortedByScore[0];
    
    // Winner is always the player with highest score (even if dead)
    gameState.winner = {
      id: highestScorePlayer.id,
      name: highestScorePlayer.name,
      score: highestScorePlayer.score
    };
    return;
  }

  // Game continues if multiple players alive
  gameState.lastSurvivorSince = null;
  gameState.winner = null;
}

function startGameLoop(room, io, enablePowerups = false, npcs = null) {
  // Stop any existing loop
  stopGameLoop(room);

  // Store io reference for use in nested functions (closure)
  const ioInstance = io;

  // Initialize level if not set
  if (!room.gameState.level) {
    room.gameState.level = 1;
  }
  if (room.gameState.totalFoodEaten === undefined) {
    room.gameState.totalFoodEaten = 0;
  }

  // Set startTime NOW (when game loop actually starts, after countdown)
  // This ensures timer starts counting from 0 when snakes start moving
  // CRITICAL: Only set startTime if countdown is not active and game hasn't started yet
  // Don't set startTime if countdown is still running or if it's already set
  if (!room.countdownActive && (!room.gameState.startTime || room.gameState.startTime === 0)) {
  room.gameState.startTime = Date.now();
  room.gameState.timer = 0; // Reset timer to 0 to ensure it starts fresh
  }

  // Calculate initial speed based on current level
  const currentLevel = room.gameState.level;
  const currentTickRate = calculateTickRate(currentLevel, room.gameMode);
  const currentGameSpeed = 1000 / currentTickRate;

  // Send initial timer update immediately (before first interval)
  // Also calculate timer immediately so it shows 00:00:01 right away
  if (room.gameState) {
    // Calculate timer immediately (should be 0 or 1 second)
    const currentTime = Date.now();
    const elapsedTime = currentTime - room.gameState.startTime - (room.gameState.totalPauseDuration || 0);
    room.gameState.timer = Math.max(0, Math.floor(elapsedTime / 1000));
    const initialPayload = { gameState: room.gameState };
    io.to(room.code).emit('gameStateUpdate', initialPayload);
  }

  // Define the game loop function
  const gameLoopIteration = () => {
    // CRITICAL: Don't run game loop if game is not active OR countdown is still active
    // Also check if countdownActive exists and is true (defensive check)
    if (!room.isGameActive ||
        (room.countdownActive === true && room.countdownValue !== null && room.countdownValue > 0) ||
        (room.countdownActive === true)) {
      return;
    }

    // --- PAUSE HANDLING ---
    if (room.isPaused || (room.gameState && room.gameState.isPaused)) {
      // DO NOT update timer when paused - keep it frozen at the last value
      // Timer will resume from the correct value when game resumes
      // Only send game state update to keep UI in sync (timer stays frozen)
      if (room.gameState) {
        io.to(room.code).emit('gameStateUpdate', { gameState: room.gameState });
      }
      return; // Do not process game state or move snakes
    }

    // Update timer (only when NOT paused - timer is frozen during pause)
    if (room.gameState && !room.isPaused && !room.gameState.isPaused) {
      // Update timer only when not paused
      if (room.gameState.startTime && room.gameState.startTime > 0) {
        const currentTime = Date.now();
        const elapsedTime = currentTime - room.gameState.startTime - (room.gameState.totalPauseDuration || 0);
        room.gameState.timer = Math.floor(elapsedTime / 1000);
        
        // Check time limit
        if (room.gameState.timeLimit && elapsedTime >= room.gameState.timeLimit) {
          // Time limit reached - trigger game end
          checkWinCondition(room.gameState, true, room);
          return;
        }
      } else {
        room.gameState.timer = 0;
      }
      
      // Check for player inactivity FIRST (before updateGameState)
      // This ensures we can pause before win conditions are checked
      checkPlayerInactivity(room.gameState, room, ioInstance);
      
      // If inactivity check triggered a pause, skip updateGameState (it checks for pause internally)
      if (room.isPaused || (room.gameState && room.gameState.isPaused)) {
        // Game was just paused due to inactivity - skip game state update
        // Send game state update to sync pause state
        if (room.gameState) {
          io.to(room.code).emit('gameStateUpdate', { gameState: room.gameState });
        }
        return; // Skip rest of game loop iteration
      }
      
      // Process NPC inputs if in single-player mode
      if (npcs && room.gameMode === 'single-player') {
        const npcModule = getNPCModule();
        if (npcModule) {
          npcModule.processNPCInputs(room.gameState, npcs);
        }
      }

      updateGameState(room, enablePowerups, ioInstance);

      // NPC respawn logic for single-player mode
      if (room.gameMode === 'single-player' && npcs) {
        respawnNPCsIfNeeded(room, npcs);
      }

      // Check if level changed (speed needs to update)
      const newLevel = calculateLevel(room.gameState.totalFoodEaten);
      if (newLevel !== room.gameState.level) {
        // Level changed - restart loop with new speed
        room.gameState.level = newLevel;
        clearInterval(intervalId);
        gameLoops.delete(room.code);
        startGameLoop(room, io, enablePowerups, npcs);
        return;
      }
    }

    // Send game state to all players (even when paused, so timer displays correctly)
    if (room.gameState) {
      const updatePayload = { gameState: room.gameState };
      io.to(room.code).emit('gameStateUpdate', updatePayload);
    }

    // Check if game ended
    // IMPORTANT: Don't check win conditions when game is paused
    // This prevents game from ending while paused (e.g., during auto-pause for inactivity)
    if (room.isPaused || (room.gameState && room.gameState.isPaused)) {
      return; // Skip win condition check when paused
    }
    
    // In solo mode, also check if all players are dead (even if winner is null)
    const allPlayersDead = room.gameMode === 'solo' && 
      Object.values(room.gameState.players).every(p => !p.isAlive);
    
    if (room.gameState.winner !== null || allPlayersDead) {
      stopGameLoop(room);
      room.isGameActive = false;
      
      // Prepare player status information
      const players = Object.values(room.gameState.players);
      const alivePlayers = players.filter(p => p.isAlive).map(p => ({ id: p.id, name: p.name, type: p.type, score: p.score }));
      const deadPlayers = players.filter(p => !p.isAlive).map(p => ({ id: p.id, name: p.name, type: p.type, score: p.score }));
      
      // For solo mode when player dies, ensure winner object exists for gameEnded event
      let winnerForEvent = room.gameState.winner;
      if (allPlayersDead && !winnerForEvent && room.gameMode === 'solo') {
        const soloPlayer = players[0];
        winnerForEvent = {
          id: soloPlayer.id,
          name: soloPlayer.name,
          score: soloPlayer.score,
          isLoser: true
        };
      }
      
      // Update session record
      if (gameSessions && rooms) {
        const sessionId = room.sessionId || `unknown-${Date.now()}`;

        if (gameSessions.has(sessionId)) {
          const session = gameSessions.get(sessionId);
          session.endTime = Date.now();
          session.winner = room.gameState.winner ? {
            id: room.gameState.winner.id,
            name: room.gameState.winner.name,
            score: room.gameState.winner.score
          } : null;
          session.players = players.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type || 'human',
            isAlive: p.isAlive,
            score: p.score
          }));
        }
      }
      
      io.to(room.code).emit('gameEnded', {
        winner: winnerForEvent || room.gameState.winner,
        gameState: room.gameState,
        gameMode: room.gameMode,
        alivePlayers: alivePlayers,
        deadPlayers: deadPlayers,
        roomCode: room.code // Include room code for cleanup
      });
      
      // Clean up room after a delay to allow room code reuse (for multiplayer only)
      if (room.gameMode === 'multi-player') {
        setTimeout(() => {
          const checkRoom = rooms.get(room.code);
          if (checkRoom && !checkRoom.isGameActive) {
            rooms.delete(room.code);
            console.log(`Room ${room.code} cleaned up after game ended - room code can be reused`);
          }
        }, 10000); // 10 second delay to allow players to see game over screen
      }
    }
  };

  // Don't run immediately - wait for first interval to avoid running during countdown
  // The check in gameLoopIteration will prevent running if countdown is still active
  const intervalId = setInterval(gameLoopIteration, currentGameSpeed);

  gameLoops.set(room.code, intervalId);
}

// --- EMIT PAUSE/RESUME EVENTS TO CLIENTS ---
function pauseGame(room, ioInstance = null) {
  if (room.gameState && !room.gameState.isPaused) {
    room.gameState.isPaused = true;
    room.gameState.pauseStartTime = Date.now();
    room.gameState.pauseStartedAt = Date.now(); // Track pause start time for inactivity calculation
    room.isPaused = true;
    
    if (ioInstance) {
      ioInstance.to(room.code).emit('gamePaused', { pausedBy: 'Host or system' });
    }
  }
}

function resumeGame(room, ioInstance = null) {
  if (room.gameState && room.gameState.isPaused) {
    if (room.gameState.pauseStartTime) {
      const pauseDuration = Date.now() - room.gameState.pauseStartTime;
      room.gameState.totalPauseDuration = (room.gameState.totalPauseDuration || 0) + pauseDuration;
      room.gameState.totalPauseTime = (room.gameState.totalPauseTime || 0) + pauseDuration;
      room.gameState.pauseStartTime = null;
    }
    
    // Shift lastInputTime forward by pause duration to remove paused time from inactivity calculations
    if (room.gameState.pauseStartedAt) {
      const pauseDuration = Date.now() - room.gameState.pauseStartedAt;
      if (room.gameState.lastPlayerInputTime) {
        Object.keys(room.gameState.lastPlayerInputTime).forEach(playerId => {
          room.gameState.lastPlayerInputTime[playerId] += pauseDuration;
        });
      }
      room.gameState.pauseStartedAt = null;
    }
    
    if (room.gameOptions && room.gameOptions.maxPauseTime) {
      if (room.gameState.totalPauseTime >= room.gameOptions.maxPauseTime) {
        room.gameState.isPaused = false;
        room.isPaused = false;
        checkWinCondition(room.gameState, false, room);
        return false;
      }
    }
    room.gameState.isPaused = false;
    room.isPaused = false;
    if (ioInstance) {
      ioInstance.to(room.code).emit('gameResumed', {});
    }
    return true;
  }
  return false;
}

function stopGameLoop(room) {
  const intervalId = gameLoops.get(room.code);
  if (intervalId) {
    clearInterval(intervalId);
    gameLoops.delete(room.code);
  }
}

// Helper function to check for inactivity (player hasn't moved for 60+ seconds)
function checkPlayerInactivity(gameState, room, ioInstance) {
  if (!gameState || !gameState.players || !ioInstance || !room) {
    return;
  }
  
  // Check inactivity for all game modes
  // Solo/single-player: auto-pause
  // Multi-player: kick out inactive player
  
  // Only check after game has actually started (not during ready phase)
  if (!gameState.startTime || gameState.startTime === 0) {
    return;
  }
  
  // IMPORTANT: Do not check inactivity when game is paused
  // Pause time should not count towards inactive duration
  if (gameState.isPaused || room.isPaused) {
    return;
  }
  
  const INACTIVITY_THRESHOLD = 60000; // 60 seconds (1 minute) as per user requirement
  const WARNING_THRESHOLD = 45000; // 45 seconds - warn player 15 seconds before kick
  const currentTime = Date.now();
  const isMultiplayer = room.gameMode === 'multi-player';
  
  // Initialize inactivityWarnings if not exists
  if (!gameState.inactivityWarnings) {
    gameState.inactivityWarnings = {};
  }
  
  Object.entries(gameState.players).forEach(([playerId, player]) => {
    // Only check human players
    if (player.type !== 'human' || !player.isAlive) {
      return;
    }
    
    const lastInputTime = gameState.lastPlayerInputTime?.[playerId] || currentTime;
    // Calculate inactive duration
    // lastInputTime has been shifted forward by pause duration on resume, so pause time is already excluded
    const inactiveDuration = currentTime - lastInputTime;
    
    // Send warning to player if they're approaching inactivity threshold (multiplayer only)
    if (isMultiplayer && inactiveDuration >= WARNING_THRESHOLD && inactiveDuration < INACTIVITY_THRESHOLD) {
      // Only send warning once per inactivity period
      if (!gameState.inactivityWarnings[playerId]) {
        const roomPlayer = room.players.get(playerId);
        if (roomPlayer && roomPlayer.socketId && ioInstance) {
          const socket = ioInstance.sockets.sockets.get(roomPlayer.socketId);
          if (socket) {
            const remainingSeconds = Math.ceil((INACTIVITY_THRESHOLD - inactiveDuration) / 1000);
            socket.emit('inactivityWarning', {
              message: `You will be kicked in ${remainingSeconds} seconds if you don't move!`,
              remainingSeconds: remainingSeconds
            });
            gameState.inactivityWarnings[playerId] = true; // Mark as warned
          }
        }
      }
    }
    
    if (inactiveDuration > INACTIVITY_THRESHOLD) {
      if (isMultiplayer) {
        // Multi-player: Kick out inactive player
        const roomPlayer = room.players.get(playerId);
        if (!roomPlayer) {
          return; // Player already removed
        }
        
        // Mark player as dead in game state
        player.isAlive = false;
        
        // Cancel power-ups if enabled
        if (room.enablePowerups) {
          const powerups = require('./powerups');
          if (powerups && powerups.cancelPlayerPowerUps) {
            powerups.cancelPlayerPowerUps(player);
          }
        }
        
        // Remove player from room
        room.players.delete(playerId);
        if (room.playerTokens && roomPlayer.token) {
          room.playerTokens.delete(roomPlayer.token);
        }
        if (room.socketToPlayerId && roomPlayer.socketId) {
          room.socketToPlayerId.delete(roomPlayer.socketId);
        }
        
        // Disconnect socket if connected and notify player
        if (roomPlayer.socketId && ioInstance) {
          const socket = ioInstance.sockets.sockets.get(roomPlayer.socketId);
          if (socket) {
            socket.leave(room.code);
            // Notify the kicked player directly with a specific event
            socket.emit('error', {
              message: 'You were kicked out for being inactive for 60+ seconds',
              reason: 'inactive',
              kicked: true
            });
            // Also emit a specific event for inactive kick
            socket.emit('playerKicked', {
              reason: 'inactive',
              message: 'You were kicked out for being inactive for 60+ seconds'
            });
          }
        }
        
        // Handle host reassignment if needed
        if (roomPlayer.isHost && room.players.size > 0) {
          const remainingPlayers = Array.from(room.players.values());
          const randomIndex = Math.floor(Math.random() * remainingPlayers.length);
          const newHost = remainingPlayers[randomIndex];
          newHost.isHost = true;
          ioInstance.to(room.code).emit('hostChanged', {
            newHostId: newHost.id,
            newHostName: newHost.name
          });
        }
        
        // Notify other players
        ioInstance.to(room.code).emit('playerLeft', {
          playerName: player.name,
          reason: 'inactive',
          wasHost: roomPlayer.isHost,
          players: Array.from(room.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost
          }))
        });
        
        // Send game state update
        if (room.isGameActive && room.gameState) {
          ioInstance.to(room.code).emit('gameStateUpdate', {
            gameState: room.gameState
          });
        }
      } else {
        // Solo/single-player: Check if player is disconnected
        const roomPlayer = room.players.get(playerId);
        const isDisconnected = !roomPlayer || !roomPlayer.socketId;
        
        if (isDisconnected) {
          // Player is disconnected and inactive: end the game immediately
          console.log(`Player ${player.name} is disconnected and inactive in ${room.gameMode} game, ending game`);
          
          // Mark player as dead in game state
          player.isAlive = false;
          
          // Cancel power-ups if enabled
          if (room.enablePowerups) {
            const powerups = require('./powerups');
            if (powerups && powerups.cancelPlayerPowerUps) {
              powerups.cancelPlayerPowerUps(player);
            }
          }
          
          // Check win condition (player loses)
          checkWinCondition(gameState, false, room);
          
          // Stop game loop and end game
          room.isGameActive = false;
          stopGameLoop(room);
          
          // Prepare player status information
          const players = Object.values(gameState.players);
          const alivePlayers = players.filter(p => p.isAlive).map(p => ({ id: p.id, name: p.name, type: p.type, score: p.score }));
          const deadPlayers = players.filter(p => !p.isAlive).map(p => ({ id: p.id, name: p.name, type: p.type, score: p.score }));
          
          // Update session record (similar to normal game end flow)
          if (gameSessions && rooms) {
            const sessionId = room.sessionId || `unknown-${Date.now()}`;
            
            if (gameSessions.has(sessionId)) {
              const session = gameSessions.get(sessionId);
              session.endTime = Date.now();
              session.endReason = 'player_inactive_disconnected';
              session.winner = gameState.winner ? {
                id: gameState.winner.id,
                name: gameState.winner.name,
                score: gameState.winner.score
              } : null;
              session.players = players.map(p => ({
                id: p.id,
                name: p.name,
                type: p.type || 'human',
                isAlive: p.isAlive,
                score: p.score
              }));
            }
          }
          
          // Emit gameEnded event
          ioInstance.to(room.code).emit('gameEnded', {
            winner: gameState.winner,
            gameState: gameState,
            gameMode: room.gameMode,
            alivePlayers: alivePlayers,
            deadPlayers: deadPlayers,
            roomCode: room.code
          });
        } else {
          // Solo/single-player: Player is connected but inactive - end the game (consistent with multiplayer kick behavior)
          // Only end if game hasn't already ended
          if (gameState.winner === null) {
            console.log(`Player ${player.name} is inactive for 60+ seconds in ${room.gameMode} game, ending game`);
            
            // Mark player as dead in game state
            player.isAlive = false;
            
            // Cancel power-ups if enabled
            if (room.enablePowerups) {
              const powerups = require('./powerups');
              if (powerups && powerups.cancelPlayerPowerUps) {
                powerups.cancelPlayerPowerUps(player);
              }
            }
            
            // Check win condition (player loses)
            checkWinCondition(gameState, false, room);
            
            // Stop game loop and end game
            room.isGameActive = false;
            stopGameLoop(room);
            
            // Prepare player status information
            const players = Object.values(gameState.players);
            const alivePlayers = players.filter(p => p.isAlive).map(p => ({ id: p.id, name: p.name, type: p.type, score: p.score }));
            const deadPlayers = players.filter(p => !p.isAlive).map(p => ({ id: p.id, name: p.name, type: p.type, score: p.score }));
            
            // Update session record
            if (gameSessions && rooms) {
              const sessionId = room.sessionId || `unknown-${Date.now()}`;
              
              if (gameSessions.has(sessionId)) {
                const session = gameSessions.get(sessionId);
                session.endTime = Date.now();
                session.endReason = 'player_inactive';
                session.winner = gameState.winner ? {
                  id: gameState.winner.id,
                  name: gameState.winner.name,
                  score: gameState.winner.score
                } : null;
                session.players = players.map(p => ({
                  id: p.id,
                  name: p.name,
                  type: p.type || 'human',
                  isAlive: p.isAlive,
                  score: p.score
                }));
              }
            }
            
            // Emit gameEnded event (game ends, player loses due to inactivity)
            ioInstance.to(room.code).emit('gameEnded', {
              winner: gameState.winner,
              gameState: gameState,
              gameMode: room.gameMode,
              alivePlayers: alivePlayers,
              deadPlayers: deadPlayers,
              roomCode: room.code
            });
          }
        }
      }
    }
  });
}

module.exports = {
  createGameState,
  processPlayerInput,
  startGameLoop,
  stopGameLoop,
  pauseGame,
  resumeGame,
  checkPlayerInactivity,
  checkWinCondition, // Export checkWinCondition to allow external calls
  GRID_WIDTH,
  GRID_HEIGHT,
  CELL_SIZE,
  gameLoops, // Export gameLoops map to check if loop is running
  setDevModeRefs // Export function to set dev mode references
};
