import { describe, expect, it } from "vitest";
import {
  HAZARDS,
  LEVEL,
  MOTION,
  RunGame,
  applyGate,
  battleCounts,
  boostFactor,
  closeness,
  edgeRouteIsSafe,
  gateLabel,
  generateLevel,
  isCloseFight,
  isPositive,
  mulberry32,
  sawLoss,
  starsFor,
  type Gate,
  type GameEvent,
  type Level,
} from "../games/crowd-rush/src/game/rules.ts";
import { intensityFor, layersFor } from "../games/crowd-rush/src/music.ts";

describe("applyGate", () => {
  it("adds, multiplies, subtracts and divides", () => {
    expect(applyGate(10, { op: "add", value: 5 })).toBe(15);
    expect(applyGate(10, { op: "mul", value: 3 })).toBe(30);
    expect(applyGate(10, { op: "sub", value: 4 })).toBe(6);
    expect(applyGate(10, { op: "div", value: 2 })).toBe(5);
  });

  it("never goes below zero and keeps at least one when dividing", () => {
    expect(applyGate(3, { op: "sub", value: 9 })).toBe(0);
    expect(applyGate(1, { op: "div", value: 2 })).toBe(1);
    expect(applyGate(0, { op: "div", value: 2 })).toBe(0);
  });

  it("rounds a division up so a crowd never loses a member to rounding", () => {
    expect(applyGate(7, { op: "div", value: 2 })).toBe(4);
  });

  it("labels gates and tells good from bad", () => {
    expect(gateLabel({ op: "add", value: 8 })).toBe("+8");
    expect(gateLabel({ op: "mul", value: 2 })).toBe("x2");
    expect(gateLabel({ op: "sub", value: 5 })).toBe("-5");
    expect(gateLabel({ op: "div", value: 2 })).toBe("÷2");
    expect(isPositive({ op: "mul", value: 2 })).toBe(true);
    expect(isPositive({ op: "div", value: 2 })).toBe(false);
  });
});

describe("mulberry32", () => {
  it("is deterministic and stays in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("generateLevel", () => {
  it("gives the same level for the same seed and a different one for another seed", () => {
    expect(JSON.stringify(generateLevel(7))).toBe(JSON.stringify(generateLevel(7)));
    expect(JSON.stringify(generateLevel(7))).not.toBe(JSON.stringify(generateLevel(8)));
  });

  it("makes the first row rewarding on both sides", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const first = generateLevel(seed).rows[0];
      expect(first && isPositive(first.left) && isPositive(first.right)).toBe(true);
    }
  });

  it("puts one good and one bad gate in every later row", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      for (const row of generateLevel(seed).rows.slice(1)) {
        expect(isPositive(row.left)).not.toBe(isPositive(row.right));
      }
    }
  });

  it("is always winnable by taking the best gate in every row", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const level = generateLevel(seed);
      expect(level.enemy).toBeGreaterThan(0);
      expect(level.best).toBeGreaterThan(level.enemy);

      const game = new RunGame(level);
      let guard = 0;
      while (game.phase === "run" && guard < 10_000) {
        const row = level.rows[game.nextRow];
        const left = row ? applyGate(game.count, row.left) : 0;
        const right = row ? applyGate(game.count, row.right) : 0;
        game.update(0.05, left > right ? -1 : 1);
        guard += 1;
      }
      expect(game.phase).toBe("won");
    }
  });

  it("spaces rows evenly and puts the boss after the last row", () => {
    const level = generateLevel(3);
    expect(level.rows).toHaveLength(LEVEL.rows);
    expect(level.rows[0]?.z).toBe(LEVEL.firstRowZ);
    expect(level.rows[1]?.z).toBe(LEVEL.firstRowZ + LEVEL.rowSpacing);
    expect(level.bossZ).toBe((level.rows[LEVEL.rows - 1]?.z ?? 0) + LEVEL.bossGap);
  });
});

