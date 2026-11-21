/**
 * Pure rules and seeded maze generator for the colour-fill swipe puzzle.
 * No DOM, no Three.js, no timers: every rule and level is deterministic and unit-tested.
 */

export type Direction = "up" | "down" | "left" | "right";

export interface Cell {
  r: number;
  c: number;
}

export interface Level {
  seed: number;
  rows: number;
  cols: number;
  /** True where a raised wall blocks the ball; false where floor can be painted. */
  walls: boolean[][];
  start: Cell;
  /** Bonus star pickups placed on floor cells. */
  stars: Cell[];
  /** A verified winning sequence of swipes. */
  solution: Direction[];
  /** Swipe budget for the level. */
  moves: number;
  totalFloor: number;
}

export const GRID_SIZE = 6;
export const MOVE_SLACK = 3;

export const DIRS: readonly Direction[] = ["up", "down", "left", "right"];

export const DELTA: Record<Direction, Cell> = {
  up: { r: -1, c: 0 },
  down: { r: 1, c: 0 },
  left: { r: 0, c: -1 },
  right: { r: 0, c: 1 },
};

/** Small seeded PRNG (mulberry32). Returns numbers in [0, 1). */
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

export function inBounds(rows: number, cols: number, r: number, c: number): boolean {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

/** Trace a slide from `from` in `dir` until hitting a wall or grid boundary. */
export function traceSlide(walls: readonly (readonly boolean[])[], from: Cell, dir: Direction): Cell[] {
  const rows = walls.length;
  const cols = walls[0]?.length ?? 0;
  const { r: dr, c: dc } = DELTA[dir];
  const path: Cell[] = [];
  let r = from.r;
  let c = from.c;
  for (;;) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inBounds(rows, cols, nr, nc) || walls[nr]?.[nc]) break;
    r = nr;
    c = nc;
    path.push({ r, c });
  }
  return path;
}

/**
 * Carve a guaranteed-solvable paint-roll maze by walking slide segments on a grid.
 * Whenever a segment stops short of the grid edge, a stopper wall is kept in front of it
 * (so the ball will stop at that exact cell during play).
 */
