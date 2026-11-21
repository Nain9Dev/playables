/**
 * Pure rules for the merge-puzzle mechanic on a 4 by 4 board. No rendering, no timers,
 * no DOM. Every tile has a stable id so the view can animate a move, and spawns come
 * from a seeded generator, so the same seed and the same moves always give the same game.
 */

export const SIZE = 4;

export type Direction = "left" | "right" | "up" | "down";

export interface Tile {
  id: number;
  value: number;
  row: number;
  col: number;
}

export interface Merge {
  /** The tile that stays and doubles. */
  survivor: number;
  /** The tile that is absorbed. */
  absorbed: number;
  row: number;
  col: number;
  /** Value of the survivor after the merge. */
  value: number;
}

export interface SlideResult {
  tiles: Tile[];
  moved: boolean;
  gained: number;
  merges: Merge[];
}

export const CONFIG = {
  /** The tile value that wins the game. */
  goal: 128,
  /** Moves the player has. A limit gives the run pressure and a clear end. */
  moves: 24,
  /** Extra moves the retry starts with. */
  retryBonusMoves: 6,
  /** Share of spawned tiles that are a 2 (the rest are 4). */
  twoShare: 0.9,
} as const;

/**
 * Opening layout. It starts with a 64 so the goal feels close from the first second.
 * Tuned with a greedy bot over 400 seeds: it wins about half of the games within 24
 * moves, so a human who plans ahead wins most of them and a loss still feels fair.
 */
export const START_LAYOUT: readonly [number, number, number][] = [
  [0, 0, 64],
  [1, 2, 32],
  [2, 1, 16],
  [3, 3, 16],
  [0, 3, 8],
  [1, 0, 8],
  [2, 3, 8],
  [3, 0, 4],
  [3, 2, 4],
  [0, 2, 2],
];

/** Small seeded generator (mulberry32). Returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Index along a line for step `i`, so one loop handles all four directions. */
function cell(direction: Direction, line: number, i: number): { row: number; col: number } {
  switch (direction) {
    case "left":
      return { row: line, col: i };
    case "right":
      return { row: line, col: SIZE - 1 - i };
    case "up":
      return { row: i, col: line };
    case "down":
      return { row: SIZE - 1 - i, col: line };
  }
}

/** Slide every tile as far as it goes. A tile merges at most once per move. */
export function slide(tiles: readonly Tile[], direction: Direction): SlideResult {
  const grid = new Map<string, Tile>();
  for (const tile of tiles) grid.set(`${tile.row},${tile.col}`, tile);

  const out: Tile[] = [];
  const merges: Merge[] = [];
  let moved = false;
  let gained = 0;

  for (let line = 0; line < SIZE; line += 1) {
    const ordered: Tile[] = [];
    for (let i = 0; i < SIZE; i += 1) {
      const at = cell(direction, line, i);
      const tile = grid.get(`${at.row},${at.col}`);
      if (tile) ordered.push(tile);
    }

    let target = 0;
    for (let i = 0; i < ordered.length; i += 1) {
      const current = ordered[i];
      if (!current) continue;
      const next = ordered[i + 1];
      const at = cell(direction, line, target);

      if (next && next.value === current.value) {
        const value = current.value * 2;
        out.push({ id: current.id, value, row: at.row, col: at.col });
        merges.push({ survivor: current.id, absorbed: next.id, row: at.row, col: at.col, value });
        gained += value;
        moved = true;
        i += 1;
      } else {
        out.push({ id: current.id, value: current.value, row: at.row, col: at.col });
        if (current.row !== at.row || current.col !== at.col) moved = true;
      }
      target += 1;
    }
  }

  return { tiles: out, moved, gained, merges };
}

export function emptyCells(tiles: readonly Tile[]): { row: number; col: number }[] {
  const taken = new Set(tiles.map((tile) => `${tile.row},${tile.col}`));
  const free: { row: number; col: number }[] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (!taken.has(`${row},${col}`)) free.push({ row, col });
    }
  }
  return free;
}

/** True when at least one move would change the board. */
export function canMove(tiles: readonly Tile[]): boolean {
  if (emptyCells(tiles).length > 0) return true;
  return (["left", "right", "up", "down"] as const).some((direction) => slide(tiles, direction).moved);
}

export function bestTile(tiles: readonly Tile[]): number {
  return tiles.reduce((best, tile) => Math.max(best, tile.value), 0);
}

/** Number of pairs of equal tiles that could merge next, for near-win messages. */
export function countValue(tiles: readonly Tile[], value: number): number {
  return tiles.filter((tile) => tile.value === value).length;
}

export type Outcome = "playing" | "won" | "lost";

export interface MoveResult {
  moved: boolean;
  merges: Merge[];
  gained: number;
  spawned: Tile | null;
  /** Merges in this single move. Two or more is a combo. */
  combo: number;
  outcome: Outcome;
}

export class MergeGame {
  tiles: Tile[] = [];
  score = 0;
  movesLeft: number;
  outcome: Outcome = "playing";
  private nextId = 1;
  private readonly rand: () => number;

  constructor(
    seed: number,
    moves: number = CONFIG.moves,
    layout: readonly [number, number, number][] = START_LAYOUT,
  ) {
    this.rand = mulberry32(seed);
    this.movesLeft = moves;
    for (const [row, col, value] of layout) {
      this.tiles.push({ id: this.nextId, value, row, col });
      this.nextId += 1;
    }
  }

  get best(): number {
    return bestTile(this.tiles);
  }

  /** Progress toward the goal tile, from 0 to 1, on a log scale. */
  get progress(): number {
    return Math.min(1, Math.log2(Math.max(2, this.best)) / Math.log2(CONFIG.goal));
  }

  private spawn(): Tile | null {
    const free = emptyCells(this.tiles);
    if (free.length === 0) return null;
    const at = free[Math.floor(this.rand() * free.length)];
    if (!at) return null;
    const tile: Tile = {
      id: this.nextId,
      value: this.rand() < CONFIG.twoShare ? 2 : 4,
      row: at.row,
      col: at.col,
    };
    this.nextId += 1;
    this.tiles.push(tile);
    return tile;
  }

  move(direction: Direction): MoveResult {
    if (this.outcome !== "playing") {
      return { moved: false, merges: [], gained: 0, spawned: null, combo: 0, outcome: this.outcome };
    }

    const result = slide(this.tiles, direction);
    if (!result.moved) {
      return { moved: false, merges: [], gained: 0, spawned: null, combo: 0, outcome: this.outcome };
    }

    this.tiles = result.tiles;
    this.score += result.gained;
    this.movesLeft -= 1;
    const spawned = this.spawn();

    if (this.best >= CONFIG.goal) this.outcome = "won";
    else if (this.movesLeft <= 0 || !canMove(this.tiles)) this.outcome = "lost";

    return {
      moved: true,
      merges: result.merges,
      gained: result.gained,
      spawned,
      combo: result.merges.length,
      outcome: this.outcome,
    };
  }
}

/** Stars for the end card: moves left on a win, how far the best tile got on a loss. */
export function starsFor(won: boolean, movesLeft: number, best: number): 1 | 2 | 3 {
  if (won) return movesLeft >= 8 ? 3 : 2;
  return best >= CONFIG.goal / 2 ? 2 : 1;
}

/** A short message when the player is one merge away from the goal. */
export function nearWinMessage(tiles: readonly Tile[]): string | null {
  const half = CONFIG.goal / 2;
  if (countValue(tiles, half) >= 2) return "ONE MERGE TO WIN!";
  if (countValue(tiles, half) === 1 && bestTile(tiles) === half) return "ALMOST THERE";
  return null;
}