describe("RunGame", () => {
  const gateA: Gate = { op: "add", value: 5 };
  const gateB: Gate = { op: "sub", value: 4 };
  const level = {
    startCount: 10,
    rows: [{ z: 7, left: gateA, right: gateB }],
    enemy: 8,
    bossZ: 21,
    best: 15,
  };

  function run(game: RunGame, steer: number, seconds: number) {
    const events = [];
    for (let t = 0; t < seconds; t += 0.05) events.push(...game.update(0.05, steer));
    return events;
  }

  it("moves forward at the configured speed", () => {
    const game = new RunGame(level);
    game.update(1, 0);
    expect(game.z).toBeCloseTo(MOTION.speed, 10);
  });

  it("takes the left gate when steering left and the right gate when steering right", () => {
    const left = new RunGame(level);
    const leftEvents = run(left, -1, 2);
    expect(leftEvents.find((e) => e.type === "gate")).toMatchObject({ side: "left", before: 10, after: 15 });

    const right = new RunGame(level);
    const rightEvents = run(right, 1, 2);
    expect(rightEvents.find((e) => e.type === "gate")).toMatchObject({ side: "right", before: 10, after: 6 });
  });

  it("starts with a bonus crowd when asked", () => {
    expect(new RunGame(level, 20).count).toBe(20);
  });

  it("wins the final fight with a bigger crowd and keeps the survivors", () => {
    const game = new RunGame(level);
    const events = run(game, -1, 5);
    const boss = events.find((e) => e.type === "boss");
    expect(boss).toMatchObject({ won: true, count: 15, enemy: 8, remaining: 7 });
    expect(game.phase).toBe("won");
  });

  it("loses the final fight with a smaller crowd", () => {
    const game = new RunGame(level);
    const events = run(game, 1, 5);
    expect(events.find((e) => e.type === "boss")).toMatchObject({ won: false, remaining: 0 });
    expect(events.find((e) => e.type === "fail")).toMatchObject({ reason: "boss" });
    expect(game.phase).toBe("lost");
  });

  it("loses at once when a gate wipes out the crowd", () => {
    const wipe = new RunGame({ ...level, rows: [{ z: 7, left: { op: "sub", value: 50 }, right: { op: "sub", value: 50 } }] });
    const events = run(wipe, 0, 2);
    expect(events.find((e) => e.type === "fail")).toMatchObject({ reason: "crowd" });
    expect(wipe.count).toBe(0);
    expect(wipe.phase).toBe("lost");
  });

  it("ignores updates after the run is over", () => {
    const game = new RunGame(level);
    run(game, -1, 5);
    const z = game.z;
    expect(game.update(1, 0)).toEqual([]);
    expect(game.z).toBe(z);
  });

  it("clamps the steering input and reports progress from 0 to 1", () => {
    const game = new RunGame(level);
    game.update(10, 9);
    expect(game.x).toBeLessThanOrEqual(1);
    expect(new RunGame(level).progress).toBe(0);
    run(game, 0, 5);
    expect(game.progress).toBe(1);
  });

  it("is deterministic for the same input", () => {
    const play = (): string => {
      const game = new RunGame(generateLevel(11));
      const events = run(game, 0.3, 20);
      return JSON.stringify([events, game.count, game.phase]);
    };
    expect(play()).toBe(play());
  });
});

describe("starsFor", () => {
  it("gives a loss one star", () => {
    expect(starsFor(false, 0, 50)).toBe(1);
  });

  it("gives a win two stars, or three with a big surviving crowd", () => {
    expect(starsFor(true, 5, 100)).toBe(2);
    expect(starsFor(true, 40, 100)).toBe(3);
  });
});

/** Steer to the best gate of the next row and hold that edge. The edge route has no saws. */
function bestGateBot(lane: number): (game: RunGame) => number {
  let last = lane;
  return (game) => {
    const row = game.level.rows[game.nextRow];
    if (!row) return last;
    last = applyGate(game.count, row.left) > applyGate(game.count, row.right) ? -lane : lane;
    return last;
  };
}

