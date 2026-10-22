import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  MapRenderer,
  parseMapJson,
  serializeMap,
  paintBuildingStack,
  createRoadsFromPath,
  setRoadWidth,
  scaleRoadAxes,
  snapToRoadNetwork,
  placeStreetLight,
  placeVehicle,
  placeBush,
  findBuildingAt,
  setBuildingLabel,
  setBuildingSpecial,
  setHospitalCross,
  resizeBuildingHeight,
  scaleBuildingUniform,
  snapBuildingScale,
  scaleVehicleUniform,
  snapVehicleScale,
  DEFAULT_VEHICLE_SCALE,
  rotateBuildingBy,
  eraseEverythingAt,
  findPieceAt,
  movePiece,
  deletePiece,
  clearAllModels,
  BUILDING_HEX,
  rotateCells,
  normalizeCells,
  stampPreset,
  presetFromBuilding,
  presetExtent,
  DEFAULT_BUILDING_SCALE,
  VEHICLE_DEFAULT_COLOR,
  type BuildingColor,
  type BuildingPreset,
  type BuildingSpecial,
  type PieceRef,
  type TownMap,
  type VehicleType,
} from "@a3-ftx/shared";
import { AL_RIMAL_SEED } from "./seedMap";
import { MapHistory } from "./history";
import { loadPresets, savePresets, parsePresetsJson } from "./presetStore";
import { PlanDesigner } from "./planDesigner";

type Tool =
  | "building"
  | "preset"
  | "road"
  | "light"
  | "vehicle"
  | "bush"
  | "erase"
  | "select";

const COLOR_OPTIONS: { value: BuildingColor; label: string }[] = [
  { value: "red", label: "Red" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "olive", label: "Olive" },
  { value: "yellow", label: "Yellow" },
  { value: "grey", label: "Grey" },
];

const SPECIAL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "hospital", label: "Hospital (red cross)" },
  { value: "mosque", label: "Mosque" },
  { value: "church", label: "Church (steeple)" },
  { value: "station", label: "Station" },
];

function fillSelect(
  el: HTMLSelectElement,
  options: { value: string; label: string }[]
): void {
  el.innerHTML = "";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    el.appendChild(opt);
  }
}
document
  .querySelectorAll<HTMLSelectElement>("select.color-select")
  .forEach((el) => fillSelect(el, COLOR_OPTIONS));
document
  .querySelectorAll<HTMLSelectElement>("select.special-select")
  .forEach((el) => fillSelect(el, SPECIAL_OPTIONS));

// Picking a vehicle type sets its signature color (orange pickup, green van,
// grey car, yellow school bus); the color picker can still override it.
{
  const vehType = document.getElementById("veh-type") as HTMLSelectElement | null;
  const vehColor = document.getElementById("veh-color") as HTMLInputElement | null;
  if (vehType && vehColor) {
    const apply = (): void => {
      const c = VEHICLE_DEFAULT_COLOR[vehType.value as VehicleType];
      if (c) vehColor.value = c;
    };
    vehType.addEventListener("change", apply);
    apply();
  }
}

interface DragMove {
  piece: PieceRef;
  grabX: number;
  grabZ: number;
  origin: TownMap;
  lastDx: number;
  lastDz: number;
}

/** v3: editable road segments (id, size, rotation). */
const MAP_STORAGE_KEY = "al-rimal-map-v3";

function saveMap(m: TownMap): void {
  localStorage.setItem(MAP_STORAGE_KEY, serializeMap(m));
}

const viewport = document.getElementById("viewport")!;
const statusEl = document.getElementById("status")!;
const undoBtn = document.getElementById("btn-undo") as HTMLButtonElement;
const redoBtn = document.getElementById("btn-redo") as HTMLButtonElement;

let map: TownMap = structuredClone(AL_RIMAL_SEED);
let tool: Tool = "building";
let selected: PieceRef | null = null;
let painting = false;
let strokeCommitted = false;
let lastPaintCell: string | null = null;
let dragMove: DragMove | null = null;
/** Next map click places the hospital red cross on the selected building. */
let placeCrossMode = false;

/** Building plan library */
let presets: BuildingPreset[] = loadPresets();
let activePresetId: string | null = presets[0]?.id ?? null;
let presetRotation = 0;
/** Free cursor position for plan ghost / stamp (grid units, fractional). */
let ghostWorld: { x: number; z: number } | null = null;

/** Road path waypoints (grid units) while the Road path tool is active. */
let roadPathPoints: { x: number; z: number }[] = [];
const roadPathPreview = new THREE.Group();
roadPathPreview.name = "RoadPathPreview";

const history = new MapHistory();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2218);
scene.fog = new THREE.Fog(0x2a2218, 40, 80);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.mouseButtons = {
  LEFT: undefined as unknown as THREE.MOUSE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
};
controls.touches = {
  ONE: undefined as unknown as THREE.TOUCH,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

/** Pivot the TransformControls attach to (selection center). */
const gizmoPivot = new THREE.Object3D();
gizmoPivot.name = "GizmoPivot";
scene.add(gizmoPivot);

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setSize(0.85);
transformControls.setSpace("world");
scene.add(transformControls.getHelper());

type GizmoMode = "rotate" | "scale";
let gizmoMode: GizmoMode = "rotate";
/** Snapshot of heights / rotation when a gizmo drag starts. */
let gizmoDragStart: {
  piece: PieceRef;
  maxHeight: number;
  vehicleRot: number;
} | null = null;
/** Hidden source mesh while a live gizmo clone is shown. */
let liveSource: THREE.Object3D | null = null;
/** Clone parented under gizmoPivot so it follows rotate/scale live. */
let liveClone: THREE.Object3D | null = null;

transformControls.addEventListener("dragging-changed", (ev) => {
  const dragging = (ev as unknown as { value: boolean }).value;
  controls.enabled = !dragging;
  if (dragging) {
    beginGizmoDrag();
  } else {
    endGizmoDrag();
  }
});

/** Keep scale uniform for buildings; roads stretch width (X) / length (Z). */
transformControls.addEventListener("objectChange", () => {
  if (!transformControls.dragging || !gizmoDragStart) return;

  if (gizmoMode === "scale") {
    const sx = Math.max(0.15, Math.min(8, gizmoPivot.scale.x));
    const sy = Math.max(0.15, Math.min(8, gizmoPivot.scale.y));
    const sz = Math.max(0.15, Math.min(8, gizmoPivot.scale.z));
    if (gizmoDragStart.piece.kind === "road") {
      // X = width, Z = length; ignore Y (keep 1).
      gizmoPivot.scale.set(sx, 1, sz);
      setStatus(
        `Road stretch W×${sx.toFixed(2)} L×${sz.toFixed(2)} — release to apply`
      );
    } else {
      const dx = Math.abs(sx - 1);
      const dy = Math.abs(sy - 1);
      const dz = Math.abs(sz - 1);
      const s = dx >= dy && dx >= dz ? sx : dy >= dz ? sy : sz;
      const clamped = Math.max(0.2, Math.min(4.5, s));
      gizmoPivot.scale.set(clamped, clamped, clamped);
      if (gizmoDragStart.piece.kind === "vehicle") {
        const base =
          map.vehicles.find((vv) => vv.id === gizmoDragStart!.piece.id)
            ?.scale ?? DEFAULT_VEHICLE_SCALE;
        const next = snapVehicleScale(base * clamped);
        setStatus(`Vehicle size ${next.toFixed(2)}× — release to apply`);
      } else {
        const base =
          gizmoDragStart.piece.kind === "building"
            ? (map.buildings.find((bb) => bb.id === gizmoDragStart!.piece.id)
                ?.scale ?? 1)
            : 1;
        const next = snapBuildingScale(base * clamped);
        setStatus(
          `Scale ${next.toFixed(2)}× (plan unchanged) — release to apply`
        );
      }
    }
  } else {
    const yawDeg = THREE.MathUtils.radToDeg(gizmoPivot.rotation.y);
    const step = gizmoDragStart.piece.kind === "vehicle" ? 45 : 15;
    setStatus(
      `Rotating ${Math.round(yawDeg)}° → snap ${Math.round(yawDeg / step) * step}° — release to apply`
    );
  }
});

function setGizmoMode(mode: GizmoMode): void {
  gizmoMode = mode;
  document.querySelectorAll("#gizmo-modes button").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-gizmo") === mode);
  });
  const hint = document.getElementById("gizmo-hint");
  if (mode === "rotate") {
    transformControls.setMode("rotate");
    transformControls.showX = false;
    transformControls.showY = true;
    transformControls.showZ = false;
    if (hint) {
      hint.textContent =
        "Yellow ring = yaw. Buildings & roads snap to 15°, vehicles to 45°. Release to apply.";
    }
  } else {
    transformControls.setMode("scale");
    const roadSelected = selected?.kind === "road";
    transformControls.showX = true;
    transformControls.showY = !roadSelected;
    transformControls.showZ = true;
    if (hint) {
      hint.textContent = roadSelected
        ? "Road: X stretches width, Z stretches length."
        : selected?.kind === "vehicle"
          ? "Drag any axis — uniform vehicle size (0.05 steps)."
          : "Drag any axis — uniform size. Plan stays the same; snaps to 0.25 steps.";
    }
  }
  // Re-apply so handle visibility updates while attached
  if (selected) attachGizmo(selected);
}

