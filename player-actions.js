import { PLAYER_STATE } from './player-state.js';
import { TILE_TYPE } from './map-tile-types.js';
import { AudioManager } from './audio-manager.js';
import { updateWander, updateMoveToTarget, updateFollowPath } from './player-movement.js';
import { findPath } from './pathfinding.js';

const WOODCUTTING_STATES = [PLAYER_STATE.MOVING_TO_TREE, PLAYER_STATE.CHOPPING];
const GATHERING_STATES = [PLAYER_STATE.MOVING_TO_LOGS, PLAYER_STATE.HARVESTING_LOGS, PLAYER_STATE.MOVING_TO_BUSHES, PLAYER_STATE.HARVESTING_BUSHES, PLAYER_STATE.SEARCHING_FOR_GATHERABLE, PLAYER_STATE.WANDERING_TO_GATHER];


function beginChopping(player) {
    player.state = PLAYER_STATE.CHOPPING;
    player.actionTimer = 11; // 11 seconds to chop
    console.log(`[${player.username}] Began chopping tree at (${player.actionTarget.x}, ${player.actionTarget.y}). Timestamp: ${Date.now()}`);
}

function finishChopping(player, gameMap) {
    const chopSound = AudioManager.getBuffer('./tree_fall.mp3');
    AudioManager.play(chopSound, player.actionTarget.x, player.actionTarget.y);

    const treeX = player.actionTarget.x;
    const treeY = player.actionTarget.y;

    gameMap.cutTree(treeX, treeY);
    player.actionTarget = { x: treeX, y: treeY };

    console.log(`[${player.username}] Finished chopping tree. Timestamp: ${Date.now()}`);
    player.addExperience('woodcutting', 3);

    player.pendingHarvest = [];
    let spawnedBushes = 0;
    const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    for (const [dx, dy] of directions) {
        const bushX = treeX + dx;
        const bushY = treeY + dy;
        if (bushX >= 0 && bushX < gameMap.width && bushY >= 0 && bushY < gameMap.height && 
            gameMap.grid[bushY][bushX] === TILE_TYPE.GRASS && Math.random() < 1/8) {
            gameMap.grid[bushY][bushX] = TILE_TYPE.BUSHES;
            player.pendingHarvest.push({ x: bushX, y: bushY, type: TILE_TYPE.BUSHES });
            spawnedBushes++;
        }
    }
    if (spawnedBushes === 0) {
        const validSpots = directions.filter(([dx, dy]) => {
            const bushX = treeX + dx;
            const bushY = treeY + dy;
            return bushX >= 0 && bushX < gameMap.width && bushY >= 0 && bushY < gameMap.height && gameMap.grid[bushY][bushX] === TILE_TYPE.GRASS;
        });
        if (validSpots.length > 0) {
            const [dx, dy] = validSpots[Math.floor(Math.random() * validSpots.length)];
            const bushX = treeX + dx;
            const bushY = treeY + dy;
            gameMap.grid[bushY][bushX] = TILE_TYPE.BUSHES;
            player.pendingHarvest.push({ x: bushX, y: bushY, type: TILE_TYPE.BUSHES });
        }
    }

    if (player.activeCommand === 'follow') {
        player.state = PLAYER_STATE.FOLLOWING;
        return;
    }

    player.state = PLAYER_STATE.IDLE; // Reset state before pathfinding
    const startX = Math.round(player.pixelX);
    const startY = Math.round(player.pixelY);
    const path = findPath(startX, startY, player.actionTarget.x, player.actionTarget.y, gameMap);

    if(path) {
        player.path = path;
        player.state = PLAYER_STATE.MOVING_TO_LOGS;
    } else {
        console.warn(`[${player.username}] No path found to logs at (${player.actionTarget.x}, ${player.actionTarget.y}).`);
        // Maybe try finding another task or just idle
        if (player.activeCommand === 'gather') {
            startGatheringCycle(player, gameMap);
        } else {
            harvestNextBush(player, gameMap); // Try to harvest bushes if any are pending
        }
    }
}

function beginHarvestingLogs(player) {
    player.state = PLAYER_STATE.HARVESTING_LOGS;
    player.actionTimer = 6;
    console.log(`[${player.username}] Began harvesting logs. Timestamp: ${Date.now()}`);
}

