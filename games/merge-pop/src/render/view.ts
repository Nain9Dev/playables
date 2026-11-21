import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { SIZE, type MoveResult, type Tile } from "../game/rules.ts";

const CELL = 1.25;
const TILE_HEIGHT = 0.5;
const SLIDE_SECONDS = 0.11;
const POP_SECONDS = 0.22;

type TileMesh = Mesh<BoxGeometry, MeshLambertMaterial>;

interface TileView {
  id: number;
  value: number;
  box: TileMesh;
  label: Mesh<PlaneGeometry, MeshBasicMaterial>;
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
  /** A spawned tile waits for the slide of the others, then grows in. */
  spawnDelay: number;
}

interface Spark {
  mesh: Mesh<BoxGeometry, MeshLambertMaterial>;
  velocity: Vector3;
  life: number;
}

function hueFor(value: number): number {
  const level = Math.log2(Math.max(2, value));
  return (((0.62 - level * 0.07) % 1) + 1) % 1;
}

function colorFor(value: number): Color {
  if (value >= 128) return new Color(0xffc21a);
  return new Color().setHSL(hueFor(value), 0.72, 0.56);
}

export function cellPosition(row: number, col: number): { x: number; z: number } {
  return { x: (col - (SIZE - 1) / 2) * CELL, z: (row - (SIZE - 1) / 2) * CELL };
}

/** Owns everything Three.js for the merge puzzle: board, tiles, animations and effects. */
export class MergeView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  private readonly tileGeometry = new BoxGeometry(CELL - 0.14, TILE_HEIGHT, CELL - 0.14);
  private readonly labelGeometry = new PlaneGeometry(CELL - 0.34, CELL - 0.34);
  private readonly sparkGeometry = new BoxGeometry(1, 1, 1);
  private readonly textures = new Map<number, CanvasTexture>();
  private views: TileView[] = [];
  private readonly sparks: Spark[] = [];
  private shake = 0;
  private punchAmount = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearAlpha(0);

    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 1.8);
    sun.position.set(-3, 9, 5);
    this.scene.add(sun);

    this.buildBoard();
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

  /** Draw a tile number on a small canvas. The digits are the only "asset" and they are generated. */
  private textureFor(value: number): CanvasTexture {
    const cached = this.textures.get(value);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      const text = String(value);
      context.font = `900 ${text.length >= 3 ? 62 : text.length === 2 ? 80 : 94}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 10;
      context.strokeStyle = "rgba(10, 16, 50, 0.4)";
      context.strokeText(text, 64, 70);
      context.fillStyle = "#ffffff";
      context.fillText(text, 64, 70);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.textures.set(value, texture);
    return texture;
  }

  private createView(tile: Tile, scale: number): TileView {
    const box: TileMesh = new Mesh(this.tileGeometry, new MeshLambertMaterial({ color: colorFor(tile.value) }));
    const label = new Mesh(
      this.labelGeometry,
      new MeshBasicMaterial({ map: this.textureFor(tile.value), transparent: true }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.y = TILE_HEIGHT / 2 + 0.01;
    box.add(label);
    const at = cellPosition(tile.row, tile.col);
    box.position.set(at.x, TILE_HEIGHT / 2 + 0.15, at.z);
    box.scale.setScalar(scale);
    this.scene.add(box);
    return {
      id: tile.id,
      value: tile.value,
      box,
      label,
      fromX: at.x,
      fromZ: at.z,
      toX: at.x,
      toZ: at.z,
      slide: SLIDE_SECONDS,
      removeAtEnd: false,
      pendingValue: null,
      pop: -1,
      spawnDelay: 0,
    };
  }

  private setValue(view: TileView, value: number): void {
    view.value = value;
    view.box.material.color.copy(colorFor(value));
    view.label.material.map = this.textureFor(value);
    view.label.material.needsUpdate = true;
  }

  private removeView(view: TileView): void {
    this.scene.remove(view.box);
    view.box.material.dispose();
    view.label.material.dispose();
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
    this.shake = 0;
    this.punchAmount = 0;
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

  /** Burst of small cubes at a board cell. */
  burst(row: number, col: number, value: number, amount = 14): void {
    const at = cellPosition(row, col);
    const color = colorFor(value);
    for (let i = 0; i < amount; i += 1) {
      const size = 0.1 + Math.random() * 0.12;
      const mesh = new Mesh(this.sparkGeometry, new MeshLambertMaterial({ color }));
      mesh.scale.set(size, size, size);
      mesh.position.set(at.x, 0.7, at.z);
      this.scene.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      this.sparks.push({
        mesh,
        velocity: new Vector3(Math.cos(angle) * speed, 3 + Math.random() * 3.5, Math.sin(angle) * speed),
        life: 0.8,
      });
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

    for (let i = this.views.length - 1; i >= 0; i -= 1) {
      const view = this.views[i];
      if (!view) continue;

      if (view.spawnDelay > 0) {
        view.spawnDelay -= dt;
        if (view.spawnDelay <= 0) view.pop = 0;
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
          }
        }
      }

      if (view.pop >= 0) {
        view.pop += dt;
        const t = Math.min(1, view.pop / POP_SECONDS);
        // Overshoot then settle: a small spring so a merge feels like a hit.
        const grow = view.box.scale.x < 0.5 ? t : 1 + 0.28 * Math.sin(t * Math.PI);
        view.box.scale.setScalar(Math.max(0.001, grow));
        if (t >= 1) {
          view.box.scale.setScalar(1);
          view.pop = -1;
        }
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i];
      if (!spark) continue;
      spark.life -= dt;
      spark.velocity.y -= 16 * dt;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      spark.mesh.rotation.x += dt * 9;
      spark.mesh.rotation.y += dt * 7;
      if (spark.life <= 0) {
        this.scene.remove(spark.mesh);
        spark.mesh.material.dispose();
        this.sparks.splice(i, 1);
      }
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
