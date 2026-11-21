import { describe, expect, it } from "vitest";
import {
  CAPACITY,
  SortGame,
  canPour,
  isComplete,
  isPointless,
  isSolved,
  legalMoves,
  nearWinMessage,
  oneMoveToWin,
  pour,
  pourCount,
  starsFor,
  topRun,
  type Level,
  type Tubes,
} from "../games/sort-pop/src/game/rules.ts";
import { generateLevel, hintMove, mulberry32, solve } from "../games/sort-pop/src/game/level.ts";
import {
  COLORS,
  EMPTY_TUBES,
  MOVE_SLACK,
  RETRY_EXTRA_MOVES,
  SCRAMBLE_STEPS,
  SEED,
} from "../games/sort-pop/src/config.ts";
import { patternStep } from "../games/sort-pop/src/music.ts";

const OPTIONS = { colors: COLORS, emptyTubes: EMPTY_TUBES, steps: SCRAMBLE_STEPS, slack: MOVE_SLACK };

function level(tubes: number[][], moves = 10): Level {
  return { seed: 0, colors: 2, tubes, solution: [], moves };
}

describe("rules", () => {
  it("reads the top run of a tube", () => {
    expect(topRun([1, 2, 2])).toEqual({ color: 2, count: 2 });
    expect(topRun([3])).toEqual({ color: 3, count: 1 });
    expect(topRun([])).toBeNull();
  });

  it("allows a pour onto an empty tube or onto the same color", () => {
    const tubes: Tubes = [[0, 1], [], [2, 1], [0]];
    expect(canPour(tubes, 0, 1)).toBe(true);
    expect(canPour(tubes, 0, 2)).toBe(true);
    expect(canPour(tubes, 0, 3)).toBe(false);
  });

  it("refuses a pour from an empty tube, onto itself or onto a full tube", () => {
    const tubes: Tubes = [[1], [], [1, 1, 1, 1], [0, 1, 0, 1]];
    expect(canPour(tubes, 1, 0)).toBe(false);
    expect(canPour(tubes, 0, 0)).toBe(false);
    expect(canPour(tubes, 0, 2)).toBe(false);
    expect(canPour(tubes, 0, 3)).toBe(false);
  });

  it("moves the whole run, limited by the room in the target", () => {
    expect(pourCount([[0, 1, 1, 1], []], 0, 1)).toBe(3);
    expect(pourCount([[0, 1, 1, 1], [1, 1]], 0, 1)).toBe(2);
    expect(pourCount([[0, 1, 1], [1, 1, 1]], 0, 1)).toBe(1);
  });

  it("pours the balls and leaves the rest where they are", () => {
    const result = pour([[0, 1, 1], [1]], 0, 1);
    expect(result?.tubes).toEqual([[0], [1, 1, 1]]);
    expect(result?.count).toBe(2);
    expect(result?.color).toBe(1);
  });

  it("does not change the tubes it was given", () => {
    const tubes: Tubes = [[0, 1], []];
    pour(tubes, 0, 1);
    expect(tubes).toEqual([[0, 1], []]);
  });

  it("detects a completed tube", () => {
    expect(pour([[1], [1, 1, 1]], 0, 1)?.completed).toBe(true);
    expect(pour([[0, 1], [1, 1]], 0, 1)?.completed).toBe(false);
    expect(isComplete([2, 2, 2, 2])).toBe(true);
    expect(isComplete([2, 2, 2])).toBe(false);
  });

  it("locks a completed tube", () => {
    expect(canPour([[2, 2, 2, 2], []], 0, 1)).toBe(false);
  });

  it("is solved when every tube is empty or complete", () => {
    expect(isSolved([[0, 0, 0, 0], [], [1, 1, 1, 1]])).toBe(true);
    expect(isSolved([[0, 0, 0, 1], [1, 1, 1, 0]])).toBe(false);
    expect(isSolved([[0, 0, 0], []])).toBe(false);
  });

  it("calls a whole tube moved to an empty one pointless", () => {
    expect(isPointless([[0, 0], []], 0, 1)).toBe(true);
    expect(isPointless([[1, 0, 0], []], 0, 1)).toBe(false);
    expect(isPointless([[0, 0], [0]], 0, 1)).toBe(false);
  });

  it("lists the legal moves", () => {
    expect(legalMoves([[0], [1], []])).toEqual([[0, 2], [1, 2]]);
  });

  it("sees a win that is one pour away", () => {
    expect(oneMoveToWin([[0, 0, 0], [0], [1, 1, 1, 1]])).toBe(true);
    expect(oneMoveToWin([[0, 1], [1, 0], []])).toBe(false);
  });
});

