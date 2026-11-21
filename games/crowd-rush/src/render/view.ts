import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Fog,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  Scene,
  Shape,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MOTION, gateLabel, isPositive, mulberry32, type Gate, type Level } from "../game/rules.ts";

const MAX_VISIBLE = 160;
const MAX_SPARKS = 160;
const TRAIL_RUNNERS = 36;
const STREAKS = 36;
const GOLDEN_ANGLE = 2.399963;
const HORIZON = 0xcfeeff;

/** Scenery and ground colors for the three zones of the road: meadow, autumn, boss arena. */
const ZONES = [
  { road: 0x4a5778, roadAlt: 0x566486, ground: 0x62c46a, foliage: 0x3fae5a, accent: 0x2f7bff },
  { road: 0x5a4d78, roadAlt: 0x675a88, ground: 0xe3a55c, foliage: 0xf0883a, accent: 0xffb23f },
  { road: 0x3b2a45, roadAlt: 0x46344f, ground: 0x4b2540, foliage: 0x8a3fa0, accent: 0xff4458 },
] as const;

interface GateVisual {
  fadeables: Mesh<BufferGeometry, MeshBasicMaterial>[];
  baseOpacity: number[];
  fade: number;
}

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  size: number;
  life: number;
  color: Color;
}

interface Ring {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  life: number;
  max: number;
}

interface PickupSlot {
  kind: "coin" | "gem" | "recruit";
  slot: number;
  x: number;
  z: number;
  taken: boolean;
}

interface SawSlot {
  x: number;
  z: number;
  hit: number;
  angle: number;
}

function mergeSimple(parts: BufferGeometry[]): BufferGeometry {
  const prepared = parts.map((part) => (part.index ? part.toNonIndexed() : part.clone()));
  const merged = mergeGeometries(prepared, false);
  for (const part of parts) part.dispose();
  for (const part of prepared) part.dispose();
  if (!merged) throw new Error("failed to merge geometries");
  return merged;
}

