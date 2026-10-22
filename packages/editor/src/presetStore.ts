import { presetFromBuilding, type BuildingPreset } from "@a3-ftx/shared";
import { AL_RIMAL_SEED } from "./seedMap";

/** v2: north = −Z convention. */
const KEY = "al-rimal-presets-v2";

/** Starter library derived from the seed map's building shapes. */
export function seedPresets(): BuildingPreset[] {
  const seen = new Set<string>();
  const out: BuildingPreset[] = [];
  for (const b of AL_RIMAL_SEED.buildings) {
    const p = presetFromBuilding(b, b.label ?? b.id);
    const sig = JSON.stringify(p.cells);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(p);
  }
  return out;
}

export function loadPresets(): BuildingPreset[] {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw) as BuildingPreset[];
      if (Array.isArray(data)) return data;
    } catch {
      /* fall through */
    }
  }
  const seeded = seedPresets();
  savePresets(seeded);
  return seeded;
}

export function savePresets(presets: BuildingPreset[]): void {
  localStorage.setItem(KEY, JSON.stringify(presets));
}

export function parsePresetsJson(raw: string): BuildingPreset[] {
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data)) throw new Error("Plans file must be a JSON array");
  for (const p of data as BuildingPreset[]) {
    if (!p.id || !p.name || !Array.isArray(p.cells)) {
      throw new Error("Invalid plan entry");
    }
  }
  return data as BuildingPreset[];
}