function selectionWorldCenter(piece: PieceRef): THREE.Vector3 {
  const cs = map.meta.cellSize;
  if (piece.kind === "building") {
    const b = map.buildings.find((bb) => bb.id === piece.id);
    if (!b || !b.cells.length) return new THREE.Vector3();
    let sx = 0;
    let sz = 0;
    for (const c of b.cells) {
      sx += c.x + 0.5;
      sz += c.z + 0.5;
    }
    const n = b.cells.length;
    const ox = b.offsetX ?? 0;
    const oz = b.offsetZ ?? 0;
    // Ground-center so live rotate/scale stay planted.
    return new THREE.Vector3((sx / n + ox) * cs, 0, (sz / n + oz) * cs);
  }
  if (piece.kind === "vehicle") {
    const v = map.vehicles.find((vv) => vv.id === piece.id);
    if (!v) return new THREE.Vector3();
    return new THREE.Vector3(v.x * cs, 0, v.z * cs);
  }
  if (piece.kind === "light") {
    const l = map.streetLights.find((ll) => ll.id === piece.id);
    if (!l) return new THREE.Vector3();
    return new THREE.Vector3(l.x * cs, 0, l.z * cs);
  }
  if (piece.kind === "road") {
    const r = map.roads.find((rr) => rr.id === piece.id);
    if (!r) return new THREE.Vector3();
    return new THREE.Vector3(r.x * cs, 0, r.z * cs);
  }
  const bush = map.bushes.find((bb) => bb.id === piece.id);
  if (!bush) return new THREE.Vector3();
  return new THREE.Vector3(bush.x * cs, 0, bush.z * cs);
}

function findPieceObject(piece: PieceRef): THREE.Object3D | null {
  if (piece.kind === "building") {
    return mapRenderer.root.getObjectByName(`Building_${piece.id}`) ?? null;
  }
  if (piece.kind === "vehicle") {
    return mapRenderer.root.getObjectByName(`Vehicle_${piece.id}`) ?? null;
  }
  if (piece.kind === "road") {
    return mapRenderer.root.getObjectByName(`Road_${piece.id}`) ?? null;
  }
  return null;
}

function clearLivePreview(): void {
  if (liveClone) {
    liveClone.removeFromParent();
    liveClone = null;
  }
  if (liveSource) {
    liveSource.visible = true;
    liveSource = null;
  }
  if (selectionHighlight.parent === gizmoPivot) {
    scene.attach(selectionHighlight);
  }
  selectionHighlight.position.set(0, 0, 0);
  selectionHighlight.rotation.set(0, 0, 0);
  selectionHighlight.scale.set(1, 1, 1);
  selectionHighlight.visible = true;
}

/** Clone the selected mesh under the pivot so it transforms live while dragging. */
function startLivePreview(piece: PieceRef): void {
  clearLivePreview();
  const src = findPieceObject(piece);
  if (!src) return;

  src.updateMatrixWorld(true);
  const clone = src.clone(true);
  clone.matrix.copy(src.matrixWorld);
  clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
  clone.matrixAutoUpdate = true;
  scene.add(clone);
  gizmoPivot.attach(clone);

  liveClone = clone;
  liveSource = src;
  src.visible = false;

  if (selectionHighlight.children.length) {
    selectionHighlight.updateMatrixWorld(true);
    gizmoPivot.attach(selectionHighlight);
  }
}

function attachGizmo(piece: PieceRef | null): void {
  if (!piece) {
    clearLivePreview();
    transformControls.detach();
    gizmoPivot.rotation.set(0, 0, 0);
    gizmoPivot.scale.set(1, 1, 1);
    return;
  }
  const center = selectionWorldCenter(piece);
  gizmoPivot.position.copy(center);
  gizmoPivot.rotation.set(0, 0, 0);
  gizmoPivot.scale.set(1, 1, 1);
  // Align local X/Z with road width/length for stretch gizmo.
  if (piece.kind === "road") {
    const r = map.roads.find((rr) => rr.id === piece.id);
    if (r) {
      gizmoPivot.rotation.y = THREE.MathUtils.degToRad(r.rotation ?? 0);
    }
  }
  transformControls.attach(gizmoPivot);
  // Re-assert mode visibility (TransformControls can reset on attach)
  if (gizmoMode === "rotate") {
    transformControls.setMode("rotate");
    transformControls.setSpace("world");
    transformControls.showX = false;
    transformControls.showY = true;
    transformControls.showZ = false;
  } else {
    transformControls.setMode("scale");
    transformControls.setSpace(piece.kind === "road" ? "local" : "world");
    transformControls.showX = true;
    transformControls.showY = piece.kind !== "road";
    transformControls.showZ = true;
  }
}

function beginGizmoDrag(): void {
  if (!selected) return;
  let maxHeight = 2;
  let vehicleRot = 0;
  if (selected.kind === "building") {
    const b = map.buildings.find((bb) => bb.id === selected!.id);
    maxHeight = b ? Math.max(...b.cells.map((c) => c.height), 1) : 2;
  } else if (selected.kind === "vehicle") {
    const v = map.vehicles.find((vv) => vv.id === selected!.id);
    vehicleRot = v?.rotation ?? 0;
  } else if (selected.kind === "road") {
    const r = map.roads.find((rr) => rr.id === selected!.id);
    vehicleRot = r?.rotation ?? 0;
  }
  gizmoDragStart = { piece: { ...selected }, maxHeight, vehicleRot };
  startLivePreview(selected);
}

