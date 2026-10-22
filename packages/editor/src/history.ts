import type { TownMap } from "@a3-ftx/shared";

const MAX = 80;

export class MapHistory {
  private past: TownMap[] = [];
  private future: TownMap[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Call before mutating `current` into a new map. */
  push(before: TownMap): void {
    this.past.push(structuredClone(before));
    if (this.past.length > MAX) this.past.shift();
    this.future = [];
  }

  undo(current: TownMap): TownMap | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(structuredClone(current));
    return prev;
  }

  redo(current: TownMap): TownMap | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(structuredClone(current));
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
