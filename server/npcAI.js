// Basic NPC AI for single-player mode
const { GRID_WIDTH, GRID_HEIGHT } = require('./gameLogic');

const NPC_PROFILES = {
  balanced: {
    label: 'Balanced',
    description: 'Focuses on food while staying reasonably safe.',
    base: { reactionTime: 120, successRate: 0.8, lookAhead: 4, aggression: 0.45, caution: 0.55 },
    bias: { food: 0.6, hunt: 0.3, survival: 0.1 }
  },
  hunter: {
    label: 'Hunter',
    description: 'Pressures other snakes and looks for head-to-head wins.',
    base: { reactionTime: 110, successRate: 0.78, lookAhead: 4, aggression: 0.75, caution: 0.45 },
    bias: { food: 0.3, hunt: 0.6, survival: 0.1 }
  },
  survivor: {
    label: 'Survivor',
    description: 'Values space and avoids risky routes.',
    base: { reactionTime: 130, successRate: 0.84, lookAhead: 5, aggression: 0.25, caution: 0.8 },
    bias: { food: 0.45, hunt: 0.1, survival: 0.45 }
  },
  forager: {
    label: 'Forager',
    description: 'Prioritizes food and rapid growth.',
    base: { reactionTime: 115, successRate: 0.76, lookAhead: 3, aggression: 0.35, caution: 0.5 },
    bias: { food: 0.75, hunt: 0.15, survival: 0.1 }
  }
};

const DIFFICULTY_MULTIPLIERS = {
  easy: { reactionTime: 1.25, successRate: 0.85, lookAhead: 0.85, aggression: 0.9, caution: 1.05 },
  medium: { reactionTime: 1, successRate: 1, lookAhead: 1, aggression: 1, caution: 1 },
  hard: { reactionTime: 0.75, successRate: 1.15, lookAhead: 1.2, aggression: 1.1, caution: 0.95 }
};

const DEFAULT_TUNING = { speed: 3, skill: 3, boldness: 3 };

