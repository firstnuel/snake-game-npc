// Welcome Screen Overlay Logic
(function() {
    'use strict';

    // Constants
    const STEP = 20; // Size of grid cell
    const SPEED = 100; // ms per frame
    const MAX_FRUITS = 8;
    // Removed localStorage check - welcome screen shows on every page load/hard refresh

    // State
    let overlay = null;
    let snakeOverlay = null;
    let audioCtx = null;
    let gameInterval = null;
    let snake = [{x: 100, y: 100}, {x: 80, y: 100}, {x: 60, y: 100}];
    let direction = {x: 1, y: 0};
    let fruits = [];
    let snakeElements = [];
    let isMuted = false;

    // Initialize Audio Context
    function initAudio() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
            // Unlock audio context on first user interaction
            // Modern browsers require user gesture to enable audio
            const unlockAudio = async () => {
                if (audioCtx && audioCtx.state === 'suspended') {
                    try {
                        await audioCtx.resume();
                        console.log('Audio context unlocked');
                    } catch (e) {
                        console.warn('Failed to resume audio context:', e);
                    }
                }
            };
            // Listen for any user interaction to unlock audio
            document.addEventListener('click', unlockAudio, { once: true });
            document.addEventListener('touchstart', unlockAudio, { once: true });
            document.addEventListener('keydown', unlockAudio, { once: true });
        }
    }

    // Sound Generator
    async function playEatSound() {
        if (!audioCtx || isMuted) return;
        
        try {
            // Ensure audio context is running
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }
            
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(400, audioCtx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.15);
        } catch (e) {
            console.warn('Sound playback failed:', e);
        }
    }

    async function playClickSound() {
        if (!audioCtx || isMuted) return;
        
        try {
            // Ensure audio context is running
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }
            
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(600, audioCtx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.05);
            
            gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.08);
        } catch (e) {
            console.warn('Sound playback failed:', e);
        }
    }

    // Initialize Fruits
    function spawnFruit() {
        if (!snakeOverlay) return;
        const rect = snakeOverlay.getBoundingClientRect();
        const overlayW = rect.width;
        const overlayH = rect.height;
        const x = Math.floor(Math.random() * (overlayW / STEP)) * STEP;
        const y = Math.floor(Math.random() * (overlayH / STEP)) * STEP;
        
        const el = document.createElement('div');
        el.className = 'fruit';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        snakeOverlay.appendChild(el);
        fruits.push({x, y, el});
    }

    // AI Logic: Find nearest fruit
    function autoPilot() {
        const head = snake[0];
        
        let closest = null;
        let minDist = Infinity;
        
        fruits.forEach(f => {
            const dist = Math.abs(head.x - f.x) + Math.abs(head.y - f.y);
            if (dist < minDist) {
                minDist = dist;
                closest = f;
            }
        });

        if (!closest) return;

        if (head.x < closest.x) direction = {x: 1, y: 0};
        else if (head.x > closest.x) direction = {x: -1, y: 0};
        else if (head.y < closest.y) direction = {x: 0, y: 1};
        else if (head.y > closest.y) direction = {x: 0, y: -1};
    }

    // Render Snake
    function renderSnake() {
        snakeElements.forEach(el => el.remove());
        snakeElements = [];

        snake.forEach((part, index) => {
            const el = document.createElement('div');
            el.className = 'snake-part';
            if (index === 0) {
                el.classList.add('snake-head');
                const eyeL = document.createElement('div');
                eyeL.className = 'eye left';
                const eyeR = document.createElement('div');
                eyeR.className = 'eye right';
                el.appendChild(eyeL);
                el.appendChild(eyeR);
            }
            el.style.left = part.x + 'px';
            el.style.top = part.y + 'px';
            snakeOverlay.appendChild(el);
            snakeElements.push(el);
        });
    }

    // Game Loop
    function gameLoop() {
        if (!snakeOverlay) return;
        const rect = snakeOverlay.getBoundingClientRect();
        const overlayW = rect.width;
        const overlayH = rect.height;

        if (Math.random() < 0.2) autoPilot();

        const head = snake[0];
        let newHead = {
            x: head.x + (direction.x * STEP),
            y: head.y + (direction.y * STEP)
        };

        // Wrap around overlay bounds
        if (newHead.x >= overlayW) newHead.x = 0;
        if (newHead.x < 0) newHead.x = overlayW - STEP;
        if (newHead.y >= overlayH) newHead.y = 0;
        if (newHead.y < 0) newHead.y = overlayH - STEP;

        snake.unshift(newHead);

        // Check collision with fruits
        let ate = false;
        for (let i = 0; i < fruits.length; i++) {
            const dx = newHead.x - fruits[i].x;
            const dy = newHead.y - fruits[i].y;
            
            if (Math.abs(dx) < STEP && Math.abs(dy) < STEP) {
                playEatSound();
                fruits[i].el.remove();
                fruits.splice(i, 1);
                spawnFruit();
                ate = true;
                break;
            }
        }

        if (!ate) {
            snake.pop();
        }

        renderSnake();
    }

    // Start animation
    function startAnimation() {
        if (gameInterval || !snakeOverlay) return;
        
        // Get overlay dimensions for initial positioning
        const rect = snakeOverlay.getBoundingClientRect();
        const overlayW = rect.width;
        const overlayH = rect.height;
        
        // Reset snake and fruits - start snake in center-left area
        const startX = Math.max(60, Math.floor(overlayW * 0.2));
        const startY = Math.max(60, Math.floor(overlayH * 0.5));
        snake = [
            {x: startX, y: startY},
            {x: startX - STEP, y: startY},
            {x: startX - (STEP * 2), y: startY}
        ];
        direction = {x: 1, y: 0};
        fruits.forEach(f => f.el.remove());
        fruits = [];
        
        // Spawn initial fruits
        for (let i = 0; i < MAX_FRUITS; i++) {
            spawnFruit();
        }
        
        renderSnake();
        gameInterval = setInterval(gameLoop, SPEED);
    }

    // Stop animation
    function stopAnimation() {
        if (gameInterval) {
            clearInterval(gameInterval);
            gameInterval = null;
        }
        fruits.forEach(f => f.el.remove());
        fruits = [];
        snakeElements.forEach(el => el.remove());
        snakeElements = [];
    }

    // Show overlay
    function showOverlay() {
        if (!overlay) return;
        overlay.style.display = 'flex';
        // Small delay to ensure display is set before removing hidden class
        setTimeout(() => {
            overlay.classList.remove('hidden');
        }, 10);
        startAnimation();
    }

    // Hide overlay
    function hideOverlay() {
        if (!overlay) return;
        playClickSound();
        overlay.classList.add('hidden');
        stopAnimation();
        
        // Welcome screen will show again on next page load/hard refresh
        
        // Remove overlay from DOM after animation
        setTimeout(() => {
            if (overlay) {
                overlay.style.display = 'none';
            }
        }, 500);
    }

    // Toggle mute
    function toggleMute() {
        isMuted = !isMuted;
        const btn = overlay.querySelector('.sound-toggle-btn');
        if (btn) {
            const oldSvg = btn.querySelector('svg');
            if (oldSvg) {
                oldSvg.remove();
            }
            const newSvg = isMuted ? createVolumeOffIcon() : createVolumeIcon();
            btn.appendChild(newSvg);
        }
    }

    // Create SVG icon helper
    function createVolumeIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'currentColor');
        svg.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
        return svg;
    }

    function createVolumeOffIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'currentColor');
        svg.innerHTML = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
        return svg;
    }

    // Initialize
    function init() {
        // Check if user has seen welcome screen
        overlay = document.getElementById('welcome-overlay');
        if (!overlay) return;

        snakeOverlay = overlay.querySelector('#snake-overlay');
        if (!snakeOverlay) return;

        // Welcome screen shows on every page load/hard refresh

        // Initialize audio
        initAudio();

        // Setup button handlers
        const startButton = overlay.querySelector('.welcome-button');
        if (startButton) {
            startButton.addEventListener('click', hideOverlay);
        }

        const soundButton = overlay.querySelector('.sound-toggle-btn');
        if (soundButton) {
            soundButton.addEventListener('click', toggleMute);
            // Add icon
            const svg = createVolumeIcon();
            soundButton.appendChild(svg);
        }

        // Show overlay
        showOverlay();

        // Handle window resize - animation will recalculate dimensions in gameLoop
        window.addEventListener('resize', () => {
            // Dimensions are recalculated in gameLoop from getBoundingClientRect
        });
    }

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