function playBot(level: Level, policy: (game: RunGame) => number): { game: RunGame; events: GameEvent[] } {
  const game = new RunGame(level);
  const events: GameEvent[] = [];
  for (let guard = 0; game.phase === "run" && guard < 20_000; guard += 1) {
    events.push(...game.update(0.05, policy(game)));
  }
  return { game, events };
}

describe("hazards: saws and pickups", () => {
  const seeds = Array.from({ length: 200 }, (_, i) => i + 1);

  it("keeps the gates of a seed the same as before hazards existed", () => {
    const level = generateLevel(7);
    expect(level.rows).toHaveLength(LEVEL.rows);
    expect(level.pickups?.length).toBeGreaterThan(10);
    expect(level.saws?.length).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic and sorted along the road", () => {
    expect(JSON.stringify(generateLevel(9))).toBe(JSON.stringify(generateLevel(9)));
    for (const seed of seeds) {
      const level = generateLevel(seed);
      const pz = (level.pickups ?? []).map((p) => p.z);
      const sz = (level.saws ?? []).map((s) => s.z);
      expect(pz).toEqual([...pz].sort((a, b) => a - b));
      expect(sz).toEqual([...sz].sort((a, b) => a - b));
    }
  });

  it("keeps hazards on the road, clear of the gates and inside the pickup values", () => {
    for (const seed of seeds) {
      const level = generateLevel(seed);
      for (const item of [...(level.pickups ?? []), ...(level.saws ?? [])]) {
        expect(Math.abs(item.x)).toBeLessThanOrEqual(1);
        expect(item.z).toBeGreaterThan(LEVEL.firstRowZ + 4);
        expect(item.z).toBeLessThan(level.bossZ);
        for (const row of level.rows) expect(Math.abs(item.z - row.z)).toBeGreaterThanOrEqual(4);
      }
      for (const pickup of level.pickups ?? []) {
        expect(pickup.value).toBe(HAZARDS.pickupValue[pickup.kind]);
        expect(pickup.value).toBeGreaterThanOrEqual(1);
        expect(pickup.value).toBeLessThanOrEqual(3);
      }
    }
  });

  it("never blocks the road: at most one saw per stretch and both edges stay free", () => {
    for (const seed of seeds) {
      const level = generateLevel(seed);
      expect(edgeRouteIsSafe(level, -1)).toBe(true);
      expect(edgeRouteIsSafe(level, 1)).toBe(true);
      for (const row of level.rows) {
        const next = (level.rows[level.rows.indexOf(row) + 1]?.z ?? level.bossZ);
        const inStretch = (level.saws ?? []).filter((s) => s.z > row.z && s.z < next);
        expect(inStretch.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("always has a winning path: the best gate on the free road edge wins without a hit", () => {
    for (const seed of seeds) {
      const { game, events } = playBot(generateLevel(seed), bestGateBot(1));
      expect(events.some((e) => e.type === "saw")).toBe(false);
      expect(game.phase).toBe("won");
    }
  });

  it("keeps difficulty in a band: good play wins, careless play mostly loses", () => {
    let careless = 0;
    let center = 0;
    for (const seed of seeds) {
      const level = generateLevel(seed);
      expect(level.enemy / level.best).toBeGreaterThan(0.6);
      expect(level.enemy / level.best).toBeLessThan(0.7);
      // The run takes a bounded time, so the ad stays inside the playable length.
      const seconds = level.bossZ / MOTION.speed;
      expect(seconds).toBeGreaterThan(14);
      expect(seconds).toBeLessThan(26);
      // Always the left edge ignores every gate choice.
      if (playBot(level, () => -1).game.phase === "won") careless += 1;
      // Staying in the middle hits the middle-lane saws and still picks sides by x sign.
      if (playBot(level, () => 0.01).game.phase === "won") center += 1;
    }
    expect(careless / seeds.length).toBeLessThan(0.15);
    expect(center / seeds.length).toBeLessThan(0.15);
  });

  it("makes a saw cost crowd but never wipe the crowd out alone", () => {
    expect(sawLoss(10)).toBe(2);
    expect(sawLoss(100)).toBe(10);
    expect(sawLoss(2)).toBe(1);
    expect(sawLoss(1)).toBe(0);
    expect(sawLoss(0)).toBe(0);
  });

  const saw = { x: 0, z: 10 };
  const pickupLevel = (pickups: Level["pickups"], saws: Level["saws"] = []): Level => ({
    startCount: 10,
    rows: [],
    pickups,
    saws,
    enemy: 1,
    bossZ: 60,
    best: 10,
  });

  it("hits a saw on its lane and removes crowd members", () => {
    const game = new RunGame(pickupLevel([], [saw]));
    const events: GameEvent[] = [];
    for (let t = 0; t < 2; t += 0.05) events.push(...game.update(0.05, 0));
    expect(events.find((e) => e.type === "saw")).toMatchObject({ loss: 2, before: 10, after: 8 });
    expect(game.count).toBe(8);
  });

  it("reports a near miss without a loss when passing just beside a saw", () => {
    const game = new RunGame(pickupLevel([], [{ x: 0.55, z: 10 }]));
    const events: GameEvent[] = [];
    for (let t = 0; t < 2; t += 0.05) events.push(...game.update(0.05, 0.15));
    expect(events.some((e) => e.type === "nearMiss")).toBe(true);
    expect(events.some((e) => e.type === "saw")).toBe(false);
    expect(game.count).toBe(10);
  });

  it("collects pickups, chains them, pays a bonus every fifth and resets on a miss", () => {
    const line = Array.from({ length: 6 }, (_, i) => ({ kind: "coin" as const, value: 1, x: 0, z: 8 + i * 2 }));
    const game = new RunGame(pickupLevel(line));
    const events: GameEvent[] = [];
    for (let t = 0; t < 3; t += 0.05) events.push(...game.update(0.05, 0));
    const picked = events.filter((e) => e.type === "pickup");
    expect(picked).toHaveLength(6);
    expect(picked.map((e) => (e.type === "pickup" ? e.chain : 0))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(picked.map((e) => (e.type === "pickup" ? e.bonus : 0))).toEqual([0, 0, 0, 0, 1, 0]);
    expect(game.count).toBe(10 + 6 + 1);

    const miss = new RunGame(pickupLevel([line[0]!, { kind: "coin", value: 1, x: 1, z: 10 }, line[2]!]));
    const missEvents: GameEvent[] = [];
    for (let t = 0; t < 3; t += 0.05) missEvents.push(...miss.update(0.05, 0));
    expect(missEvents.some((e) => e.type === "chainBreak")).toBe(true);
    // The third pickup starts a new chain.
    expect(miss.chain).toBe(1);
  });

  it("never lowers the crowd with a pickup, so pickups only make a level easier", () => {
    for (const seed of seeds) {
      const { events } = playBot(generateLevel(seed), bestGateBot(0.3));
      for (const event of events) {
        if (event.type === "pickup") expect(event.after).toBeGreaterThan(event.before);
      }
    }
  });
});

describe("speed boost", () => {
  it("fires one halfway event and speeds the crowd up, then settles", () => {
    const level = generateLevel(7);
    const game = new RunGame(level);
    const halfway: GameEvent[] = [];
    let fastest = 0;
    let last = game.z;
    for (let t = 0; t < 30 && game.phase === "run"; t += 0.05) {
      halfway.push(...game.update(0.05, 1).filter((e) => e.type === "halfway"));
      fastest = Math.max(fastest, (game.z - last) / 0.05);
      last = game.z;
    }
    expect(halfway).toHaveLength(1);
    expect(fastest).toBeGreaterThan(MOTION.speed * 1.2);
    expect(boostFactor(0)).toBe(1);
    expect(boostFactor(MOTION.boostSeconds)).toBeCloseTo(MOTION.boostMultiplier, 10);
    expect(boostFactor(MOTION.boostSeconds / 2)).toBeLessThan(boostFactor(MOTION.boostSeconds));
  });

  it("does not boost before the halfway point", () => {
    const game = new RunGame(generateLevel(7));
    game.update(1, 0);
    expect(game.z).toBeCloseTo(MOTION.speed, 10);
  });
});

describe("boss fight timeline", () => {
  it("starts at the full crowds and ends at the outcome", () => {
    expect(battleCounts(100, 60, 0)).toEqual({ player: 100, enemy: 60 });
    expect(battleCounts(100, 60, 1)).toEqual({ player: 40, enemy: 0 });
    const lost = battleCounts(50, 80, 1);
    expect(lost.player).toBe(0);
    expect(lost.enemy).toBeCloseTo(30, 10);
  });

  it("only ever loses members, never gains them", () => {
    for (const [player, enemy] of [[100, 60], [61, 60], [50, 80], [79, 80], [300, 10]] as const) {
      let before = battleCounts(player, enemy, 0);
      for (let u = 0.02; u <= 1.0001; u += 0.02) {
        const now = battleCounts(player, enemy, u);
        expect(now.player).toBeLessThanOrEqual(before.player + 1e-9);
        expect(now.enemy).toBeLessThanOrEqual(before.enemy + 1e-9);
        expect(now.player).toBeGreaterThanOrEqual(0);
        expect(now.enemy).toBeGreaterThanOrEqual(0);
        before = now;
      }
    }
  });

  it("swings: a narrow win dips below an even fight before it ends, a narrow loss leads first", () => {
    const share = (p: number, e: number, u: number): number => {
      const s = battleCounts(p, e, u);
      return s.player / (s.player + s.enemy);
    };
    let lowest = 1;
    for (let u = 0; u <= 0.9; u += 0.05) lowest = Math.min(lowest, share(130, 100, u));
    expect(lowest).toBeLessThan(0.5);
    expect(share(130, 100, 1)).toBe(1);

    let highest = 0;
    for (let u = 0; u <= 0.9; u += 0.05) highest = Math.max(highest, share(90, 100, u));
    expect(highest).toBeGreaterThan(0.5);
    expect(share(90, 100, 1)).toBe(0);
  });

  it("flags narrow fights for the slow finish", () => {
    expect(closeness(100, 100)).toBe(0);
    expect(isCloseFight(110, 100)).toBe(true);
    expect(isCloseFight(100, 90)).toBe(true);
    expect(isCloseFight(300, 100)).toBe(false);
    expect(closeness(0, 0)).toBe(0);
  });
});

describe("music mapping", () => {
  it("rises with the crowd on a log scale and stays in 0..1", () => {
    expect(intensityFor(10, 200)).toBe(0);
    expect(intensityFor(5, 200)).toBe(0);
    expect(intensityFor(200, 200)).toBe(1);
    expect(intensityFor(9999, 200)).toBe(1);
    expect(intensityFor(50, 200)).toBeGreaterThan(intensityFor(20, 200));
    expect(intensityFor(50, 5)).toBe(1);
  });

  it("brings layers in one after another", () => {
    const calm = layersFor(0);
    expect(calm.bass + calm.kick + calm.hat + calm.arp).toBe(0);
    expect(calm.pad).toBeGreaterThan(0);
    const mid = layersFor(0.5);
    expect(mid.kick).toBeGreaterThan(0);
    expect(mid.arp).toBe(0);
    const full = layersFor(1);
    expect(full).toEqual({ pad: 1, bass: 1, kick: 1, hat: 1, arp: 1 });
  });
});
