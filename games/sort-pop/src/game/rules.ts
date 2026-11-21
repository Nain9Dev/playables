/**
 * Pure rules of the ball sort puzzle. No DOM, no Three.js: everything here is
 * unit-tested. A tube is a list of color ids from the bottom to the top.
 */

export const CAPACITY = 4;

export type Tube = readonly number[];
export type Tubes = readonly Tube[];
export type Move = readonly [from: number, to: number];

/** The color on top of a tube and how many equal balls sit together on it. */
export function topRun(tube: Tube): { color: number; count: number } | null {
  const color = tube[tube.length - 1];
  if (color === undefined) return null;
  let count = 0;
  for (let i = tube.length - 1; i >= 0 && tube[i] === color; i -= 1) count += 1;
  return { color, count };
}

/** A full tube of one color. It is done and cannot be picked up again. */
export function isComplete(tube: Tube): boolean {
  return tube.length === CAPACITY && tube.every((ball) => ball === tube[0]);
}

/** Every tube is empty or complete. */
export function isSolved(tubes: Tubes): boolean {
  return tubes.every((tube) => tube.length === 0 || isComplete(tube));
}

export function completedCount(tubes: Tubes): number {
  return tubes.filter(isComplete).length;
}

/** How many balls a pour from `from` to `to` would move. Zero when the pour is illegal. */
export function pourCount(tubes: Tubes, from: number, to: number): number {
  if (from === to) return 0;
  const source = tubes[from];
  const target = tubes[to];
  if (!source || !target || isComplete(source)) return 0;
  const run = topRun(source);
  if (!run) return 0;
  const free = CAPACITY - target.length;
  if (free <= 0) return 0;
  const targetTop = target[target.length - 1];
  if (targetTop !== undefined && targetTop !== run.color) return 0;
  return Math.min(run.count, free);
}

export function canPour(tubes: Tubes, from: number, to: number): boolean {
  return pourCount(tubes, from, to) > 0;
}

export interface PourOutcome {
  tubes: Tubes;
  count: number;
  color: number;
  /** The pour filled the target tube with one color. */
  completed: boolean;
}

/** Pour the top run of `from` onto `to`. Returns null when the move is illegal. */
export function pour(tubes: Tubes, from: number, to: number): PourOutcome | null {
  const count = pourCount(tubes, from, to);
  const source = tubes[from];
  const target = tubes[to];
  if (count === 0 || !source || !target) return null;
  const color = source[source.length - 1] as number;
  const next = tubes.map((tube, index) => {
    if (index === from) return tube.slice(0, tube.length - count);
    if (index === to) return [...tube, ...Array<number>(count).fill(color)];
    return tube;
  });
  return { tubes: next, count, color, completed: isComplete(next[to] as Tube) };
}

/**
 * Moving a whole single-color tube into an empty tube changes nothing that matters.
 * The solver and the bot skip it. The player may still do it.
 */
export function isPointless(tubes: Tubes, from: number, to: number): boolean {
  const source = tubes[from];
  const target = tubes[to];
  if (!source || !target || target.length > 0) return false;
  const run = topRun(source);
  return run !== null && run.count === source.length;
}

export function legalMoves(tubes: Tubes, skipPointless = false): Move[] {
  const moves: Move[] = [];
  for (let from = 0; from < tubes.length; from += 1) {
    for (let to = 0; to < tubes.length; to += 1) {
      if (!canPour(tubes, from, to)) continue;
      if (skipPointless && isPointless(tubes, from, to)) continue;
      moves.push([from, to]);
    }
  }
  return moves;
}

/** True when one more pour finishes the puzzle. */
export function oneMoveToWin(tubes: Tubes): boolean {
  return legalMoves(tubes).some(([from, to]) => {
    const outcome = pour(tubes, from, to);
    return outcome !== null && isSolved(outcome.tubes);
  });
}

export type Outcome = "playing" | "won" | "lost";

export interface PourResult {
  from: number;
  to: number;
  color: number;
  count: number;
  completed: boolean;
  /** Tubes completed by consecutive pours, 0 when this pour completed nothing. */
  combo: number;
  completedTotal: number;
  movesLeft: number;
  /** True once per round when the halfway tube is completed (scheduled pattern interrupt). */
  milestone: boolean;
  outcome: Outcome;
}

export interface Level {
  seed: number;
  colors: number;
  tubes: number[][];
  /** A forward solution, in pours. Its length is an upper bound of the shortest one. */
  solution: Move[];
  /** Pours the player may make. */
  moves: number;
}

export class SortGame {
  tubes: Tubes;
  movesLeft: number;
  movesMade = 0;
  combo = 0;
  outcome: Outcome = "playing";
  readonly colors: number;
  private milestoneDone = false;

  /** `extraTubes` adds empty tubes and `extraMoves` adds moves: the bonus of a retry. */
  constructor(level: Level, extraTubes = 0, extraMoves = 0) {
    this.tubes = [...level.tubes.map((tube) => [...tube]), ...Array.from({ length: extraTubes }, () => [])];
    this.movesLeft = level.moves + extraMoves;
    this.colors = level.colors;
  }

  get completed(): number {
    return completedCount(this.tubes);
  }

  /** Share of the colors that are sorted, from 0 to 1. */
  get progress(): number {
    return this.completed / this.colors;
  }

  /** The outcome is "stuck" when no pour is left and the puzzle is not solved. */
  get stuck(): boolean {
    return this.outcome === "lost" && this.movesLeft > 0;
  }

  pour(from: number, to: number): PourResult | null {
    if (this.outcome !== "playing") return null;
    const result = pour(this.tubes, from, to);
    if (!result) return null;
    this.tubes = result.tubes;
    this.movesLeft -= 1;
    this.movesMade += 1;
    this.combo = result.completed ? this.combo + 1 : 0;
    const done = this.completed;
    let milestone = false;
    if (!isSolved(this.tubes) && !this.milestoneDone && this.colors >= 3 && done >= Math.ceil(this.colors / 2)) {
      this.milestoneDone = true;
      milestone = true;
    }
    if (isSolved(this.tubes)) this.outcome = "won";
    else if (this.movesLeft <= 0 || legalMoves(this.tubes).length === 0) this.outcome = "lost";
    return {
      from,
      to,
      color: result.color,
      count: result.count,
      completed: result.completed,
      combo: this.combo,
      completedTotal: done,
      movesLeft: this.movesLeft,
      milestone,
      outcome: this.outcome,
    };
  }
}

/** Stars of the end card. A win with moves to spare earns three. */
export function starsFor(won: boolean, movesLeft: number, completed: number, colors: number): number {
  if (won) return movesLeft >= 3 ? 3 : 2;
  return completed >= colors - 1 ? 2 : completed >= 1 ? 1 : 0;
}

/** A short line that makes a near win visible, or null. */
export function nearWinMessage(tubes: Tubes, movesLeft: number, colors: number): string | null {
  if (isSolved(tubes)) return null;
  if (oneMoveToWin(tubes)) return "ONE POUR TO WIN!";
  if (completedCount(tubes) >= colors - 1) return "LAST COLOR!";
  if (movesLeft <= 3) return `${movesLeft} ${movesLeft === 1 ? "MOVE" : "MOVES"} LEFT`;
  return null;
}
