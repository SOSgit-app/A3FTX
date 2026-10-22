import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";
import { MapRenderer, parseMapJson } from "@a3-ftx/shared";
import mapJson from "../../../maps/al-rimal.map.json";

type BoardId = "aircraft" | "ordinance";

const asset = (file: string): string => `${import.meta.env.BASE_URL}${file}`;

const BOARDS: Record<BoardId, { url: string; title: string }> = {
  aircraft: { url: asset("boards/aircraft.png"), title: "Aircraft — F-16, B-52, F/A-18" },
  ordinance: {
    url: asset("boards/ordinance.png"),
    title: "Ordinance — CALCM, CBU-87, GBU-31, AGM-158, GBU-38",
  },
};

const canvas = document.getElementById("view") as HTMLCanvasElement;
const startEl = document.getElementById("start")!;
const hudEl = document.getElementById("hud")!;
const hintEl = document.getElementById("hint")!;
const lightbox = document.getElementById("lightbox")!;
const lightboxImg = document.getElementById("lightbox-img") as HTMLImageElement;
const lightboxCaption = document.getElementById("lightbox-caption")!;
const vrButton = document.getElementById("btn-vr") as HTMLButtonElement;
const arButton = document.getElementById("btn-ar") as HTMLButtonElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x2a2826, 1);
renderer.xr.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2826);
scene.fog = new THREE.Fog(0x2a2826, 8, 16);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.05,
  40
);
camera.position.set(0.15, 1.62, 0.85);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.95, -1.35);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 0.4;
controls.maxDistance = 6;

scene.add(new THREE.HemisphereLight(0xfff2dc, 0x3a342c, 0.7));
const sun = new THREE.DirectionalLight(0xfff6e8, 1.15);
sun.position.set(2.5, 6, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const fill = new THREE.PointLight(0xffe2a8, 0.45, 8);
fill.position.set(0, 2.4, -1.2);
scene.add(fill);

const room = new THREE.Group();
room.name = "BriefingRoom";
scene.add(room);
buildRoom(room);

const roomBackground = scene.background;
const roomFog = scene.fog;

const TABLE_TOP = 0.78;
/** Floor point under the table. Map, plates, and the tabletop move with it. */
const tableRig = new THREE.Group();
tableRig.position.set(0, 0, -1.45);
scene.add(tableRig);
tableRig.add(buildTable());

const map = parseMapJson(JSON.stringify(mapJson));
const mapSpan = Math.max(map.meta.cols, map.meta.rows) * map.meta.cellSize;
const mapScale = 1.45 / mapSpan;
const mapRenderer = new MapRenderer({ showEdges: true });
mapRenderer.setMap(map);
mapRenderer.root.scale.setScalar(mapScale);
mapRenderer.root.position.set(
  (-map.meta.cols * map.meta.cellSize * mapScale) / 2,
  TABLE_TOP + 0.012,
  (-map.meta.rows * map.meta.cellSize * mapScale) / 2
);
tableRig.add(mapRenderer.root);

const clickables: THREE.Object3D[] = [];
/** One gold halo per plate. It blinks until that plate is opened once. */
interface CueButton {
  id: BoardId;
  plate: THREE.Mesh;
  glow: THREE.Mesh;
  width: number;
  depth: number;
  seen: boolean;
}
const cueButtons: CueButton[] = [];

const aircraftBtn = makeButton("Aircraft", -0.24, 0.78);
const ordinanceBtn = makeButton("Ordinance", 0.24, 0.78);
tableRig.add(aircraftBtn, ordinanceBtn);
clickables.push(aircraftBtn, ordinanceBtn);
tableRig.add(makeClipboard());

const SCREEN_W = 2.4;
const SCREEN_H = 1.42;
const projector = buildProjector();
scene.add(projector);
const screen = projector.getObjectByName("screen") as THREE.Mesh;
const closeBtn = projector.getObjectByName("close") as THREE.Mesh;
clickables.push(closeBtn);
const beam = new THREE.SpotLight(0xfff6e4, 0, 9, Math.PI / 8, 0.45, 1);
beam.position.set(0, 2.9, -1.55);
beam.target.position.set(0, 1.62, -3.12);
scene.add(beam, beam.target);
const projectorBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.32, 0.1, 0.22),
  new THREE.MeshStandardMaterial({ color: 0x2c2c2c, metalness: 0.45, roughness: 0.4 })
);
projectorBody.position.copy(beam.position);
scene.add(projectorBody);
// Screen, beam, and projector body share the table rig, so a grip move or resize carries them too.
tableRig.attach(projector);
tableRig.attach(beam);
tableRig.attach(beam.target);
tableRig.attach(projectorBody);

