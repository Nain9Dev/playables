import { onViewableChange, openStore, whenAdReady } from "../../../kit/sdk.ts";
import { haptic, note, pauseAudio, resumeAudio, setAudioMuted, tone, unlockAudio } from "../../../kit/audio.ts";
import { track } from "../../../kit/telemetry.ts";
import {
  COLORS,
  CTA_URL,
  EMPTY_TUBES,
  END_CARD_DELAY_MS,
  FINGER_START_MS,
  IDLE_HINT_SECONDS,
  MAX_ACTIVE_SECONDS,
  MOVE_SLACK,
  RETRIES,
  RETRY_EXTRA_MOVES,
  RETRY_EXTRA_TUBES,
  SCRAMBLE_STEPS,
  SEED,
} from "./config.ts";
import { generateLevel, hintMove } from "./game/level.ts";
import { SortGame, isComplete, nearWinMessage, starsFor, topRun } from "./game/rules.ts";
import { createMusic } from "./music.ts";
import { SortView } from "./render/view.ts";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const canvas = element<HTMLCanvasElement>("stage");
const caption = element("caption");
const goalText = element("goal");
const fill = element("fill");
const tubesText = element("tubes");
const movesText = element("moves");
const tubesChip = element("tubes-chip");
const movesChip = element("moves-chip");
const toast = element("toast");
const pops = element("pops");
const finger = element("finger");
const soundButton = element("sound");
const endCard = element("end");
const endTitle = element("end-title");
const endText = element("end-text");
const endStars = element("stars");
const teaser = element("teaser");
const retryButton = element("retry");
const againButton = element("again");

const level = generateLevel(SEED, { colors: COLORS, emptyTubes: EMPTY_TUBES, steps: SCRAMBLE_STEPS, slack: MOVE_SLACK });
const view = new SortView(canvas);
const music = createMusic();

let game = new SortGame(level);
let paused = true;
let ended = false;
let lastFrame = 0;
let startedAt = 0;
let activeSeconds = 0;
let idleSeconds = 0;
let hasPoured = false;
let hasTapped = false;
let retriesLeft = RETRIES;
let selected: number | null = null;
let busyUntil = 0;
let hintShown = false;
let lastNearWin = "";
let fingerToken = 0;

// Sound design: a few synthesized notes per event, so the file carries no audio data.
// The pitch of each completed tube climbs a major pentatonic scale.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
const step = (index: number): number => SCALE[Math.min(SCALE.length - 1, Math.max(0, index))] ?? 0;
const pickUp = (color: number): void => tone(note(step(color), 392), 0.1, "sine", 0.12);
const landing = (slot: number, completed: number): void =>
  tone(note(step(slot + completed), 330), 0.09, "triangle", 0.13);
const invalid = (): void => tone(130, 0.11, "square", 0.05);
function tubeChime(completed: number, combo: number): void {
  const base = step(completed - 1);
  [0, 4, 7, 12].forEach((offset, i) => tone(note(base + offset, 523.25), 0.22, "sine", 0.15, i * 0.06));
  if (combo >= 2) [12, 16, 19].forEach((offset, i) => tone(note(base + offset, 523.25), 0.2, "sine", 0.09, 0.2 + i * 0.05));
}
const winFanfare = (): void => [0, 4, 7, 12, 16, 19].forEach((s, i) => tone(note(s), 0.3, "sine", 0.17, i * 0.09));
const loseThud = (): void => tone(85, 0.4, "sawtooth", 0.12);

function showToast(text: string, tint: "" | "gold" | "red" = ""): void {
  toast.textContent = text;
  toast.className = tint;
  // Reading offsetWidth restarts the CSS animation.
  void toast.offsetWidth;
  toast.classList.add("show");
}

function showPop(text: string, tube: number): void {
  const at = view.screenOf(tube, 0.5);
  const pop = document.createElement("span");
  pop.className = "pop";
  pop.textContent = text;
  pop.style.left = `${at.x}px`;
  pop.style.top = `${at.y}px`;
  pops.appendChild(pop);
  window.setTimeout(() => pop.remove(), 1050);
}

