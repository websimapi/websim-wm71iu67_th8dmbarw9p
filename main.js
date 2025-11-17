import { initTwitch } from './twitch.js';
import { Game } from './game.js';
import { AudioManager } from './audio-manager.js';

const connectContainer = document.getElementById('connect-container');
const worldSelectContainer = document.getElementById('world-select-container');
const worldList = document.getElementById('world-list');
const gameContainer = document.getElementById('game-container');
const channelInput = document.getElementById('channel-input');
const connectBtn = document.getElementById('connect-btn');
const canvas = document.getElementById('game-canvas');
const createWorldBtn = document.getElementById('create-world-btn');


const STORAGE_KEY = 'twitch_channel_name';
const PLAYERS_STORAGE_PREFIX = 'twitch_game_players_';
const MAP_STORAGE_PREFIX = 'twitch_game_map_';

function showGame() {
    worldSelectContainer.classList.add('hidden');
    gameContainer.classList.remove('hidden');
}

function showWorldSelect(channel) {
    connectContainer.classList.add('hidden');
    worldSelectContainer.classList.remove('hidden');
    document.getElementById('world-select-title').textContent = `Worlds for #${channel}`;
    populateWorldList(channel);
}

function populateWorldList(channel) {
    worldList.innerHTML = '';
    const worlds = findWorldsForChannel(channel);

    if (worlds.length === 0) {
        // Handle case for a new channel with no worlds. We can treat the 'default' world as the first one.
        worlds.push('default'); 
    }

    worlds.forEach(worldName => {
        const worldEl = document.createElement('div');
        worldEl.className = 'world-item';
        
        const playerDataKey = worldName === 'default' 
            ? `${PLAYERS_STORAGE_PREFIX}${channel}`
            : `${PLAYERS_STORAGE_PREFIX}${channel}_${worldName}`;
            
        const playersData = localStorage.getItem(playerDataKey);
        const playerCount = playersData ? Object.keys(JSON.parse(playersData)).length : 0;

        worldEl.innerHTML = `
            <h3>${worldName}</h3>
            <p>${playerCount} players</p>
            <button class="export-btn">Export Data</button>
        `;

        worldEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('export-btn')) return;
            startGame(channel, worldName);
        });
        
        const exportBtn = worldEl.querySelector('.export-btn');
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exportWorldData(channel, worldName);
        });

        worldList.appendChild(worldEl);
    });
}

function findWorldsForChannel(channel) {
    const worlds = new Set();
    const prefix = `${PLAYERS_STORAGE_PREFIX}${channel}_`;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(prefix)) {
            const worldName = key.substring(prefix.length);
            worlds.add(worldName);
        }
    }
     // Support legacy single-world format
    if (localStorage.getItem(`${PLAYERS_STORAGE_PREFIX}${channel}`)) {
        worlds.add('default');
    }

    return Array.from(worlds);
}

function exportWorldData(channel, worldName) {
    const playerDataKey = worldName === 'default' 
        ? `${PLAYERS_STORAGE_PREFIX}${channel}` 
        : `${PLAYERS_STORAGE_PREFIX}${channel}_${worldName}`;

    const mapDataKey = worldName === 'default' 
        ? `${MAP_STORAGE_PREFIX}${channel}` 
        : `${MAP_STORAGE_PREFIX}${channel}_${worldName}`;

    const players = JSON.parse(localStorage.getItem(playerDataKey) || '{}');
    const map = JSON.parse(localStorage.getItem(mapDataKey) || '{}');

    const worldData = {
        channel,
        worldName,
        timestamp: new Date().toISOString(),
        data: {
            players,
            map
        }
    };

    const dataStr = JSON.stringify(worldData, null, 2);
    const dataBlob = new Blob([dataStr], {type: "application/json"});
    const url = URL.createObjectURL(dataBlob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${channel}_${worldName}_backup.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function startGame(channel, worldName) {
    console.log(`Connecting to #${channel}, world: ${worldName}...`);
    showGame();

    AudioManager.init();

    const game = new Game(canvas, channel, worldName);
    
    initTwitch(
        channel, 
        (chatter) => { // onChatter for energy
            game.addOrUpdatePlayer(chatter);
        },
        (userId, command) => { // onCommand
            game.handlePlayerCommand(userId, command);
        }
    );

    game.start();
}

connectBtn.addEventListener('click', () => {
    const channel = channelInput.value.trim().toLowerCase();
    if (channel) {
        localStorage.setItem(STORAGE_KEY, channel);
        showWorldSelect(channel);
    }
});

channelInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        connectBtn.click();
    }
});

// Load channel from localStorage on startup
const savedChannel = localStorage.getItem(STORAGE_KEY);
if (savedChannel) {
    channelInput.value = savedChannel;
}