const settingsMenu = new THREE.Group();
settingsMenu.name = "settings";
settingsMenu.visible = false;
scene.add(settingsMenu);
const settingsBg = new THREE.Mesh(
  new THREE.PlaneGeometry(0.52, 0.38),
  new THREE.MeshBasicMaterial({ color: 0x1c1814, side: THREE.DoubleSide })
);
settingsMenu.add(settingsBg);
const settingsTitle = makePlate("Settings", "#d9d4cc", "#1a1a1a", 640, 160);
settingsTitle.scale.set(0.44, 0.1, 1);
settingsTitle.position.set(0, 0.09, 0.01);
settingsMenu.add(settingsTitle);
const goMenuBtn = makePlate("Go to menu", "#3a3126", "#f4efe6", 640, 180);
goMenuBtn.scale.set(0.44, 0.12, 1);
goMenuBtn.position.set(0, -0.08, 0.01);
goMenuBtn.userData.action = "goto-menu";
settingsMenu.add(goMenuBtn);
clickables.push(goMenuBtn);

let grabbing = false;
const grabOffset = new THREE.Vector3();
let grabHandYaw = 0;
let grabRigYaw = 0;
let grabScale = 1;
let grabHandDist = 1;
const MIN_TABLE_SCALE = 0.4;
const MAX_TABLE_SCALE = 2.5;
const leftPos = new THREE.Vector3();
const rightPos = new THREE.Vector3();
const handMid = new THREE.Vector3();
const rotatedOffset = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);

const textures: Partial<Record<BoardId, THREE.Texture>> = {};
const loader = new THREE.TextureLoader();
let openBoard: BoardId | null = null;

function loadBoardTexture(id: BoardId): THREE.Texture {
  const cached = textures[id];
  if (cached) return cached;
  const tex = loader.load(BOARDS[id].url, (loaded) => {
    const img = loaded.image as { width: number; height: number };
    if (img?.width && img?.height && openBoard === id) fitScreen(img.width / img.height);
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  textures[id] = tex;
  return tex;
}

function fitScreen(aspect: number): void {
  let width = SCREEN_W;
  let height = width / aspect;
  if (height > SCREEN_H) {
    height = SCREEN_H;
    width = height * aspect;
  }
  screen.scale.set(width / SCREEN_W, height / SCREEN_H, 1);
}

function showBoard(id: BoardId): void {
  openBoard = id;
  const mat = screen.material as THREE.MeshBasicMaterial;
  mat.map = loadBoardTexture(id);
  mat.color.set(0xffffff);
  mat.needsUpdate = true;
  const img = mat.map.image as { width?: number; height?: number } | undefined;
  if (img?.width && img?.height) fitScreen(img.width / img.height);
  closeBtn.visible = true;
  beam.intensity = 2.4;
  document
    .querySelectorAll<HTMLButtonElement>("#hud button[data-board]")
    .forEach((b) => b.classList.toggle("active", b.dataset.board === id));
  lightbox.hidden = true;
  hintEl.textContent = `${BOARDS[id].title} is on the projector. Press Map or Close to clear it.`;
  dismissCue(id);
}

function showMap(): void {
  openBoard = null;
  const mat = screen.material as THREE.MeshBasicMaterial;
  mat.map = null;
  mat.color.set(0x2a2a2a);
  mat.needsUpdate = true;
  screen.scale.set(1, 1, 1);
  closeBtn.visible = false;
  beam.intensity = 0;
  lightbox.hidden = true;
  document
    .querySelectorAll<HTMLButtonElement>("#hud button[data-board]")
    .forEach((b) => b.classList.remove("active"));
  hintEl.textContent =
    "Aircraft and Ordinance sit on the near edge of the table. A click projects that image on the screen.";
}

function activate(object: THREE.Object3D | null): void {
  if (!object || !isShown(object)) return;
  const action = object.userData.action as string | undefined;
  if (action === "goto-menu") {
    goToStartMenu();
    return;
  }
  const id = object.userData.board as BoardId | undefined;
  if (id === "aircraft" || id === "ordinance") {
    if (openBoard === id) showMap();
    else showBoard(id);
    return;
  }
  if (object.name === "close" || object.userData.board === "map") showMap();
}

function isShown(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function goToStartMenu(): void {
  showMap();
  grabbing = false;
  settingsMenu.visible = false;
  if (renderer.xr.isPresenting) {
    void renderer.xr.getSession()?.end();
  }
  startEl.hidden = false;
  hudEl.hidden = true;
  resetCues();
}

function toggleSettings(): void {
  settingsMenu.visible = !settingsMenu.visible;
  if (settingsMenu.visible) {
    placeSettingsMenu();
    hintEl.textContent =
      "Settings: point and trigger. Go to menu leaves the briefing. Both grips still move the table. B closes this.";
  }
}

function placeSettingsMenu(): void {
  const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  viewer.getWorldPosition(origin);
  viewer.getWorldDirection(dir);
  settingsMenu.position.copy(origin).addScaledVector(dir, 1.05);
  settingsMenu.position.y = Math.min(origin.y, settingsMenu.position.y);
  // Plane faces +Z. lookAt aims +Z at the viewer, so the labels face you.
  settingsMenu.lookAt(origin);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

canvas.addEventListener("pointerdown", (ev) => {
  if (renderer.xr.isPresenting) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = firstShownHit();
  activate(hit);
});

interface HandState {
  group: THREE.Group;
  index: number;
  source: XRInputSource | null;
  prevB: boolean;
}

const hands: HandState[] = [];
const controllerGrips: THREE.Group[] = [];
const controllerModelFactory = new XRControllerModelFactory();

function bindController(index: number): void {
  const controller = renderer.xr.getController(index);
  const hand: HandState = { group: controller, index, source: null, prevB: false };
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -2),
  ]);
  controller.add(
    new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xe2b15a }))
  );
  controller.addEventListener("connected", (event) => {
    hand.source = (event as unknown as { data?: XRInputSource }).data ?? null;
  });
  controller.addEventListener("disconnected", () => {
    hand.source = null;
    hand.prevB = false;
  });
  controller.addEventListener("select", () => {
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3(0, 0, -1);
    origin.setFromMatrixPosition(controller.matrixWorld);
    dir.transformDirection(controller.matrixWorld);
    raycaster.set(origin, dir);
    activate(firstShownHit());
  });
  hands.push(hand);
  scene.add(controller);

  const grip = renderer.xr.getControllerGrip(index);
  const model = controllerModelFactory.createControllerModel(grip);
  const fallback = makeControllerBody();
  grip.add(fallback);
  grip.add(model);
  grip.userData.model = model;
  grip.userData.fallback = fallback;
  controllerGrips.push(grip);
  scene.add(grip);
}