describe("SortGame", () => {
  it("counts moves down and wins when the puzzle is solved", () => {
    const game = new SortGame(level([[0, 0, 0], [0], [1, 1, 1, 1]], 3));
    const result = game.pour(1, 0);
    expect(result).toMatchObject({ completed: true, combo: 1, completedTotal: 2, movesLeft: 2, outcome: "won" });
    expect(game.outcome).toBe("won");
  });

  it("ignores an illegal pour and does not spend a move", () => {
    const game = new SortGame(level([[0, 1], [1, 0]], 3));
    expect(game.pour(0, 1)).toBeNull();
    expect(game.movesLeft).toBe(3);
  });

  it("loses when the moves run out", () => {
    const game = new SortGame(level([[0, 1], [1, 0], []], 1));
    expect(game.pour(0, 2)?.outcome).toBe("lost");
    expect(game.stuck).toBe(false);
  });

  it("loses at once when a pour leaves no legal pour", () => {
    // After 0 -> 1 tube 1 is complete and tube 0 holds one ball with nowhere to go.
    const game = new SortGame(level([[0, 1], [1, 1, 1]], 5));
    expect(game.pour(0, 1)?.outcome).toBe("lost");
    expect(game.stuck).toBe(true);
  });

  it("refuses moves after the game ends", () => {
    const game = new SortGame(level([[0, 0, 0], [0], [1, 1, 1, 1]], 3));
    game.pour(1, 0);
    expect(game.pour(0, 1)).toBeNull();
  });

  it("builds a combo from tubes completed back to back, and resets it", () => {
    const game = new SortGame(
      { seed: 0, colors: 3, tubes: [[0, 0, 0], [0], [1, 1, 1], [1], [2, 2], [2, 2]], solution: [], moves: 9 },
      1,
    );
    expect(game.pour(1, 0)?.combo).toBe(1);
    expect(game.pour(3, 2)?.combo).toBe(2);
    expect(game.pour(4, 5)?.combo).toBe(3);
    expect(game.combo).toBe(3);
  });

  it("resets the combo on a pour that completes nothing", () => {
    const game = new SortGame(level([[0, 0, 0], [0], [1, 1], [1], []], 9));
    game.pour(1, 0);
    expect(game.combo).toBe(1);
    game.pour(3, 2);
    game.pour(2, 4);
    expect(game.combo).toBe(0);
  });

  it("adds empty tubes as a retry bonus", () => {
    const game = new SortGame(level([[0], [1]]), 1);
    expect(game.tubes).toHaveLength(3);
    expect(game.tubes[2]).toEqual([]);
  });

  it("reports progress as the share of sorted colors", () => {
    const game = new SortGame({ ...level([[0, 0, 0, 0], [1, 1], [1, 1]]), colors: 2 });
    expect(game.progress).toBe(0.5);
  });
});

describe("retention helpers", () => {
  it("gives a win with moves to spare three stars", () => {
    expect(starsFor(true, 3, 4, 4)).toBe(3);
    expect(starsFor(true, 0, 4, 4)).toBe(2);
  });

  it("gives a loss up to two stars by how many tubes are sorted", () => {
    expect(starsFor(false, 0, 0, 4)).toBe(0);
    expect(starsFor(false, 0, 1, 4)).toBe(1);
    expect(starsFor(false, 0, 3, 4)).toBe(2);
  });

  it("makes a near win visible", () => {
    expect(nearWinMessage([[0, 0, 0], [0], [1, 1, 1, 1]], 5, 2)).toBe("ONE POUR TO WIN!");
    expect(nearWinMessage([[0, 0, 0, 0], [1, 1, 0], [1, 0]], 9, 2)).toBe("LAST COLOR!");
    expect(nearWinMessage([[0, 1, 0], [1, 0, 1], []], 2, 3)).toBe("2 MOVES LEFT");
    expect(nearWinMessage([[0, 1, 0], [1, 0, 1], []], 9, 3)).toBeNull();
  });
});

describe("generator", () => {
  it("is deterministic", () => {
    expect(generateLevel(5, OPTIONS)).toEqual(generateLevel(5, OPTIONS));
    expect(generateLevel(5, OPTIONS)).not.toEqual(generateLevel(6, OPTIONS));
    const a = mulberry32(1);
    const b = mulberry32(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("starts with every color the right number of times and nothing finished", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const made = generateLevel(seed, OPTIONS);
      expect(made.tubes).toHaveLength(COLORS + EMPTY_TUBES);
      for (let color = 0; color < COLORS; color += 1) {
        expect(made.tubes.flat().filter((ball) => ball === color)).toHaveLength(CAPACITY);
      }
      expect(made.tubes.every((tube) => tube.length <= CAPACITY)).toBe(true);
      expect(made.tubes.some(isComplete)).toBe(false);
      expect(isSolved(made.tubes)).toBe(false);
    }
  });

  it("is solvable for many seeds: replaying the recorded solution wins", () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const made = generateLevel(seed, OPTIONS);
      let tubes: Tubes = made.tubes;
      for (const [from, to] of made.solution) {
        const outcome = pour(tubes, from, to);
        expect(outcome, `seed ${seed}: illegal recorded move ${from}->${to}`).not.toBeNull();
        tubes = (outcome as { tubes: Tubes }).tubes;
      }
      expect(isSolved(tubes), `seed ${seed} is not solved by its own solution`).toBe(true);
      expect(made.moves).toBe(made.solution.length + MOVE_SLACK);
    }
  });

  it("is solvable with the game rules, and the solver agrees", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const made = generateLevel(seed, OPTIONS);
      const path = solve(made.tubes);
      expect(path, `seed ${seed}`).not.toBeNull();
      expect((path ?? []).length).toBeLessThanOrEqual(made.solution.length);
    }
  });

  it("is still solvable with the retry bonus tube", () => {
    const made = generateLevel(SEED, OPTIONS);
    const game = new SortGame(made, 1);
    for (const [from, to] of made.solution) game.pour(from, to);
    expect(game.outcome).toBe("won");
  });

  it("opens with an early reward, a combo and a few spare moves", () => {
    const made = generateLevel(SEED, OPTIONS);
    const path = solve(made.tubes) ?? [];
    let tubes: Tubes = made.tubes;
    const completions: number[] = [];
    path.forEach(([from, to], index) => {
      const outcome = pour(tubes, from, to);
      if (!outcome) return;
      tubes = outcome.tubes;
      if (outcome.completed) completions.push(index + 1);
    });
    expect(completions[0]).toBeLessThanOrEqual(3);
    expect(completions.some((move, i) => completions[i + 1] === move + 1)).toBe(true);
    expect(made.moves - path.length).toBeGreaterThanOrEqual(3);
  });

  it("gives a hint that is a legal pour", () => {
    const made = generateLevel(SEED, OPTIONS);
    const hint = hintMove(made.tubes);
    expect(hint).not.toBeNull();
    expect(canPour(made.tubes, (hint as [number, number])[0], (hint as [number, number])[1])).toBe(true);
  });
});

