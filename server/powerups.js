// Power-ups system (bonus feature - feature flag enabled)
const { GRID_WIDTH, GRID_HEIGHT } = require('./config');

const POWERUP_TYPES = {
  SPEED_BOOST: 'speed_boost',
  SHIELD: 'shield',
  SHRINK: 'shrink',
  SLOW_OTHERS: 'slow_others'
};

const POWERUP_DURATION = 7000; // 7 seconds in milliseconds
const POWERUP_SPAWN_INTERVAL_MIN = 12000; // 12 seconds minimum between spawns
const POWERUP_SPAWN_INTERVAL_MAX = 20000; // 20 seconds maximum between spawns
const MAX_ACTIVE_POWERUPS = 2; // Maximum number of power-ups active on the board at once

function spawnPowerUp(gameState) {
  // Initialize lastPowerUpSpawnTime if not set
  if (gameState.lastPowerUpSpawnTime === undefined) {
    gameState.lastPowerUpSpawnTime = Date.now();
    return; // Don't spawn immediately on game start
  }

  // Check if we have reached max active power-ups
  const activePowerUpCount = gameState.powerups ? gameState.powerups.length : 0;
  if (activePowerUpCount >= MAX_ACTIVE_POWERUPS) {
    return; // Don't spawn if max power-ups already active
  }

  // Calculate time since last spawn
  const timeSinceLastSpawn = Date.now() - gameState.lastPowerUpSpawnTime;
  
  // Randomize spawn interval between min and max
  const spawnInterval = POWERUP_SPAWN_INTERVAL_MIN + 
    Math.random() * (POWERUP_SPAWN_INTERVAL_MAX - POWERUP_SPAWN_INTERVAL_MIN);
  
  // Only spawn if enough time has passed
  if (timeSinceLastSpawn < spawnInterval) {
    return;
  }

  // Find empty cell
  const occupiedCells = new Set();
  
  Object.values(gameState.players).forEach(player => {
    if (player.isAlive) {
      player.snake.forEach(segment => {
        occupiedCells.add(`${segment.x},${segment.y}`);
      });
    }
  });

  gameState.food.forEach(food => {
    occupiedCells.add(`${food.x},${food.y}`);
  });

  if (gameState.powerups) {
    gameState.powerups.forEach(powerup => {
      occupiedCells.add(`${powerup.x},${powerup.y}`);
    });
  }

  let attempts = 0;
  let x, y;
  
  do {
    x = Math.floor(Math.random() * GRID_WIDTH);
    y = Math.floor(Math.random() * GRID_HEIGHT);
    attempts++;
  } while (occupiedCells.has(`${x},${y}`) && attempts < 100);

  if (attempts < 100) {
    if (!gameState.powerups) {
      gameState.powerups = [];
    }

    const types = Object.values(POWERUP_TYPES);
    const type = types[Math.floor(Math.random() * types.length)];

    gameState.powerups.push({
      id: Date.now() + Math.random(),
      x,
      y,
      type,
      spawnTime: Date.now()
    });

    // Update last spawn time
    gameState.lastPowerUpSpawnTime = Date.now();
  }
}

function checkPowerUpCollisions(gameState, ioInstance = null, roomCode = null) {
  if (!gameState.powerups || gameState.powerups.length === 0) {
    return;
  }

  Object.values(gameState.players).forEach(player => {
    if (!player.isAlive || !player.snake || player.snake.length === 0) return;

    const head = player.snake[0];
    const powerupIndex = gameState.powerups.findIndex(
      p => p.x === head.x && p.y === head.y
    );

    if (powerupIndex !== -1) {
      const powerup = gameState.powerups[powerupIndex];
      applyPowerUp(player, powerup.type, gameState);
      
      // Emit sound event for power-up collection
      if (ioInstance && roomCode) {
        const soundMap = {
          'speed_boost': 'speedBoost',
          'shield': 'shield',
          'shrink': 'shrink',
          'slow_others': 'slowOthers'
        };
        const soundEvent = soundMap[powerup.type] || 'speedBoost';
        ioInstance.to(roomCode).emit('powerUpCollected', {
          playerId: player.id,
          playerName: player.name,
          type: powerup.type,
          sound: soundEvent
        });
      }
      
      gameState.powerups.splice(powerupIndex, 1);
    }
  });
}

function applyPowerUp(player, type, gameState) {
  if (!player.activePowerups) {
    player.activePowerups = {};
  }

  // Prevent stacking: Clear existing power-ups before applying new one
  // Exception: SLOW_OTHERS doesn't stack on the collector, but applies to others
  if (type !== POWERUP_TYPES.SLOW_OTHERS) {
    // Clear all existing power-ups for this player
    player.activePowerups = {};
  }

  const endTime = Date.now() + POWERUP_DURATION;

  switch (type) {
    case POWERUP_TYPES.SPEED_BOOST:
      player.activePowerups.speedBoost = endTime;
      break;
    case POWERUP_TYPES.SHIELD:
      player.activePowerups.shield = endTime;
      break;
    case POWERUP_TYPES.SHRINK:
      player.activePowerups.shrink = endTime;
      // Remove last 3 segments
      for (let i = 0; i < 3 && player.snake.length > 1; i++) {
        player.snake.pop();
      }
      break;
    case POWERUP_TYPES.SLOW_OTHERS:
      // Apply slow effect to all other players (can stack on others)
      Object.values(gameState.players).forEach(otherPlayer => {
        if (otherPlayer.id !== player.id && otherPlayer.isAlive) {
          if (!otherPlayer.activePowerups) {
            otherPlayer.activePowerups = {};
          }
          // Allow stacking of slow effect on other players
          otherPlayer.activePowerups.slowed = endTime;
        }
      });
      break;
  }
}

function updatePowerUps(gameState) {
  // Remove expired powerups
  if (gameState.powerups) {
    gameState.powerups = gameState.powerups.filter(
      p => Date.now() - p.spawnTime < 30000 // Remove after 30 seconds if not collected
    );
  }

  // Remove expired active powerups
  Object.values(gameState.players).forEach(player => {
    if (player.activePowerups) {
      Object.keys(player.activePowerups).forEach(key => {
        if (player.activePowerups[key] < Date.now()) {
          delete player.activePowerups[key];
        }
      });

      if (Object.keys(player.activePowerups).length === 0) {
        delete player.activePowerups;
      }
    }
  });
}

function hasActivePowerUp(player, type) {
  if (!player.activePowerups) {
    return false;
  }
  return player.activePowerups[type] && player.activePowerups[type] > Date.now();
}

// Cancel all power-ups for a player (called when player dies)
function cancelPlayerPowerUps(player) {
  if (player.activePowerups) {
    delete player.activePowerups;
  }
}

module.exports = {
  spawnPowerUp,
  checkPowerUpCollisions,
  updatePowerUps,
  hasActivePowerUp,
  cancelPlayerPowerUps,
  POWERUP_TYPES,
  POWERUP_DURATION
};
