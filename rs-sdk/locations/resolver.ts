// resolver.ts - Convert coordinates to natural language descriptions
//
// Takes coordinates and task context to generate descriptions like:
// "in Lumbridge, near the castle, walking north toward the cow field to collect hides"

import { getAllRegions, getKingdoms, getTowns, getPOIs, Region } from './regions';
import type { Task } from '../bot-core/task-manager';

export type CardinalDirection = 'north' | 'south' | 'east' | 'west' |
    'northeast' | 'northwest' | 'southeast' | 'southwest';

export interface LocationContext {
    x: number;
    z: number;
    // Movement info (from task, not velocity)
    isMoving?: boolean;
    isRunning?: boolean;  // true = running, false = walking
    destinationX?: number;
    destinationZ?: number;
    // Task info for rich descriptions
    currentTask?: Task;
    taskDescription?: string;  // e.g., "to smith bronze bars"
}

export interface LocationDescription {
    // Hierarchical location
    kingdom?: string;        // "Kingdom of Misthalin"
    town?: string;           // "Lumbridge"
    poi?: string;            // "the castle"

    // Relative position
    nearestLandmark?: string;
    relativeDirection?: CardinalDirection;  // "north of"

    // Movement (task-aware)
    movementType?: 'walking' | 'running' | 'standing';
    movementDirection?: CardinalDirection;
    movementDestination?: string;  // "toward the cow field"
    movementPurpose?: string;      // "to collect hides"

    // Full natural language
    description: string;
}

// Calculate distance between two points
function distance(x1: number, z1: number, x2: number, z2: number): number {
    return Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
}

// Get cardinal direction from one point to another
function getDirection(fromX: number, fromZ: number, toX: number, toZ: number): CardinalDirection {
    const dx = toX - fromX;
    const dz = toZ - fromZ;

    // RuneScape uses Z for north-south (higher Z = north)
    const absX = Math.abs(dx);
    const absZ = Math.abs(dz);

    // Primary direction threshold
    const threshold = 0.5;

    if (absX < absZ * threshold) {
        // Mostly north-south
        return dz > 0 ? 'north' : 'south';
    } else if (absZ < absX * threshold) {
        // Mostly east-west
        return dx > 0 ? 'east' : 'west';
    } else {
        // Diagonal
        if (dz > 0) {
            return dx > 0 ? 'northeast' : 'northwest';
        } else {
            return dx > 0 ? 'southeast' : 'southwest';
        }
    }
}

// Find the best matching region for coordinates
function findNearestRegion(x: number, z: number, regions: Region[]): Region | null {
    let best: Region | null = null;
    let bestScore = Infinity;

    for (const region of regions) {
        const dist = distance(x, z, region.x, region.z);

        // Score considers both distance and region size
        // Smaller regions (POIs) should only match if very close
        const score = dist / region.radius;

        if (score < bestScore && dist < region.radius * 1.5) {
            bestScore = score;
            best = region;
        }
    }

    return best;
}

// Find what's in a given direction from current location
function findRegionInDirection(
    x: number,
    z: number,
    direction: CardinalDirection,
    searchDistance: number = 200
): Region | null {
    // Calculate a point in the given direction
    let dx = 0, dz = 0;

    if (direction.includes('north')) dz = searchDistance;
    if (direction.includes('south')) dz = -searchDistance;
    if (direction.includes('east')) dx = searchDistance;
    if (direction.includes('west')) dx = -searchDistance;

    // Adjust for diagonals
    if (direction.includes('north') && (direction.includes('east') || direction.includes('west'))) {
        dx *= 0.7;
        dz *= 0.7;
    }
    if (direction.includes('south') && (direction.includes('east') || direction.includes('west'))) {
        dx *= 0.7;
        dz *= 0.7;
    }

    const targetX = x + dx;
    const targetZ = z + dz;

    // Find towns/POIs in that direction
    const towns = getTowns();
    const pois = getPOIs();

    // Prefer towns over POIs for "toward X" descriptions
    let nearest = findNearestRegion(targetX, targetZ, towns);
    if (!nearest) {
        nearest = findNearestRegion(targetX, targetZ, pois);
    }

    return nearest;
}

/**
 * Resolve coordinates and context to a natural language location description.
 *
 * Examples:
 * - "in Lumbridge, near the castle"
 * - "in Falador, at the west bank, running north toward Barbarian Village to buy a bronze axe"
 * - "in the Wilderness, south of the Bone Yard"
 */