describe("difficulty", () => {
  /** A simple bot: prefers pours that complete a tube, then ones that reduce color changes. */
  function mixedness(tubes: Tubes): number {
    let changes = 0;
    for (const tube of tubes) for (let i = 1; i < tube.length; i += 1) if (tube[i] !== tube[i - 1]) changes += 1;
    return changes;
  }

  /** `mistakes` is the share of pours the bot makes at random, like a casual player. */
  function botMove(
    game: SortGame,
    random: () => number,
    last: readonly [number, number] | null,
    mistakes: number,
  ): [number, number] | null {
    const options = legalMoves(game.tubes, true).filter((m) => !(last && m[0] === last[1] && m[1] === last[0]));
    if (options.length === 0) return null;
    if (random() < mistakes) {
      const pick = options[Math.floor(random() * options.length)] as [number, number];
      return [pick[0], pick[1]];
    }
    let best: [number, number] | null = null;
    let bestScore = -Infinity;
    for (const move of options) {
      const outcome = pour(game.tubes, move[0], move[1]);
      if (!outcome) continue;
      const score = (outcome.completed ? 50 : 0) + (mixedness(game.tubes) - mixedness(outcome.tubes)) * 4 + random() * 3;
      if (score > bestScore) {
        bestScore = score;
        best = [move[0], move[1]];
      }
    }
    return best;
  }

  function winRate(games: number, mistakes: number, extraMoves = 0): number {
    let wins = 0;
    for (let seed = 1; seed <= games; seed += 1) {
      const game = new SortGame(generateLevel(seed, OPTIONS), 0, extraMoves);
      const random = mulberry32(seed * 31);
      let last: [number, number] | null = null;
      while (game.outcome === "playing") {
        const move = botMove(game, random, last, mistakes);
        if (!move) break;
        game.pour(move[0], move[1]);
        last = move;
      }
      if (game.outcome === "won") wins += 1;
    }
    return wins / games;
  }

  it("keeps the level fair: a casual bot wins some games and loses some", () => {
    // The bot plays greedily and makes a random pour three times in ten.
    const rate = winRate(300, 0.3);
    // A human who plans ahead beats the bot, so the band is wide on purpose:
    // a regression to "always wins" or "almost never wins" fails here.
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.85);
  });

  it("is not a walkover even for a bot that never makes a mistake", () => {
    expect(winRate(300, 0)).toBeLessThan(0.97);
  });

  it("makes the retry bonus moves help", () => {
    expect(winRate(300, 0.3, RETRY_EXTRA_MOVES)).toBeGreaterThan(winRate(300, 0.3));
  });

  it("needs a run that fits the 30 to 45 second window", () => {
    // About two to three seconds per pour for a new player.
    for (let seed = 1; seed <= 100; seed += 1) {
      const { moves } = generateLevel(seed, OPTIONS);
      expect(moves).toBeGreaterThanOrEqual(10);
      expect(moves).toBeLessThanOrEqual(18);
    }
  });
});

describe("music", () => {
  it("plays a steady pattern: a bass note on each beat and a rising intensity adds layers", () => {
    const quiet = patternStep(0, 0);
    expect(quiet.bass).not.toBeNull();
    expect(patternStep(1, 0).bass).toBeNull();
    const calm = Array.from({ length: 64 }, (_, i) => patternStep(i, 0)).filter((s) => s.hat).length;
    const busy = Array.from({ length: 64 }, (_, i) => patternStep(i, 3)).filter((s) => s.hat).length;
    expect(busy).toBeGreaterThan(calm);
  });
});
