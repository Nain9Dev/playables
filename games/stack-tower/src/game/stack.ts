/**
 * Pure game rules for the stacking mechanic. No rendering, no timers, no DOM:
 * the same inputs always give the same result, so the rules are unit-tested.
 */

export interface Span {
  /** Center of the span along one axis. */
  center: number;
  /** Length of the span along that axis. */
  size: number;
}

export type PlacementKind = "perfect" | "cut" | "miss";

export interface Placement {
  kind: PlacementKind;
  /** The part that stays on the tower. Null on a miss. */
  placed: Span | null;
  /** The part that falls off. Null on a perfect drop. */
  debris: Span | null;
}

export type Axis = "x" | "z";

/** Stars for the end card: a win is at least two, a streak-heavy win is three. */
export function starsFor(level: number, won: boolean, score: number): 1 | 2 | 3 {
  if (won) return score >= 55 ? 3 : 2;
  return level >= 8 ? 2 : 1;
}

/** Messages shown when the player is close to the goal (goal-gradient effect). */
export function nearGoalMessage(level: number, levelsToWin: number): string | null {
  const remaining = levelsToWin - level;
  if (remaining === 1) return "ONE MORE!";
  if (remaining === 4) return "ALMOST THERE";
  return null;
}

export interface Block {
  x: number;
  z: number;
  w: number;
  d: number;
}

export const CONFIG = {
  baseSize: 3,
  /** Distance in world units that still counts as a perfect drop. */
  perfectTolerance: 0.1,
  /** How far the moving block swings from the center of the block below. */
  amplitude: 2.4,
  /** Blocks to stack before the end card shows. */
  levelsToWin: 14,
  /** Consecutive perfect drops needed before the block grows back. */
  regrowCombo: 3,
  regrowAmount: 0.15,
  /** Every Nth block is golden (variable reward): its points are multiplied. */
  goldenEvery: 5,
  goldenMultiplier: 3,
  /** A cut whose overhang is at most this wide counts as a near miss (SO CLOSE). */
  nearMissMax: 0.35,
  /** Combo needed for each music/glow tier. Tier 0 is below the first value. */
  comboTiers: [2, 4, 6],
} as const;

/** True when the block placed at `level` (1 = first block on the base) is golden. */
export function isGoldenLevel(level: number): boolean {
  return level > 0 && level % CONFIG.goldenEvery === 0;
}

/** A cut with a thin overhang: the player was almost perfect. */
export function isNearMiss(placement: Placement): boolean {
  return (
    placement.kind === "cut" &&
    placement.debris !== null &&
    placement.debris.size <= CONFIG.nearMissMax
  );
}

/** Intensity tier 0..3 for the music, trail and glow, driven by the combo. */
export function comboTier(combo: number): 0 | 1 | 2 | 3 {
  const [one, two, three] = CONFIG.comboTiers;
  if (combo >= three) return 3;
  if (combo >= two) return 2;
  if (combo >= one) return 1;
  return 0;
}

/**
 * How far the sky has moved from day to space, 0..1. It follows the tower height,
 * so the background tells the player they are climbing.
 */
export function skyProgress(level: number): number {
  return Math.min(1, Math.max(0, level / CONFIG.levelsToWin));
}

/** Camera view-height multiplier: the camera pulls out a little as the tower grows. */
export function cameraPullOut(level: number): number {
  return 1 + 0.22 * skyProgress(level);
}

/**
 * Compare the dropped span with the span below it.
 * Pure function: overlap decides what stays, what falls and what counts as perfect.
 */
export function resolvePlacement(
  below: Span,
  dropped: Span,
  tolerance: number = CONFIG.perfectTolerance,
): Placement {
  const left = Math.max(below.center - below.size / 2, dropped.center - dropped.size / 2);
  const right = Math.min(below.center + below.size / 2, dropped.center + dropped.size / 2);
  const overlap = right - left;

  if (overlap <= 0) {
    return { kind: "miss", placed: null, debris: { ...dropped } };
  }

  if (Math.abs(dropped.center - below.center) <= tolerance) {
    return { kind: "perfect", placed: { center: below.center, size: dropped.size }, debris: null };
  }

  const debrisSize = dropped.size - overlap;
  const debrisCenter =
    dropped.center > below.center ? right + debrisSize / 2 : left - debrisSize / 2;

  return {
    kind: "cut",
    placed: { center: (left + right) / 2, size: overlap },
    debris: { center: debrisCenter, size: debrisSize },
  };
}

