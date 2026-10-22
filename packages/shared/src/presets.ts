import type {
  Building,
  BuildingColor,
  BuildingSpecial,
  StackCell,
  TownMap,
} from "./types.js";
import {
  buildingFootprintCenter,
  DEFAULT_BUILDING_SCALE,
  normalizeRoad,
  roadCoversCell,
} from "./mapOps.js";

/** A reusable building plan: footprint cells + stack heights, relative to (0,0). */
export interface BuildingPreset {
  id: string;
  name: string;
  cells: StackCell[];
  defaultColor?: BuildingColor;
  special?: BuildingSpecial;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Shift cells so min x/z = 0 and sort deterministically. */
export function normalizeCells(cells: StackCell[]): StackCell[] {
  if (!cells.length) return [];
  const minX = Math.min(...cells.map((c) => c.x));
  const minZ = Math.min(...cells.map((c) => c.z));
  return cells
    .map((c) => ({ x: c.x - minX, z: c.z - minZ, height: c.height }))
    .sort((a, b) => a.z - b.z || a.x - b.x);
}

/** Rotate cells by quarter turns (clockwise when viewed from above, north up). */
export function rotateCells(cells: StackCell[], quarterTurns: number): StackCell[] {
  const t = ((quarterTurns % 4) + 4) % 4;
  let out = cells;
  for (let i = 0; i < t; i++) {
    out = normalizeCells(
      out.map((c) => ({ x: c.z, z: -c.x, height: c.height }))
    );
  }
  return normalizeCells(out);
}

export function presetExtent(cells: StackCell[]): { w: number; d: number } {
  if (!cells.length) return { w: 0, d: 0 };
  const n = normalizeCells(cells);
  return {
    w: Math.max(...n.map((c) => c.x)) + 1,
    d: Math.max(...n.map((c) => c.z)) + 1,
  };
}

export function presetFromBuilding(b: Building, name?: string): BuildingPreset {
  return {
    id: uid("plan"),
    name: name ?? b.label ?? b.id,
    cells: normalizeCells(b.cells),
    defaultColor: b.color,
    special: b.special ?? null,
  };
}

export function createPreset(
  name: string,
  cells: StackCell[],
  defaultColor?: BuildingColor,
  special?: BuildingSpecial
): BuildingPreset {
  return {
    id: uid("plan"),
    name,
    cells: normalizeCells(cells),
    defaultColor,
    special: special ?? null,
  };
}

/**
 * Optional advisory check (ghost tint). Placement itself is never blocked —
 * buildings may be stamped anywhere, including overlaps / off-grid.
 */
export function canStamp(
  map: TownMap,
  cells: StackCell[],
  x: number,
  z: number
): boolean {
  void map;
  void cells;
  void x;
  void z;
  return true;
}

export interface StampOptions {
  color: BuildingColor;
  label?: string;
  special?: BuildingSpecial;
  rotation?: number;
}

/**
 * Stamp a preset centered on (worldX, worldZ) in grid units (fractional OK).
 * Always succeeds if the plan has cells — no overlap / bounds gate.
 */
export function stampPreset(
  map: TownMap,
  preset: BuildingPreset,
  worldX: number,
  worldZ: number,
  opts: StampOptions
): TownMap | null {
  const rotated = rotateCells(preset.cells, opts.rotation ?? 0);
  if (!rotated.length) return null;
  const local = normalizeCells(rotated);

  let sx = 0;
  let sz = 0;
  for (const c of local) {
    sx += c.x + 0.5;
    sz += c.z + 0.5;
  }
  const n = local.length;
  const localCx = sx / n;
  const localCz = sz / n;

  const originX = Math.round(worldX - localCx);
  const originZ = Math.round(worldZ - localCz);
  const placed = local.map((c) => ({
    x: originX + c.x,
    z: originZ + c.z,
    height: c.height,
  }));
  const offsetX = worldX - (originX + localCx);
  const offsetZ = worldZ - (originZ + localCz);

  const next = structuredClone(map);
  const footprint = placed.map((c) => [c.x, c.z] as const);
  next.roads = next.roads.filter((r) => {
    const road = normalizeRoad(r);
    return !footprint.some(([fx, fz]) => roadCoversCell(road, fx, fz));
  });

  const special = opts.special ?? preset.special ?? null;
  const building = {
    id: uid("bldg"),
    label: opts.label?.trim() || preset.name,
    color: opts.color,
    cells: placed,
    special,
    scale: DEFAULT_BUILDING_SCALE,
    offsetX,
    offsetZ,
    crossX: undefined as number | undefined,
    crossZ: undefined as number | undefined,
  };
  if (special === "hospital") {
    const c = buildingFootprintCenter(building);
    building.crossX = c.x;
    building.crossZ = c.z;
  } else {
    delete building.crossX;
    delete building.crossZ;
  }
  next.buildings.push(building);
  return next;
}
