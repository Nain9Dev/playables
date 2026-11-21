import { describe, expect, it } from "vitest";
import {
  CONFIG,
  MergeGame,
  SIZE,
  START_LAYOUT,
  bestTile,
  canMove,
  demoDirection,
  emptyCells,
  multiplierFor,
  mulberry32,
  nearMissLine,
  nearWinMessage,
  slide,
  starsFor,
  type Tile,
} from "../games/merge-pop/src/game/rules.ts";

function board(rows: number[][]): Tile[] {
  const tiles: Tile[] = [];
  let id = 1;
  rows.forEach((values, row) => {
    values.forEach((value, col) => {
      if (value > 0) tiles.push({ id: id++, value, row, col });
    });
  });
  return tiles;
}

function rowOf(tiles: readonly Tile[], row: number): number[] {
  const values = [0, 0, 0, 0];
  for (const tile of tiles) if (tile.row === row) values[tile.col] = tile.value;
  return values;
}

function colOf(tiles: readonly Tile[], col: number): number[] {
  const values = [0, 0, 0, 0];
  for (const tile of tiles) if (tile.col === col) values[tile.row] = tile.value;
  return values;
}

describe("slide", () => {
  it("slides tiles to the edge", () => {
    const result = slide(board([[0, 2, 0, 4]]), "left");
    expect(rowOf(result.tiles, 0)).toEqual([2, 4, 0, 0]);
    expect(result.moved).toBe(true);
    expect(result.gained).toBe(0);
  });

  it("merges two equal tiles and scores the new value", () => {
    const result = slide(board([[2, 2, 0, 0]]), "left");
    expect(rowOf(result.tiles, 0)).toEqual([4, 0, 0, 0]);
    expect(result.gained).toBe(4);
    expect(result.merges).toHaveLength(1);
  });

  it("merges each tile at most once per move", () => {
    expect(rowOf(slide(board([[2, 2, 2, 2]]), "left").tiles, 0)).toEqual([4, 4, 0, 0]);
    expect(rowOf(slide(board([[4, 2, 2, 0]]), "left").tiles, 0)).toEqual([4, 4, 0, 0]);
    expect(rowOf(slide(board([[2, 2, 4, 0]]), "left").tiles, 0)).toEqual([4, 4, 0, 0]);
  });

  it("merges the pair nearest the edge first", () => {
    expect(rowOf(slide(board([[2, 2, 2, 0]]), "left").tiles, 0)).toEqual([4, 2, 0, 0]);
    expect(rowOf(slide(board([[0, 2, 2, 2]]), "right").tiles, 0)).toEqual([0, 0, 2, 4]);
  });

  it("works in all four directions", () => {
    const tiles = board([[2, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    expect(colOf(slide(tiles, "up").tiles, 0)).toEqual([4, 0, 0, 0]);
    expect(colOf(slide(tiles, "down").tiles, 0)).toEqual([0, 0, 0, 4]);
    const row = board([[2, 2, 0, 0]]);
    expect(rowOf(slide(row, "right").tiles, 0)).toEqual([0, 0, 0, 4]);
  });

  it("reports no movement when nothing changes", () => {
    const result = slide(board([[2, 4, 8, 16]]), "left");
    expect(result.moved).toBe(false);
    expect(result.merges).toHaveLength(0);
  });

  it("keeps tile ids stable and removes only the absorbed tile", () => {
    const tiles = board([[2, 2, 4, 0]]);
    const result = slide(tiles, "left");
    const ids = result.tiles.map((tile) => tile.id).sort();
    expect(ids).toEqual([1, 3]);
    expect(result.merges[0]).toMatchObject({ survivor: 1, absorbed: 2, value: 4 });
  });

  it("conserves the sum of all tile values", () => {
    const start = board([[2, 2, 4, 8], [4, 4, 8, 8], [16, 0, 16, 2], [0, 2, 2, 2]]);
    const total = (tiles: readonly Tile[]) => tiles.reduce((sum, tile) => sum + tile.value, 0);
    for (const direction of ["left", "right", "up", "down"] as const) {
      expect(total(slide(start, direction).tiles)).toBe(total(start));
    }
  });
});

describe("board helpers", () => {
  it("lists empty cells and detects a full board with no move", () => {
    expect(emptyCells(board([[2]]))).toHaveLength(SIZE * SIZE - 1);
    const stuck = board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]);
    expect(canMove(stuck)).toBe(false);
    const open = board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4]]);
    expect(canMove(open)).toBe(true);
  });

  it("finds the best tile", () => {
    expect(bestTile(board([[2, 64, 8]]))).toBe(64);
  });

  it("is deterministic for the same seed", () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 20; i += 1) expect(a()).toBe(b());
  });
});