function finishHarvestingLogs(player, gameMap) {
    const numLogs = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numLogs; i++) {
        player.inventory.logs.push({ timestamp: Date.now() });
    }
    console.log(`[${player.username}] Harvested ${numLogs} logs. Total: ${player.inventory.logs.length}. Timestamp: ${Date.now()}`);
    player.addExperience('woodcutting', numLogs);
    player.addExperience('gathering', 2);
    gameMap.grid[player.actionTarget.y][player.actionTarget.x] = TILE_TYPE.GRASS;
    
    if (player.activeCommand === 'gather') {
        startGatheringCycle(player, gameMap);
    } else {
        harvestNextBush(player, gameMap);
    }
}

function harvestNextBush(player, gameMap) {
    if(player.pendingHarvest.length > 0) {
        player.actionTarget = player.pendingHarvest.shift();
        
        const startX = Math.round(player.pixelX);
        const startY = Math.round(player.pixelY);
        const path = findPath(startX, startY, player.actionTarget.x, player.actionTarget.y, gameMap);
        
        if (path) {
            player.path = path;
            player.state = PLAYER_STATE.MOVING_TO_BUSHES;
        } else {
            console.warn(`[${player.username}] No path found to bush at (${player.actionTarget.x}, ${player.actionTarget.y}). Skipping.`);
            harvestNextBush(player, gameMap); // Try next bush
        }
    } else {
        if (player.activeCommand === 'follow') {
            player.state = PLAYER_STATE.FOLLOWING;
        } else {
            findAndMoveToTree(player, gameMap);
        }
    }
}

function beginHarvestingBushes(player) {
    player.state = PLAYER_STATE.HARVESTING_BUSHES;
    player.actionTimer = 2 + Math.random();
    console.log(`[${player.username}] Began harvesting bushes. Timestamp: ${Date.now()}`);
}

function finishHarvestingBushes(player, gameMap) {
    const numLeaves = Math.floor(200 + Math.random() * 801); 
    player.inventory.leaves.push({ amount: numLeaves, timestamp: Date.now() });
    const totalLeaves = player.inventory.leaves.reduce((sum, item) => sum + item.amount, 0);
    console.log(`[${player.username}] Harvested ${numLeaves} leaves. Total: ${totalLeaves}. Timestamp: ${Date.now()}`);
    player.addExperience('gathering', 1);
    gameMap.grid[player.actionTarget.y][player.actionTarget.x] = TILE_TYPE.GRASS;
    
    if (player.activeCommand === 'gather') {
        startGatheringCycle(player, gameMap);
    } else if (player.activeCommand === 'follow') {
        player.state = PLAYER_STATE.FOLLOWING;
    } else {
        harvestNextBush(player, gameMap);
    }
}

export function startChoppingCycle(player, gameMap) {
    console.log(`[${player.username}] Starting chopping cycle. Timestamp: ${Date.now()}`);
    findAndMoveToTree(player, gameMap);
}

export function startGatheringCycle(player, gameMap) {
    player.state = PLAYER_STATE.SEARCHING_FOR_GATHERABLE;
    console.log(`[${player.username}] Starting gathering cycle, searching for resources.`);
    
    const searchRadius = 16;
    const gatherableTypes = [TILE_TYPE.LOGS, TILE_TYPE.BUSHES];
    const nearest = gameMap.findNearestInRadius(player.pixelX, player.pixelY, gatherableTypes, searchRadius);

    if (nearest) {
        player.actionTarget = nearest;
        
        const startX = Math.round(player.pixelX);
        const startY = Math.round(player.pixelY);
        const endX = nearest.x;
        const endY = nearest.y;
        
        const path = findPath(startX, startY, endX, endY, gameMap);
        
        if (path) {
            player.path = path;
            if (nearest.type === TILE_TYPE.LOGS) {
                player.state = PLAYER_STATE.MOVING_TO_LOGS;
            } else if (nearest.type === TILE_TYPE.BUSHES) {
                player.state = PLAYER_STATE.MOVING_TO_BUSHES;
            }
            console.log(`[${player.username}] Found gatherable at (${nearest.x}, ${nearest.y}). Path found. Moving to harvest.`);
        } else {
            console.log(`[${player.username}] Found gatherable at (${nearest.x}, ${nearest.y}), but no path exists. Searching again.`);
            // This could be improved by blacklisting this target for a while
            player.state = PLAYER_STATE.WANDERING_TO_GATHER;
            player.lastSearchPosition = { x: player.pixelX, y: player.pixelY };
        }
    } else {
        console.log(`[${player.username}] No gatherables found within ${searchRadius} tiles. Wandering...`);
        player.state = PLAYER_STATE.WANDERING_TO_GATHER;
        player.lastSearchPosition = { x: player.pixelX, y: player.pixelY };
    }
}

