import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { CAPACITY, type Tubes } from "../game/rules.ts";

/** Ball radius, distance between two balls in a tube and tube size, in world units. */
const R = 0.45;
const SLOT = 0.9;
const TUBE_R = 0.58;
const BASE_PAD = 0.52;
const TUBE_H = BASE_PAD + (CAPACITY - 1) * SLOT + R + 0.3;
/** Space between two rows, enough for a lifted run to hover above the tubes below. */
const ROW_PITCH = TUBE_H + 2.9;
const LIFT_GAP = R * 0.6;

const FLY_SECONDS = 0.24;
const FALL_SECONDS = 0.16;
const STAGGER_SECONDS = 0.075;

export const PALETTE = [0xff4d6d, 0xffc928, 0x35d07f, 0x3fa9ff, 0xb46bff, 0xff8a3d] as const;
const GOLD = new Color(0xffd84a);
const WHITE = new Color(0xffffff);

interface Flight {
  delay: number;
  phase: 0 | 1;
  t: number;
  from: Vector3;
  hover: Vector3;
  to: Vector3;
  onLand: () => void;
}

interface Ball {
  mesh: Mesh<SphereGeometry, MeshPhongMaterial>;
  color: number;
  bob: number;
  flight: Flight | null;
  lift: number;
  liftTarget: number;
  /** Seconds since landing, or -1. */
  squash: number;
  /** Seconds since the jump started (negative while waiting), or -1 when not jumping. */
  jump: number;
}

interface TubeView {
  x: number;
  base: number;
  rim: Mesh<TorusGeometry, MeshBasicMaterial>;
  parts: Mesh[];
  balls: Ball[];
  selected: boolean;
  done: boolean;
  flash: number;
  shake: number;
}

interface Effect {
  mesh: Mesh;
  velocity: Vector3;
  spin: number;
  life: number;
  maxLife: number;
  /** A ring grows instead of flying. */
  ring: boolean;
}

export interface Slot {
  x: number;
  base: number;
}

/** Tube positions: two rows, the top row holding the extra tube when the count is odd. */
export function layoutFor(count: number): Slot[] {
  const top = Math.ceil(count / 2);
  const bottom = count - top;
  const spacing = top >= 4 ? 2.0 : 2.15;
  const bottomBase = -(ROW_PITCH + TUBE_H) / 2;
  const topBase = bottomBase + ROW_PITCH;
  const slots: Slot[] = [];
  for (let i = 0; i < top; i += 1) slots.push({ x: (i - (top - 1) / 2) * spacing, base: topBase });
  for (let i = 0; i < bottom; i += 1) slots.push({ x: (i - (bottom - 1) / 2) * spacing, base: bottomBase });
  return slots;
}

function slotY(base: number, index: number): number {
  return base + BASE_PAD + index * SLOT;
}