/** Shown until the Quest controller model finishes loading. */
function makeControllerBody(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.046, 0.036, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.45, metalness: 0.4 })
  );
  body.position.z = -0.03;
  g.add(body);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.006, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.35, metalness: 0.25 })
  );
  plate.position.set(0, 0.02, -0.01);
  g.add(plate);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.03, 0.004, 8, 18),
    new THREE.MeshStandardMaterial({ color: 0xe2b15a, metalness: 0.55, roughness: 0.3 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.04;
  g.add(ring);
  return g;
}

function revealLoadedControllers(): void {
  for (const grip of controllerGrips) {
    const model = grip.userData.model as THREE.Object3D | undefined;
    const fallback = grip.userData.fallback as THREE.Object3D | undefined;
    if (fallback?.visible && model && model.children.length > 0) fallback.visible = false;
  }
}
bindController(0);
bindController(1);

/** Quest Touch: grip is button 1, B (right) / Y (left) is button 5. */
function buttonDown(source: XRInputSource | null, index: number): boolean {
  return !!source?.gamepad?.buttons[index]?.pressed;
}

function isRightHand(hand: HandState): boolean {
  if (hand.source?.handedness === "right") return true;
  if (hand.source?.handedness === "left") return false;
  return hand.index === 1;
}

function firstShownHit(): THREE.Object3D | null {
  const hits = raycaster.intersectObjects(clickables, false);
  return hits.find((hit) => isShown(hit.object))?.object ?? null;
}

function updateControllers(): void {
  let left: HandState | null = null;
  let right: HandState | null = null;
  for (const hand of hands) {
    if (isRightHand(hand)) {
      right = hand;
      const bDown = buttonDown(hand.source, 5);
      if (bDown && !hand.prevB) toggleSettings();
      hand.prevB = bDown;
    } else if (hand.source?.handedness === "left" || hand.index === 0) {
      left = hand;
    }
  }
  if (!left || !right) {
    grabbing = false;
    return;
  }
  const bothGrips = buttonDown(left.source, 1) && buttonDown(right.source, 1);
  if (!bothGrips) {
    grabbing = false;
    return;
  }
  left.group.getWorldPosition(leftPos);
  right.group.getWorldPosition(rightPos);
  handMid.copy(leftPos).add(rightPos).multiplyScalar(0.5);
  const yaw = Math.atan2(rightPos.x - leftPos.x, rightPos.z - leftPos.z);
  const handDist = Math.max(0.05, leftPos.distanceTo(rightPos));
  if (!grabbing) {
    grabOffset.copy(tableRig.position).sub(handMid);
    grabHandYaw = yaw;
    grabRigYaw = tableRig.rotation.y;
    grabScale = tableRig.scale.x;
    grabHandDist = handDist;
    grabbing = true;
    return;
  }
  const delta = yaw - grabHandYaw;
  rotatedOffset.copy(grabOffset).applyAxisAngle(upAxis, delta);
  tableRig.position.copy(handMid).add(rotatedOffset);
  tableRig.position.y = Math.max(0, tableRig.position.y);
  tableRig.rotation.y = grabRigYaw + delta;
  const nextScale = THREE.MathUtils.clamp(
    grabScale * (handDist / grabHandDist),
    MIN_TABLE_SCALE,
    MAX_TABLE_SCALE
  );
  tableRig.scale.setScalar(nextScale);
}

document.getElementById("btn-aircraft")!.addEventListener("click", () => showBoard("aircraft"));
document.getElementById("btn-ordinance")!.addEventListener("click", () => showBoard("ordinance"));
document.getElementById("btn-map")!.addEventListener("click", () => showMap());

type PlayMode = "vr" | "ar" | "screen";
let playMode: PlayMode = "screen";

function showBriefing(): void {
  startEl.hidden = true;
  hudEl.hidden = false;
  lightbox.hidden = true;
}

function applyPlayMode(mode: PlayMode): void {
  playMode = mode;
  const ar = mode === "ar";
  room.visible = !ar;
  scene.background = ar ? null : roomBackground;
  scene.fog = ar ? null : roomFog;
  renderer.setClearColor(0x000000, ar ? 0 : 1);
}

async function startImmersive(mode: "immersive-vr" | "immersive-ar"): Promise<void> {
  const xr = navigator.xr;
  if (!xr) {
    setVrNote("This browser cannot start a VR or AR session.");
    return;
  }
  try {
    renderer.xr.setReferenceSpaceType("local-floor");
    const session = await xr.requestSession(mode, {
      requiredFeatures: ["local-floor"],
    });
    applyPlayMode(mode === "immersive-ar" ? "ar" : "vr");
    showBriefing();
    await renderer.xr.setSession(session);
  } catch {
    applyPlayMode("screen");
    setVrNote(
      mode === "immersive-ar"
        ? "AR did not start. Use a headset browser that supports immersive AR."
        : "VR did not start. Use a headset browser that supports immersive VR."
    );
  }
}

vrButton.addEventListener("click", () => {
  void startImmersive("immersive-vr");
});
arButton.addEventListener("click", () => {
  void startImmersive("immersive-ar");
});
document.getElementById("btn-preview")!.addEventListener("click", () => {
  applyPlayMode("screen");
  showBriefing();
});

// The Quest app icon is the user gesture. The store build should enter VR
// immediately; the browser site keeps the landing menu.
if ("getDigitalGoodsService" in window) {
  void startImmersive("immersive-vr");
}

void (async () => {
  const xr = navigator.xr;
  if (!xr) {
    vrButton.disabled = true;
    arButton.disabled = true;
    setVrNote("This browser has no WebXR. Preview on screen is available.");
    return;
  }
  const vrOk = await xr.isSessionSupported("immersive-vr").catch(() => false);
  const arOk = await xr.isSessionSupported("immersive-ar").catch(() => false);
  vrButton.disabled = !vrOk;
  arButton.disabled = !arOk;
  if (vrOk && arOk) setVrNote("Headset ready for VR and AR.");
  else if (vrOk) setVrNote("VR is available. AR is not supported in this browser.");
  else if (arOk) setVrNote("AR is available. VR is not supported in this browser.");
  else setVrNote("No headset session in this browser. Preview on screen is available.");
})();

/** Authored layout: the player stands at the origin facing -Z, table center 1.45 m ahead. */
const TABLE_DISTANCE = 1.45;
let placeInFront = false;
const headQuat = new THREE.Quaternion();
const lookDir = new THREE.Vector3();

function placeBriefingInFront(transform: XRRigidTransform): void {
  lookDir.set(0, 0, -1).applyQuaternion(
    headQuat.set(transform.orientation.x, transform.orientation.y, transform.orientation.z, transform.orientation.w)
  );
  lookDir.y = 0;
  if (lookDir.lengthSq() < 1e-4) lookDir.set(0, 0, -1);
  else lookDir.normalize();
  const yaw = Math.atan2(-lookDir.x, -lookDir.z);
  const x = transform.position.x;
  const z = transform.position.z;
  room.position.set(x, 0, z);
  room.rotation.set(0, yaw, 0);
  tableRig.position.set(x + lookDir.x * TABLE_DISTANCE, 0, z + lookDir.z * TABLE_DISTANCE);
  tableRig.rotation.set(0, yaw, 0);
  tableRig.scale.setScalar(1);
  grabbing = false;
}

function resetBriefingLayout(): void {
  room.position.set(0, 0, 0);
  room.rotation.set(0, 0, 0);
  tableRig.position.set(0, 0, -TABLE_DISTANCE);
  tableRig.rotation.set(0, 0, 0);
  tableRig.scale.setScalar(1);
  grabbing = false;
}

renderer.xr.addEventListener("sessionstart", () => {
  controls.enabled = false;
  lightbox.hidden = true;
  applyPlayMode(playMode);
  placeInFront = true;
});
renderer.xr.addEventListener("sessionend", () => {
  controls.enabled = true;
  placeInFront = false;
  resetBriefingLayout();
  applyPlayMode("screen");
});

window.addEventListener("keydown", (ev) => {
  if (startEl.hidden === false) return;
  if (ev.key === "1") showBoard("aircraft");
  if (ev.key === "2") showBoard("ordinance");
  if (ev.key === "Escape" || ev.key === "0") showMap();
  if (ev.key === "b" || ev.key === "B") toggleSettings();
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const cueClock = new THREE.Clock();

renderer.setAnimationLoop((_time, frame) => {
  pulseCueButtons(cueClock.getElapsedTime());
  if (placeInFront && frame) {
    const refSpace = renderer.xr.getReferenceSpace();
    const pose = refSpace ? frame.getViewerPose(refSpace) : null;
    if (pose) {
      placeInFront = false;
      placeBriefingInFront(pose.transform);
    }
  }
  if (!renderer.xr.isPresenting) controls.update();
  if (renderer.xr.isPresenting) {
    revealLoadedControllers();
    updateControllers();
  }
  renderer.render(scene, camera);
});

function setVrNote(text: string): void {
  const note = document.getElementById("vr-note");
  if (note) note.textContent = text;
}

function buildRoom(parent: THREE.Object3D): void {
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x6e6a66, roughness: 0.95 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8d8984, roughness: 0.9 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  parent.add(floor);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.2), wallMat);
  back.position.set(0, 1.6, -3.2);
  parent.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), wallMat);
  left.position.set(-3.2, 1.6, -0.4);
  left.rotation.y = Math.PI / 2;
  parent.add(left);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), wallMat);
  right.position.set(3.2, 1.6, -0.4);
  right.rotation.y = -Math.PI / 2;
  parent.add(right);

  const sign = makePlate("Al-Rimal", "#d9d4cc", "#1a1a1a", 768, 220);
  sign.scale.set(1.15, 0.32, 1);
  sign.position.set(0, 2.78, -3.18);
  parent.add(sign);
}

