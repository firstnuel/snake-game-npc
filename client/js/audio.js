// Audio system for sound effects
class AudioManager {
  constructor() {
    this.sounds = {};
    this.enabled = true;
    this.volume = 0.7;
    this.soundPool = {};
    this.poolSize = 3; // Number of instances per sound
    this.audioContext = null;
    this.fileStatus = {};
    this.unlockSetup = false;
    this.soundUrls = {}; // Store URL mapping for lazy loading
  }

  // Preload all sounds
  async loadSounds() {
    this.initializeFallbackSounds();

    // Optional: drop real audio files into client/assets/sounds/ to override the synth tones.
    // DISABLED by default to prevent 404 console errors when files don't exist.
    // Uncomment the block below and add sound files to enable file-based sounds:
    /*
    this.soundUrls = {
      gameStart: 'assets/sounds/game-start.mp3',
      gameEnd: 'assets/sounds/game-end.mp3',
      foodEaten: 'assets/sounds/food-eaten.mp3',
      collision: 'assets/sounds/collision.mp3',
      playerDeath: 'assets/sounds/player-death.mp3',
      pause: 'assets/sounds/pause.mp3',
      resume: 'assets/sounds/resume.mp3',
      quit: 'assets/sounds/quit.mp3',
      speedBoost: 'assets/sounds/speed-boost.mp3',
      shield: 'assets/sounds/shield.mp3',
      shrink: 'assets/sounds/shrink.mp3',
      slowOthers: 'assets/sounds/slow-others.mp3'
    };
    
    // Initialize pools and status (lazy loading - no file checks yet)
    this.loadFileSounds(this.soundUrls);
    */

    this.setupUnlock();
  }

