import { onViewableChange, openStore, whenAdReady } from "../../../kit/sdk.ts";
import { haptic, note, tone, unlockAudio } from "../../../kit/audio.ts";
import { track } from "../../../kit/telemetry.ts";
import {
  CTA_URL,
  END_CARD_DELAY_MS,
  IDLE_NUDGE_SECONDS,
  MAX_ACTIVE_SECONDS,
  RETRIES,
} from "./config.ts";
import {
  CONFIG,
  StackGame,
  cameraPullOut,
  comboTier,
  isGoldenLevel,
  nearGoalMessage,
  skyProgress,
  speedForLevel,
  starsFor,
} from "./game/stack.ts";
import { createMusic } from "./music.ts";
import { SkyView } from "./render/sky.ts";
import { StackView } from "./render/view.ts";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const canvas = element<HTMLCanvasElement>("stage");
const scoreText = element("score");
const toast = element("toast");
const hint = element("hint");
const caption = element("caption");
const fill = element("fill");
const pops = element("pops");
const endCard = element("end");
const endTitle = element("end-title");
const endText = element("end-text");
const endStars = element("stars");
const teaser = element("teaser");
const retryButton = element("retry");
const againButton = element("again");

const comboBox = element("combo");
const comboLabel = element("combo-label");
const flash = element("flash");
const motionButton = element<HTMLButtonElement>("motion");

const sky = new SkyView(element<HTMLCanvasElement>("sky"));
const view = new StackView(canvas);
const music = createMusic();
let game = new StackGame();
let skyShown = 0;
let clock = 0;
/** Time scale for slow motion after a near miss. 1 is normal speed. */
let timeScale = 1;
let slowLeft = 0;
let reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
let phase = 0;
let activeSeconds = 0;
let idleSeconds = 0;
let paused = true;
let ended = false;
let lastFrame = 0;
let hasTapped = false;
let nudged = false;
let retriesLeft = RETRIES;
let startedAt = 0;

// Sound design: every sound is a few synthesized notes, so the file carries no audio data.
function perfectChime(combo: number): void {
  const scale = [0, 2, 4, 7, 9, 12, 14, 16];
  const step = scale[Math.min(combo, scale.length - 1)] ?? 0;
  tone(note(step), 0.22, "sine", 0.18);
  if (combo >= 3) tone(note(step + 12), 0.3, "sine", 0.08, 0.05);
}
const cutThud = (): void => tone(196, 0.12, "triangle", 0.14);
const missThud = (): void => tone(110, 0.35, "sawtooth", 0.12);
const winFanfare = (): void =>
  [0, 4, 7, 12].forEach((step, i) => tone(note(step), 0.25, "sine", 0.18, i * 0.09));

const goldenChime = (): void =>
  [0, 4, 7, 12, 16].forEach((step, i) => tone(note(step + 12), 0.28, "sine", 0.14, i * 0.05));
/** A rising sweep: the rush of a drop that almost landed perfectly. */
function nearMissSweep(): void {
  [0, 3, 5, 7, 10].forEach((step, i) => tone(note(step - 5), 0.14, "triangle", 0.1, i * 0.045));
}

function applyMotion(): void {
  document.body.classList.toggle("reduced", reducedMotion);
  view.setReducedMotion(reducedMotion);
  motionButton.textContent = reducedMotion ? "Motion: reduced" : "Motion: on";
  motionButton.setAttribute("aria-pressed", String(reducedMotion));
}

function updateCombo(): void {
  const tier = comboTier(game.combo);
  comboBox.classList.toggle("on", game.combo >= 2);
  comboBox.classList.toggle("hot", tier >= 2);
  comboBox.classList.toggle("fire", tier >= 3);
  comboLabel.textContent = `x${game.combo}`;
  comboLabel.classList.remove("bump");
  void comboLabel.offsetWidth;
  comboLabel.classList.add("bump");
  [...comboBox.querySelectorAll("i")].forEach((pip, i) => pip.classList.toggle("lit", i < game.combo));
  view.setGlow(tier);
  music.setIntensity(tier);
}

function flashGold(): void {
  flash.classList.remove("go");
  void flash.offsetWidth;
  flash.classList.add("go");
}

function showToast(text: string, gold = false, close = false): void {
  toast.textContent = text;
  toast.classList.toggle("gold", gold);
  toast.classList.toggle("close", close);
  toast.classList.remove("show");
  // Reading offsetWidth restarts the CSS animation.
  void toast.offsetWidth;
  toast.classList.add("show");
}