function buildProjector(): THREE.Group {
  const g = new THREE.Group();
  g.position.set(0, 1.62, -3.12);
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(SCREEN_W + 0.14, SCREEN_H + 0.14, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7, metalness: 0.15 })
  );
  frame.castShadow = true;
  g.add(frame);
  const image = new THREE.Mesh(
    new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
    new THREE.MeshBasicMaterial({ color: 0x2a2a2a })
  );
  image.position.z = 0.03;
  image.name = "screen";
  g.add(image);
  const close = makePlate("Close", "#3a3126", "#f4efe6", 512, 160);
  close.scale.set(0.32, 0.1, 1);
  close.position.set(0, -(SCREEN_H / 2) - 0.12, 0.03);
  close.name = "close";
  close.visible = false;
  g.add(close);
  return g;
}

function buildTable(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(1.85, 0.06, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.55, metalness: 0.2 })
  );
  top.position.y = TABLE_TOP - 0.03;
  top.receiveShadow = true;
  top.castShadow = true;
  g.add(top);
  const legMat = new THREE.MeshStandardMaterial({ color: 0xb7b7b7, metalness: 0.6, roughness: 0.35 });
  for (const x of [-0.78, 0.78]) {
    for (const z of [-0.68, 0.68]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, TABLE_TOP - 0.06, 0.06), legMat);
      leg.position.set(x, (TABLE_TOP - 0.06) / 2, z);
      leg.castShadow = true;
      g.add(leg);
    }
  }
  return g;
}

