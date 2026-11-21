import { describe, expect, it } from "vitest";
import {
  DIRS,
  PaintGame,
  generateLevel,
  mulberry32,
  nearWinMessage,
  starsFor,
  traceSlide,
} from "../games/paint-roll/src/game/rules.ts";
import { patternStep } from "../games/paint-roll/src/music.ts";

describe("paint-roll rules", () => {
  it("slides until hitting a wall or grid boundary", () => {
    const walls = [
      [false, false, true],
      [false, false, false],
      [false, false, false],
    ];
    expect(traceSlide(walls, { r: 0, c: 0 }, "right")).toEqual([{ r: 0, c: 1 }]);
    expect(traceSlide(walls, { r: 0, c: 0 }, "left")).toEqual([]);
    expect(traceSlide(walls, { r: 0, c: 0 }, "down")).toEqual([
      { r: 1, c: 0 },
      { r: 2, c: 0 },
    ]);
  });

  it("is deterministic and solvable across 200 generated seeds", () => {
    const first = generateLevel(17);
    expect(generateLevel(17)).toEqual(first);

    for (let seed = 1; seed <= 200; seed += 1) {
      const level = generateLevel(seed);
      expect(level.totalFloor).toBeGreaterThanOrEqual(17);
      expect(level.stars.length).toBe(3);
      const game = new PaintGame(level);
      for (const dir of level.solution) {
        const res = game.slide(dir);
        expect(res.moved, `seed ${seed}`).toBe(true);
      }
      expect(game.outcome, `seed ${seed}`).toBe("won");
      expect(game.remaining, `seed ${seed}`).toBe(0);
    }
  });

  it("supports a free demo move without spending movesLeft", () => {
    const level = generateLevel(17);
    const game = new PaintGame(level);
    const dir = game.hintDirection();
    expect(dir).not.toBeNull();
    const res = game.slide(dir!, true);
    expect(res.moved).toBe(true);
    expect(res.newlyPainted.length).toBeGreaterThan(0);
    expect(game.movesLeft).toBe(level.moves);
    expect(game.movesMade).toBe(0);
  });

  it("triggers the halfway milestone once and tracks stars and near-win messages", () => {
    const level = generateLevel(17);
    const game = new PaintGame(level);
    let milestones = 0;
    let totalStarsHit = 0;
    for (const dir of level.solution) {
      const res = game.slide(dir);
      if (res.milestone) milestones += 1;
      totalStarsHit += res.starsHit.length;
    }
    expect(milestones).toBe(1);
    expect(totalStarsHit).toBe(level.stars.length);
    expect(starsFor(true, 3, 1)).toBe(3);
    expect(starsFor(true, 0, 1)).toBe(2);
    expect(starsFor(false, 0, 0.85)).toBe(2);
    expect(starsFor(false, 0, 0.4)).toBe(1);
    expect(nearWinMessage(1, 4)).toBe("1 TILE LEFT!");
    expect(nearWinMessage(3, 5)).toBe("3 TILES LEFT!");
    expect(nearWinMessage(8, 2)).toBe("2 MOVES LEFT");
    expect(nearWinMessage(0, 2)).toBeNull();
  });

  it("keeps a fair difficulty band for a casual greedy bot across 150 seeds", () => {
    let wins = 0;
    for (let seed = 1; seed <= 150; seed += 1) {
      const level = generateLevel(seed);
      const game = new PaintGame(level);
      const rand = mulberry32(seed * 997);
      let lastBack: string | null = null;
      const opposite: Record<string, string> = { up: "down", down: "up", left: "right", right: "left" };
      while (game.outcome === "playing") {
        const options = DIRS.map((dir) => {
          const path = traceSlide(level.walls, { r: game.r, c: game.c }, dir);
          const fresh = path.filter((cell) => !game.painted[cell.r]![cell.c]).length;
          return { dir, len: path.length, fresh };
        }).filter((o) => o.len > 0);
        if (options.length === 0) break;
        options.sort((a, b) => b.fresh - a.fresh || b.len - a.len);
        const nonBack = options.filter((o) => o.dir !== lastBack);
        const top = (nonBack.length > 0 && nonBack[0]!.fresh > 0 ? nonBack : options);
        const pick = rand() < 0.82 ? top[0]! : top[Math.floor(rand() * top.length)]!;
        game.slide(pick.dir);
        lastBack = opposite[pick.dir] ?? null;
      }
      if (game.outcome === "won") wins += 1;
    }
    const rate = wins / 150;
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.9);
  });

  it("layers music steps with intensity", () => {
    expect(patternStep(0, 0).lead).toBeNull();
    expect(patternStep(0, 1).lead).not.toBeNull();
    expect(patternStep(0, 2).kick).toBe(true);
    expect(patternStep(2, 2).hat).toBe(true);
  });
});