function endGizmoDrag(): void {
  if (!selected || !gizmoDragStart) {
    clearLivePreview();
    gizmoDragStart = null;
    attachGizmo(selected);
    return;
  }
  const piece = gizmoDragStart.piece;
  const yawRad = gizmoPivot.rotation.y;
  const yawDeg = THREE.MathUtils.radToDeg(yawRad);
  const scaleFactor =
    (gizmoPivot.scale.x + gizmoPivot.scale.y + gizmoPivot.scale.z) / 3;
  const vehicleRot = gizmoDragStart.vehicleRot;

  // Drop the live clone before commit/rebuild replaces scene meshes.
  clearLivePreview();
  gizmoDragStart = null;

  if (gizmoMode === "rotate") {
    // Yaw: TransformControls +Y rotation is applied directly as the
    // instance yaw (same convention as the renderer's group.rotation.y).
    if (piece.kind === "building") {
      const next = rotateBuildingBy(map, piece.id, yawDeg);
      if (next && next !== map) {
        const b = next.buildings.find((bb) => bb.id === piece.id);
        commit(next, `Rotated ${pieceLabel(piece)} to ${b?.rotation ?? 0}°`);
      } else {
        setStatus("Rotation under 7.5° — snapped back");
      }
    } else if (piece.kind === "vehicle") {
      const snapped = Math.round((vehicleRot + yawDeg) / 45) * 45;
      const next = structuredClone(map);
      const v = next.vehicles.find((vv) => vv.id === piece.id);
      if (v) {
        v.rotation = ((snapped % 360) + 360) % 360;
        commit(next, `Rotated vehicle to ${v.rotation}°`);
      }
    } else if (piece.kind === "road") {
      const snapped = Math.round((vehicleRot + yawDeg) / 15) * 15;
      const next = structuredClone(map);
      const r = next.roads.find((rr) => rr.id === piece.id);
      if (r) {
        r.rotation = ((snapped % 360) + 360) % 360;
        commit(next, `Rotated road to ${r.rotation}°`);
      }
    } else {
      setStatus("Rotate is for buildings, vehicles, and roads");
    }
  } else if (gizmoMode === "scale") {
    if (piece.kind === "building" && Math.abs(scaleFactor - 1) > 0.05) {
      const next = scaleBuildingUniform(map, piece.id, scaleFactor);
      if (next && next !== map) {
        const b = next.buildings.find((bb) => bb.id === piece.id);
        const s = b?.scale ?? 1;
        commit(next, `Scaled ${pieceLabel(piece)} to ${s.toFixed(2)}×`);
      } else {
        setStatus("Scale unchanged");
      }
    } else if (piece.kind === "vehicle" && Math.abs(scaleFactor - 1) > 0.03) {
      const next = scaleVehicleUniform(map, piece.id, scaleFactor);
      if (next && next !== map) {
        const v = next.vehicles.find((vv) => vv.id === piece.id);
        const s = v?.scale ?? DEFAULT_VEHICLE_SCALE;
        commit(next, `Vehicle size ${s.toFixed(2)}×`);
      } else {
        setStatus("Scale unchanged");
      }
    } else if (piece.kind === "road") {
      const wf = gizmoPivot.scale.x;
      const lf = gizmoPivot.scale.z;
      if (Math.abs(wf - 1) > 0.03 || Math.abs(lf - 1) > 0.03) {
        const next = scaleRoadAxes(map, piece.id, wf, lf);
        if (next && next !== map) {
          const r = next.roads.find((rr) => rr.id === piece.id);
          commit(
            next,
            `Road ${ (r?.width ?? 1).toFixed(2) } wide × ${ (r?.length ?? 1).toFixed(2) } long`
          );
        } else {
          setStatus("Scale unchanged");
        }
      }
    } else if (piece.kind === "light" || piece.kind === "bush") {
      setStatus("Scale is for buildings, vehicles and roads");
    }
  }

  // Reset pivot and reattach at new center
  attachGizmo(selected);
  refreshSelectionHighlight();
}

const hemi = new THREE.HemisphereLight(0xffe6c0, 0x443322, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d0, 1.1);
sun.position.set(12, 20, 8);
sun.castShadow = true;
scene.add(sun);

const mapRenderer = new MapRenderer({ parent: scene, showEdges: true });
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const refGroup = new THREE.Group();
scene.add(refGroup);
let refMesh: THREE.Mesh | null = null;

/** Translucent preview of the plan about to be stamped */
const ghost = new THREE.Group();
ghost.name = "Ghost";
scene.add(ghost);
scene.add(roadPathPreview);

/** Selection highlight (outline + ground pad) */
const selectionHighlight = new THREE.Group();
selectionHighlight.name = "SelectionHighlight";
scene.add(selectionHighlight);

function clearSelectionHighlight(): void {
  while (selectionHighlight.children.length) {
    const child = selectionHighlight.children[0];
    selectionHighlight.remove(child);
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
      else m.material?.dispose();
    });
  }
}

function makeOutlineMat(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: 0xffcc00,
    depthTest: false,
  });
}

function makePadMat(opacity = 0.55): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffcc00,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
  });
}

function makeGlowMat(opacity = 0.28): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffee66,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
}

function makeSelectionLabelSprite(
  text: string,
  x: number,
  y: number,
  z: number,
  cs: number
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(8, 8, 240, 48);
  ctx.fillStyle = "#ffcc00";
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 32);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthTest: false,
    })
  );
  sprite.scale.set(cs * 2.2, cs * 0.55, 1);
  sprite.position.set(x, y, z);
  sprite.renderOrder = 20;
  return sprite;
}

function addSelectionLabel(
  text: string,
  x: number,
  y: number,
  z: number,
  cs: number
): void {
  selectionHighlight.add(makeSelectionLabelSprite(text, x, y, z, cs));
}

function refreshSelectionHighlight(): void {
  clearSelectionHighlight();
  if (!selected) return;

  const cs = map.meta.cellSize;
  const outlineMat = makeOutlineMat();
  const padMat = makePadMat();
  const glowMat = makeGlowMat();

  if (selected.kind === "building") {
    const b = map.buildings.find((bb) => bb.id === selected!.id);
    if (!b) return;

    const highlightRoot = new THREE.Group();
    const highlightInner = new THREE.Group();

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxH = 1;
    let sx = 0;
    let sz = 0;

    const ox = (b.offsetX ?? 0) * cs;
    const oz = (b.offsetZ ?? 0) * cs;

    for (const c of b.cells) {
      const h = Math.max(1, c.height);
      maxH = Math.max(maxH, h);
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z);
      maxZ = Math.max(maxZ, c.z);
      sx += c.x + 0.5;
      sz += c.z + 0.5;

      const cube = cs;
      const boxH = h * cube;

      // Bright ground pad under each cell
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(cs * 1.05, cs * 1.05),
        padMat
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(c.x * cs + cs / 2, 0.08, c.z * cs + cs / 2);
      pad.renderOrder = 10;
      highlightInner.add(pad);

      // Outer wire box
      const boxGeo = new THREE.BoxGeometry(
        cube * 1.15,
        boxH * 1.08,
        cube * 1.15
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        outlineMat
      );
      edges.position.set(
        c.x * cs + cs / 2,
        boxH / 2 + 0.04,
        c.z * cs + cs / 2
      );
      edges.renderOrder = 11;
      highlightInner.add(edges);

      // Soft glow shell
      const shell = new THREE.Mesh(boxGeo, glowMat);
      shell.position.copy(edges.position);
      shell.renderOrder = 9;
      highlightInner.add(shell);
    }

    // Footprint border ring around the whole building
    const w = (maxX - minX + 1) * cs + cs * 0.2;
    const d = (maxZ - minZ + 1) * cs + cs * 0.2;
    const localCx = (sx / b.cells.length) * cs;
    const localCz = (sz / b.cells.length) * cs;
    const cx = localCx + ox;
    const cz = localCz + oz;
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.02, d)),
      outlineMat
    );
    border.position.set(
      ((minX + maxX) / 2 + 0.5) * cs,
      0.1,
      ((minZ + maxZ) / 2 + 0.5) * cs
    );
    border.renderOrder = 12;
    highlightInner.add(border);

    const label = makeSelectionLabelSprite(
      b.label ?? b.id,
      localCx,
      maxH * cs + cs * 0.7,
      localCz,
      cs
    );
    highlightInner.add(label);

    highlightInner.position.set(-localCx, 0, -localCz);
    highlightRoot.position.set(cx, 0, cz);
    highlightRoot.scale.setScalar(b.scale ?? 1);
    highlightRoot.rotation.y = THREE.MathUtils.degToRad(b.rotation ?? 0);
    highlightRoot.add(highlightInner);
    selectionHighlight.add(highlightRoot);
    return;
  }

  if (selected.kind === "road") {
    const r = map.roads.find((rr) => rr.id === selected!.id);
    if (!r) return;
    const w = (r.width ?? 1) * cs;
    const len = (r.length ?? 1) * cs;
    const x = r.x * cs;
    const z = r.z * cs;
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w * 1.05, 0.12, len * 1.05)),
      outlineMat
    );
    box.position.set(x, 0.1, z);
    box.rotation.y = THREE.MathUtils.degToRad(r.rotation ?? 0);
    box.renderOrder = 11;
    selectionHighlight.add(box);
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.02, len * 1.02),
      padMat
    );
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = THREE.MathUtils.degToRad(r.rotation ?? 0);
    pad.position.set(x, 0.08, z);
    pad.renderOrder = 10;
    selectionHighlight.add(pad);
    addSelectionLabel(
      `road ${Math.round(r.rotation ?? 0)}°`,
      x,
      cs * 0.8,
      z,
      cs
    );
    return;
  }

  // Vehicles / lights / bushes — ring + vertical marker
  let x = 0;
  let z = 0;
  let label: string = selected.kind;
  /** Marker size relative to a cell; shrinks with small vehicles. */
  let markerScale = 1;
  if (selected.kind === "vehicle") {
    const v = map.vehicles.find((vv) => vv.id === selected!.id);
    if (!v) return;
    x = v.x * cs;
    z = v.z * cs;
    label = v.type;
    markerScale = Math.max(0.35, Math.min(1, (v.scale ?? DEFAULT_VEHICLE_SCALE) * 2.5));
  } else if (selected.kind === "light") {
    const l = map.streetLights.find((ll) => ll.id === selected!.id);
    if (!l) return;
    x = l.x * cs;
    z = l.z * cs;
    label = "light";
  } else {
    const bush = map.bushes.find((bb) => bb.id === selected!.id);
    if (!bush) return;
    x = bush.x * cs;
    z = bush.z * cs;
    label = "bush";
  }

  const ms = cs * markerScale;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ms * 0.3, ms * 0.55, 32),
    padMat
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.1, z);
  ring.renderOrder = 10;
  selectionHighlight.add(ring);

  const pillar = new THREE.Mesh(
    new THREE.BoxGeometry(ms * 0.1, ms * 1.4, ms * 0.1),
    new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false })
  );
  pillar.position.set(x, ms * 0.7, z);
  pillar.renderOrder = 11;
  selectionHighlight.add(pillar);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(ms * 0.4, ms * 0.08, ms * 0.4),
    new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false })
  );
  top.position.set(x, ms * 1.4, z);
  top.renderOrder = 11;
  selectionHighlight.add(top);

  addSelectionLabel(label, x, ms * 1.8, z, cs);
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

