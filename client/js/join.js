let currentRoomCode = '';
let isHost = false;
let playerId = '';
let roomIsPublic = false;

document.addEventListener('DOMContentLoaded', () => {
  console.log('Join.js: DOMContentLoaded fired');
  
  const joinForm = document.getElementById('joinForm');
  const waitingRoom = document.getElementById('waitingRoom');
  const playerNameInput = document.getElementById('playerName');
  const roomCodeInput = document.getElementById('roomCode');
  const generateRoomCodeBtn = document.getElementById('generateRoomCode');
  const joinButton = document.getElementById('joinButton');
  const startGameButton = document.getElementById('startGameButton');
  const leaveRoomButton = document.getElementById('leaveRoomButton');
  const nameError = document.getElementById('nameError');
  const singlePlayerNameInput = document.getElementById('singlePlayerName');
  const npcCountSelect = document.getElementById('npcCount');
  const gameModeRadios = document.querySelectorAll('input[name="gameMode"]');
  const multiPlayerFields = document.getElementById('multiPlayerFields');
  const multiPlayerFields2 = document.getElementById('multiPlayerFields2');
  const singlePlayerFields = document.getElementById('singlePlayerFields');
  const singlePlayerFields2 = document.getElementById('singlePlayerFields2');
  const singlePlayerGameOptions = document.getElementById('singlePlayerGameOptions');
  const npcCustomizationSection = document.getElementById('npcCustomizationSection');
  const npcCustomizationList = document.getElementById('npcCustomizationList');
  const controlSchemeRadios = document.querySelectorAll('input[name="controlScheme"]');
  const publicRoomsSection = document.getElementById('publicRoomsSection');
  const publicRoomsList = document.getElementById('publicRoomsList');
  const publicToggleWrapper = document.getElementById('publicToggleWrapper');
  const publicRoomToggle = document.getElementById('publicRoomToggle');
  const publicRoomStatusPill = document.getElementById('publicRoomStatusPill');

  console.log('Elements found:', {
    joinForm: !!joinForm,
    generateRoomCodeBtn: !!generateRoomCodeBtn,
    roomCodeInput: !!roomCodeInput,
    singlePlayerNameInput: !!singlePlayerNameInput,
    npcCountSelect: !!npcCountSelect,
    npcCustomizationList: !!npcCustomizationList,
    gameModeRadios: gameModeRadios.length,
    socket: typeof socket !== 'undefined' ? !!socket : 'undefined'
  });

  const npcNameDefaults = ['Bot-Alpha', 'Bot-Beta', 'Bot-Gamma'];
  const npcProfiles = {
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
  const difficultyMultipliers = {
    easy: { reactionTime: 1.25, successRate: 0.85, lookAhead: 0.85, aggression: 0.9, caution: 1.05 },
    medium: { reactionTime: 1, successRate: 1, lookAhead: 1, aggression: 1, caution: 1 },
    hard: { reactionTime: 0.75, successRate: 1.15, lookAhead: 1.2, aggression: 1.1, caution: 0.95 }
  };

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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getDefaultNpcConfig(index, npcCount) {
    const profileKeys = Object.keys(npcProfiles);
    const profile = profileKeys[index % profileKeys.length] || 'balanced';
    const name = npcNameDefaults[index] || `Bot-${index + 1}`;
    let difficulty = 'medium';
    if (npcCount === 2) {
      difficulty = index === 0 ? 'easy' : 'medium';
    } else if (npcCount >= 3) {
      difficulty = ['easy', 'medium', 'hard'][index] || 'medium';
    }
    return {
      name,
      profile,
      difficulty,
      speed: 3,
      skill: 3,
      boldness: 3
    };
  }

  function calculateNpcStats(config) {
    const profileKey = npcProfiles[config.profile] ? config.profile : 'balanced';
    const profile = npcProfiles[profileKey];
    const difficulty = difficultyMultipliers[config.difficulty] || difficultyMultipliers.medium;

    const speed = clampNumber(config.speed, 1, 5);
    const skill = clampNumber(config.skill, 1, 5);
    const boldness = clampNumber(config.boldness, 1, 5);

    const speedMultiplier = mapRange(speed, 1, 5, 0.8, 1.2);
    const skillMultiplier = mapRange(skill, 1, 5, 0.8, 1.2);
    const boldnessMultiplier = mapRange(boldness, 1, 5, 0.7, 1.3);

    const reactionTime = clampNumber((profile.base.reactionTime * difficulty.reactionTime) / speedMultiplier, 40, 260);
    const successRate = clampNumber(profile.base.successRate * difficulty.successRate * skillMultiplier, 0.4, 0.99);
    const lookAhead = Math.round(clampNumber(profile.base.lookAhead * difficulty.lookAhead * skillMultiplier, 2, 8));
    const aggression = clampNumber(profile.base.aggression * difficulty.aggression * boldnessMultiplier, 0.1, 0.95);
    const caution = clampNumber(profile.base.caution * difficulty.caution / boldnessMultiplier, 0.1, 0.95);

    const speedScore = clampNumber((220 - reactionTime) / 160, 0, 1);
    const lookAheadScore = clampNumber((lookAhead - 2) / 6, 0, 1);
    const effectiveness = Math.round((speedScore * 0.35 + successRate * 0.45 + lookAheadScore * 0.2) * 100);

    return {
      profile,
      reactionTime: Math.round(reactionTime),
      successRate,
      lookAhead,
      aggression,
      caution,
      effectiveness
    };
  }

  function formatEffectiveness(score) {
    if (score >= 86) return 'Extreme';
    if (score >= 66) return 'High';
    if (score >= 41) return 'Medium';
    return 'Low';
  }

  function updateNpcCardDisplay(card) {
    const nameInput = card.querySelector('.npc-name');
    const profileSelect = card.querySelector('.npc-profile');
    const difficultySelect = card.querySelector('.npc-difficulty');
    const speedInput = card.querySelector('.npc-speed');
    const skillInput = card.querySelector('.npc-skill');
    const boldnessInput = card.querySelector('.npc-boldness');
    if (!profileSelect || !difficultySelect || !speedInput || !skillInput || !boldnessInput) return;

    const config = {
      name: nameInput ? nameInput.value : '',
      profile: profileSelect.value,
      difficulty: difficultySelect.value,
      speed: speedInput.value,
      skill: skillInput.value,
      boldness: boldnessInput.value
    };

    const stats = calculateNpcStats(config);
    const effectivenessLabel = formatEffectiveness(stats.effectiveness);

    const effectivenessEl = card.querySelector('[data-effectiveness]');
    if (effectivenessEl) {
      effectivenessEl.textContent = `Effectiveness: ${stats.effectiveness} (${effectivenessLabel})`;
    }

    const profileDescEl = card.querySelector('[data-profile-desc]');
    if (profileDescEl) {
      profileDescEl.textContent = stats.profile.description;
    }

    const statsEl = card.querySelector('[data-npc-stats]');
    if (statsEl) {
      statsEl.textContent = `Reaction: ${stats.reactionTime}ms | Success: ${Math.round(stats.successRate * 100)}% | Look-ahead: ${stats.lookAhead}`;
    }

    const speedValue = card.querySelector('[data-speed-value]');
    if (speedValue) speedValue.textContent = String(speedInput.value);
    const skillValue = card.querySelector('[data-skill-value]');
    if (skillValue) skillValue.textContent = String(skillInput.value);
    const boldnessValue = card.querySelector('[data-boldness-value]');
    if (boldnessValue) boldnessValue.textContent = String(boldnessInput.value);
  }

  function getNpcConfigsFromUI(expectedCount = null) {
    const configs = [];
    if (npcCustomizationList) {
      const cards = npcCustomizationList.querySelectorAll('.npc-card');
      cards.forEach((card) => {
        const nameInput = card.querySelector('.npc-name');
        const profileSelect = card.querySelector('.npc-profile');
        const difficultySelect = card.querySelector('.npc-difficulty');
        const speedInput = card.querySelector('.npc-speed');
        const skillInput = card.querySelector('.npc-skill');
        const boldnessInput = card.querySelector('.npc-boldness');
        if (!profileSelect || !difficultySelect || !speedInput || !skillInput || !boldnessInput) return;
        configs.push({
          name: nameInput ? nameInput.value.trim() : '',
          profile: profileSelect.value,
          difficulty: difficultySelect.value,
          speed: Number(speedInput.value),
          skill: Number(skillInput.value),
          boldness: Number(boldnessInput.value)
        });
      });
    }

    if (typeof expectedCount === 'number') {
      const count = Math.max(1, Math.min(3, expectedCount));
      for (let i = 0; i < count; i += 1) {
        if (!configs[i]) {
          configs[i] = getDefaultNpcConfig(i, count);
        }
      }
      return configs.slice(0, count);
    }

    return configs;
  }

  function renderNpcCustomization(npcCount) {
    if (!npcCustomizationList) return;
    const count = Math.max(1, Math.min(3, npcCount));
    const existingConfigs = getNpcConfigsFromUI();
    npcCustomizationList.innerHTML = '';

    const profileOptions = Object.entries(npcProfiles)
      .map(([key, profile]) => `<option value="${key}">${profile.label}</option>`)
      .join('');
    const difficultyOptions = Object.keys(difficultyMultipliers)
      .map((key) => `<option value="${key}">${key.charAt(0).toUpperCase() + key.slice(1)}</option>`)
      .join('');

    for (let i = 0; i < count; i += 1) {
      const config = existingConfigs[i] || getDefaultNpcConfig(i, count);
      const card = document.createElement('div');
      card.className = 'npc-card';
      card.dataset.npcIndex = String(i);
      card.innerHTML = `
        <div class="npc-card-header">
          <div class="npc-title">NPC ${i + 1}</div>
          <div class="npc-effectiveness" data-effectiveness></div>
        </div>
        <div class="npc-grid">
          <label class="npc-field">
            <span>Name</span>
            <input type="text" class="npc-name" value="${escapeHtml(config.name)}" maxlength="20">
          </label>
          <label class="npc-field">
            <span>Strategy</span>
            <select class="npc-profile">${profileOptions}</select>
          </label>
          <label class="npc-field">
            <span>Difficulty</span>
            <select class="npc-difficulty">${difficultyOptions}</select>
          </label>
          <label class="npc-field npc-slider">
            <span>Speed</span>
            <input type="range" class="npc-speed" min="1" max="5" value="${config.speed}">
            <div class="npc-slider-value" data-speed-value></div>
          </label>
          <label class="npc-field npc-slider">
            <span>Skill</span>
            <input type="range" class="npc-skill" min="1" max="5" value="${config.skill}">
            <div class="npc-slider-value" data-skill-value></div>
          </label>
          <label class="npc-field npc-slider">
            <span>Boldness</span>
            <input type="range" class="npc-boldness" min="1" max="5" value="${config.boldness}">
            <div class="npc-slider-value" data-boldness-value></div>
          </label>
        </div>
        <div class="npc-profile-desc" data-profile-desc></div>
        <div class="npc-stats" data-npc-stats></div>
      `;

      npcCustomizationList.appendChild(card);
      const profileSelect = card.querySelector('.npc-profile');
      const difficultySelect = card.querySelector('.npc-difficulty');
      if (profileSelect) profileSelect.value = config.profile;
      if (difficultySelect) difficultySelect.value = config.difficulty;
      updateNpcCardDisplay(card);
    }
  }

  function handleNpcCustomizationInput(event) {
    const card = event.target.closest('.npc-card');
    if (!card) return;
    updateNpcCardDisplay(card);
  }

  function updateModeUI(selectedMode) {
    if (selectedMode === 'single-player') {
      multiPlayerFields.style.display = 'none';
      multiPlayerFields2.style.display = 'none';
      singlePlayerFields.style.display = 'block';
      singlePlayerFields2.style.display = 'block';
      if (npcCustomizationSection) npcCustomizationSection.style.display = 'block';
      if (singlePlayerGameOptions) singlePlayerGameOptions.style.display = 'block';
      joinButton.textContent = 'Start Single-Player Game';
      if (npcCountSelect) {
        renderNpcCustomization(parseInt(npcCountSelect.value || '2', 10));
      }
    } else {
      multiPlayerFields.style.display = 'block';
      multiPlayerFields2.style.display = 'block';
      singlePlayerFields.style.display = 'none';
      singlePlayerFields2.style.display = 'none';
      if (npcCustomizationSection) npcCustomizationSection.style.display = 'none';
      if (singlePlayerGameOptions) singlePlayerGameOptions.style.display = 'none';
      joinButton.textContent = 'Join Room';
    }
  }

  // Handle mode toggle
  gameModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      updateModeUI(e.target.value);
    });
  });

  // Set default UI to match default selection (single-player by design)
  const defaultModeRadio = document.querySelector('input[name="gameMode"]:checked');
  const defaultMode = defaultModeRadio ? defaultModeRadio.value : 'single-player';
  updateModeUI(defaultMode);

  if (npcCountSelect) {
    npcCountSelect.addEventListener('change', () => {
      const selectedMode = document.querySelector('input[name="gameMode"]:checked')?.value;
      if (selectedMode === 'single-player') {
        renderNpcCustomization(parseInt(npcCountSelect.value || '2', 10));
      }
    });
  }

  if (npcCustomizationList) {
    npcCustomizationList.addEventListener('input', handleNpcCustomizationInput);
    npcCustomizationList.addEventListener('change', handleNpcCustomizationInput);
  }

  function setPublicToggleVisibility(show) {
    if (!publicToggleWrapper) return;
    publicToggleWrapper.style.display = show ? 'flex' : 'none';
  }

  function updatePublicToggleUI(isPublic) {
    roomIsPublic = !!isPublic;
    if (publicRoomToggle) {
      publicRoomToggle.textContent = roomIsPublic ? 'Make Room Private' : 'Make Room Public';
    }
    if (publicRoomStatusPill) {
      publicRoomStatusPill.textContent = roomIsPublic ? 'Public' : 'Private';
      publicRoomStatusPill.classList.toggle('pill-public', roomIsPublic);
      publicRoomStatusPill.classList.toggle('pill-private', !roomIsPublic);
    }
  }

  // Generate random room code
  if (generateRoomCodeBtn && roomCodeInput) {
    console.log('Setting up Generate button handler');
    generateRoomCodeBtn.addEventListener('click', (e) => {
      console.log('Generate button CLICKED!');
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      console.log('Generated code:', code);
      roomCodeInput.value = code;
      roomCodeInput.removeAttribute('required'); // Remove required after generating
      roomCodeInput.focus();
      console.log('Room code set to:', roomCodeInput.value);
    });
    
    // Also allow double-click on input to generate
    roomCodeInput.addEventListener('dblclick', () => {
      generateRoomCodeBtn.click();
    });
  } else {
    console.error('Generate button or room code input not found!', {
      button: !!generateRoomCodeBtn,
      input: !!roomCodeInput
    });
  }

  // Join room or start single-player - handle via button click (not form submit)
  if (joinButton) {
    console.log('Setting up Join button click handler');
    joinButton.addEventListener('click', (e) => {
      console.log('Join button CLICKED!');
      e.preventDefault();
      e.stopPropagation();
      
      const selectedModeRadio = document.querySelector('input[name="gameMode"]:checked');
      if (!selectedModeRadio) {
        console.error('No game mode selected!');
        if (nameError) nameError.textContent = 'Please select a game mode';
        return;
      }
      
      const selectedMode = selectedModeRadio.value;
      console.log('Selected mode:', selectedMode);
      
      if (selectedMode === 'single-player') {
        console.log('Starting single-player mode');
        const playerName = (singlePlayerNameInput?.value.trim() || 'Player');
        const npcCount = Math.max(1, Math.min(3, parseInt(npcCountSelect?.value || '2', 10)));
        const npcConfigs = getNpcConfigsFromUI(npcCount);
        const playerToken = typeof getOrCreatePlayerToken === 'function'
          ? getOrCreatePlayerToken()
          : null;
        
        console.log('Single-player params:', { playerName, npcCount, socketExists: !!socket });
        
        if (!socket) {
          console.error('Socket not initialized!');
          if (nameError) nameError.textContent = 'Connection error. Please wait a moment and try again.';
          if (typeof initSocket === 'function') {
            console.log('Attempting to initialize socket...');
            initSocket();
            setTimeout(() => {
              if (socket) {
                console.log('Socket initialized, emitting startSinglePlayer');
                socket.emit('startSinglePlayer', {
                  playerName,
                  npcCount,
                  npcConfigs,
                  playerToken
                });
              } else {
                console.error('Socket still not initialized after timeout');
                if (nameError) nameError.textContent = 'Failed to connect. Please refresh the page.';
                if (joinButton) {
                  joinButton.disabled = false;
                  joinButton.textContent = 'Start Single-Player Game';
                }
              }
            }, 1000);
          }
          return;
        }

        if (joinButton) {
          joinButton.disabled = true;
          joinButton.textContent = 'Starting Single-Player Game...';
        }
        // Get selected control scheme
        const selectedControlScheme = document.querySelector('input[name="controlScheme"]:checked');
        const controlScheme = selectedControlScheme ? selectedControlScheme.value : 'wasd';
        
        // Get game options for single-player (only wall mode)
        const wallModeToggle = document.getElementById('singlePlayerWallModeToggle');
        const wallMode = wallModeToggle ? wallModeToggle.checked : false;
        
        console.log('Emitting startSinglePlayer event with options:', { playerName, npcCount, controlScheme, wallMode });
        
        // Store game initialization data for "Play Again" functionality (use localStorage for persistence)
        const gameInitData = {
          playerName,
          npcCount,
          gameMode: 'single-player',
          controlScheme,
          playerToken,
          npcConfigs,
          gameOptions: {
            wallMode
          },
          timestamp: Date.now()
        };
        localStorage.setItem('singlePlayerGameData', JSON.stringify(gameInitData));
        
        // Also log in dev mode
        if (typeof window !== 'undefined' && window.devLog) {
          window.devLog.log('Stored single-player game data:', gameInitData);
        }
        
        socket.emit('startSinglePlayer', gameInitData);
        return;
      }
    
      // Multi-player mode
      const playerName = playerNameInput?.value.trim();
      const roomCode = roomCodeInput?.value.trim().toUpperCase();
      const playerToken = typeof getOrCreatePlayerToken === 'function'
        ? getOrCreatePlayerToken()
        : null;
      const selectedControlScheme = document.querySelector('input[name="controlScheme"]:checked');
      const controlScheme = selectedControlScheme ? selectedControlScheme.value : 'wasd';

      if (!playerName) {
        if (nameError) nameError.textContent = 'Please enter your name';
        return;
      }

      if (playerName.length < 2) {
        if (nameError) nameError.textContent = 'Name must be at least 2 characters';
        return;
      }

      if (!roomCode) {
        if (nameError) nameError.textContent = 'Please enter or generate a room code';
        return;
      }

      if (nameError) nameError.textContent = '';
      if (joinButton) {
        joinButton.disabled = true;
        joinButton.textContent = 'Joining...';
      }

      if (!socket) {
        if (nameError) nameError.textContent = 'Connection error. Please wait a moment and try again.';
        if (joinButton) {
          joinButton.disabled = false;
          joinButton.textContent = 'Join Room';
        }
        // Try to initialize socket if it's not ready
        if (typeof initSocket === 'function') {
          initSocket();
          setTimeout(() => {
            if (socket) {
              socket.emit('joinRoom', {
                playerName,
                roomCode,
                controlScheme,
                playerToken
              });
            }
          }, 500);
        }
        return;
      }

      socket.emit('joinRoom', {
        playerName,
        roomCode,
        controlScheme,
        playerToken
      });
    });
  }

  if (publicRoomToggle) {
    publicRoomToggle.addEventListener('click', () => {
      if (!socket || !currentRoomCode) return;
      socket.emit('togglePublicRoom', {
        roomCode: currentRoomCode,
        isPublic: !roomIsPublic
      });
    });
  }

  if (publicRoomsList) {
    publicRoomsList.addEventListener('click', (e) => {
      const joinBtn = e.target.closest('.public-room-join');
      if (!joinBtn) return;
      const roomCodeToJoin = joinBtn.getAttribute('data-room');
      if (!roomCodeToJoin) return;

      const multiRadio = document.querySelector('input[name="gameMode"][value="multi-player"]');
      if (multiRadio) {
        multiRadio.checked = true;
        updateModeUI('multi-player');
      }

      if (roomCodeInput) {
        roomCodeInput.value = roomCodeToJoin;
      }

      if (joinButton) {
        joinButton.click();
      }
    });
  }

  // Socket event handlers - wait for socket to be initialized
  function setupSocketHandlers() {
    if (!socket) {
      console.log('Waiting for socket initialization...');
      setTimeout(setupSocketHandlers, 100);
      return;
    }

    console.log('Socket ready, setting up handlers');

    function renderSessionHistory(sessions) {
      const list = document.getElementById('sessionHistoryList');
      if (!list) {
        return;
      }

      list.innerHTML = '';
      if (!sessions || sessions.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'session-history-item';
        emptyItem.textContent = 'No matches recorded yet';
        list.appendChild(emptyItem);
        return;
      }

      sessions.forEach(session => {
        const item = document.createElement('li');
        item.className = 'session-history-item';
        const durationSeconds = typeof session.durationSeconds === 'number' ? session.durationSeconds : null;
        const durationLabel = durationSeconds !== null
          ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
          : '--';
        
        // Check if session is actually active (not ended)
        // If isActive is false or undefined, and there's no winner, it means the game ended without a winner
        const isActive = session.isActive === true;
        let winnerLabel;
        if (isActive) {
          winnerLabel = 'In progress';
        } else if (session.winnerName) {
          winnerLabel = `${session.winnerName}${session.winnerScore !== null ? ` (${session.winnerScore})` : ''}`;
        } else {
          // Game ended but no winner (disconnected, etc.)
          winnerLabel = 'Ended';
        }
        
        const modeSpan = document.createElement('span');
        modeSpan.textContent = session.gameMode;
        const winnerSpan = document.createElement('span');
        winnerSpan.textContent = winnerLabel;
        const durationSpan = document.createElement('span');
        durationSpan.textContent = durationLabel;
        item.appendChild(modeSpan);
        item.appendChild(winnerSpan);
        item.appendChild(durationSpan);
        list.appendChild(item);
      });
    }

    function renderPublicRooms(rooms) {
      if (!publicRoomsSection || !publicRoomsList) {
        return;
      }

      // Hide public rooms while in waiting room
      if (waitingRoom && waitingRoom.style.display === 'block') {
        publicRoomsSection.style.display = 'none';
        return;
      }

      publicRoomsSection.style.display = 'block';
      publicRoomsList.innerHTML = '';

      if (!rooms || rooms.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'public-room-card empty';
        empty.textContent = 'No public rooms available';
        publicRoomsList.appendChild(empty);
        return;
      }

      rooms.forEach((room) => {
        const card = document.createElement('div');
        card.className = 'public-room-card';
        const hostName = room.hostName || 'Host';
        const playerCount = typeof room.playerCount === 'number' ? room.playerCount : 0;
        const code = room.roomCode || '';

        card.innerHTML = `
          <div class="public-room-row">
            <div class="public-room-host">${hostName}</div>
            <div class="public-room-code">${code}</div>
          </div>
          <div class="public-room-row meta">
            <span class="public-room-players">${playerCount}/4 players</span>
            <button class="btn-primary public-room-join" data-room="${code}">Join</button>
          </div>
        `;

        publicRoomsList.appendChild(card);
      });
    }

    socket.emit('requestSessionHistory');
    socket.emit('requestPublicRooms');

    socket.on('sessionHistory', (data) => {
      renderSessionHistory(data.sessions || []);
    });

    socket.on('publicRoomsUpdated', (data) => {
      renderPublicRooms(data.rooms || []);
    });

    socket.on('publicRoomStatus', (data) => {
      if (data.roomCode && data.roomCode === currentRoomCode) {
        updatePublicToggleUI(data.isPublic);
      }
      if (data.error && nameError) {
        nameError.textContent = data.error;
      }
    });

    socket.on('joinedRoom', (data) => {
      playerId = data.playerId;
      isHost = data.isHost;
      currentRoomCode = data.roomCode;
      roomIsPublic = !!data.isPublic;
      updatePublicToggleUI(roomIsPublic);
      if (data.playerToken && typeof localStorage !== 'undefined') {
        localStorage.setItem('snakeGamePlayerToken', data.playerToken);
      }

      joinForm.style.display = 'none';
      waitingRoom.style.display = 'block';
      if (publicRoomsSection) {
        publicRoomsSection.style.display = 'none';
      }
      const sessionHistory = document.getElementById('sessionHistory');
      if (sessionHistory) {
        sessionHistory.style.display = 'none';
      }
      const displayRoomCode = document.getElementById('displayRoomCode');
      if (displayRoomCode) {
        displayRoomCode.textContent = currentRoomCode;
      }

      // Setup copy button for displayed room code (only show for host)
      const copyDisplayRoomCodeBtn = document.getElementById('copyDisplayRoomCode');
      if (copyDisplayRoomCodeBtn) {
        // Only show copy button if player is host
        if (isHost) {
          copyDisplayRoomCodeBtn.style.display = 'inline-block';
          
          // Remove any existing listeners by cloning and replacing
          const newBtn = copyDisplayRoomCodeBtn.cloneNode(true);
          copyDisplayRoomCodeBtn.parentNode.replaceChild(newBtn, copyDisplayRoomCodeBtn);
          
          newBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(currentRoomCode);
              // Visual feedback
              const originalText = newBtn.textContent;
              newBtn.textContent = 'Copied!';
              newBtn.style.backgroundColor = '#4CAF50';
              setTimeout(() => {
                newBtn.textContent = originalText;
                newBtn.style.backgroundColor = '';
              }, 2000);
            } catch (err) {
              console.error('Failed to copy room code:', err);
            }
          });
        } else {
          copyDisplayRoomCodeBtn.style.display = 'none';
        }
      }

      if (isHost && data.gameMode === 'multi-player') {
        document.getElementById('hostControls').style.display = 'block';
        setupGameOptionsHandlers();
        setPublicToggleVisibility(true);
      } else {
        setPublicToggleVisibility(false);
      }
      
      // Request current game options
      if (socket && currentRoomCode) {
        socket.emit('requestGameOptions', { roomCode: currentRoomCode });
      }
    });

    socket.on('joinError', (data) => {
      nameError.textContent = data.message;
      joinButton.disabled = false;
      joinButton.textContent = 'Join Room';
    });

    socket.on('playerJoined', (data) => {
      updatePlayersList(data.players);
      
      if (isHost) {
        startGameButton.disabled = data.players.length < 2;
      }
    });

    socket.on('playerLeft', (data) => {
      // Show notification to all players including host
      if (data.playerName) {
        const reason = data.reason || 'left';
        let message = reason === 'disconnected' 
          ? `${data.playerName} disconnected`
          : reason === 'quit'
          ? `${data.playerName} quit the game`
          : `${data.playerName} left the game`;
        
        // Show notification
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
        setTimeout(() => notification.remove(), 3000);
      }
      
      if (data.players) {
        updatePlayersList(data.players);
        
        if (isHost) {
          startGameButton.disabled = data.players.length < 2;
        }
      }
    });

    socket.on('gameOptionsUpdated', (data) => {
      updateGameOptionsDisplay(data.gameOptions);
    });

    socket.on('hostChanged', (data) => {
      if (data.newHostId === playerId) {
        isHost = true;
        document.getElementById('hostControls').style.display = 'block';
        const allowPublicToggle = currentRoomCode && !currentRoomCode.startsWith('SP');
        setPublicToggleVisibility(!!allowPublicToggle);
        // Show copy button when player becomes host
        const copyDisplayRoomCodeBtn = document.getElementById('copyDisplayRoomCode');
        if (copyDisplayRoomCodeBtn) {
          copyDisplayRoomCodeBtn.style.display = 'inline-block';
        }
      } else {
        isHost = false;
        setPublicToggleVisibility(false);
        // Hide copy button when player is no longer host
        const copyDisplayRoomCodeBtn = document.getElementById('copyDisplayRoomCode');
        if (copyDisplayRoomCodeBtn) {
          copyDisplayRoomCodeBtn.style.display = 'none';
        }
      }
    });

    // Countdown is now handled on game board, not in waiting room
    // Remove countdown handler from waiting room

    socket.on('gameStarted', (data) => {
      console.log('Game started event received:', data);
      // Hide countdown overlay if still showing
      const countdownOverlay = document.getElementById('waitingRoomCountdown');
      if (countdownOverlay) {
        countdownOverlay.style.display = 'none';
      }
      
      // Store game state in sessionStorage before redirect so game.html can use it
      if (data.gameState) {
        sessionStorage.setItem('pendingGameState', JSON.stringify({
          gameState: data.gameState,
          roomCode: data.roomCode || currentRoomCode,
          playerId: data.playerId || playerId
        }));
      }
      // Redirect to game screen immediately (sessionStorage is synchronous)
      const roomCode = data.roomCode || currentRoomCode;
      const gamePlayerId = data.playerId || playerId;
      // Get control scheme from selected radio button or localStorage
      const selectedControlScheme = document.querySelector('input[name="controlScheme"]:checked');
      const controlScheme = selectedControlScheme ? selectedControlScheme.value : (localStorage.getItem('snakeGameControlScheme') || 'wasd');
      console.log('Redirecting to game:', { roomCode, playerId: gamePlayerId, controlScheme });
      // Redirect immediately - sessionStorage is synchronous
      window.location.href = `/game.html?room=${roomCode}&player=${gamePlayerId}&controls=${controlScheme}`;
    });

    socket.on('error', (data) => {
      console.error('Socket error:', data);
      if (nameError) {
        nameError.textContent = data.message || 'An error occurred';
      }
      if (joinButton) {
        const selectedModeRadio = document.querySelector('input[name="gameMode"]:checked');
        const selectedMode = selectedModeRadio ? selectedModeRadio.value : 'multi-player';
        joinButton.disabled = false;
        joinButton.textContent = selectedMode === 'single-player' ? 'Start Single-Player Game' : 'Join Room';
      }
    });

    // Start game button
    startGameButton.addEventListener('click', () => {
      if (!isHost) return;

      if (!socket) {
        nameError.textContent = 'Connection error. Please refresh the page.';
        return;
      }

      socket.emit('startGame', {
        roomCode: currentRoomCode
      });

      startGameButton.disabled = true;
      startGameButton.textContent = 'Starting...';
    });

    // Leave room button
    leaveRoomButton.addEventListener('click', () => {
      if (socket) {
        socket.disconnect();
      }
      window.location.reload();
    });

    function updatePlayersList(players) {
      const playersList = document.getElementById('playersList');
      const playerCount = document.getElementById('playerCount');
      
      playerCount.textContent = players.length;
      playersList.innerHTML = '';

      players.forEach(player => {
        const li = document.createElement('li');
        const hostIndicator = player.isHost ? '👑 ' : '';
        li.textContent = hostIndicator + player.name + (player.isHost ? ' (Host)' : '');
        if (player.id === playerId) {
          li.classList.add('current-player');
        }
        playersList.appendChild(li);
      });
    }

    function setupGameOptionsHandlers() {
      const wallModeToggle = document.getElementById('wallModeToggle');
      const strictModeToggle = document.getElementById('strictModeToggle');
      const timeLimitSelect = document.getElementById('timeLimitSelect');

      // Wall mode toggle
      if (wallModeToggle) {
        wallModeToggle.addEventListener('change', () => {
          if (!socket || !socket.connected || !isHost) return;
          
          socket.emit('updateGameOptions', {
            roomCode: currentRoomCode,
            gameOptions: {
              wallMode: wallModeToggle.checked
            }
          });
        });
      }

      // Strict mode toggle
      if (strictModeToggle) {
        strictModeToggle.addEventListener('change', () => {
          if (!socket || !socket.connected || !isHost) return;
          
          socket.emit('updateGameOptions', {
            roomCode: currentRoomCode,
            gameOptions: {
              strictMode: strictModeToggle.checked
            }
          });
        });
      }

      // Time limit select
      if (timeLimitSelect) {
        timeLimitSelect.addEventListener('change', () => {
          if (!socket || !socket.connected || !isHost) return;
          
          const timeLimit = timeLimitSelect.value ? parseInt(timeLimitSelect.value) : null;
          socket.emit('updateGameOptions', {
            roomCode: currentRoomCode,
            gameOptions: {
              timeLimit: timeLimit
            }
          });
        });
      }
    }

    function updateGameOptionsDisplay(gameOptions) {
      if (!gameOptions) return;

      const wallModeToggle = document.getElementById('wallModeToggle');
      const strictModeToggle = document.getElementById('strictModeToggle');
      const timeLimitSelect = document.getElementById('timeLimitSelect');
      const wallModeStatus = document.getElementById('wallModeStatus');
      const strictModeStatus = document.getElementById('strictModeStatus');
      const strictModeInfo = document.getElementById('strictModeInfo');
      const timeLimitStatus = document.getElementById('timeLimitStatus');

      // Update wall mode
      if (wallModeToggle && gameOptions.wallMode !== undefined) {
        wallModeToggle.checked = gameOptions.wallMode;
      }
      if (wallModeStatus) {
        wallModeStatus.textContent = gameOptions.wallMode 
          ? 'Wall Mode: ON (Walls kill)' 
          : 'Wall Mode: OFF (Wrapping)';
      }

      // Update strict mode
      if (strictModeToggle && gameOptions.strictMode !== undefined) {
        strictModeToggle.checked = gameOptions.strictMode;
      }
      if (strictModeStatus) {
        if (gameOptions.strictMode) {
          strictModeStatus.style.display = 'inline';
          strictModeStatus.textContent = 'Strict Mode: ON ⚠️';
        } else {
          strictModeStatus.style.display = 'none';
        }
      }
      if (strictModeInfo) {
        strictModeInfo.style.display = gameOptions.strictMode ? 'block' : 'none';
      }

      // Update time limit
      if (timeLimitSelect && gameOptions.timeLimit !== undefined) {
        timeLimitSelect.value = gameOptions.timeLimit || '';
      }
      if (timeLimitStatus) {
        const timeLimitText = gameOptions.timeLimit 
          ? `${gameOptions.timeLimit} minutes` 
          : 'None';
        timeLimitStatus.textContent = `Time Limit: ${timeLimitText}`;
      }
    }
  }

  // Start setting up socket handlers (will retry if socket not ready)
  setupSocketHandlers();

  // Server URL configuration
  const serverUrlInput = document.getElementById('serverUrl');
  const saveServerUrlBtn = document.getElementById('saveServerUrl');
  const clearServerUrlBtn = document.getElementById('clearServerUrl');
  const currentServerUrlDisplay = document.getElementById('currentServerUrl');

  // Function to fetch and display server network IP addresses
  async function fetchServerNetworkIPs() {
    try {
      const response = await fetch('/api/server-info');
      if (response.ok) {
        const data = await response.json();
        if (data.addresses && data.addresses.length > 0) {
          // Display network IPs for other devices to connect
          const networkIPsDiv = document.getElementById('networkIPsDisplay');
          if (networkIPsDiv) {
            const ipList = data.connectionUrls.map(url => {
              const urlObj = new URL(url);
              return urlObj.hostname;
            }).join(', ');
            networkIPsDiv.innerHTML = `
              <strong>Network IP Addresses:</strong> ${ipList}<br>
              <small style="color: #666;">Use one of these IPs on other devices: <code>http://${data.addresses[0]}:${data.port}</code></small>
            `;
            networkIPsDiv.style.display = 'block';
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch server network IPs:', error);
    }
  }

  // Function to update current server URL display
  function updateCurrentServerUrlDisplay() {
    if (!currentServerUrlDisplay) return;
    
    // Get current server URL from socket or localStorage
    let currentUrl = null;
    
    // Check if socket is connected and has a URL
    if (socket && socket.io && socket.io.uri) {
      currentUrl = socket.io.uri;
    } else if (socket && socket.connected && socket.io && socket.io.opts && socket.io.opts.hostname) {
      // Try to construct URL from socket options
      const opts = socket.io.opts;
      const protocol = opts.secure ? 'https' : 'http';
      const port = opts.port ? `:${opts.port}` : '';
      currentUrl = `${protocol}://${opts.hostname}${port}`;
    } else {
      // Fall back to localStorage or window.location
      const savedUrl = localStorage.getItem('gameServerUrl');
      if (savedUrl) {
        currentUrl = savedUrl;
      } else {
        // Use current page origin
        currentUrl = window.location.origin;
      }
    }
    
    // Display the URL
    if (currentUrl) {
      try {
        const urlObj = new URL(currentUrl);
        const displayText = urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1'
          ? `${currentUrl} (Local)`
          : currentUrl;
        currentServerUrlDisplay.textContent = displayText;
      } catch (e) {
        currentServerUrlDisplay.textContent = currentUrl;
      }
    } else {
      currentServerUrlDisplay.textContent = window.location.origin;
    }
    
    // Also fetch and display network IPs
    fetchServerNetworkIPs();
  }

  // Update display initially
  updateCurrentServerUrlDisplay();

  // Update display when socket connects (if socket exists)
  if (socket) {
    socket.on('connect', () => {
      setTimeout(updateCurrentServerUrlDisplay, 100);
    });
  } else {
    // Wait for socket to be initialized
    const checkSocket = setInterval(() => {
      if (socket || window.socket) {
        const s = socket || window.socket;
        if (s) {
          s.on('connect', () => {
            setTimeout(updateCurrentServerUrlDisplay, 100);
          });
          // Update immediately if already connected
          if (s.connected) {
            setTimeout(updateCurrentServerUrlDisplay, 100);
          }
        }
        clearInterval(checkSocket);
      }
    }, 100);
    // Stop checking after 5 seconds
    setTimeout(() => clearInterval(checkSocket), 5000);
  }

  // Load saved server URL
  if (serverUrlInput) {
    const savedUrl = localStorage.getItem('gameServerUrl');
    if (savedUrl) {
      serverUrlInput.value = savedUrl;
    }

    // Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const serverParam = urlParams.get('server');
    if (serverParam) {
      serverUrlInput.value = serverParam;
    }
  }

  // Helper function to normalize server URL
  function normalizeServerUrl(url) {
    if (!url) return null;
    url = url.trim();
    // If URL doesn't start with http:// or https://, add http://
    if (url && !url.match(/^https?:\/\//i)) {
      url = 'http://' + url;
    }
    return url;
  }

  // Save server URL
  if (saveServerUrlBtn) {
    saveServerUrlBtn.addEventListener('click', () => {
      const url = serverUrlInput.value.trim();
      if (url) {
        const normalizedUrl = normalizeServerUrl(url);
        const oldUrl = localStorage.getItem('gameServerUrl') || window.location.origin;
        localStorage.setItem('gameServerUrl', normalizedUrl);
        // Update input field with normalized URL
        serverUrlInput.value = normalizedUrl;
        // Update display
        updateCurrentServerUrlDisplay();
        // Notify server about URL change before disconnecting
        if (socket && socket.connected) {
          socket.emit('serverUrlChanged', {
            oldUrl: oldUrl,
            newUrl: normalizedUrl,
            action: 'saved'
          });
        }
        alert('Server URL saved! Reconnecting...');
        // Disconnect current socket and reconnect
        if (socket) {
          socket.disconnect();
        }
        // Reinitialize socket with new URL
        if (typeof initSocket === 'function') {
          initSocket();
          setTimeout(() => {
            window.location.reload();
          }, 500);
        } else {
          window.location.reload();
        }
      } else {
        // Clear saved URL
        const oldUrl = localStorage.getItem('gameServerUrl') || window.location.origin;
        localStorage.removeItem('gameServerUrl');
        // Update display
        updateCurrentServerUrlDisplay();
        // Notify server about URL change before disconnecting
        if (socket && socket.connected) {
          socket.emit('serverUrlChanged', {
            oldUrl: oldUrl,
            newUrl: window.location.origin,
            action: 'cleared'
          });
        }
        alert('Server URL cleared! Reconnecting to default server...');
        if (socket) {
          socket.disconnect();
        }
        window.location.reload();
      }
    });
  }

  // Clear server URL
  if (clearServerUrlBtn) {
    clearServerUrlBtn.addEventListener('click', () => {
      const oldUrl = localStorage.getItem('gameServerUrl') || window.location.origin;
      localStorage.removeItem('gameServerUrl');
      serverUrlInput.value = '';
      // Update display
      updateCurrentServerUrlDisplay();
      // Notify server about URL change before disconnecting
      if (socket && socket.connected) {
        socket.emit('serverUrlChanged', {
          oldUrl: oldUrl,
          newUrl: window.location.origin,
          action: 'reset'
        });
      }
      alert('Server URL reset! Reconnecting to default server...');
      if (socket) {
        socket.disconnect();
      }
      window.location.reload();
    });
  }
});
