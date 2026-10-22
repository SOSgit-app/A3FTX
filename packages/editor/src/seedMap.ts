import type { Road, TownMap } from "@a3-ftx/shared";

/**
 * Seed layout derived from BirdsEyeView labels + NorthView heights.
 *
 * Grid: X = column number − 1 (1 west … 9 east)
 *       Z = row letter from north: A=0 (north) … K=10 (south)
 *
 * NOTE: the shapes below were authored with "+1 = north"; the whole map is
 * flipped at the end (flipZ) so it renders identically under the north=−Z rule.
 * This is a starting approximation — refine in the editor against the overlay.
 */
function lz(letter: string): number {
  // Authoring space: A=10 … K=0 (flipped afterwards)
  return "KJIHGFEDCBA".indexOf(letter.toUpperCase());
}

function cx(num: number): number {
  return num - 1;
}

/** Helper: 2×2 footprint at label cell, all same height. */
function sq2(
  letter: string,
  num: number,
  height: number
): { x: number; z: number; height: number }[] {
  const x = cx(num);
  const z = lz(letter);
  return [
    { x, z, height },
    { x: x + 1, z, height },
    { x, z: z + 1, height },
    { x: x + 1, z: z + 1, height },
  ];
}

let seedRoadSeq = 0;

/** One editable road corridor (not per-cell tiles). */
function rectRoad(
  x0: number,
  z0: number,
  x1: number,
  z1: number
): Road[] {
  const xmin = Math.min(x0, x1);
  const xmax = Math.max(x0, x1);
  const zmin = Math.min(z0, z1);
  const zmax = Math.max(z0, z1);
  seedRoadSeq += 1;
  if (zmin === zmax) {
    // East–west corridor
    return [
      {
        id: `seed_road_${seedRoadSeq}`,
        x: (xmin + xmax) / 2 + 0.5,
        z: zmin + 0.5,
        width: 1,
        length: xmax - xmin + 1,
        rotation: 90,
      },
    ];
  }
  // North–south corridor
  return [
    {
      id: `seed_road_${seedRoadSeq}`,
      x: xmin + 0.5,
      z: (zmin + zmax) / 2 + 0.5,
      width: 1,
      length: zmax - zmin + 1,
      rotation: 0,
    },
  ];
}

