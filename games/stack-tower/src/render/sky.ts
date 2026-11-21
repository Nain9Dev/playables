/**
 * Background drawn on its own 2D canvas under the WebGL canvas: a gradient that
 * walks from day to dusk to space as the tower grows, parallax clouds that fade
 * out and stars that fade in. It costs no extra assets.
 */
type Rgb = [number, number, number];

interface Palette {
  top: Rgb;
  bottom: Rgb;
}

const DAY: Palette = { top: [96, 190, 255], bottom: [214, 240, 255] };
const DUSK: Palette = { top: [86, 80, 200], bottom: [255, 156, 190] };
const SPACE: Palette = { top: [4, 5, 28], bottom: [30, 22, 86] };

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const css = (c: Rgb): string => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

/** Gradient colors for a sky progress from 0 (day) to 1 (space). Pure, so it can be tested. */
export function skyPalette(progress: number): Palette {
  const p = Math.min(1, Math.max(0, progress));
  if (p < 0.5) {
    const t = p / 0.5;
    return { top: mix(DAY.top, DUSK.top, t), bottom: mix(DAY.bottom, DUSK.bottom, t) };
  }
  const t = (p - 0.5) / 0.5;
  return { top: mix(DUSK.top, SPACE.top, t), bottom: mix(DUSK.bottom, SPACE.bottom, t) };
}

/** Star visibility: none until about 45% of the climb, full at 85%. */
export function starAlpha(progress: number): number {
  return Math.min(1, Math.max(0, (progress - 0.45) / 0.4));
}

interface Cloud {
  x: number;
  y: number;
  scale: number;
  depth: number;
}
interface Star {
  x: number;
  y: number;
  size: number;
  phase: number;
}

/** Small deterministic generator so the sky looks the same on every run. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export class SkyView {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly clouds: Cloud[] = [];
  private readonly stars: Star[] = [];
  private width = 1;
  private height = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d");
    const random = makeRandom(7);
    for (let i = 0; i < 9; i += 1) {
      const depth = 0.25 + random() * 0.75;
      this.clouds.push({ x: random(), y: random(), scale: 0.6 + depth * 0.9, depth });
    }
    for (let i = 0; i < 70; i += 1) {
      this.stars.push({ x: random(), y: random(), size: 0.8 + random() * 1.8, phase: random() * 6.28 });
    }
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  private resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /**
   * @param progress sky progress 0..1
   * @param climb camera height in world units, drives the parallax
   * @param time seconds, drives twinkle and slow cloud drift
   */
  draw(progress: number, climb: number, time: number): void {
    const ctx = this.context;
    if (!ctx) return;
    const { width, height } = this;
    const palette = skyPalette(progress);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, css(palette.top));
    gradient.addColorStop(1, css(palette.bottom));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const stars = starAlpha(progress);
    if (stars > 0) {
      for (const star of this.stars) {
        const twinkle = 0.55 + 0.45 * Math.sin(time * 2 + star.phase);
        ctx.globalAlpha = stars * twinkle;
        ctx.fillStyle = "#ffffff";
        // Stars drift down slowly as the camera climbs, which reads as depth.
        const y = (((star.y + climb * 0.004 * star.size) % 1) + 1) % 1;
        ctx.fillRect(star.x * width, y * height, star.size, star.size);
      }
    }

    const cloudAlpha = 1 - Math.min(1, Math.max(0, (progress - 0.35) / 0.35));
    if (cloudAlpha > 0) {
      const tint = mix([255, 255, 255], [255, 214, 232], Math.min(1, progress * 1.6));
      ctx.fillStyle = css(tint);
      for (const cloud of this.clouds) {
        ctx.globalAlpha = cloudAlpha * (0.45 + cloud.depth * 0.4);
        // Near clouds (high depth) move faster than far ones: parallax.
        const scroll = climb * 0.012 * cloud.depth;
        const y = (((cloud.y + scroll) % 1) + 1) % 1;
        const x = (((cloud.x + time * 0.004 * cloud.depth) % 1.3) - 0.15) * width;
        this.puff(ctx, x, y * height, 46 * cloud.scale);
      }
    }
    ctx.globalAlpha = 1;
  }

  private puff(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
    ctx.arc(x + r * 0.55, y + r * 0.1, r * 0.45, 0, Math.PI * 2);
    ctx.arc(x - r * 0.55, y + r * 0.12, r * 0.4, 0, Math.PI * 2);
    ctx.arc(x + r * 0.1, y - r * 0.3, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}