function makeClipboard(): THREE.Group {
  const g = new THREE.Group();
  g.position.set(-0.68, TABLE_TOP + 0.01, 0.58);
  g.rotation.x = -Math.PI / 2;

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.75 })
  );
  board.castShadow = true;
  g.add(board);

  const paper = document.createElement("canvas");
  paper.width = 512;
  paper.height = 680;
  const ctx = paper.getContext("2d")!;
  ctx.fillStyle = "#f7f1e4";
  ctx.fillRect(0, 0, paper.width, paper.height);
  ctx.strokeStyle = "#d9d0c0";
  ctx.lineWidth = 2;
  for (let y = 210; y < paper.height - 30; y += 52) {
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(paper.width - 36, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#1c1a17";
  ctx.font = "700 54px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Note", paper.width / 2, 168);
  ctx.font = "600 40px Segoe UI, sans-serif";
  const lines = [
    "The numbers below",
    "the Ordinance title",
    "is the Bomb Damage.",
  ];
  lines.forEach((line, i) => ctx.fillText(line, paper.width / 2, 280 + i * 78));
  const tex = new THREE.CanvasTexture(paper);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.34),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  sheet.position.z = 0.008;
  g.add(sheet);

  const clip = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.045, 0.016),
    new THREE.MeshStandardMaterial({ color: 0xc5c8cc, metalness: 0.75, roughness: 0.3 })
  );
  clip.position.set(0, 0.16, 0.012);
  g.add(clip);
  return g;
}

