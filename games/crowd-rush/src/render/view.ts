import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { MOTION, gateLabel, isPositive, type Gate, type Level } from "../game/rules.ts";

const MAX_VISIBLE = 160;
const GOLDEN_ANGLE = 2.399963;
const SKY = 0x8ec9ff;

interface GateVisual {
  panels: Mesh<BoxGeometry, MeshBasicMaterial>[];
  labels: Mesh<PlaneGeometry, MeshBasicMaterial>[];
  fade: number;
}

interface Spark {
  mesh: Mesh<BoxGeometry, MeshLambertMaterial>;
  velocity: Vector3;
  life: number;
}

/** Draw a gate label on a small canvas. The text is the only "asset" and it is generated. */
function labelTexture(text: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.font = "800 150px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 14;
    context.strokeStyle = "rgba(10, 20, 60, 0.55)";
    context.strokeText(text, 128, 138);
    context.fillStyle = "#ffffff";
    context.fillText(text, 128, 138);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function roadTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#4a5778";
    context.fillRect(0, 0, 64, 128);
    context.fillStyle = "#566486";
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** Owns everything Three.js for the gate runner: scene, camera, crowds, gates and effects. */
export class RunView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(62, 1, 0.1, 160);
  private readonly dummy = new Object3D();
  private readonly player: InstancedMesh<SphereGeometry, MeshLambertMaterial>;
  private readonly enemy: InstancedMesh<SphereGeometry, MeshLambertMaterial>;
  private readonly sparkGeometry = new BoxGeometry(1, 1, 1);
  private readonly sparks: Spark[] = [];
  private readonly gates: GateVisual[] = [];
  private playerCenter = { x: 0, z: 0 };
  private playerCount = 0;
  private enemyZ = 0;
  private enemyCount = 0;
  private fovKick = 0;
  private shake = 0;
  private clock = 0;
  private enemyVisible = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.scene.background = new Color(SKY);
    this.scene.fog = new Fog(SKY, 35, 95);

    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.9);
    sun.position.set(-5, 12, -6);
    this.scene.add(sun);

    const blobGeometry = new SphereGeometry(0.22, 10, 8);
    this.player = new InstancedMesh(blobGeometry, new MeshLambertMaterial({ color: 0x3da0ff }), MAX_VISIBLE);
    this.enemy = new InstancedMesh(blobGeometry, new MeshLambertMaterial({ color: 0xff4458 }), MAX_VISIBLE);
    this.player.frustumCulled = false;
    this.enemy.frustumCulled = false;
    this.player.count = 0;
    this.enemy.count = 0;
    this.scene.add(this.player, this.enemy);

    this.resize();
    // A ResizeObserver also catches the canvas changing size inside an iframe or a phone frame.
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  /** Build the road, rails, gates and boss platform for a level. */
  buildLevel(level: Level): void {
    const length = level.bossZ + 40;

    const texture = roadTexture();
    texture.repeat.set(1, length / 8);
    const road = new Mesh(new PlaneGeometry(MOTION.halfRoad * 2 + 1.6, length), new MeshLambertMaterial({ map: texture }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, length / 2 - 12);
    this.scene.add(road);

    const railGeometry = new BoxGeometry(0.4, 0.6, length);
    const railMaterial = new MeshLambertMaterial({ color: 0xffffff });
    for (const side of [-1, 1]) {
      const rail = new Mesh(railGeometry, railMaterial);
      rail.position.set(side * (MOTION.halfRoad + 1.1), 0.3, length / 2 - 12);
      this.scene.add(rail);
    }

    const platform = new Mesh(
      new BoxGeometry(MOTION.halfRoad * 2 + 4, 0.5, 14),
      new MeshLambertMaterial({ color: 0x7a2a44 }),
    );
    platform.position.set(0, 0.02, level.bossZ + 6);
    this.scene.add(platform);
    this.enemyZ = level.bossZ + 6;

    for (const row of level.rows) {
      const visual: GateVisual = { panels: [], labels: [], fade: 0 };
      const sides: [number, Gate][] = [
        [-MOTION.halfRoad / 2 - 0.35, row.left],
        [MOTION.halfRoad / 2 + 0.35, row.right],
      ];
      for (const [x, gate] of sides) {
        const panel = new Mesh(
          new BoxGeometry(MOTION.halfRoad - 0.3, 3.2, 0.25),
          new MeshBasicMaterial({
            color: isPositive(gate) ? 0x2f7bff : 0xff3b4d,
            transparent: true,
            opacity: 0.62,
          }),
        );
        panel.position.set(x, 1.7, row.z);
        const label = new Mesh(
          new PlaneGeometry(2.4, 2.4),
          new MeshBasicMaterial({ map: labelTexture(gateLabel(gate)), transparent: true, side: DoubleSide }),
        );
        label.position.set(x, 1.8, row.z - 0.2);
        label.rotation.y = Math.PI;
        this.scene.add(panel, label);
        visual.panels.push(panel);
        visual.labels.push(label);
      }
      this.gates.push(visual);
    }
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    // Portrait phones are narrow, so widen the field of view to keep both gates in sight.
    this.camera.fov = this.camera.aspect < 0.8 ? 74 : 62;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  /** Place the player crowd. `x` is the steering position from -1 to 1. */
  setPlayer(x: number, z: number, count: number): void {
    this.playerCenter = { x: x * MOTION.halfRoad, z };
    this.playerCount = count;
  }

  setEnemy(visible: boolean, count: number): void {
    this.enemyVisible = visible;
    this.enemyCount = count;
  }

  /** Make a gate row fade out after the crowd passes through it. */
  passRow(row: number): void {
    const visual = this.gates[row];
    if (visual) visual.fade = 0.0001;
  }

  /** Short field-of-view kick for a big gain. */
  kickFov(amount = 10): void {
    this.fovKick = Math.max(this.fovKick, amount);
  }

  kick(): void {
    this.shake = 0.5;
  }

  /** Burst of small cubes at a point. */
  burst(x: number, z: number, color: number, amount = 14): void {
    for (let i = 0; i < amount; i += 1) {
      const size = 0.12 + Math.random() * 0.14;
      const mesh = new Mesh(this.sparkGeometry, new MeshLambertMaterial({ color }));
      mesh.scale.set(size, size, size);
      mesh.position.set(x, 0.8, z);
      this.scene.add(mesh);
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      this.sparks.push({
        mesh,
        velocity: new Vector3(Math.cos(angle) * speed, 3 + Math.random() * 4, Math.sin(angle) * speed),
        life: 0.9,
      });
    }
  }

  /** World position of the player crowd center. */
  crowdPosition(): { x: number; z: number } {
    return { ...this.playerCenter };
  }

  /** Screen position (pixels) above the crowd, for the floating counter. */
  screenAboveCrowd(): { x: number; y: number } {
    const point = new Vector3(this.playerCenter.x, 1.4, this.playerCenter.z).project(this.camera);
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height };
  }

  /** Clear transient effects and show every gate again, so a new run starts clean. */
  reset(): void {
    for (const spark of this.sparks) {
      this.scene.remove(spark.mesh);
      spark.mesh.material.dispose();
    }
    this.sparks.length = 0;
    for (const visual of this.gates) {
      visual.fade = 0;
      for (const panel of visual.panels) {
        panel.visible = true;
        panel.material.opacity = 0.62;
      }
      for (const label of visual.labels) {
        label.visible = true;
        label.material.opacity = 1;
      }
    }
    this.fovKick = 0;
    this.shake = 0;
  }

  private layoutCrowd(
    mesh: InstancedMesh<SphereGeometry, MeshLambertMaterial>,
    count: number,
    centerX: number,
    centerZ: number,
  ): void {
    const visible = Math.min(count, MAX_VISIBLE);
    mesh.count = visible;
    for (let i = 0; i < visible; i += 1) {
      const radius = 0.3 * Math.sqrt(i);
      const angle = i * GOLDEN_ANGLE;
      const bob = Math.abs(Math.sin(this.clock * 11 + i * 0.7)) * 0.16;
      this.dummy.position.set(centerX + Math.cos(angle) * radius, 0.24 + bob, centerZ + Math.sin(angle) * radius);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    this.clock += dt;

    this.layoutCrowd(this.player, this.playerCount, this.playerCenter.x, this.playerCenter.z);
    this.layoutCrowd(this.enemy, this.enemyVisible ? this.enemyCount : 0, 0, this.enemyZ);

    // Camera follows behind and above the crowd, leaning slightly with the steering.
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    this.shake = Math.max(0, this.shake - dt);
    this.camera.position.set(this.playerCenter.x * 0.45 + shakeX, 6.2 + shakeY, this.playerCenter.z - 8.5);
    this.camera.lookAt(this.playerCenter.x * 0.55, 1.2, this.playerCenter.z + 7);

    if (this.fovKick > 0.01) {
      this.fovKick *= Math.max(0, 1 - dt * 7);
      const base = this.camera.aspect < 0.8 ? 74 : 62;
      this.camera.fov = base + this.fovKick;
      this.camera.updateProjectionMatrix();
    }

    for (const visual of this.gates) {
      if (visual.fade > 0) {
        visual.fade += dt;
        const alpha = Math.max(0, 1 - visual.fade * 3.2);
        for (const panel of visual.panels) {
          panel.material.opacity = 0.62 * alpha;
          panel.visible = alpha > 0;
        }
        for (const label of visual.labels) {
          label.material.opacity = alpha;
          label.visible = alpha > 0;
        }
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i];
      if (!spark) continue;
      spark.life -= dt;
      spark.velocity.y -= 18 * dt;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      spark.mesh.rotation.x += dt * 8;
      spark.mesh.rotation.y += dt * 6;
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