const AUTHORED: TownMap = {
  meta: {
    name: "Al-Rimal",
    version: 1,
    cols: 12,
    rows: 12,
    cellSize: 1,
    north: "negZ",
  },
  roads: [
    // Outer loop + internal grid (approximate from birds-eye)
    // Horizontal corridors (east-west) at z = 2,5,8
    ...rectRoad(1, 2, 10, 2),
    ...rectRoad(1, 5, 10, 5),
    ...rectRoad(1, 8, 10, 8),
    // Vertical corridors (north-south) at x = 2,5,8
    ...rectRoad(2, 1, 2, 10),
    ...rectRoad(5, 1, 5, 10),
    ...rectRoad(8, 1, 8, 10),
    // Western spur toward F1
    ...rectRoad(0, 5, 2, 5),
  ],
  buildings: [
    {
      id: "A5",
      label: "A5",
      color: "red",
      cells: sq2("A", 5, 2),
    },
    {
      id: "B9",
      label: "B9",
      color: "red",
      // L-shape
      cells: [
        { x: cx(9), z: lz("B"), height: 2 },
        { x: cx(9) + 1, z: lz("B"), height: 2 },
        { x: cx(9), z: lz("B") + 1, height: 2 },
      ],
    },
    {
      id: "B7",
      label: "B7",
      color: "green",
      cells: [
        { x: cx(7), z: lz("B"), height: 2 },
        { x: cx(7) + 1, z: lz("B"), height: 2 },
        { x: cx(7), z: lz("B") + 1, height: 2 },
      ],
    },
    {
      id: "C3",
      label: "C3",
      color: "blue",
      cells: [
        { x: cx(3), z: lz("C"), height: 2 },
        { x: cx(3) + 1, z: lz("C"), height: 2 },
        { x: cx(3), z: lz("C") + 1, height: 2 },
      ],
    },
    {
      id: "D5",
      label: "D5",
      color: "green",
      cells: sq2("D", 5, 2),
    },
    {
      id: "D7",
      label: "D7",
      color: "blue",
      cells: sq2("D", 7, 2),
    },
    {
      id: "E3",
      label: "E3",
      color: "green",
      special: "hospital",
      cells: sq2("E", 3, 2),
    },
    {
      id: "F1",
      label: "F1",
      color: "red",
      // Cross / plus at western spur (stays in-bounds)
      cells: [
        { x: 0, z: lz("F"), height: 2 },
        { x: 1, z: lz("F"), height: 2 },
        { x: 0, z: lz("F") - 1, height: 2 },
        { x: 0, z: lz("F") + 1, height: 2 },
        { x: 1, z: lz("F") + 1, height: 2 },
      ],
    },
    {
      id: "F4",
      label: "F4",
      color: "olive",
      cells: [
        { x: cx(4), z: lz("F"), height: 3 },
        { x: cx(4) + 1, z: lz("F"), height: 2 },
        { x: cx(4), z: lz("F") + 1, height: 2 },
        { x: cx(4) + 1, z: lz("F") + 1, height: 3 },
      ],
    },
    {
      id: "F8",
      label: "F8",
      color: "olive",
      cells: sq2("F", 8, 2),
    },
    {
      id: "G2",
      label: "G2",
      color: "olive",
      cells: [
        { x: cx(2), z: lz("G"), height: 4 },
        { x: cx(2) + 1, z: lz("G"), height: 3 },
        { x: cx(2), z: lz("G") + 1, height: 2 },
        { x: cx(2) + 1, z: lz("G") + 1, height: 2 },
      ],
    },
    {
      id: "H8",
      label: "H8",
      color: "olive",
      cells: sq2("H", 8, 2),
    },
    {
      id: "I4",
      label: "I4",
      color: "red",
      cells: [
        { x: cx(4), z: lz("I"), height: 2 },
        { x: cx(4) + 1, z: lz("I"), height: 2 },
        { x: cx(4), z: lz("I") + 1, height: 3 },
        { x: cx(4) + 1, z: lz("I") + 1, height: 2 },
      ],
    },
    {
      id: "J3",
      label: "J3",
      color: "green",
      cells: [
        { x: cx(3), z: lz("J"), height: 2 },
        { x: cx(3) + 1, z: lz("J"), height: 2 },
        { x: cx(3), z: lz("J") + 1, height: 3 },
        { x: cx(3) + 1, z: lz("J") + 1, height: 2 },
      ],
    },
    {
      id: "J7",
      label: "J7",
      color: "green",
      cells: [
        { x: cx(7), z: lz("J"), height: 4 },
        { x: cx(7), z: lz("J") + 1, height: 3 },
        { x: cx(7) + 1, z: lz("J") + 1, height: 2 },
      ],
    },
    {
      id: "K6",
      label: "K6",
      color: "yellow",
      cells: [
        { x: cx(6), z: lz("K"), height: 2 },
        { x: cx(6) + 1, z: lz("K"), height: 3 },
        { x: cx(6) + 2, z: lz("K"), height: 2 },
        { x: cx(6), z: lz("K") + 1, height: 2 },
        { x: cx(6) + 1, z: lz("K") + 1, height: 2 },
        { x: cx(6) + 2, z: lz("K") + 1, height: 3 },
      ],
    },
    {
      id: "STATION",
      label: "Station",
      color: "grey",
      special: "station",
      cells: [
        { x: 5, z: 6, height: 1 },
        { x: 6, z: 6, height: 1 },
        { x: 7, z: 6, height: 1 },
        { x: 6, z: 5, height: 1 },
        { x: 6, z: 7, height: 1 },
      ],
    },
    {
      id: "MOSQUE",
      label: "Mosque",
      color: "yellow",
      special: "mosque",
      cells: [{ x: cx(8), z: lz("B"), height: 1 }],
    },
  ],
  vehicles: [
    { id: "v1", type: "pickup", color: "#e67e22", x: 1.5, z: 5.5, rotation: 90 },
    { id: "v2", type: "pickup", color: "#e67e22", x: 5.5, z: 9.5, rotation: 0 },
    { id: "v3", type: "pickup", color: "#e67e22", x: 4.5, z: 2.5, rotation: 180 },
    { id: "v4", type: "pickup", color: "#e67e22", x: 8.5, z: 3.5, rotation: 90 },
    { id: "v5", type: "sedan", color: "#ecf0f1", x: 4.5, z: 5.5, rotation: 0 },
    { id: "v6", type: "sedan", color: "#ecf0f1", x: 7.5, z: 7.5, rotation: 90 },
    { id: "v7", type: "van", color: "#27ae60", x: 5.5, z: 8.5, rotation: 180 },
    { id: "v8", type: "van", color: "#27ae60", x: 7.5, z: 1.5, rotation: 0 },
    { id: "v9", type: "bus", color: "#f1c40f", x: 6.5, z: 6.5, rotation: 90 },
    { id: "v10", type: "semi", color: "#2c3e50", x: 5.5, z: 10.5, rotation: 0 },
    { id: "v11", type: "semi", color: "#3498db", x: 9.5, z: 1.5, rotation: 270 },
  ],
  streetLights: [
    { id: "l1", x: 5, z: 8 },
    { id: "l2", x: 5, z: 5 },
    { id: "l3", x: 8, z: 5 },
    { id: "l4", x: 2, z: 5 },
    { id: "l5", x: 8, z: 2 },
    { id: "l6", x: 5, z: 2 },
    { id: "l7", x: 2, z: 8 },
  ],
  bushes: [
    { id: "b1", x: 0.5, z: 10.5, scale: 1 },
    { id: "b2", x: 10.5, z: 9.5, scale: 0.9 },
    { id: "b3", x: 0.8, z: 1.2, scale: 1.1 },
    { id: "b4", x: 11, z: 0.5, scale: 0.8 },
    { id: "b5", x: 3.2, z: 11, scale: 1 },
  ],
};

/** Mirror the Z axis so authored "+Z = north" data obeys the north = −Z convention. */
function flipZ(map: TownMap): TownMap {
  const rows = map.meta.rows;
  const cellZ = (z: number) => rows - 1 - z;
  const posZ = (z: number) => rows - z;
  return {
    ...map,
    roads: map.roads.map((r) =>
      "id" in r && r.id
        ? { ...r, z: posZ(r.z) }
        : { ...r, z: cellZ(r.z) }
    ),
    buildings: map.buildings.map((b) => ({
      ...b,
      cells: b.cells.map((c) => ({ ...c, z: cellZ(c.z) })),
    })),
    vehicles: map.vehicles.map((v) => ({
      ...v,
      z: posZ(v.z),
      rotation: (180 - v.rotation + 360) % 360,
    })),
    streetLights: map.streetLights.map((l) => ({ ...l, z: cellZ(l.z) })),
    bushes: map.bushes.map((b) => ({ ...b, z: posZ(b.z) })),
  };
}

export const AL_RIMAL_SEED: TownMap = flipZ(AUTHORED);
