// location-memory.ts - Track known/unknown locations
//
// Bots learn about locations through:
// - Visiting them personally (verified, has coordinates)
// - Being told about them (unverified, may not have coordinates)
// - Reading signs/books (unverified)
//
// When a bot needs to go somewhere unknown, they wander and ask for directions.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { describeCoordinates } from '../locations';

/**
 * A location the bot knows about.
 */
export interface KnownLocation {
    name: string;                 // e.g., "Varrock West Bank", "Barbarian Village"
    aliases: string[];            // Other names for this place

    // Location data
    coordinates?: { x: number; z: number };  // Only if we've been there
    regionName?: string;          // Parent region (e.g., "Varrock" for "Varrock West Bank")

    // Knowledge level
    visited: boolean;             // Have we actually been here?
    visitCount: number;           // How many times
    lastVisited?: number;         // Timestamp

    // How we learned about it
    source: 'visited' | 'told' | 'read' | 'discovered';
    toldBy?: string;              // Who told us (if source is 'told')

    // Directions we've received
    directionsFrom?: {
        fromLocation: string;     // "from Lumbridge"
        directions: string;       // "go north past the cows"
        givenBy: string;          // Who gave these directions
        verified: boolean;        // Did we successfully use them?
    }[];

    // What's here (discovered through visiting)
    features?: string[];          // e.g., ["bank", "anvil", "furnace"]
    npcs?: string[];              // Notable NPCs here
    monsters?: string[];          // Monsters in the area
}

/**
 * A destination the bot wants to reach but doesn't know how.
 */
export interface UnknownDestination {
    name: string;
    reason: string;               // Why we want to go there
    requestedBy?: string;         // Who asked us to go
    requestedAt: number;

    // Partial info we might have
    hints: string[];              // "I heard it's north of Varrock"
    wrongDirections: Array<{
        directions: string;
        givenBy: string;
        triedAt: number;
    }>;
}

/**
 * Location memory data structure.
 */
export interface LocationMemoryData {
    version: number;
    knownLocations: Record<string, KnownLocation>;  // Keyed by lowercase name
    unknownDestinations: Record<string, UnknownDestination>;
    currentLocation?: { x: number; z: number; name: string };
}

const CURRENT_VERSION = 1;

/**
 * Location memory manager.
 */
export class LocationMemory {
    private filePath: string;
    private data: LocationMemoryData;
    private dirty: boolean = false;

    constructor(filePath: string) {
        this.filePath = filePath;
        this.data = this.createEmpty();
    }

    private createEmpty(): LocationMemoryData {
        return {
            version: CURRENT_VERSION,
            knownLocations: {},
            unknownDestinations: {},
        };
    }

    load(): void {
        if (!existsSync(this.filePath)) {
            this.data = this.createEmpty();
            return;
        }
        try {
            const raw = readFileSync(this.filePath, 'utf-8');
            this.data = JSON.parse(raw);
        } catch (err) {
            console.error(`[LocationMemory] Failed to load: ${err}`);
            this.data = this.createEmpty();
        }
    }