// ---------- Building plans ----------

function activePreset(): BuildingPreset | null {
  return presets.find((p) => p.id === activePresetId) ?? null;
}

function persistPresets(): void {
  savePresets(presets);
  renderPresetList();
}

function renderPresetList(): void {
  const list = document.getElementById("preset-list")!;
  const select = document.getElementById("preset-select") as HTMLSelectElement;
  list.innerHTML = "";
  select.innerHTML = "";

  if (!presets.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No plans yet — click New plan.";
    list.appendChild(empty);
  }

  for (const p of presets) {
    const ext = presetExtent(p.cells);
    const maxH = Math.max(...p.cells.map((c) => c.height), 0);

    const item = document.createElement("button");
    item.type = "button";
    item.className = "preset-item" + (p.id === activePresetId ? " active" : "");
    item.dataset.id = p.id;
    const sw = document.createElement("span");
    sw.className = "preset-swatch";
    sw.style.background = BUILDING_HEX[p.defaultColor ?? "grey"];
    const name = document.createElement("span");
    name.textContent = p.name;
    const meta = document.createElement("span");
    meta.className = "preset-meta";
    meta.textContent = `${ext.w}×${ext.d} · h${maxH}`;
    item.append(sw, name, meta);
    item.addEventListener("click", () => {
      setActivePreset(p.id);
      selectTool("preset");
    });
    item.addEventListener("dblclick", () => designer.open(p));
    list.appendChild(item);

    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  }
  if (activePresetId) select.value = activePresetId;
}

function setActivePreset(id: string | null): void {
  activePresetId = id;
  const p = activePreset();
  if (p) {
    (document.getElementById("preset-color") as HTMLSelectElement).value =
      p.defaultColor ?? "red";
    (document.getElementById("preset-special") as HTMLSelectElement).value =
      p.special ?? "";
  }
  renderPresetList();
  refreshGhost();
}

function presetPlacementOptions() {
  return {
    color: (document.getElementById("preset-color") as HTMLSelectElement)
      .value as BuildingColor,
    label: (document.getElementById("preset-label") as HTMLInputElement).value,
    special: ((document.getElementById("preset-special") as HTMLSelectElement)
      .value || null) as BuildingSpecial,
    rotation: presetRotation,
  };
}

function clearGhost(): void {
  while (ghost.children.length) {
    const child = ghost.children[0];
    ghost.remove(child);
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
      else m.material?.dispose();
    });
  }
  ghost.position.set(0, 0, 0);
  ghost.scale.set(1, 1, 1);
}

function refreshGhost(): void {
  clearGhost();
  const p = activePreset();
  if (tool !== "preset" || !p || !ghostWorld) return;

  const cells = normalizePresetLocal(p);
  const color = presetPlacementOptions().color;
  const mat = new THREE.MeshStandardMaterial({
    color: BUILDING_HEX[color],
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const cs = map.meta.cellSize;
  const size = cs;
  const geo = new THREE.BoxGeometry(size, size, size);
  const edges = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });

  const inner = new THREE.Group();
  let sx = 0;
  let sz = 0;
  for (const c of cells) {
    sx += c.x + 0.5;
    sz += c.z + 0.5;
    for (let y = 0; y < c.height; y++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        c.x * cs + cs / 2,
        size / 2 + y * size,
        c.z * cs + cs / 2
      );
      mesh.add(new THREE.LineSegments(edges, edgeMat));
      inner.add(mesh);
    }
  }
  const n = Math.max(1, cells.length);
  const localCx = (sx / n) * cs;
  const localCz = (sz / n) * cs;
  inner.position.set(-localCx, 0, -localCz);
  // Center the plan under the free cursor — no grid snap.
  ghost.position.set(ghostWorld.x * cs, 0, ghostWorld.z * cs);
  ghost.scale.setScalar(DEFAULT_BUILDING_SCALE);
  ghost.add(inner);
}

function normalizePresetLocal(p: BuildingPreset) {
  return normalizeCells(rotateCells(p.cells, presetRotation));
}

function stampActivePreset(worldX: number, worldZ: number): void {
  const p = activePreset();
  if (!p) {
    setStatus("Pick a plan first");
    return;
  }
  const next = stampPreset(
    map,
    p,
    worldX,
    worldZ,
    presetPlacementOptions()
  );
  if (!next) {
    setStatus("Plan has no cells");
    return;
  }
  commit(
    next,
    `Placed ${p.name} @ ${worldX.toFixed(2)}, ${worldZ.toFixed(2)}`
  );
  refreshGhost();
}

function rotatePreset(): void {
  presetRotation = (presetRotation + 1) % 4;
  document.getElementById("preset-rot")!.textContent = `${presetRotation * 90}°`;
  refreshGhost();
}

const designer = new PlanDesigner(document.getElementById("designer")!, {
  onSave(preset) {
    const idx = presets.findIndex((p) => p.id === preset.id);
    if (idx >= 0) presets[idx] = preset;
    else presets.push(preset);
    activePresetId = preset.id;
    persistPresets();
    setActivePreset(preset.id);
    setStatus(`Saved plan "${preset.name}"`);
  },
  onDelete(id) {
    const name = presets.find((p) => p.id === id)?.name ?? id;
    presets = presets.filter((p) => p.id !== id);
    if (activePresetId === id) activePresetId = presets[0]?.id ?? null;
    persistPresets();
    refreshGhost();
    setStatus(`Deleted plan "${name}"`);
  },
});

function updateUndoButtons(): void {
  undoBtn.disabled = !history.canUndo;
  redoBtn.disabled = !history.canRedo;
}

function commit(next: TownMap, note: string, fromStroke = false): void {
  if (fromStroke) {
    if (!strokeCommitted) {
      history.push(map);
      strokeCommitted = true;
    }
  } else {
    history.push(map);
  }
  map = next;
  rebuild();
  setStatus(note);
  updateUndoButtons();
}

function undo(): void {
  const prev = history.undo(map);
  if (!prev) {
    setStatus("Nothing to undo");
    return;
  }
  map = prev;
  selectPiece(null);
  rebuild();
  setStatus("Undo");
  updateUndoButtons();
}

function redo(): void {
  const next = history.redo(map);
  if (!next) {
    setStatus("Nothing to redo");
    return;
  }
  map = next;
  selectPiece(null);
  rebuild();
  setStatus("Redo");
  updateUndoButtons();
}

function rebuild(): void {
  mapRenderer.setMap(map);
  layoutReference();
  saveMap(map);
  updateSelectionPanel();
  refreshGhost();
  refreshSelectionHighlight();
  if (selected) attachGizmo(selected);
}

function layoutReference(): void {
  if (!refMesh) return;
  const { cols, rows, cellSize } = map.meta;
  const scalePct = Number(
    (document.getElementById("ref-scale") as HTMLInputElement).value
  );
  const ox =
    Number((document.getElementById("ref-ox") as HTMLInputElement).value) / 10;
  const oz =
    Number((document.getElementById("ref-oz") as HTMLInputElement).value) / 10;
  const oy =
    Number((document.getElementById("ref-oy") as HTMLInputElement).value) / 100;
  const s = (scalePct / 100) * cellSize;
  refMesh.scale.set(cols * s, rows * s, 1);
  refMesh.position.set(
    (cols * cellSize) / 2 + ox * cellSize,
    oy * cellSize,
    (rows * cellSize) / 2 + oz * cellSize
  );
}