describe("MergeGame", () => {
  it("starts with the opening layout and the full move budget", () => {
    const game = new MergeGame(1);
    expect(game.tiles).toHaveLength(START_LAYOUT.length);
    expect(game.movesLeft).toBe(CONFIG.moves);
    expect(game.outcome).toBe("playing");
  });

  it("does not spend a move or spawn a tile when the move changes nothing", () => {
    const game = new MergeGame(1, 5, [[0, 0, 2], [0, 1, 4]]);
    const result = game.move("left");
    expect(result.moved).toBe(false);
    expect(game.movesLeft).toBe(5);
    expect(game.tiles).toHaveLength(2);
  });

  it("spends a move and spawns a 2 or a 4 after a real move", () => {
    const game = new MergeGame(1);
    const before = game.tiles.length;
    const result = game.move("left");
    expect(result.moved).toBe(true);
    expect(game.movesLeft).toBe(CONFIG.moves - 1);
    expect(result.spawned && [2, 4].includes(result.spawned.value)).toBe(true);
    expect(game.tiles.length).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });

  it("reports a combo when one move makes several merges", () => {
    const game = new MergeGame(1, 5, [[0, 0, 2], [0, 1, 2], [1, 0, 4], [1, 1, 4]]);
    const result = game.move("left");
    expect(result.combo).toBe(2);
    expect(game.score).toBe(12);
  });

  it("wins when a tile reaches the goal", () => {
    const game = new MergeGame(1, 5, [[0, 0, 64], [0, 1, 64]]);
    const result = game.move("left");
    expect(result.outcome).toBe("won");
    expect(game.outcome).toBe("won");
  });

  it("loses when the moves run out", () => {
    const game = new MergeGame(1, 1, [[0, 0, 2], [0, 3, 2]]);
    expect(game.move("left").outcome).toBe("lost");
  });

  it("refuses further moves after the game ends", () => {
    const game = new MergeGame(1, 1, [[0, 0, 2], [0, 3, 2]]);
    game.move("left");
    expect(game.move("right")).toMatchObject({ moved: false, outcome: "lost" });
  });

  it("is deterministic: the same seed and moves give the same game", () => {
    const play = (): string => {
      const game = new MergeGame(9);
      for (const direction of ["left", "up", "right", "down", "left", "up"] as const) game.move(direction);
      return JSON.stringify([game.tiles, game.score, game.movesLeft]);
    };
    expect(play()).toBe(play());
  });

  it("reports progress from 0 to 1 on a log scale", () => {
    expect(new MergeGame(1, 5, [[0, 0, 2]]).progress).toBeCloseTo(1 / 7, 5);
    expect(new MergeGame(1, 5, [[0, 0, 128]]).progress).toBe(1);
  });
});

describe("difficulty", () => {
  /** A simple bot: take the move that scores most, then merges most, then keeps the board emptiest. */
  function greedyMove(game: MergeGame): "left" | "right" | "up" | "down" {
    let best: "left" | "right" | "up" | "down" = "left";
    let bestKey = -1;
    for (const direction of ["left", "right", "up", "down"] as const) {
      const result = slide(game.tiles, direction);
      if (!result.moved) continue;
      const key = result.gained * 100 + result.merges.length * 10 + (16 - result.tiles.length);
      if (key > bestKey) {
        bestKey = key;
        best = direction;
      }
    }
    return best;
  }

  it("keeps the level fair: a simple bot wins some games and loses some", () => {
    let wins = 0;
    const games = 200;
    for (let seed = 1; seed <= games; seed += 1) {
      const game = new MergeGame(seed);
      for (let guard = 0; game.outcome === "playing" && guard < 100; guard += 1) game.move(greedyMove(game));
      if (game.outcome === "won") wins += 1;
    }
    // A human who plans ahead beats the bot, so the band is wide on purpose:
    // a regression to "always wins" or "almost never wins" fails here.
    expect(wins / games).toBeGreaterThan(0.3);
    expect(wins / games).toBeLessThan(0.8);
  });

  it("opens with the goal in sight and a move that merges", () => {
    const game = new MergeGame(1);
    expect(game.best).toBeGreaterThanOrEqual(CONFIG.goal / 2);
    expect(["left", "right", "up", "down"].some((d) => slide(game.tiles, d as "left").merges.length > 0)).toBe(true);
  });
});