function makeButton(label: string, x: number, z: number): THREE.Mesh {
  const width = 0.34;
  const depth = 0.1;
  const glowW = width + 0.04;
  const glowD = depth + 0.04;
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xe2b15a,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  glow.scale.set(glowW, glowD, 1);
  glow.position.set(x, TABLE_TOP + 0.004, z);
  glow.rotation.x = -Math.PI / 2;
  glow.renderOrder = 1;
  glow.name = `${label.toLowerCase()}-cue`;
  tableRig.add(glow);

  const mesh = makePlate(label, "#3a3126", "#f4efe6", 640, 200);
  mesh.scale.set(width, depth, 1);
  mesh.position.set(x, TABLE_TOP + 0.01, z);
  // Lay flat on the tabletop, text readable from the near edge.
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  mesh.userData.board = label.toLowerCase();
  mesh.name = label.toLowerCase();
  cueButtons.push({
    id: label.toLowerCase() as BoardId,
    plate: mesh,
    glow,
    width: glowW,
    depth: glowD,
    seen: false,
  });
  return mesh;
}

/** Each plate blinks on its own until that image has been opened once. */
function pulseCueButtons(elapsed: number): void {
  const flash = elapsed % 1 < 0.55 ? 1 : 0;
  for (const cue of cueButtons) {
    if (cue.seen) continue;
    const plateMat = cue.plate.material as THREE.MeshBasicMaterial;
    plateMat.color.setRGB(1, 1 - 0.42 * flash, 1 - 0.72 * flash);
    const glowMat = cue.glow.material as THREE.MeshBasicMaterial;
    glowMat.opacity = flash > 0 ? 1 : 0.04;
  }
}

function dismissCue(id: BoardId): void {
  const cue = cueButtons.find((item) => item.id === id);
  if (!cue || cue.seen) return;
  cue.seen = true;
  (cue.plate.material as THREE.MeshBasicMaterial).color.setRGB(1, 1, 1);
  cue.glow.visible = false;
}

function resetCues(): void {
  for (const cue of cueButtons) {
    cue.seen = false;
    cue.glow.visible = true;
    (cue.plate.material as THREE.MeshBasicMaterial).color.setRGB(1, 1, 1);
  }
}

function makePlate(
  label: string,
  bg: string,
  fg: string,
  w: number,
  h: number
): THREE.Mesh {
  const canvas2d = document.createElement("canvas");
  canvas2d.width = w;
  canvas2d.height = h;
  const ctx = canvas2d.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#e2b15a";
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = fg;
  ctx.font = `700 ${Math.floor(h * 0.42)}px Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas2d);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
  );
  return mesh;
}
