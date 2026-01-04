# Multiplayer Snake Game

A real-time multiplayer Snake game built with Node.js, Express, Socket.io, and vanilla JavaScript. Supports 2-4 players with smooth 60 FPS DOM-based rendering (no canvas required).

## Test link
https://snake-bite.up.railway.app/

## Features

### Core Features
- **Multiplayer Support**: 2-4 players can join and play simultaneously
- **Real-time Synchronization**: Server-authoritative game state with client-side prediction
- **60 FPS Performance**: Smooth animations using requestAnimationFrame and optimized DOM rendering
- **Keyboard Controls**: Responsive keyboard input with multiple control schemes (WASD, Arrow keys, IJKL, TFGH)
- **Menu System**: Pause, Resume, and Quit functionality with broadcast messages
- **Scoring System**: Real-time score tracking and winner announcement
- **Game Timer**: Tracks game duration (counts up, synchronized across all players)
- **Sound Effects**: Audio feedback for game events (using Web Audio API)
- **Pause System**: All players can pause/resume (15 min limit in multiplayer, unlimited in solo)
- **Timer Freeze**: Timer stops when game is paused

### Game Modes
- **Multi-Player Mode**: 2-4 human players compete in real-time
- **Single-Player Mode (vs NPCs)**: Play against 1-3 AI opponents with intelligent NPC behavior
- **Solo Mode**: Play alone without NPCs (1.5% faster than other modes)

### Game Options
- **Wall Mode**: Optional wall collision mode (walls kill instead of wrapping)
- **Strict Mode**: Collision detection options (all body collisions fatal vs only head collisions)
- **Time Limit**: Optional time-based game ending
- **Power-ups**: Special abilities including speed boost, shield, shrink, and slow others (enabled by default)

### Enabled by Default
- **Chat System**: Real-time chat during gameplay (enabled by default)
- **Accessibility Features**: Colorblind mode, high contrast, font size adjustment, screen reader support (enabled by default)
- **Power-ups**: Special abilities including speed boost, shield, shrink, and slow others (enabled by default)

## Quick Start

### Installation

1. **Navigate to server directory**
   ```bash
   cd server
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Open browser**
   - Navigate to `http://localhost:3000`
   - Start playing!

## Commands

### Default Mode (Chat, Accessibility & Power-ups Enabled)
```bash
npm start
```
Starts server with **Chat**, **Accessibility**, and **Power-ups** features enabled by default.

### Development Mode (Auto-restart - All Features)
```bash
npm run dev
```
Starts server with nodemon for auto-restart on file changes. **All features enabled** (Chat, Power-ups, and Accessibility).

### Enable All Features
```bash
npm run all
```
Starts server with **Chat**, **Power-ups**, and **Accessibility** all enabled.

### Individual Feature Commands
```bash
npm run chat          # Enable only chat (chat + accessibility by default)
npm run powerups      # Enable only power-ups (chat + accessibility by default)
npm run accessibility # Enable only accessibility (chat + accessibility by default)
```

### Code Quality (ESLint)
```bash
# From project root directory
npm run lint          # Lint all JavaScript files (server + client)
npm run lint:fix      # Auto-fix linting issues
npm run lint:server   # Lint only server files
npm run lint:client   # Lint only client files
```

**Note:** ESLint must be installed first. Run `npm install` from the project root directory.

### Using Node Directly
```bash
# Default (chat + accessibility enabled)
node index.js

# Enable power-ups
node index.js --enable-powerups

# Enable all features
node index.js --enable-powerups

# Disable chat
ENABLE_CHAT=false node index.js

# Disable accessibility
ENABLE_ACCESSIBILITY=false node index.js

# Disable both chat and accessibility
ENABLE_CHAT=false ENABLE_ACCESSIBILITY=false node index.js
```

### Environment Variables
```bash
# Windows (Command Prompt)
set ENABLE_CHAT=true && set ENABLE_POWERUPS=true && set ENABLE_ACCESSIBILITY=true && npm start

# Windows (PowerShell)
$env:ENABLE_CHAT="true"; $env:ENABLE_POWERUPS="true"; $env:ENABLE_ACCESSIBILITY="true"; npm start

# Linux/Mac
ENABLE_CHAT=true ENABLE_POWERUPS=true ENABLE_ACCESSIBILITY=true npm start
```

### Port Configuration
```bash
# Windows (Command Prompt)
set PORT=8080 && npm start

# Windows (PowerShell)
$env:PORT="8080"; npm start

# Linux/Mac
PORT=8080 npm start
```

## Project Structure