export function describeLocation(ctx: LocationContext): LocationDescription {
    const { x, z } = ctx;

    const result: LocationDescription = {
        description: '',
    };

    // Find hierarchical location (kingdom > town > poi)
    const kingdom = findNearestRegion(x, z, getKingdoms());
    const town = findNearestRegion(x, z, getTowns());
    const poi = findNearestRegion(x, z, getPOIs());

    if (kingdom) result.kingdom = kingdom.name;
    if (town) result.town = town.name;
    if (poi) result.poi = poi.name;

    // Find nearest landmark for relative positioning
    const allRegions = getAllRegions();
    let nearestLandmark: Region | null = null;
    let nearestDist = Infinity;

    for (const region of allRegions) {
        const dist = distance(x, z, region.x, region.z);
        if (dist < nearestDist && dist < 50) {  // Within 50 tiles
            nearestDist = dist;
            nearestLandmark = region;
        }
    }

    if (nearestLandmark && nearestDist > 5) {
        // Not right at the landmark, describe relative position
        result.nearestLandmark = nearestLandmark.name;
        result.relativeDirection = getDirection(nearestLandmark.x, nearestLandmark.z, x, z);
    } else if (nearestLandmark) {
        result.nearestLandmark = nearestLandmark.name;
    }

    // Handle movement
    if (ctx.isMoving && ctx.destinationX !== undefined && ctx.destinationZ !== undefined) {
        result.movementType = ctx.isRunning ? 'running' : 'walking';
        result.movementDirection = getDirection(x, z, ctx.destinationX, ctx.destinationZ);

        // Find what's at the destination
        const destRegion = findNearestRegion(ctx.destinationX, ctx.destinationZ, getAllRegions());
        if (destRegion) {
            result.movementDestination = destRegion.name;
        } else {
            // Find what's in that direction
            const dirRegion = findRegionInDirection(x, z, result.movementDirection);
            if (dirRegion) {
                result.movementDestination = dirRegion.name;
            }
        }

        // Add task purpose if available
        if (ctx.taskDescription) {
            result.movementPurpose = ctx.taskDescription;
        } else if (ctx.currentTask?.behaviorName) {
            // Generate purpose from behavior name
            result.movementPurpose = behaviorToPurpose(ctx.currentTask.behaviorName);
        }
    } else {
        result.movementType = 'standing';
    }

    // Build natural language description
    result.description = buildDescription(result);

    return result;
}

// Convert behavior name to a purpose phrase
function behaviorToPurpose(behaviorName: string): string | undefined {
    const purposes: Record<string, string> = {
        'idle': undefined as any,
        'wander': 'to explore',
        'follower': 'to follow someone',
        'social': 'to chat with people',
        'woodcutter': 'to chop trees',
        'miner': 'to mine ore',
        'fisher': 'to fish',
        'smith': 'to smith',
    };
    return purposes[behaviorName];
}

// Build the final natural language description
function buildDescription(loc: LocationDescription): string {
    const parts: string[] = [];

    // Check if landmark is different from current area (avoid "in Lumbridge, near Lumbridge")
    const landmarkIsDifferent = loc.nearestLandmark &&
        loc.nearestLandmark !== loc.town &&
        loc.nearestLandmark !== loc.poi &&
        loc.nearestLandmark !== loc.kingdom;

    // Location
    if (loc.poi) {
        if (loc.town && loc.poi !== loc.town) {
            parts.push(`in ${loc.town}, at ${loc.poi}`);
        } else {
            parts.push(`at ${loc.poi}`);
        }
    } else if (loc.town) {
        if (landmarkIsDifferent && loc.relativeDirection) {
            parts.push(`in ${loc.town}, ${loc.relativeDirection} of ${loc.nearestLandmark}`);
        } else if (landmarkIsDifferent) {
            parts.push(`in ${loc.town}, near ${loc.nearestLandmark}`);
        } else {
            parts.push(`in ${loc.town}`);
        }
    } else if (loc.kingdom) {
        if (landmarkIsDifferent && loc.relativeDirection) {
            parts.push(`in ${loc.kingdom}, ${loc.relativeDirection} of ${loc.nearestLandmark}`);
        } else if (landmarkIsDifferent) {
            parts.push(`in ${loc.kingdom}, near ${loc.nearestLandmark}`);
        } else {
            parts.push(`in ${loc.kingdom}`);
        }
    } else if (loc.nearestLandmark) {
        if (loc.relativeDirection) {
            parts.push(`${loc.relativeDirection} of ${loc.nearestLandmark}`);
        } else {
            parts.push(`near ${loc.nearestLandmark}`);
        }
    } else {
        parts.push('in an unknown area');
    }

    // Movement
    if (loc.movementType === 'walking' || loc.movementType === 'running') {
        let movementPart = `${loc.movementType} ${loc.movementDirection}`;

        if (loc.movementDestination) {
            movementPart += ` toward ${loc.movementDestination}`;
        }

        if (loc.movementPurpose) {
            movementPart += ` ${loc.movementPurpose}`;
        }

        parts.push(movementPart);
    }

    return parts.join(', ');
}

/**
 * Simplified description for when only coordinates are available.
 * Returns just the location without movement info.
 */
export function describeCoordinates(x: number, z: number): string {
    return describeLocation({ x, z }).description;
}

/**
 * Get the direction from one set of coordinates to another.
 */
export function getDirectionBetween(
    fromX: number, fromZ: number,
    toX: number, toZ: number
): CardinalDirection {
    return getDirection(fromX, fromZ, toX, toZ);
}

/**
 * Calculate distance in tiles between two points.
 */
export function getDistanceBetween(
    x1: number, z1: number,
    x2: number, z2: number
): number {
    return Math.round(distance(x1, z1, x2, z2));
}