function clampNumber(value, min, max) {
  const num = Number(value);
  if (Number.isNaN(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  const clamped = clampNumber(value, inMin, inMax);
  const ratio = (clamped - inMin) / (inMax - inMin);
  return outMin + ratio * (outMax - outMin);
}

function sanitizeName(name, fallback) {
  if (typeof name !== 'string') return fallback;
  const trimmed = name.trim().slice(0, 20);
  return trimmed.length ? trimmed : fallback;
}

function normalizeNPCConfig(config, fallbackName) {
  const source = typeof config === 'string'
    ? { difficulty: config }
    : (config && typeof config === 'object' ? config : {});
  const name = sanitizeName(source.name, fallbackName);
  const profile = NPC_PROFILES[source.profile] ? source.profile : 'balanced';
  const difficulty = DIFFICULTY_MULTIPLIERS[source.difficulty] ? source.difficulty : 'medium';
  const tuningSource = source.tuning && typeof source.tuning === 'object' ? source.tuning : source;
  const speed = clampNumber(tuningSource.speed ?? DEFAULT_TUNING.speed, 1, 5);
  const skill = clampNumber(tuningSource.skill ?? DEFAULT_TUNING.skill, 1, 5);
  const boldness = clampNumber(tuningSource.boldness ?? DEFAULT_TUNING.boldness, 1, 5);
  return {
    name,
    profile,
    difficulty,
    tuning: { speed, skill, boldness }
  };
}

function createNPC(playerId, name, config = {}) {
  const normalizedConfig = typeof config === 'string'
    ? normalizeNPCConfig({ difficulty: config }, name)
    : normalizeNPCConfig({ ...config, name }, name);

  return {
    id: playerId,
    name: normalizedConfig.name,
    type: 'npc',
    difficulty: normalizedConfig.difficulty,
    profile: normalizedConfig.profile,
    tuning: normalizedConfig.tuning,
    targetFood: null,
    lastDirection: null,
    decisionDelay: 0
  };
}

function getDifficultySettings(difficulty) {
  return DIFFICULTY_MULTIPLIERS[difficulty] || DIFFICULTY_MULTIPLIERS.medium;
}

function getNPCSettings(npc) {
  const profile = NPC_PROFILES[npc.profile] || NPC_PROFILES.balanced;
  const difficulty = getDifficultySettings(npc.difficulty);
  const tuning = npc.tuning || DEFAULT_TUNING;

  const speedMultiplier = mapRange(tuning.speed, 1, 5, 0.8, 1.2);
  const skillMultiplier = mapRange(tuning.skill, 1, 5, 0.8, 1.2);
  const boldnessMultiplier = mapRange(tuning.boldness, 1, 5, 0.7, 1.3);

  const reactionTime = clampNumber((profile.base.reactionTime * difficulty.reactionTime) / speedMultiplier, 40, 260);
  const successRate = clampNumber(profile.base.successRate * difficulty.successRate * skillMultiplier, 0.4, 0.99);
  const lookAhead = Math.round(clampNumber(profile.base.lookAhead * difficulty.lookAhead * skillMultiplier, 2, 8));
  const aggression = clampNumber(profile.base.aggression * difficulty.aggression * boldnessMultiplier, 0.1, 0.95);
  const caution = clampNumber(profile.base.caution * difficulty.caution / boldnessMultiplier, 0.1, 0.95);

  return {
    profile,
    reactionTime,
    successRate,
    lookAhead,
    aggression,
    caution,
    randomness: clampNumber(1 - successRate, 0.05, 0.4)
  };
}

function chooseTargetType(settings, hasFood, hasOpponent) {
  const bias = settings.profile.bias || { food: 0.6, hunt: 0.3, survival: 0.1 };
  const aggressionBoost = 0.6 + settings.aggression * 0.8;
  const cautionBoost = 0.6 + settings.caution * 0.8;
  const weights = {
    food: bias.food * (1 + (1 - settings.aggression) * 0.3),
    hunt: bias.hunt * aggressionBoost,
    survival: bias.survival * cautionBoost
  };

  if (!hasFood) weights.food = 0;
  if (!hasOpponent) weights.hunt = 0;

  const total = weights.food + weights.hunt + weights.survival;
  if (total <= 0) return hasFood ? 'food' : 'survival';

  const roll = Math.random() * total;
  if (roll < weights.food) return 'food';
  if (roll < weights.food + weights.hunt) return 'hunt';
  return 'survival';
}

function getCenterTarget() {
  return { x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) };
}

function findBestFoodTarget(head, gameState, settings) {
  let bestFood = null;
  let bestScore = -Infinity;
  const cautionBoost = 1 + settings.caution * 0.5;

  gameState.food.forEach(food => {
    const dx = food.x - head.x;
    const dy = food.y - head.y;
    const distance = Math.abs(dx) + Math.abs(dy);
    let score = 1000 / (distance + 1);

    if (gameState.wallMode) {
      const foodWallDist = Math.min(
        food.x,
        GRID_WIDTH - 1 - food.x,
        food.y,
        GRID_HEIGHT - 1 - food.y
      );
      score += foodWallDist * 2 * cautionBoost;

      const headWallDist = Math.min(
        head.x,
        GRID_WIDTH - 1 - head.x,
        head.y,
        GRID_HEIGHT - 1 - head.y
      );

      if (headWallDist < 3) {
        const requiresWallHug = (head.x < 3 && food.x < 3) ||
                               (head.x > GRID_WIDTH - 4 && food.x > GRID_WIDTH - 4) ||
                               (head.y < 3 && food.y < 3) ||
                               (head.y > GRID_HEIGHT - 4 && food.y > GRID_HEIGHT - 4);
        if (requiresWallHug) {
          score -= 50 * cautionBoost;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestFood = food;
    }
  });

  return bestFood;
}

function findBestOpponentTarget(head, gameState, playerId) {
  let bestTarget = null;
  let bestScore = -Infinity;

  Object.values(gameState.players).forEach(otherPlayer => {
    if (otherPlayer.id === playerId || !otherPlayer.isAlive || !otherPlayer.snake || otherPlayer.snake.length === 0) {
      return;
    }
    const otherHead = otherPlayer.snake[0];
    const distance = Math.abs(otherHead.x - head.x) + Math.abs(otherHead.y - head.y);
    const score = 1000 / (distance + 1);
    if (score > bestScore) {
      bestScore = score;
      bestTarget = otherHead;
    }
  });

  return bestTarget;
}

function getDirectionToTarget(head, target, currentDir, wallMode) {
  if (!target) return null;
  const dx = target.x - head.x;
  const dy = target.y - head.y;

  let wrappedDx = dx;
  let wrappedDy = dy;
  if (!wallMode) {
    wrappedDx = dx > GRID_WIDTH / 2 ? dx - GRID_WIDTH : (dx < -GRID_WIDTH / 2 ? dx + GRID_WIDTH : dx);
    wrappedDy = dy > GRID_HEIGHT / 2 ? dy - GRID_HEIGHT : (dy < -GRID_HEIGHT / 2 ? dy + GRID_HEIGHT : dy);
  }

  let targetDir = null;
  if (Math.abs(wrappedDx) > Math.abs(wrappedDy)) {
    targetDir = wrappedDx > 0 ? 'right' : 'left';
  } else {
    targetDir = wrappedDy > 0 ? 'down' : 'up';
  }

  const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
  if (targetDir === opposites[currentDir]) {
    if (currentDir === 'up' || currentDir === 'down') {
      targetDir = wrappedDx > 0 ? 'right' : 'left';
    } else {
      targetDir = wrappedDy > 0 ? 'down' : 'up';
    }
  }

  return targetDir;
}

function decideNPCMove(npc, gameState, player) {
  if (!player.isAlive || !player.snake || player.snake.length === 0) {
    return null;
  }

  const settings = getNPCSettings(npc);
  
  // Get head position early (needed for wall mode checks)
  const head = player.snake[0];
  const currentDir = player.direction;
  
  // Add delay based on difficulty
  npc.decisionDelay = (npc.decisionDelay || 0) - 1;
  if (npc.decisionDelay > 0) {
    return null; // Wait before making decision
  }
  npc.decisionDelay = Math.floor(settings.reactionTime / 50); // Reset delay

  // Sometimes make mistakes (based on success rate) - but still use smart avoidance
  if (Math.random() > settings.successRate) {
    // Even when making mistakes, use collision avoidance to survive longer
    return avoidCollisions(player, gameState, currentDir, settings);
  }

  const foodTarget = findBestFoodTarget(head, gameState, settings);
  const opponentTarget = findBestOpponentTarget(head, gameState, player.id);
  const targetType = chooseTargetType(settings, !!foodTarget, !!opponentTarget);

  let target = null;
  if (targetType === 'hunt' && opponentTarget) {
    target = opponentTarget;
  } else if (targetType === 'food' && foodTarget) {
    target = foodTarget;
  } else if (targetType === 'survival') {
    target = getCenterTarget();
  }

  if (!target) {
    target = foodTarget || getCenterTarget();
  }

  const preferredDir = getDirectionToTarget(head, target, currentDir, gameState.wallMode);
  if (!preferredDir) {
    return avoidCollisions(player, gameState, currentDir, settings);
  }

  const safeDir = avoidCollisions(player, gameState, preferredDir, settings);
  return safeDir || preferredDir;
}

// Check if a position is safe (not occupied by snake body)
function isPositionSafe(pos, gameState, excludePlayerId) {
  // Check all players' snake bodies
  return Object.values(gameState.players).every(otherPlayer => {
    if (otherPlayer.id === excludePlayerId || !otherPlayer.isAlive) return true;
    
    for (let i = 0; i < otherPlayer.snake.length; i++) {
      if (otherPlayer.snake[i].x === pos.x && otherPlayer.snake[i].y === pos.y) {
        return false;
      }
    }
    return true;
  });
}

// Predict where other snakes will be next turn
function predictOtherSnakePositions(gameState, excludePlayerId) {
  const predictions = new Map();
  
  Object.values(gameState.players).forEach(otherPlayer => {
    if (otherPlayer.id === excludePlayerId || !otherPlayer.isAlive || otherPlayer.snake.length === 0) return;
    
    const otherHead = otherPlayer.snake[0];
    const otherDir = otherPlayer.nextDirection || otherPlayer.direction;
    let nextPos = { ...otherHead };
    
    if (gameState.wallMode) {
      switch (otherDir) {
        case 'up': nextPos.y = otherHead.y - 1; break;
        case 'down': nextPos.y = otherHead.y + 1; break;
        case 'left': nextPos.x = otherHead.x - 1; break;
        case 'right': nextPos.x = otherHead.x + 1; break;
      }
    } else {
      switch (otherDir) {
        case 'up': nextPos.y = (otherHead.y - 1 + GRID_HEIGHT) % GRID_HEIGHT; break;
        case 'down': nextPos.y = (otherHead.y + 1) % GRID_HEIGHT; break;
        case 'left': nextPos.x = (otherHead.x - 1 + GRID_WIDTH) % GRID_WIDTH; break;
        case 'right': nextPos.x = (otherHead.x + 1) % GRID_WIDTH; break;
      }
    }
    
    predictions.set(otherPlayer.id, nextPos);
  });
  
  return predictions;
}

// Calculate distance to nearest wall
function distanceToWall(head, dir, wallMode) {
  if (!wallMode) return Infinity; // No walls in wrap mode
  
  switch (dir) {
    case 'up': return head.y;
    case 'down': return GRID_HEIGHT - 1 - head.y;
    case 'left': return head.x;
    case 'right': return GRID_WIDTH - 1 - head.x;
    default: return Infinity;
  }
}

// Check if moving in a direction would lead to a dead end (look ahead 2-3 steps)
function wouldLeadToDeadEnd(head, dir, gameState, player, lookAhead = 2) {
  if (!gameState.wallMode) return false; // No dead ends in wrap mode
  
  let currentPos = { ...head };
  let currentDir = dir;
  
  for (let step = 0; step < lookAhead; step++) {
    // Move one step
    switch (currentDir) {
      case 'up': currentPos.y--; break;
      case 'down': currentPos.y++; break;
      case 'left': currentPos.x--; break;
      case 'right': currentPos.x++; break;
    }
    
    // Check if out of bounds
    if (currentPos.x < 0 || currentPos.x >= GRID_WIDTH || 
        currentPos.y < 0 || currentPos.y >= GRID_HEIGHT) {
      return true; // Hit wall
    }
    
    // Check if position is safe
    if (!isPositionSafe(currentPos, gameState, player.id)) {
      return true; // Would hit snake
    }
    
    // Count available directions from this position
    const opposites = { 'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left' };
    const directions = ['up', 'down', 'left', 'right'];
    const availableDirs = directions.filter(d => {
      if (d === opposites[currentDir]) return false; // Can't reverse
      
      let testPos = { ...currentPos };
      switch (d) {
        case 'up': testPos.y--; break;
        case 'down': testPos.y++; break;
        case 'left': testPos.x--; break;
        case 'right': testPos.x++; break;
      }
      
      if (testPos.x < 0 || testPos.x >= GRID_WIDTH || 
          testPos.y < 0 || testPos.y >= GRID_HEIGHT) {
        return false; // Would hit wall
      }
      
      return isPositionSafe(testPos, gameState, player.id);
    });
    
    // If only one direction available, we're in a corridor
    if (availableDirs.length <= 1 && step < lookAhead - 1) {
      return true; // Dead end ahead
    }
  }
  
  return false;
}

function avoidCollisions(player, gameState, preferredDir, settings = null) {
  const head = player.snake[0];
  const directions = ['up', 'down', 'left', 'right'];
  const opposites = { 'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left' };
  const cautionFactor = settings ? 0.5 + settings.caution : 1;
  const lookAhead = settings ? settings.lookAhead : 3;
  const randomness = settings ? settings.randomness : 0;
  
  // Predict where other snakes will be
  const otherSnakePredictions = predictOtherSnakePositions(gameState, player.id);
  
  // In wall mode, filter out directions that would hit walls immediately
  let validDirs = directions.filter(d => d !== opposites[player.direction]);
  if (gameState.wallMode) {
    validDirs = validDirs.filter(dir => {
      switch (dir) {
        case 'up':
          return head.y > 0;
        case 'down':
          return head.y < GRID_HEIGHT - 1;
        case 'left':
          return head.x > 0;
        case 'right':
          return head.x < GRID_WIDTH - 1;
        default:
          return true;
      }
    });
  }
  
  // Score each direction based on safety and desirability
  const dirScores = [];
  
  for (const dir of validDirs) {
    let newHead = { ...head };
    
    // Calculate new position based on wall mode
    if (gameState.wallMode) {
      switch (dir) {
        case 'up': newHead.y = head.y - 1; break;
        case 'down': newHead.y = head.y + 1; break;
        case 'left': newHead.x = head.x - 1; break;
        case 'right': newHead.x = head.x + 1; break;
      }
    } else {
      switch (dir) {
        case 'up': newHead.y = (head.y - 1 + GRID_HEIGHT) % GRID_HEIGHT; break;
        case 'down': newHead.y = (head.y + 1) % GRID_HEIGHT; break;
        case 'left': newHead.x = (head.x - 1 + GRID_WIDTH) % GRID_WIDTH; break;
        case 'right': newHead.x = (head.x + 1) % GRID_WIDTH; break;
      }
    }
    
    // Check wall collision
    if (gameState.wallMode) {
      if (newHead.x < 0 || newHead.x >= GRID_WIDTH || newHead.y < 0 || newHead.y >= GRID_HEIGHT) {
        continue; // Skip this direction
      }
    }
    
    // Check self collision
    let isSafe = true;
    for (let i = 1; i < player.snake.length; i++) {
      if (player.snake[i].x === newHead.x && player.snake[i].y === newHead.y) {
        isSafe = false;
        break;
      }
    }
    
    if (!isSafe) continue;
    
    // Check collision with other snakes (current positions)
    if (!isPositionSafe(newHead, gameState, player.id)) {
      continue;
    }
    
    // Check collision with predicted positions of other snakes
    let wouldCollideWithPrediction = false;
    otherSnakePredictions.forEach((predictedPos, otherPlayerId) => {
      if (predictedPos.x === newHead.x && predictedPos.y === newHead.y) {
        wouldCollideWithPrediction = true;
      }
    });
    
    if (wouldCollideWithPrediction) {
      continue; // Skip - would collide with other snake's predicted position
    }
    
    // Score this direction
    let score = 100; // Base score
    
    // Prefer preferred direction
    if (dir === preferredDir) {
      score += 50;
    }
    
    // In wall mode, prefer directions that keep us away from walls
    if (gameState.wallMode) {
      const wallDist = distanceToWall(newHead, dir, true);
      score += wallDist * (2 + 3 * cautionFactor);
      
      // Heavy penalty for being too close to walls (within 2 cells)
      if (wallDist < 2) {
        score -= 30 * cautionFactor;
      }
      
      // Penalize directions that lead to dead ends
      if (wouldLeadToDeadEnd(newHead, dir, gameState, player, Math.max(2, Math.min(lookAhead, 8)))) {
        score -= 120 * cautionFactor;
      }
    }
    
    // Count how many future directions are available from this position
    const futureDirs = directions.filter(d => {
      if (d === opposites[dir]) return false;
      let testPos = { ...newHead };
      if (gameState.wallMode) {
        switch (d) {
          case 'up': testPos.y--; break;
          case 'down': testPos.y++; break;
          case 'left': testPos.x--; break;
          case 'right': testPos.x++; break;
        }
        if (testPos.x < 0 || testPos.x >= GRID_WIDTH || 
            testPos.y < 0 || testPos.y >= GRID_HEIGHT) return false;
      } else {
        switch (d) {
          case 'up': testPos.y = (newHead.y - 1 + GRID_HEIGHT) % GRID_HEIGHT; break;
          case 'down': testPos.y = (newHead.y + 1) % GRID_HEIGHT; break;
          case 'left': testPos.x = (newHead.x - 1 + GRID_WIDTH) % GRID_WIDTH; break;
          case 'right': testPos.x = (newHead.x + 1) % GRID_WIDTH; break;
        }
      }
      return isPositionSafe(testPos, gameState, player.id);
    });
    
    score += futureDirs.length * (8 + 8 * cautionFactor);
    
    dirScores.push({ dir, score });
  }
  
  // Sort by score (highest first)
  dirScores.sort((a, b) => b.score - a.score);
  
  // Return best direction, with some randomness to avoid loops
  if (dirScores.length > 0) {
    if (randomness > 0 && dirScores.length > 1) {
      const topScore = dirScores[0].score;
      const viable = dirScores.filter(item => item.score >= topScore - 25);
      if (viable.length > 1 && Math.random() < randomness) {
        return viable[Math.floor(Math.random() * viable.length)].dir;
      }
    }
    if (dirScores[0].score > 0) {
      return dirScores[0].dir;
    }
  }
  
  // Fallback: try preferred direction even if risky
  if (validDirs.includes(preferredDir)) {
    return preferredDir;
  }
  
  // Last resort: return any valid direction
  return validDirs.length > 0 ? validDirs[0] : preferredDir;
}

function processNPCInputs(gameState, npcs) {
  Object.values(gameState.players).forEach(player => {
    if (player.type !== 'npc' || !player.isAlive) return;

    const npc = npcs.get(player.id);
    if (!npc) return;

    const direction = decideNPCMove(npc, gameState, player);
    if (direction) {
      // Prevent opposite direction
      const opposites = { 'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left' };
      if (opposites[direction] !== player.direction) {
        player.nextDirection = direction;
      }
    }
  });
}

module.exports = {
  createNPC,
  processNPCInputs,
  getDifficultySettings,
  normalizeNPCConfig
};
