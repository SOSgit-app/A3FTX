/** Shared Al-Rimal map schema — editor and VR both load this JSON. */

export type BuildingColor =
  | "red"
  | "blue"
  | "green"
  | "olive"
  | "yellow"
  | "grey";

export type BuildingSpecial =
  | "hospital"
  | "mosque"
  | "church"
  | "station"
  | null;

export type VehicleType =
  | "pickup"
  | "sedan"
  | "van"
  | "bus"
  | "schoolbus"
  | "semi";

/** Suggested body colors per vehicle type (editor default on type change). */
export const VEHICLE_DEFAULT_COLOR: Record<VehicleType, string> = {
  pickup: "#e8731a",
  sedan: "#8e9296",
  van: "#2e9e4f",
  bus: "#2f6fb5",
  schoolbus: "#f5c518",
  semi: "#c0392b",
};

export interface GridCell {
  x: number;
  z: number;
}

/** One column of stacked cubes at a grid cell. height = number of cubes. */
export interface StackCell extends GridCell {
  height: number;
}

export interface Building {
  id: string;
  label?: string;
  color: BuildingColor;
  /** Multi-height stacks: each entry is one footprint cell with stack height. */
  cells: StackCell[];
  special?: BuildingSpecial;
  /**
   * Hospital red-cross center in grid units (fractional). If omitted while
   * `special === "hospital"`, the renderer uses the footprint center.
   */
  crossX?: number;
  crossZ?: number;
  /**
   * Uniform instance scale. New placements default to 0.25 (min gizmo size).
   * Omitted / undefined renders as 1 for older maps. Does not alter plan cells.
   */
  scale?: number;
  /**
   * Free-move offset in grid units (fractional). Plan cells stay integer;
   * world position is cell + offset.
   */
  offsetX?: number;
  offsetZ?: number;
  /**
   * Yaw in degrees about the footprint centre (CCW from above, matches
   * Three.js +Y). Instance transform only — plan cells are unchanged.
   */
  rotation?: number;
}

/**
 * Road segment (editable piece). Legacy maps may still store `{ x, z }` cell
 * tiles — {@link normalizeRoad} upgrades them on load.
 */
export interface Road {
  id: string;
  /** Center position in grid units (fractional OK). */
  x: number;
  z: number;
  /** Local X extent in grid units (default 1). */
  width?: number;
  /** Local Z extent in grid units (default 1). 0° = along north–south. */
  length?: number;
  /** Yaw in degrees, 0 = length along −Z (north). */
  rotation?: number;
}

/** @deprecated Legacy cell road — use {@link Road}. */
export type RoadCell = Road | { x: number; z: number; id?: string };

export interface Vehicle {
  id: string;
  type: VehicleType;
  color: string;
  /** World position in grid units (can be fractional for road center). */
  x: number;
  z: number;
  /** Yaw in degrees, 0 = facing north (−Z). */
  rotation: number;
  /**
   * Uniform instance scale. New vehicles default to DEFAULT_VEHICLE_SCALE;
   * omitted also renders at that default so older maps shrink to match.
   */
  scale?: number;
}

export interface StreetLight {
  id: string;
  /** Position in grid units (fractional OK). */
  x: number;
  z: number;
  /** Uniform instance scale (new lights default to 0.25). */
  scale?: number;
}

export interface Bush {
  id: string;
  x: number;
  z: number;
  scale?: number;
}

export interface MapMeta {
  name: string;
  version: number;
  /** Grid size in cells. */
  cols: number;
  rows: number;
  /** World size of one cell (meters on tabletop before scale). */
  cellSize: number;
  /**
   * Which world axis is north. Default "negZ": row z=0 is the north edge and
   * z grows southward, so a top-down view with north up has east on the right.
   */
  north?: "posZ" | "negZ" | "posX" | "negX";
}

export interface TownMap {
  meta: MapMeta;
  roads: Road[];
  buildings: Building[];
  vehicles: Vehicle[];
  streetLights: StreetLight[];
  bushes: Bush[];
}

export const BUILDING_HEX: Record<BuildingColor, string> = {
  red: "#c0392b",
  blue: "#2980b9",
  green: "#27ae60",
  olive: "#7d8c3b",
  yellow: "#d4a017",
  grey: "#7f8c8d",
};

export const DEFAULT_MAP: TownMap = {
  meta: {
    name: "Al-Rimal",
    version: 1,
    cols: 14,
    rows: 14,
    cellSize: 1,
    north: "negZ",
  },
  roads: [],
  buildings: [],
  vehicles: [],
  streetLights: [],
  bushes: [],
};

export function createEmptyMap(
  cols = 14,
  rows = 14,
  name = "Al-Rimal"
): TownMap {
  return {
    meta: {
      name,
      version: 1,
      cols,
      rows,
      cellSize: 1,
      north: "negZ",
    },
    roads: [],
    buildings: [],
    vehicles: [],
    streetLights: [],
    bushes: [],
  };
}

export function cloneMap(map: TownMap): TownMap {
  return structuredClone(map);
}