function bump(chip: HTMLElement): void {
  chip.classList.add("bump");
  window.setTimeout(() => chip.classList.remove("bump"), 130);
}

function renderHud(): void {
  tubesText.textContent = `${game.completed}/${game.colors}`;
  movesText.textContent = String(game.movesLeft);
  movesChip.classList.toggle("urgent", game.movesLeft <= 3 && game.outcome === "playing");
  // The bar never starts empty: a sliver of progress makes the goal feel started.
  fill.style.transform = `scaleX(${Math.max(0.04, game.progress)})`;
  const done = game.completed;
  music.setIntensity(done >= game.colors - 1 ? 3 : done >= 3 ? 2 : done >= 1 ? 1 : 0);
}

function renderStars(count: number): void {
  endStars.replaceChildren(
    ...[1, 2, 3].map((n) => {
      const star = document.createElement("span");
      star.textContent = "★";
      if (n > count) star.className = "off";
      return star;
    }),
  );
}

// --- Finger tutorial and hint --------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

function cancelFinger(): void {
  fingerToken += 1;
  finger.classList.remove("show", "press");
  view.setHint(null, null);
}

/** Show a finger that taps `from`, drags to `to` and taps again, until cancelled. */
async function loopFinger(from: number, to: number): Promise<void> {
  fingerToken += 1;
  const token = fingerToken;
  const alive = (): boolean => token === fingerToken && !ended;
  view.setHint(from, to);
  while (alive()) {
    const a = view.screenOf(from, 0.55);
    const b = view.screenOf(to, 0.55);
    finger.classList.add("snap");
    finger.style.left = `${a.x}px`;
    finger.style.top = `${a.y + 30}px`;
    void finger.offsetWidth;
    finger.classList.remove("snap");
    finger.classList.add("show");
    await sleep(450);
    if (!alive()) return;
    finger.classList.add("press");
    await sleep(260);
    finger.classList.remove("press");
    await sleep(120);
    finger.style.left = `${b.x}px`;
    finger.style.top = `${b.y + 30}px`;
    await sleep(760);
    if (!alive()) return;
    finger.classList.add("press");
    await sleep(260);
    finger.classList.remove("press");
    finger.classList.remove("show");
    await sleep(900);
  }
}

function startOpeningFinger(): void {
  const first = hintMove(level.tubes);
  if (first && !hasPoured) void loopFinger(first[0], first[1]);
}

function showHint(): void {
  const move = hintMove(game.tubes);
  if (!move) return;
  hintShown = true;
  track("idle_hint", { seconds: IDLE_HINT_SECONDS });
  void loopFinger(move[0], move[1]);
}

// --- Rounds ---------------------------------------------------------------------------

function showEndCard(outcome: "win" | "fail" | "time"): void {
  if (ended) return;
  ended = true;
  cancelFinger();
  window.setTimeout(() => {
    const won = outcome === "win";
    const stars = starsFor(won, game.movesLeft, game.completed, game.colors);
    const close = game.completed >= game.colors - 1;
    endTitle.textContent = won ? "Sorted!" : game.stuck ? "No pours left!" : close ? "So close!" : "Out of moves!";
    endText.textContent = won
      ? game.movesLeft > 0
        ? `${game.movesLeft} ${game.movesLeft === 1 ? "move" : "moves"} to spare`
        : "Sorted with the last move"
      : `${game.completed} of ${game.colors} tubes sorted`;
    // A teaser of what comes next pulls the player forward, whatever the result.
    teaser.textContent = won ? "Level 2: more colors, fewer free tubes" : "Sort every color to unlock Level 2";
    element("end-install").textContent = won ? "PLAY LEVEL 2" : "PLAY MORE LEVELS";
    renderStars(stars);
    const canRetry = !won && retriesLeft > 0;
    retryButton.textContent = canRetry ? "TRY AGAIN, +1 EMPTY TUBE" : "TRY AGAIN";
    retryButton.classList.toggle("hidden", !canRetry);
    againButton.classList.toggle("hidden", canRetry);
    endCard.classList.add("show");
    track("end_card", { outcome, stars, tubes: game.completed, movesLeft: game.movesLeft });
  }, END_CARD_DELAY_MS);
}

