import { Player } from './player.js';
import { Map as GameMap } from './map.js';
import { startChoppingCycle, startGatheringCycle } from './player-actions.js';
import { AudioManager } from './audio-manager.js';

const PLAYERS_STORAGE_PREFIX = 'twitch_game_players_';
const MAP_STORAGE_PREFIX = 'twitch_game_map_';

export class Game {
    constructor(canvas, channel, worldName = 'default') {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.channel = channel;
        this.worldName = worldName;
        this.playersStorageKey = this.worldName === 'default' 
            ? `${PLAYERS_STORAGE_PREFIX}${this.channel}`
            : `${PLAYERS_STORAGE_PREFIX}${this.channel}_${this.worldName}`;
        this.mapStorageKey = this.worldName === 'default'
            ? `${MAP_STORAGE_PREFIX}${this.channel}`
            : `${MAP_STORAGE_PREFIX}${this.channel}_${this.worldName}`;

        this.players = new Map();
        this.map = new GameMap(32); // TileSize is 32

        this.focusedPlayerId = null;
        this.focusTimer = 0;
        this.FOCUS_DURATION = 60; // seconds

        this.loadMap(); // Load map first
        this.loadPlayers(); // Load existing players on startup

        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        // Setup periodic save
        this.saveInterval = setInterval(() => {
            this.savePlayers();
            this.saveMap();
        }, 5000); // Save every 5 seconds
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        // Use a fixed tileSize for gameplay scale, allowing the map to be larger than viewport
        const fixedTileSize = 32; 
        this.map.setTileSize(fixedTileSize);

        this.map.setViewport(this.canvas.width, this.canvas.height);
    }

    savePlayers() {
        if (this.players.size === 0) return;

        const playerStates = {};
        for (const player of this.players.values()) {
            playerStates[player.id] = player.getState();
        }
        
        try {
            localStorage.setItem(this.playersStorageKey, JSON.stringify(playerStates));
            // User requested console logging coordinates
            if (this.players.size > 0) {
                const samplePlayer = this.players.values().next().value;
                const energyCount = samplePlayer.energyTimestamps ? samplePlayer.energyTimestamps.length : 0;
                console.log(`[Persistence] Saved state. Sample Player (${samplePlayer.username}): Position (${samplePlayer.pixelX.toFixed(2)}, ${samplePlayer.pixelY.toFixed(2)}), Energy Cells: ${energyCount}`);
            }
        } catch (e) {
            console.error("Could not save player data to localStorage:", e);
        }
    }

    saveMap() {
        const mapData = {
            grid: this.map.grid,
            treeRespawns: this.map.treeRespawns
        };
        try {
            localStorage.setItem(this.mapStorageKey, JSON.stringify(mapData));
            console.log(`[Persistence] Saved map data for world: ${this.worldName}.`);
        } catch (e) {
            console.error("Could not save map data to localStorage:", e);
        }
    }

    loadMap() {
        try {
            const data = localStorage.getItem(this.mapStorageKey);
            if (data) {
                const mapData = JSON.parse(data);
                this.map.grid = mapData.grid;
                this.map.treeRespawns = mapData.treeRespawns || [];
                console.log(`[Persistence] Loaded map data from localStorage for world: ${this.worldName}.`);
            } else {
                this.map.generateMap();
                console.log(`[Persistence] No map data found for world: ${this.worldName}. Generated a new map.`);
                this.saveMap();
            }
        } catch(e) {
            console.error("Could not load map data, generating new map.", e);
            this.map.generateMap();
        }
    }

    loadPlayers() {
        try {
            const data = localStorage.getItem(this.playersStorageKey);
            if (data) {
                const playerStates = JSON.parse(data);
                for (const id in playerStates) {
                    const state = playerStates[id];
                    
                    // Sanity check: ensure required data is present
                    if (state && state.id && state.username) {
                        // Instantiate player using persisted info
                        const player = new Player(state.id, state.username, state.color);
                        player.loadState(state);
                        this.players.set(id, player);
                    }
                }
                console.log(`[Persistence] Loaded ${this.players.size} player states from localStorage for channel ${this.channel}, world ${this.worldName}.`);
                
                // After loading all players and the map, validate their states
                for (const player of this.players.values()) {
                    player.validateState(this.map);
                }

                // Log data for active players as requested
                console.log("--- Active Player Data on Load ---");
                for (const player of this.players.values()) {
                    if (player.isPowered()) {
                        console.log(`User data for ${player.username}:`, player.getState());
                    }
                }
                console.log("------------------------------------");

                // If players were loaded, ensure focus is set if possible
                if (this.players.size > 0 && !this.focusedPlayerId) {
                    this.chooseNewFocus();
                }
            }
        } catch (e) {
            console.error("Could not load player data from localStorage:", e);
        }
    }

