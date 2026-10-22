import type {
  Building,
  BuildingColor,
  BuildingSpecial,
  Road,
  StackCell,
  StreetLight,
  TownMap,
  Vehicle,
  VehicleType,
  Bush,
} from "./types.js";

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Upgrade legacy `{ x, z }` tiles or partial roads to full segments. */
export function normalizeRoad(
  r: Partial<Road> & { x: number; z: number },
  index = 0
): Road {
  if (r.id) {
    return {
      id: r.id,
      x: r.x,
      z: r.z,
      width: r.width ?? 1,
      length: r.length ?? 1,
      rotation: r.rotation ?? 0,
    };
  }
  // Legacy integer cell tile → 1×1 segment centered on the cell.
  return {
    id: `road_${Math.floor(r.x)}_${Math.floor(r.z)}_${index}`,
    x: Math.floor(r.x) + 0.5,
    z: Math.floor(r.z) + 0.5,
    width: 1,
    length: 1,
    rotation: 0,
  };
}

export function normalizeRoads(map: TownMap): TownMap {
  const next = structuredClone(map);
  next.roads = (next.roads as Array<Partial<Road> & { x: number; z: number }>).map(
    (r, i) => normalizeRoad(r, i)
  );
  return next;
}

/** True if road footprint covers grid cell (x, z). */
export function roadCoversCell(road: Road, x: number, z: number): boolean {
  const r = normalizeRoad(road);
  const cx = x + 0.5;
  const cz = z + 0.5;
  const rad = (-(r.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = cx - r.x;
  const dz = cz - r.z;
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const hw = (r.width ?? 1) / 2 + 0.02;
  const hl = (r.length ?? 1) / 2 + 0.02;
  return Math.abs(localX) <= hw && Math.abs(localZ) <= hl;
}

function removeRoadsOnCells(map: TownMap, cells: Iterable<string>): void {
  const set = cells instanceof Set ? cells : new Set(cells);
  map.roads = map.roads.filter((r) => {
    const n = normalizeRoad(r);
    for (const key of set) {
      const [x, z] = key.split(",").map(Number);
      if (roadCoversCell(n, x, z)) return false;
    }
    // Also drop if center sits on a cleared cell
    if (set.has(`${Math.floor(n.x)},${Math.floor(n.z)}`)) return false;
    return true;
  });
}

/** Effective grid position of a building cell (integer plan + free offset). */
export function buildingCellPos(
  b: Building,
  c: { x: number; z: number }
): { x: number; z: number } {
  return {
    x: c.x + (b.offsetX ?? 0),
    z: c.z + (b.offsetZ ?? 0),
  };
}

export function findBuildingAt(
  map: TownMap,
  x: number,
  z: number
): Building | undefined {
  return map.buildings.find((b) =>
    b.cells.some((c) => {
      const p = buildingCellPos(b, c);
      return Math.floor(p.x) === x && Math.floor(p.z) === z;
    })
  );
}

export function findRoadAt(map: TownMap, x: number, z: number): Road | undefined {
  return map.roads.find((r) => roadCoversCell(normalizeRoad(r), x, z));
}

export function findLightAt(
  map: TownMap,
  x: number,
  z: number
): StreetLight | undefined {
  return map.streetLights.find(
    (l) => Math.round(l.x) === x && Math.round(l.z) === z
  );
}

/** Paint or raise a stack on a building. Creates a new building if needed. */
export function paintBuildingStack(
  map: TownMap,
  x: number,
  z: number,
  color: BuildingColor,
  height: number,
  buildingId?: string,
  special?: BuildingSpecial
): TownMap {
  const next = structuredClone(map);
  const h = Math.max(1, Math.min(8, height));

  // Remove roads under building paint
  removeRoadsOnCells(next, [`${x},${z}`]);

  let building =
    (buildingId && next.buildings.find((b) => b.id === buildingId)) ||
    findBuildingAt(next, x, z);

  // If painting a different color on an existing cell belonging to another building,
  // detach that cell first.
  if (!buildingId) {
    for (const b of next.buildings) {
      if (b.color !== color && b.cells.some((c) => c.x === x && c.z === z)) {
        b.cells = b.cells.filter((c) => !(c.x === x && c.z === z));
      }
    }
    next.buildings = next.buildings.filter((b) => b.cells.length > 0);
    building = next.buildings.find(
      (b) => b.color === color && b.cells.some((c) => neighborsOrSelf(c, x, z))
    );
  }

  if (!building) {
    building = {
      id: buildingId ?? uid("bldg"),
      color,
      cells: [],
      special: special ?? null,
      scale: DEFAULT_BUILDING_SCALE,
    };
    next.buildings.push(building);
  }

  const existing = building.cells.find((c) => c.x === x && c.z === z);
  if (existing) {
    existing.height = h;
  } else {
    building.cells.push({ x, z, height: h });
  }

  if (special !== undefined) {
    building.special = special;
    if (special === "hospital") ensureHospitalCross(building);
    else {
      delete building.crossX;
      delete building.crossZ;
    }
  }
  return next;
}

function neighborsOrSelf(c: StackCell, x: number, z: number): boolean {
  return Math.abs(c.x - x) + Math.abs(c.z - z) <= 1;
}

export function eraseCell(map: TownMap, x: number, z: number): TownMap {
  const next = structuredClone(map);
  removeRoadsOnCells(next, [`${x},${z}`]);
  for (const b of next.buildings) {
    b.cells = b.cells.filter((c) => !(c.x === x && c.z === z));
  }
  next.buildings = next.buildings.filter((b) => b.cells.length > 0);
  next.streetLights = next.streetLights.filter(
    (l) => !(Math.round(l.x) === x && Math.round(l.z) === z)
  );
  return next;
}

export function paintRoad(map: TownMap, x: number, z: number): TownMap {
  const next = eraseCell(map, x, z);
  if (!findRoadAt(next, x, z)) {
    next.roads.push({
      id: uid("road"),
      x: x + 0.5,
      z: z + 0.5,
      width: 1,
      length: 1,
      rotation: 0,
    });
  }
  return next;
}

/** @deprecated Prefer {@link placeStreetLight} for free placement. */
export function toggleStreetLight(map: TownMap, x: number, z: number): TownMap {
  const next = structuredClone(map);
  const idx = next.streetLights.findIndex(
    (l) => Math.round(l.x) === x && Math.round(l.z) === z
  );
  if (idx >= 0) {
    next.streetLights.splice(idx, 1);
  } else {
    next.streetLights.push({
      id: uid("light"),
      x: x + 0.5,
      z: z + 0.5,
      scale: DEFAULT_BUILDING_SCALE,
    });
  }
  return next;
}

/** Place a street light at free grid coords (small by default). */
export function placeStreetLight(
  map: TownMap,
  x: number,
  z: number
): TownMap {
  const next = structuredClone(map);
  next.streetLights.push({
    id: uid("light"),
    x,
    z,
    scale: DEFAULT_BUILDING_SCALE,
  });
  return next;
}

export function placeVehicle(
  map: TownMap,
  x: number,
  z: number,
  type: VehicleType,
  color: string,
  rotation: number
): TownMap {
  const next = structuredClone(map);
  next.vehicles.push({
    id: uid("veh"),
    type,
    color,
    x: x + 0.5,
    z: z + 0.5,
    rotation,
    scale: DEFAULT_VEHICLE_SCALE,
  });
  return next;
}

/** Smallest vehicle instance scale. */
export const MIN_VEHICLE_SCALE = 0.1;
/** Default vehicle scale: a car is ~⅓ of a cell long, ~3 car-widths per 1-cell road. */
export const DEFAULT_VEHICLE_SCALE = 0.5;

/** Snap vehicle scale to 0.05 steps, clamped to {@link MIN_VEHICLE_SCALE}–2. */
export function snapVehicleScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return DEFAULT_VEHICLE_SCALE;
  const snapped = Math.round(scale * 20) / 20;
  return Math.max(MIN_VEHICLE_SCALE, Math.min(2, snapped));
}

/** Uniformly resize a vehicle by a relative gizmo factor. */
export function scaleVehicleUniform(
  map: TownMap,
  vehicleId: string,
  relativeFactor: number
): TownMap | null {
  if (!Number.isFinite(relativeFactor) || relativeFactor <= 0) return null;
  const next = structuredClone(map);
  const v = next.vehicles.find((vv) => vv.id === vehicleId);
  if (!v) return null;
  const current = v.scale ?? DEFAULT_VEHICLE_SCALE;
  const nextScale = snapVehicleScale(current * relativeFactor);
  if (Math.abs(nextScale - current) < 0.001) return map;
  v.scale = nextScale;
  return next;
}

export function placeBush(map: TownMap, x: number, z: number): TownMap {
  const next = structuredClone(map);
  next.bushes.push({
    id: uid("bush"),
    x: x + 0.5,
    z: z + 0.5,
    scale: 0.8 + Math.random() * 0.4,
  });
  return next;
}

export function setBuildingLabel(
  map: TownMap,
  buildingId: string,
  label: string
): TownMap {
  const next = structuredClone(map);
  const b = next.buildings.find((bb) => bb.id === buildingId);
  if (b) b.label = label;
  return next;
}

export function setBuildingSpecial(
  map: TownMap,
  buildingId: string,
  special: BuildingSpecial
): TownMap {
  const next = structuredClone(map);
  const b = next.buildings.find((bb) => bb.id === buildingId);
  if (!b) return map;
  b.special = special;
  if (special === "hospital") {
    ensureHospitalCross(b);
  } else {
    delete b.crossX;
    delete b.crossZ;
  }
  return next;
}

/** Footprint center in grid units. */
export function buildingFootprintCenter(b: Building): { x: number; z: number } {
  if (!b.cells.length) return { x: 0, z: 0 };
  let sx = 0;
  let sz = 0;
  for (const c of b.cells) {
    sx += c.x + 0.5;
    sz += c.z + 0.5;
  }
  const n = b.cells.length;
  return {
    x: sx / n + (b.offsetX ?? 0),
    z: sz / n + (b.offsetZ ?? 0),
  };
}

function ensureHospitalCross(b: Building): void {
  if (b.crossX != null && b.crossZ != null) return;
  const c = buildingFootprintCenter(b);
  b.crossX = c.x;
  b.crossZ = c.z;
}

/** Place / move the hospital red cross (grid units). Must be a hospital. */
/**
 * Convert a world grid point into a building's plan frame (undo the instance
 * rotation and scale about the footprint centre). Plan-frame points are what
 * `crossX/crossZ` store, so the renderer's group transform lands them back
 * under the original world point.
 */
export function buildingWorldToPlan(
  b: Building,
  x: number,
  z: number
): { x: number; z: number } {
  const c = buildingFootprintCenter(b);
  const s = b.scale ?? 1;
  const rad = (-(b.rotation ?? 0) * Math.PI) / 180;
  const dx = x - c.x;
  const dz = z - c.z;
  // Inverse of Three.js rotation about +Y by `rotation`.
  const rx = dx * Math.cos(rad) + dz * Math.sin(rad);
  const rz = -dx * Math.sin(rad) + dz * Math.cos(rad);
  return { x: c.x + rx / s, z: c.z + rz / s };
}

/** Place the hospital cross under a world grid point. */
export function setHospitalCross(
  map: TownMap,
  buildingId: string,
  x: number,
  z: number
): TownMap | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const next = structuredClone(map);
  const b = next.buildings.find((bb) => bb.id === buildingId);
  if (!b || b.special !== "hospital") return null;
  const p = buildingWorldToPlan(b, x, z);
  b.crossX = p.x;
  b.crossZ = p.z;
  return next;
}