function startRound(extraTubes: number, extraMoves: number): void {
  game = new SortGame(level, extraTubes, extraMoves);
  view.setLevel(game.tubes);
  selected = null;
  ended = false;
  activeSeconds = 0;
  idleSeconds = 0;
  hintShown = false;
  lastNearWin = "";
  busyUntil = 0;
  endCard.classList.remove("show");
  goalText.textContent = String(game.movesLeft);
  renderHud();
  if (hasPoured) caption.classList.add("gone");
}

// --- Input ----------------------------------------------------------------------------

function pickUpTube(index: number): void {
  const tube = game.tubes[index];
  const run = tube ? topRun(tube) : null;
  if (!tube || !run || isComplete(tube)) {
    invalid();
    haptic(8);
    view.shakeTube(index);
    track("invalid", { reason: tube && tube.length > 0 ? "complete" : "empty" });
    return;
  }
  selected = index;
  view.setSelected(index, run.count);
  pickUp(run.color);
  haptic(6);
  track("select", { color: run.color, run: run.count });
}

function afterPour(result: NonNullable<ReturnType<SortGame["pour"]>>): void {
  if (result.completed) {
    const big = result.outcome === "won";
    view.celebrate(result.to, big);
    tubeChime(result.completedTotal, result.combo);
    haptic(result.combo >= 2 ? 45 : 28);
    showPop("+1", result.to);
    bump(tubesChip);
    track("tube_complete", { total: result.completedTotal, combo: result.combo, movesLeft: result.movesLeft });
    if (result.milestone && result.outcome === "playing") {
      showToast("HALFWAY!", "gold");
      view.punch(0.08);
      [0, 4, 7, 12].forEach((s, i) => tone(note(s, 392), 0.24, "triangle", 0.14, i * 0.06));
      haptic(35);
      track("milestone", { tubes: result.completedTotal });
    } else if (result.combo >= 2 && result.outcome === "playing") {
      showToast(`COMBO x${result.combo}!`, "gold");
      view.punch(0.04 + result.combo * 0.015);
      track("combo", { count: result.combo });
    } else if (result.outcome === "playing" && result.completedTotal === 1) {
      showToast("NICE!", "gold");
    }
  }
  renderHud();

  if (result.outcome === "won") {
    window.setTimeout(() => {
      view.celebrateAll();
      winFanfare();
      haptic(80);
    }, 350);
    track("win", { movesLeft: result.movesLeft, moves: game.movesMade });
    showEndCard("win");
    return;
  }
  if (result.outcome === "lost") {
    view.kick();
    loseThud();
    haptic(50);
    track("fail", { reason: game.stuck ? "stuck" : "moves", tubes: game.completed });
    showEndCard("fail");
    return;
  }

  const tease = nearWinMessage(game.tubes, game.movesLeft, game.colors);
  if (tease && tease !== lastNearWin) {
    lastNearWin = tease;
    window.setTimeout(() => showToast(tease, tease.endsWith("LEFT") ? "red" : "gold"), result.combo >= 2 ? 700 : 0);
    track("near_win", { message: tease, movesLeft: result.movesLeft });
  }
}

