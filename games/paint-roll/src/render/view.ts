import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Cell, Level } from "../game/rules.ts";

const MAX_SPLASHES = 120;
const DUST_COUNT = 24;
const UNPAINTED_COLOR = new Color(0xf0f4ff);
const NEAR_WIN_COLOR = new Color(0xffe14d);
const PAINT_A = new Color(0xff2f85);
const PAINT_B = new Color(0x00d4ff);

interface TileSlot {
  r: number;
  c: number;
  painted: boolean;
  pop: number;
  color: Color;
}

interface Splash {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  life: number;
  color: Color;
}

interface Ring {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  life: number;
  max: number;
}

interface SlideAnim {
  waypoints: Vector3[];
  segment: number;
  t: number;
  speed: number;
  onCell: (index: number) => void;
  onDone: () => void;
}

function mergeSimple(parts: BufferGeometry[]): BufferGeometry {
  const prepared = parts.map((p) => (p.index ? p.toNonIndexed() : p.clone()));
  const merged = mergeGeometries(prepared, false);
  for (const p of parts) p.dispose();
  for (const p of prepared) p.dispose();
  if (!merged) throw new Error("failed to merge paint-roll geometries");
  return merged;
}

export class PaintView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(46, 1, 0.1, 80);
  private readonly dummy = new Object3D();
  private readonly ball: Mesh<SphereGeometry, MeshPhongMaterial>;
  private readonly splashMesh: InstancedMesh;
  private readonly dustMesh: InstancedMesh;
  private readonly ringGeo = new RingGeometry(0.35, 0.55, 24);
  private readonly splashes: Splash[] = [];
  private readonly rings: Ring[] = [];
  private boardGroup: Object3D | null = null;
  private tileMesh: InstancedMesh | null = null;
  private tileSlots: TileSlot[] = [];
  private starMesh: InstancedMesh | null = null;
  private starSlots: { r: number; c: number; taken: boolean }[] = [];
  private level: Level | null = null;
  private anim: SlideAnim | null = null;
  private ballPos = new Vector3();
  private squash = 0;
  private squashAxis: "x" | "z" = "x";
  private punchAmount = 0;
  private shake = 0;
  private clock = 0;
  private remaining = 99;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.scene.add(new AmbientLight(0xffffff, 1.55));
    const key = new DirectionalLight(0xffffff, 1.75);
    key.position.set(4, 12, 6);
    this.scene.add(key);
    const rim = new DirectionalLight(0x88e6ff, 0.7);
    rim.position.set(-6, 5, -5);
    this.scene.add(rim);

    this.ball = new Mesh(
      new SphereGeometry(0.4, 24, 18),
      new MeshPhongMaterial({ color: 0xff2f85, shininess: 110, specular: 0xffffff }),
    );
    this.scene.add(this.ball);

    this.splashMesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshLambertMaterial({ color: 0xffffff, emissive: 0x332233 }),
      MAX_SPLASHES,
    );
    this.splashMesh.frustumCulled = false;
    this.splashMesh.count = 0;
    this.scene.add(this.splashMesh);

    this.dustMesh = new InstancedMesh(
      new OctahedronGeometry(0.08, 0),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
      DUST_COUNT,
    );
    this.dustMesh.frustumCulled = false;
    this.scene.add(this.dustMesh);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  private worldOf(r: number, c: number): Vector3 {
    const level = this.level;
    const rows = level?.rows ?? 6;
    const cols = level?.cols ?? 6;
    return new Vector3(c - (cols - 1) / 2, 0, r - (rows - 1) / 2);
  }

  setLevel(level: Level): void {
    this.level = level;
    if (this.boardGroup) this.scene.remove(this.boardGroup);
    if (this.tileMesh) this.scene.remove(this.tileMesh);
    if (this.starMesh) this.scene.remove(this.starMesh);

    const group = new Object3D();
    const rows = level.rows;
    const cols = level.cols;

    // Board base + raised perimeter frame merged into 1 draw call
    const frameParts: BufferGeometry[] = [];
    const base = new BoxGeometry(cols + 0.7, 0.5, rows + 0.7);
    base.translate(0, -0.34, 0);
    frameParts.push(base);
    const north = new BoxGeometry(cols + 0.7, 0.72, 0.36);
    north.translate(0, 0.24, -rows / 2 - 0.18);
    const south = new BoxGeometry(cols + 0.7, 0.72, 0.36);
    south.translate(0, 0.24, rows / 2 + 0.18);
    const west = new BoxGeometry(0.36, 0.72, rows + 0.7);
    west.translate(-cols / 2 - 0.18, 0.24, 0);
    const east = new BoxGeometry(0.36, 0.72, rows + 0.7);
    east.translate(cols / 2 + 0.18, 0.24, 0);
    frameParts.push(north, south, west, east);
    group.add(new Mesh(mergeSimple(frameParts), new MeshLambertMaterial({ color: 0x26295c })));

    // Sculpted inner wall blocks merged into 1 draw call (body) + 1 draw call (lighter cap)
    const wallBodies: BufferGeometry[] = [];
    const wallCaps: BufferGeometry[] = [];
    const tiles: TileSlot[] = [];

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const pos = this.worldOf(r, c);
        if (level.walls[r]?.[c]) {
          const body = new BoxGeometry(0.96, 0.62, 0.96);
          body.translate(pos.x, 0.22, pos.z);
          wallBodies.push(body);
          const cap = new BoxGeometry(0.84, 0.1, 0.84);
          cap.translate(pos.x, 0.56, pos.z);
          wallCaps.push(cap);
        } else {
          const mix = (r + c) / Math.max(1, rows + cols - 2);
          const paint = PAINT_A.clone().lerp(PAINT_B, mix);
          tiles.push({
            r,
            c,
            painted: r === level.start.r && c === level.start.c,
            pop: 0,
            color: paint,
          });
        }
      }
    }
    if (wallBodies.length > 0) {
      group.add(new Mesh(mergeSimple(wallBodies), new MeshLambertMaterial({ color: 0x3b4182 })));
      group.add(new Mesh(mergeSimple(wallCaps), new MeshLambertMaterial({ color: 0x5c64b0 })));
    }
    this.scene.add(group);
    this.boardGroup = group;

    const tileGeo = new BoxGeometry(0.92, 0.16, 0.92);
    const tileMesh = new InstancedMesh(tileGeo, new MeshLambertMaterial({ color: 0xffffff }), tiles.length);
    tileMesh.frustumCulled = false;
    this.tileSlots = tiles;
    this.tileMesh = tileMesh;
    this.scene.add(tileMesh);

    const starMesh = new InstancedMesh(
      new OctahedronGeometry(0.28, 0),
      new MeshLambertMaterial({ color: 0xffe14d, emissive: 0x996b00 }),
      Math.max(1, level.stars.length),
    );
    starMesh.frustumCulled = false;
    starMesh.count = level.stars.length;
    this.starSlots = level.stars.map((s) => ({ r: s.r, c: s.c, taken: false }));
    this.starMesh = starMesh;
    this.scene.add(starMesh);

    this.reset(level.start);
  }

  reset(start: Cell): void {
    this.anim = null;
    this.splashes.length = 0;
    this.splashMesh.count = 0;
    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      ring.mesh.material.dispose();
    }
    this.rings.length = 0;
    for (const slot of this.tileSlots) {
      slot.painted = slot.r === start.r && slot.c === start.c;
      slot.pop = 0;
    }
    for (const s of this.starSlots) s.taken = false;
    this.ballPos.copy(this.worldOf(start.r, start.c));
    this.ballPos.y = 0.42;
    this.ball.position.copy(this.ballPos);
    this.squash = 0;
    this.punchAmount = 0;
    this.shake = 0;
    this.remaining = Math.max(0, this.tileSlots.length - 1);
  }

  setRemaining(remaining: number): void {
    this.remaining = remaining;
  }

  markPainted(cell: Cell): void {
    const slot = this.tileSlots.find((t) => t.r === cell.r && t.c === cell.c);
    if (!slot) return;
    slot.painted = true;
    slot.pop = 1;
    const pos = this.worldOf(cell.r, cell.c);
    this.burst(pos.x, pos.z, slot.color.getHex(), 5, 0.25);
  }

  collectStar(cell: Cell): void {
    const slot = this.starSlots.find((s) => s.r === cell.r && s.c === cell.c);
    if (slot) slot.taken = true;
    const pos = this.worldOf(cell.r, cell.c);
    this.burst(pos.x, pos.z, 0xffe14d, 18, 0.55);
    this.ring(pos.x, pos.z, 0xffe14d, 2.2);
  }

  /** Animate the ball sliding through `path`, calling `onCell(i)` as each tile is crossed. */
  animateSlide(from: Cell, path: Cell[], onCell: (index: number) => void, onDone: () => void): void {
    const waypoints = [from, ...path].map((cell) => {
      const v = this.worldOf(cell.r, cell.c);
      v.y = 0.42;
      return v;
    });
    const last = path[path.length - 1] ?? from;
    this.squashAxis = Math.abs(last.c - from.c) > Math.abs(last.r - from.r) ? "x" : "z";
    this.anim = {
      waypoints,
      segment: 0,
      t: 0,
      speed: 19,
      onCell,
      onDone,
    };
  }

  get animating(): boolean {
    return this.anim !== null;
  }

  punch(amount = 0.05): void {
    this.punchAmount = Math.max(this.punchAmount, amount);
  }

  kick(amount = 0.25): void {
    this.shake = Math.max(this.shake, amount);
  }

  burst(x: number, z: number, color: number, amount = 14, y = 0.35): void {
    const tint = new Color(color);
    for (let i = 0; i < amount; i += 1) {
      if (this.splashes.length >= MAX_SPLASHES) this.splashes.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.6 + Math.random() * 3.8;
      this.splashes.push({
        x,
        y,
        z,
        vx: Math.cos(angle) * speed,
        vy: 2.5 + Math.random() * 4.2,
        vz: Math.sin(angle) * speed,
        size: 0.08 + Math.random() * 0.11,
        life: 0.65,
        color: tint,
      });
    }
  }

  ring(x: number, z: number, color: number, max = 2.6): void {
    const mesh = new Mesh(
      this.ringGeo,
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.16, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.45, max });
  }

  confetti(): void {
    const colors = [0xff2f85, 0x00d4ff, 0xffe14d, 0x6bff8b];
    for (let i = 0; i < 4; i += 1) {
      this.burst((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, colors[i]!, 20, 0.8);
    }
    this.ring(0, 0, 0xffe14d, 5.5);
  }

  screenOf(cell: Cell): { x: number; y: number } {
    const pos = this.worldOf(cell.r, cell.c);
    pos.y = 0.5;
    pos.project(this.camera);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    return { x: ((pos.x + 1) / 2) * w, y: ((1 - pos.y) / 2) * h };
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Frame the full 6x6 board + perimeter with breathing room on narrow portrait phones and landscape.
    const dist = Math.max(9.8, 8.8 / Math.min(aspect, 1));
    this.camera.position.set(0, dist * 0.9, dist * 0.48);
    this.camera.lookAt(0, -0.15, 0.2);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  update(dt: number): void {
    this.clock += dt;

    if (this.anim) {
      this.anim.t += dt * this.anim.speed;
      while (this.anim && this.anim.t >= 1) {
        this.anim.t -= 1;
        this.anim.onCell(this.anim.segment);
        this.anim.segment += 1;
        if (this.anim.segment >= this.anim.waypoints.length - 1) {
          const end = this.anim.waypoints[this.anim.waypoints.length - 1]!;
          this.ballPos.copy(end);
          this.squash = 1;
          const done = this.anim.onDone;
          this.anim = null;
          done();
          break;
        }
      }
      if (this.anim) {
        const a = this.anim.waypoints[this.anim.segment]!;
        const b = this.anim.waypoints[this.anim.segment + 1]!;
        this.ballPos.lerpVectors(a, b, this.anim.t);
      }
    }

    // Ball squash/stretch & idle breathe
    this.squash = Math.max(0, this.squash - dt * 6);
    const breathe = this.anim ? 0 : Math.sin(this.clock * 4) * 0.04;
    const stretch = this.anim ? 0.16 : 0;
    const sq = this.squash * 0.28;
    const sx = 1 + (this.squashAxis === "x" ? stretch - sq : -stretch * 0.5 + sq * 0.6) + breathe;
    const sz = 1 + (this.squashAxis === "z" ? stretch - sq : -stretch * 0.5 + sq * 0.6) + breathe;
    const sy = 1 + sq * 0.5 - breathe * 0.6;
    this.ball.position.set(this.ballPos.x, this.ballPos.y + Math.abs(breathe) * 0.6, this.ballPos.z);
    this.ball.scale.set(sx, sy, sz);

    // Update floor tiles (painted pop + near-win gold pulse on <= 3 remaining tiles)
    const tileMesh = this.tileMesh;
    if (tileMesh) {
      const pulse = this.remaining > 0 && this.remaining <= 3 ? (Math.sin(this.clock * 9) + 1) * 0.5 : 0;
      const tmpColor = new Color();
      this.tileSlots.forEach((slot, i) => {
        if (slot.pop > 0) slot.pop = Math.max(0, slot.pop - dt * 5);
        const pos = this.worldOf(slot.r, slot.c);
        const lift = slot.painted ? 0.03 + Math.sin(slot.pop * Math.PI) * 0.14 : 0;
        this.dummy.position.set(pos.x, lift, pos.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1 + slot.pop * 0.25, 1);
        this.dummy.updateMatrix();
        tileMesh.setMatrixAt(i, this.dummy.matrix);
        if (slot.painted) {
          tileMesh.setColorAt(i, slot.color);
        } else if (pulse > 0) {
          tmpColor.copy(UNPAINTED_COLOR).lerp(NEAR_WIN_COLOR, pulse * 0.85);
          tileMesh.setColorAt(i, tmpColor);
        } else {
          tileMesh.setColorAt(i, UNPAINTED_COLOR);
        }
      });
      tileMesh.instanceMatrix.needsUpdate = true;
      if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true;
    }

    // Update floating stars
    const starMesh = this.starMesh;
    if (starMesh) {
      this.starSlots.forEach((slot, i) => {
        const pos = this.worldOf(slot.r, slot.c);
        this.dummy.position.set(pos.x, 0.45 + Math.sin(this.clock * 4 + i) * 0.1, pos.z);
        this.dummy.rotation.set(this.clock * 1.4, this.clock * 2.5 + i, 0);
        this.dummy.scale.setScalar(slot.taken ? 0.0001 : 1);
        this.dummy.updateMatrix();
        starMesh.setMatrixAt(i, this.dummy.matrix);
      });
      starMesh.instanceMatrix.needsUpdate = true;
    }

    // Update ambient background sparkles
    for (let i = 0; i < DUST_COUNT; i += 1) {
      const angle = i * 2.39996 + this.clock * 0.12;
      const radius = 4.6 + (i % 4) * 1.1;
      const y = -1.2 + ((i * 0.53 + this.clock * 0.35) % 4.5);
      this.dummy.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      this.dummy.rotation.set(this.clock + i, this.clock * 0.7, 0);
      this.dummy.scale.setScalar(0.7 + Math.sin(this.clock * 2 + i) * 0.3);
      this.dummy.updateMatrix();
      this.dustMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.dustMesh.instanceMatrix.needsUpdate = true;

    // Update pooled paint splashes
    for (let i = this.splashes.length - 1; i >= 0; i -= 1) {
      const s = this.splashes[i]!;
      s.life -= dt;
      if (s.life <= 0) {
        this.splashes.splice(i, 1);
        continue;
      }
      s.vy -= 14 * dt;
      s.x += s.vx * dt;
      s.y = Math.max(0.05, s.y + s.vy * dt);
      s.z += s.vz * dt;
    }
    this.splashMesh.count = this.splashes.length;
    if (this.splashes.length > 0) {
      this.splashes.forEach((s, i) => {
        this.dummy.position.set(s.x, s.y, s.z);
        this.dummy.rotation.set(s.life * 7, s.life * 5, 0);
        this.dummy.scale.setScalar(s.size * Math.min(1, s.life * 2.5));
        this.dummy.updateMatrix();
        this.splashMesh.setMatrixAt(i, this.dummy.matrix);
        this.splashMesh.setColorAt(i, s.color);
      });
      this.splashMesh.instanceMatrix.needsUpdate = true;
      if (this.splashMesh.instanceColor) this.splashMesh.instanceColor.needsUpdate = true;
    }

    // Update rings
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const ring = this.rings[i]!;
      ring.life -= dt;
      const t = 1 - Math.max(0, ring.life) / 0.45;
      ring.mesh.scale.setScalar(0.4 + t * ring.max);
      ring.mesh.material.opacity = 0.85 * (1 - t);
      if (ring.life <= 0) {
        this.scene.remove(ring.mesh);
        ring.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }

    // Camera punch & shake
    this.punchAmount = Math.max(0, this.punchAmount - dt * 0.4);
    this.shake = Math.max(0, this.shake - dt * 1.4);
    const zoom = 1 + this.punchAmount;
    if (Math.abs(this.camera.zoom - zoom) > 0.002) {
      this.camera.zoom = zoom;
      this.camera.updateProjectionMatrix();
    }
    const sxCam = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.35 : 0;
    const syCam = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.35 : 0;
    this.camera.position.x = sxCam;
    this.camera.lookAt(sxCam * 0.3, -0.2 + syCam * 0.3, 0.25);
    this.dummy.scale.setScalar(1);
    this.dummy.rotation.set(0, 0, 0);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
