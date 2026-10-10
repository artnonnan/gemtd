export interface Point {
  x: number;
  y: number;
}

/** Board is GRID x GRID tiles; one tile holds one gem. */
export const GRID = 37;

/** Warcraft III distance units per tile (a gem footprint is 128x128 in the map). */
export const UNITS_PER_TILE = 128;

/**
 * Spawn, the five mazing points and the mine. Ground creeps must visit them in order;
 * air creeps fly straight from one to the next.
 */
export const CHECKPOINTS: Point[] = [
  { x: 4, y: 4 }, // spawn
  { x: 4, y: 18 },
  { x: 32, y: 18 },
  { x: 32, y: 4 },
  { x: 18, y: 4 },
  { x: 18, y: 32 },
  { x: 32, y: 32 }, // mine
];

/** Tiles within this Chebyshev distance of a checkpoint cannot be built on. */
export const CHECKPOINT_CLEARANCE = 1;

export const GEMS_PER_ROUND = 5;
export const CREEPS_PER_WAVE = 10;
export const SPAWN_INTERVAL = 1.5;
export const START_GOLD = 10;
export const START_LIVES = 50;
export const MAX_LIVES = 50;
export const LAST_LEVEL = 50;

/** Fixed simulation step (seconds). Browser and headless runs must both use it or the same seed plays out differently. */
export const STEP = 1 / 60;

/** Creeps can never be slowed below this fraction of their base speed. */
export const MIN_SPEED_FACTOR = 0.3;

export const toTiles = (units: number) => units / UNITS_PER_TILE;