export function generateLevel(seed: number, size: number = GRID_SIZE, slack: number = MOVE_SLACK): Level {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rand = mulberry32(((seed + 1) * 2654435761 + attempt * 1013904223) >>> 0);
    const floor = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    const lockedWall = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

    const start: Cell = {
      r: rand() < 0.5 ? 0 : size - 1,
      c: rand() < 0.5 ? 0 : size - 1,
    };
    floor[start.r]![start.c] = true;

    let cur = { ...start };
    let lastDir: Direction | null = null;
    const solution: Direction[] = [];
    const targetSteps = 8 + Math.floor(rand() * 4); // 8..11 swipes

    for (let step = 0; step < targetSteps * 3 && solution.length < targetSteps; step += 1) {
      const candidates = DIRS.filter((d) => {
        if (d === lastDir) return false;
        if (lastDir === "up" && d === "down") return false;
        if (lastDir === "down" && d === "up") return false;
        if (lastDir === "left" && d === "right") return false;
        if (lastDir === "right" && d === "left") return false;
        return true;
      });
      // Shuffle candidates deterministically
      for (let i = candidates.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = candidates[i]!;
        candidates[i] = candidates[j]!;
        candidates[j] = tmp;
      }

      let moved = false;
      for (const dir of candidates) {
        const { r: dr, c: dc } = DELTA[dir];
        // Find max steps we can take before hitting an edge or a lockedWall
        let maxLen = 0;
        while (
          inBounds(size, size, cur.r + dr * (maxLen + 1), cur.c + dc * (maxLen + 1)) &&
          !lockedWall[cur.r + dr * (maxLen + 1)]![cur.c + dc * (maxLen + 1)]
        ) {
          maxLen += 1;
        }
        if (maxLen < 2) continue;

        // Pick a valid stopping length L in [2..maxLen] where the cell right after L is either out of bounds or not already floor
        const validLens: number[] = [];
        for (let len = 2; len <= maxLen; len += 1) {
          const stopR = cur.r + dr * (len + 1);
          const stopC = cur.c + dc * (len + 1);
          if (!inBounds(size, size, stopR, stopC) || !floor[stopR]![stopC]) {
            // Check how many new cells this segment carves
            let newly = 0;
            for (let k = 1; k <= len; k += 1) {
              if (!floor[cur.r + dr * k]![cur.c + dc * k]) newly += 1;
            }
            if (newly >= 2 || (solution.length > 0 && newly >= 1)) validLens.push(len);
          }
        }
        if (validLens.length === 0) continue;

        // First swipe prefers a long satisfying corridor (>= 3 cells)
        const preferred = solution.length === 0 ? validLens.filter((l) => l >= 3) : validLens;
        const pool = preferred.length > 0 ? preferred : validLens;
        const len = pool[Math.floor(rand() * pool.length)]!;

        for (let k = 1; k <= len; k += 1) {
          floor[cur.r + dr * k]![cur.c + dc * k] = true;
        }
        const stopR = cur.r + dr * (len + 1);
        const stopC = cur.c + dc * (len + 1);
        if (inBounds(size, size, stopR, stopC)) {
          lockedWall[stopR]![stopC] = true;
        }

        cur = { r: cur.r + dr * len, c: cur.c + dc * len };
        lastDir = dir;
        solution.push(dir);
        moved = true;
        break;
      }
      if (!moved) break;
    }

    const walls = floor.map((row) => row.map((isFloor) => !isFloor));
    let totalFloor = 0;
    const floorCells: Cell[] = [];
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!walls[r]![c]) {
          totalFloor += 1;
          if (r !== start.r || c !== start.c) floorCells.push({ r, c });
        }
      }
    }

    if (solution.length < 7 || totalFloor < 17 || totalFloor > 28) continue;

    // Verify replaying `solution` paints 100% of floor cells!
    const verify = new PaintGame({
      seed,
      rows: size,
      cols: size,
      walls,
      start,
      stars: [],
      solution,
      moves: solution.length + slack,
      totalFloor,
    });
    let ok = true;
    for (const dir of solution) {
      const res = verify.slide(dir);
      if (!res.moved) {
        ok = false;
        break;
      }
    }
    if (!ok || verify.outcome !== "won") continue;

    // Pick 3 spaced-out bonus star cells on floor tiles
    const stars: Cell[] = [];
    for (let i = 0; i < 3 && floorCells.length > 0; i += 1) {
      const idx = Math.floor(rand() * floorCells.length);
      const cell = floorCells.splice(idx, 1)[0];
      if (cell) stars.push(cell);
    }

    return {
      seed,
      rows: size,
      cols: size,
      walls,
      start,
      stars,
      solution,
      moves: solution.length + slack,
      totalFloor,
    };
  }
  throw new Error(`failed to generate paint-roll level for seed ${seed}`);
}

export type Outcome = "playing" | "won" | "lost";

export interface SlideResult {
  moved: boolean;
  from: Cell;
  to: Cell;
  path: Cell[];
  newlyPainted: Cell[];
  starsHit: Cell[];
  points: number;
  streak: number;
  /** True once per round when at least 50% of floor tiles are painted. */
  milestone: boolean;
  remaining: number;
  movesLeft: number;
  outcome: Outcome;
}

export class PaintGame {
  r: number;
  c: number;
  readonly painted: boolean[][];
  readonly starsCollected: boolean[];
  paintedCount = 1;
  movesLeft: number;
  movesMade = 0;
  score = 0;
  streak = 0;
  outcome: Outcome = "playing";
  private milestoneDone = false;

  constructor(
    readonly level: Level,
    bonusMoves = 0,
  ) {
    this.r = level.start.r;
    this.c = level.start.c;
    this.painted = Array.from({ length: level.rows }, () => Array<boolean>(level.cols).fill(false));
    this.painted[this.r]![this.c] = true;
    this.starsCollected = level.stars.map(() => false);
    this.movesLeft = level.moves + bonusMoves;
  }

  get remaining(): number {
    return Math.max(0, this.level.totalFloor - this.paintedCount);
  }