async function loadReference(url: string, opacity: number): Promise<void> {
  while (refGroup.children.length) {
    const c = refGroup.children[0];
    refGroup.remove(c);
  }
  refMesh = null;
  if (url === "none") return;

  const loader = new THREE.TextureLoader();
  const tex = await loader.loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Plane rotated -90° about X: image top → −Z (north), image right → +X (east).
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: opacity / 100,
    depthWrite: false,
  });
  refMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  refMesh.rotation.x = -Math.PI / 2;
  refGroup.add(refMesh);
  layoutReference();
}

function frameCamera(mode: "top" | "iso" | "north"): void {
  const center = mapRenderer.getCenter(map);
  controls.target.copy(center);
  const span = Math.max(map.meta.cols, map.meta.rows) * map.meta.cellSize;
  if (mode === "top") {
    // Slight +Z (south) offset so screen-up = −Z = north.
    camera.position.set(center.x, span * 1.4, center.z + 0.01);
  } else if (mode === "north") {
    // Stand south of the town, look north (matches the NorthView reference).
    camera.position.set(center.x, span * 0.7, center.z + span * 0.9);
  } else {
    camera.position.set(
      center.x + span * 0.55,
      span * 0.75,
      center.z + span * 0.55
    );
  }
  controls.update();
}

function hitOnGround(ev: PointerEvent): THREE.Vector3 | null {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
  return hit;
}

/** Integer cell under the pointer (paint / select / stamp). */
function cellFromEvent(ev: PointerEvent): { x: number; z: number } | null {
  const hit = hitOnGround(ev);
  if (!hit) return null;
  const x = Math.floor(hit.x / map.meta.cellSize);
  const z = Math.floor(hit.z / map.meta.cellSize);
  if (x < 0 || z < 0 || x >= map.meta.cols || z >= map.meta.rows) return null;
  return { x, z };
}

/** Continuous grid coords under the pointer (free move). */
function worldGridFromEvent(ev: PointerEvent): { x: number; z: number } | null {
  const hit = hitOnGround(ev);
  if (!hit) return null;
  return {
    x: hit.x / map.meta.cellSize,
    z: hit.z / map.meta.cellSize,
  };
}

function pieceLabel(piece: PieceRef): string {
  if (piece.kind === "building") {
    const b = map.buildings.find((bb) => bb.id === piece.id);
    return b?.label ?? b?.id ?? piece.id;
  }
  return `${piece.kind} ${piece.id}`;
}

function selectPiece(piece: PieceRef | null): void {
  selected = piece;
  if (piece?.kind === "building") {
    const b = map.buildings.find((bb) => bb.id === piece.id);
    if (b) {
      (document.getElementById("label") as HTMLInputElement).value =
        b.label ?? b.id;
      (document.getElementById("color") as HTMLSelectElement).value = b.color;
      (document.getElementById("special") as HTMLSelectElement).value =
        b.special ?? "";
      const maxH = Math.max(...b.cells.map((c) => c.height), 1);
      const selH = document.getElementById("sel-height") as HTMLInputElement;
      selH.value = String(maxH);
      document.getElementById("sel-height-val")!.textContent = String(maxH);
    }
  }
  updateSelectionPanel();
  refreshSelectionHighlight();
  attachGizmo(piece);
}

function startMoveDrag(piece: PieceRef, x: number, z: number): void {
  dragMove = {
    piece,
    grabX: x,
    grabZ: z,
    origin: structuredClone(map),
    lastDx: 0,
    lastDz: 0,
  };
  selectPiece(piece);
  setStatus(`Moving ${pieceLabel(piece)} — free drag`);
}

function updateMoveDrag(x: number, z: number): void {
  if (!dragMove) return;
  const dx = x - dragMove.grabX;
  const dz = z - dragMove.grabZ;
  if (
    Math.abs(dx - dragMove.lastDx) < 0.001 &&
    Math.abs(dz - dragMove.lastDz) < 0.001
  ) {
    return;
  }

  const next = movePiece(dragMove.origin, dragMove.piece, dx, dz);
  if (!next) {
    setStatus("Blocked — out of bounds");
    return;
  }
  dragMove.lastDx = dx;
  dragMove.lastDz = dz;
  map = next;
  rebuild();
  // Keep selection on the dragged piece (rebuild doesn't clear it)
  refreshSelectionHighlight();
  attachGizmo(selected);
  setStatus(
    `Move ${dx >= 0 ? "+" : ""}${dx.toFixed(2)}, ${dz >= 0 ? "+" : ""}${dz.toFixed(2)}`
  );
}

function endMoveDrag(): void {
  if (!dragMove) return;
  const { origin, lastDx, lastDz, piece } = dragMove;
  dragMove = null;
  if (Math.abs(lastDx) > 0.001 || Math.abs(lastDz) > 0.001) {
    history.push(origin);
    updateUndoButtons();
    saveMap(map);
    setStatus(`Moved ${pieceLabel(piece)}`);
  }
}

function nudgeSelection(dx: number, dz: number): void {
  if (!selected) {
    setStatus("Select a piece first (Select / Move tool)");
    return;
  }
  const next = movePiece(map, selected, dx, dz);
  if (!next) {
    setStatus("Can't move there — bounds or overlap");
    return;
  }
  commit(next, `Nudged ${pieceLabel(selected)} (${dx},${dz})`);
}

function applyPaint(x: number, z: number): void {
  const key = `${x},${z}`;
  if (painting && lastPaintCell === key && tool !== "select") return;
  lastPaintCell = key;

  const color = (document.getElementById("color") as HTMLSelectElement)
    .value as BuildingColor;
  const height = Number(
    (document.getElementById("height") as HTMLInputElement).value
  );
  const specialRaw = (document.getElementById("special") as HTMLSelectElement)
    .value;
  const special = (specialRaw || null) as BuildingSpecial;
  const label = (
    document.getElementById("label") as HTMLInputElement
  ).value.trim();

  switch (tool) {
    case "building": {
      let next = paintBuildingStack(
        map,
        x,
        z,
        color,
        height,
        undefined,
        special
      );
      if (label) {
        const b = findBuildingAt(next, x, z);
        if (b) {
          next = setBuildingLabel(next, b.id, label);
          if (special) next = setBuildingSpecial(next, b.id, special);
        }
      }
      commit(next, `Building stack @ ${x},${z} h=${height}`, true);
      break;
    }
    case "road":
      // Road tool uses path clicks, not cell paint.
      break;
    case "erase":
      commit(eraseEverythingAt(map, x, z), `Erased @ ${x},${z}`, true);
      break;
    case "light":
      // Handled via free world placement in pointerdown.
      break;
    case "vehicle": {
      const type = (document.getElementById("veh-type") as HTMLSelectElement)
        .value as VehicleType;
      const vcolor = (document.getElementById("veh-color") as HTMLInputElement)
        .value;
      const rot = Number(
        (document.getElementById("veh-rot") as HTMLInputElement).value
      );
      commit(
        placeVehicle(map, x, z, type, vcolor, rot),
        `Vehicle ${type} @ ${x},${z}`,
        true
      );
      break;
    }
    case "bush":
      commit(placeBush(map, x, z), `Bush @ ${x},${z}`, true);
      break;
    case "preset":
    case "select":
      // handled in pointerdown
      break;
  }
}

function deleteSelection(): void {
  if (!selected) {
    setStatus("Nothing selected — use Select / Move first");
    return;
  }
  const label = pieceLabel(selected);
  const piece = selected;
  selected = null;
  commit(deletePiece(map, piece), `Deleted ${label}`);
}

function applySelectedHeight(absolute?: number): void {
  if (!selected || selected.kind !== "building") return;
  const h =
    absolute ??
    Number((document.getElementById("sel-height") as HTMLInputElement).value);
  commit(
    resizeBuildingHeight(map, selected.id, h),
    `Resized stacks to ${h}`
  );
}