export function findAndMoveToTree(player, gameMap) {
    const nearestTree = gameMap.findNearest(player.pixelX, player.pixelY, TILE_TYPE.TREE);
    if (nearestTree) {
        player.actionTarget = nearestTree;
        setChopTarget(player, gameMap, nearestTree);
    } else {
        console.log(`[${player.username}] No trees found.`);
        player.state = PLAYER_STATE.IDLE;
    }
}

export function setChopTarget(player, gameMap, treeCoords) {
    let bestSpot = null;
    let minDistance = Infinity;
    for(let dx = -1; dx <= 1; dx++) {
        for(let dy = -1; dy <= 1; dy++) {
            if(dx === 0 && dy === 0) continue;
            const spotX = treeCoords.x + dx;
            const spotY = treeCoords.y + dy;
            if(!gameMap.isColliding(spotX, spotY)) {
                const dist = (spotX - player.pixelX)**2 + (spotY - player.pixelY)**2;
                if(dist < minDistance) {
                   minDistance = dist;
                   bestSpot = {x: spotX, y: spotY};
                }
            }
        }
    }
    
    if(bestSpot) {
       const startX = Math.round(player.pixelX);
       const startY = Math.round(player.pixelY);
       const path = findPath(startX, startY, bestSpot.x, bestSpot.y, gameMap);
       
       if (path) {
           player.path = path;
           player.state = PLAYER_STATE.MOVING_TO_TREE;
           console.log(`[${player.username}] Set target for tree at (${treeCoords.x}, ${treeCoords.y}). Path found. Moving to chop.`);
       } else {
           console.warn(`[${player.username}] Tree at (${treeCoords.x}, ${treeCoords.y}) is reachable at (${bestSpot.x}, ${bestSpot.y}), but no path found.`);
           player.state = PLAYER_STATE.IDLE;
       }
    } else {
        console.log(`[${player.username}] Tree at (${treeCoords.x}, ${treeCoords.y}) is surrounded. Can't chop.`);
        player.state = PLAYER_STATE.IDLE;
    }
}

function updateFollow(player, gameMap, allPlayers) {
    const targetPlayer = allPlayers.get(player.followTargetId);

    if (!targetPlayer || !targetPlayer.isPowered()) {
        console.log(`[${player.username}] Follow target lost. Idling.`);
        player.state = PLAYER_STATE.IDLE;
        player.followTargetId = null;
        player.activeCommand = null;
        return;
    }

    const dx = targetPlayer.pixelX - player.pixelX;
    const dy = targetPlayer.pixelY - player.pixelY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // If too far, move closer
    if (distance > 8) {
        // Only find a new path if not already moving
        if (player.path.length === 0) {
            const startX = Math.round(player.pixelX);
            const startY = Math.round(player.pixelY);
            // Find a valid spot near the target
            const targetX = Math.round(targetPlayer.pixelX);
            const targetY = Math.round(targetPlayer.pixelY);

            let bestSpot = null;
            let minPathLength = Infinity;

            for (let r = 1; r < 5; r++) {
                 for (let i = -r; i <= r; i++) {
                    for (let j = -(r-Math.abs(i)); j <= (r-Math.abs(i)); j++) {
                        if(i === 0 && j === 0) continue;
                        const spotX = targetX + i;
                        const spotY = targetY + j;

                        if (spotX >= 0 && spotX < gameMap.width && spotY >= 0 && spotY < gameMap.height && !gameMap.isColliding(spotX, spotY)) {
                            const path = findPath(startX, startY, spotX, spotY, gameMap);
                            if (path && path.length < minPathLength) {
                                minPathLength = path.length;
                                bestSpot = path;
                            }
                        }
                    }
                }
                if (bestSpot) break; // Found a path in this radius
            }

            if (bestSpot) {
                player.path = bestSpot;
            } else {
                 console.log(`[${player.username}] Can't find path to follow ${targetPlayer.username}. Idling for now.`);
            }
        }
        updateFollowPath(player, deltaTime, gameMap);
        return;
    }
    
    // Within range, so stop moving
    player.path = [];

    // Mimic target's actions
    if (WOODCUTTING_STATES.includes(targetPlayer.state)) {
        startChoppingCycle(player, gameMap);
    } else if (GATHERING_STATES.includes(targetPlayer.state)) {
        startGatheringCycle(player, gameMap);
    } else {
        // Target is idle or wandering, so follower also wanders
        updateWander(player, deltaTime, gameMap);
    }
}


