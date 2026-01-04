// Basic NPC AI for single-player mode
const { GRID_WIDTH, GRID_HEIGHT } = require('./gameLogic');

function createNPC(playerId, name, difficulty = 'medium') {
  return {
    id: playerId,
    name: name,
    type: 'npc',
    difficulty: difficulty,
    targetFood: null,
    lastDirection: null,
    decisionDelay: 0
  };
}

function getDifficultySettings(difficulty) {
  const settings = {
    easy: {
      reactionTime: 200, // ms delay before making decisions (reduced for better survival)
      successRate: 0.75, // 75% chance of making good decisions (increased)
      lookAhead: 3 // steps ahead to plan (increased)
    },
    medium: {
      reactionTime: 100, // Reduced reaction time
      successRate: 0.85, // Increased success rate
      lookAhead: 5 // Increased look ahead
    },
    hard: {
      reactionTime: 30, // Faster reaction
      successRate: 0.98, // Very high success rate
      lookAhead: 7 // More look ahead steps
    }
  };
  return settings[difficulty] || settings.medium;
}

function decideNPCMove(npc, gameState, player) {
  if (!player.isAlive || !player.snake || player.snake.length === 0) {
    return null;
  }

  const settings = getDifficultySettings(npc.difficulty);
  
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
    return avoidCollisions(player, gameState, currentDir);
  }

  // Find nearest food with pathfinding consideration
  let bestFood = null;
  let bestScore = -Infinity;

  gameState.food.forEach(food => {
    const dx = food.x - head.x;
    const dy = food.y - head.y;
    const distance = Math.abs(dx) + Math.abs(dy); // Manhattan distance
    
    // In wall mode, prefer food that's not near walls (safer to reach)
    let score = 1000 / (distance + 1); // Base score (closer = better)
    
    if (gameState.wallMode) {
      // Bonus for food that's away from walls
      const foodWallDist = Math.min(
        food.x, 
        GRID_WIDTH - 1 - food.x,
        food.y,
        GRID_HEIGHT - 1 - food.y
      );
      score += foodWallDist * 2;
      
      // Penalty if we're near a wall and food is on the other side
      const headWallDist = Math.min(
        head.x,
        GRID_WIDTH - 1 - head.x,
        head.y,
        GRID_HEIGHT - 1 - head.y
      );
      
      if (headWallDist < 3) {
        // We're near a wall, check if food requires going along the wall
        const requiresWallHug = (head.x < 3 && food.x < 3) || 
                               (head.x > GRID_WIDTH - 4 && food.x > GRID_WIDTH - 4) ||
                               (head.y < 3 && food.y < 3) ||
                               (head.y > GRID_HEIGHT - 4 && food.y > GRID_HEIGHT - 4);
        if (requiresWallHug) {
          score -= 50; // Prefer food that doesn't require wall hugging
        }
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestFood = food;
    }
  });

  // If no food, move to stay safe and avoid walls
  if (!bestFood) {
    // In wall mode, prefer moving toward center
    if (gameState.wallMode) {
      const centerX = GRID_WIDTH / 2;
      const centerY = GRID_HEIGHT / 2;
      const dx = centerX - head.x;
      const dy = centerY - head.y;
      
      let targetDir = null;
      if (Math.abs(dx) > Math.abs(dy)) {
        targetDir = dx > 0 ? 'right' : 'left';
      } else {
        targetDir = dy > 0 ? 'down' : 'up';
      }
      
      return avoidCollisions(player, gameState, targetDir);
    }
    
    return avoidCollisions(player, gameState, currentDir);
  }

  // Calculate direction to food with smarter pathfinding
  let targetDir = null;
  const dx = bestFood.x - head.x;
  const dy = bestFood.y - head.y;

  // Handle wrapping only if wall mode is disabled
  let wrappedDx = dx;
  let wrappedDy = dy;
  if (!gameState.wallMode) {
    wrappedDx = dx > GRID_WIDTH / 2 ? dx - GRID_WIDTH : (dx < -GRID_WIDTH / 2 ? dx + GRID_WIDTH : dx);
    wrappedDy = dy > GRID_HEIGHT / 2 ? dy - GRID_HEIGHT : (dy < -GRID_HEIGHT / 2 ? dy + GRID_HEIGHT : dy);
  }

  // Choose primary direction
  if (Math.abs(wrappedDx) > Math.abs(wrappedDy)) {
    targetDir = wrappedDx > 0 ? 'right' : 'left';
  } else {
    targetDir = wrappedDy > 0 ? 'down' : 'up';
  }

  // Prevent reversing direction
  const opposites = { 'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left' };
  if (targetDir === opposites[currentDir]) {
    // Choose perpendicular direction that's safer
    if (currentDir === 'up' || currentDir === 'down') {
      targetDir = wrappedDx > 0 ? 'right' : 'left';
    } else {
      targetDir = wrappedDy > 0 ? 'down' : 'up';
    }
  }

  // Use improved collision avoidance which considers pathfinding
  const safeDir = avoidCollisions(player, gameState, targetDir);
  return safeDir || targetDir;
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

function avoidCollisions(player, gameState, preferredDir) {
  const head = player.snake[0];
  const directions = ['up', 'down', 'left', 'right'];
  const opposites = { 'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left' };
  
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
      score += wallDist * 3; // Strongly prefer being further from walls
      
      // Heavy penalty for being too close to walls (within 2 cells)
      if (wallDist < 2) {
        score -= 50; // Avoid getting too close to walls
      }
      
      // Penalize directions that lead to dead ends
      if (wouldLeadToDeadEnd(newHead, dir, gameState, player, 3)) {
        score -= 150; // Very heavy penalty for dead ends
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
    
    score += futureDirs.length * 10; // Prefer directions with more options
    
    dirScores.push({ dir, score });
  }
  
  // Sort by score (highest first)
  dirScores.sort((a, b) => b.score - a.score);
  
  // Return best direction, or preferred if no good options
  if (dirScores.length > 0 && dirScores[0].score > 0) {
    return dirScores[0].dir;
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
  getDifficultySettings
};

