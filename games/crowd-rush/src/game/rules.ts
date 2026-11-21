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

export type PickupKind = "coin" | "gem" | "recruit";

/** A collectible on the road. `x` is a steering position from -1 to 1. */
export interface Pickup {
  kind: PickupKind;
  value: number;
  x: number;
  z: number;
}

/** A spinning saw. Touching it removes crowd members. `x` is a steering position. */
export interface Saw {
  x: number;
  z: number;
}

export interface Level {
  startCount: number;
  rows: Row[];
  /** Collectibles sorted by `z`. Optional so hand-built test levels stay small. */
  pickups?: Pickup[];
  /** Saws sorted by `z`. */
  saws?: Saw[];
  /** Crowd size of the final enemy. */
  enemy: number;
  /** Where the final fight starts along the road. */
  bossZ: number;
  /** Crowd size reached by always taking the best gate. Used to size the enemy. */
  best: number;
}

export const LEVEL = {
  rows: 7,
  rowSpacing: 16,
  firstRowZ: 10,
  bossGap: 20,
  startCount: 10,
  /** The enemy is this share of the best possible crowd, so a few mistakes still win. */
  enemyShare: 0.65,
} as const;

export const MOTION = {
  /** Forward speed in world units per second. */
  speed: 7,
  /** Half width of the road the player can steer across, in world units. */
  halfRoad: 3.2,
  /** Peak speed multiplier of the boost at the halfway point. */
  boostMultiplier: 1.4,
  /** Seconds the boost takes to fade back to normal speed. */
  boostSeconds: 2.2,
} as const;

