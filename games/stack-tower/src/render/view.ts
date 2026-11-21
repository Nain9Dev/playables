import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Block } from "../game/stack.ts";

export const BLOCK_HEIGHT = 0.5;
const GRAVITY = 22;
const GOLD = 0xffc21a;
const TRAIL_LIFE = 0.28;

type BlockMesh = Mesh<BoxGeometry, MeshLambertMaterial>;

interface Debris {
  mesh: BlockMesh;
  velocity: Vector3;
  spin: Vector3;
  life: number;
  gravity: number;
}

interface Ring {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  age: number;
  /** Size of the block the ring was spawned on. The ring grows from this size. */
  width: number;
  depth: number;
  color: number;
}

interface Landing {
  mesh: BlockMesh;
  age: number;
}

interface Ghost {
  mesh: Mesh<BoxGeometry, MeshBasicMaterial>;
  age: number;
}

/** Hue for a level. The color walks around the wheel as the tower grows. */
export function hueForLevel(level: number): number {
  return (0.55 + level * 0.035) % 1;
}

/** Owns everything Three.js: scene, camera, meshes and small visual effects. */
export class StackView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly unitBox = new BoxGeometry(1, 1, 1);
  private readonly capGeometry = new PlaneGeometry(1, 1);
  private readonly edgeGeometry = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  private readonly capMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  private readonly edgeMaterial = new LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
  });
  private readonly ringGeometry = new RingGeometry(0.5, 0.58, 56);
  private readonly tower: BlockMesh[] = [];
  private readonly debris: Debris[] = [];
  private readonly rings: Ring[] = [];
  private readonly landings: Landing[] = [];
  private readonly ghosts: Ghost[] = [];
  private moving: BlockMesh | null = null;
  private movingBlock: Block | null = null;
  private cameraY = 0;
  private targetY = 0;
  private shake = 0;
  private punchAmount = 0;
  private glowTier = 0;
  private pullTarget = 1;
  private pull = 1;
  private reduced = false;
  private clock = 0;
  private ghostTimer = 0;
  private viewHeight = 11;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearAlpha(0);

    this.scene.add(new HemisphereLight(0xffffff, 0x6f78a8, 1.25));
    const sun = new DirectionalLight(0xffffff, 1.7);
    sun.position.set(4, 9, 6);
    this.scene.add(sun);

    this.capGeometry.rotateX(-Math.PI / 2);
    this.capGeometry.translate(0, 0.5 + 0.003, 0);
    this.ringGeometry.rotateX(-Math.PI / 2);
    this.buildPlatform();
    this.resize();
    // A ResizeObserver also catches the canvas changing size inside an iframe or a phone frame.
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  /** A round pedestal with a soft shadow under the tower, so the base is grounded. */
  private buildPlatform(): void {
    const platform = new Mesh(
      new CylinderGeometry(2.8, 3.0, 0.6, 48),
      new MeshLambertMaterial({ color: 0x3d4a8f }),
    );
    platform.position.y = -BLOCK_HEIGHT / 2 - 0.3;
    this.scene.add(platform);

    const size = 128;
    const surface = document.createElement("canvas");
    surface.width = size;
    surface.height = size;
    const ctx = surface.getContext("2d");
    if (ctx) {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, "rgba(8,10,40,0.55)");
      gradient.addColorStop(0.6, "rgba(8,10,40,0.22)");
      gradient.addColorStop(1, "rgba(8,10,40,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
    const shadow = new Mesh(
      new CircleGeometry(2.5, 40),
      new MeshBasicMaterial({
        map: new CanvasTexture(surface),
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -BLOCK_HEIGHT / 2 + 0.01;
    this.scene.add(shadow);
  }

  private colorFor(level: number, golden: boolean): Color {
    return golden ? new Color(GOLD) : new Color().setHSL(hueForLevel(level), 0.78, 0.5);
  }

  private makeMesh(block: Block, level: number, golden = false, decorate = true): BlockMesh {
    const material = new MeshLambertMaterial({ color: this.colorFor(level, golden) });
    if (golden) material.emissive.set(GOLD).multiplyScalar(0.32);
    const mesh = new Mesh(this.unitBox, material);
    mesh.userData["golden"] = golden;
    if (decorate) {
      mesh.add(new Mesh(this.capGeometry, this.capMaterial));
      mesh.add(new LineSegments(this.edgeGeometry, this.edgeMaterial));
    }
    this.place(mesh, block, level);
    this.scene.add(mesh);
    return mesh;
  }

  private place(mesh: Mesh, block: Block, level: number): void {
    mesh.scale.set(block.w, BLOCK_HEIGHT, block.d);
    mesh.position.set(block.x, level * BLOCK_HEIGHT, block.z);
  }

  /** Match the camera frustum to the canvas. Portrait phones need a taller view. */
  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const aspect = width / height;
    this.viewHeight = Math.max(11, (2 * 4.9) / aspect);
    this.camera.left = (-this.viewHeight * aspect) / 2;
    this.camera.right = (this.viewHeight * aspect) / 2;
    this.camera.top = this.viewHeight / 2;
    this.camera.bottom = -this.viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  /** Camera height in world units. The sky uses it for parallax. */
  get climb(): number {
    return this.cameraY;
  }

  addBlock(block: Block, level: number, golden = false): void {
    const mesh = this.makeMesh(block, level, golden);
    this.tower.push(mesh);
    this.landings.push({ mesh, age: 0 });
    this.targetY = level * BLOCK_HEIGHT;
  }

  setMoving(block: Block | null, level: number, golden = false): void {
    if (this.moving) {
      this.scene.remove(this.moving);
      this.moving.material.dispose();
      this.moving = null;
    }
    this.movingBlock = block;
    if (block) this.moving = this.makeMesh(block, level, golden);
  }

  moveTo(block: Block, level: number): void {
    this.movingBlock = block;
    if (this.moving) this.place(this.moving, block, level);
  }

  /** Reduced motion turns off camera shake and the zoom punch. */
  setReducedMotion(value: boolean): void {
    this.reduced = value;
    if (value) {
      this.shake = 0;
      this.punchAmount = 0;
    }
  }

  /** Streak tier 0..3: the top blocks glow brighter and the moving block leaves a trail. */
  setGlow(tier: number): void {
    this.glowTier = tier;
  }

  /** Target view-height multiplier. The camera eases toward it. */
  setPullOut(factor: number): void {
    this.pullTarget = factor;
  }

  /** Turn the moving block into falling debris (on a miss, the whole block). */
  dropMovingAsDebris(): void {
    const mesh = this.moving;
    if (!mesh) return;
    this.moving = null;
    this.movingBlock = null;
    this.debris.push({
      mesh,
      velocity: new Vector3(0, 1, 0),
      spin: new Vector3(1.4, 0.4, 1.1),
      life: 2.2,
      gravity: GRAVITY,
    });
  }

  /** Spawn the cut-off part of a block. */
  spawnDebris(block: Block, level: number, golden = false): void {
    const mesh = this.makeMesh(block, level, golden);
    this.debris.push({
      mesh,
      velocity: new Vector3((Math.random() - 0.5) * 1.6, 0.6, (Math.random() - 0.5) * 1.6),
      spin: new Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 3),
      life: 2.2,
      gravity: GRAVITY,
    });
  }

  /** Expanding ring on a perfect drop. */
  pulse(block: Block, level: number, color = 0xffffff): void {
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(this.ringGeometry, material);
    mesh.position.set(block.x, level * BLOCK_HEIGHT + BLOCK_HEIGHT / 2 + 0.01, block.z);
    mesh.scale.set(block.w, 1, block.d);
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, width: block.w, depth: block.d, color });
  }

  /** A burst of small cubes from the edges of a perfectly placed block. */
  sparkle(block: Block, level: number, amount = 16, golden = false): void {
    for (let i = 0; i < amount; i += 1) {
      const size = 0.07 + Math.random() * 0.07;
      const edge = Math.random() < 0.5 ? -1 : 1;
      const alongX = Math.random() < 0.5;
      const spot: Block = {
        x: block.x + (alongX ? (Math.random() - 0.5) * block.w : edge * (block.w / 2)),
        z: block.z + (alongX ? edge * (block.d / 2) : (Math.random() - 0.5) * block.d),
        w: size,
        d: size,
      };
      const mesh = this.makeMesh(spot, level, golden, false);
      mesh.position.y = level * BLOCK_HEIGHT + BLOCK_HEIGHT / 2;
      mesh.scale.y = size;
      mesh.material.color.offsetHSL(0, golden ? 0 : -0.2, golden ? 0.15 : 0.3);
      mesh.material.emissive.copy(mesh.material.color).multiplyScalar(0.6);
      this.debris.push({
        mesh,
        velocity: new Vector3((spot.x - block.x) * 1.4, 3 + Math.random() * 3, (spot.z - block.z) * 1.4),
        spin: new Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
        life: golden ? 1 : 0.7,
        gravity: GRAVITY,
      });
    }
  }

  /** Small zoom pulse. Bigger on a perfect streak. */
  punch(strength = 0.05): void {
    if (this.reduced) return;
    this.punchAmount = Math.max(this.punchAmount, strength);
  }

  /** Small cubes thrown up from the top of the tower when the player wins. */
  confetti(top: Block, level: number): void {
    for (let i = 0; i < 46; i += 1) {
      const size = 0.12 + Math.random() * 0.12;
      const piece: Block = { x: top.x, z: top.z, w: size, d: size };
      const mesh = this.makeMesh(piece, Math.floor(Math.random() * 28), false, false);
      mesh.position.y = level * BLOCK_HEIGHT + BLOCK_HEIGHT;
      mesh.scale.y = size;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3.5;
      this.debris.push({
        mesh,
        velocity: new Vector3(Math.cos(angle) * speed, 7 + Math.random() * 5, Math.sin(angle) * speed),
        spin: new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        life: 2.4,
        gravity: GRAVITY,
      });
    }
  }

  /** Fireworks above the tower: three radial bursts in different hues, with soft gravity. */
  fireworks(top: Block, level: number): void {
    const bursts = [
      { dx: -1.6, dy: 3.6, hue: 0.02 },
      { dx: 1.7, dy: 4.4, hue: 0.14 },
      { dx: 0, dy: 5.6, hue: 0.55 },
    ];
    for (const burst of bursts) {
      for (let i = 0; i < 22; i += 1) {
        const size = 0.1 + Math.random() * 0.06;
        const piece: Block = { x: top.x + burst.dx, z: top.z, w: size, d: size };
        const mesh = this.makeMesh(piece, level, false, false);
        mesh.position.y = level * BLOCK_HEIGHT + burst.dy;
        mesh.scale.y = size;
        mesh.material.color.setHSL(burst.hue + Math.random() * 0.05, 0.95, 0.6);
        mesh.material.emissive.copy(mesh.material.color).multiplyScalar(0.8);
        const angle = (i / 22) * Math.PI * 2;
        const speed = 2.2 + Math.random() * 1.2;
        this.debris.push({
          mesh,
          velocity: new Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, (Math.random() - 0.5) * 1.5),
          spin: new Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
          life: 1.1,
          gravity: 5,
        });
      }
    }
  }

  kick(): void {
    if (this.reduced) return;
    this.shake = 0.45;
  }

  /** Remove every mesh and reset the camera, so a new game starts clean. */
  reset(): void {
    for (const mesh of this.tower) this.dispose(mesh);
    this.tower.length = 0;
    for (const piece of this.debris) this.dispose(piece.mesh);
    this.debris.length = 0;
    for (const ring of this.rings) this.disposeRing(ring);
    this.rings.length = 0;
    for (const ghost of this.ghosts) this.disposeGhost(ghost);
    this.ghosts.length = 0;
    this.landings.length = 0;
    this.setMoving(null, 0);
    this.cameraY = 0;
    this.targetY = 0;
    this.shake = 0;
    this.punchAmount = 0;
    this.glowTier = 0;
    this.pull = 1;
    this.pullTarget = 1;
    this.applyZoom();
  }

  private dispose(mesh: BlockMesh): void {
    this.scene.remove(mesh);
    mesh.material.dispose();
  }

  private disposeRing(ring: Ring): void {
    this.scene.remove(ring.mesh);
    ring.mesh.material.dispose();
  }

  private disposeGhost(ghost: Ghost): void {
    this.scene.remove(ghost.mesh);
    ghost.mesh.material.dispose();
  }

  private applyZoom(): void {
    this.camera.zoom = (1 + this.punchAmount) / this.pull;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.clock += dt;
    // Camera eases toward the top of the tower and pulls out as it grows.
    this.cameraY += (this.targetY - this.cameraY) * Math.min(1, dt * 4);
    this.pull += (this.pullTarget - this.pull) * Math.min(1, dt * 2.5);
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.6 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.6 : 0;
    this.shake = Math.max(0, this.shake - dt);
    this.camera.position.set(8 + shakeX, 8 + this.cameraY + shakeY, 8);
    this.camera.lookAt(0, this.cameraY + 1.2 + (this.pull - 1) * 2.2, 0);

    // Zoom punch decays fast so it reads as an impact, not a camera move.
    if (this.punchAmount > 0.0005) this.punchAmount *= Math.max(0, 1 - dt * 9);
    else this.punchAmount = 0;
    this.applyZoom();

    // Landing squash: the block compresses and springs back.
    for (let i = this.landings.length - 1; i >= 0; i -= 1) {
      const landing = this.landings[i];
      if (!landing) continue;
      landing.age += dt;
      const squash = 1 + 0.4 * Math.exp(-landing.age * 8) * Math.cos(landing.age * 26);
      landing.mesh.scale.y = BLOCK_HEIGHT * squash;
      if (landing.age > 0.6) {
        landing.mesh.scale.y = BLOCK_HEIGHT;
        this.landings.splice(i, 1);
      }
    }

    this.updateGlow();
    this.updateTrail(dt);

    for (let i = this.debris.length - 1; i >= 0; i -= 1) {
      const piece = this.debris[i];
      if (!piece) continue;
      piece.life -= dt;
      piece.velocity.y -= piece.gravity * dt;
      piece.mesh.position.addScaledVector(piece.velocity, dt);
      piece.mesh.rotation.x += piece.spin.x * dt;
      piece.mesh.rotation.y += piece.spin.y * dt;
      piece.mesh.rotation.z += piece.spin.z * dt;
      if (piece.life <= 0 || piece.mesh.position.y < this.cameraY - 14) {
        this.dispose(piece.mesh);
        this.debris.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const ring = this.rings[i];
      if (!ring) continue;
      ring.age += dt;
      const t = ring.age / 0.5;
      const grow = 1 + t * 0.7;
      ring.mesh.scale.set(ring.width * grow, 1, ring.depth * grow);
      ring.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
      if (t >= 1) {
        this.disposeRing(ring);
        this.rings.splice(i, 1);
      }
    }
  }

  /** On a streak the top blocks glow with their own color, brightest at the top. */
  private updateGlow(): void {
    const pulse = 0.85 + 0.15 * Math.sin(this.clock * 9);
    for (let i = 0; i < this.tower.length; i += 1) {
      const mesh = this.tower[this.tower.length - 1 - i];
      if (!mesh) continue;
      const golden = mesh.userData["golden"] === true;
      const streak = this.glowTier > 0 && i < 6 ? this.glowTier * 0.1 * (1 - i / 6) * pulse : 0;
      const base = golden ? 0.32 : 0;
      mesh.material.emissive.copy(mesh.material.color).multiplyScalar(Math.max(base, streak));
    }
  }

  /** Short-lived ghosts of the moving block: a glowing trail while the streak is on. */
  private updateTrail(dt: number): void {
    this.ghostTimer -= dt;
    const block = this.movingBlock;
    if (this.glowTier >= 2 && block && this.moving && !this.reduced && this.ghostTimer <= 0) {
      this.ghostTimer = 0.03;
      const color = this.moving.material.color.clone().offsetHSL(0, 0, 0.25);
      const ghost = new Mesh(
        this.unitBox,
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      ghost.position.copy(this.moving.position);
      ghost.scale.copy(this.moving.scale);
      this.scene.add(ghost);
      this.ghosts.push({ mesh: ghost, age: 0 });
    }
    for (let i = this.ghosts.length - 1; i >= 0; i -= 1) {
      const ghost = this.ghosts[i];
      if (!ghost) continue;
      ghost.age += dt;
      const t = ghost.age / TRAIL_LIFE;
      ghost.mesh.material.opacity = Math.max(0, 0.35 * (1 - t));
      ghost.mesh.scale.y = BLOCK_HEIGHT * (1 - t * 0.4);
      if (t >= 1) {
        this.disposeGhost(ghost);
        this.ghosts.splice(i, 1);
      }
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