  // Initialize fallback sounds using Web Audio API (synthetic tones)
  initializeFallbackSounds() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      this.sounds = {};
      return;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContextClass();
    }

    const audioContext = this.audioContext;

    this.sounds = {
      gameStart: () => this.playTone(audioContext, 440, 0.2),
      gameEnd: () => this.playTone(audioContext, 220, 0.5),
      foodEaten: () => this.playTone(audioContext, 660, 0.1),
      collision: () => this.playTone(audioContext, 150, 0.3),
      playerDeath: () => this.playTone(audioContext, 100, 0.4),
      pause: () => this.playTone(audioContext, 300, 0.15),
      resume: () => this.playTone(audioContext, 400, 0.15),
      quit: () => this.playTone(audioContext, 200, 0.3),
      speedBoost: () => this.playSpeedBoostSound(audioContext),
      shield: () => this.playShieldSound(audioContext),
      shrink: () => this.playShrinkSound(audioContext),
      slowOthers: () => this.playSlowOthersSound(audioContext)
    };
  }

  // Load file-based sounds if present (lazy loading - no upfront checks)
  loadFileSounds(soundFiles) {
    this.soundPool = {};
    this.fileStatus = {};

    for (const [name, url] of Object.entries(soundFiles)) {
      this.soundPool[name] = [];
      this.fileStatus[name] = 'unknown'; // Will be determined on first play attempt
    }
  }

  // Helper to try loading a sound file lazily (called on first play attempt)
  tryLoadSoundFile(soundName, url) {
    // Don't try again if already marked as missing
    if (this.fileStatus[soundName] === 'missing') {
      return;
    }
    
    // Don't try again if already available
    if (this.fileStatus[soundName] === 'available') {
      return;
    }
    
    // Don't try again if already checking
    if (this.fileStatus[soundName] === 'checking') {
      return;
    }
    
    this.fileStatus[soundName] = 'checking';
    
    const audio = new Audio(url);
    audio.volume = this.volume;
    audio.preload = 'none';
    
    // Silent error handling - won't show 404 in console if handled properly
    const handleCanPlay = () => {
      this.fileStatus[soundName] = 'available';
      // Create audio pool only if file exists
      for (let i = 0; i < this.poolSize; i++) {
        try {
          const poolAudio = new Audio(url);
          poolAudio.volume = this.volume;
          poolAudio.preload = 'auto';
          this.soundPool[soundName].push(poolAudio);
        } catch (e) {
          // Ignore errors silently
        }
      }
    };
    
    const handleError = () => {
      if (this.fileStatus[soundName] !== 'available') {
        this.fileStatus[soundName] = 'missing';
      }
    };
    
    audio.addEventListener('canplaythrough', handleCanPlay, { once: true });
    audio.addEventListener('error', handleError, { once: true });
    
    // Try to load silently - if file exists, canplaythrough fires; if not, error fires
    // Suppress console errors by handling the load call safely
    try {
      const loadResult = audio.load();
      // audio.load() may or may not return a promise depending on browser
      if (loadResult && typeof loadResult.catch === 'function') {
        loadResult.catch(() => {
          // Silent catch - file doesn't exist
          handleError();
        });
      }
    } catch (e) {
      // If load() throws an error, mark as missing
      handleError();
    }
  }

  setupUnlock() {
    if (this.unlockSetup) return;
    this.unlockSetup = true;

    const unlock = () => {
      this.resumeAudioContext();
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  resumeAudioContext() {
    if (!this.audioContext || this.audioContext.state !== 'suspended') return;
    this.audioContext.resume().catch(() => {
      // Ignore resume errors (autoplay restrictions will resolve after user gesture)
    });
  }

  // Play a tone using Web Audio API
  playTone(audioContext, frequency, duration) {
    if (!this.enabled) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(this.volume, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
  }

  // Speed Boost power-up sound (⚡ - ascending chirp)
  playSpeedBoostSound(audioContext) {
    if (!this.enabled) return;
    
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(audioContext.destination);
    
    osc.type = 'square';
    gain.gain.setValueAtTime(this.volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    
    // Ascending frequency for speed boost effect
    osc.frequency.setValueAtTime(600, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1000, audioContext.currentTime + 0.2);
    
    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + 0.2);
  }

  // Shield power-up sound (🛡️ - resonant tone)
  playShieldSound(audioContext) {
    if (!this.enabled) return;
    
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(audioContext.destination);
    
    osc.type = 'triangle';
    gain.gain.setValueAtTime(this.volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.35);
    
    // Steady resonant tone for shield protection
    osc.frequency.setValueAtTime(520, audioContext.currentTime);
    osc.frequency.setValueAtTime(440, audioContext.currentTime + 0.1);
    osc.frequency.setValueAtTime(520, audioContext.currentTime + 0.2);
    
    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + 0.35);
  }

  // Shrink power-up sound (📉 - descending chirp)
  playShrinkSound(audioContext) {
    if (!this.enabled) return;
    
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    osc.connect(gain);
    gain.connect(audioContext.destination);
    
    osc.type = 'sine';
    gain.gain.setValueAtTime(this.volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.25);
    
    // Descending frequency for shrink effect
    osc.frequency.setValueAtTime(800, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.25);
    
    osc.start(audioContext.currentTime);
    osc.stop(audioContext.currentTime + 0.25);
  }

  // Slow Others power-up sound (🐌 - slow wobble)
  playSlowOthersSound(audioContext) {
    if (!this.enabled) return;
    
    const osc = audioContext.createOscillator();
    const lfo = audioContext.createOscillator(); // Low frequency oscillator for wobble
    const gain = audioContext.createGain();
    const lfoGain = audioContext.createGain();
    
    osc.connect(gain);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    gain.connect(audioContext.destination);
    
    osc.type = 'sine';
    lfo.type = 'sine';
    
    gain.gain.setValueAtTime(this.volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
    
    // Wobbling effect with low frequency oscillation
    osc.frequency.setValueAtTime(350, audioContext.currentTime);
    lfo.frequency.setValueAtTime(5, audioContext.currentTime); // 5 Hz wobble
    lfoGain.gain.setValueAtTime(50, audioContext.currentTime); // Wobble amplitude
    
    osc.start(audioContext.currentTime);
    lfo.start(audioContext.currentTime);
    
    osc.stop(audioContext.currentTime + 0.4);
    lfo.stop(audioContext.currentTime + 0.4);
  }

  // Play sound from pool
  playSound(soundName) {
    if (!this.enabled) return;

    const status = this.fileStatus[soundName];
    const pool = this.soundPool[soundName];
    const url = this.soundUrls[soundName];
    
    // If status is unknown, try to load file on first play attempt (lazy loading)
    if (status === 'unknown' && url) {
      this.tryLoadSoundFile(soundName, url);
      // Use fallback for now, next time it might be available
      this.playFallback(soundName);
      return;
    }
    
    // Only try to use file if status is 'available'
    if (pool && pool.length > 0 && status === 'available') {
      const audio = this.soundPool[soundName].find(a => a.paused || a.ended);
      if (audio) {
        audio.currentTime = 0;
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            this.playFallback(soundName);
          });
        }
        return;
      }
    }

    // Status is 'missing' or 'checking' - use fallback directly (no 404s)
    this.playFallback(soundName);
  }

  playFallback(soundName) {
    if (this.sounds[soundName]) {
      this.resumeAudioContext();
      this.sounds[soundName]();
    }
  }

  // Set volume (0.0 to 1.0)
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    
    // Update all audio instances
    Object.values(this.soundPool).forEach(pool => {
      pool.forEach(audio => {
        audio.volume = this.volume;
      });
    });
  }

  // Toggle mute
  toggleMute() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
}

// Global audio manager instance
const audioManager = new AudioManager();

// Initialize audio on page load
document.addEventListener('DOMContentLoaded', () => {
  audioManager.loadSounds();
});

// Socket event listeners for sound effects
if (typeof socket !== 'undefined') {
  socket.on('gameStarted', () => {
    audioManager.playSound('gameStart');
  });

  socket.on('gameEnded', () => {
    audioManager.playSound('gameEnd');
  });

  socket.on('gamePaused', () => {
    audioManager.playSound('pause');
  });

  socket.on('gameResumed', () => {
    audioManager.playSound('resume');
  });

  socket.on('gameQuit', () => {
    audioManager.playSound('quit');
  });

  socket.on('playerCollided', () => {
    audioManager.playSound('collision');
  });

  socket.on('powerUpCollected', (data) => {
    // Play sound for the power-up type collected
    audioManager.playSound(data.sound);
  });
}

// Play sound when food is eaten (detected from game state)
function playFoodEatenSound() {
  audioManager.playSound('foodEaten');
}

function playCollisionSound() {
  audioManager.playSound('collision');
}

function playPlayerDeathSound() {
  audioManager.playSound('playerDeath');
}

// Power-up sound functions
function playSpeedBoostSound() {
  audioManager.playSound('speedBoost');
}

function playShieldSound() {
  audioManager.playSound('shield');
}

function playShrinkSound() {
  audioManager.playSound('shrink');
}

function playSlowOthersSound() {
  audioManager.playSound('slowOthers');
}
