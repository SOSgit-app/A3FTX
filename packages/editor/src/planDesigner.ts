import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  BUILDING_HEX,
  createPreset,
  normalizeCells,
  presetExtent,
  type BuildingColor,
  type BuildingPreset,
  type BuildingSpecial,
  type StackCell,
} from "@a3-ftx/shared";

export interface DesignerCallbacks {
  onSave(preset: BuildingPreset): void;
  onDelete(id: string): void;
}

const MAX_H = 8;

/**
 * Modal for designing a building plan: a square grid where each cell holds a
 * stack height (north at the top), plus a live isometric 3D preview.
 */
export class PlanDesigner {
  private root: HTMLElement;
  private gridEl: HTMLElement;
  private nameEl: HTMLInputElement;
  private colorEl: HTMLSelectElement;
  private specialEl: HTMLSelectElement;
  private sizeEl: HTMLSelectElement;
  private deleteBtn: HTMLButtonElement;
  private statusEl: HTMLElement;

  private size = 5;
  private heights: number[][] = [];
  private editingId: string | null = null;
  private open_ = false;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private blocks = new THREE.Group();
  private rafId = 0;

  constructor(
    root: HTMLElement,
    private callbacks: DesignerCallbacks
  ) {
    this.root = root;
    this.gridEl = root.querySelector("#plan-grid")!;
    this.nameEl = root.querySelector("#plan-name")!;
    this.colorEl = root.querySelector("#plan-color")!;
    this.specialEl = root.querySelector("#plan-special")!;
    this.sizeEl = root.querySelector("#plan-size")!;
    this.deleteBtn = root.querySelector("#plan-delete")!;
    this.statusEl = root.querySelector("#plan-status")!;

    const canvas = root.querySelector<HTMLCanvasElement>("#plan-preview")!;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x2a2218);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.scene.add(new THREE.HemisphereLight(0xffe6c0, 0x443322, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.0);
    sun.position.set(6, 10, 4);
    this.scene.add(sun);
    this.scene.add(this.blocks);

    this.wire();
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(preset?: BuildingPreset): void {
    this.editingId = preset?.id ?? null;
    this.nameEl.value = preset?.name ?? "";
    this.colorEl.value = preset?.defaultColor ?? "red";
    this.specialEl.value = preset?.special ?? "";
    this.deleteBtn.classList.toggle("hidden", !preset);
    this.statusEl.textContent = "";

    const ext = preset ? presetExtent(preset.cells) : { w: 0, d: 0 };
    this.size = Math.min(10, Math.max(5, ext.w, ext.d));
    this.sizeEl.value = String(this.size);
    this.resetHeights();
    if (preset) {
      for (const c of normalizeCells(preset.cells)) {
        if (c.x < this.size && c.z < this.size) {
          this.heights[c.z][c.x] = c.height;
        }
      }
    } else {
      // Default: a 2×2 block at height 2 to start from
      this.heights[1][1] = 2;
      this.heights[1][2] = 2;
      this.heights[2][1] = 2;
      this.heights[2][2] = 2;
    }

    this.root.classList.remove("hidden");
    this.open_ = true;
    this.renderGrid();
    this.resizePreview();
    this.frameCamera();
    this.rebuildPreview();
    this.loop();
    this.nameEl.focus();
  }

  close(): void {
    this.root.classList.add("hidden");
    this.open_ = false;
    cancelAnimationFrame(this.rafId);
  }

  // ---------- internals ----------

  private resetHeights(): void {
    this.heights = Array.from({ length: this.size }, () =>
      Array.from({ length: this.size }, () => 0)
    );
  }

  private cells(): StackCell[] {
    const out: StackCell[] = [];
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        const h = this.heights[z][x];
        if (h > 0) out.push({ x, z, height: h });
      }
    }
    return out;
  }

  private wire(): void {
    this.root.querySelector("#designer-close")!.addEventListener("click", () =>
      this.close()
    );
    this.root.querySelector("#plan-cancel")!.addEventListener("click", () =>
      this.close()
    );
    this.root.addEventListener("click", (ev) => {
      if (ev.target === this.root) this.close();
    });

    this.sizeEl.addEventListener("change", () => {
      const newSize = Number(this.sizeEl.value);
      const old = this.heights;
      this.size = newSize;
      this.resetHeights();
      for (let z = 0; z < Math.min(old.length, newSize); z++) {
        for (let x = 0; x < Math.min(old[z].length, newSize); x++) {
          this.heights[z][x] = old[z][x];
        }
      }
      this.renderGrid();
      this.frameCamera();
      this.rebuildPreview();
    });

    this.colorEl.addEventListener("change", () => this.rebuildPreview());

    this.root.querySelector("#plan-clear")!.addEventListener("click", () => {
      this.resetHeights();
      this.renderGrid();
      this.rebuildPreview();
    });

    this.root.querySelector("#plan-raise")!.addEventListener("click", () =>
      this.shiftAll(1)
    );
    this.root.querySelector("#plan-lower")!.addEventListener("click", () =>
      this.shiftAll(-1)
    );

    this.root.querySelector("#plan-save")!.addEventListener("click", () =>
      this.save()
    );
    this.deleteBtn.addEventListener("click", () => {
      if (!this.editingId) return;
      this.callbacks.onDelete(this.editingId);
      this.close();
    });

    this.gridEl.addEventListener("contextmenu", (ev) => ev.preventDefault());
    this.gridEl.addEventListener("pointerdown", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>(
        "[data-x]"
      );
      if (!btn) return;
      ev.preventDefault();
      const x = Number(btn.dataset.x);
      const z = Number(btn.dataset.z);
      const delta = ev.button === 2 || ev.shiftKey ? -1 : 1;
      this.heights[z][x] = Math.max(
        0,
        Math.min(MAX_H, this.heights[z][x] + delta)
      );
      this.renderGrid();
      this.rebuildPreview();
    });

    window.addEventListener("resize", () => {
      if (this.open_) this.resizePreview();
    });
    window.addEventListener("keydown", (ev) => {
      if (this.open_ && ev.key === "Escape") this.close();
    });
  }

  private shiftAll(delta: number): void {
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        if (this.heights[z][x] > 0) {
          this.heights[z][x] = Math.max(
            1,
            Math.min(MAX_H, this.heights[z][x] + delta)
          );
        }
      }
    }
    this.renderGrid();
    this.rebuildPreview();
  }

  private save(): void {
    const name = this.nameEl.value.trim();
    const cells = this.cells();
    if (!name) {
      this.statusEl.textContent = "Give the plan a name.";
      this.nameEl.focus();
      return;
    }
    if (!cells.length) {
      this.statusEl.textContent = "Add at least one block.";
      return;
    }
    const color = this.colorEl.value as BuildingColor;
    const special = (this.specialEl.value || null) as BuildingSpecial;
    const preset = createPreset(name, cells, color, special);
    if (this.editingId) preset.id = this.editingId;
    this.callbacks.onSave(preset);
    this.close();
  }

  private renderGrid(): void {
    this.gridEl.style.gridTemplateColumns = `repeat(${this.size}, 1fr)`;
    this.gridEl.innerHTML = "";
    // Row 0 at top = north = z 0 (north is −Z)
    for (let r = 0; r < this.size; r++) {
      const z = r;
      for (let x = 0; x < this.size; x++) {
        const h = this.heights[z][x];
        const el = document.createElement("div");
        el.className = "plan-cell" + (h > 0 ? " filled" : "");
        el.dataset.x = String(x);
        el.dataset.z = String(z);
        el.textContent = h > 0 ? String(h) : "";
        if (h > 0) {
          const hex = BUILDING_HEX[this.colorEl.value as BuildingColor];
          el.style.background = hex;
          el.style.opacity = String(0.45 + Math.min(h, 6) * 0.09);
        }
        this.gridEl.appendChild(el);
      }
    }
  }

  private resizePreview(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 260;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frameCamera(): void {
    const c = this.size / 2;
    this.controls.target.set(c, 1, c);
    // Stand to the south-east, look north-west (north is −Z)
    this.camera.position.set(c + this.size * 1.1, this.size * 1.1, c + this.size * 1.1);
    this.controls.update();
  }

  private rebuildPreview(): void {
    while (this.blocks.children.length) {
      const child = this.blocks.children[0];
      this.blocks.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
        else m.material?.dispose();
      });
    }

    // Ground grid for orientation
    const grid = new THREE.GridHelper(this.size, this.size, 0x7a6648, 0x5a4a34);
    grid.position.set(this.size / 2, 0, this.size / 2);
    this.blocks.add(grid);

    // North marker
    const nCanvas = document.createElement("canvas");
    nCanvas.width = nCanvas.height = 64;
    const ctx = nCanvas.getContext("2d")!;
    ctx.fillStyle = "#f1c40f";
    ctx.font = "bold 48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", 32, 32);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(nCanvas),
        transparent: true,
      })
    );
    sprite.scale.set(0.8, 0.8, 1);
    sprite.position.set(this.size / 2, 0.5, -0.5); // north edge
    this.blocks.add(sprite);

    const hex = BUILDING_HEX[this.colorEl.value as BuildingColor];
    const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7 });
    const size = 1;
    const geo = new THREE.BoxGeometry(size, size, size);
    const edges = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x111111 });

    for (const c of this.cells()) {
      for (let y = 0; y < c.height; y++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(c.x + 0.5, size / 2 + y * size, c.z + 0.5);
        mesh.add(new THREE.LineSegments(edges, edgeMat));
        this.blocks.add(mesh);
      }
    }
  }

  private loop = (): void => {
    if (!this.open_) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.loop);
  };
}
