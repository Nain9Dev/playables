/**
 * Level generator and solver. A level is made by scrambling the solved state with
 * reverse moves, so every level is solvable by construction and the scramble itself is
 * a known solution. The solver is only used for hints during play.
 */
import {
  CAPACITY,
  isComplete,
  isSolved,
  legalMoves,
  pour,
  topRun,
  type Level,
  type Move,
  type Tubes,
} from "./rules.ts";

/** Small seeded generator. The same seed always gives the same sequence. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ReverseStep {
  /** Tube that gives up `count` balls. */
  x: number;
  /** Tube that receives them. */
  y: number;
  count: number;
}

/**
 * Reverse moves that the forward rules can undo with exactly one pour y to x:
 * the receiving tube must not end with the same color under the moved balls (or the
 * forward pour would take more of them), and the giving tube must keep that color on
 * top or end up empty (or the forward pour would be illegal).
 */
function reverseCandidates(tubes: Tubes): ReverseStep[] {
  const steps: ReverseStep[] = [];
  tubes.forEach((giver, x) => {
    const run = topRun(giver);
    if (!run) return;
    for (let count = 1; count <= run.count; count += 1) {
      const leavesColorOnTop = count < run.count;
      const leavesEmpty = giver.length === count;
      if (!leavesColorOnTop && !leavesEmpty) continue;
      tubes.forEach((receiver, y) => {
        if (y === x || CAPACITY - receiver.length < count) return;
        const receiverTop = receiver[receiver.length - 1];
        if (receiverTop === run.color) return;
        // Moving a whole tube into an empty one only renames the tubes.
        if (leavesEmpty && receiver.length === 0) return;
        steps.push({ x, y, count });
      });
    }
  });
  return steps;
}

function applyReverse(tubes: Tubes, step: ReverseStep): Tubes {
  const giver = tubes[step.x] as number[];
  const moved = giver.slice(giver.length - step.count);
  return tubes.map((tube, index) => {
    if (index === step.x) return tube.slice(0, tube.length - step.count);
    if (index === step.y) return [...tube, ...moved];
    return tube;
  });
}

export interface LevelOptions {
  colors: number;
  emptyTubes: number;
  steps: number;
  slack: number;
}

export function generateLevel(seed: number, options: LevelOptions): Level {
  const random = mulberry32(seed);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let tubes: Tubes = [
      ...Array.from({ length: options.colors }, (_, color) => Array<number>(CAPACITY).fill(color)),
      ...Array.from({ length: options.emptyTubes }, () => [] as number[]),
    ];
    const steps: ReverseStep[] = [];
    // Keep scrambling past the requested steps until no tube is left finished.
    for (let i = 0; i < options.steps + 16; i += 1) {
      if (i >= options.steps && !tubes.some(isComplete)) break;
      const candidates = reverseCandidates(tubes);
      const pick = candidates[Math.floor(random() * candidates.length)];
      if (!pick) break;
      steps.push(pick);
      tubes = applyReverse(tubes, pick);
    }
    if (isSolved(tubes) || tubes.some(isComplete)) continue;
    const solution: Move[] = steps.map((step) => [step.y, step.x] as const).reverse();
    return {
      seed,
      colors: options.colors,
      tubes: tubes.map((tube) => [...tube]),
      solution,
      moves: solution.length + options.slack,
    };
  }
  throw new Error(`could not generate a level for seed ${seed}`);
}

function keyOf(tubes: Tubes): string {
  // Tubes are interchangeable for the search, so the key ignores their order.
  return tubes
    .map((tube) => tube.join(""))
    .sort()
    .join("|");
}

/**
 * Shortest list of pours that solves `tubes`, found by breadth first search.
 * Returns null when the search hits `maxStates` first.
 */
export function solve(tubes: Tubes, maxStates = 60_000): Move[] | null {
  if (isSolved(tubes)) return [];
  interface Node {
    tubes: Tubes;
    path: Move[];
  }
  const seen = new Set<string>([keyOf(tubes)]);
  let frontier: Node[] = [{ tubes, path: [] }];
  while (frontier.length > 0) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const move of legalMoves(node.tubes, true)) {
        const outcome = pour(node.tubes, move[0], move[1]);
        if (!outcome) continue;
        const path = [...node.path, move];
        if (isSolved(outcome.tubes)) return path;
        const key = keyOf(outcome.tubes);
        if (seen.has(key)) continue;
        if (seen.size >= maxStates) return null;
        seen.add(key);
        next.push({ tubes: outcome.tubes, path });
      }
    }
    frontier = next;
  }
  return null;
}

/** A pour that a player can follow now: the solver's first move, or any sensible one. */
export function hintMove(tubes: Tubes): Move | null {
  const path = solve(tubes, 25_000);
  if (path && path.length > 0) return path[0] as Move;
  const moves = legalMoves(tubes, true);
  return moves.find(([from, to]) => pour(tubes, from, to)?.completed) ?? moves[0] ?? null;
}