/** Owns everything Three.js: tubes, balls, flights, squash, rings, sparkles and the camera. */
export class SortView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 100);
  private readonly ballGeometry = new SphereGeometry(R, 28, 18);
  private readonly sparkGeometry = new OctahedronGeometry(1, 0);
  private readonly ringGeometry = new TorusGeometry(1, 0.06, 8, 48);
  private readonly cylinderGeometry = new CylinderGeometry(TUBE_R, TUBE_R, TUBE_H - TUBE_R, 32, 1, true);
  private readonly bowlGeometry = new SphereGeometry(TUBE_R, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  private readonly rimGeometry = new TorusGeometry(TUBE_R, 0.05, 8, 40);
  private readonly ballMaterials = PALETTE.map(
    (color) => new MeshPhongMaterial({ color, shininess: 95, specular: 0xb0b0b0 }),
  );
  private readonly glassMaterial = new MeshPhongMaterial({
    color: 0xd4ecff,
    transparent: true,
    opacity: 0.17,
    shininess: 120,
    specular: 0xffffff,
    side: DoubleSide,
    depthWrite: false,
  });
  private readonly shelfMaterial = new MeshPhongMaterial({ color: 0x1b3a66, shininess: 30 });
  private readonly bokeh: { mesh: Mesh; speed: number }[] = [];
  private tubes: TubeView[] = [];
  private shelves: Mesh[] = [];
  private effects: Effect[] = [];
  private hint: { from: number; to: number } | null = null;
  private time = 0;
  private shake = 0;
  private punchAmount = 0;
  private lookY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearAlpha(0);

    this.scene.add(new AmbientLight(0xffffff, 1.15));
    const sun = new DirectionalLight(0xffffff, 1.7);
    sun.position.set(-4, 7, 9);
    this.scene.add(sun);
    const fill = new PointLight(0x7fd0ff, 90, 40);
    fill.position.set(5, -3, 8);
    this.scene.add(fill);

    // Soft circles drifting upward behind the tubes: motion before the first tap.
    const circle = new CircleGeometry(1, 24);
    for (let i = 0; i < 14; i += 1) {
      const material = new MeshBasicMaterial({
        color: i % 3 === 0 ? 0x7fe7d4 : 0xffffff,
        transparent: true,
        opacity: 0.05 + (i % 4) * 0.012,
        depthWrite: false,
      });
      const mesh = new Mesh(circle, material);
      const size = 0.35 + ((i * 37) % 10) * 0.12;
      mesh.scale.setScalar(size);
      mesh.position.set(((i * 53) % 16) - 8, ((i * 29) % 20) - 10, -9);
      this.scene.add(mesh);
      this.bokeh.push({ mesh, speed: 0.12 + ((i * 17) % 7) * 0.05 });
    }

    this.resize();
    // A ResizeObserver also catches the canvas changing size inside an iframe or a phone frame.
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  get tubeCount(): number {
    return this.tubes.length;
  }

  private clearTubes(): void {
    for (const tube of this.tubes) {
      for (const ball of tube.balls) this.scene.remove(ball.mesh);
      for (const part of tube.parts) this.scene.remove(part);
      tube.rim.material.dispose();
    }
    for (const shelf of this.shelves) this.scene.remove(shelf);
    for (const effect of this.effects) this.removeEffect(effect);
    this.tubes = [];
    this.shelves = [];
    this.effects = [];
  }

  /** Show a fresh board. */
  setLevel(tubes: Tubes): void {
    this.clearTubes();
    this.hint = null;
    const layout = layoutFor(tubes.length);

    const rows = new Map<number, number[]>();
    layout.forEach((slot) => {
      const xs = rows.get(slot.base) ?? [];
      xs.push(slot.x);
      rows.set(slot.base, xs);
    });
    rows.forEach((xs, base) => {
      const width = Math.max(...xs) - Math.min(...xs) + 2.6;
      const shelf = new Mesh(new BoxGeometry(width, 0.26, 1.5), this.shelfMaterial);
      shelf.position.set((Math.max(...xs) + Math.min(...xs)) / 2, base - 0.1, -0.1);
      this.scene.add(shelf);
      this.shelves.push(shelf);
    });

    tubes.forEach((contents, index) => {
      const slot = layout[index] as Slot;
      const bowl = new Mesh(this.bowlGeometry, this.glassMaterial);
      bowl.position.set(slot.x, slot.base + TUBE_R, 0);
      const wall = new Mesh(this.cylinderGeometry, this.glassMaterial);
      wall.position.set(slot.x, slot.base + TUBE_R + (TUBE_H - TUBE_R) / 2, 0);
      const rim = new Mesh(
        this.rimGeometry,
        new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.set(slot.x, slot.base + TUBE_H, 0);
      this.scene.add(bowl, wall, rim);

      const balls = contents.map((color, level) => {
        const mesh = new Mesh(this.ballGeometry, this.ballMaterials[color % this.ballMaterials.length] as MeshPhongMaterial);
        mesh.position.set(slot.x, slotY(slot.base, level), 0);
        this.scene.add(mesh);
        return {
          mesh,
          color,
          bob: (index * 1.7 + level * 0.9) % (Math.PI * 2),
          flight: null,
          lift: 0,
          liftTarget: 0,
          squash: -1,
          jump: -1,
        } satisfies Ball;
      });
      this.tubes.push({
        x: slot.x,
        base: slot.base,
        rim,
        parts: [bowl, wall, rim],
        balls,
        selected: false,
        done: false,
        flash: 0,
        shake: 0,
      });
    });

    this.shake = 0;
    this.punchAmount = 0;
    this.camera.zoom = 1;
    this.fit();
  }

  /** Lift the top run of a tube, or drop whatever is lifted when `index` is null. */
  setSelected(index: number | null, runCount = 1): void {
    this.tubes.forEach((tube, i) => {
      tube.selected = i === index;
      for (const ball of tube.balls) ball.liftTarget = 0;
      if (i !== index) return;
      const count = Math.min(runCount, tube.balls.length);
      const lowest = tube.balls.length - count;
      const rimY = tube.base + TUBE_H;
      const lift = Math.max(0.6, rimY + LIFT_GAP - slotY(tube.base, lowest));
      for (let b = lowest; b < tube.balls.length; b += 1) (tube.balls[b] as Ball).liftTarget = lift;
    });
  }

  setHint(from: number | null, to: number | null): void {
    this.hint = from === null || to === null ? null : { from, to };
  }

  /**
   * Fly the top `count` balls of `from` to `to`. `onLand` runs as each ball lands,
   * with its order in the run. Returns how long the whole pour takes, in seconds.
   */
  pour(from: number, to: number, count: number, onLand: (order: number, slot: number) => void): number {
    const source = this.tubes[from];
    const target = this.tubes[to];
    if (!source || !target) return 0;
    const moving = source.balls.splice(source.balls.length - count, count).reverse();
    const hoverY = target.base + TUBE_H + R * 1.5;
    moving.forEach((ball, order) => {
      const slot = target.balls.length;
      target.balls.push(ball);
      ball.liftTarget = 0;
      ball.lift = 0;
      ball.squash = -1;
      ball.flight = {
        delay: order * STAGGER_SECONDS,
        phase: 0,
        t: 0,
        from: ball.mesh.position.clone(),
        hover: new Vector3(target.x, hoverY, 0),
        to: new Vector3(target.x, slotY(target.base, slot), 0),
        onLand: () => onLand(order, slot),
      };
    });
    source.selected = false;
    return (count - 1) * STAGGER_SECONDS + FLY_SECONDS + FALL_SECONDS + 0.12;
  }

  /** A completed tube: a ring, sparkles, a jump of the balls and a golden rim. */
  celebrate(index: number, big = false): void {
    const tube = this.tubes[index];
    if (!tube) return;
    tube.done = true;
    tube.flash = 1;
    const color = new Color(PALETTE[(tube.balls[0]?.color ?? 0) % PALETTE.length] ?? 0xffffff);
    const centerY = tube.base + TUBE_H / 2;

    const ring = new Mesh(
      this.ringGeometry,
      new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.95, depthWrite: false, blending: AdditiveBlending }),
    );
    ring.position.set(tube.x, centerY, 0.6);
    ring.scale.setScalar(0.7);
    this.scene.add(ring);
    this.effects.push({ mesh: ring, velocity: new Vector3(), spin: 0, life: 0.65, maxLife: 0.65, ring: true });

    const amount = big ? 34 : 22;
    for (let i = 0; i < amount; i += 1) {
      const material = new MeshBasicMaterial({ color: i % 3 === 0 ? WHITE : i % 3 === 1 ? color : GOLD });
      const mesh = new Mesh(this.sparkGeometry, material);
      mesh.scale.setScalar(0.08 + Math.random() * 0.1);
      mesh.position.set(tube.x, centerY + (Math.random() - 0.5) * 1.5, 0.5);
      this.scene.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.2 + Math.random() * 3.6;
      const life = 0.7 + Math.random() * 0.5;
      this.effects.push({
        mesh,
        velocity: new Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed + 1.5, Math.random() * 2),
        spin: 4 + Math.random() * 6,
        life,
        maxLife: life,
        ring: false,
      });
    }

    tube.balls.forEach((ball, level) => {
      ball.jump = -0.07 * level;
    });
    this.punch(big ? 0.07 : 0.04);
  }

  /** The win: every finished tube pops at once, then again a moment later. */
  celebrateAll(): void {
    this.tubes.forEach((tube, index) => {
      if (tube.balls.length > 0) this.celebrate(index, true);
    });
    this.punch(0.1);
  }

  shakeTube(index: number): void {
    const tube = this.tubes[index];
    if (tube) tube.shake = 1;
  }

  punch(strength = 0.05): void {
    this.punchAmount = Math.max(this.punchAmount, strength);
  }

  kick(): void {
    this.shake = 0.45;
  }

  /** Pixel position inside the canvas of a point of a tube. `fraction` 0 is the base, 1 the rim. */
  screenOf(index: number, fraction = 0.5, extra = 0): { x: number; y: number } {
    const tube = this.tubes[index];
    if (!tube) return { x: 0, y: 0 };
    return this.project(tube.x, tube.base + TUBE_H * fraction + extra);
  }

  private project(x: number, y: number): { x: number; y: number } {
    const point = new Vector3(x, y, 0).project(this.camera);
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height };
  }

  /** The tube under a pointer position (pixels inside the canvas), including the lift space above it. */
  tubeAt(px: number, py: number): number | null {
    this.camera.updateMatrixWorld();
    let best: number | null = null;
    let bestDistance = Infinity;
    this.tubes.forEach((tube, index) => {
      const left = this.project(tube.x - TUBE_R * 1.6, 0).x;
      const right = this.project(tube.x + TUBE_R * 1.6, 0).x;
      const top = this.project(tube.x, tube.base + TUBE_H + 2.2).y;
      const bottom = this.project(tube.x, tube.base - 0.3).y;
      if (px < left || px > right || py < top || py > bottom) return;
      const distance = Math.abs(px - (left + right) / 2);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  /** Frame the board: width limits a phone, height limits a wide window. */
  private fit(): void {
    if (this.tubes.length === 0) return;
    const aspect = this.camera.aspect;
    const halfWidth = Math.max(...this.tubes.map((tube) => Math.abs(tube.x))) + TUBE_R + 0.9;
    const height = ROW_PITCH + TUBE_H + 4.6;
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const distance = Math.max(height / 2 / tan, halfWidth / (tan * aspect));
    this.camera.position.set(0, this.lookY, distance);
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.fit();
  }

  private removeEffect(effect: Effect): void {
    this.scene.remove(effect.mesh);
    (effect.mesh.material as MeshBasicMaterial).dispose();
  }

  update(dt: number): void {
    this.time += dt;

    // Camera: slight shake and a zoom punch that settles.
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.6 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.6 : 0;
    this.shake = Math.max(0, this.shake - dt);
    this.camera.position.x = sx;
    this.camera.position.y = this.lookY + sy;
    this.camera.lookAt(0, this.lookY, 0);
    if (this.punchAmount > 0.0005) {
      this.punchAmount *= Math.max(0, 1 - dt * 9);
      this.camera.zoom = 1 + this.punchAmount;
      this.camera.updateProjectionMatrix();
    } else if (this.camera.zoom !== 1) {
      this.punchAmount = 0;
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
    }

    for (const item of this.bokeh) {
      item.mesh.position.y += item.speed * dt;
      if (item.mesh.position.y > 11) item.mesh.position.y = -11;
    }

    const hintPhase = Math.floor(this.time / 0.7) % 2;
    this.tubes.forEach((tube, index) => {
      tube.shake = Math.max(0, tube.shake - dt * 2.6);
      tube.flash = Math.max(0, tube.flash - dt * 2.2);
      const offsetX = Math.sin(tube.shake * 38) * 0.11 * tube.shake;
      for (const part of tube.parts) part.position.x = tube.x + offsetX;

      // Rim light: gold when done, white when picked up, a pulse for the hint.
      let glow = 0;
      if (tube.selected) glow = 0.75 + Math.sin(this.time * 10) * 0.15;
      if (this.hint && ((hintPhase === 0 && this.hint.from === index) || (hintPhase === 1 && this.hint.to === index))) {
        glow = Math.max(glow, 0.55 + Math.sin(this.time * 14) * 0.25);
      }
      const material = tube.rim.material;
      material.color.copy(tube.done ? GOLD : WHITE);
      material.opacity = tube.done ? 1 : 0.62 + glow * 0.38;
      tube.rim.scale.setScalar(1 + glow * 0.1 + tube.flash * 0.25);

      tube.balls.forEach((ball, level) => this.updateBall(ball, tube, level, dt, offsetX));
    });

    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i] as Effect;
      effect.life -= dt;
      const age = 1 - Math.max(0, effect.life) / effect.maxLife;
      const material = effect.mesh.material as MeshBasicMaterial;
      if (effect.ring) {
        effect.mesh.scale.setScalar(0.7 + age * 3.4);
        material.opacity = 0.95 * (1 - age);
      } else {
        effect.velocity.y -= 7 * dt;
        effect.mesh.position.addScaledVector(effect.velocity, dt);
        effect.mesh.rotation.x += dt * effect.spin;
        effect.mesh.rotation.y += dt * effect.spin * 0.8;
        effect.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 1.6));
      }
      if (effect.life <= 0) {
        this.removeEffect(effect);
        this.effects.splice(i, 1);
      }
    }
  }

  private updateBall(ball: Ball, tube: TubeView, level: number, dt: number, offsetX: number): void {
    const mesh = ball.mesh;
    const flight = ball.flight;
    if (flight) {
      if (flight.delay > 0) {
        flight.delay -= dt;
        return;
      }
      flight.t += dt;
      if (flight.phase === 0) {
        const t = Math.min(1, flight.t / FLY_SECONDS);
        const eased = t * t * (3 - 2 * t);
        mesh.position.lerpVectors(flight.from, flight.hover, eased);
        mesh.position.y += Math.sin(Math.PI * t) * 0.7;
        mesh.scale.set(1, 1, 1);
        if (t >= 1) {
          flight.phase = 1;
          flight.t = 0;
        }
      } else {
        const t = Math.min(1, flight.t / FALL_SECONDS);
        mesh.position.lerpVectors(flight.hover, flight.to, t * t);
        // A little stretch while falling.
        mesh.scale.set(1 - t * 0.08, 1 + t * 0.14, 1 - t * 0.08);
        if (t >= 1) {
          mesh.position.copy(flight.to);
          ball.flight = null;
          ball.squash = 0;
          flight.onLand();
        }
      }
      return;
    }

    ball.lift += (ball.liftTarget - ball.lift) * Math.min(1, dt * 16);
    const bob = Math.sin(this.time * 2.3 + ball.bob) * 0.035;
    let jump = 0;
    if (ball.jump > -1) {
      ball.jump += dt;
      if (ball.jump >= 0) {
        const t = ball.jump / 0.38;
        jump = t >= 1 ? 0 : Math.sin(Math.PI * t) * 0.55;
        if (t >= 1) ball.jump = -1;
      }
    }
    let scaleY = 1;
    let scaleXZ = 1;
    if (ball.squash >= 0) {
      ball.squash += dt;
      // A damped spring: the ball flattens on landing, rebounds and settles.
      const spring = Math.exp(-ball.squash * 9) * Math.cos(ball.squash * 30);
      scaleY = 1 - 0.3 * spring;
      scaleXZ = 1 + 0.15 * spring;
      if (ball.squash > 0.4) ball.squash = -1;
    }
    mesh.scale.set(scaleXZ, scaleY, scaleXZ);
    mesh.position.set(
      tube.x + offsetX,
      slotY(tube.base, level) + ball.lift + bob + jump - (1 - scaleY) * R,
      0,
    );
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
