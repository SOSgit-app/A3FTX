# A3 FTX — Al-Rimal Quest VR

Live briefing: **https://sosgit-app.github.io/A3FTX/**

Two apps, one map file:

| Package | Role |
|---------|------|
| `@a3-ftx/editor` | Desktop map editor — paint multi-height block buildings, roads, vehicles, lights |
| `@a3-ftx/vr` | VR shell (stub) — WebXR room + tabletop map next |
| `@a3-ftx/shared` | `TownMap` JSON schema + Three.js `MapRenderer` |

## Setup

```bash
npm install
npm run editor
```

Opens **http://localhost:5173** — Al-Rimal Map Editor.

## Editor workflow

1. Birds-eye reference loads as a translucent overlay (adjust opacity).
2. Choose **Road** / **Building** / **Street light** / **Vehicle** / **Erase**.
3. For buildings: pick **color**, **stack height** (1–6), optional **special** (hospital / mosque / station) and **label** (A5, E3, …).
4. Left-click / drag to paint. **Select / Move** drags pieces; arrows nudge; Delete removes.
5. Right-drag to orbit; middle-drag to pan; zoom with wheel. **Ctrl+Z / Ctrl+Y** undo/redo.
6. **Export JSON** → save to `maps/al-rimal.map.json` for the VR app.
7. Edits auto-save to browser `localStorage`.

## VR briefing

```bash
npm run vr
```

Opens **http://localhost:5174** — Al-Rimal Quest.

The official town (`maps/al-rimal.map.json`) sits on the briefing table. **Aircraft** and **Ordinance** open the study boards (F-16, B-52, F/A-18 and the five munitions). **Map** closes the board. In a headset, aim the controller and pull the trigger; on desktop, use the buttons or click the plates. **Enter VR** starts an `immersive-vr` session when the browser supports it.

## Building plans (presets)

Design a building once, then stamp it anywhere:

1. **Building plans → New plan** opens the designer: a square grid (north up) where each
   square holds a stack height. Left-click +1, right-click −1. Live isometric preview.
2. Name it, pick a default color / special, **Save plan**.
3. Pick the plan in the list (or **Place plan** tool). A ghost follows the cursor;
   **R** rotates. Set color / label / special *at placement*, click to stamp.
4. **Select / Move → Save as plan** turns any building on the map into a plan.
5. **Export / Import plans** shares the library as `al-rimal.plans.json`.

Plans are stored in browser storage; the seed map's shapes are preloaded.

## Orientation

North is **−Z**: row `z = 0` is the north edge and `z` grows southward, so a
top-down view with north up has east on the right (matches the birds-eye image).

## Map schema (multi-height)

Each building is a list of footprint cells with a stack height:

```json
{
  "id": "F4",
  "color": "olive",
  "cells": [
    { "x": 3, "z": 5, "height": 3 },
    { "x": 4, "z": 5, "height": 2 }
  ]
}
```

## Reference images

- `packages/editor/public/ref/birdseye.png`
- `packages/editor/public/ref/northview.png`

## Next

Meta Quest APK packaging on top of this WebXR briefing.