function nudgeSelectedHeight(delta: number): void {
  if (!selected || selected.kind !== "building") return;
  const b = map.buildings.find((bb) => bb.id === selected!.id);
  if (!b) return;
  const cur = Math.max(...b.cells.map((c) => c.height), 1);
  applySelectedHeight(cur + delta);
}

function updateSelectionPanel(): void {
  const panel = document.getElementById("selection-info")!;
  const pre = document.getElementById("sel-text")!;
  const bldgOpts = document.getElementById("building-sel-opts")!;
  const crossOpts = document.getElementById("hospital-cross-opts")!;
  if (!selected) {
    panel.classList.add("hidden");
    placeCrossMode = false;
    return;
  }
  panel.classList.remove("hidden");
  bldgOpts.classList.toggle("hidden", selected.kind !== "building");
  const roadOpts = document.getElementById("road-sel-opts")!;
  roadOpts.classList.toggle("hidden", selected.kind !== "road");

  if (selected.kind === "building") {
    const b = map.buildings.find((bb) => bb.id === selected!.id);
    if (!b) {
      panel.classList.add("hidden");
      return;
    }
    crossOpts.classList.toggle("hidden", b.special !== "hospital");
    pre.textContent = JSON.stringify(
      {
        kind: "building",
        id: b.id,
        label: b.label,
        color: b.color,
        special: b.special,
        cross:
          b.special === "hospital"
            ? { x: b.crossX, z: b.crossZ }
            : undefined,
        cells: b.cells,
      },
      null,
      2
    );
  } else if (selected.kind === "vehicle") {
    crossOpts.classList.add("hidden");
    placeCrossMode = false;
    const v = map.vehicles.find((vv) => vv.id === selected!.id);
    pre.textContent = JSON.stringify({ kind: "vehicle", ...v }, null, 2);
  } else if (selected.kind === "light") {
    crossOpts.classList.add("hidden");
    placeCrossMode = false;
    const l = map.streetLights.find((ll) => ll.id === selected!.id);
    pre.textContent = JSON.stringify({ kind: "light", ...l }, null, 2);
  } else if (selected.kind === "road") {
    crossOpts.classList.add("hidden");
    placeCrossMode = false;
    const r = map.roads.find((rr) => rr.id === selected!.id);
    pre.textContent = JSON.stringify({ kind: "road", ...r }, null, 2);
    if (r) {
      const wEl = document.getElementById("sel-road-width") as HTMLInputElement;
      const wVal = document.getElementById("sel-road-width-val")!;
      wEl.value = String(Math.round((r.width ?? 1) * 100));
      wVal.textContent = (r.width ?? 1).toFixed(2);
    }
  } else {
    crossOpts.classList.add("hidden");
    placeCrossMode = false;
    const b = map.bushes.find((bb) => bb.id === selected!.id);
    pre.textContent = JSON.stringify({ kind: "bush", ...b }, null, 2);
  }
}

function resize(): void {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  // Gentle pulse so the selection stays noticeable
  if (selectionHighlight.children.length) {
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.005);
    selectionHighlight.traverse((o) => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.MeshBasicMaterial | undefined;
      if (mat && "opacity" in mat && mat.transparent) {
        // Keep relative opacity; pulse multiplies a base stored once
        if (mat.userData.baseOpacity == null) {
          mat.userData.baseOpacity = mat.opacity;
        }
        mat.opacity = (mat.userData.baseOpacity as number) * pulse;
      }
    });
  }
  renderer.render(scene, camera);
}

// --- UI wiring ---

function roadPathWidth(): number {
  return (
    Number(
      (document.getElementById("road-path-width") as HTMLInputElement).value
    ) / 100
  );
}

function updateRoadPathStatus(): void {
  const el = document.getElementById("road-path-status");
  if (!el) return;
  el.textContent =
    roadPathPoints.length === 0
      ? "0 points — click the map to start"
      : roadPathPoints.length === 1
        ? "1 point — click next, then Enter to finish (need 2+)"
        : `${roadPathPoints.length} points — Enter to build · Backspace undoes`;
}

function clearRoadPathPreview(): void {
  while (roadPathPreview.children.length) {
    const c = roadPathPreview.children[0]!;
    roadPathPreview.remove(c);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
      else (m.material as THREE.Material | undefined)?.dispose();
    });
  }
}

function roadSnapRadius(): number {
  return Math.max(0.45, roadPathWidth() * 0.65);
}

/** Snap cursor to existing roads (and path points already placed). */
function snapRoadPathPoint(
  x: number,
  z: number
): { x: number; z: number; snapped: boolean } {
  const radius = roadSnapRadius();
  let bestX = x;
  let bestZ = z;
  let bestDist = radius;
  let snapped = false;
  const consider = (px: number, pz: number) => {
    const d = Math.hypot(px - x, pz - z);
    if (d <= bestDist) {
      bestDist = d;
      bestX = px;
      bestZ = pz;
      snapped = true;
    }
  };
  for (const p of roadPathPoints) consider(p.x, p.z);
  const net = snapToRoadNetwork(map, x, z, radius);
  if (net) consider(net.x, net.z);
  return snapped ? { x: bestX, z: bestZ, snapped: true } : { x, z, snapped: false };
}

function refreshRoadPathPreview(): void {
  clearRoadPathPreview();
  if (!roadPathPoints.length) {
    updateRoadPathStatus();
    return;
  }
  const cs = map.meta.cellSize;
  const w = roadPathWidth();
  const pts = roadPathPoints.map(
    (p) => new THREE.Vector3(p.x * cs, 0.06, p.z * cs)
  );
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
  const junctionMat = new THREE.MeshBasicMaterial({
    color: 0x9a9a9a,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  for (const p of roadPathPoints) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(cs * 0.12, 10, 8),
      markerMat
    );
    m.position.set(p.x * cs, 0.06, p.z * cs);
    roadPathPreview.add(m);
    // Junction pad preview (same as committed roads)
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(w * cs, 0.03, w * cs),
      junctionMat
    );
    pad.position.set(p.x * cs, 0.04, p.z * cs);
    roadPathPreview.add(pad);
  }
  if (pts.length >= 2) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffcc33 })
    );
    roadPathPreview.add(line);
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    for (let i = 0; i < roadPathPoints.length - 1; i++) {
      const a = roadPathPoints[i]!;
      const b = roadPathPoints[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) continue;
      const len = dist + w;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w * cs, 0.03, len * cs),
        ribbonMat
      );
      mesh.position.set(
        ((a.x + b.x) / 2) * cs,
        0.04,
        ((a.z + b.z) / 2) * cs
      );
      mesh.rotation.y = Math.atan2(dx, -dz);
      roadPathPreview.add(mesh);
    }
  }
  updateRoadPathStatus();
}

function clearRoadPath(): void {
  roadPathPoints = [];
  refreshRoadPathPreview();
  setStatus("Road path cleared");
}

function commitRoadPath(): void {
  if (roadPathPoints.length < 2) {
    setStatus("Need at least 2 points — click the map, then Enter");
    return;
  }
  const next = createRoadsFromPath(map, roadPathPoints, roadPathWidth());
  if (!next) {
    setStatus("Path too short");
    return;
  }
  const n = next.roads.length - map.roads.length;
  commit(next, `Road path (${n} segment${n === 1 ? "" : "s"})`);
  clearRoadPath();
  setStatus(`Built ${n} road segment${n === 1 ? "" : "s"} — select to stretch width`);
}

function selectTool(next: Tool): void {
  tool = next;
  document.querySelectorAll("#tools button").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tool") === tool);
  });
  document
    .getElementById("building-opts")!
    .classList.toggle("hidden", tool !== "building" && tool !== "select");
  document
    .getElementById("preset-opts")!
    .classList.toggle("hidden", tool !== "preset");
  document
    .getElementById("vehicle-opts")!
    .classList.toggle("hidden", tool !== "vehicle");
  document
    .getElementById("road-opts")!
    .classList.toggle("hidden", tool !== "road");
  if (tool !== "preset") ghostWorld = null;
  if (tool !== "road") clearRoadPath();
  else {
    updateRoadPathStatus();
    setStatus("Road path: click points, Enter to build");
  }
  refreshGhost();
}

document.getElementById("tools")!.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest("button[data-tool]");
  if (!btn) return;
  selectTool(btn.getAttribute("data-tool") as Tool);
});

document.getElementById("gizmo-modes")!.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest("button[data-gizmo]");
  if (!btn) return;
  setGizmoMode(btn.getAttribute("data-gizmo") as GizmoMode);
});
setGizmoMode("rotate");

