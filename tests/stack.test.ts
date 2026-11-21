import { describe, expect, it } from "vitest";
import {
  CONFIG,
  StackGame,
  axisForLevel,
  cameraPullOut,
  comboTier,
  isGoldenLevel,
  isNearMiss,
  nearGoalMessage,
  skyProgress,
  resolvePlacement,
  speedForLevel,
  starsFor,
} from "../games/stack-tower/src/game/stack.ts";
import { skyPalette, starAlpha } from "../games/stack-tower/src/render/sky.ts";

describe("resolvePlacement", () => {
  const below = { center: 0, size: 3 };

  it("snaps to the block below when the drop is within the tolerance", () => {
    const result = resolvePlacement(below, { center: 0.05, size: 3 });
    expect(result.kind).toBe("perfect");
    expect(result.placed).toEqual({ center: 0, size: 3 });
    expect(result.debris).toBeNull();
  });

  it("cuts the overhang on the right and keeps the overlap", () => {
    const result = resolvePlacement(below, { center: 1, size: 3 });
    expect(result.kind).toBe("cut");
    expect(result.placed).toEqual({ center: 0.5, size: 2 });
    expect(result.debris).toEqual({ center: 2, size: 1 });
  });

  it("cuts the overhang on the left and keeps the overlap", () => {
    const result = resolvePlacement(below, { center: -1, size: 3 });
    expect(result.kind).toBe("cut");
    expect(result.placed).toEqual({ center: -0.5, size: 2 });
    expect(result.debris).toEqual({ center: -2, size: 1 });
  });

  it("conserves length: placed plus debris equals the dropped size", () => {
    for (const center of [-2.9, -1.7, -0.4, 0.4, 1.3, 2.9]) {
      const result = resolvePlacement(below, { center, size: 3 });
      const total = (result.placed?.size ?? 0) + (result.debris?.size ?? 0);
      expect(total).toBeCloseTo(3, 10);
    }
  });

  it("misses when the spans do not overlap", () => {
    const result = resolvePlacement(below, { center: 3, size: 3 });
    expect(result.kind).toBe("miss");
    expect(result.placed).toBeNull();
    expect(result.debris).toEqual({ center: 3, size: 3 });
  });

  it("treats spans that only touch as a miss", () => {
    expect(resolvePlacement(below, { center: 3, size: 3 }).kind).toBe("miss");
  });
});

describe("level rules", () => {
  it("alternates the sliding axis, starting with x", () => {
    expect([1, 2, 3, 4].map(axisForLevel)).toEqual(["x", "z", "x", "z"]);
  });

  it("speeds up with the level and stops growing at level 20", () => {
    expect(speedForLevel(5)).toBeGreaterThan(speedForLevel(1));
    expect(speedForLevel(20)).toBe(speedForLevel(40));
  });
});

describe("retention helpers", () => {
  it("gives a win at least two stars and a streak-heavy win three", () => {
    expect(starsFor(14, true, 30)).toBe(2);
    expect(starsFor(14, true, 55)).toBe(3);
  });

  it("gives a loss one or two stars depending on how far the tower got", () => {
    expect(starsFor(3, false, 5)).toBe(1);
    expect(starsFor(8, false, 20)).toBe(2);
  });

  it("teases the goal four blocks and one block before the end", () => {
    expect(nearGoalMessage(10, 14)).toBe("ALMOST THERE");
    expect(nearGoalMessage(13, 14)).toBe("ONE MORE!");
    expect(nearGoalMessage(5, 14)).toBeNull();
  });

  it("reports progress from 0 to 1", () => {
    const game = new StackGame();
    expect(game.progress).toBe(0);
    game.drop(0);
    expect(game.progress).toBeCloseTo(1 / CONFIG.levelsToWin, 10);
  });
});

describe("golden block", () => {
  it("makes every fifth block golden and never the base", () => {
    const golden = [0, 1, 4, 5, 6, 9, 10, 15].filter(isGoldenLevel);
    expect(golden).toEqual([5, 10, 15]);
  });

  it("multiplies the points of the golden block only", () => {
    const game = new StackGame();
    const points: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      points.push(game.drop(game.axis === "x" ? game.top.x : game.top.z).points);
    }
    // Perfect combo 1..5 scores 2,3,4,5,6; the fifth block is golden: 6 x 3.
    expect(points).toEqual([2, 3, 4, 5, 18]);
    expect(game.score).toBe(32);
  });

  it("flags the golden result and multiplies a plain cut too", () => {
    const game = new StackGame();
    for (let i = 0; i < 4; i += 1) game.drop(game.axis === "x" ? game.top.x : game.top.z);
    const center = (game.axis === "x" ? game.top.x : game.top.z) + 1;
    const result = game.drop(center);
    expect(result.kind).toBe("cut");
    expect(result.golden).toBe(true);
    expect(result.points).toBe(CONFIG.goldenMultiplier);
  });

  it("does not flag ordinary blocks as golden", () => {
    const game = new StackGame();
    expect(game.drop(0).golden).toBe(false);
  });
});