function mergeColored(parts: { geometry: BufferGeometry; color: number }[]): BufferGeometry {
  const tint = new Color();
  const prepared = parts.map(({ geometry, color }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const pos = g.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    tint.setHex(color);
    for (let i = 0; i < pos.count; i += 1) {
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    g.setAttribute("color", new BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  for (const { geometry } of parts) geometry.dispose();
  for (const g of prepared) g.dispose();
  if (!merged) throw new Error("failed to merge colored geometries");
  return merged;
}

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) draw(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Draw both gate labels for a row on a single atlas canvas so a row uses one draw call. */
function rowLabelTexture(left: string, right: string): CanvasTexture {
  return canvasTexture(512, 256, (context) => {
    context.font = "800 150px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 14;
    context.strokeStyle = "rgba(10, 20, 60, 0.6)";
    context.fillStyle = "#ffffff";
    for (const [text, x] of [[left, 128], [right, 384]] as const) {
      context.strokeText(text, x, 138);
      context.fillText(text, x, 138);
    }
  });
}

function bannerTexture(text: string): CanvasTexture {
  return canvasTexture(512, 128, (context) => {
    context.fillStyle = "#1b2a63";
    context.fillRect(0, 0, 512, 128);
    context.fillStyle = "#ffe14d";
    for (let i = 0; i < 16; i += 1) context.fillRect(i * 32, i % 2 === 0 ? 0 : 118, 32, 10);
    context.font = "900 78px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.fillText(text, 256, 66);
  });
}

function glowTexture(): CanvasTexture {
  return canvasTexture(128, 128, (context) => {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.35)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  });
}

function skyTexture(): CanvasTexture {
  return canvasTexture(4, 256, (context) => {
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#3f95ff");
    gradient.addColorStop(0.55, "#8ec9ff");
    gradient.addColorStop(1, "#d8f1ff");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 256);
  });
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function roadTexture(base: number, alt: number): CanvasTexture {
  const texture = canvasTexture(128, 128, (context) => {
    context.fillStyle = hex(base);
    context.fillRect(0, 0, 128, 128);
    context.fillStyle = hex(alt);
    context.fillRect(0, 0, 128, 64);
    context.fillStyle = "rgba(255,255,255,0.55)";
    context.fillRect(0, 0, 5, 128);
    context.fillRect(123, 0, 5, 128);
    context.fillStyle = "rgba(255,255,255,0.22)";
    context.fillRect(62, 8, 4, 40);
    context.fillRect(62, 72, 4, 40);
  });
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

function groundTexture(color: number): CanvasTexture {
  const texture = canvasTexture(64, 64, (context) => {
    context.fillStyle = hex(color);
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = "rgba(255,255,255,0.1)";
    context.fillRect(0, 0, 64, 32);
  });
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** The crowd silhouette: a low-poly body and a round head, both instanced. */
function runnerGeometry(): { body: BufferGeometry; head: BufferGeometry } {
  const body = new CylinderGeometry(0.15, 0.19, 0.4, 6);
  body.translate(0, 0.2, 0);
  const head = new IcosahedronGeometry(0.15, 0);
  head.translate(0, 0.55, 0);
  return { body, head };
}

function sawGeometry(): ExtrudeGeometry {
  const shape = new Shape();
  const teeth = 14;
  for (let i = 0; i < teeth * 2; i += 1) {
    const angle = (i / (teeth * 2)) * Math.PI * 2;
    const radius = i % 2 === 0 ? 0.62 : 0.44;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
  geometry.translate(0, 0, -0.06);
  return geometry;
}

/** Owns everything Three.js for the gate runner: scene, camera, crowd, gates, hazards, boss and effects. */
export class RunView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(62, 1, 0.1, 170);
  private readonly dummy = new Object3D();
  private readonly playerBody: InstancedMesh;
  private readonly playerHead: InstancedMesh;
  private readonly trail: InstancedMesh;
  private readonly streaks: InstancedMesh;
  private readonly sparkMesh: InstancedMesh;
  private readonly sparks: Spark[] = [];
  private readonly rings: Ring[] = [];
  private readonly ringGeometry = new RingGeometry(0.6, 0.8, 28);
  private readonly gates: GateVisual[] = [];
  private pickupMeshes: { coin: InstancedMesh; gem: InstancedMesh; recruitBody: InstancedMesh; recruitHead: InstancedMesh } | null = null;
  private pickupSlots: PickupSlot[] = [];
  private sawMeshes: { blades: InstancedMesh; cores: InstancedMesh; warns: InstancedMesh; warnMaterial: MeshBasicMaterial } | null = null;
  private sawSlots: SawSlot[] = [];
  private flagMesh: InstancedMesh | null = null;
  private flagSpots: { x: number; z: number }[] = [];
  private boss: Group | null = null;
  private bossArms: Group[] = [];
  private bossMaterials: MeshLambertMaterial[] = [];
  private bossFlash = 0;
  private bossBaseZ = 0;
  private level: Level | null = null;
  private playerCenter = { x: 0, z: 0 };
  private playerCount = 0;
  private playerVelocity = 0;
  private lastX = 0;
  private fovKick = 0;
  private shake = 0;
  private clock = 0;
  private boostAmount = 0;
  private battle = 0;
  private bossAttack = 0;
  private bossDefeat = 0;
  private bossWon = false;
  private focus = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.scene.background = skyTexture();
    this.scene.fog = new Fog(HORIZON, 38, 100);

    this.scene.add(new AmbientLight(0xffffff, 1.55));
    const sun = new DirectionalLight(0xffffff, 1.9);
    sun.position.set(-5, 12, -6);
    this.scene.add(sun);

    const { body, head } = runnerGeometry();
    this.playerBody = new InstancedMesh(body, new MeshLambertMaterial({ color: 0x3da0ff }), MAX_VISIBLE);
    this.playerHead = new InstancedMesh(head, new MeshLambertMaterial({ color: 0xffd7b0 }), MAX_VISIBLE);
    for (const mesh of [this.playerBody, this.playerHead]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
    }

    this.trail = new InstancedMesh(
      new BoxGeometry(0.05, 0.03, 1),
      new MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.18, depthWrite: false }),
      TRAIL_RUNNERS,
    );
    this.streaks = new InstancedMesh(
      new BoxGeometry(0.04, 0.04, 3),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }),
      STREAKS,
    );
    this.sparkMesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 }),
      MAX_SPARKS,
    );
    for (const mesh of [this.trail, this.streaks, this.sparkMesh]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
    }

    this.resize();
    // A ResizeObserver also catches the canvas changing size inside an iframe or a phone frame.
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  /** Zone of the road at `z`: 0 meadow, 1 autumn after the halfway arch, 2 boss arena. */
  private zoneIndex(z: number): 0 | 1 | 2 {
    const level = this.level;
    if (!level || z < level.bossZ / 2) return 0;
    return z < level.bossZ - 6 ? 1 : 2;
  }

  /** Build the road, scenery, gates, hazards and boss for a level. */
  buildLevel(level: Level): void {
    this.level = level;
    const length = level.bossZ + 40;
    const start = -12;
    const roadWidth = MOTION.halfRoad * 2 + 1.6;
    const bounds = [start, level.bossZ / 2, level.bossZ - 6, start + length];

    const railGeos: BufferGeometry[] = [];
    const glowParts: { geometry: BufferGeometry; color: number }[] = [];

    for (let zone = 0; zone < 3; zone += 1) {
      const from = bounds[zone] ?? 0;
      const to = bounds[zone + 1] ?? 0;
      const span = to - from;
      const colors = ZONES[zone] ?? ZONES[0];

      const texture = roadTexture(colors.road, colors.roadAlt);
      texture.repeat.set(1, span / 8);
      const road = new Mesh(new PlaneGeometry(roadWidth, span), new MeshLambertMaterial({ map: texture }));
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0.01, from + span / 2);
      this.scene.add(road);

      const grass = groundTexture(colors.ground);
      grass.repeat.set(1, span / 6);
      const groundGeos: BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        const groundGeo = new PlaneGeometry(70, span);
        groundGeo.rotateX(-Math.PI / 2);
        groundGeo.translate(side * (roadWidth / 2 + 35), 0, from + span / 2);
        groundGeos.push(groundGeo);

        const railGeo = new BoxGeometry(0.3, 0.5, span);
        railGeo.translate(side * (MOTION.halfRoad + 1.1), 0.25, from + span / 2);
        railGeos.push(railGeo);

        const glowGeo = new BoxGeometry(0.32, 0.08, span);
        glowGeo.translate(side * (MOTION.halfRoad + 1.1), 0.52, from + span / 2);
        glowParts.push({ geometry: glowGeo, color: colors.accent });
      }
      this.scene.add(new Mesh(mergeSimple(groundGeos), new MeshLambertMaterial({ map: grass })));
    }

    this.scene.add(
      new Mesh(mergeSimple(railGeos), new MeshLambertMaterial({ color: 0xffffff })),
      new Mesh(mergeColored(glowParts), new MeshBasicMaterial({ vertexColors: true })),
    );

    this.buildScenery(level, length);
    this.buildGates(level);
    this.buildHalfwayArch(level);
    this.buildPickups(level);
    this.buildSaws(level);
    this.buildBoss(level);
  }

  private buildScenery(level: Level, length: number): void {
    const rand = mulberry32(12345);
    const reach = MOTION.halfRoad + 3.2;
    const trunkGeo = new CylinderGeometry(0.16, 0.22, 1.0, 5);
    trunkGeo.translate(0, 0.5, 0);
    const lowGeo = new ConeGeometry(0.95, 1.5, 6);
    lowGeo.translate(0, 1.6, 0);
    const topGeo = new ConeGeometry(0.65, 1.2, 6);
    topGeo.translate(0, 2.5, 0);
    const trees: { x: number; z: number; s: number; zone: number }[] = [];
    for (let z = -8; z < level.bossZ + 28; z += 4.2) {
      for (const side of [-1, 1]) {
        if (rand() < 0.22) continue;
        trees.push({ x: side * (reach + rand() * 9), z: z + rand() * 3, s: 0.8 + rand() * 0.9, zone: this.zoneIndex(z) });
      }
    }
    const trunks = new InstancedMesh(trunkGeo, new MeshLambertMaterial({ color: 0x7b5232 }), trees.length);
    const low = new InstancedMesh(lowGeo, new MeshLambertMaterial({ color: 0xffffff }), trees.length);
    const top = new InstancedMesh(topGeo, new MeshLambertMaterial({ color: 0xffffff }), trees.length);
    const tint = new Color();
    trees.forEach((tree, i) => {
      this.dummy.position.set(tree.x, 0, tree.z);
      this.dummy.rotation.set(0, rand() * 6, 0);
      this.dummy.scale.setScalar(tree.s);
      this.dummy.updateMatrix();
      trunks.setMatrixAt(i, this.dummy.matrix);
      low.setMatrixAt(i, this.dummy.matrix);
      top.setMatrixAt(i, this.dummy.matrix);
      tint.setHex((ZONES[tree.zone] ?? ZONES[0]).foliage).offsetHSL(0, 0, (rand() - 0.5) * 0.08);
      low.setColorAt(i, tint);
      top.setColorAt(i, tint);
    });
    this.dummy.scale.setScalar(1);
    this.dummy.rotation.set(0, 0, 0);
    this.scene.add(trunks, low, top);

    // Stone pillars along the rails, with a flag on every other pillar.
    const pillarZ: number[] = [];
    for (let z = 4; z < level.bossZ + 14; z += 12) pillarZ.push(z);
    const shaftGeo = new BoxGeometry(0.7, 2.6, 0.7);
    shaftGeo.translate(0, 1.3, 0);
    const capGeo = new BoxGeometry(1.0, 0.35, 1.0);
    capGeo.translate(0, 2.8, 0);
    const shafts = new InstancedMesh(shaftGeo, new MeshLambertMaterial({ color: 0xe9eef7 }), pillarZ.length * 2);
    const caps = new InstancedMesh(capGeo, new MeshLambertMaterial({ color: 0xffffff }), pillarZ.length * 2);
    let index = 0;
    const flagSpots: { x: number; z: number; zone: number }[] = [];
    pillarZ.forEach((z, k) => {
      for (const side of [-1, 1]) {
        const x = side * (MOTION.halfRoad + 2.3);
        this.dummy.position.set(x, 0, z);
        this.dummy.updateMatrix();
        shafts.setMatrixAt(index, this.dummy.matrix);
        caps.setMatrixAt(index, this.dummy.matrix);
        index += 1;
        if (k % 2 === 0) flagSpots.push({ x, z, zone: this.zoneIndex(z) });
      }
    });
    this.scene.add(shafts, caps);

    const poleGeo = new BoxGeometry(0.07, 2.2, 0.07);
    poleGeo.translate(0, 1.1, 0);
    const poles = new InstancedMesh(poleGeo, new MeshLambertMaterial({ color: 0xffffff }), flagSpots.length);
    flagSpots.forEach((flag, i) => {
      this.dummy.position.set(flag.x, 2.95, flag.z);
      this.dummy.updateMatrix();
      poles.setMatrixAt(i, this.dummy.matrix);
    });
    this.scene.add(poles);
    const flagGeo = new PlaneGeometry(0.9, 0.5);
    flagGeo.translate(0.45, 0, 0);
    const flagMesh = new InstancedMesh(
      flagGeo,
      new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide }),
      flagSpots.length,
    );
    flagMesh.frustumCulled = false;
    this.flagSpots = flagSpots.map((flag, i) => {
      tint.setHex((ZONES[flag.zone] ?? ZONES[0]).accent);
      flagMesh.setColorAt(i, tint);
      this.dummy.position.set(flag.x, 4.9, flag.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      flagMesh.setMatrixAt(i, this.dummy.matrix);
      return { x: flag.x, z: flag.z };
    });
    if (flagMesh.instanceColor) flagMesh.instanceColor.needsUpdate = true;
    this.scene.add(flagMesh);
    this.flagMesh = flagMesh;

    // Far hills give the horizon some depth.
    const hillGeo = new ConeGeometry(1, 1, 7);
    const hillSpecs: { x: number; y: number; z: number; sx: number; sy: number; sz: number; color: number }[] = [];
    for (let z = 0; z < length; z += 26) {
      for (const side of [-1, 1]) {
        const h = 9 + rand() * 12;
        hillSpecs.push({
          sx: 10 + rand() * 8,
          sy: h,
          sz: 10 + rand() * 8,
          x: side * (34 + rand() * 18),
          y: h / 2 - 1,
          z: z + rand() * 10,
          color: (ZONES[this.zoneIndex(z)] ?? ZONES[0]).foliage,
        });
      }
    }
    const hills = new InstancedMesh(
      hillGeo,
      new MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      hillSpecs.length,
    );
    hills.frustumCulled = false;
    hillSpecs.forEach((hill, i) => {
      this.dummy.position.set(hill.x, hill.y, hill.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(hill.sx, hill.sy, hill.sz);
      this.dummy.updateMatrix();
      hills.setMatrixAt(i, this.dummy.matrix);
      tint.setHex(hill.color);
      hills.setColorAt(i, tint);
    });
    if (hills.instanceColor) hills.instanceColor.needsUpdate = true;
    this.dummy.scale.setScalar(1);
    this.scene.add(hills);
  }

  private buildGates(level: Level): void {
    const glow = glowTexture();
    for (const row of level.rows) {
      const visual: GateVisual = { fadeables: [], baseOpacity: [], fade: 0 };
      const sides: [number, Gate, number][] = [
        [-MOTION.halfRoad / 2 - 0.35, row.left, 0],
        [MOTION.halfRoad / 2 + 0.35, row.right, 0.5],
      ];
      const frameParts: { geometry: BufferGeometry; color: number }[] = [];
      const padParts: { geometry: BufferGeometry; color: number }[] = [];
      const haloParts: { geometry: BufferGeometry; color: number }[] = [];
      const panelParts: { geometry: BufferGeometry; color: number }[] = [];
      const labelGeos: BufferGeometry[] = [];

      for (const [x, gate, uOffset] of sides) {
        const good = isPositive(gate);
        const color = good ? 0x2f7bff : 0xff3b4d;
        const frameColor = good ? 0x7cc4ff : 0xff8794;

        for (const edge of [-1, 1]) {
          const post = new BoxGeometry(0.26, 3.7, 0.26);
          post.translate(x + edge * (MOTION.halfRoad / 2 - 0.1), 1.85, row.z);
          frameParts.push({ geometry: post, color: frameColor });
        }
        const beam = new BoxGeometry(MOTION.halfRoad - 0.1, 0.28, 0.3);
        beam.translate(x, 3.75, row.z);
        frameParts.push({ geometry: beam, color: frameColor });

        // A tinted pad on the road shows the lane before the gate is close.
        const padGeo = new PlaneGeometry(MOTION.halfRoad - 0.2, 4);
        padGeo.rotateX(-Math.PI / 2);
        padGeo.translate(x, 0.03, row.z - 1.2);
        padParts.push({ geometry: padGeo, color });

        const haloGeo = new PlaneGeometry(MOTION.halfRoad + 1.6, 5.6);
        haloGeo.rotateY(Math.PI);
        haloGeo.translate(x, 2.1, row.z + 0.15);
        haloParts.push({ geometry: haloGeo, color });

        const panelGeo = new BoxGeometry(MOTION.halfRoad - 0.5, 3.2, 0.2);
        panelGeo.translate(x, 1.95, row.z);
        panelParts.push({ geometry: panelGeo, color });

        const labelGeo = new PlaneGeometry(2.4, 2.4);
        const uv = labelGeo.getAttribute("uv");
        for (let i = 0; i < uv.count; i += 1) uv.setX(i, uv.getX(i) * 0.5 + uOffset);
        labelGeo.rotateY(Math.PI);
        labelGeo.translate(x, 2.0, row.z - 0.2);
        labelGeos.push(labelGeo);
      }

      const frames = new Mesh(
        mergeColored(frameParts),
        new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }),
      );
      const pads = new Mesh(
        mergeColored(padParts),
        new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false }),
      );
      const halos = new Mesh(
        mergeColored(haloParts),
        new MeshBasicMaterial({
          map: glow,
          vertexColors: true,
          transparent: true,
          opacity: 0.55,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      const panels = new Mesh(
        mergeColored(panelParts),
        new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }),
      );
      const labels = new Mesh(
        mergeSimple(labelGeos),
        new MeshBasicMaterial({
          map: rowLabelTexture(gateLabel(row.left), gateLabel(row.right)),
          transparent: true,
          side: DoubleSide,
        }),
      );
      this.scene.add(frames, pads, halos, panels, labels);
      for (const mesh of [halos, panels, labels, pads, frames]) {
        visual.fadeables.push(mesh);
        visual.baseOpacity.push(mesh.material.opacity);
      }
      this.gates.push(visual);
    }
  }

  private buildHalfwayArch(level: Level): void {
    const z = level.bossZ / 2;
    const postGeos = [-1, 1].map((side) => {
      const geo = new BoxGeometry(0.5, 5, 0.5);
      geo.translate(side * (MOTION.halfRoad + 0.9), 2.5, z);
      return geo;
    });
    this.scene.add(new Mesh(mergeSimple(postGeos), new MeshBasicMaterial({ color: 0xffe14d })));
    const banner = new Mesh(
      new PlaneGeometry(MOTION.halfRoad * 2 + 1.6, 1.1),
      new MeshBasicMaterial({ map: bannerTexture("HALFWAY"), side: DoubleSide }),
    );
    banner.position.set(0, 5.6, z);
    banner.rotation.y = Math.PI;
    this.scene.add(banner);
  }

  private buildPickups(level: Level): void {
    const pickups = level.pickups ?? [];
    const countOf = (kind: string): number => Math.max(1, pickups.filter((p) => p.kind === kind).length);
    const coinGeo = new CylinderGeometry(0.3, 0.3, 0.07, 12);
    coinGeo.rotateX(Math.PI / 2);
    const coin = new InstancedMesh(coinGeo, new MeshLambertMaterial({ color: 0xffd23f, emissive: 0x996600 }), countOf("coin"));
    const gem = new InstancedMesh(new OctahedronGeometry(0.34, 0), new MeshLambertMaterial({ color: 0x66f0ff, emissive: 0x0b7a99 }), countOf("gem"));
    const { body, head } = runnerGeometry();
    const recruitBody = new InstancedMesh(body, new MeshLambertMaterial({ color: 0x59ff9a, emissive: 0x138a48 }), countOf("recruit"));
    const recruitHead = new InstancedMesh(head, new MeshLambertMaterial({ color: 0xffffff, emissive: 0x555555 }), countOf("recruit"));
    for (const mesh of [coin, gem, recruitBody, recruitHead]) {
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
    this.pickupMeshes = { coin, gem, recruitBody, recruitHead };
    const next = { coin: 0, gem: 0, recruit: 0 };
    this.pickupSlots = pickups.map((p) => ({ kind: p.kind, slot: next[p.kind]++, x: p.x * MOTION.halfRoad, z: p.z, taken: false }));
    coin.count = next.coin;
    gem.count = next.gem;
    recruitBody.count = next.recruit;
    recruitHead.count = next.recruit;
  }

  private buildSaws(level: Level): void {
    const saws = level.saws ?? [];
    this.sawSlots = saws.map((saw) => ({ x: saw.x * MOTION.halfRoad, z: saw.z, hit: 0, angle: 0 }));
    if (saws.length === 0) return;
    const bladeGeo = sawGeometry();
    const coreGeo = new CylinderGeometry(0.16, 0.16, 0.2, 10);
    coreGeo.rotateX(Math.PI / 2);
    const warnGeo = new RingGeometry(0.75, 1.0, 24);
    warnGeo.rotateX(-Math.PI / 2);
    const warnMaterial = new MeshBasicMaterial({
      color: 0xff3b4d,
      transparent: true,
      opacity: 0.6,
      side: DoubleSide,
      depthWrite: false,
    });
    const blades = new InstancedMesh(bladeGeo, new MeshLambertMaterial({ color: 0xd6deee, emissive: 0x1b2540 }), saws.length);
    const cores = new InstancedMesh(coreGeo, new MeshLambertMaterial({ color: 0xff3b4d, emissive: 0x991a28 }), saws.length);
    const warns = new InstancedMesh(warnGeo, warnMaterial, saws.length);
    for (const mesh of [blades, cores, warns]) {
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
    this.sawMeshes = { blades, cores, warns, warnMaterial };
  }

  private buildBoss(level: Level): void {
    const arena = new Mesh(new BoxGeometry(MOTION.halfRoad * 2 + 4, 0.5, 16), new MeshLambertMaterial({ color: 0x7a2a44 }));
    arena.position.set(0, 0.02, level.bossZ + 7);
    this.scene.add(arena);
    const rune = new Mesh(
      new RingGeometry(2.4, 2.8, 28),
      new MeshBasicMaterial({ color: 0xff4458, transparent: true, opacity: 0.6, side: DoubleSide }),
    );
    rune.rotation.x = -Math.PI / 2;
    rune.position.set(0, 0.3, level.bossZ + 8);
    this.scene.add(rune);

    const body = new MeshLambertMaterial({ color: 0xc4283f });
    const dark = new MeshLambertMaterial({ color: 0x6d1226 });
    const belly = new MeshLambertMaterial({ color: 0xff8a8a });
    this.bossMaterials = [body, dark, belly];
    const eyes = new MeshBasicMaterial({ color: 0xffe14d });
    const horn = new MeshLambertMaterial({ color: 0xf4ecd8 });

    const boss = new Group();
    const placed = (geo: BufferGeometry, x: number, y: number, z: number, rz = 0): BufferGeometry => {
      if (rz !== 0) geo.rotateZ(rz);
      geo.translate(x, y, z);
      return geo;
    };
    boss.add(
      new Mesh(mergeSimple([placed(new BoxGeometry(2.4, 2.6, 1.6), 0, 2.5, 0), placed(new BoxGeometry(1.6, 1.4, 1.4), 0, 4.7, 0)]), body),
      new Mesh(placed(new BoxGeometry(1.7, 1.5, 0.12), 0, 2.3, -0.82), belly),
      new Mesh(mergeSimple([placed(new BoxGeometry(0.34, 0.24, 0.1), -0.38, 4.85, -0.72), placed(new BoxGeometry(0.34, 0.24, 0.1), 0.38, 4.85, -0.72)]), eyes),
      new Mesh(
        mergeSimple([
          placed(new BoxGeometry(1.0, 0.18, 0.1), 0, 4.3, -0.72),
          placed(new BoxGeometry(1.7, 0.2, 0.12), 0, 5.2, -0.72),
          placed(new BoxGeometry(0.85, 1.4, 0.95), -0.6, 0.7, 0),
          placed(new BoxGeometry(0.85, 1.4, 0.95), 0.6, 0.7, 0),
        ]),
        dark,
      ),
      new Mesh(
        mergeSimple([
          placed(new ConeGeometry(0.28, 1.0, 6), -0.62, 5.8, 0, 0.3),
          placed(new ConeGeometry(0.28, 1.0, 6), 0.62, 5.8, 0, -0.3),
        ]),
        horn,
      ),
    );
    for (const side of [-1, 1]) {
      const arm = new Group();
      arm.position.set(side * 1.7, 3.5, 0);
      const upper = new Mesh(new BoxGeometry(0.7, 1.9, 0.7), body);
      upper.position.y = -0.9;
      const fist = new Mesh(new BoxGeometry(1.0, 1.0, 1.0), dark);
      fist.position.y = -2.1;
      arm.add(upper, fist);
      boss.add(arm);
      this.bossArms.push(arm);
    }
    this.bossBaseZ = level.bossZ + 8;
    boss.position.set(0, 0.2, this.bossBaseZ);
    this.scene.add(boss);
    this.boss = boss;
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    // Portrait phones are narrow, so widen the field of view to keep both gates in sight.
    this.camera.fov = this.baseFov();
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  private baseFov(): number {
    return this.camera.aspect < 0.8 ? 74 : 62;
  }

  /** Place the player crowd. `x` is the steering position from -1 to 1. */
  setPlayer(x: number, z: number, count: number): void {
    this.playerCenter = { x: x * MOTION.halfRoad, z };
    this.playerCount = count;
  }

  /** Strength of the speed boost from 0 to 1, for the speed lines and the camera pull. */
  setBoost(amount: number): void {
    this.boostAmount = amount;
  }

  /**
   * Boss state. `attack` 0 to 1 swings the arms, `defeat` 0 to 1 plays the fall,
   * `won` makes the boss celebrate, `battle` 0 to 1 pulls the crowd into the fight.
   */
  setBoss(attack: number, defeat: number, won: boolean, battle: number): void {
    this.bossAttack = attack;
    this.bossDefeat = defeat;
    this.bossWon = won;
    this.battle = battle;
  }

  /** Move the camera toward the fight, from 0 (run) to 1 (fight). */
  setFocus(amount: number): void {
    this.focus = amount;
  }

  flashBoss(): void {
    this.bossFlash = 1;
  }

  /** Make a gate row fade out after the crowd passes through it. */
  passRow(row: number): void {
    const visual = this.gates[row];
    if (visual) visual.fade = 0.0001;
  }

  /** Remove a collected pickup from the road. */
  collectPickup(index: number): void {
    const slot = this.pickupSlots[index];
    if (slot) slot.taken = true;
  }

  /** Pop a saw that was hit. */
  hitSaw(index: number): void {
    const saw = this.sawSlots[index];
    if (saw) saw.hit = 0.0001;
  }

  /** Short field-of-view kick for a big gain. */
  kickFov(amount = 10): void {
    this.fovKick = Math.max(this.fovKick, amount);
  }

  kick(strength = 0.5): void {
    this.shake = Math.max(this.shake, strength);
  }

  /** Burst of small cubes at a point. */
  burst(x: number, z: number, color: number, amount = 14, y = 0.8): void {
    const tint = new Color(color);
    for (let i = 0; i < amount; i += 1) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      this.sparks.push({
        x,
        y,
        z,
        vx: Math.cos(angle) * speed,
        vy: 3 + Math.random() * 4,
        vz: Math.sin(angle) * speed,
        rx: 0,
        ry: 0,
        size: 0.1 + Math.random() * 0.14,
        life: 0.9,
        color: tint,
      });
    }
  }

  /** Expanding ring on the road, for gates and big hits. */
  shockwave(x: number, z: number, color: number, size = 4): void {
    const mesh = new Mesh(
      this.ringGeometry,
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.5, max: size });
  }

  /** World position of the player crowd center. */
  crowdPosition(): { x: number; z: number } {
    return { ...this.playerCenter };
  }

  private project(x: number, y: number, z: number): { x: number; y: number } {
    const point = new Vector3(x, y, z).project(this.camera);
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height };
  }

  /** Screen position (pixels) above the crowd, for the floating counter. */
  screenAboveCrowd(): { x: number; y: number } {
    return this.project(this.playerCenter.x, 1.4, this.playerCenter.z);
  }

  /** Screen position above the boss head, for the boss label. */
  screenAboveBoss(): { x: number; y: number } {
    return this.project(0, 7.4, this.bossBaseZ);
  }

  /** Clear transient effects and show every gate, pickup and saw again, so a new run starts clean. */
  reset(): void {
    this.sparks.length = 0;
    this.sparkMesh.count = 0;
    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      ring.mesh.material.dispose();
    }
    this.rings.length = 0;
    for (const visual of this.gates) {
      visual.fade = 0;
      visual.fadeables.forEach((mesh, i) => {
        mesh.visible = true;
        mesh.material.opacity = visual.baseOpacity[i] ?? 1;
      });
    }
    for (const slot of this.pickupSlots) slot.taken = false;
    for (const saw of this.sawSlots) saw.hit = 0;
    this.fovKick = 0;
    this.shake = 0;
    this.boostAmount = 0;
    this.battle = 0;
    this.bossAttack = 0;
    this.bossDefeat = 0;
    this.bossWon = false;
    this.focus = 0;
    this.playerVelocity = 0;
  }

  private layoutCrowd(count: number, centerX: number, centerZ: number): void {
    const visible = Math.min(Math.round(count), MAX_VISIBLE);
    this.playerBody.count = visible;
    this.playerHead.count = visible;
    const trailCount = Math.min(visible, TRAIL_RUNNERS);
    this.trail.count = this.battle === 0 ? trailCount : 0;
    const lean = 0.2 + this.boostAmount * 0.2 + this.battle * 0.25;
    const roll = Math.max(-0.5, Math.min(0.5, -this.playerVelocity * 0.06));
    const stretch = 0.5 + this.boostAmount * 1.6;

    for (let i = 0; i < visible; i += 1) {
      const radius = 0.3 * Math.sqrt(i);
      const angle = i * GOLDEN_ANGLE;
      const phase = this.clock * 11 + i * 0.7;
      const bob = Math.abs(Math.sin(phase)) * 0.14;
      const lunge = this.battle > 0 ? Math.max(0, Math.sin(this.clock * 15 + i * 1.3)) * 0.22 : 0;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      this.dummy.position.set(x, bob, z + lunge);
      this.dummy.rotation.set(lean + Math.sin(phase) * 0.08, 0, roll);
      this.dummy.scale.set(1, 1 + bob * 0.5, 1);
      this.dummy.updateMatrix();
      // The head is part of the body geometry offset, so one matrix tilts both together.
      this.playerBody.setMatrixAt(i, this.dummy.matrix);
      this.playerHead.setMatrixAt(i, this.dummy.matrix);

      if (i < trailCount) {
        this.dummy.position.set(x, 0.25 + bob * 0.5, z - 0.35 - stretch / 2);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, stretch);
        this.dummy.updateMatrix();
        this.trail.setMatrixAt(i, this.dummy.matrix);
      }
    }
    this.dummy.scale.setScalar(1);
    this.dummy.rotation.set(0, 0, 0);
    this.playerBody.instanceMatrix.needsUpdate = true;
    this.playerHead.instanceMatrix.needsUpdate = true;
    this.trail.instanceMatrix.needsUpdate = true;
  }

  private updatePickups(): void {
    const meshes = this.pickupMeshes;
    if (!meshes) return;
    const hidden = 0.0001;
    for (const pickup of this.pickupSlots) {
      const spin = this.clock * 3 + pickup.z;
      this.dummy.position.set(pickup.x, 0.55 + Math.sin(this.clock * 4 + pickup.z) * 0.08, pickup.z);
      if (pickup.kind === "coin") {
        this.dummy.rotation.set(0, spin, 0);
        this.dummy.scale.setScalar(pickup.taken ? hidden : 1);
        this.dummy.updateMatrix();
        meshes.coin.setMatrixAt(pickup.slot, this.dummy.matrix);
      } else if (pickup.kind === "gem") {
        this.dummy.rotation.set(0, spin, 0.3);
        this.dummy.scale.setScalar(pickup.taken ? hidden : 1.15);
        this.dummy.updateMatrix();
        meshes.gem.setMatrixAt(pickup.slot, this.dummy.matrix);
      } else {
        this.dummy.position.y = 0.12 + Math.abs(Math.sin(this.clock * 6 + pickup.z)) * 0.18;
        this.dummy.rotation.set(0.15, 0, 0);
        this.dummy.scale.setScalar(pickup.taken ? hidden : 1.6);
        this.dummy.updateMatrix();
        meshes.recruitBody.setMatrixAt(pickup.slot, this.dummy.matrix);
        meshes.recruitHead.setMatrixAt(pickup.slot, this.dummy.matrix);
      }
    }
    this.dummy.scale.setScalar(1);
    this.dummy.rotation.set(0, 0, 0);
    meshes.coin.instanceMatrix.needsUpdate = true;
    meshes.gem.instanceMatrix.needsUpdate = true;
    meshes.recruitBody.instanceMatrix.needsUpdate = true;
    meshes.recruitHead.instanceMatrix.needsUpdate = true;
  }

  private updateBoss(dt: number): void {
    const boss = this.boss;
    if (!boss) return;
    this.bossFlash = Math.max(0, this.bossFlash - dt * 6);
    // A hit flash tints the boss warm white for a moment, without bleaching its colors.
    for (const material of this.bossMaterials) material.emissive.setRGB(this.bossFlash * 0.55, this.bossFlash * 0.3, this.bossFlash * 0.25);

    const breathe = 1 + Math.sin(this.clock * 2.4) * 0.012;
    const fall = this.bossDefeat;
    const hop = this.bossWon ? Math.abs(Math.sin(this.clock * 7)) * 0.7 : 0;
    boss.position.set(0, 0.2 + hop - fall * fall * 1.2, this.bossBaseZ + fall * 3);
    boss.rotation.set(-fall * 1.3, 0, Math.sin(this.clock * 30) * 0.03 * this.bossFlash);
    boss.scale.setScalar(breathe * (1 - fall * 0.35));
    this.bossArms.forEach((arm, i) => {
      const swing = Math.sin(this.clock * 13 + i * Math.PI) * 1.1 * this.bossAttack;
      const raised = this.bossWon ? -2.6 + Math.sin(this.clock * 9 + i) * 0.4 : 0;
      arm.rotation.x = -Math.abs(swing) + raised;
    });
  }

  update(dt: number): void {
    this.clock += dt;
    const velocity = dt > 0 ? (this.playerCenter.x - this.lastX) / dt : 0;
    this.playerVelocity += (velocity - this.playerVelocity) * Math.min(1, dt * 10);
    this.lastX = this.playerCenter.x;

    this.layoutCrowd(this.playerCount, this.playerCenter.x, this.playerCenter.z);
    this.updatePickups();
    this.updateBoss(dt);

    // Camera follows behind and above the crowd, leaning slightly with the steering.
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    this.shake = Math.max(0, this.shake - dt);
    const pull = this.boostAmount * 1.4 - this.focus * 0.4;
    this.camera.position.set(
      this.playerCenter.x * 0.45 + shakeX,
      6.2 + this.focus * 1.4 + shakeY,
      this.playerCenter.z - 8.5 - pull,
    );
    this.camera.lookAt(this.playerCenter.x * 0.55, 1.2 + this.focus, this.playerCenter.z + 7 - this.focus * 1.5);

    if (this.fovKick > 0.01) this.fovKick *= Math.max(0, 1 - dt * 7);
    else this.fovKick = 0;
    const fov = this.baseFov() + this.fovKick + this.boostAmount * 8;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.updateStreaks();
    this.updateGates(dt);
    this.updateSaws(dt);
    this.updateFlags();
    this.updateEffects(dt);
  }

  private updateStreaks(): void {
    const active = this.boostAmount > 0.03;
    this.streaks.count = active ? STREAKS : 0;
    if (!active) return;
    for (let i = 0; i < STREAKS; i += 1) {
      const seedX = Math.sin(i * 12.9898) * 43758.5453;
      const seedY = Math.sin(i * 78.233) * 12345.678;
      const x = (seedX - Math.floor(seedX) - 0.5) * 12;
      const y = 0.5 + (seedY - Math.floor(seedY)) * 5;
      const along = (i * 1.7 + this.clock * 38) % 22;
      this.dummy.position.set(this.camera.position.x + x, y, this.camera.position.z + 2 + along);
      this.dummy.scale.set(1, 1, 0.6 + this.boostAmount);
      this.dummy.updateMatrix();
      this.streaks.setMatrixAt(i, this.dummy.matrix);
    }
    this.dummy.scale.setScalar(1);
    this.streaks.instanceMatrix.needsUpdate = true;
    (this.streaks.material as MeshBasicMaterial).opacity = 0.5 * Math.min(1, this.boostAmount * 1.5);
  }

  private updateGates(dt: number): void {
    for (const visual of this.gates) {
      if (visual.fade <= 0) continue;
      visual.fade += dt;
      const alpha = Math.max(0, 1 - visual.fade * 3.2);
      visual.fadeables.forEach((mesh, i) => {
        mesh.material.opacity = (visual.baseOpacity[i] ?? 1) * alpha;
        mesh.visible = alpha > 0;
      });
    }
  }

  private updateSaws(dt: number): void {
    const meshes = this.sawMeshes;
    if (!meshes) return;
    meshes.warnMaterial.opacity = 0.35 + (Math.sin(this.clock * 7) + 1) * 0.2;
    this.sawSlots.forEach((saw, i) => {
      if (saw.hit > 0) {
        saw.hit += dt;
        const scale = Math.max(0.0001, 1 - saw.hit * 4);
        this.dummy.position.set(saw.x, 0.66, saw.z);
        this.dummy.rotation.set(0, 0, saw.angle);
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();
        meshes.blades.setMatrixAt(i, this.dummy.matrix);
        meshes.cores.setMatrixAt(i, this.dummy.matrix);

        this.dummy.position.set(saw.x, 0.04, saw.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(scale > 0.001 ? 1 : 0.0001);
        this.dummy.updateMatrix();
        meshes.warns.setMatrixAt(i, this.dummy.matrix);
      } else {
        saw.angle -= dt * 16;
        const y = 0.66 + Math.sin(this.clock * 5 + saw.z) * 0.03;
        this.dummy.position.set(saw.x, y, saw.z);
        this.dummy.rotation.set(0, 0, saw.angle);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        meshes.blades.setMatrixAt(i, this.dummy.matrix);
        meshes.cores.setMatrixAt(i, this.dummy.matrix);

        this.dummy.position.set(saw.x, 0.04, saw.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        meshes.warns.setMatrixAt(i, this.dummy.matrix);
      }
    });
    this.dummy.scale.setScalar(1);
    this.dummy.rotation.set(0, 0, 0);
    meshes.blades.instanceMatrix.needsUpdate = true;
    meshes.cores.instanceMatrix.needsUpdate = true;
    meshes.warns.instanceMatrix.needsUpdate = true;
  }

  private updateFlags(): void {
    const mesh = this.flagMesh;
    if (!mesh) return;
    this.flagSpots.forEach((spot, i) => {
      this.dummy.position.set(spot.x, 4.9, spot.z);
      this.dummy.rotation.set(0, Math.sin(this.clock * 5 + i) * 0.5, 0);
      this.dummy.scale.set(0.85 + Math.sin(this.clock * 7 + i * 1.7) * 0.15, 1, 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.dummy.scale.setScalar(1);
    this.dummy.rotation.set(0, 0, 0);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private updateEffects(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i];
      if (!spark) continue;
      spark.life -= dt;
      if (spark.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      spark.vy -= 18 * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.z += spark.vz * dt;
      spark.rx += dt * 8;
      spark.ry += dt * 6;
    }
    this.sparkMesh.count = this.sparks.length;
    if (this.sparks.length > 0) {
      this.sparks.forEach((spark, i) => {
        this.dummy.position.set(spark.x, spark.y, spark.z);
        this.dummy.rotation.set(spark.rx, spark.ry, 0);
        this.dummy.scale.setScalar(spark.size);
        this.dummy.updateMatrix();
        this.sparkMesh.setMatrixAt(i, this.dummy.matrix);
        this.sparkMesh.setColorAt(i, spark.color);
      });
      this.dummy.scale.setScalar(1);
      this.dummy.rotation.set(0, 0, 0);
      this.sparkMesh.instanceMatrix.needsUpdate = true;
      if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
    }
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const ring = this.rings[i];
      if (!ring) continue;
      ring.life -= dt;
      const t = 1 - Math.max(0, ring.life) / 0.5;
      ring.mesh.scale.setScalar(0.3 + t * ring.max);
      ring.mesh.material.opacity = 0.8 * (1 - t);
      if (ring.life <= 0) {
        this.scene.remove(ring.mesh);
        ring.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