/** Snap building yaw to 15° steps, normalised to 0–345. */
export function snapBuildingRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const snapped = Math.round(deg / 15) * 15;
  return ((snapped % 360) + 360) % 360;
}

/**
 * Rotate a building instance by `deltaDeg` about its footprint centre.
 * Free yaw (15° snap); plan cells are untouched.
 */
export function rotateBuildingBy(
  map: TownMap,
  buildingId: string,
  deltaDeg: number
): TownMap | null {
  if (!Number.isFinite(deltaDeg)) return null;
  const next = structuredClone(map);
  const b = next.buildings.find((bb) => bb.id === buildingId);
  if (!b) return null;
  const current = b.rotation ?? 0;
  const rot = snapBuildingRotation(current + deltaDeg);
  if (rot === snapBuildingRotation(current)) return map;
  b.rotation = rot;
  return next;
}

/** Stack height under a grid point (nearest cell if not exact). */
export function buildingRoofHeightAt(b: Building, x: number, z: number): number {
  if (!b.cells.length) return 1;
  const fx = Math.floor(x);
  const fz = Math.floor(z);
  const exact = b.cells.find((c) => c.x === fx && c.z === fz);
  if (exact) return Math.max(1, exact.height);
  let best = b.cells[0]!;
  let bestD = Infinity;
  for (const c of b.cells) {
    const d =
      (c.x + 0.5 - x) * (c.x + 0.5 - x) + (c.z + 0.5 - z) * (c.z + 0.5 - z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return Math.max(1, best.height);
}

export function deleteBuilding(map: TownMap, buildingId: string): TownMap {
  const next = structuredClone(map);
  next.buildings = next.buildings.filter((b) => b.id !== buildingId);
  return next;
}

/** Set every stack in a building to the same height (1–8). */
export function resizeBuildingHeight(
  map: TownMap,
  buildingId: string,
  height: number
): TownMap {
  const next = structuredClone(map);
  const b = next.buildings.find((bb) => bb.id === buildingId);
  if (!b) return map;
  const h = Math.max(1, Math.min(8, Math.round(height)));
  for (const c of b.cells) c.height = h;
  return next;
}

/** Multiply every stack height by factor (keeps relative shape, clamps 1–8). */
export function scaleBuildingHeights(
  map: TownMap,
  buildingId: string,
  factor: number
): TownMap {
  const next = structuredClone(map);
  const b = next.buildings.find((bb) => bb.id === buildingId);
  if (!b || !Number.isFinite(factor) || factor <= 0) return map;
  for (const c of b.cells) {
    c.height = Math.max(1, Math.min(8, Math.round(c.height * factor)));
  }
  return next;
}

/** Smallest uniform building scale (gizmo floor). Also used as place default. */
export const MIN_BUILDING_SCALE = 0.25;
/** Default scale when painting / stamping a new building. */
export const DEFAULT_BUILDING_SCALE = MIN_BUILDING_SCALE;

/** Snap instance scale to 0.25 steps, clamped to {@link MIN_BUILDING_SCALE}–4. */
export function snapBuildingScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return DEFAULT_BUILDING_SCALE;
  const snapped = Math.round(scale * 4) / 4;
  return Math.max(MIN_BUILDING_SCALE, Math.min(4, snapped));
}

/** @deprecated Use {@link snapBuildingScale}. */
export function snapUniformScaleFactor(factor: number): number {
  return snapBuildingScale(factor);
}

/**
 * Uniformly resize a building instance. Multiplies `building.scale` by
 * `relativeFactor` (gizmo delta from 1). Plan cells are never changed.
 */
export function scaleBuildingUniform(
  map: TownMap,
  buildingId: string,
  relativeFactor: number
): TownMap | null {
  if (!Number.isFinite(relativeFactor) || relativeFactor <= 0) return null;

  const next = structuredClone(map);
  const b = next.buildings.find((bb) => bb.id === buildingId);
  if (!b || !b.cells.length) return null;

  const current = b.scale ?? 1;
  const nextScale = snapBuildingScale(current * relativeFactor);
  if (Math.abs(nextScale - current) < 0.001) return map;

  b.scale = nextScale;
  return next;
}

function normalizeStackCells(
  cells: { x: number; z: number; height: number }[]
): { x: number; z: number; height: number }[] {
  if (!cells.length) return [];
  const minX = Math.min(...cells.map((c) => c.x));
  const minZ = Math.min(...cells.map((c) => c.z));
  return cells.map((c) => ({
    x: c.x - minX,
    z: c.z - minZ,
    height: c.height,
  }));
}

/**
 * Rotate a building in place by 90° steps (clockwise from above).
 * Keeps the footprint centered on its previous center. Returns null if
 * the result would leave the grid or overlap another building.
 */
export function rotateBuilding(
  map: TownMap,
  buildingId: string,
  quarterTurns: number
): TownMap | null {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return map;

  const next = structuredClone(map);
  const b = next.buildings.find((bb) => bb.id === buildingId);
  if (!b || !b.cells.length) return null;

  // Visual centre in world grid units (what the renderer pivots around).
  const oldCenter = buildingFootprintCenter(b);

  // Rotate the plan about the origin: (x, z) -> (z, -x) per quarter turn,
  // then renormalise to a non-negative footprint.
  let rotated = normalizeStackCells(b.cells);
  for (let i = 0; i < turns; i++) {
    rotated = normalizeStackCells(
      rotated.map((c) => ({ x: c.z, z: -c.x, height: c.height }))
    );
  }

  // Re-anchor near the old centre with integer cells, then use the
  // fractional offset to keep the visual centre exactly where it was.
  // Buildings are free-placed, so no bounds / overlap gate and roads stay.
  const rw = Math.max(...rotated.map((c) => c.x)) + 1;
  const rd = Math.max(...rotated.map((c) => c.z)) + 1;
  const newMinX = Math.round(oldCenter.x - rw / 2);
  const newMinZ = Math.round(oldCenter.z - rd / 2);
  b.cells = rotated.map((c) => ({
    x: newMinX + c.x,
    z: newMinZ + c.z,
    height: c.height,
  }));
  b.offsetX = 0;
  b.offsetZ = 0;
  const rawCenter = buildingFootprintCenter(b);
  b.offsetX = oldCenter.x - rawCenter.x;
  b.offsetZ = oldCenter.z - rawCenter.z;

  // Carry the hospital cross around with the plan.
  if (b.crossX !== undefined && b.crossZ !== undefined) {
    let dx = b.crossX - oldCenter.x;
    let dz = b.crossZ - oldCenter.z;
    for (let i = 0; i < turns; i++) {
      const nx = dz;
      const nz = -dx;
      dx = nx;
      dz = nz;
    }
    b.crossX = oldCenter.x + dx;
    b.crossZ = oldCenter.z + dz;
  }
  return next;
}

/** Nudge one cell's stack height by delta. Removes cell if height drops below 1. */
export function nudgeStackHeight(
  map: TownMap,
  x: number,
  z: number,
  delta: number
): TownMap {
  const next = structuredClone(map);
  for (const b of next.buildings) {
    const cell = b.cells.find((c) => c.x === x && c.z === z);
    if (!cell) continue;
    cell.height = Math.max(0, Math.min(8, cell.height + delta));
    if (cell.height < 1) {
      b.cells = b.cells.filter((c) => !(c.x === x && c.z === z));
    }
  }
  next.buildings = next.buildings.filter((b) => b.cells.length > 0);
  return next;
}

/** Remove vehicle / bush / light / building cell / road at a cell. */
export function eraseEverythingAt(
  map: TownMap,
  x: number,
  z: number
): TownMap {
  let next = eraseCell(map, x, z);
  next.vehicles = next.vehicles.filter(
    (v) => Math.floor(v.x) !== x || Math.floor(v.z) !== z
  );
  next.bushes = next.bushes.filter(
    (b) => Math.floor(b.x) !== x || Math.floor(b.z) !== z
  );
  return next;
}

export type PieceKind = "building" | "vehicle" | "light" | "bush" | "road";

export interface PieceRef {
  kind: PieceKind;
  id: string;
}

/** Prefer building, then vehicle, light, road, bush. */
export function findPieceAt(
  map: TownMap,
  x: number,
  z: number
): PieceRef | null {
  const b = findBuildingAt(map, x, z);
  if (b) return { kind: "building", id: b.id };
  const v = map.vehicles.find(
    (vv) => Math.floor(vv.x) === x && Math.floor(vv.z) === z
  );
  if (v) return { kind: "vehicle", id: v.id };
  const l = findLightAt(map, x, z);
  if (l) return { kind: "light", id: l.id };
  const road = findRoadAt(map, x, z);
  if (road) return { kind: "road", id: normalizeRoad(road).id };
  const bush = map.bushes.find(
    (bb) => Math.floor(bb.x) === x && Math.floor(bb.z) === z
  );
  if (bush) return { kind: "bush", id: bush.id };
  return null;
}

function inBounds(map: TownMap, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < map.meta.cols && z < map.meta.rows;
}

/** Allow free placement anywhere on / slightly past the map edge. */
function inBoundsLoose(map: TownMap, x: number, z: number): boolean {
  return x >= -1 && z >= -1 && x < map.meta.cols + 1 && z < map.meta.rows + 1;
}

/**
 * Translate a building by dx,dz in grid units (fractional OK).
 * Updates free-move offset — plan cells are not rewritten.
 */
export function moveBuilding(
  map: TownMap,
  buildingId: string,
  dx: number,
  dz: number
): TownMap | null {
  if (dx === 0 && dz === 0) return map;
  const next = structuredClone(map);
  const b = next.buildings.find((bb) => bb.id === buildingId);
  if (!b) return null;

  const ox = (b.offsetX ?? 0) + dx;
  const oz = (b.offsetZ ?? 0) + dz;
  for (const c of b.cells) {
    if (!inBoundsLoose(next, c.x + ox, c.z + oz)) return null;
  }

  b.offsetX = ox;
  b.offsetZ = oz;

  const targets = new Set(
    b.cells.map((c) => {
      const p = buildingCellPos(b, c);
      return `${Math.floor(p.x)},${Math.floor(p.z)}`;
    })
  );
  removeRoadsOnCells(next, targets);
  return next;
}

export function moveVehicle(
  map: TownMap,
  vehicleId: string,
  dx: number,
  dz: number
): TownMap | null {
  if (dx === 0 && dz === 0) return map;
  const next = structuredClone(map);
  const v = next.vehicles.find((vv) => vv.id === vehicleId);
  if (!v) return null;
  const nx = v.x + dx;
  const nz = v.z + dz;
  if (!inBoundsLoose(next, nx, nz)) return null;
  v.x = nx;
  v.z = nz;
  return next;
}

export function moveStreetLight(
  map: TownMap,
  lightId: string,
  dx: number,
  dz: number
): TownMap | null {
  if (dx === 0 && dz === 0) return map;
  const next = structuredClone(map);
  const l = next.streetLights.find((ll) => ll.id === lightId);
  if (!l) return null;
  const nx = l.x + dx;
  const nz = l.z + dz;
  if (!inBoundsLoose(next, nx, nz)) return null;
  l.x = nx;
  l.z = nz;
  return next;
}

export function moveBush(
  map: TownMap,
  bushId: string,
  dx: number,
  dz: number
): TownMap | null {
  if (dx === 0 && dz === 0) return map;
  const next = structuredClone(map);
  const b = next.bushes.find((bb) => bb.id === bushId);
  if (!b) return null;
  const nx = b.x + dx;
  const nz = b.z + dz;
  if (!inBoundsLoose(next, nx, nz)) return null;
  b.x = nx;
  b.z = nz;
  return next;
}

export function moveRoad(
  map: TownMap,
  roadId: string,
  dx: number,
  dz: number
): TownMap | null {
  if (dx === 0 && dz === 0) return map;
  const next = structuredClone(map);
  next.roads = next.roads.map((r, i) => normalizeRoad(r, i));
  const r = next.roads.find((rr) => rr.id === roadId);
  if (!r) return null;
  const nx = r.x + dx;
  const nz = r.z + dz;
  if (!inBoundsLoose(next, nx, nz)) return null;
  r.x = nx;
  r.z = nz;
  return next;
}

/** Uniformly scale road width & length. */
export function scaleRoad(
  map: TownMap,
  roadId: string,
  relativeFactor: number
): TownMap | null {
  return scaleRoadAxes(map, roadId, relativeFactor, relativeFactor);
}

/** Stretch road independently on width (local X) and length (local Z). */
export function scaleRoadAxes(
  map: TownMap,
  roadId: string,
  widthFactor: number,
  lengthFactor: number
): TownMap | null {
  if (
    !Number.isFinite(widthFactor) ||
    !Number.isFinite(lengthFactor) ||
    widthFactor <= 0 ||
    lengthFactor <= 0
  ) {
    return null;
  }
  const next = structuredClone(map);
  next.roads = next.roads.map((r, i) => normalizeRoad(r, i));
  const r = next.roads.find((rr) => rr.id === roadId);
  if (!r) return null;
  const nw = Math.max(
    0.15,
    Math.min(20, Math.round((r.width ?? 1) * widthFactor * 100) / 100)
  );
  const nl = Math.max(
    0.15,
    Math.min(80, Math.round((r.length ?? 1) * lengthFactor * 100) / 100)
  );
  if (
    Math.abs(nw - (r.width ?? 1)) < 0.001 &&
    Math.abs(nl - (r.length ?? 1)) < 0.001
  ) {
    return map;
  }
  r.width = nw;
  r.length = nl;
  return next;
}

export function setRoadWidth(
  map: TownMap,
  roadId: string,
  width: number
): TownMap | null {
  if (!Number.isFinite(width) || width <= 0) return null;
  const next = structuredClone(map);
  next.roads = next.roads.map((r, i) => normalizeRoad(r, i));
  const r = next.roads.find((rr) => rr.id === roadId);
  if (!r) return null;
  r.width = Math.max(0.15, Math.min(20, width));
  return next;
}

/** Endpoints + closest point on an existing road centerline (grid units). */
export function roadSnapCandidates(road: Road): {
  ends: { x: number; z: number }[];
  project(px: number, pz: number): { x: number; z: number; dist: number };
} {
  const r = normalizeRoad(road);
  const halfL = (r.length ?? 1) / 2;
  const rad = ((r.rotation ?? 0) * Math.PI) / 180;
  // Length axis: 0° → −Z
  const dirX = Math.sin(rad);
  const dirZ = -Math.cos(rad);
  const endA = { x: r.x - dirX * halfL, z: r.z - dirZ * halfL };
  const endB = { x: r.x + dirX * halfL, z: r.z + dirZ * halfL };
  return {
    ends: [endA, endB],
    project(px: number, pz: number) {
      const abx = endB.x - endA.x;
      const abz = endB.z - endA.z;
      const apx = px - endA.x;
      const apz = pz - endA.z;
      const ab2 = abx * abx + abz * abz;
      const t =
        ab2 < 1e-8 ? 0 : Math.max(0, Math.min(1, (apx * abx + apz * abz) / ab2));
      const x = endA.x + abx * t;
      const z = endA.z + abz * t;
      return { x, z, dist: Math.hypot(px - x, pz - z) };
    },
  };
}

/**
 * Snap a cursor to the nearest existing road (endpoint preferred, then
 * centerline). Returns null if nothing within `radius` grid units.
 */
export function snapToRoadNetwork(
  map: TownMap,
  x: number,
  z: number,
  radius = 0.55
): { x: number; z: number; kind: "end" | "edge" } | null {
  let best: { x: number; z: number; kind: "end" | "edge"; dist: number } | null =
    null;
  for (const raw of map.roads) {
    const snap = roadSnapCandidates(raw);
    for (const e of snap.ends) {
      const d = Math.hypot(e.x - x, e.z - z);
      if (d <= radius && (!best || d < best.dist)) {
        best = { x: e.x, z: e.z, kind: "end", dist: d };
      }
    }
    const p = snap.project(x, z);
    if (p.dist <= radius && (!best || p.dist < best.dist * 0.85)) {
      // Prefer endpoints slightly; edge wins only if clearly closer.
      if (!best || p.dist < best.dist - 0.05 || best.kind === "edge") {
        best = { x: p.x, z: p.z, kind: "edge", dist: p.dist };
      }
    }
  }
  return best ? { x: best.x, z: best.z, kind: best.kind } : null;
}

/**
 * Lay a polyline road: one segment per consecutive pair of points, plus a
 * square junction pad at each vertex so corners and joins look seamless.
 * Segment length is extended by `width` so boxes overlap at joints.
 */
export function createRoadsFromPath(
  map: TownMap,
  points: { x: number; z: number }[],
  width = 1
): TownMap | null {
  if (points.length < 2) return null;
  const w = Math.max(0.15, Math.min(20, width));
  const next = structuredClone(map);
  let added = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) continue;
    // Overlap neighbors by ~width so joins read as one continuous ribbon.
    const len = dist + w;
    const rotation = (Math.atan2(dx, -dz) * 180) / Math.PI;
    next.roads.push({
      id: uid("road"),
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      width: w,
      length: len,
      rotation: ((rotation % 360) + 360) % 360,
    });
    added += 1;
  }

  // Junction pads fill corner wedges and blend into snapped existing roads.
  for (const p of points) {
    next.roads.push({
      id: uid("road"),
      x: p.x,
      z: p.z,
      width: w,
      length: w,
      rotation: 0,
    });
    added += 1;
  }

  if (!added) return null;
  return next;
}