function tapTube(index: number | null): void {
  const now = performance.now();
  if (paused || ended || now < busyUntil) return;
  unlockAudio();
  music.start();
  if (!hasTapped) {
    hasTapped = true;
    track("first_tap", { ms: Math.round(now - startedAt) });
  }
  idleSeconds = 0;
  hintShown = false;
  cancelFinger();

  if (index === null) {
    if (selected !== null) {
      selected = null;
      view.setSelected(null);
    }
    return;
  }
  if (selected === null) {
    pickUpTube(index);
    return;
  }
  if (selected === index) {
    selected = null;
    view.setSelected(null);
    return;
  }

  const from = selected;
  const result = game.pour(from, index);
  if (!result) {
    // Not a legal pour. Another tube with balls switches the pick, anything else shakes.
    const target = game.tubes[index];
    if (target && target.length > 0 && !isComplete(target)) {
      view.setSelected(null);
      pickUpTube(index);
    } else {
      invalid();
      haptic(8);
      view.shakeTube(index);
      track("invalid", { reason: "illegal" });
    }
    return;
  }

  selected = null;
  if (!hasPoured) {
    hasPoured = true;
    window.setTimeout(() => caption.classList.add("gone"), 500);
    track("first_pour", { ms: Math.round(now - startedAt) });
  }
  const completedBefore = game.completed - (result.completed ? 1 : 0);
  const seconds = view.pour(from, index, result.count, (order, slot) => {
    landing(slot + order, completedBefore);
    if (order === 0) haptic(10);
  });
  view.setSelected(null);
  busyUntil = now + seconds * 1000;
  bump(movesChip);
  movesText.textContent = String(game.movesLeft);
  track("pour", { count: result.count, movesLeft: result.movesLeft, combo: result.combo });
  window.setTimeout(() => afterPour(result), seconds * 1000 - 60);
}

window.addEventListener("pointerdown", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, #end")) return;
  const rect = canvas.getBoundingClientRect();
  tapTube(view.tubeAt(event.clientX - rect.left, event.clientY - rect.top));
});

// --- Loop and wiring --------------------------------------------------------------------

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
  lastFrame = now;

  if (!paused && !ended) {
    if (hasTapped) activeSeconds += dt;
    if (performance.now() >= busyUntil) idleSeconds += dt;
    if (!hintShown && hasPoured && idleSeconds >= IDLE_HINT_SECONDS) showHint();
    if (hasTapped && activeSeconds >= MAX_ACTIVE_SECONDS) {
      track("fail", { reason: "time", tubes: game.completed });
      showEndCard("time");
    }
  }

  if (!paused) view.update(dt);
  view.render();
  requestAnimationFrame(frame);
}

function setPaused(value: boolean): void {
  paused = value;
  lastFrame = performance.now();
  if (value) {
    music.pause();
    pauseAudio();
  } else if (hasTapped) {
    music.resume();
    resumeAudio();
  }
}

function openFrom(origin: "top" | "end_card"): void {
  track("cta_click", { from: origin });
  openStore(CTA_URL);
}

element("install").addEventListener("click", () => openFrom("top"));
element("end-install").addEventListener("click", () => openFrom("end_card"));
retryButton.addEventListener("click", () => {
  retriesLeft -= 1;
  track("retry", { left: retriesLeft, extraTubes: RETRY_EXTRA_TUBES, extraMoves: RETRY_EXTRA_MOVES });
  startRound(RETRY_EXTRA_TUBES, RETRY_EXTRA_MOVES);
  showToast("+1 EMPTY TUBE, +2 MOVES", "gold");
});
againButton.addEventListener("click", () => {
  track("replay");
  startRound(0, 0);
});
soundButton.addEventListener("click", () => {
  unlockAudio();
  music.start();
  const nextMuted = !music.muted;
  music.setMuted(nextMuted);
  setAudioMuted(nextMuted);
  soundButton.classList.toggle("muted", nextMuted);
});

document.addEventListener("visibilitychange", () => setPaused(document.hidden));
onViewableChange((viewable) => setPaused(!viewable));

startRound(0, 0);
whenAdReady(() => {
  startedAt = performance.now();
  track("impression");
  setPaused(false);
  window.setTimeout(startOpeningFinger, FINGER_START_MS);
});
requestAnimationFrame(frame);