describe("near miss", () => {
  const below = { center: 0, size: 3 };

  it("flags a cut with a thin overhang", () => {
    const placement = resolvePlacement(below, { center: 0.25, size: 3 });
    expect(placement.kind).toBe("cut");
    expect(isNearMiss(placement)).toBe(true);
  });

  it("does not flag a perfect drop, a wide cut or a miss", () => {
    expect(isNearMiss(resolvePlacement(below, { center: 0.05, size: 3 }))).toBe(false);
    expect(isNearMiss(resolvePlacement(below, { center: 1, size: 3 }))).toBe(false);
    expect(isNearMiss(resolvePlacement(below, { center: 5, size: 3 }))).toBe(false);
  });

  it("reports the near miss from the game drop", () => {
    const game = new StackGame();
    const result = game.drop(0.3);
    expect(result.nearMiss).toBe(true);
    expect(game.combo).toBe(0);
  });

  it("keeps the near miss window wider than the perfect tolerance", () => {
    expect(CONFIG.nearMissMax).toBeGreaterThan(CONFIG.perfectTolerance);
  });
});

describe("combo tiers and scenery", () => {
  it("maps the combo to four tiers", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 12].map(comboTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it("moves the sky from day to space as the tower grows, clamped to 0..1", () => {
    expect(skyProgress(0)).toBe(0);
    expect(skyProgress(CONFIG.levelsToWin / 2)).toBeCloseTo(0.5, 10);
    expect(skyProgress(100)).toBe(1);
    expect(skyProgress(-3)).toBe(0);
  });

  it("pulls the camera out monotonically and then stops", () => {
    expect(cameraPullOut(0)).toBe(1);
    expect(cameraPullOut(7)).toBeGreaterThan(cameraPullOut(3));
    expect(cameraPullOut(40)).toBe(cameraPullOut(CONFIG.levelsToWin));
  });
});

describe("sky", () => {
  it("starts bright and ends dark, clamping out-of-range input", () => {
    const day = skyPalette(0);
    const space = skyPalette(1);
    expect(day.top[2]).toBeGreaterThan(200);
    expect(space.top[2]).toBeLessThan(60);
    expect(skyPalette(-5)).toEqual(day);
    expect(skyPalette(9)).toEqual(space);
  });

  it("shows no stars early and all of them late", () => {
    expect(starAlpha(0.3)).toBe(0);
    expect(starAlpha(0.65)).toBeCloseTo(0.5, 10);
    expect(starAlpha(1)).toBe(1);
  });

  it("speeds up block by block and tops out at level 20", () => {
    expect(speedForLevel(1)).toBeCloseTo(2.02, 10);
    expect(speedForLevel(14)).toBeCloseTo(3.58, 10);
    expect(speedForLevel(20)).toBeCloseTo(4.3, 10);
  });
});

describe("StackGame", () => {
  it("starts with one base block and the moving axis on x", () => {
    const game = new StackGame();
    expect(game.level).toBe(0);
    expect(game.axis).toBe("x");
    expect(game.over).toBe(false);
  });

  it("starts the moving block at the far edge of its swing", () => {
    const game = new StackGame();
    expect(game.movingCenter(0)).toBe(CONFIG.amplitude);
    expect(game.movingCenter(Math.PI / 2)).toBeCloseTo(0, 10);
  });

  it("adds a perfect block, scores it and keeps the combo going", () => {
    const game = new StackGame();
    const result = game.drop(0);
    expect(result.kind).toBe("perfect");
    expect(game.level).toBe(1);
    expect(game.combo).toBe(1);
    expect(game.score).toBe(2);
    expect(game.axis).toBe("z");
  });

  it("resets the combo on a cut and narrows the block", () => {
    const game = new StackGame();
    game.drop(0);
    game.drop(1);
    expect(game.combo).toBe(0);
    expect(game.top.d).toBeCloseTo(2, 10);
    expect(game.top.w).toBe(CONFIG.baseSize);
  });

  it("grows a narrowed block back after a streak of perfect drops", () => {
    const game = new StackGame();
    game.drop(1.5);
    const narrowed = game.top.w;
    expect(narrowed).toBeLessThan(CONFIG.baseSize);

    // Four perfect drops: the regrow starts at the third and applies to the
    // axis of the block being placed, so the fourth (x axis) widens the block.
    game.drop(0);
    game.drop(game.top.x);
    game.drop(game.top.z);
    game.drop(game.top.x);
    expect(game.combo).toBe(4);
    expect(game.top.w).toBeCloseTo(narrowed + CONFIG.regrowAmount, 10);
    expect(game.top.w).toBeLessThanOrEqual(CONFIG.baseSize);
  });

  it("ends the game on a miss and refuses further drops", () => {
    const game = new StackGame();
    const result = game.drop(10);
    expect(result.kind).toBe("miss");
    expect(result.index).toBeNull();
    expect(game.over).toBe(true);
    expect(game.won).toBe(false);
    expect(() => game.drop(0)).toThrow();
  });

  it("wins after the configured number of levels", () => {
    const game = new StackGame();
    for (let i = 0; i < CONFIG.levelsToWin; i += 1) {
      game.drop(game.axis === "x" ? game.top.x : game.top.z);
    }
    expect(game.won).toBe(true);
    expect(game.over).toBe(true);
    expect(game.level).toBe(CONFIG.levelsToWin);
  });

  it("is deterministic: the same drops give the same tower", () => {
    const play = (): string => {
      const game = new StackGame();
      for (const offset of [0.3, -0.5, 0.05, 1.1, -0.2]) {
        const center = (game.axis === "x" ? game.top.x : game.top.z) + offset;
        game.drop(center);
      }
      return JSON.stringify([game.blocks, game.score, game.combo]);
    };
    expect(play()).toBe(play());
  });
});
