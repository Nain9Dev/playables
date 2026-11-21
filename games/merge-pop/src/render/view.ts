import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Ray,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { SIZE, type MoveResult, type Tile } from "../game/rules.ts";

const CELL = 1.25;
const TILE_HEIGHT = 0.5;
const TILE_TOP = TILE_HEIGHT / 2 + 0.15;
const SLIDE_SECONDS = 0.11;
const POP_SECONDS = 0.26;
const DIE_SECONDS = 0.16;
const DUST_COUNT = 56;

interface TileView {
  id: number;
  value: number;
  box: Mesh<BoxGeometry, MeshLambertMaterial>;
  face: Mesh<PlaneGeometry, MeshBasicMaterial>;
  halo: Mesh<PlaneGeometry, MeshBasicMaterial>;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** Seconds since the slide started. */
  slide: number;
  /** A tile absorbed by a merge is removed when its slide ends. */
  removeAtEnd: boolean;
  /** Value to show when the slide ends (the survivor of a merge). */
  pendingValue: number | null;
  /** Seconds since the pop started, or -1 when not popping. */
  pop: number;
  popKind: "spawn" | "merge";
  /** A spawned tile waits for the slide of the others, then grows in. */
  spawnDelay: number;
  /** Seconds left in the smash shrink, or -1 when alive. */
  dying: number;
}

interface Spark {
  mesh: Mesh<BoxGeometry, MeshBasicMaterial>;
  velocity: Vector3;
  life: number;
}

interface Ring {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  age: number;
  life: number;
  reach: number;
}

/** Tile color by value. Warm to hot as the value climbs, gold at the goal. */
const PALETTE: Record<number, string> = {
  2: "#4fb7ff",
  4: "#3fd6b2",
  8: "#8fe05a",
  16: "#ffd23f",
  32: "#ff9a3d",
  64: "#ff4f6d",
  128: "#ffc21a",
};

function baseColor(value: number): string {
  return PALETTE[value] ?? "#c06bff";
}