export const HAZARDS = {
  /** Steering offset of the saw lanes. The two road edges (-1 and 1) are never in a saw lane. */
  sawLanes: [-0.55, 0, 0.55],
  /** A saw hits when the crowd is closer than this in steering units. */
  sawHit: 0.3,
  /** Passing a saw closer than hit + this margin counts as a near miss. */
  nearMissMargin: 0.2,
  /** A pickup is collected when the crowd is closer than this in steering units. */
  pickupReach: 0.24,
  /** Every Nth pickup in an unbroken chain pays one extra crowd member. */
  chainBonusEvery: 5,
  pickupValue: { coin: 1, gem: 2, recruit: 3 },
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

/** Crowd members a saw removes. A saw never wipes the crowd out on its own. */
export function sawLoss(count: number): number {
  return Math.max(0, Math.min(count - 1, Math.max(2, Math.ceil(count * 0.1))));
}

/** Speed multiplier while a boost has `remaining` seconds left. */
export function boostFactor(remaining: number): number {
  const t = Math.max(0, Math.min(1, remaining / MOTION.boostSeconds));
  return 1 + (MOTION.boostMultiplier - 1) * t * t;
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
  const bossZ = last.z + LEVEL.bossGap;
  const { pickups, saws } = generateHazards(seed, out, bossZ);

  return {
    startCount,
    rows: out,
    pickups,
    saws,
    enemy: Math.max(3, Math.floor(best * LEVEL.enemyShare)),
    bossZ,
    best,
  };
}

type Pattern = "line" | "zigzag" | "arc" | "trail";

/**
 * Seeded saws and pickups for the stretch of road after each gate row. They use
 * their own generator, so they never change the gates of a seed. Saws sit only in
 * the lanes of HAZARDS.sawLanes, one per stretch, so the two road edges are always
 * free and a winning route always exists. Pickups are pure bonus: the enemy is
 * sized without them, so they can only make a level easier.
 */
export function generateHazards(
  seed: number,
  rows: readonly Row[],
  bossZ: number,
): { pickups: Pickup[]; saws: Saw[] } {
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const pickups: Pickup[] = [];
  const saws: Saw[] = [];
  const patterns: Pattern[] = ["line", "zigzag", "arc", "trail"];
  const lanes = HAZARDS.sawLanes;

  rows.forEach((row, i) => {
    const next = rows[i + 1]?.z ?? bossZ;
    // Leave room after a gate for the steering to settle and before the next one to aim.
    const from = row.z + 5;
    const to = next - 4;
    let sawLane: number | null = null;

    if (i >= 1 && rand() < 0.85) {
      const lane = lanes[Math.floor(rand() * lanes.length)] ?? 0;
      sawLane = lane;
      saws.push({ x: lane, z: from + (to - from) * (0.35 + rand() * 0.3) });
    }

    const pattern = patterns[Math.floor(rand() * patterns.length)] ?? "line";
    const count = 4 + Math.floor(rand() * 3);
    // Start in a lane away from the saw, so greed has to dodge it.
    const open = lanes.filter((lane) => lane !== sawLane);
    const baseX = open[Math.floor(rand() * open.length)] ?? 0;
    const recruitAt = rand() < 0.5 ? count - 1 : Math.floor(count / 2);
    for (let k = 0; k < count; k += 1) {
      let x = baseX;
      if (pattern === "zigzag") x = baseX + (k % 2 === 0 ? -0.2 : 0.2);
      if (pattern === "arc") x = baseX + Math.sin((k / (count - 1)) * Math.PI) * 0.35 * (baseX > 0 ? -1 : 1);
      if (pattern === "trail") x = baseX + (k / (count - 1) - 0.5) * 0.6;
      const kind: PickupKind = k === recruitAt ? (i % 2 === 1 ? "recruit" : "gem") : "coin";
      pickups.push({
        kind,
        value: HAZARDS.pickupValue[kind],
        x: Math.max(-1, Math.min(1, x)),
        z: from + (to - from) * 0.1 + (k * (to - from) * 0.8) / count,
      });
    }
  });

  pickups.sort((a, b) => a.z - b.z);
  saws.sort((a, b) => a.z - b.z);
  return { pickups, saws };
}

/** True when standing at a road edge (`side` -1 or 1) never touches a saw. */
export function edgeRouteIsSafe(level: Level, side: -1 | 1): boolean {
  return (level.saws ?? []).every((saw) => Math.abs(saw.x - side) > HAZARDS.sawHit);
}

export interface BattleState {
  player: number;
  enemy: number;
}

/**
 * Crowd sizes during the final fight at progress `u` from 0 to 1. Both sides lose
 * the same total, the size of the smaller crowd, so the end state matches the
 * outcome. The timing makes the fight swing: in a win the enemy barely drops while
 * the crowd melts and then collapses at the end, and in a loss the crowd looks
 * ahead until the last moments.
 */
export function battleCounts(player: number, enemy: number, u: number): BattleState {
  const t = Math.max(0, Math.min(1, u));
  const won = player > enemy;
  const total = Math.min(player, enemy);
  const front = 1 - (1 - t) ** 2;
  const back = t ** 2.2;
  return {
    player: player - total * (won ? front : back),
    enemy: enemy - total * (won ? back : front),
  };
}

/** How narrow the fight is, from 0 (a tie) to 1 (a crowd against nothing). */
export function closeness(player: number, enemy: number): number {
  const big = Math.max(player, enemy);
  return big === 0 ? 0 : Math.abs(player - enemy) / big;
}

/** A fight this narrow gets the slow-motion finish and extra tension. */
export const CLOSE_FIGHT = 0.25;

export function isCloseFight(player: number, enemy: number): boolean {
  return closeness(player, enemy) <= CLOSE_FIGHT;
}

/** Stars for the end card. A big surviving crowd earns three. */
export function starsFor(won: boolean, remaining: number, count: number): 1 | 2 | 3 {
  if (!won) return 1;
  return count > 0 && remaining / count >= 0.3 ? 3 : 2;
}

export type GameEvent =
  | { type: "gate"; row: number; side: Side; gate: Gate; before: number; after: number }
  | { type: "pickup"; pickup: Pickup; value: number; chain: number; bonus: number; before: number; after: number }
  | { type: "chainBreak"; chain: number }
  | { type: "saw"; saw: Saw; loss: number; before: number; after: number }
  | { type: "nearMiss"; saw: Saw }
  | { type: "halfway"; z: number }
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
  /** Unbroken pickups collected in a row. A missed pickup resets it. */
  chain = 0;
  /** Seconds of speed boost left after the halfway point. */
  boost = 0;
  private rowIndex = 0;
  private pickupIndex = 0;
  private sawIndex = 0;
  private halfwayDone = false;

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
    this.z += MOTION.speed * boostFactor(this.boost) * dt;
    this.boost = Math.max(0, this.boost - dt);

    if (!this.halfwayDone && this.z >= this.level.bossZ / 2) {
      this.halfwayDone = true;
      this.boost = MOTION.boostSeconds;
      events.push({ type: "halfway", z: this.z });
    }

    this.collect(events);

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

  /** Resolve the pickups and saws the crowd has now passed, in road order. */
  private collect(events: GameEvent[]): void {
    const pickups = this.level.pickups ?? [];
    const saws = this.level.saws ?? [];
    for (;;) {
      const pickup = pickups[this.pickupIndex];
      const saw = saws[this.sawIndex];
      const pickupDue = pickup !== undefined && pickup.z <= this.z;
      const sawDue = saw !== undefined && saw.z <= this.z;

      if (pickup && pickupDue && (!saw || !sawDue || pickup.z <= saw.z)) {
        this.pickupIndex += 1;
        if (Math.abs(this.x - pickup.x) <= HAZARDS.pickupReach) {
          this.chain += 1;
          const bonus = this.chain % HAZARDS.chainBonusEvery === 0 ? 1 : 0;
          const value = pickup.value + bonus;
          const before = this.count;
          this.count += value;
          events.push({ type: "pickup", pickup, value, chain: this.chain, bonus, before, after: this.count });
        } else if (this.chain > 0) {
          events.push({ type: "chainBreak", chain: this.chain });
          this.chain = 0;
        }
      } else if (saw && sawDue) {
        this.sawIndex += 1;
        const gap = Math.abs(this.x - saw.x);
        if (gap < HAZARDS.sawHit) {
          const before = this.count;
          const loss = sawLoss(before);
          this.count = before - loss;
          events.push({ type: "saw", saw, loss, before, after: this.count });
        } else if (gap < HAZARDS.sawHit + HAZARDS.nearMissMargin) {
          events.push({ type: "nearMiss", saw });
        }
      } else {
        return;
      }
    }
  }
}
