import { describe, expect, it } from "vitest";
import {
  LEVEL,
  MOTION,
  RunGame,
  applyGate,
  gateLabel,
  generateLevel,
  isPositive,
  mulberry32,
  starsFor,
  type Gate,
} from "../games/crowd-rush/src/game/rules.ts";

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