export function cellPosition(row: number, col: number): { x: number; z: number } {
  return { x: (col - (SIZE - 1) / 2) * CELL, z: (row - (SIZE - 1) / 2) * CELL };
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function radialTexture(inner: string, outer: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Owns everything Three.js for the merge puzzle: board, tiles, animations and effects. */
export class MergeView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  private readonly tileGeometry = new RoundedBoxGeometry(CELL - 0.14, TILE_HEIGHT, CELL - 0.14, 3, 0.2);
  private readonly faceGeometry = new PlaneGeometry(CELL - 0.14, CELL - 0.14);
  private readonly haloGeometry = new PlaneGeometry(CELL * 1.9, CELL * 1.9);
  private readonly sparkGeometry = new BoxGeometry(1, 1, 1);
  private readonly ringGeometry = new RingGeometry(0.42, 0.5, 40);
  private readonly haloTexture = radialTexture("rgba(255,235,140,0.95)", "rgba(255,200,40,0)");
  private readonly faces = new Map<number, CanvasTexture>();
  private views: TileView[] = [];
  private readonly sparks: Spark[] = [];
  private readonly rings: Ring[] = [];
  private readonly dust: Points<BufferGeometry, PointsMaterial>;
  private readonly dustSeed: Float32Array;
  private time = 0;
  private shake = 0;
  private punchAmount = 0;
  private targeting = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearAlpha(0);

    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 1.8);
    sun.position.set(-3, 9, 5);
    this.scene.add(sun);

    this.buildBoard();

    // Ambient dust: soft dots drifting across the scene so nothing is ever still.
    const positions = new Float32Array(DUST_COUNT * 3);
    this.dustSeed = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 11;
      positions[i * 3 + 1] = 0.4 + Math.random() * 2.4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 14;
      this.dustSeed[i] = Math.random() * 10;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.dust = new Points(
      geometry,
      new PointsMaterial({
        size: 9,
        sizeAttenuation: false,
        map: radialTexture("rgba(255,255,255,0.9)", "rgba(255,255,255,0)"),
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    this.resize();
    // A ResizeObserver also catches the canvas changing size inside an iframe or a phone frame.
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  private buildBoard(): void {
    const plate = new Mesh(
      new BoxGeometry(SIZE * CELL + 0.4, 0.3, SIZE * CELL + 0.4),
      new MeshLambertMaterial({ color: 0x1d2350 }),
    );
    plate.position.y = -0.05;
    this.scene.add(plate);

    const slotGeometry = new BoxGeometry(CELL - 0.1, 0.06, CELL - 0.1);
    const slotMaterial = new MeshLambertMaterial({ color: 0x2c3470 });
    for (let row = 0; row < SIZE; row += 1) {
      for (let col = 0; col < SIZE; col += 1) {
        const slot = new Mesh(slotGeometry, slotMaterial);
        const at = cellPosition(row, col);
        slot.position.set(at.x, 0.12, at.z);
        this.scene.add(slot);
      }
    }
  }

  /**
   * Tile top, drawn on a canvas: rounded body in the value color, a lit bevel edge, a gloss
   * band on the upper half and the number with a dark outline. Generated, so no asset ships.
   */
  private faceFor(value: number): CanvasTexture {
    const cached = this.faces.get(value);
    if (cached) return cached;
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (context) {
      const color = new Color(baseColor(value));
      const light = color.clone().lerp(new Color(0xffffff), 0.45).getStyle();
      const dark = color.clone().multiplyScalar(0.62).getStyle();

      roundedRect(context, 6, 6, size - 12, size - 12, 46);
      context.fillStyle = dark;
      context.fill();

      roundedRect(context, 12, 10, size - 24, size - 30, 42);
      const body = context.createLinearGradient(0, 10, 0, size - 20);
      body.addColorStop(0, light);
      body.addColorStop(0.35, color.getStyle());
      body.addColorStop(1, color.clone().multiplyScalar(0.82).getStyle());
      context.fillStyle = body;
      context.fill();

      context.save();
      roundedRect(context, 12, 10, size - 24, size - 30, 42);
      context.clip();
      const gloss = context.createLinearGradient(0, 10, 0, 130);
      gloss.addColorStop(0, "rgba(255,255,255,0.55)");
      gloss.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gloss;
      context.beginPath();
      context.ellipse(size / 2, 20, size * 0.62, 112, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();

      roundedRect(context, 12, 10, size - 24, size - 30, 42);
      context.lineWidth = 4;
      context.strokeStyle = "rgba(255,255,255,0.45)";
      context.stroke();

      const text = String(value);
      context.font = `900 ${text.length >= 3 ? 104 : text.length === 2 ? 128 : 150}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineJoin = "round";
      context.lineWidth = 16;
      context.strokeStyle = "rgba(14, 18, 60, 0.75)";
      context.strokeText(text, size / 2, size / 2 + 8);
      context.fillStyle = "#ffffff";
      context.fillText(text, size / 2, size / 2 + 8);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.faces.set(value, texture);
    return texture;
  }

  private bodyColor(value: number): Color {
    return new Color(baseColor(value)).multiplyScalar(0.55);
  }

  private createView(tile: Tile, scale: number): TileView {
    const box = new Mesh(this.tileGeometry, new MeshLambertMaterial({ color: this.bodyColor(tile.value) }));
    const face = new Mesh(
      this.faceGeometry,
      new MeshBasicMaterial({ map: this.faceFor(tile.value), transparent: true }),
    );
    face.rotation.x = -Math.PI / 2;
    face.position.y = TILE_HEIGHT / 2 + 0.01;
    box.add(face);

    // Glow under a tile, shown only for the near-win pulse on the two 64s.
    const halo = new Mesh(
      this.haloGeometry,
      new MeshBasicMaterial({
        map: this.haloTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    this.scene.add(halo);

    const at = cellPosition(tile.row, tile.col);
    box.position.set(at.x, TILE_TOP, at.z);
    box.scale.setScalar(scale);
    this.scene.add(box);
    return {
      id: tile.id,
      value: tile.value,
      box,
      face,
      halo,
      fromX: at.x,
      fromZ: at.z,
      toX: at.x,
      toZ: at.z,
      slide: SLIDE_SECONDS,
      removeAtEnd: false,
      pendingValue: null,
      pop: -1,
      popKind: "merge",
      spawnDelay: 0,
      dying: -1,
    };
  }

  private setValue(view: TileView, value: number): void {
    view.value = value;
    view.box.material.color.copy(this.bodyColor(value));
    view.face.material.map = this.faceFor(value);
    view.face.material.needsUpdate = true;
  }

  private removeView(view: TileView): void {
    this.scene.remove(view.box);
    this.scene.remove(view.halo);
    view.box.material.dispose();
    view.face.material.dispose();
    view.halo.material.dispose();
  }

  /** Show a fresh board. */
  setBoard(tiles: readonly Tile[]): void {
    for (const view of this.views) this.removeView(view);
    this.views = tiles.map((tile) => this.createView(tile, 1));
    for (const spark of this.sparks) {
      this.scene.remove(spark.mesh);
      spark.mesh.material.dispose();
    }
    this.sparks.length = 0;
    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      ring.mesh.material.dispose();
    }
    this.rings.length = 0;
    this.shake = 0;
    this.punchAmount = 0;
    this.targeting = false;
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
  }

  /** Animate one move: slide every tile, merge, then pop in the new tile. */
  applyMove(result: MoveResult, tilesAfter: readonly Tile[]): void {
    const absorbedIds = new Set(result.merges.map((merge) => merge.absorbed));
    const survivors = new Map(result.merges.map((merge) => [merge.survivor, merge]));

    for (const view of this.views) {
      if (absorbedIds.has(view.id)) {
        const merge = result.merges.find((m) => m.absorbed === view.id);
        if (merge) {
          const at = cellPosition(merge.row, merge.col);
          view.fromX = view.box.position.x;
          view.fromZ = view.box.position.z;
          view.toX = at.x;
          view.toZ = at.z;
          view.slide = 0;
          view.removeAtEnd = true;
        }
        continue;
      }
      const tile = tilesAfter.find((t) => t.id === view.id);
      if (!tile) continue;
      const at = cellPosition(tile.row, tile.col);
      view.fromX = view.box.position.x;
      view.fromZ = view.box.position.z;
      view.toX = at.x;
      view.toZ = at.z;
      view.slide = 0;
      const merge = survivors.get(view.id);
      view.pendingValue = merge ? merge.value : null;
    }

    if (result.spawned) {
      const spawned = this.createView(result.spawned, 0.001);
      spawned.spawnDelay = SLIDE_SECONDS;
      spawned.pop = -1;
      this.views.push(spawned);
    }
  }

  /** Shrink and remove a tile (the smash booster) with a burst. */
  smash(id: number, row: number, col: number, value: number): void {
    const view = this.views.find((candidate) => candidate.id === id);
    if (view) view.dying = DIE_SECONDS;
    this.burst(row, col, value, 22);
    this.ring(row, col, value);
    this.punch(0.06);
    this.kick();
  }

  /** Targeting mode wobbles every tile to say "tap one". */
  setTargeting(on: boolean): void {
    this.targeting = on;
  }

  /** Burst of bright cubes at a board cell. */
  burst(row: number, col: number, value: number, amount = 14): void {
    const at = cellPosition(row, col);
    const color = new Color(baseColor(value)).lerp(new Color(0xffffff), 0.35);
    for (let i = 0; i < amount; i += 1) {
      const size = 0.08 + Math.random() * 0.12;
      const mesh = new Mesh(this.sparkGeometry, new MeshBasicMaterial({ color, transparent: true }));
      mesh.scale.set(size, size, size);
      mesh.position.set(at.x, 0.8, at.z);
      this.scene.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.8;
      this.sparks.push({
        mesh,
        velocity: new Vector3(Math.cos(angle) * speed, 3 + Math.random() * 3.5, Math.sin(angle) * speed),
        life: 0.55 + Math.random() * 0.4,
      });
    }
  }

  /** Expanding shock ring on the board at a cell. */
  ring(row: number, col: number, value: number): void {
    const at = cellPosition(row, col);
    const mesh = new Mesh(
      this.ringGeometry,
      new MeshBasicMaterial({
        color: new Color(baseColor(value)).lerp(new Color(0xffffff), 0.5),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, TILE_TOP + 0.05, at.z);
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life: 0.5, reach: value >= 64 ? 3.6 : 2.4 });
  }

  /** Shower of sparks across the whole board, for the win. */
  confetti(): void {
    const values = [2, 4, 8, 16, 32, 64, 128];
    for (let i = 0; i < 9; i += 1) {
      const value = values[Math.floor(Math.random() * values.length)] ?? 128;
      this.burst(Math.floor(Math.random() * SIZE), Math.floor(Math.random() * SIZE), value, 18);
    }
  }

  punch(strength = 0.05): void {
    this.punchAmount = Math.max(this.punchAmount, strength);
  }

  kick(): void {
    this.shake = 0.45;
  }

  /** Screen position (pixels) of a board cell, for floating score pops. */
  screenOf(row: number, col: number): { x: number; y: number } {
    const at = cellPosition(row, col);
    const point = new Vector3(at.x, 0.8, at.z).project(this.camera);
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height };
  }

  /** Board cell under a screen point (pixels), or null when the point is off the tiles. */
  cellAt(x: number, y: number): { row: number; col: number } | null {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((x - rect.left) / width) * 2 - 1;
    const ndcY = -(((y - rect.top) / height) * 2 - 1);
    const origin = new Vector3(ndcX, ndcY, -1).unproject(this.camera);
    const far = new Vector3(ndcX, ndcY, 1).unproject(this.camera);
    const ray = new Ray(origin, far.sub(origin).normalize());
    const hit = ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -TILE_TOP), new Vector3());
    if (!hit) return null;
    const col = Math.round(hit.x / CELL + (SIZE - 1) / 2);
    const row = Math.round(hit.z / CELL + (SIZE - 1) / 2);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
    return { row, col };
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const aspect = width / height;
    const viewHeight = Math.max(10.5, 7.4 / aspect);
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  update(dt: number): void {
    this.time += dt;
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    this.shake = Math.max(0, this.shake - dt);
    this.camera.position.set(shakeX, 12 + shakeY, 5.5);
    this.camera.lookAt(0, 0, 0.3);

    if (this.punchAmount > 0.0005) {
      this.punchAmount *= Math.max(0, 1 - dt * 9);
      this.camera.zoom = 1 + this.punchAmount;
      this.camera.updateProjectionMatrix();
    } else if (this.camera.zoom !== 1) {
      this.punchAmount = 0;
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
    }

    this.updateDust(dt);

    const sixtyFours = this.views.filter((view) => view.value === 64 && view.dying < 0).length;
    const nearWin = sixtyFours >= 2;
    const beat = 0.5 + 0.5 * Math.sin(this.time * 6);

    for (let i = this.views.length - 1; i >= 0; i -= 1) {
      const view = this.views[i];
      if (!view) continue;

      if (view.spawnDelay > 0) {
        view.spawnDelay -= dt;
        if (view.spawnDelay <= 0) {
          view.pop = 0;
          view.popKind = "spawn";
        }
        continue;
      }

      if (view.dying >= 0) {
        view.dying -= dt;
        const t = Math.max(0, view.dying / DIE_SECONDS);
        view.box.scale.setScalar(Math.max(0.001, t));
        if (view.dying <= 0) {
          this.removeView(view);
          this.views.splice(i, 1);
        }
        continue;
      }

      if (view.slide < SLIDE_SECONDS) {
        view.slide = Math.min(SLIDE_SECONDS, view.slide + dt);
        const t = view.slide / SLIDE_SECONDS;
        const eased = 1 - (1 - t) * (1 - t);
        view.box.position.x = view.fromX + (view.toX - view.fromX) * eased;
        view.box.position.z = view.fromZ + (view.toZ - view.fromZ) * eased;
        if (view.slide >= SLIDE_SECONDS) {
          view.box.position.x = view.toX;
          view.box.position.z = view.toZ;
          if (view.removeAtEnd) {
            this.removeView(view);
            this.views.splice(i, 1);
            continue;
          }
          if (view.pendingValue !== null) {
            this.setValue(view, view.pendingValue);
            view.pendingValue = null;
            view.pop = 0;
            view.popKind = "merge";
          }
        }
      }

      if (view.pop >= 0) {
        view.pop += dt;
        const t = Math.min(1, view.pop / POP_SECONDS);
        const sine = Math.sin(t * Math.PI);
        if (view.popKind === "spawn") {
          // A freshly spawned tile grows in from nothing, with a small overshoot.
          const grow = t < 0.7 ? t / 0.7 : 1 + 0.12 * Math.sin(((t - 0.7) / 0.3) * Math.PI);
          view.box.scale.setScalar(Math.max(0.001, grow));
        } else {
          // A merge hits: squash flat and wide, then stretch past 1 and settle.
          const squash = t < 0.3 ? -0.18 * (t / 0.3) : 0.3 * Math.sin(((t - 0.3) / 0.7) * Math.PI);
          const wide = 1 + (t < 0.3 ? 0.14 * (t / 0.3) : 0.2 * sine);
          view.box.scale.set(wide, 1 + squash, wide);
        }
        if (t >= 1) {
          view.box.scale.setScalar(1);
          view.pop = -1;
        }
      } else if (view.slide >= SLIDE_SECONDS) {
        // Idle: a slow breathing pulse, out of phase per tile, so the board is alive at rest.
        const wobble = this.targeting ? 0.07 * Math.sin(this.time * 12 + view.id * 1.3) : 0.022 * Math.sin(this.time * 2.4 + view.id * 1.7);
        view.box.scale.setScalar(1 + wobble);
      }

      const glowing = nearWin && view.value === 64;
      const halo = view.halo;
      halo.position.set(view.box.position.x, 0.17, view.box.position.z);
      halo.material.opacity = glowing ? 0.25 + 0.6 * beat : 0;
      view.face.material.color.setScalar(glowing ? 1 + 0.35 * beat : 1);
      if (glowing && view.pop < 0) view.box.scale.setScalar(1 + 0.05 * beat);
    }

    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i];
      if (!spark) continue;
      spark.life -= dt;
      spark.velocity.y -= 16 * dt;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      spark.mesh.rotation.x += dt * 9;
      spark.mesh.rotation.y += dt * 7;
      spark.mesh.material.opacity = Math.max(0, Math.min(1, spark.life * 3));
      if (spark.life <= 0) {
        this.scene.remove(spark.mesh);
        spark.mesh.material.dispose();
        this.sparks.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const ring = this.rings[i];
      if (!ring) continue;
      ring.age += dt;
      const t = Math.min(1, ring.age / ring.life);
      ring.mesh.scale.setScalar(0.6 + t * ring.reach);
      ring.mesh.material.opacity = 0.9 * (1 - t) * (1 - t);
      if (t >= 1) {
        this.scene.remove(ring.mesh);
        ring.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  private updateDust(dt: number): void {
    const attribute = this.dust.geometry.getAttribute("position") as BufferAttribute;
    const array = attribute.array as Float32Array;
    for (let i = 0; i < DUST_COUNT; i += 1) {
      const seed = this.dustSeed[i] ?? 0;
      array[i * 3] = (array[i * 3] ?? 0) + Math.sin(this.time * 0.6 + seed) * dt * 0.35;
      array[i * 3 + 2] = (array[i * 3 + 2] ?? 0) - dt * (0.35 + (seed % 1) * 0.5);
      if ((array[i * 3 + 2] ?? 0) < -7.5) array[i * 3 + 2] = 7.5;
    }
    attribute.needsUpdate = true;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