export function movePiece(
  map: TownMap,
  piece: PieceRef,
  dx: number,
  dz: number
): TownMap | null {
  switch (piece.kind) {
    case "building":
      return moveBuilding(map, piece.id, dx, dz);
    case "vehicle":
      return moveVehicle(map, piece.id, dx, dz);
    case "light":
      return moveStreetLight(map, piece.id, dx, dz);
    case "bush":
      return moveBush(map, piece.id, dx, dz);
    case "road":
      return moveRoad(map, piece.id, dx, dz);
  }
}

/** Remove buildings, vehicles, lights, and bushes. Roads and meta stay. */
export function clearAllModels(map: TownMap): TownMap {
  const next = structuredClone(map);
  next.buildings = [];
  next.vehicles = [];
  next.streetLights = [];
  next.bushes = [];
  return next;
}

export function deletePiece(map: TownMap, piece: PieceRef): TownMap {
  const next = structuredClone(map);
  switch (piece.kind) {
    case "building":
      next.buildings = next.buildings.filter((b) => b.id !== piece.id);
      break;
    case "vehicle":
      next.vehicles = next.vehicles.filter((v) => v.id !== piece.id);
      break;
    case "light":
      next.streetLights = next.streetLights.filter((l) => l.id !== piece.id);
      break;
    case "bush":
      next.bushes = next.bushes.filter((b) => b.id !== piece.id);
      break;
    case "road":
      next.roads = next.roads.filter((r) => normalizeRoad(r).id !== piece.id);
      break;
  }
  return next;
}

export function parseMapJson(raw: string): TownMap {
  const data = JSON.parse(raw) as TownMap;
  if (!data.meta || !Array.isArray(data.buildings)) {
    throw new Error("Invalid map JSON");
  }
  data.roads ??= [];
  data.buildings ??= [];
  data.vehicles ??= [];
  data.streetLights ??= [];
  data.bushes ??= [];
  return normalizeRoads(data);
}

export function serializeMap(map: TownMap): string {
  return JSON.stringify(map, null, 2);
}