    handlePlayerCommand(userId, command, args) {
        const player = this.players.get(userId);
        if (!player) return;

        if (!player.isPowered()) {
             console.log(`Player ${player.username} issued command "${command}" but has no energy.`);
             // Allow setting the command even without energy, it will start when they get some.
        }

        if (command === 'chop') {
            player.activeCommand = 'chop';
            player.followTargetId = null;
            if (player.isPowered()) {
                startChoppingCycle(player, this.map);
                console.log(`Player ${player.username} initiated !chop command.`);
            } else {
                 console.log(`Player ${player.username} set !chop command. It will start when they have energy.`);
            }
        } else if (command === 'gather') {
            player.activeCommand = 'gather';
            player.followTargetId = null;
            if (player.isPowered()) {
                startGatheringCycle(player, this.map);
                console.log(`Player ${player.username} initiated !gather command.`);
            } else {
                console.log(`Player ${player.username} set !gather command. It will start when it has energy.`);
            }
        } else if (command === 'follow') {
            let targetPlayer = null;
            if (args && args.targetUsername) {
                const targetUsernameLower = args.targetUsername.toLowerCase();
                // Find any player, even offline, to store their ID. The follow logic will handle if they are powered or not.
                targetPlayer = Array.from(this.players.values()).find(p => p.username.toLowerCase() === targetUsernameLower);
                 if (!targetPlayer) {
                    console.log(`[${player.username}] Could not find any player (online or off) named "${args.targetUsername}".`);
                    return;
                }
            } else {
                // Find nearest powered player
                let minDistance = Infinity;
                for (const otherPlayer of this.players.values()) {
                    if (otherPlayer.id === player.id || !otherPlayer.isPowered()) continue;
                    const dx = otherPlayer.pixelX - player.pixelX;
                    const dy = otherPlayer.pixelY - player.pixelY;
                    const distance = dx * dx + dy * dy;
                    if (distance < minDistance) {
                        minDistance = distance;
                        targetPlayer = otherPlayer;
                    }
                }
            }

            if (targetPlayer) {
                player.activeCommand = 'follow';
                player.followTargetId = targetPlayer.id;
                if (player.isPowered()) {
                    player.state = PLAYER_STATE.FOLLOWING;
                }
                console.log(`[${player.username}] will now follow ${targetPlayer.username}.`);
            } else {
                console.log(`[${player.username}] Could not find anyone nearby to follow.`);
                if (player.isPowered()) {
                    player.state = PLAYER_STATE.IDLE;
                }
            }
        }
    }

    addOrUpdatePlayer(chatter) {
        if (!chatter || !chatter.id) {
            console.error("Attempted to add or update player with invalid chatter data:", chatter);
            return;
        }
        let player = this.players.get(chatter.id);

        if (!player) {
            // Truly new player (not in persistence or current map)
            player = new Player(chatter.id, chatter.username, chatter.color);
            this.players.set(chatter.id, player);
            
            // Ensure player is positioned correctly on the map, avoiding obstacles
            player.setInitialPosition(this.map);

            console.log(`Player ${chatter.username} joined.`);
            
            // Initialize focus if necessary
            if (!this.focusedPlayerId) {
                this.focusedPlayerId = chatter.id;
                this.focusTimer = this.FOCUS_DURATION;
            }
        } else {
             // Existing player (loaded from storage or currently active)
             // Update volatile data like username/color which might change
             player.username = chatter.username;
             player.color = chatter.color;
        }

        player.addEnergy();
        console.log(`Player ${player.username} gained energy. Current energy cells: ${player.energyTimestamps.length}, Current Position: (${player.pixelX.toFixed(2)}, ${player.pixelY.toFixed(2)})`);
    }

    start() {
        this.map.loadAssets().then(() => {
            this.lastTime = performance.now();
            this.gameLoop();
        });
    }

    getVisibleTileRange(cameraX, cameraY) {
        const ts = this.map.tileSize;
        const startTileX = Math.floor(cameraX / ts);
        const endTileX = Math.ceil((cameraX + this.canvas.width) / ts);
        const startTileY = Math.floor(cameraY / ts);
        const endTileY = Math.ceil((cameraY + this.canvas.height) / ts);

        const drawStartX = Math.max(0, startTileX);
        const drawEndX = Math.min(this.map.width, endTileX);
        const drawStartY = Math.max(0, startTileY);
        const drawEndY = Math.min(this.map.height, endTileY);

        return { drawStartX, drawEndX, drawStartY, drawEndY };
    }

    gameLoop(currentTime = performance.now()) {
        const deltaTime = (currentTime - this.lastTime) / 1000; // in seconds
        this.lastTime = currentTime;

        this.update(deltaTime);
        this.render();

        requestAnimationFrame((time) => this.gameLoop(time));
    }

