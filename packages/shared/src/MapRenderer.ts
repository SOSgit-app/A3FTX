import * as THREE from "three";
import {
  BUILDING_HEX,
  type Building,
  type TownMap,
  type Vehicle,
} from "./types.js";
import {
  buildingFootprintCenter,
  buildingRoofHeightAt,
  DEFAULT_VEHICLE_SCALE,
} from "./mapOps.js";

const ROAD_COLOR = 0xb0b0b0;
const SAND_COLOR = 0xc2a66a;
const BLOCK_EDGE = 0x111111;

// Shared vehicle part materials
const GLASS_MAT = new THREE.MeshStandardMaterial({
  color: 0x1c2a36,
  roughness: 0.15,
  metalness: 0.4,
});
const TIRE_MAT = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
const RIM_MAT = new THREE.MeshStandardMaterial({
  color: 0xb8b8b8,
  roughness: 0.35,
  metalness: 0.7,
});
const TRIM_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
const CHROME_MAT = new THREE.MeshStandardMaterial({
  color: 0xd9d9d9,
  roughness: 0.25,
  metalness: 0.8,
});
const HEADLIGHT_MAT = new THREE.MeshStandardMaterial({
  color: 0xfff6d0,
  emissive: 0xfff1b0,
  emissiveIntensity: 0.9,
});
const TAILLIGHT_MAT = new THREE.MeshStandardMaterial({
  color: 0xff3b2f,
  emissive: 0xb01010,
  emissiveIntensity: 0.8,
});
const STRIPE_MAT = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

function boxMesh(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return shadowed(m);
}

/** Wheel with tire + rim, axle along X. */
function wheelMesh(radius: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 18),
    TIRE_MAT
  );
  tire.rotation.z = Math.PI / 2;
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.04, 12),
    RIM_MAT
  );
  rim.rotation.z = Math.PI / 2;
  g.add(shadowed(tire), rim);
  return g;
}

function addWheels(
  parent: THREE.Object3D,
  halfW: number,
  zs: number[],
  radius: number,
  width: number
): void {
  for (const z of zs) {
    for (const side of [-1, 1]) {
      const w = wheelMesh(radius, width);
      w.position.set(side * halfW, radius, z);
      parent.add(w);
    }
  }
}

/** Triangular gable prism: width across X, height up Y, length along Z. */
function gableRoofGeometry(
  width: number,
  height: number,
  length: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: false,
  });
  geo.translate(0, 0, -length / 2);
  geo.computeVertexNormals();
  return geo;
}

export interface MapRendererOptions {
  /** Parent group; if omitted a new Group is created. */
  parent?: THREE.Object3D;
  /** Show thin grid helper under the town. */
  showGrid?: boolean;
  /** Outline each building cube. */
  showEdges?: boolean;
}

/**
 * Builds a Three.js representation of a TownMap.
 * Coordinates: X east, −Z north, Y up. Cell (0,0) is the north-west corner.
 */
export class MapRenderer {
  readonly root = new THREE.Group();
  private content = new THREE.Group();
  private options: Required<Pick<MapRendererOptions, "showGrid" | "showEdges">>;

  constructor(options: MapRendererOptions = {}) {
    this.options = {
      showGrid: options.showGrid ?? false,
      showEdges: options.showEdges ?? true,
    };
    this.root.name = "TownMap";
    this.root.add(this.content);
    if (options.parent) options.parent.add(this.root);
  }

  dispose(): void {
    this.clearContent();
    this.root.removeFromParent();
  }

  setMap(map: TownMap): void {
    this.clearContent();
    const { cols, rows, cellSize } = map.meta;
    const ground = this.makeGround(cols, rows, cellSize);
    this.content.add(ground);

    if (this.options.showGrid) {
      const helper = new THREE.GridHelper(
        Math.max(cols, rows) * cellSize,
        Math.max(cols, rows),
        0x886644,
        0x886644
      );
      helper.position.set((cols * cellSize) / 2, 0.01, (rows * cellSize) / 2);
      this.content.add(helper);
    }

    for (const road of map.roads) {
      this.content.add(this.makeRoad(road, cellSize));
    }

    for (const building of map.buildings) {
      this.content.add(this.makeBuilding(building, cellSize));
    }

    for (const light of map.streetLights) {
      this.content.add(this.makeStreetLight(light, cellSize));
    }

    for (const vehicle of map.vehicles) {
      this.content.add(this.makeVehicle(vehicle, cellSize));
    }

    for (const bush of map.bushes) {
      this.content.add(
        this.makeBush(bush.x, bush.z, cellSize, bush.scale ?? 1)
      );
    }

    // North marker
    const n = this.makeNorthMarker(cols, rows, cellSize);
    this.content.add(n);
  }

  /** World center of the map for camera framing. */
  getCenter(map: TownMap): THREE.Vector3 {
    const { cols, rows, cellSize } = map.meta;
    return new THREE.Vector3(
      (cols * cellSize) / 2,
      0,
      (rows * cellSize) / 2
    );
  }

  private clearContent(): void {
    while (this.content.children.length) {
      const child = this.content.children[0];
      this.content.remove(child);
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
    }
  }