```
multi-player/
├── server/
│   ├── index.js              # Express server + Socket.io setup
│   ├── gameLogic.js          # Game state management, collision detection
│   ├── npcAI.js              # NPC AI logic for single-player mode
│   ├── powerups.js           # Power-up logic (optional feature)
│   ├── config.js             # Game configuration (grid dimensions, cell size)
│   ├── package.json          # Server dependencies
│   └── package-lock.json     # Dependency lock file
├── client/
│   ├── index.html            # Join screen
│   ├── game.html             # Game screen
│   ├── css/
│   │   ├── styles.css         # Main styles
│   │   ├── game.css          # Game-specific styles
│   │   ├── accessibility.css # Accessibility styles
│   │   └── welcome.css       # Welcome screen styles
│   ├── js/
│   │   ├── join.js           # Join screen logic
│   │   ├── game.js           # Main game loop, DOM rendering
│   │   ├── input.js          # Keyboard input handling
│   │   ├── menu.js           # Pause/resume/quit menu
│   │   ├── audio.js          # Sound effects management
│   │   ├── client.js         # Socket.io client communication
│   │   ├── chat.js           # Chat functionality
│   │   ├── powerups.js       # Power-up rendering/logic
│   │   ├── accessibility.js # Accessibility features
│   │   └── welcome.js        # Welcome screen logic
│   └── assets/
│       ├── images/
│       │   └── welcome/      # Welcome screen images
│       └── sounds/            # Sound effect files (optional)
├── README.md                 # This file
├── CONNECTION_GUIDE.md       # Connection guide for players
├── Procfile                  # Deployment configuration
├── package.json              # Root package.json (ESLint config)
├── .eslintrc.js              # ESLint configuration
├── .eslintignore             # ESLint ignore patterns
└── .gitignore                # Git ignore rules
```

## Setup and Installation

### Prerequisites