    update(deltaTime) {
        // Handle Camera Focus Logic
        this.focusTimer -= deltaTime;
        if (this.focusTimer <= 0) {
            this.chooseNewFocus();
            this.focusTimer = this.FOCUS_DURATION;
        }

        this.map.update(this.players);

        for (const player of this.players.values()) {
            player.update(deltaTime, this.map, this.players);
        }
    }
    
    chooseNewFocus() {
        // Only focus on players who are currently powered
        const activePlayers = Array.from(this.players.values()).filter(p => p.isPowered());
        
        if (activePlayers.length === 0) {
            this.focusedPlayerId = null;
            this.focusTimer = this.FOCUS_DURATION; // Reset timer so it tries again soon
            console.log("No active players to focus on.");
            return;
        }

        const randomIndex = Math.floor(Math.random() * activePlayers.length);
        const player = activePlayers[randomIndex];
        
        this.focusedPlayerId = player.id;
        console.log(`Camera focusing on: ${player.username} for ${this.FOCUS_DURATION} seconds.`);
    }

    render() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        let cameraX = 0;
        let cameraY = 0;

        const focusedPlayer = this.focusedPlayerId ? this.players.get(this.focusedPlayerId) : null;
        const tileSize = this.map.tileSize;
        const mapPixelWidth = this.map.width * tileSize;
        const mapPixelHeight = this.map.height * tileSize;
        
        if (focusedPlayer) {
            // Player's center pixel position relative to map origin
            const playerCenterX = focusedPlayer.pixelX * tileSize + tileSize / 2;
            const playerCenterY = focusedPlayer.pixelY * tileSize + tileSize / 2;

            // Ideal Camera offset to center player on screen
            cameraX = playerCenterX - this.canvas.width / 2;
            cameraY = playerCenterY - this.canvas.height / 2;

            // Clamp X position
            if (mapPixelWidth > this.canvas.width) {
                const maxCameraX = mapPixelWidth - this.canvas.width;
                cameraX = Math.max(0, Math.min(cameraX, maxCameraX));
            } else {
                // Center map horizontally if smaller than viewport
                cameraX = -(this.canvas.width - mapPixelWidth) / 2;
            }

            // Clamp Y position
            if (mapPixelHeight > this.canvas.height) {
                const maxCameraY = mapPixelHeight - this.canvas.height;
                cameraY = Math.max(0, Math.min(cameraY, maxCameraY));
            } else {
                // Center map vertically if smaller than viewport
                cameraY = -(this.canvas.height - mapPixelHeight) / 2;
            }

        } else {
            // No player focused, center the map if it's smaller than the viewport
            if (this.canvas.width > mapPixelWidth) {
                 cameraX = -(this.canvas.width - mapPixelWidth) / 2;
            }
            if (this.canvas.height > mapPixelHeight) {
                cameraY = -(this.canvas.height - mapPixelHeight) / 2;
            }
        }
        
        // Update AudioManager with the listener's position (center of the screen in world coordinates)
        const listenerX = cameraX + this.canvas.width / 2;
        const listenerY = cameraY + this.canvas.height / 2;
        AudioManager.setListenerPosition(listenerX, listenerY, tileSize);
        
        const { drawStartX, drawEndX, drawStartY, drawEndY } = this.getVisibleTileRange(cameraX, cameraY);
        this.map.renderBase(this.ctx, cameraX, cameraY, drawStartX, drawEndX, drawStartY, drawEndY);

        // --- Y-Sorting Render Logic ---
        const renderList = [];

        // 1. Add players to render list
        for (const player of this.players.values()) {
            if (player.isPowered()) {
                renderList.push({
                    type: 'player',
                    y: player.pixelY,
                    entity: player,
                });
            }
        }
        
        // 2. Add tall map objects (trees) to render list
        const tallObjects = this.map.getTallObjects(drawStartX, drawEndX, drawStartY, drawEndY);
        for (const obj of tallObjects) {
            renderList.push({
                type: obj.type,
                y: obj.y + 0.5, // Sort key for trees to be mid-tile
                entity: obj,
            });
        }
        
        // 3. Sort the list by y-coordinate
        renderList.sort((a, b) => a.y - b.y);

        // 4. Render from the sorted list
        for (const item of renderList) {
            if (item.type === 'player') {
                item.entity.render(this.ctx, tileSize, cameraX, cameraY);
            } else if (item.type === 'tree') {
                const { x, y, image } = item.entity;
                 if (image && image.complete) {
                    this.ctx.drawImage(
                        image,
                        Math.round(x * tileSize - cameraX),
                        Math.round(y * tileSize - cameraY),
                        tileSize,
                        tileSize
                    );
                }
            }
        }
    }
}