    save(): void {
        try {
            const dir = dirname(this.filePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
            this.dirty = false;
        } catch (err) {
            console.error(`[LocationMemory] Failed to save: ${err}`);
        }
    }

    private normalize(name: string): string {
        return name.toLowerCase().trim();
    }

    // ========== VISITING LOCATIONS ==========

    /**
     * Record visiting a location. This is the most reliable way to learn.
     */
    visitLocation(
        name: string,
        coordinates: { x: number; z: number },
        features?: string[]
    ): void {
        const key = this.normalize(name);
        const regionName = describeCoordinates(coordinates.x, coordinates.z);

        const existing = this.data.knownLocations[key];
        if (existing) {
            existing.visited = true;
            existing.visitCount++;
            existing.lastVisited = Date.now();
            existing.coordinates = coordinates;
            existing.regionName = regionName;
            if (features) {
                existing.features = [...new Set([...(existing.features || []), ...features])];
            }
        } else {
            this.data.knownLocations[key] = {
                name,
                aliases: [],
                coordinates,
                regionName,
                visited: true,
                visitCount: 1,
                lastVisited: Date.now(),
                source: 'visited',
                features,
            };
        }

        // Update current location
        this.data.currentLocation = { ...coordinates, name };

        // Remove from unknown destinations if we finally found it
        if (this.data.unknownDestinations[key]) {
            delete this.data.unknownDestinations[key];
        }

        this.dirty = true;
    }

    /**
     * Update current position (for tracking movement).
     */
    updatePosition(x: number, z: number): void {
        const regionName = describeCoordinates(x, z);
        this.data.currentLocation = { x, z, name: regionName };

        // Auto-learn the region we're in
        const regionKey = this.normalize(regionName);
        if (!this.data.knownLocations[regionKey]) {
            this.data.knownLocations[regionKey] = {
                name: regionName,
                aliases: [],
                coordinates: { x, z },
                regionName,
                visited: true,
                visitCount: 1,
                lastVisited: Date.now(),
                source: 'discovered',
            };
            this.dirty = true;
        }
    }

    // ========== LEARNING FROM OTHERS ==========

    /**
     * Learn about a location from someone telling us.
     */
    toldAboutLocation(
        name: string,
        toldBy: string,
        info?: {
            coordinates?: { x: number; z: number };
            regionName?: string;
            features?: string[];
            directions?: { from: string; directions: string };
        }
    ): void {
        const key = this.normalize(name);
        const existing = this.data.knownLocations[key];

        if (existing) {
            // Update with new info but don't downgrade verified info
            if (info?.coordinates && !existing.coordinates) {
                existing.coordinates = info.coordinates;
            }
            if (info?.regionName && !existing.regionName) {
                existing.regionName = info.regionName;
            }
            if (info?.features) {
                existing.features = [...new Set([...(existing.features || []), ...info.features])];
            }
            if (info?.directions) {
                existing.directionsFrom = existing.directionsFrom || [];
                existing.directionsFrom.push({
                    fromLocation: info.directions.from,
                    directions: info.directions.directions,
                    givenBy: toldBy,
                    verified: false,
                });
            }
        } else {
            this.data.knownLocations[key] = {
                name,
                aliases: [],
                coordinates: info?.coordinates,
                regionName: info?.regionName,
                visited: false,
                visitCount: 0,
                source: 'told',
                toldBy,
                features: info?.features,
                directionsFrom: info?.directions ? [{
                    fromLocation: info.directions.from,
                    directions: info.directions.directions,
                    givenBy: toldBy,
                    verified: false,
                }] : undefined,
            };
        }

        // Remove from unknown if we now have directions
        if (info?.coordinates || info?.directions) {
            delete this.data.unknownDestinations[key];
        }

        this.dirty = true;
    }

    /**
     * Mark directions as verified (we successfully used them).
     */
    verifyDirections(locationName: string, fromLocation: string): void {
        const key = this.normalize(locationName);
        const loc = this.data.knownLocations[key];
        if (!loc?.directionsFrom) return;

        const dir = loc.directionsFrom.find(d =>
            this.normalize(d.fromLocation) === this.normalize(fromLocation)
        );
        if (dir) {
            dir.verified = true;
            this.dirty = true;
        }
    }

    /**
     * Record that directions were wrong.
     */
    markDirectionsWrong(locationName: string, fromLocation: string, givenBy: string): void {
        const key = this.normalize(locationName);

        // Remove from known locations if it was the only source
        const loc = this.data.knownLocations[key];
        if (loc?.directionsFrom) {
            loc.directionsFrom = loc.directionsFrom.filter(d =>
                !(this.normalize(d.fromLocation) === this.normalize(fromLocation) &&
                  d.givenBy === givenBy)
            );
        }

        // Add to unknown destinations with the wrong directions recorded
        if (!this.data.unknownDestinations[key]) {
            this.data.unknownDestinations[key] = {
                name: locationName,
                reason: 'Looking for this place',
                requestedAt: Date.now(),
                hints: [],
                wrongDirections: [],
            };
        }

        this.data.unknownDestinations[key].wrongDirections.push({
            directions: `From ${fromLocation} (given by ${givenBy})`,
            givenBy,
            triedAt: Date.now(),
        });

        this.dirty = true;
    }

    // ========== QUERYING ==========

    /**
     * Check if we know how to get to a location.
     */
    knowsLocation(name: string): {
        known: boolean;
        visited: boolean;
        hasCoordinates: boolean;
        hasDirections: boolean;
        confidence: 'high' | 'medium' | 'low' | 'none';
    } {
        const key = this.normalize(name);
        const loc = this.data.knownLocations[key];

        if (!loc) {
            return { known: false, visited: false, hasCoordinates: false, hasDirections: false, confidence: 'none' };
        }

        const hasCoordinates = !!loc.coordinates;
        const hasDirections = (loc.directionsFrom?.length ?? 0) > 0;
        const hasVerifiedDirections = loc.directionsFrom?.some(d => d.verified) ?? false;

        let confidence: 'high' | 'medium' | 'low' | 'none' = 'none';
        if (loc.visited) {
            confidence = 'high';
        } else if (hasCoordinates || hasVerifiedDirections) {
            confidence = 'medium';
        } else if (hasDirections) {
            confidence = 'low';
        }

        return {
            known: true,
            visited: loc.visited,
            hasCoordinates,
            hasDirections,
            confidence,
        };
    }

    /**
     * Get location info.
     */
    getLocation(name: string): KnownLocation | null {
        const key = this.normalize(name);
        return this.data.knownLocations[key] || null;
    }

    /**
     * Get directions to a location from current position.
     */
    getDirectionsTo(name: string): {
        hasDirections: boolean;
        directions?: string;
        fromLocation?: string;
        givenBy?: string;
        verified?: boolean;
        coordinates?: { x: number; z: number };
    } {
        const key = this.normalize(name);
        const loc = this.data.knownLocations[key];

        if (!loc) {
            return { hasDirections: false };
        }

        // If we have coordinates, we can navigate directly
        if (loc.coordinates) {
            return {
                hasDirections: true,
                coordinates: loc.coordinates,
                verified: loc.visited,
            };
        }

        // Otherwise, find best directions from nearby
        if (loc.directionsFrom && loc.directionsFrom.length > 0) {
            // Prefer verified directions
            const verified = loc.directionsFrom.find(d => d.verified);
            const dir = verified || loc.directionsFrom[0];
            return {
                hasDirections: true,
                directions: dir.directions,
                fromLocation: dir.fromLocation,
                givenBy: dir.givenBy,
                verified: dir.verified,
            };
        }

        return { hasDirections: false };
    }

    // ========== UNKNOWN DESTINATIONS ==========

    /**
     * Add a place we want to go but don't know how.
     */
    addUnknownDestination(name: string, reason: string, requestedBy?: string): void {
        const key = this.normalize(name);

        // Don't add if we already know how to get there
        if (this.knowsLocation(name).confidence !== 'none') {
            return;
        }

        if (!this.data.unknownDestinations[key]) {
            this.data.unknownDestinations[key] = {
                name,
                reason,
                requestedBy,
                requestedAt: Date.now(),
                hints: [],
                wrongDirections: [],
            };
            this.dirty = true;
        }
    }

    /**
     * Add a hint about an unknown destination.
     */
    addHint(name: string, hint: string): void {
        const key = this.normalize(name);
        const dest = this.data.unknownDestinations[key];
        if (dest && !dest.hints.includes(hint)) {
            dest.hints.push(hint);
            this.dirty = true;
        }
    }

    /**
     * Get all unknown destinations we're looking for.
     */
    getUnknownDestinations(): UnknownDestination[] {
        return Object.values(this.data.unknownDestinations);
    }

    /**
     * Get current location.
     */
    getCurrentLocation(): { x: number; z: number; name: string } | null {
        return this.data.currentLocation || null;
    }

    // ========== GIVING DIRECTIONS ==========

    /**
     * Check if we can give directions to a location.
     * Returns the response to give.
     */
    canGiveDirections(locationName: string): {
        knows: boolean;
        confidence: 'high' | 'medium' | 'low';
        response: string;
        shouldGiveWrongInfo?: boolean;  // 20% chance when we don't know
    } {
        const knowledge = this.knowsLocation(locationName);
        const loc = this.getLocation(locationName);

        if (knowledge.confidence === 'high' && loc?.coordinates) {
            const regionDesc = loc.regionName || describeCoordinates(loc.coordinates.x, loc.coordinates.z);
            return {
                knows: true,
                confidence: 'high',
                response: `Yeah, I know ${locationName}! It's ${regionDesc}. I've been there ${loc.visitCount} time${loc.visitCount > 1 ? 's' : ''}.`,
            };
        }

        if (knowledge.confidence === 'medium' && loc) {
            const dirInfo = this.getDirectionsTo(locationName);
            if (dirInfo.directions) {
                return {
                    knows: true,
                    confidence: 'medium',
                    response: `I haven't been there myself, but I heard from ${loc.toldBy || 'someone'} that ${dirInfo.directions}`,
                };
            }
            if (loc.regionName) {
                return {
                    knows: true,
                    confidence: 'medium',
                    response: `I think it's somewhere in ${loc.regionName}, but I haven't been there myself.`,
                };
            }
        }

        if (knowledge.confidence === 'low' && loc?.directionsFrom?.[0]) {
            const dir = loc.directionsFrom[0];
            return {
                knows: true,
                confidence: 'low',
                response: `Hmm, ${dir.givenBy} told me ${dir.directions}, but I haven't verified that.`,
            };
        }

        // We don't know - 20% chance of giving wrong info, 80% admit ignorance
        const giveWrongInfo = Math.random() < 0.2;

        if (giveWrongInfo) {
            // Generate plausible-sounding wrong directions
            const wrongResponses = [
                `I think it's east of Varrock... maybe near the mines?`,
                `Pretty sure it's south of Falador somewhere.`,
                `Try going north from Lumbridge, past the goblins.`,
                `I heard it's near Draynor, by the willows.`,
                `Should be west of the Barbarian Village, I think.`,
            ];
            return {
                knows: false,
                confidence: 'low',
                response: wrongResponses[Math.floor(Math.random() * wrongResponses.length)],
                shouldGiveWrongInfo: true,
            };
        }

        return {
            knows: false,
            confidence: 'low',
            response: `Sorry, I don't know where ${locationName} is. Haven't been there.`,
        };
    }

    // ========== LLM FORMATTING ==========

    formatForLLM(): string {
        const lines: string[] = ['Location knowledge:'];

        const visited = Object.values(this.data.knownLocations).filter(l => l.visited);
        const heardOf = Object.values(this.data.knownLocations).filter(l => !l.visited);
        const unknown = Object.values(this.data.unknownDestinations);

        if (visited.length > 0) {
            lines.push(`  Visited (${visited.length}): ${visited.slice(0, 5).map(l => l.name).join(', ')}${visited.length > 5 ? '...' : ''}`);
        }
        if (heardOf.length > 0) {
            lines.push(`  Heard of (${heardOf.length}): ${heardOf.slice(0, 5).map(l => l.name).join(', ')}${heardOf.length > 5 ? '...' : ''}`);
        }
        if (unknown.length > 0) {
            lines.push(`  Looking for: ${unknown.map(u => u.name).join(', ')}`);
        }

        if (this.data.currentLocation) {
            lines.push(`  Currently at: ${this.data.currentLocation.name}`);
        }

        return lines.join('\n');
    }
}

export function createLocationMemory(accountDir: string): LocationMemory {
    const filePath = `${accountDir}/locations.json`;
    return new LocationMemory(filePath);
}