// Plan library + placement
renderPresetList();
setActivePreset(activePresetId);

(document.getElementById("preset-select") as HTMLSelectElement).addEventListener(
  "change",
  (ev) => setActivePreset((ev.target as HTMLSelectElement).value)
);
document
  .getElementById("preset-color")!
  .addEventListener("change", refreshGhost);
document
  .getElementById("btn-preset-rotate")!
  .addEventListener("click", rotatePreset);
document
  .getElementById("btn-new-plan")!
  .addEventListener("click", () => designer.open());
document.getElementById("btn-edit-plan")!.addEventListener("click", () => {
  const p = activePreset();
  if (!p) {
    setStatus("Pick a plan in the list first");
    return;
  }
  designer.open(p);
});
document.getElementById("btn-save-as-plan")!.addEventListener("click", () => {
  if (!selected || selected.kind !== "building") return;
  const b = map.buildings.find((bb) => bb.id === selected!.id);
  if (!b) return;
  const name = prompt("Plan name", b.label ?? b.id);
  if (!name) return;
  const preset = presetFromBuilding(b, name.trim());
  presets.push(preset);
  activePresetId = preset.id;
  persistPresets();
  setStatus(`Saved "${preset.name}" to plans`);
});
document.getElementById("btn-export-plans")!.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(presets, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "al-rimal.plans.json";
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus("Exported plans");
});
document.getElementById("btn-import-plans")!.addEventListener("click", () => {
  document.getElementById("plans-file-input")!.click();
});
document
  .getElementById("plans-file-input")!
  .addEventListener("change", async (ev) => {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const incoming = parsePresetsJson(await file.text());
      const byId = new Map(presets.map((p) => [p.id, p]));
      for (const p of incoming) byId.set(p.id, p);
      presets = [...byId.values()];
      if (!activePresetId) activePresetId = presets[0]?.id ?? null;
      persistPresets();
      setStatus(`Imported ${incoming.length} plan(s)`);
    } catch (err) {
      setStatus(`Import failed: ${(err as Error).message}`);
    }
    input.value = "";
  });

const heightInput = document.getElementById("height") as HTMLInputElement;
const heightVal = document.getElementById("height-val")!;
heightInput.addEventListener("input", () => {
  heightVal.textContent = heightInput.value;
});

const selHeight = document.getElementById("sel-height") as HTMLInputElement;
const selHeightVal = document.getElementById("sel-height-val")!;
selHeight.addEventListener("input", () => {
  selHeightVal.textContent = selHeight.value;
});

const refOpacity = document.getElementById("ref-opacity") as HTMLInputElement;
const refOpacityVal = document.getElementById("ref-opacity-val")!;
refOpacity.addEventListener("input", () => {
  refOpacityVal.textContent = `${refOpacity.value}%`;
  if (refMesh) {
    (refMesh.material as THREE.MeshBasicMaterial).opacity =
      Number(refOpacity.value) / 100;
  }
});

document.getElementById("ref-image")!.addEventListener("change", (ev) => {
  const url = (ev.target as HTMLSelectElement).value;
  void loadReference(url, Number(refOpacity.value));
});

const refScale = document.getElementById("ref-scale") as HTMLInputElement;
const refScaleVal = document.getElementById("ref-scale-val")!;
refScale.addEventListener("input", () => {
  refScaleVal.textContent = `${refScale.value}%`;
  layoutReference();
});
document.getElementById("ref-ox")!.addEventListener("input", layoutReference);
document.getElementById("ref-oz")!.addEventListener("input", layoutReference);
const refOy = document.getElementById("ref-oy") as HTMLInputElement;
const refOyVal = document.getElementById("ref-oy-val")!;
refOy.addEventListener("input", () => {
  refOyVal.textContent = (Number(refOy.value) / 100).toFixed(2);
  layoutReference();
});

document
  .getElementById("cam-top")!
  .addEventListener("click", () => frameCamera("top"));
document
  .getElementById("cam-iso")!
  .addEventListener("click", () => frameCamera("iso"));
document
  .getElementById("cam-north")!
  .addEventListener("click", () => frameCamera("north"));

undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

document.getElementById("btn-clear-models")!.addEventListener("click", () => {
  const count =
    map.buildings.length +
    map.vehicles.length +
    map.streetLights.length +
    map.bushes.length;
  if (count === 0) {
    setStatus("Nothing to clear");
    return;
  }
  if (
    !confirm(
      `Clear all models?\n\n${map.buildings.length} buildings, ${map.vehicles.length} vehicles, ${map.streetLights.length} lights, ${map.bushes.length} bushes.\nRoads stay. You can Ctrl+Z to undo.`
    )
  ) {
    return;
  }
  selectPiece(null);
  commit(clearAllModels(map), `Cleared ${count} model(s)`);
});

document.getElementById("btn-export")!.addEventListener("click", () => {
  const blob = new Blob([serializeMap(map)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${map.meta.name.toLowerCase().replace(/\s+/g, "-")}.map.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus("Exported JSON");
});

document.getElementById("btn-import")!.addEventListener("click", () => {
  document.getElementById("file-input")!.click();
});

document
  .getElementById("file-input")!
  .addEventListener("change", async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    history.push(map);
    map = parseMapJson(text);
    selectPiece(null);
    history.clear();
    rebuild();
    frameCamera("top");
    setStatus(`Imported ${file.name}`);
    updateUndoButtons();
    (ev.target as HTMLInputElement).value = "";
  });

document.getElementById("btn-load-seed")!.addEventListener("click", () => {
  history.push(map);
  map = structuredClone(AL_RIMAL_SEED);
  selectPiece(null);
  rebuild();
  frameCamera("iso");
  setStatus("Loaded Al-Rimal seed map");
  updateUndoButtons();
});

document.getElementById("btn-apply-label")!.addEventListener("click", () => {
  if (!selected || selected.kind !== "building") return;
  const label = (
    document.getElementById("label") as HTMLInputElement
  ).value.trim();
  const specialRaw = (document.getElementById("special") as HTMLSelectElement)
    .value;
  const special = (specialRaw || null) as BuildingSpecial;
  let next = map;
  if (label) next = setBuildingLabel(next, selected.id, label);
  next = setBuildingSpecial(next, selected.id, special);
  commit(next, "Updated label / special");
  updateSelectionPanel();
});

const roadPathWidthEl = document.getElementById(
  "road-path-width"
) as HTMLInputElement;
const roadPathWidthVal = document.getElementById("road-path-width-val")!;
roadPathWidthEl.addEventListener("input", () => {
  roadPathWidthVal.textContent = (Number(roadPathWidthEl.value) / 100).toFixed(
    2
  );
  refreshRoadPathPreview();
});
document
  .getElementById("btn-road-commit")!
  .addEventListener("click", () => commitRoadPath());
document
  .getElementById("btn-road-clear")!
  .addEventListener("click", () => clearRoadPath());

const selRoadWidth = document.getElementById(
  "sel-road-width"
) as HTMLInputElement;
const selRoadWidthVal = document.getElementById("sel-road-width-val")!;
selRoadWidth.addEventListener("input", () => {
  selRoadWidthVal.textContent = (Number(selRoadWidth.value) / 100).toFixed(2);
});
selRoadWidth.addEventListener("change", () => {
  if (!selected || selected.kind !== "road") return;
  const w = Number(selRoadWidth.value) / 100;
  const next = setRoadWidth(map, selected.id, w);
  if (next) commit(next, `Road width ${w.toFixed(2)}`);
});

document.getElementById("btn-place-cross")!.addEventListener("click", () => {
  if (!selected || selected.kind !== "building") return;
  const b = map.buildings.find((bb) => bb.id === selected!.id);
  if (!b || b.special !== "hospital") {
    setStatus("Set Special to Hospital first, then Apply");
    return;
  }
  placeCrossMode = true;
  selectTool("select");
  setStatus("Click on the hospital roof to place the red cross (Esc cancels)");
});

document
  .getElementById("btn-apply-height")!
  .addEventListener("click", () => applySelectedHeight());
document
  .getElementById("btn-height-up")!
  .addEventListener("click", () => nudgeSelectedHeight(1));
document
  .getElementById("btn-height-down")!
  .addEventListener("click", () => nudgeSelectedHeight(-1));
document
  .getElementById("btn-delete-bldg")!
  .addEventListener("click", deleteSelection);

// North is −Z
document
  .getElementById("btn-nudge-n")!
  .addEventListener("click", () => nudgeSelection(0, -1));
document
  .getElementById("btn-nudge-s")!
  .addEventListener("click", () => nudgeSelection(0, 1));
document
  .getElementById("btn-nudge-w")!
  .addEventListener("click", () => nudgeSelection(-1, 0));
document
  .getElementById("btn-nudge-e")!
  .addEventListener("click", () => nudgeSelection(1, 0));

renderer.domElement.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  // TransformControls connects first; if hovering a handle, axis/dragging is set.
  if (transformControls.dragging || transformControls.axis) return;

  if (placeCrossMode && selected?.kind === "building") {
    const world = worldGridFromEvent(ev);
    if (!world) return;
    const next = setHospitalCross(map, selected.id, world.x, world.z);
    placeCrossMode = false;
    if (!next) {
      setStatus("Could not place cross — is Special set to Hospital?");
      return;
    }
    commit(
      next,
      `Red cross @ ${world.x.toFixed(2)}, ${world.z.toFixed(2)}`
    );
    return;
  }

  const cell = cellFromEvent(ev);
  if (!cell) return;

  if (tool === "preset") {
    const world = worldGridFromEvent(ev);
    if (!world) return;
    ghostWorld = world;
    stampActivePreset(world.x, world.z);
    return;
  }

  if (tool === "light") {
    const world = worldGridFromEvent(ev);
    if (!world) return;
    commit(
      placeStreetLight(map, world.x, world.z),
      `Street light @ ${world.x.toFixed(2)}, ${world.z.toFixed(2)}`
    );
    return;
  }

  if (tool === "road") {
    const world = worldGridFromEvent(ev);
    if (!world) return;
    const snapped = snapRoadPathPoint(world.x, world.z);
    // Avoid stacking duplicate points on the same spot.
    const last = roadPathPoints[roadPathPoints.length - 1];
    if (
      last &&
      Math.hypot(last.x - snapped.x, last.z - snapped.z) < 0.04
    ) {
      setStatus("Point too close to the last one — click further along");
      return;
    }
    roadPathPoints.push({ x: snapped.x, z: snapped.z });
    refreshRoadPathPreview();
    setStatus(
      snapped.snapped
        ? `Snapped to existing road · ${roadPathPoints.length} point${roadPathPoints.length === 1 ? "" : "s"} — Enter to build`
        : roadPathPoints.length < 2
          ? `Point ${roadPathPoints.length} — click more (snap to roads to join), then Enter`
          : `${roadPathPoints.length} points — Enter to build seamless road`
    );
    return;
  }

  if (tool === "select") {
    const piece = findPieceAt(map, cell.x, cell.z);
    if (piece) {
      const world = worldGridFromEvent(ev);
      startMoveDrag(piece, world?.x ?? cell.x + 0.5, world?.z ?? cell.z + 0.5);
    } else {
      selectPiece(null);
      setStatus(`Empty cell ${cell.x},${cell.z}`);
    }
    return;
  }

  painting = true;
  strokeCommitted = false;
  lastPaintCell = null;
  applyPaint(cell.x, cell.z);
});