/** Axis the next moving block slides along. The first moving block slides along x. */
export function axisForLevel(level: number): Axis {
  return level % 2 === 1 ? "x" : "z";
}

/**
 * Swing speed in radians per second: 1.9 at the start, +0.12 per block, capped at
 * level 20. Early blocks stay easy, the last blocks need a real eye. Picked with a
 * simulated player (see playable.json "tuning"), not with real player data.
 */
export function speedForLevel(level: number): number {
  return 1.9 + Math.min(level, 20) * 0.12;
}

export interface DropResult extends Placement {
  /** Index of the new block in `blocks`. Null on a miss. */
  index: number | null;
  axis: Axis;
  /** Points awarded by this drop, after the golden multiplier. Zero on a miss. */
  points: number;
  /** The placed block was golden. */
  golden: boolean;
  /** The drop was a cut with a thin overhang. */
  nearMiss: boolean;
}

export class StackGame {
  readonly blocks: Block[] = [
    { x: 0, z: 0, w: CONFIG.baseSize, d: CONFIG.baseSize },
  ];
  score = 0;
  combo = 0;
  over = false;
  won = false;

  /** Number of blocks stacked on top of the base. */
  get level(): number {
    return this.blocks.length - 1;
  }

  /** Axis of the block that is about to be dropped. */
  get axis(): Axis {
    return axisForLevel(this.level + 1);
  }

  /** Progress toward the goal, from 0 to 1. */
  get progress(): number {
    return Math.min(1, this.level / CONFIG.levelsToWin);
  }

  get top(): Block {
    const top = this.blocks[this.blocks.length - 1];
    if (!top) throw new Error("the tower always has a base block");
    return top;
  }

  /** Where the moving block is for a given swing phase. Starts at the far edge. */
  movingCenter(phase: number): number {
    const top = this.top;
    const base = this.axis === "x" ? top.x : top.z;
    return base + CONFIG.amplitude * Math.cos(phase);
  }

  /** Size of the moving block: it matches the block below. */
  movingBlock(center: number): Block {
    const top = this.top;
    return this.axis === "x"
      ? { x: center, z: top.z, w: top.w, d: top.d }
      : { x: top.x, z: center, w: top.w, d: top.d };
  }

  /** Drop the moving block at `center` along the current axis. */
  drop(center: number): DropResult {
    if (this.over) throw new Error("the game is over");

    const axis = this.axis;
    const top = this.top;
    const below: Span =
      axis === "x" ? { center: top.x, size: top.w } : { center: top.z, size: top.d };
    const dropped: Span = { center, size: below.size };

    const placement = resolvePlacement(below, dropped);

    if (placement.kind === "miss" || !placement.placed) {
      this.over = true;
      this.combo = 0;
      return { ...placement, index: null, axis, points: 0, golden: false, nearMiss: false };
    }

    const golden = isGoldenLevel(this.level + 1);
    let points: number;
    let placed = placement.placed;
    if (placement.kind === "perfect") {
      this.combo += 1;
      points = 1 + Math.min(this.combo, 5);
      if (this.combo >= CONFIG.regrowCombo) {
        placed = { ...placed, size: Math.min(CONFIG.baseSize, placed.size + CONFIG.regrowAmount) };
      }
    } else {
      this.combo = 0;
      points = 1;
    }
    if (golden) points *= CONFIG.goldenMultiplier;
    this.score += points;

    this.blocks.push(
      axis === "x"
        ? { x: placed.center, z: top.z, w: placed.size, d: top.d }
        : { x: top.x, z: placed.center, w: top.w, d: placed.size },
    );

    if (this.level >= CONFIG.levelsToWin) {
      this.over = true;
      this.won = true;
    }

    return {
      ...placement,
      placed,
      index: this.blocks.length - 1,
      axis,
      points,
      golden,
      nearMiss: isNearMiss(placement),
    };
  }
}