export function updateAction(player, deltaTime, gameMap, allPlayers) {
    const atMoveTarget = player.path.length === 0;

    switch (player.state) {
        case PLAYER_STATE.IDLE:
            updateWander(player, deltaTime, gameMap);
            break;
        
        case PLAYER_STATE.MOVING_TO_TREE:
            updateFollowPath(player, deltaTime, gameMap);
            if (atMoveTarget) {
                // To make chopping feel right, we do a final small move towards the tree itself.
                const finalTargetX = player.actionTarget.x;
                const finalTargetY = player.actionTarget.y;
                const currentSpotX = Math.round(player.pixelX);
                const currentSpotY = Math.round(player.pixelY);
                player.targetX = currentSpotX + (finalTargetX - currentSpotX) * 0.4;
                player.targetY = currentSpotY + (finalTargetY - currentSpotY) * 0.4;
                
                const distToFinalAdjust = Math.sqrt((player.pixelX - player.targetX)**2 + (player.pixelY - player.targetY)**2);

                if (distToFinalAdjust > 0.05) {
                    updateMoveToTarget(player, deltaTime, gameMap);
                } else {
                     beginChopping(player);
                }
            }
            break;
        case PLAYER_STATE.MOVING_TO_LOGS:
        case PLAYER_STATE.MOVING_TO_BUSHES:
            updateFollowPath(player, deltaTime, gameMap);
            if (atMoveTarget) {
                if (player.state === PLAYER_STATE.MOVING_TO_LOGS) beginHarvestingLogs(player);
                else if (player.state === PLAYER_STATE.MOVING_TO_BUSHES) beginHarvestingBushes(player);
            }
            break;

        case PLAYER_STATE.WANDERING_TO_GATHER:
            updateWander(player, deltaTime, gameMap);
            const distFromSearch = Math.sqrt(
                (player.pixelX - player.lastSearchPosition.x)**2 +
                (player.pixelY - player.lastSearchPosition.y)**2
            );
            if (distFromSearch > 8) {
                startGatheringCycle(player, gameMap);
            }
            break;
        
        case PLAYER_STATE.FOLLOWING:
             updateFollow(player, gameMap, allPlayers);
             break;

        case PLAYER_STATE.CHOPPING:
            player.actionTimer -= deltaTime;
            if (player.actionTimer <= 0) {
                finishChopping(player, gameMap);
            } else if (Math.floor(player.actionTimer) % 2 === 0 && Math.floor(player.actionTimer + deltaTime) % 2 !== 0) {
                 const chopSound = AudioManager.getBuffer('./chop.mp3');
                 AudioManager.play(chopSound, player.pixelX, player.pixelY);
            }
            break;
        
        case PLAYER_STATE.HARVESTING_LOGS:
            player.actionTimer -= deltaTime;
            if (player.actionTimer <= 0) {
                finishHarvestingLogs(player, gameMap);
            }
            break;

        case PLAYER_STATE.HARVESTING_BUSHES:
            player.actionTimer -= deltaTime;
            if (player.actionTimer <= 0) {
                finishHarvestingBushes(player, gameMap);
            }
            break;
    }
}