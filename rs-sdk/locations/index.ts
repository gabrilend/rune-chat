// locations - Natural language location descriptions
//
// Converts coordinates to human-readable descriptions like:
// "in Lumbridge, near the castle, walking north toward Varrock"

export type { Region } from './regions';
export {
    getAllRegions,
    getKingdoms,
    getTowns,
    getPOIs,
    findRegionByName,
} from './regions';

export type {
    LocationContext,
    LocationDescription,
    CardinalDirection,
} from './resolver';

export {
    describeLocation,
    describeCoordinates,
    getDirectionBetween,
    getDistanceBetween,
} from './resolver';