  get progress(): number {
    return this.level.totalFloor > 0 ? this.paintedCount / this.level.totalFloor : 1;
  }

  /** Slide in `dir`. When `free` is true (auto-demo), no move is spent. */
  slide(dir: Direction, free = false): SlideResult {
    const from: Cell = { r: this.r, c: this.c };
    if (this.outcome !== "playing") {
      return {
        moved: false,
        from,
        to: from,
        path: [],
        newlyPainted: [],
        starsHit: [],
        points: 0,
        streak: this.streak,
        milestone: false,
        remaining: this.remaining,
        movesLeft: this.movesLeft,
        outcome: this.outcome,
      };
    }

    const path = traceSlide(this.level.walls, from, dir);
    if (path.length === 0) {
      return {
        moved: false,
        from,
        to: from,
        path: [],
        newlyPainted: [],
        starsHit: [],
        points: 0,
        streak: this.streak,
        milestone: false,
        remaining: this.remaining,
        movesLeft: this.movesLeft,
        outcome: this.outcome,
      };
    }

    const newlyPainted: Cell[] = [];
    const starsHit: Cell[] = [];
    for (const cell of path) {
      if (!this.painted[cell.r]![cell.c]) {
        this.painted[cell.r]![cell.c] = true;
        this.paintedCount += 1;
        newlyPainted.push(cell);
      }
      this.level.stars.forEach((star, idx) => {
        if (!this.starsCollected[idx] && star.r === cell.r && star.c === cell.c) {
          this.starsCollected[idx] = true;
          starsHit.push(star);
        }
      });
    }

    const to = path[path.length - 1]!;
    this.r = to.r;
    this.c = to.c;

    if (!free) {
      this.movesLeft -= 1;
      this.movesMade += 1;
    }

    if (newlyPainted.length > 0) {
      this.streak = newlyPainted.length >= 2 ? this.streak + 1 : 0;
    } else {
      this.streak = 0;
    }

    const mult = Math.min(4, 1 + Math.floor(this.streak / 2));
    const points = (newlyPainted.length * 10 + starsHit.length * 50) * mult;
    this.score += points;

    let milestone = false;
    if (!this.milestoneDone && this.remaining > 0 && this.progress >= 0.5) {
      this.milestoneDone = true;
      milestone = true;
    }

    if (this.remaining === 0) {
      this.outcome = "won";
    } else if (!free && this.movesLeft <= 0) {
      this.outcome = "lost";
    }

    return {
      moved: true,
      from,
      to,
      path,
      newlyPainted,
      starsHit,
      points,
      streak: this.streak,
      milestone,
      remaining: this.remaining,
      movesLeft: this.movesLeft,
      outcome: this.outcome,
    };
  }

  /** Pick a helpful direction for the opening demo or an idle hint. */
  hintDirection(): Direction | null {
    if (this.outcome !== "playing") return null;
    let bestDir: Direction | null = null;
    let bestNew = -1;
    let bestLen = -1;
    for (const dir of DIRS) {
      const path = traceSlide(this.level.walls, { r: this.r, c: this.c }, dir);
      if (path.length === 0) continue;
      const fresh = path.filter((cell) => !this.painted[cell.r]![cell.c]).length;
      if (fresh > bestNew || (fresh === bestNew && path.length > bestLen)) {
        bestNew = fresh;
        bestLen = path.length;
        bestDir = dir;
      }
    }
    return bestDir;
  }
}

export function starsFor(won: boolean, movesLeft: number, progress: number): 1 | 2 | 3 {
  if (won) return movesLeft >= 2 ? 3 : 2;
  return progress >= 0.8 ? 2 : 1;
}

export function nearWinMessage(remaining: number, movesLeft: number): string | null {
  if (remaining <= 0) return null;
  if (remaining === 1) return "1 TILE LEFT!";
  if (remaining <= 3) return `${remaining} TILES LEFT!`;
  if (movesLeft <= 3) return `${movesLeft} ${movesLeft === 1 ? "MOVE" : "MOVES"} LEFT`;
  return null;
}