- **Node.js** (v14 or higher) - [Download Node.js](https://nodejs.org/)
- **npm** (comes with Node.js)

#### Installing Node.js

**Windows:**
1. Download the Windows Installer (.msi) from [nodejs.org](https://nodejs.org/)
2. Run the installer and follow the setup wizard
3. Verify installation:
   ```cmd
   node --version
   npm --version
   ```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

**Linux (CentOS/RHEL/Fedora):**
```bash
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs  # or sudo yum install -y nodejs
node --version
npm --version
```

### Local Development

#### Windows Setup

1. **Open Command Prompt or PowerShell**
   - Press `Win + R`, type `cmd` or `powershell`, press Enter

2. **Navigate to the project directory**
   ```cmd
   cd path\to\multi-player\server
   ```

3. **Install server dependencies**
   ```cmd
   npm install
   ```

4. **Install ESLint (optional, for code quality)**
   ```cmd
   cd ..
   npm install
   ```
   This installs ESLint for linting JavaScript files.

5. **Start the server**
   ```cmd
   cd server
   npm start
   ```
   This starts with Chat, Accessibility, and Power-ups enabled by default.

5. **Open your browser**
   - Navigate to `http://localhost:3000`
   - Enter your name and room code (or generate one)
   - Share the room code with other players
   - Host clicks "Start Game" when ready

#### Linux/Mac Setup

1. **Open Terminal**
   - Press `Ctrl + Alt + T` (Linux) or open Terminal app (Mac)

2. **Navigate to the project directory**
   ```bash
   cd /path/to/multi-player/server
   ```

3. **Install server dependencies**
   ```bash
   npm install
   ```

4. **Install ESLint (optional, for code quality)**
   ```bash
   cd ..
   npm install
   ```
   This installs ESLint for linting JavaScript files.

5. **Start the server**
   ```bash
   cd server
   npm start
   ```
   This starts with Chat, Accessibility, and Power-ups enabled by default.

5. **Open your browser**
   - Navigate to `http://localhost:3000`
   - Enter your name and room code (or generate one)
   - Share the room code with other players
   - Host clicks "Start Game" when ready

## Usage Guide

### Joining a Game

**Multi-Player Mode:**
1. Open the game URL in your browser
2. Select "Multi-Player" mode
3. Enter your player name (must be unique in the room)
4. Enter or generate a room code
5. Click "Join Room"
6. Wait for other players to join (minimum 2, maximum 4)
7. Host clicks "Start Game" when ready

**Single-Player Mode (vs NPCs):**
1. Open the game URL in your browser
2. Select "Single-Player (vs NPCs)" mode
3. Enter your player name
4. Select number of NPCs (1-3)
5. Choose game options (Wall Mode, Strict Mode, Time Limit)
6. Click "Start Single-Player Game"

**Solo Mode (No NPCs):**
1. Open the game URL in your browser
2. Select "Solo (No NPCs)" mode
3. Enter your player name
4. Choose game options (Wall Mode, Strict Mode, Time Limit)
5. Click "Start Solo Game"
6. Note: Solo mode runs 1.5% faster than other modes

### Playing the Game

- **Controls**: Use WASD, Arrow keys, IJKL, or TFGH to control your snake
- **Objective**: Eat food to grow and score points
- **Avoid**: Collisions with walls, yourself, or other snakes
- **Win**: Be the last snake standing or have the highest score
- **Level System**: Speed increases every 5 food items eaten

### Menu (ESC key)

- **Pause**: Pause the game (all players can pause, all see who paused)
- **Resume**: Resume the game (all players can resume)
- **Quit**: Quit the current game and return to join screen
- **Pause Limits**: 
  - Multiplayer: 15 minutes total pause time
  - Solo/Single-player: Unlimited pause time

### Chat System (Enabled by Default)

- Click the chat toggle button (bottom right)
- Type messages and press Enter to send
- See messages from all players in real-time
- Chat persists during gameplay

### Power-ups (Enabled by Default)

- Collect power-ups on the game board:
  - ⚡ **Speed Boost**: Move faster temporarily
  - 🛡️ **Shield**: Temporary invincibility (prevents collisions)
  - 📉 **Shrink**: Reduce snake size
  - 🐌 **Slow Others**: Slow down opponents
- Active power-ups show with remaining time
- Power-ups spawn randomly on the board

### Accessibility Features (Enabled by Default)

- Click the "⚙️ Accessibility" button (bottom left)
- **Colorblind Mode**: Different color schemes for colorblind players
- **High Contrast Mode**: Enhanced visibility
- **Font Size Adjustment**: Adjust text size for readability
- **Screen Reader Support**: ARIA labels and semantic HTML
- Settings are saved in browser localStorage

## Game Rules

- Each player controls a snake
- Snakes grow when eating food
- Collision with walls, self, or other snakes results in death
- Last snake standing wins (or highest score if timer-based)
- Food spawns randomly on the board
- Equal starting conditions for all players
- Timer counts up and is synchronized across all players
- Timer freezes when game is paused

## Performance

The game is optimized for 60 FPS performance:
- DOM-based rendering (no canvas)
- Batch DOM updates
- Object pooling for DOM elements
- Efficient collision detection
- Client-side interpolation between server updates
- FPS counter visible in top-right corner
- RequestAnimationFrame for smooth rendering
- No dropped frames when pausing

## Technical Details

### Server
- Node.js + Express for HTTP server
- Socket.io for real-time communication
- Server-authoritative game state (prevents cheating)
- Game loop runs at 20Hz (sends updates to clients)
- Client renders at 60 FPS with interpolation
- Feature flags system for optional features

### Client
- Vanilla JavaScript (no frameworks)
- requestAnimationFrame for smooth rendering
- Input buffering and debouncing
- Sound effects using Web Audio API
- Feature flags received from server
- Real-time synchronization via Socket.io

## Deployment

### Railway.app

1. Create a new project on [Railway.app](https://railway.app)
2. Connect your GitHub repository
3. Railway will automatically detect the `Procfile` and deploy
4. Set environment variables if needed:
   - `PORT` (optional, Railway sets this automatically)
   - `ENABLE_CHAT` (optional, defaults to enabled)
   - `ENABLE_POWERUPS` (optional, defaults to disabled)
   - `ENABLE_ACCESSIBILITY` (optional, defaults to enabled)

### Render.com

1. Create a new Web Service on [Render.com](https://render.com)
2. Connect your GitHub repository
3. Set build command: `cd server && npm install`
4. Set start command: `cd server && node index.js`
5. Set environment variables if needed

### Local Testing with Internet Access

For testing with friends over the internet:

**Using localtunnel:**
```bash
cd server
npm start
```
In a new terminal window:
```bash
npx localtunnel --port 3000
```
Share the generated URL with players.

**Using ngrok:**
```bash
cd server
npm start
```
In a new terminal window (after installing ngrok):
```bash
ngrok http 3000
```
Share the generated URL with players.

## Troubleshooting

### Connection Issues

**Windows:**
- Ensure server is running (check Command Prompt/PowerShell window)
- Check Windows Firewall settings
- Verify port is not blocked: `netstat -ano | findstr :3000`
- If port is in use, change the port using `set PORT=8080 && npm start`

**Linux:**
- Ensure server is running (check terminal output)
- Check firewall settings: `sudo ufw allow 3000/tcp`
- Verify port is not blocked: `sudo netstat -tulpn | grep :3000`
- If port is in use, change the port using `PORT=8080 npm start`

### Performance Issues
- Check browser console for errors (F12 → Console tab)
- Monitor FPS counter (should stay near 60)
- Close other browser tabs
- Use Chrome/Edge for best performance

### Game Not Starting
- Ensure at least 2 players are in the room (or select Single-Player/Solo mode)
- Check that host clicked "Start Game"
- Verify all players are connected
- Check server console for error messages
- Ensure all players are using the same server URL

### Common Issues

**"node is not recognized"**
- Node.js is not installed or not in PATH
- Reinstall Node.js and ensure "Add to PATH" option is checked
- Restart Command Prompt/PowerShell after installation

**"npm is not recognized"**
- npm comes with Node.js, reinstall Node.js
- Verify installation: `node --version` and `npm --version`

**Port Already in Use**
- Find and kill the process:
  ```bash
  # Windows
  netstat -ano | findstr :3000
  taskkill /PID <PID> /F
  
  # Linux/Mac
  sudo lsof -i :3000
  sudo kill -9 <PID>
  ```
- Or use a different port: `PORT=8080 npm start`