function showPop(text: string, big: boolean): void {
  const pop = document.createElement("span");
  pop.className = big ? "score-pop big" : "score-pop";
  pop.textContent = text;
  pop.style.marginLeft = `${Math.round((Math.random() - 0.5) * 80)}px`;
  pops.appendChild(pop);
  window.setTimeout(() => pop.remove(), 950);
}

function bumpScore(): void {
  scoreText.classList.add("bump");
  window.setTimeout(() => scoreText.classList.remove("bump"), 120);
}

function setProgress(): void {
  fill.style.transform = `scaleX(${game.progress})`;
}

function startRound(): void {
  game = new StackGame();
  phase = 0;
  activeSeconds = 0;
  idleSeconds = 0;
  ended = false;
  view.reset();
  view.addBlock(game.top, 0);
  view.setMoving(game.movingBlock(game.movingCenter(0)), 1, isGoldenLevel(1));
  scoreText.textContent = "0";
  hint.classList.toggle("hidden", hasTapped);
  endCard.classList.remove("show");
  timeScale = 1;
  slowLeft = 0;
  skyShown = 0;
  comboBox.classList.remove("on", "hot", "fire");
  music.setIntensity(0);
  view.setPullOut(1);
  setProgress();
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

function showEndCard(outcome: "win" | "fail" | "time"): void {
  if (ended) return;
  ended = true;
  window.setTimeout(() => {
    const stars = starsFor(game.level, game.won, game.score);
    endTitle.textContent =
      outcome === "win" ? "Perfect tower!" : outcome === "fail" ? "So close!" : "Nice stack!";
    endText.textContent = `Score ${game.score}`;
    // A teaser of what comes next pulls the player forward, whatever the result.
    teaser.textContent = outcome === "win" ? "Level 2: 20 blocks, faster swings" : "Level 2 unlocks at 14 blocks";
    renderStars(stars);
    const canRetry = outcome !== "win" && retriesLeft > 0;
    retryButton.classList.toggle("hidden", !canRetry);
    againButton.classList.toggle("hidden", canRetry);
    endCard.classList.add("show");
    track("end_card", { outcome, score: game.score, stars, level: game.level });
  }, END_CARD_DELAY_MS);
}

function handleDrop(): void {
  if (paused || game.over || ended) return;
  unlockAudio();
  music.start();
  hint.classList.add("hidden");
  if (!hasTapped) {
    hasTapped = true;
    window.setTimeout(() => caption.classList.add("gone"), 600);
    track("first_tap", { ms: Math.round(performance.now() - startedAt) });
  }
  idleSeconds = 0;

  const center = game.movingCenter(phase);
  const result = game.drop(center);
  const top = game.top;

  if (result.kind === "miss") {
    view.dropMovingAsDebris();
    view.kick();
    missThud();
    haptic(40);
    music.setIntensity(0);
    view.setGlow(0);
    comboBox.classList.remove("on", "hot", "fire");
    track("fail", { level: game.level, score: game.score });
    showEndCard("fail");
    return;
  }

  view.setMoving(null, 0);
  view.addBlock(top, game.level, result.golden);

  if (result.debris) {
    const previous = game.blocks[game.level - 1];
    if (previous) {
      view.spawnDebris(
        result.axis === "x"
          ? { x: result.debris.center, z: previous.z, w: result.debris.size, d: previous.d }
          : { x: previous.x, z: result.debris.center, w: previous.w, d: result.debris.size },
        game.level,
        result.golden,
      );
    }
    cutThud();
  }

  if (result.kind === "perfect") {
    view.pulse(top, game.level, result.golden ? 0xffd34d : 0xffffff);
    view.sparkle(top, game.level, 10 + Math.min(game.combo, 6) * 3);
    view.punch(0.03 + Math.min(game.combo, 6) * 0.01);
    perfectChime(game.combo);
    haptic(12);
    showToast(game.combo > 1 ? `PERFECT x${game.combo}` : "PERFECT", game.combo >= 3);
    if (game.combo >= 3) track("streak", { combo: game.combo });
  }

  if (result.nearMiss) {
    // Slow motion makes the player see how close it was, and wish for one more try.
    slowLeft = 0.55;
    nearMissSweep();
    showToast("SO CLOSE!", false, true);
    haptic(20);
    track("near_miss", { level: game.level, overhang: Number((result.debris?.size ?? 0).toFixed(2)) });
  }

  if (result.golden) {
    // Variable reward: the golden block pays triple and gets its own burst.
    view.sparkle(top, game.level, 34, true);
    view.punch(0.07);
    goldenChime();
    flashGold();
    haptic(30);
    showToast(`GOLDEN BLOCK x${CONFIG.goldenMultiplier}`, true);
    track("golden", { level: game.level, points: result.points });
  }

  track("drop", { kind: result.kind, level: game.level, combo: game.combo });
  showPop(`+${result.points}`, result.golden || (result.kind === "perfect" && game.combo >= 3));
  bumpScore();
  scoreText.textContent = String(game.score);
  updateCombo();
  view.setPullOut(cameraPullOut(game.level));
  setProgress();

  if (game.won) {
    view.confetti(top, game.level);
    view.fireworks(top, game.level);
    music.setIntensity(3);
    winFanfare();
    haptic(60);
    track("win", { score: game.score });
    showEndCard("win");
    return;
  }

  // Pattern interrupt at the halfway mark: a burst, a punch and a chord break the rhythm.
  if (game.level === Math.floor(CONFIG.levelsToWin / 2)) {
    showToast("HALFWAY!", true);
    view.sparkle(top, game.level, 30);
    view.fireworks(top, game.level);
    view.punch(0.09);
    [0, 4, 7].forEach((step, i) => tone(note(step), 0.25, "sine", 0.14, i * 0.06));
    track("milestone", { name: "halfway", level: game.level });
  }

  const tease = nearGoalMessage(game.level, CONFIG.levelsToWin);
  if (tease && result.kind !== "perfect") showToast(tease, true);

  phase = 0;
  // The next block already shows gold while it swings, so the player aims for it.
  view.setMoving(game.movingBlock(game.movingCenter(0)), game.level + 1, isGoldenLevel(game.level + 1));
}

function frame(now: number): void {
  const realDt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
  lastFrame = now;

  // Slow motion holds at 30% speed, then eases back to normal.
  if (slowLeft > 0) {
    slowLeft -= realDt;
    timeScale = 0.3;
  } else {
    timeScale += (1 - timeScale) * Math.min(1, realDt * 8);
  }
  const dt = realDt * timeScale;
  clock += realDt;

  if (!paused && !game.over && !ended) {
    phase += speedForLevel(game.level + 1) * dt;
    activeSeconds += dt;
    view.moveTo(game.movingBlock(game.movingCenter(phase)), game.level + 1);
    if (!hasTapped) {
      idleSeconds += dt;
      if (!nudged && idleSeconds >= IDLE_NUDGE_SECONDS) {
        nudged = true;
        hint.classList.add("nudge");
        track("idle_nudge");
      }
    }
    if (activeSeconds >= MAX_ACTIVE_SECONDS) showEndCard("time");
  }

  if (!paused) view.update(dt);
  skyShown += (skyProgress(game.level) - skyShown) * Math.min(1, realDt * 1.5);
  sky.draw(skyShown, view.climb, clock);
  view.render();
  requestAnimationFrame(frame);
}

function setPaused(value: boolean): void {
  paused = value;
  music.setPaused(value);
  lastFrame = performance.now();
}

function openFrom(origin: "top" | "end_card"): void {
  track("cta_click", { from: origin });
  openStore(CTA_URL);
}

motionButton.addEventListener("click", () => {
  reducedMotion = !reducedMotion;
  applyMotion();
  track("reduced_motion", { on: reducedMotion });
});
applyMotion();
element("install").addEventListener("click", () => openFrom("top"));
element("end-install").addEventListener("click", () => openFrom("end_card"));
retryButton.addEventListener("click", () => {
  retriesLeft -= 1;
  track("retry", { left: retriesLeft });
  startRound();
});
againButton.addEventListener("click", () => {
  track("replay");
  startRound();
});

// Pointer events cover mouse, touch and pen. Buttons and the end card are not
// part of the game surface, so a tap on them never drops a block.
window.addEventListener("pointerdown", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, #end")) return;
  handleDrop();
});
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") handleDrop();
});

document.addEventListener("visibilitychange", () => setPaused(document.hidden));
onViewableChange((viewable) => setPaused(!viewable));

startRound();
whenAdReady(() => {
  startedAt = performance.now();
  track("impression");
  setPaused(false);
});
requestAnimationFrame(frame);