renderer.domElement.addEventListener("pointermove", (ev) => {
  if (transformControls.dragging) return;
  if (dragMove) {
    const world = worldGridFromEvent(ev);
    if (world) updateMoveDrag(world.x, world.z);
    return;
  }
  if (tool === "preset") {
    const world = worldGridFromEvent(ev);
    const changed =
      !world ||
      !ghostWorld ||
      Math.abs(world.x - ghostWorld.x) > 0.02 ||
      Math.abs(world.z - ghostWorld.z) > 0.02;
    ghostWorld = world;
    if (changed) refreshGhost();
    return;
  }
  if (!painting || (ev.buttons & 1) === 0) return;
  const cell = cellFromEvent(ev);
  if (cell) applyPaint(cell.x, cell.z);
});

renderer.domElement.addEventListener("pointerup", () => {
  if (dragMove) endMoveDrag();
  painting = false;
  strokeCommitted = false;
  lastPaintCell = null;
});

renderer.domElement.addEventListener("pointerleave", () => {
  if (dragMove) endMoveDrag();
  painting = false;
  strokeCommitted = false;
  lastPaintCell = null;
  ghostWorld = null;
  refreshGhost();
});

renderer.domElement.addEventListener("contextmenu", (ev) => ev.preventDefault());

window.addEventListener("keydown", (ev) => {
  const tag = (ev.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (designer.isOpen) return;

  if (ev.key === "Escape") {
    if (placeCrossMode) {
      placeCrossMode = false;
      setStatus("Cross placement cancelled");
      return;
    }
    if (tool === "road" && roadPathPoints.length) {
      clearRoadPath();
      return;
    }
  }

  if (tool === "road") {
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitRoadPath();
      return;
    }
    if (ev.key === "Backspace") {
      ev.preventDefault();
      if (roadPathPoints.length) {
        roadPathPoints.pop();
        refreshRoadPathPreview();
        setStatus("Removed last path point");
      }
      return;
    }
  }

  if (ev.key === "r" || ev.key === "R") {
    ev.preventDefault();
    if (selected) {
      setGizmoMode("rotate");
    } else if (tool === "preset") {
      rotatePreset();
    }
    return;
  }
  if (ev.key === "t" || ev.key === "T") {
    if (selected) {
      ev.preventDefault();
      setGizmoMode("scale");
    }
    return;
  }
  if (ev.key === "p" || ev.key === "P") {
    selectTool("preset");
    return;
  }

  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !ev.shiftKey) {
    ev.preventDefault();
    undo();
    return;
  }
  if (
    (ev.ctrlKey || ev.metaKey) &&
    (ev.key.toLowerCase() === "y" ||
      (ev.key.toLowerCase() === "z" && ev.shiftKey))
  ) {
    ev.preventDefault();
    redo();
    return;
  }
  if (ev.key === "Delete" || ev.key === "Backspace") {
    ev.preventDefault();
    deleteSelection();
    return;
  }
  if (ev.key === "ArrowUp") {
    ev.preventDefault();
    nudgeSelection(0, -1);
    return;
  }
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    nudgeSelection(0, 1);
    return;
  }
  if (ev.key === "ArrowLeft") {
    ev.preventDefault();
    nudgeSelection(-1, 0);
    return;
  }
  if (ev.key === "ArrowRight") {
    ev.preventDefault();
    nudgeSelection(1, 0);
    return;
  }
  if (ev.key === "]" || ev.key === "=") {
    ev.preventDefault();
    nudgeSelectedHeight(1);
    return;
  }
  if (ev.key === "[" || ev.key === "-") {
    ev.preventDefault();
    nudgeSelectedHeight(-1);
    return;
  }
  if (ev.key === "e" || ev.key === "E") selectTool("erase");
  if (ev.key === "s" || ev.key === "S" || ev.key === "m" || ev.key === "M") {
    selectTool("select");
  }
  if (ev.key === "b" || ev.key === "B") selectTool("building");
});

window.addEventListener("resize", resize);

// Boot
// One-time cleanup from the short-lived Map A / Map B experiment: the latest
// edits lived under the "A" slot key, so fold them back into the single key.
{
  const slotA = localStorage.getItem(`${MAP_STORAGE_KEY}:A`);
  if (slotA) {
    try {
      const m = parseMapJson(slotA);
      delete (m.meta as { slot?: unknown }).slot;
      saveMap(m);
    } catch {
      /* keep whatever is in the single key */
    }
  }
  localStorage.removeItem(`${MAP_STORAGE_KEY}:A`);
  localStorage.removeItem(`${MAP_STORAGE_KEY}:B`);
  localStorage.removeItem("al-rimal-active-map");
}
const saved = localStorage.getItem(MAP_STORAGE_KEY);
if (saved) {
  try {
    map = parseMapJson(saved);
    delete (map.meta as { slot?: unknown }).slot;
    setStatus("Restored last edit from browser storage");
  } catch {
    map = structuredClone(AL_RIMAL_SEED);
  }
}

rebuild();
resize();
frameCamera("iso");
updateUndoButtons();
void loadReference("/ref/birdseye.png", Number(refOpacity.value));
animate();