describe("streak multiplier", () => {
  it("maps streaks to multipliers and caps them", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(multiplierFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("builds a streak over merging moves, scales the score and breaks on a move without a merge", () => {
    // Row 0: 2 2 4 4 -> left gives 4 8 (combo), then 4 8 stays apart.
    const game = new MergeGame(1, 10, [[0, 0, 2], [0, 1, 2], [3, 0, 8], [3, 1, 8], [2, 3, 16], [1, 3, 16]]);
    const first = game.move("left");
    expect(first.streak).toBe(1);
    expect(first.multiplier).toBe(1);
    expect(first.gained).toBe(4 + 16);
    const second = game.move("up");
    expect(second.merges.length).toBeGreaterThan(0);
    expect(second.streak).toBe(2);
    expect(second.multiplier).toBe(2);
    expect(second.gained).toBe(second.merges.reduce((sum, m) => sum + m.value, 0) * 2);
  });

  it("resets the streak when a move merges nothing", () => {
    const game = new MergeGame(1, 10, [[0, 0, 2], [0, 1, 2], [3, 3, 4]]);
    game.move("left");
    expect(game.streak).toBe(1);
    const next = game.move("right");
    expect(next.merges).toHaveLength(0);
    expect(next.streak).toBe(0);
    expect(next.multiplier).toBe(1);
  });
});

describe("free demo move", () => {
  it("picks the direction with the most merges", () => {
    const tiles = board([[2, 2, 0, 0], [4, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 8]]);
    const direction = demoDirection(tiles);
    expect(direction && slide(tiles, direction).merges.length).toBe(2);
  });

  it("returns null when nothing can move", () => {
    expect(demoDirection(board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]))).toBeNull();
  });

  it("opens with a direction that merges on the real layout", () => {
    const game = new MergeGame(1);
    const direction = demoDirection(game.tiles);
    expect(direction && slide(game.tiles, direction).merges.length).toBeGreaterThan(0);
  });

  it("spends no move and is not counted as a played move", () => {
    const game = new MergeGame(1);
    const direction = demoDirection(game.tiles);
    if (!direction) throw new Error("no demo move");
    const result = game.move(direction, true);
    expect(result.moved).toBe(true);
    expect(game.movesLeft).toBe(CONFIG.moves);
    expect(game.movesMade).toBe(0);
  });
});

describe("smash booster", () => {
  function played(moves: number): MergeGame {
    const game = new MergeGame(1, 40, [[0, 0, 2], [0, 3, 4], [3, 0, 8]]);
    for (let i = 0; i < moves; i += 1) game.move(i % 2 === 0 ? "right" : "left");
    return game;
  }

  it("is not ready before the offer move", () => {
    const game = played(CONFIG.boosterAtMove - 1);
    expect(game.movesMade).toBe(CONFIG.boosterAtMove - 1);
    expect(game.boosterReady).toBe(false);
    expect(game.smash(0, 0)).toBeNull();
  });

  it("becomes ready at the offer move and removes the chosen tile without spending a move", () => {
    const game = played(CONFIG.boosterAtMove);
    expect(game.boosterReady).toBe(true);
    const target = game.tiles[0];
    if (!target) throw new Error("empty board");
    const movesLeft = game.movesLeft;
    const count = game.tiles.length;
    expect(game.smash(target.row, target.col)?.id).toBe(target.id);
    expect(game.tiles).toHaveLength(count - 1);
    expect(game.movesLeft).toBe(movesLeft);
  });

  it("can be used once and ignores empty cells", () => {
    const game = played(CONFIG.boosterAtMove);
    const free = emptyCells(game.tiles)[0];
    if (!free) throw new Error("no empty cell");
    expect(game.smash(free.row, free.col)).toBeNull();
    expect(game.boosterReady).toBe(true);
    const target = game.tiles[0];
    if (!target) throw new Error("empty board");
    game.smash(target.row, target.col);
    expect(game.boosterReady).toBe(false);
    const other = game.tiles[0];
    if (!other) throw new Error("empty board");
    expect(game.smash(other.row, other.col)).toBeNull();
  });
});

describe("milestone", () => {
  it("fires once when the second 64 appears", () => {
    const game = new MergeGame(1, 10, [[0, 0, 32], [0, 1, 32], [3, 0, 64]]);
    const first = game.move("left");
    expect(first.milestone).toBe(true);
    const second = game.move("right");
    expect(second.milestone).toBe(false);
  });

  it("does not fire with a single 64", () => {
    const game = new MergeGame(1, 10, [[0, 0, 2], [0, 1, 2], [3, 0, 64]]);
    expect(game.move("left").milestone).toBe(false);
  });
});

describe("near-miss line", () => {
  it("reflects how close the board was", () => {
    expect(nearMissLine(board([[64, 64]]))).toMatch(/one merge from 128/);
    expect(nearMissLine(board([[64, 8]]))).toMatch(/64/);
    expect(nearMissLine(board([[16, 8]]))).toMatch(/Best tile 16/);
  });
});

describe("retention helpers", () => {
  it("gives a win with moves to spare three stars", () => {
    expect(starsFor(true, 10, 128)).toBe(3);
    expect(starsFor(true, 2, 128)).toBe(2);
  });

  it("gives a loss one or two stars by how far the best tile got", () => {
    expect(starsFor(false, 0, 32)).toBe(1);
    expect(starsFor(false, 0, 64)).toBe(2);
  });

  it("teases the win when two half-goal tiles are on the board", () => {
    expect(nearWinMessage(board([[64, 64]]))).toBe("ONE MERGE TO WIN!");
    expect(nearWinMessage(board([[64, 8]]))).toBe("ALMOST THERE");
    expect(nearWinMessage(board([[32, 8]]))).toBeNull();
  });
});
