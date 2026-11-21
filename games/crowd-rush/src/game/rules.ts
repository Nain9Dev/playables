/**
 * Pure rules for the gate-runner mechanic. No rendering, no timers, no DOM, and the
 * level comes from a seeded generator: the same seed always gives the same level,
 * so the rules are unit-tested and a run can be replayed.
 */

export type Op = "add" | "sub" | "mul" | "div";

export interface Gate {
  op: Op;
  value: number;
}

export type Side = "left" | "right";

export interface Row {
  z: number;
  left: Gate;
  right: Gate;
}

export interface Level {
  startCount: number;
  rows: Row[];
  /** Crowd size of the final enemy. */
  enemy: number;
  /** Where the final fight starts along the road. */
  bossZ: number;
  /** Crowd size reached by always taking the best gate. Used to size the enemy. */
  best: number;
}

export const LEVEL = {
  rows: 6,
  rowSpacing: 14,
  firstRowZ: 10,
  bossGap: 18,
  startCount: 10,
  /** The enemy is this share of the best possible crowd, so a few mistakes still win. */
  enemyShare: 0.65,
} as const;

export const MOTION = {
  /** Forward speed in world units per second. */
  speed: 7,
  /** Half width of the road the player can steer across, in world units. */
  halfRoad: 3.2,
} as const;

export function applyGate(count: number, gate: Gate): number {
  switch (gate.op) {
    case "add":
      return count + gate.value;
    case "sub":
      return Math.max(0, count - gate.value);
    case "mul":
      return count * gate.value;
    case "div":
      return count === 0 ? 0 : Math.max(1, Math.ceil(count / gate.value));
  }
}

export function isPositive(gate: Gate): boolean {
  return gate.op === "add" || gate.op === "mul";
}

export function gateLabel(gate: Gate): string {
  switch (gate.op) {
    case "add":
      return `+${gate.value}`;
    case "sub":
      return `-${gate.value}`;
    case "mul":
      return `x${gate.value}`;
    case "div":
      return `÷${gate.value}`;
  }
}

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

/**
 * Build a level. The first row has two good gates, so the first choice always
 * rewards the player. Every later row has one good gate and one bad gate, and the
 * good side is random. Every gate is monotonic in the crowd size, so taking the
 * best gate in each row gives the best possible crowd.
 */
export function generateLevel(
  seed: number,
  rows: number = LEVEL.rows,
  startCount: number = LEVEL.startCount,
): Level {
  const rand = mulberry32(seed);
  const out: Row[] = [];
  let best = startCount;

  for (let i = 0; i < rows; i += 1) {
    const z = LEVEL.firstRowZ + i * LEVEL.rowSpacing;
    let good: Gate;
    let bad: Gate;

    if (i === 0) {
      good = { op: "mul", value: 2 };
      bad = { op: "add", value: startCount + 2 };
    } else {
      good =
        i % 2 === 1
          ? { op: "add", value: 6 + i * 3 + Math.floor(rand() * 4) }
          : { op: "mul", value: 2 };
      bad =
        rand() < 0.5
          ? { op: "sub", value: 3 + i + Math.floor(rand() * 4) }
          : { op: "div", value: 2 };
    }

    const goodOnLeft = rand() < 0.5;
    const row: Row = goodOnLeft ? { z, left: good, right: bad } : { z, left: bad, right: good };
    out.push(row);
    best = Math.max(applyGate(best, row.left), applyGate(best, row.right));
  }

  const last = out[out.length - 1];
  if (!last) throw new Error("a level needs at least one row");

  return {
    startCount,
    rows: out,
    enemy: Math.max(3, Math.floor(best * LEVEL.enemyShare)),
    bossZ: last.z + LEVEL.bossGap,
    best,
  };
}

/** Stars for the end card. A big surviving crowd earns three. */
export function starsFor(won: boolean, remaining: number, count: number): 1 | 2 | 3 {
  if (!won) return 1;
  return count > 0 && remaining / count >= 0.3 ? 3 : 2;
}

export type GameEvent =
  | { type: "gate"; row: number; side: Side; gate: Gate; before: number; after: number }
  | { type: "boss"; count: number; enemy: number; won: boolean; remaining: number }
  | { type: "fail"; reason: "crowd" | "boss" };

export type Phase = "run" | "won" | "lost";

export class RunGame {
  count: number;
  /** Steering position, from -1 (left edge) to 1 (right edge). */
  x = 0;
  /** Distance run along the road. */
  z = 0;
  phase: Phase = "run";
  private rowIndex = 0;

  constructor(
    readonly level: Level,
    startCount: number = level.startCount,
  ) {
    this.count = startCount;
  }

  get nextRow(): number {
    return this.rowIndex;
  }

  /** Progress along the road toward the final fight, from 0 to 1. */
  get progress(): number {
    return Math.min(1, this.z / this.level.bossZ);
  }

  /** Move forward by `dt` seconds while steering toward `steer` (-1 to 1). Returns what happened. */
  update(dt: number, steer: number): GameEvent[] {
    const events: GameEvent[] = [];
    if (this.phase !== "run") return events;

    const target = Math.max(-1, Math.min(1, steer));
    this.x += (target - this.x) * Math.min(1, dt * 8);
    this.z += MOTION.speed * dt;

    while (this.phase === "run") {
      const row = this.level.rows[this.rowIndex];
      if (row && this.z >= row.z) {
        const side: Side = this.x < 0 ? "left" : "right";
        const gate = side === "left" ? row.left : row.right;
        const before = this.count;
        this.count = applyGate(before, gate);
        events.push({ type: "gate", row: this.rowIndex, side, gate, before, after: this.count });
        this.rowIndex += 1;
        if (this.count === 0) {
          this.phase = "lost";
          events.push({ type: "fail", reason: "crowd" });
        }
        continue;
      }

      if (!row && this.z >= this.level.bossZ) {
        const won = this.count > this.level.enemy;
        const remaining = won ? this.count - this.level.enemy : 0;
        events.push({ type: "boss", count: this.count, enemy: this.level.enemy, won, remaining });
        this.phase = won ? "won" : "lost";
        if (!won) events.push({ type: "fail", reason: "boss" });
        this.z = this.level.bossZ;
      }
      break;
    }

    return events;
  }
}