  private makeGround(cols: number, rows: number, cellSize: number): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(cols * cellSize, rows * cellSize);
    const mat = new THREE.MeshStandardMaterial({
      color: SAND_COLOR,
      roughness: 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((cols * cellSize) / 2, 0, (rows * cellSize) / 2);
    mesh.receiveShadow = true;
    mesh.name = "Ground";
    return mesh;
  }

  private makeRoad(
    road: { id?: string; x: number; z: number; width?: number; length?: number; rotation?: number },
    cellSize: number
  ): THREE.Mesh {
    // Full size (no 0.98 shrink) so path segments / junctions meet flush.
    const width = (road.width ?? 1) * cellSize;
    const length = (road.length ?? 1) * cellSize;
    const geo = new THREE.BoxGeometry(width, 0.04, length);
    const mat = new THREE.MeshStandardMaterial({
      color: ROAD_COLOR,
      roughness: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Legacy cell roads (no id): treat x,z as cell indices.
    const cx = road.id ? road.x * cellSize : road.x * cellSize + cellSize / 2;
    const cz = road.id ? road.z * cellSize : road.z * cellSize + cellSize / 2;
    mesh.position.set(cx, 0.02, cz);
    mesh.rotation.y = THREE.MathUtils.degToRad(road.rotation ?? 0);
    mesh.receiveShadow = true;
    mesh.name = `Road_${road.id ?? `${road.x}_${road.z}`}`;
    return mesh;
  }

  private makeBuilding(building: Building, cellSize: number): THREE.Group {
    const group = new THREE.Group();
    group.name = `Building_${building.id}`;
    const inner = new THREE.Group();
    const hex = BUILDING_HEX[building.color];
    const mat = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.7,
    });

    // Churches and mosques replace the block stack with a fitted model that
    // spans the footprint bounding box.
    const fitted =
      building.special === "church" || building.special === "mosque";
    const cellsToRender = fitted ? [] : building.cells;
    if (building.special === "church") {
      inner.add(this.makeChurch(building, mat, cellSize));
    } else if (building.special === "mosque") {
      inner.add(this.makeMosque(building, mat, cellSize));
    }

    for (const cell of cellsToRender) {
      const h = Math.max(1, cell.height);
      // Full cell size so adjacent cubes touch (no gap between blocks).
      const cubeSize = cellSize;
      for (let y = 0; y < h; y++) {
        const geo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(
          cell.x * cellSize + cellSize / 2,
          cubeSize / 2 + y * cubeSize,
          cell.z * cellSize + cellSize / 2
        );
        if (this.options.showEdges) {
          const edges = new THREE.EdgesGeometry(geo);
          const line = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: BLOCK_EDGE })
          );
          mesh.add(line);
        }
        inner.add(mesh);
      }
    }

    if (building.special === "hospital") {
      const cross = this.makeRedCross(cellSize);
      const ox = building.offsetX ?? 0;
      const oz = building.offsetZ ?? 0;
      // crossX/Z are world grid units; meshes in `inner` are pre-offset.
      let localX: number;
      let localZ: number;
      if (building.crossX != null && building.crossZ != null) {
        localX = building.crossX - ox;
        localZ = building.crossZ - oz;
      } else {
        const c = buildingFootprintCenter({
          ...building,
          offsetX: 0,
          offsetZ: 0,
        });
        localX = c.x;
        localZ = c.z;
      }
      const roofH = buildingRoofHeightAt(building, localX, localZ);
      // Sit flush on the roof so the mark touches the building.
      cross.position.set(localX * cellSize, roofH * cellSize, localZ * cellSize);
      inner.add(cross);
    }

    // Free-move offset + instance scale around footprint center.
    const ox = (building.offsetX ?? 0) * cellSize;
    const oz = (building.offsetZ ?? 0) * cellSize;
    let sx = 0;
    let sz = 0;
    let maxH = 1;
    for (const c of building.cells) {
      sx += c.x + 0.5;
      sz += c.z + 0.5;
      maxH = Math.max(maxH, c.height);
    }
    const n = Math.max(1, building.cells.length);
    const cx = (sx / n) * cellSize + ox;
    const cz = (sz / n) * cellSize + oz;
    const scale = building.scale ?? 1;
    inner.position.set(-(sx / n) * cellSize, 0, -(sz / n) * cellSize);
    group.position.set(cx, 0, cz);
    group.scale.setScalar(scale);
    group.rotation.y = THREE.MathUtils.degToRad(building.rotation ?? 0);
    group.add(inner);

    const labelText = (building.label ?? building.id)?.trim();
    if (labelText) {
      const label = this.makeBuildingLabel(labelText, cellSize);
      // Keep readable size when the building instance is scaled down.
      const inv = 1 / Math.max(scale, 0.05);
      label.scale.multiplyScalar(inv);
      // Steeples / minarets rise above the nominal block height.
      const topY =
        building.special === "church"
          ? maxH * cellSize * 1.1 + cellSize * 0.9
          : building.special === "mosque"
            ? maxH * cellSize * 1.35 + cellSize * 0.5
            : maxH * cellSize;
      label.position.set(0, topY + (cellSize * 0.35) / scale, 0);
      group.add(label);
    }

    return group;
  }

  private makeBuildingLabel(text: string, cellSize: number): THREE.Sprite {
    const shown = text.length > 14 ? `${text.slice(0, 13)}…` : text;
    const font = "bold 30px sans-serif";
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = font;
    const textW = Math.ceil(measure.measureText(shown).width);
    const padX = 10;
    const padY = 6;
    const boxH = 36;
    const boxW = textW + padX * 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(32, boxW);
    canvas.height = boxH + padY * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(20, 14, 8, 0.72)";
    const r = 6;
    const x0 = 0;
    const y0 = padY;
    const x1 = canvas.width;
    const y1 = padY + boxH;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x1, y0, x1, y1, r);
    ctx.arcTo(x1, y1, x0, y1, r);
    ctx.arcTo(x0, y1, x0, y0, r);
    ctx.arcTo(x0, y0, x1, y0, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff4d6";
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shown, canvas.width / 2, padY + boxH / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      })
    );
    const worldH = cellSize * 0.42;
    const worldW = worldH * (canvas.width / canvas.height);
    sprite.scale.set(worldW, worldH, 1);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 6;
    sprite.name = "BuildingLabel";
    return sprite;
  }

  private makeRedCross(cellSize: number): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe74c3c,
      roughness: 0.55,
    });
    // Overlapping bars share the center block so the plus is one connected mark.
    const arm = cellSize * 0.7;
    const thick = cellSize * 0.28;
    const depth = cellSize * 0.1;
    const barH = new THREE.Mesh(
      new THREE.BoxGeometry(arm, depth, thick),
      mat
    );
    const barV = new THREE.Mesh(
      new THREE.BoxGeometry(thick, depth, arm),
      mat
    );
    // Bottom of both bars at y=0 → flush against the roof.
    barH.position.y = depth / 2;
    barV.position.y = depth / 2;
    g.add(barH, barV);
    return g;
  }

  /**
   * Church fitted to the building footprint bounding box: nave with pitched
   * roof, arched windows, front doors, and a steeple with a cross at the
   * front end. Walls use the building color; roof is dark slate.
   */
  private makeChurch(
    building: Building,
    wallMat: THREE.Material,
    cellSize: number
  ): THREE.Group {
    const g = new THREE.Group();
    const cells = building.cells.length
      ? building.cells
      : [{ x: 0, z: 0, height: 1 }];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxH = 1;
    for (const c of cells) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z);
      maxZ = Math.max(maxZ, c.z);
      maxH = Math.max(maxH, c.height);
    }
    const spanX = (maxX - minX + 1) * cellSize;
    const spanZ = (maxZ - minZ + 1) * cellSize;
    const cx = minX * cellSize + spanX / 2;
    const cz = minZ * cellSize + spanZ / 2;
    g.position.set(cx, 0, cz);

    // Nave runs along the longer axis; front (entrance + steeple) at the −axis end.
    const alongZ = spanZ >= spanX;
    const naveLen = alongZ ? spanZ : spanX;
    const naveWid = alongZ ? spanX : spanZ;
    if (!alongZ) g.rotation.y = Math.PI / 2;

    const totalH = maxH * cellSize;
    const wallH = totalH * 0.55;
    const roofH = totalH * 0.45;
    const wallW = naveWid * 0.92;

    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3d4652, roughness: 0.85 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.9 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.8 });
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0x3f6fb0,
      emissive: 0x1d3c6c,
      emissiveIntensity: 0.4,
      roughness: 0.3,
    });
    const crossMat = new THREE.MeshStandardMaterial({
      color: 0xf2e9c8,
      roughness: 0.4,
      metalness: 0.3,
    });

    // Plinth / steps
    g.add(boxMesh(naveWid, cellSize * 0.06, naveLen, stoneMat, 0, cellSize * 0.03, 0));

    // Nave walls
    g.add(boxMesh(wallW, wallH, naveLen * 0.96, wallMat, 0, cellSize * 0.06 + wallH / 2, 0));

    // Pitched roof (overhangs walls slightly)
    const roof = new THREE.Mesh(
      gableRoofGeometry(wallW * 1.1, roofH, naveLen * 1.02),
      roofMat
    );
    roof.position.y = cellSize * 0.06 + wallH;
    g.add(shadowed(roof));
    // Ridge cap
    g.add(boxMesh(cellSize * 0.04, cellSize * 0.03, naveLen * 1.03, stoneMat, 0, cellSize * 0.06 + wallH + roofH, 0));

    // Arched side windows (box + half-cylinder top), evenly spaced
    const winW = Math.min(cellSize * 0.14, wallW * 0.15);
    const winH = wallH * 0.45;
    const winY = cellSize * 0.06 + wallH * 0.52;
    const winCount = Math.max(2, Math.floor(naveLen / (cellSize * 0.45)));
    const usable = naveLen * 0.8;
    for (let i = 0; i < winCount; i++) {
      const z = -usable / 2 + (usable / (winCount - 1)) * i;
      for (const s of [-1, 1]) {
        const x = s * (wallW / 2 + 0.004);
        g.add(boxMesh(0.008, winH, winW, windowMat, x, winY, z));
        const arch = new THREE.Mesh(
          new THREE.CylinderGeometry(winW / 2, winW / 2, 0.008, 12, 1, false, 0, Math.PI),
          windowMat
        );
        arch.rotation.z = Math.PI / 2;
        arch.rotation.y = s > 0 ? 0 : Math.PI;
        arch.position.set(x, winY + winH / 2, z);
        g.add(arch);
      }
    }

    // Front entrance: double doors + arch, framed in stone
    const frontZ = -naveLen * 0.48;
    const doorW = Math.min(cellSize * 0.26, wallW * 0.3);
    const doorH = wallH * 0.6;
    g.add(boxMesh(doorW * 1.3, doorH * 1.1, 0.01, stoneMat, 0, cellSize * 0.06 + doorH * 0.55, frontZ - 0.004));
    g.add(boxMesh(doorW, doorH, 0.012, doorMat, 0, cellSize * 0.06 + doorH / 2, frontZ - 0.01));
    g.add(boxMesh(0.006, doorH, 0.014, stoneMat, 0, cellSize * 0.06 + doorH / 2, frontZ - 0.012));
    const doorArch = new THREE.Mesh(
      new THREE.CylinderGeometry(doorW / 2, doorW / 2, 0.012, 14, 1, false, 0, Math.PI),
      doorMat
    );
    doorArch.rotation.x = Math.PI / 2;
    doorArch.rotation.z = Math.PI / 2;
    doorArch.position.set(0, cellSize * 0.06 + doorH, frontZ - 0.01);
    g.add(doorArch);

    // Rose window above the doors
    const rose = new THREE.Mesh(
      new THREE.CylinderGeometry(winW * 0.9, winW * 0.9, 0.01, 16),
      windowMat
    );
    rose.rotation.x = Math.PI / 2;
    rose.position.set(0, cellSize * 0.06 + wallH + roofH * 0.35, frontZ - 0.006);
    g.add(rose);

    // Steeple: tower straddling the front gable, belfry, spire, cross
    const towerW = Math.min(naveWid * 0.34, cellSize * 0.5);
    const towerH = wallH + roofH * 1.15;
    const towerZ = frontZ + towerW / 2 + cellSize * 0.04;
    const baseY = cellSize * 0.06;
    g.add(boxMesh(towerW, towerH, towerW, wallMat, 0, baseY + towerH / 2, towerZ));
    // Belfry openings
    const bellH = towerW * 0.45;
    const bellY = baseY + towerH - bellH * 0.75;
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.008, bellH, towerW * 0.35, TRIM_MAT, s * (towerW / 2 + 0.004), bellY, towerZ));
      g.add(boxMesh(towerW * 0.35, bellH, 0.008, TRIM_MAT, 0, bellY, towerZ + s * (towerW / 2 + 0.004)));
    }
    // Cornice
    g.add(boxMesh(towerW * 1.12, cellSize * 0.04, towerW * 1.12, stoneMat, 0, baseY + towerH, towerZ));
    // Spire
    const spireH = towerW * 1.6;
    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(towerW * 0.62, spireH, 4),
      roofMat
    );
    spire.rotation.y = Math.PI / 4;
    spire.position.set(0, baseY + towerH + spireH / 2, towerZ);
    g.add(shadowed(spire));
    // Cross
    const crossH = towerW * 0.5;
    const crossT = towerW * 0.07;
    const crossY = baseY + towerH + spireH;
    g.add(boxMesh(crossT, crossH, crossT, crossMat, 0, crossY + crossH / 2, towerZ));
    g.add(boxMesh(crossH * 0.6, crossT, crossT, crossMat, 0, crossY + crossH * 0.68, towerZ));

    return g;
  }

  /**
   * Mosque fitted to the footprint bounding box: prayer hall with a
   * crenellated parapet, a large central dome on a drum with four corner
   * domes, a pointed-arch entrance iwan on the front (−Z), arched side
   * windows, and two balconied minarets flanking the entrance, all topped
   * with gold crescent finials. Walls use the building color.
   */
  private makeMosque(
    building: Building,
    wallMat: THREE.Material,
    cellSize: number
  ): THREE.Group {
    const g = new THREE.Group();
    const cells = building.cells.length
      ? building.cells
      : [{ x: 0, z: 0, height: 1 }];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxH = 1;
    for (const c of cells) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z);
      maxZ = Math.max(maxZ, c.z);
      maxH = Math.max(maxH, c.height);
    }
    const spanX = (maxX - minX + 1) * cellSize;
    const spanZ = (maxZ - minZ + 1) * cellSize;
    g.position.set(minX * cellSize + spanX / 2, 0, minZ * cellSize + spanZ / 2);

    // Entrance on the −axis end of the longer side.
    const alongZ = spanZ >= spanX;
    const hallLen = alongZ ? spanZ : spanX; // along local Z
    const hallWid = alongZ ? spanX : spanZ; // along local X
    if (!alongZ) g.rotation.y = Math.PI / 2;

    const totalH = maxH * cellSize;
    const plinthH = cellSize * 0.06;
    const wallH = totalH * 0.5;
    const wallW = hallWid * 0.92;
    const wallD = hallLen * 0.94;
    const roofY = plinthH + wallH;

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc3, roughness: 0.9 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.7 });
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0x2f8f8a,
      roughness: 0.35,
      metalness: 0.15,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xe3b84a,
      roughness: 0.3,
      metalness: 0.8,
    });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a2f16, roughness: 0.8 });
    const shadowMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1 });
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0x3c7f9a,
      emissive: 0x1a3a4a,
      emissiveIntensity: 0.35,
      roughness: 0.3,
    });

    // Plinth + prayer hall
    g.add(boxMesh(hallWid, plinthH, hallLen, stoneMat, 0, plinthH / 2, 0));
    g.add(boxMesh(wallW, wallH, wallD, wallMat, 0, plinthH + wallH / 2, 0));
    // Decorative band near the top of the wall
    g.add(boxMesh(wallW * 1.01, cellSize * 0.035, wallD * 1.01, trimMat, 0, roofY - cellSize * 0.06, 0));
    // Flat roof slab + parapet with crenellations (merlons)
    g.add(boxMesh(wallW * 1.04, cellSize * 0.04, wallD * 1.04, stoneMat, 0, roofY + cellSize * 0.02, 0));
    const merlonW = cellSize * 0.09;
    const merlonH = cellSize * 0.07;
    const merlonGap = cellSize * 0.09;
    const addMerlons = (len: number, fixed: number, axis: "x" | "z"): void => {
      const n = Math.max(2, Math.floor(len / (merlonW + merlonGap)));
      const span = n * merlonW + (n - 1) * merlonGap;
      for (let i = 0; i < n; i++) {
        const t = -span / 2 + merlonW / 2 + i * (merlonW + merlonGap);
        if (axis === "x") {
          g.add(boxMesh(merlonW, merlonH, merlonW * 0.6, stoneMat, t, roofY + cellSize * 0.04 + merlonH / 2, fixed));
        } else {
          g.add(boxMesh(merlonW * 0.6, merlonH, merlonW, stoneMat, fixed, roofY + cellSize * 0.04 + merlonH / 2, t));
        }
      }
    };
    addMerlons(wallW, -wallD / 2 * 1.02, "x");
    addMerlons(wallW, wallD / 2 * 1.02, "x");
    addMerlons(wallD, -wallW / 2 * 1.02, "z");
    addMerlons(wallD, wallW / 2 * 1.02, "z");

    // Central dome on an octagonal drum, slightly onion-shaped
    const domeR = Math.min(wallW, wallD) * 0.3;
    const drumH = domeR * 0.45;
    // Octagon inscribed radius must exceed the dome's below-equator width.
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(domeR * 1.1, domeR * 1.14, drumH, 8),
      stoneMat
    );
    drum.position.set(0, roofY + cellSize * 0.04 + drumH / 2, hallLen * 0.04);
    g.add(shadowed(drum));
    // Drum windows
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const win = boxMesh(domeR * 0.22, drumH * 0.55, 0.01, windowMat, 0, 0, 0);
      win.position.set(
        Math.sin(a) * domeR * 1.125,
        drum.position.y,
        drum.position.z + Math.cos(a) * domeR * 1.125
      );
      win.rotation.y = a;
      g.add(win);
    }
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(domeR, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
      domeMat
    );
    dome.scale.set(1, 1.18, 1);
    dome.position.set(0, drum.position.y + drumH / 2 - domeR * 0.25, drum.position.z);
    g.add(shadowed(dome));
    const domeTop = dome.position.y + domeR * 1.18;
    g.add(this.makeCrescentFinial(domeR * 0.42, goldMat, 0, domeTop, drum.position.z));

    // Four small corner domes
    const smallR = domeR * 0.32;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (wallW / 2 - smallR * 1.3);
        const z = sz * (wallD / 2 - smallR * 1.3);
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(smallR * 1.1, smallR * 1.14, smallR * 0.5, 8),
          stoneMat
        );
        base.position.set(x, roofY + cellSize * 0.04 + smallR * 0.25, z);
        g.add(base);
        const sd = new THREE.Mesh(
          new THREE.SphereGeometry(smallR, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
          domeMat
        );
        sd.scale.set(1, 1.15, 1);
        sd.position.set(x, base.position.y + smallR * 0.25 - smallR * 0.2, z);
        g.add(shadowed(sd));
        g.add(this.makeCrescentFinial(smallR * 0.5, goldMat, x, sd.position.y + smallR * 1.15, z));
      }
    }

    // Entrance iwan: tall portal frame projecting from the front wall
    const frontZ = -wallD / 2;
    const iwanW = Math.min(wallW * 0.42, cellSize * 0.7);
    const iwanH = wallH * 1.12;
    const iwanD = cellSize * 0.08;
    g.add(boxMesh(iwanW, iwanH, iwanD, trimMat, 0, plinthH + iwanH / 2, frontZ - iwanD / 2));
    // Pointed-arch recess: dark inset + arch cap, with door at the bottom
    const archW = iwanW * 0.62;
    const recessH = iwanH * 0.68;
    g.add(boxMesh(archW, recessH, 0.012, shadowMat, 0, plinthH + recessH / 2, frontZ - iwanD - 0.004));
    const archCap = new THREE.Mesh(
      new THREE.CylinderGeometry(archW / 2, archW / 2, 0.012, 16, 1, false, 0, Math.PI),
      shadowMat
    );
    archCap.rotation.x = Math.PI / 2;
    archCap.rotation.z = Math.PI / 2;
    archCap.scale.set(1.25, 1, 1); // taller = pointed feel
    archCap.position.set(0, plinthH + recessH, frontZ - iwanD - 0.004);
    g.add(archCap);
    g.add(boxMesh(archW * 0.7, recessH * 0.55, 0.014, doorMat, 0, plinthH + recessH * 0.275, frontZ - iwanD - 0.008));
    g.add(boxMesh(0.006, recessH * 0.55, 0.016, trimMat, 0, plinthH + recessH * 0.275, frontZ - iwanD - 0.01));
    // Steps
    g.add(boxMesh(iwanW * 1.1, plinthH, cellSize * 0.12, stoneMat, 0, plinthH / 2, frontZ - iwanD - cellSize * 0.06));

    // Arched side windows
    const winW = Math.min(cellSize * 0.12, wallW * 0.12);
    const winH = wallH * 0.42;
    const winY = plinthH + wallH * 0.5;
    const winCount = Math.max(2, Math.floor(wallD / (cellSize * 0.4)));
    const usable = wallD * 0.78;
    for (let i = 0; i < winCount; i++) {
      const z = -usable / 2 + (usable / (winCount - 1)) * i;
      for (const s of [-1, 1]) {
        const x = s * (wallW / 2 + 0.004);
        g.add(boxMesh(0.008, winH, winW, windowMat, x, winY, z));
        const arch = new THREE.Mesh(
          new THREE.CylinderGeometry(winW / 2, winW / 2, 0.008, 12, 1, false, 0, Math.PI),
          windowMat
        );
        arch.rotation.z = Math.PI / 2;
        arch.rotation.y = s > 0 ? 0 : Math.PI;
        arch.scale.set(1.2, 1, 1);
        arch.position.set(x, winY + winH / 2, z);
        g.add(arch);
      }
    }
    // Rear (qibla) wall windows
    for (const s of [-1, 1]) {
      g.add(boxMesh(winW, winH, 0.008, windowMat, s * wallW * 0.25, winY, wallD / 2 + 0.004));
    }

    // Two minarets flanking the entrance
    const minR = Math.min(hallWid * 0.07, cellSize * 0.11);
    const minH = totalH * 1.35;
    for (const s of [-1, 1]) {
      const x = s * (wallW / 2 + minR * 0.9);
      const z = frontZ + minR * 1.2;
      g.add(this.makeMinaret(minR, minH, stoneMat, trimMat, domeMat, goldMat, x, plinthH, z));
    }

    return g;
  }

  /** Minaret: square base, round shaft, balcony, upper shaft, dome cap + crescent. */
  private makeMinaret(
    r: number,
    h: number,
    stone: THREE.Material,
    trim: THREE.Material,
    cap: THREE.Material,
    gold: THREE.Material,
    x: number,
    baseY: number,
    z: number
  ): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, baseY, z);
    const baseH = h * 0.18;
    g.add(boxMesh(r * 2.3, baseH, r * 2.3, stone, 0, baseH / 2, 0));
    const shaftH = h * 0.5;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, shaftH, 14), stone);
    shaft.position.y = baseH + shaftH / 2;
    g.add(shadowed(shaft));
    // Balcony with railing
    const balY = baseH + shaftH;
    const bal = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.6, r * 1.1, r * 0.5, 14), trim);
    bal.position.y = balY;
    g.add(bal);
    const railMat = (trim as THREE.MeshStandardMaterial).clone();
    railMat.side = THREE.DoubleSide;
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.6, r * 1.6, r * 0.45, 14, 1, true),
      railMat
    );
    rail.position.y = balY + r * 0.45;
    g.add(rail);
    // Upper shaft
    const upH = h * 0.22;
    const up = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.8, upH, 14), stone);
    up.position.y = balY + r * 0.25 + upH / 2;
    g.add(shadowed(up));
    // Small arched openings around the upper shaft
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const win = boxMesh(r * 0.3, upH * 0.4, 0.008, new THREE.MeshStandardMaterial({ color: 0x2a2420 }), 0, 0, 0);
      win.position.set(Math.sin(a) * r * 0.74, up.position.y + upH * 0.05, Math.cos(a) * r * 0.74);
      win.rotation.y = a;
      g.add(win);
    }
    // Cap: small dome + crescent
    const capY = up.position.y + upH / 2;
    const capDome = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.95, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
      cap
    );
    capDome.scale.set(1, 1.3, 1);
    capDome.position.y = capY - r * 0.2;
    g.add(shadowed(capDome));
    g.add(this.makeCrescentFinial(r * 0.9, gold, 0, capY - r * 0.2 + r * 0.95 * 1.3, 0));
    return g;
  }

  /** Gold finial: short spike with a crescent on top. `size` ≈ crescent height. */
  private makeCrescentFinial(
    size: number,
    gold: THREE.Material,
    x: number,
    y: number,
    z: number
  ): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const spikeH = size * 0.6;
    const spike = new THREE.Mesh(
      new THREE.CylinderGeometry(size * 0.05, size * 0.09, spikeH, 6),
      gold
    );
    spike.position.y = spikeH / 2;
    g.add(spike);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(size * 0.12, 8, 6), gold);
    ball.position.y = spikeH;
    g.add(ball);
    // Crescent: partial torus standing upright, opening upward
    const crescent = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.32, size * 0.06, 6, 20, Math.PI * 1.45),
      gold
    );
    crescent.rotation.z = Math.PI * 0.775; // centre the gap at the top
    crescent.position.y = spikeH + size * 0.4;
    g.add(crescent);
    return g;
  }

  private makeStreetLight(
    light: { id: string; x: number; z: number; scale?: number },
    cellSize: number
  ): THREE.Group {
    const g = new THREE.Group();
    g.name = `Light_${light.id}`;
    const inner = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, cellSize * 1.1, 6),
      new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    pole.position.y = cellSize * 0.55;
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffdd66,
        emissive: 0xffaa22,
        emissiveIntensity: 1.2,
      })
    );
    glow.position.y = cellSize * 1.05;
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(cellSize * 0.55, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffcc44,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.03;
    inner.add(pole, glow, pool);
    // Legacy integer cell coords (no scale) sat on cell centers.
    const legacy =
      light.scale == null &&
      Number.isInteger(light.x) &&
      Number.isInteger(light.z);
    const gx = legacy ? light.x + 0.5 : light.x;
    const gz = legacy ? light.z + 0.5 : light.z;
    g.position.set(gx * cellSize, 0, gz * cellSize);
    g.scale.setScalar(light.scale ?? 1);
    g.add(inner);
    return g;
  }

  /**
   * Vehicles are modelled in a unit frame (built at cellSize = 1) with the
   * front facing −Z, then scaled by cellSize. rotation 0 = facing north.
   */
  private makeVehicle(v: Vehicle, cellSize: number): THREE.Group {
    const g = new THREE.Group();
    g.name = `Vehicle_${v.id}`;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(v.color),
      roughness: 0.45,
      metalness: 0.15,
    });

    let model: THREE.Group;
    switch (v.type) {
      case "pickup":
        model = this.buildPickup(bodyMat);
        break;
      case "van":
        model = this.buildVan(bodyMat);
        break;
      case "schoolbus":
        model = this.buildSchoolBus(bodyMat);
        break;
      case "bus":
        model = this.buildCityBus(bodyMat);
        break;
      case "semi":
        model = this.buildSemi(bodyMat);
        break;
      default:
        model = this.buildSedan(bodyMat);
    }
    model.scale.setScalar(cellSize * (v.scale ?? DEFAULT_VEHICLE_SCALE));
    g.add(model);
    g.position.set(v.x * cellSize, 0, v.z * cellSize);
    g.rotation.y = THREE.MathUtils.degToRad(v.rotation);
    return g;
  }

  private buildPickup(body: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const W = 0.36;
    const L = 0.76;
    const wheelR = 0.075;
    const floorY = 0.1; // ground clearance

    // Frame / lower body
    g.add(boxMesh(W, 0.1, L, body, 0, floorY + 0.05, 0));
    // Hood (front, −Z)
    g.add(boxMesh(W * 0.98, 0.07, 0.24, body, 0, floorY + 0.135, -L / 2 + 0.12));
    // Grille + bumper
    g.add(boxMesh(W * 0.8, 0.07, 0.015, TRIM_MAT, 0, floorY + 0.075, -L / 2 - 0.005));
    g.add(boxMesh(W * 0.5, 0.045, 0.01, CHROME_MAT, 0, floorY + 0.12, -L / 2 - 0.01));
    g.add(boxMesh(W * 1.02, 0.03, 0.03, TRIM_MAT, 0, floorY + 0.03, -L / 2));
    g.add(boxMesh(W * 1.02, 0.03, 0.03, TRIM_MAT, 0, floorY + 0.03, L / 2));
    // Headlights / taillights
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.06, 0.03, 0.012, HEADLIGHT_MAT, s * (W / 2 - 0.05), floorY + 0.13, -L / 2 - 0.008));
      g.add(boxMesh(0.03, 0.05, 0.012, TAILLIGHT_MAT, s * (W / 2 - 0.03), floorY + 0.12, L / 2 + 0.006));
    }
    // Cab
    const cabD = 0.24;
    const cabZ = -L / 2 + 0.24 + cabD / 2;
    g.add(boxMesh(W * 0.94, 0.16, cabD, body, 0, floorY + 0.1 + 0.08, cabZ));
    // Glass band (windshield / side / rear)
    g.add(boxMesh(W * 0.96, 0.09, cabD * 0.9, GLASS_MAT, 0, floorY + 0.1 + 0.1, cabZ));
    // Pillars so glass reads as windows not a block
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.015, 0.1, 0.015, body, s * (W * 0.47), floorY + 0.2, cabZ - cabD / 2 + 0.01));
      g.add(boxMesh(0.015, 0.1, 0.015, body, s * (W * 0.47), floorY + 0.2, cabZ + cabD / 2 - 0.01));
    }
    // Roof
    g.add(boxMesh(W * 0.96, 0.02, cabD * 0.96, body, 0, floorY + 0.26, cabZ));
    // Bed: floor + side walls + tailgate, dark liner inside
    const bedZ0 = cabZ + cabD / 2;
    const bedD = L / 2 - bedZ0;
    const bedZ = bedZ0 + bedD / 2;
    g.add(boxMesh(W * 0.9, 0.02, bedD, TRIM_MAT, 0, floorY + 0.11, bedZ));
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.03, 0.1, bedD, body, s * (W / 2 - 0.015), floorY + 0.15, bedZ));
    }
    g.add(boxMesh(W, 0.1, 0.025, body, 0, floorY + 0.15, L / 2 - 0.0125));
    // Mirrors
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.035, 0.025, 0.02, TRIM_MAT, s * (W / 2 + 0.015), floorY + 0.2, cabZ - cabD / 2 + 0.03));
    }
    addWheels(g, W / 2, [-L / 2 + 0.15, L / 2 - 0.17], wheelR, 0.06);
    return g;
  }

  private buildVan(body: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const W = 0.38;
    const L = 0.8;
    const wheelR = 0.075;
    const floorY = 0.09;
    const H = 0.32;

    // Main box body
    g.add(boxMesh(W, H, L - 0.14, body, 0, floorY + H / 2, 0.07));
    // Short sloped nose
    g.add(boxMesh(W * 0.96, H * 0.5, 0.14, body, 0, floorY + H * 0.25, -L / 2 + 0.07));
    // Windshield (angled)
    const ws = boxMesh(W * 0.9, 0.16, 0.015, GLASS_MAT, 0, floorY + H * 0.68, -L / 2 + 0.14);
    ws.rotation.x = -0.45;
    g.add(ws);
    // Side windows: driver + rear panels
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.012, 0.11, 0.16, GLASS_MAT, s * (W / 2 + 0.002), floorY + H * 0.7, -L / 2 + 0.3));
      g.add(boxMesh(0.012, 0.1, 0.2, GLASS_MAT, s * (W / 2 + 0.002), floorY + H * 0.7, 0.04));
    }
    // Rear doors (seam) + rear window
    g.add(boxMesh(0.01, H * 0.85, 0.012, TRIM_MAT, 0, floorY + H * 0.5, L / 2 + 0.003));
    g.add(boxMesh(W * 0.8, 0.1, 0.012, GLASS_MAT, 0, floorY + H * 0.72, L / 2 + 0.004));
    // Roof rail
    g.add(boxMesh(W * 0.9, 0.012, L * 0.6, TRIM_MAT, 0, floorY + H + 0.006, 0.06));
    // Bumpers, grille, lights
    g.add(boxMesh(W * 1.02, 0.035, 0.03, TRIM_MAT, 0, floorY + 0.03, -L / 2));
    g.add(boxMesh(W * 1.02, 0.035, 0.03, TRIM_MAT, 0, floorY + 0.03, L / 2));
    g.add(boxMesh(W * 0.55, 0.05, 0.012, TRIM_MAT, 0, floorY + 0.09, -L / 2 - 0.006));
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.06, 0.035, 0.012, HEADLIGHT_MAT, s * (W / 2 - 0.05), floorY + 0.1, -L / 2 - 0.006));
      g.add(boxMesh(0.03, 0.08, 0.012, TAILLIGHT_MAT, s * (W / 2 - 0.03), floorY + H * 0.45, L / 2 + 0.006));
      g.add(boxMesh(0.035, 0.03, 0.02, TRIM_MAT, s * (W / 2 + 0.015), floorY + H * 0.65, -L / 2 + 0.18));
    }
    addWheels(g, W / 2, [-L / 2 + 0.16, L / 2 - 0.18], wheelR, 0.06);
    return g;
  }

  private buildSedan(body: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const W = 0.33;
    const L = 0.7;
    const wheelR = 0.065;
    const floorY = 0.085;

    // Lower body
    g.add(boxMesh(W, 0.09, L, body, 0, floorY + 0.045, 0));
    // Hood + trunk (slightly lower than cabin)
    g.add(boxMesh(W * 0.98, 0.035, 0.22, body, 0, floorY + 0.1075, -L / 2 + 0.11));
    g.add(boxMesh(W * 0.98, 0.035, 0.17, body, 0, floorY + 0.1075, L / 2 - 0.085));
    // Cabin (glass greenhouse with body-colored pillars + roof)
    const cabD = 0.3;
    const cabZ = -0.02;
    g.add(boxMesh(W * 0.88, 0.1, cabD, GLASS_MAT, 0, floorY + 0.09 + 0.05, cabZ));
    g.add(boxMesh(W * 0.9, 0.018, cabD * 0.92, body, 0, floorY + 0.19, cabZ));
    for (const s of [-1, 1]) {
      // A / B / C pillars
      const px = s * (W * 0.44);
      const a = boxMesh(0.014, 0.1, 0.014, body, px, floorY + 0.14, cabZ - cabD / 2 + 0.01);
      a.rotation.x = 0.35;
      g.add(a);
      g.add(boxMesh(0.014, 0.1, 0.014, body, px, floorY + 0.14, cabZ + 0.01));
      const c = boxMesh(0.014, 0.1, 0.014, body, px, floorY + 0.14, cabZ + cabD / 2 - 0.01);
      c.rotation.x = -0.3;
      g.add(c);
      // Door seam + handle
      g.add(boxMesh(0.008, 0.07, 0.004, TRIM_MAT, s * (W / 2 + 0.001), floorY + 0.05, cabZ + 0.01));
      g.add(boxMesh(0.006, 0.01, 0.03, CHROME_MAT, s * (W / 2 + 0.004), floorY + 0.075, cabZ - 0.06));
      g.add(boxMesh(0.03, 0.022, 0.02, TRIM_MAT, s * (W / 2 + 0.012), floorY + 0.12, cabZ - cabD / 2 + 0.03));
      // Lights
      g.add(boxMesh(0.055, 0.025, 0.012, HEADLIGHT_MAT, s * (W / 2 - 0.045), floorY + 0.085, -L / 2 - 0.006));
      g.add(boxMesh(0.05, 0.025, 0.012, TAILLIGHT_MAT, s * (W / 2 - 0.045), floorY + 0.085, L / 2 + 0.006));
    }
    // Grille, bumpers
    g.add(boxMesh(W * 0.45, 0.03, 0.012, TRIM_MAT, 0, floorY + 0.08, -L / 2 - 0.006));
    g.add(boxMesh(W * 1.02, 0.03, 0.025, TRIM_MAT, 0, floorY + 0.025, -L / 2));
    g.add(boxMesh(W * 1.02, 0.03, 0.025, TRIM_MAT, 0, floorY + 0.025, L / 2));
    addWheels(g, W / 2, [-L / 2 + 0.15, L / 2 - 0.15], wheelR, 0.055);
    return g;
  }

  private buildSchoolBus(body: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const W = 0.44;
    const L = 1.5;
    const H = 0.38;
    const wheelR = 0.095;
    const floorY = 0.12;
    const hoodD = 0.26;
    const bodyD = L - hoodD;
    const bodyZ = -L / 2 + hoodD + bodyD / 2;

    // Main body
    g.add(boxMesh(W, H, bodyD, body, 0, floorY + H / 2, bodyZ));
    // Slightly rounded roof cap
    g.add(boxMesh(W * 0.92, 0.03, bodyD * 0.98, body, 0, floorY + H + 0.015, bodyZ));
    // Conventional hood
    g.add(boxMesh(W * 0.9, H * 0.5, hoodD, body, 0, floorY + H * 0.25, -L / 2 + hoodD / 2));
    // Windshield (two panes)
    for (const s of [-1, 1]) {
      g.add(boxMesh(W * 0.42, H * 0.38, 0.012, GLASS_MAT, s * W * 0.23, floorY + H * 0.72, -L / 2 + hoodD - 0.006));
    }
    // Side windows: evenly spaced
    const winH = 0.12;
    const winD = 0.11;
    const gap = 0.045;
    const firstZ = -L / 2 + hoodD + 0.08;
    const count = Math.floor((bodyD - 0.16) / (winD + gap));
    for (let i = 0; i < count; i++) {
      const z = firstZ + i * (winD + gap) + winD / 2;
      for (const s of [-1, 1]) {
        g.add(boxMesh(0.012, winH, winD, GLASS_MAT, s * (W / 2 + 0.002), floorY + H * 0.68, z));
      }
    }
    // Rear emergency door window
    g.add(boxMesh(W * 0.4, winH, 0.012, GLASS_MAT, 0, floorY + H * 0.68, L / 2 + 0.004));
    g.add(boxMesh(0.008, H * 0.8, 0.014, TRIM_MAT, 0, floorY + H * 0.45, L / 2 + 0.004));
    // Black safety stripes
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.008, 0.018, bodyD * 0.98, STRIPE_MAT, s * (W / 2 + 0.004), floorY + H * 0.5, bodyZ));
      g.add(boxMesh(0.008, 0.018, bodyD * 0.98, STRIPE_MAT, s * (W / 2 + 0.004), floorY + H * 0.3, bodyZ));
    }
    // Entry door (right side, front)
    g.add(boxMesh(0.012, H * 0.8, 0.12, GLASS_MAT, W / 2 + 0.003, floorY + H * 0.5, -L / 2 + hoodD + 0.07));
    g.add(boxMesh(0.014, H * 0.8, 0.006, TRIM_MAT, W / 2 + 0.004, floorY + H * 0.5, -L / 2 + hoodD + 0.07));
    // Stop sign (left side)
    const sign = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.008, 8),
      new THREE.MeshStandardMaterial({ color: 0xd42020, roughness: 0.6 })
    );
    sign.rotation.z = Math.PI / 2;
    sign.position.set(-W / 2 - 0.05, floorY + H * 0.62, -L / 2 + hoodD + 0.2);
    g.add(sign);
    // Grille, bumpers, lights
    g.add(boxMesh(W * 0.5, H * 0.22, 0.012, TRIM_MAT, 0, floorY + H * 0.22, -L / 2 - 0.006));
    g.add(boxMesh(W * 1.04, 0.045, 0.035, TRIM_MAT, 0, floorY + 0.035, -L / 2));
    g.add(boxMesh(W * 1.04, 0.045, 0.035, TRIM_MAT, 0, floorY + 0.035, L / 2));
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.06, 0.045, 0.012, HEADLIGHT_MAT, s * (W / 2 - 0.06), floorY + H * 0.28, -L / 2 - 0.006));
      g.add(boxMesh(0.045, 0.045, 0.012, TAILLIGHT_MAT, s * (W / 2 - 0.05), floorY + H * 0.4, L / 2 + 0.006));
      // Roof warning lights (amber/red)
      g.add(boxMesh(0.03, 0.03, 0.03, TAILLIGHT_MAT, s * (W / 2 - 0.05), floorY + H + 0.045, -L / 2 + hoodD + 0.03));
      g.add(boxMesh(0.03, 0.03, 0.03, TAILLIGHT_MAT, s * (W / 2 - 0.05), floorY + H + 0.045, L / 2 - 0.03));
      // Mirrors (large crossview)
      g.add(boxMesh(0.05, 0.06, 0.02, TRIM_MAT, s * (W / 2 + 0.03), floorY + H * 0.75, -L / 2 + hoodD - 0.04));
    }
    addWheels(g, W / 2, [-L / 2 + 0.3, L / 2 - 0.35], wheelR, 0.075);
    return g;
  }

  private buildCityBus(body: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const W = 0.46;
    const L = 1.45;
    const H = 0.4;
    const wheelR = 0.09;
    const floorY = 0.11;
    g.add(boxMesh(W, H, L, body, 0, floorY + H / 2, 0));
    g.add(boxMesh(W * 0.95, 0.025, L * 0.98, body, 0, floorY + H + 0.0125, 0));
    // Big front windshield + rear window
    g.add(boxMesh(W * 0.92, H * 0.6, 0.012, GLASS_MAT, 0, floorY + H * 0.62, -L / 2 - 0.004));
    g.add(boxMesh(W * 0.8, H * 0.35, 0.012, GLASS_MAT, 0, floorY + H * 0.7, L / 2 + 0.004));
    // Continuous side glass band
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.012, H * 0.4, L * 0.9, GLASS_MAT, s * (W / 2 + 0.002), floorY + H * 0.66, 0.02));
      g.add(boxMesh(0.014, H * 0.8, 0.14, GLASS_MAT, s * (W / 2 + 0.003), floorY + H * 0.5, -L / 2 + 0.22));
    }
    g.add(boxMesh(W * 1.03, 0.04, 0.03, TRIM_MAT, 0, floorY + 0.03, -L / 2));
    g.add(boxMesh(W * 1.03, 0.04, 0.03, TRIM_MAT, 0, floorY + 0.03, L / 2));
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.06, 0.04, 0.012, HEADLIGHT_MAT, s * (W / 2 - 0.06), floorY + 0.1, -L / 2 - 0.006));
      g.add(boxMesh(0.04, 0.06, 0.012, TAILLIGHT_MAT, s * (W / 2 - 0.05), floorY + H * 0.35, L / 2 + 0.006));
    }
    addWheels(g, W / 2, [-L / 2 + 0.28, L / 2 - 0.32], wheelR, 0.07);
    return g;
  }

  private buildSemi(body: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const W = 0.42;
    const wheelR = 0.085;
    const floorY = 0.1;
    // Tractor
    const cabD = 0.42;
    const cabZ = -0.72;
    g.add(boxMesh(W * 0.95, 0.34, cabD, body, 0, floorY + 0.17, cabZ));
    g.add(boxMesh(W * 0.9, 0.16, 0.2, body, 0, floorY + 0.08, cabZ - cabD / 2 - 0.1));
    g.add(boxMesh(W * 0.9, 0.14, 0.012, GLASS_MAT, 0, floorY + 0.26, cabZ - cabD / 2 - 0.004));
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.012, 0.12, 0.2, GLASS_MAT, s * (W * 0.475 + 0.002), floorY + 0.26, cabZ - 0.06));
      g.add(boxMesh(0.05, 0.035, 0.012, HEADLIGHT_MAT, s * (W / 2 - 0.06), floorY + 0.09, cabZ - cabD / 2 - 0.2 - 0.006));
    }
    // Exhaust stacks
    for (const s of [-1, 1]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.4, 8), CHROME_MAT);
      stack.position.set(s * (W * 0.42), floorY + 0.34, cabZ + cabD / 2 + 0.02);
      g.add(stack);
    }
    // Trailer
    const trailerD = 1.1;
    const trailerZ = 0.16;
    const trailerMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.6 });
    g.add(boxMesh(W, 0.42, trailerD, trailerMat, 0, floorY + 0.12 + 0.21, trailerZ));
    g.add(boxMesh(W * 0.9, 0.06, trailerD * 0.95, TRIM_MAT, 0, floorY + 0.09, trailerZ));
    for (const s of [-1, 1]) {
      g.add(boxMesh(0.03, 0.06, 0.012, TAILLIGHT_MAT, s * (W / 2 - 0.04), floorY + 0.18, trailerZ + trailerD / 2 + 0.006));
    }
    addWheels(g, W / 2, [cabZ - 0.1, cabZ + 0.16, trailerZ + 0.3, trailerZ + 0.45], wheelR, 0.07);
    return g;
  }

  private makeBush(
    x: number,
    z: number,
    cellSize: number,
    scale: number
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(cellSize * 0.2 * scale, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 1 })
    );
    mesh.position.set(x * cellSize, cellSize * 0.12 * scale, z * cellSize);
    mesh.scale.y = 0.55;
    return mesh;
  }

  private makeNorthMarker(
    cols: number,
    rows: number,
    cellSize: number
  ): THREE.Group {
    const g = new THREE.Group();
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f1c40f";
    ctx.font = "bold 96px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true })
    );
    sprite.scale.set(cellSize * 1.2, cellSize * 1.2, 1);
    // North edge is z = 0
    sprite.position.set((cols * cellSize) / 2, cellSize * 0.8, -cellSize * 0.6);
    g.add(sprite);
    void rows;
    return g;
  }
}
