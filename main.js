import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { architect, projects } from './data/projects.js';

// ─── Parámetros del edificio ───────────────────────────────────────────────
const L = 10;            // longitud de cada tramo (un proyecto por tramo)
const W = 7;             // ancho interior de la galería
const H = 4.2;           // altura libre
const N = projects.length;
const HALL_END = -N * L; // z del muro de fondo
const INTRO = 0.16;      // fracción del scroll dedicada a la llegada desde fuera
const EYE = 1.7;

// ─── Render básico ─────────────────────────────────────────────────────────
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const BG = new THREE.Color('#212830'); // "model space" oscuro de AutoCAD
scene.background = BG;
scene.fog = new THREE.Fog(BG, 30, 95);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 250);

scene.add(new THREE.HemisphereLight('#ffffff', '#d9d2c4', 1.3));
const sun = new THREE.DirectionalLight('#fff3dc', 2.4);
sun.position.set(14, 26, 6);
sun.target.position.set(0, 0, -28);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 120 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

// ─── Utilidades ────────────────────────────────────────────────────────────
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Caja con el origen en la base (para poder "crecer" escalando en Y)
function box(w, h, d, mat) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ─── Materiales ────────────────────────────────────────────────────────────
const mat = {
  slab: new THREE.MeshStandardMaterial({ color: '#c9c4ba', roughness: 0.85 }),
  floor: new THREE.MeshStandardMaterial({ color: '#b8b1a5', roughness: 0.55 }),
  wall: new THREE.MeshStandardMaterial({ color: '#f2efe9', roughness: 0.95 }),
  concrete: new THREE.MeshStandardMaterial({ color: '#a9a49b', roughness: 0.9 }),
  dark: new THREE.MeshStandardMaterial({ color: '#232321', roughness: 0.6 }),
  glow: new THREE.MeshStandardMaterial({ color: '#fff8e8', emissive: '#fff1cf', emissiveIntensity: 1.6 }),
};
const ghostMat = new THREE.LineBasicMaterial({ color: '#4fc3f7', transparent: true, opacity: 0.55 });

// Suelo estilo AutoCAD: plano oscuro (recibe sombras) + rejilla menor/mayor + ejes X/Y
const GROUND_Y = -0.31;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: '#262e38', roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = GROUND_Y - 0.005;
ground.receiveShadow = true;
scene.add(ground);

const gridMinor = new THREE.GridHelper(400, 400, '#323b47', '#323b47');
const gridMajor = new THREE.GridHelper(400, 80, '#46515f', '#46515f');
gridMinor.position.y = GROUND_Y;
gridMajor.position.y = GROUND_Y + 0.002;
scene.add(gridMinor, gridMajor);

function axisLine(color, a, b) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
  l.position.y = GROUND_Y + 0.004;
  scene.add(l);
}
// En la web la galería avanza en -Z; para el lector de coordenadas Y = -Z (como en planta)
axisLine('#e5484d', new THREE.Vector3(-200, 0, 0), new THREE.Vector3(200, 0, 0)); // X rojo
axisLine('#46a758', new THREE.Vector3(0, 0, 200), new THREE.Vector3(0, 0, -200)); // Y verde

// ─── Imágenes procedurales de proyecto (dummy) ─────────────────────────────
// En la versión real se sustituye por: new THREE.TextureLoader().load(p.image)
function projectTexture(p, idx) {
  return canvasTexture(1024, 720, (g, w, h) => {
    const r = rng(idx * 977 + 13);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, p.palette[0]); sky.addColorStop(1, p.palette[1]);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const horizon = 520;
    g.fillStyle = p.palette[2]; g.fillRect(0, horizon, w, h - horizon);

    const tall = p.kind === 'torre';
    const blocks = tall ? 2 : 3 + Math.floor(r() * 3);
    let x = 140 + r() * 120;
    for (let b = 0; b < blocks; b++) {
      const bw = tall ? 180 + r() * 60 : 140 + r() * 220;
      const bh = tall ? 300 + r() * 120 : 70 + r() * 150;
      const lift = b > 0 && r() < 0.45 ? 40 + r() * 70 : 0; // voladizos
      const y = horizon - bh - lift;
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.fillRect(x + 14, y + 14, bw, bh);
      g.fillStyle = b % 2 ? '#ffffff' : p.palette[3];
      g.fillRect(x, y, bw, bh);
      g.fillStyle = 'rgba(30,40,50,.55)';
      const rows = Math.max(1, Math.floor(bh / 46));
      for (let row = 0; row < rows; row++) {
        const wy = y + 16 + row * 46;
        if (r() < 0.5) g.fillRect(x + 12, wy, bw - 24, 18);
        else for (let c = x + 12; c < x + bw - 30; c += 38) g.fillRect(c, wy, 22, 26);
      }
      if (lift) { g.fillStyle = '#555'; g.fillRect(x + bw * 0.3, y + bh, 8, lift); }
      x += bw * (0.55 + r() * 0.4);
      if (x > w - 200) break;
    }
    // árboles
    for (let t = 0; t < 7; t++) {
      g.fillStyle = `rgba(70,90,60,${0.35 + r() * 0.3})`;
      g.beginPath(); g.arc(r() * w, horizon - 10 + r() * 30, 18 + r() * 26, 0, Math.PI * 2); g.fill();
    }
  });
}

function plaqueTexture(p, idx) {
  return canvasTexture(640, 200, (g, w, h) => {
    g.fillStyle = '#faf9f6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a6ea5'; g.font = '600 26px Inter, sans-serif';
    g.fillText(String(idx + 1).padStart(2, '0'), 28, 52);
    g.fillStyle = '#1d1d1b'; g.font = '600 40px Inter, sans-serif';
    g.fillText(p.title, 28, 112);
    g.fillStyle = '#6d6a63'; g.font = '26px Inter, sans-serif';
    g.fillText(`${p.location} · ${p.year} · ${p.type}`, 28, 160);
  });
}

function bigNumberTexture(n) {
  return canvasTexture(512, 300, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(29,29,27,.14)';
    g.font = '600 260px Inter, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(String(n).padStart(2, '0'), 20, h / 2 + 10);
  });
}

// ─── Modelo de Blender (models/gallery.glb) ────────────────────────────────
// Generado con blender/build_gallery.py. Cada pieza es un nodo "seg{i}_{pieza}"
// con origen en su base; aquí sólo decidimos CÓMO se monta cada tipo de pieza.
// ?model=0 en la URL fuerza la versión de cajas para comparar.
const useModel = new URLSearchParams(location.search).get('model') !== '0';
const modelNodes = new Map();
const trees = [];
if (useModel) {
  try {
    const gltf = await new GLTFLoader().loadAsync('models/gallery.glb');
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.name === 'leaves') {
        // hojas: recorte por alfa (nítido, con sombras recortadas y sin problemas de orden)
        Object.assign(o.material, { alphaTest: 0.5, transparent: false, depthWrite: true, side: THREE.DoubleSide });
      }
      const glass = o.material.name === 'glass';
      o.castShadow = !glass; // el sol atraviesa vidrios y lucernario
      o.receiveShadow = true;
      if (glass) o.material.depthWrite = false;
    });
    for (const child of [...gltf.scene.children]) modelNodes.set(child.name, child);
    for (const [name, node] of modelNodes) {
      if (!name.startsWith('site_')) continue;
      scene.add(node);
      if (name.startsWith('site_tree')) trees.push({ node, phase: Math.random() * 10 });
    }
  } catch (err) {
    console.warn('No se pudo cargar el modelo; uso cajas', err);
  }
}
const hasModelSegment = (i) => modelNodes.has(`seg${i}_slab`);

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const MODEL_ANIM = {
  slab: () => ({ a: 0, b: 0.22, from: { scale: V(1, 1, 0.001) } }),
  floor: () => ({ a: 0.12, b: 0.32, from: { scale: V(0.001, 1, 1) } }),
  col: ({ k }) => ({ a: 0.15 + k * 0.05, b: 0.38 + k * 0.05, from: { scale: V(1, 0.001, 1) } }),
  wall: ({ sx, side }) => { const a = sx === side ? 0.28 : 0.36; return { a, b: a + 0.24, from: { scale: V(1, 0.001, 1) } }; },
  roof: ({ sx }) => { const a = 0.55 + (sx === 1 ? 0.06 : 0); return { a, b: a + 0.2, from: { offset: V(0, 6, 0) } }; },
  beam: () => ({ a: 0.62, b: 0.8, from: { offset: V(0, 6, 0) } }),
  skylight: () => ({ a: 0.7, b: 0.88, from: { offset: V(0, 6, 0) } }),
  canopy: () => ({ a: 0.6, b: 0.85, from: { offset: V(0, 0, 6), scale: V(1, 1, 0.001) } }),
  bench: () => ({ a: 0.82, b: 1, ease: easeOutBack, from: { scale: V(0.001, 0.001, 0.001) } }),
  back: () => ({ a: 0.4, b: 0.65, from: { scale: V(1, 0.001, 1) } }),
};

function addModelStructure(seg, i) {
  for (const [name, node] of modelNodes) {
    const m = name.match(/^seg(\d+)_([a-z]+)(?:_([LR]))?(?:_(\d+))?$/);
    if (!m || +m[1] !== i) continue;
    const spec = MODEL_ANIM[m[2]]?.({ sx: m[3] === 'L' ? -1 : 1, side: seg.side, k: +(m[4] ?? 0) });
    if (spec) addEl(seg, node, spec);
    else seg.group.add(node); // pieza nueva sin animación definida: aparece tal cual
  }
}

// ─── Construcción por tramos ───────────────────────────────────────────────
// Cada elemento tiene un estado "final" y una animación de montaje
// dentro de una ventana [a, b] del progreso de su tramo (0..1).
const segments = [];
const clickable = [];

function addEl(seg, obj, { a, b, from = {}, ease = easeOutCubic }) {
  obj.userData.base = {
    pos: obj.position.clone(),
    scale: obj.scale.clone(),
  };
  obj.userData.anim = {
    a, b, ease,
    dp: from.offset ?? new THREE.Vector3(),
    s0: from.scale ?? obj.scale.clone(),
  };
  seg.group.add(obj);
  seg.els.push(obj);
}

function applyEl(obj, p) {
  const { a, b, ease, dp, s0 } = obj.userData.anim;
  const { pos, scale } = obj.userData.base;
  const t = clamp01((p - a) / (b - a));
  const e = ease(t);
  obj.visible = t > 0;
  obj.position.set(pos.x + dp.x * (1 - e), pos.y + dp.y * (1 - e), pos.z + dp.z * (1 - e));
  obj.scale.set(lerp(s0.x, scale.x, e), lerp(s0.y, scale.y, e), lerp(s0.z, scale.z, e));
}

const tiny = 0.001;

function makeSegment(i) {
  const p = projects[i];
  const seg = { group: new THREE.Group(), els: [], ghost: null, progress: -1 };
  const z0 = -i * L;
  const zc = z0 - L / 2;
  const side = i % 2 === 0 ? -1 : 1; // pared izquierda / derecha alternas
  seg.zc = zc; seg.side = side; seg.project = p;

  // Planos "de proyecto": aristas azules del volumen futuro
  const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W + 0.4, H + 0.3, L)), ghostMat.clone());
  ghost.position.set(0, (H + 0.3) / 2 - 0.3, zc);
  seg.ghost = ghost;
  seg.group.add(ghost);

  // Estructura: del modelo de Blender si existe, si no, cajas generadas en código
  if (hasModelSegment(i)) addModelStructure(seg, i);
  else {
  // 1 · Losa de suelo: se extiende a lo largo
  const slab = box(W + 0.8, 0.3, L, mat.slab);
  slab.position.set(0, -0.3, zc);
  addEl(seg, slab, { a: 0, b: 0.22, from: { scale: new THREE.Vector3(1, 1, tiny) } });

  const floor = box(W, 0.02, L, mat.floor);
  floor.position.set(0, 0, zc);
  addEl(seg, floor, { a: 0.12, b: 0.3, from: { scale: new THREE.Vector3(tiny, 1, 1) } });

  // 2 · Pilares en el arranque del tramo (y al final si es el último)
  const colZs = i === N - 1 ? [z0, z0 - L] : [z0];
  colZs.forEach((cz, k) => {
    for (const sx of [-1, 1]) {
      const col = box(0.45, H + 0.3, 0.45, mat.concrete);
      col.position.set(sx * (W / 2 + 0.15), -0.3 + 0.0, cz);
      addEl(seg, col, { a: 0.15 + k * 0.05, b: 0.38 + k * 0.05, from: { scale: new THREE.Vector3(1, tiny, 1) } });
    }
  });

  // 3 · Muros: suben desde el suelo
  for (const sx of [-1, 1]) {
    const wall = box(0.22, H, L - 0.45, mat.wall);
    wall.position.set(sx * (W / 2 + 0.11), 0, zc);
    const a = sx === side ? 0.28 : 0.36;
    addEl(seg, wall, { a, b: a + 0.24, from: { scale: new THREE.Vector3(1, tiny, 1) } });
  }

  // 4 · Cubierta en dos losas con lucernario central; bajan desde arriba
  const gap = 0.6;
  const rw = W / 2 + 0.4 - gap;
  for (const sx of [-1, 1]) {
    const roof = box(rw, 0.3, L, mat.slab);
    roof.position.set(sx * (gap + rw / 2), H, zc);
    const a = 0.55 + (sx === 1 ? 0.06 : 0);
    addEl(seg, roof, { a, b: a + 0.2, from: { offset: new THREE.Vector3(0, 6, 0) } });
  }
  const beam = box(gap * 2 + 0.2, 0.3, 0.3, mat.concrete);
  beam.position.set(0, H, z0 - L / 2);
  addEl(seg, beam, { a: 0.62, b: 0.8, from: { offset: new THREE.Vector3(0, 6, 0) } });

  // Marquesina de acceso en el primer tramo
  if (i === 0) {
    const canopy = box(W + 3, 0.22, 3.2, mat.slab);
    canopy.position.set(0, H - 0.2, 1.6);
    addEl(seg, canopy, { a: 0.6, b: 0.85, from: { offset: new THREE.Vector3(0, 0, 6), scale: new THREE.Vector3(1, 1, tiny) } });
  }
  if (i === N - 1) {
    const back = box(W + 0.8, H, 0.25, mat.wall);
    back.position.set(0, 0, HALL_END - 0.12);
    addEl(seg, back, { a: 0.4, b: 0.65, from: { scale: new THREE.Vector3(1, tiny, 1) } });
  }
  } // fin estructura de cajas

  // 5 · El proyecto se "cuelga" en la pared
  const frame = new THREE.Group();
  const backing = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.75, 0.08), mat.dark);
  backing.castShadow = true;
  const img = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 2.53),
    new THREE.MeshStandardMaterial({ map: projectTexture(p, i), roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0 })
  );
  img.position.z = 0.045;
  img.userData.project = p;
  clickable.push(img);
  const light = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.25), mat.glow);
  light.position.set(0, 1.62, 0.18);
  frame.add(backing, img, light);
  frame.position.set(side * (W / 2 - 0.04), 2.05, zc);
  frame.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  addEl(seg, frame, { a: 0.78, b: 1, ease: easeOutBack, from: { scale: new THREE.Vector3(tiny, tiny, tiny) } });

  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), new THREE.MeshStandardMaterial({ map: plaqueTexture(p, i), roughness: 0.9 }));
  plaque.position.set(side * (W / 2 - 0.02), 0.32, zc - 1.1);
  plaque.rotation.y = frame.rotation.y;
  addEl(seg, plaque, { a: 0.85, b: 1, from: { offset: new THREE.Vector3(0, -0.6, 0) } });

  // Número grande en la pared opuesta
  const num = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.5),
    new THREE.MeshBasicMaterial({ map: bigNumberTexture(i + 1), transparent: true, depthWrite: false })
  );
  num.position.set(-side * (W / 2 - 0.02), 1.95, zc - 1.5);
  num.rotation.y = -frame.rotation.y;
  addEl(seg, num, { a: 0.7, b: 0.95, from: { offset: new THREE.Vector3(0, 0, -2) } });

  // Muro de fondo con contacto en el último tramo
  if (i === N - 1) {
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 2.1),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(1024, 512, (g, w, h) => {
          g.fillStyle = '#1d1d1b'; g.fillRect(0, 0, w, h);
          g.fillStyle = '#9fb8d6'; g.font = '600 30px Inter, sans-serif';
          g.fillText('GRACIAS POR LA VISITA', 60, 110);
          g.fillStyle = '#fff'; g.font = '600 72px Inter, sans-serif';
          g.fillText(architect.name, 60, 230);
          g.fillStyle = '#cfcac0'; g.font = '34px Inter, sans-serif';
          g.fillText(architect.role, 60, 300);
          g.fillText(`${architect.email} · ${architect.city}`, 60, 420);
        }),
      })
    );
    card.position.set(0, 2.1, HALL_END + 0.02);
    addEl(seg, card, { a: 0.8, b: 1, ease: easeOutBack, from: { scale: new THREE.Vector3(tiny, tiny, tiny) } });
  }

  scene.add(seg.group);
  return seg;
}

for (let i = 0; i < N; i++) segments.push(makeSegment(i));

function setSegmentProgress(seg, p) {
  if (Math.abs(seg.progress - p) < 1e-4) return;
  seg.progress = p;
  for (const el of seg.els) applyEl(el, p);
  seg.ghost.material.opacity = 0.55 * (1 - clamp01(p / 0.6));
  seg.ghost.visible = seg.ghost.material.opacity > 0.01;
}

// ─── Recorrido de cámara ───────────────────────────────────────────────────
const introPos = new THREE.CatmullRomCurve3([
  new THREE.Vector3(18, 12, 24),
  new THREE.Vector3(9, 5, 13),
  new THREE.Vector3(1.5, 2.2, 6),
  new THREE.Vector3(0, EYE, 0.5),
]);
const introLook = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, -14),
  new THREE.Vector3(0, 1.5, -8),
  new THREE.Vector3(0, 1.8, -8),
  new THREE.Vector3(0, EYE, -9),
]);
const hallStart = 0.5;
const hallStop = HALL_END + 4.5;
const walkLen = hallStart - hallStop;
const LOOKAHEAD = 1.6 * L; // cuánto por delante de ti va la obra

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmp = new THREE.Vector3();
const mouse = new THREE.Vector2();
let focusedIndex = -1;

function rigAt(s) {
  let build;
  if (s < INTRO) {
    const u = s / INTRO;
    introPos.getPointAt(u, camPos);
    introLook.getPointAt(u, camLook);
    build = u * LOOKAHEAD;
  } else {
    const q = (s - INTRO) / (1 - INTRO);
    const z = hallStart - q * walkLen;
    camPos.set(0, EYE, z);
    camLook.set(0, EYE, z - 9);
    build = q * walkLen + LOOKAHEAD;

    // Gira la mirada hacia el proyecto que estás pasando
    let best = 0;
    focusedIndex = -1;
    segments.forEach((seg, i) => {
      const d = z - (seg.zc + 3);
      const w = Math.exp(-(d * d) / (2 * 2.6 * 2.6));
      if (w > best) { best = w; if (w > 0.45) focusedIndex = i; }
      if (w > 0.01) {
        tmp.set(seg.side * (W / 2), 2.05, seg.zc);
        camLook.lerp(tmp, w * 0.75);
      }
    });
    // Al final mira al muro de contacto
    const endW = clamp01((q - 0.93) / 0.07);
    if (endW > 0) camLook.lerp(tmp.set(0, 2.1, HALL_END), endW);
  }
  if (s < INTRO) focusedIndex = -1;
  return build;
}

// ─── Scroll, UI e interacción ──────────────────────────────────────────────
document.getElementById('arch-name').textContent = architect.name;
document.getElementById('arch-role').textContent = architect.role;
const toggle = document.getElementById('mode-toggle');
toggle.textContent = modelNodes.size ? 'Ver versión cajas' : 'Ver modelo de Blender';
toggle.href = modelNodes.size ? '?model=0' : '?';
const introEl = document.getElementById('intro');
const coordsEl = document.getElementById('coords');
const fillEl = document.querySelector('#progress .fill');
const currentEl = document.getElementById('current-label');
const ticksEl = document.getElementById('ticks');

// La visita empieza siempre desde fuera, aunque se recargue a mitad del recorrido
// Scroll invertido: la página arranca abajo del todo y se avanza haciendo scroll HACIA ARRIBA
// (como subir/entrar en el edificio). progreso = 1 - posición relativa del scroll.
history.scrollRestoration = 'manual';
const maxScroll = () => document.documentElement.scrollHeight - innerHeight;
const scrollTopFor = (progress) => (1 - progress) * maxScroll();
scrollTo(0, maxScroll());
let sTarget = 0;
let s = 0;
addEventListener('scroll', () => {
  sTarget = clamp01(1 - scrollY / maxScroll());
  if (view.mode === 'focus' && performance.now() > suppressExitUntil) exitFocus();
}, { passive: true });

// ─── Modo "frente al cuadro" ───────────────────────────────────────────────
// path   → la cámara sigue el recorrido del scroll
// focus  → la cámara viaja hasta quedar frontal a un proyecto
// return → vuelve suavemente al recorrido
const view = { mode: 'path', seg: null, t: 1, offset: 0, fromPos: new THREE.Vector3(), fromLook: new THREE.Vector3() };
const lastLook = new THREE.Vector3();
const focusPos = new THREE.Vector3();
const focusLook = new THREE.Vector3();
let suppressExitUntil = 0;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function panelCover() {
  // ancho que tapa el panel lateral (en móvil lo tapa todo: no compensamos)
  const w = Math.min(420, innerWidth);
  return w > innerWidth * 0.8 ? 0 : w;
}

function computeFocusPose(seg) {
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const aspect = (innerWidth - panelCover()) / innerHeight;
  // distancia para que el cuadro (3.8 × 2.75) quepa con margen en la zona libre
  const d = Math.min(W - 0.6, Math.max(3.4 / (2 * tanH), 4.8 / (2 * tanH * aspect)));
  const fx = seg.side * (W / 2 - 0.04);
  focusPos.set(fx - seg.side * d, 2.05, seg.zc);
  focusLook.set(fx, 2.05, seg.zc);
  // mirar un poco alrededor con el ratón
  focusLook.z += seg.side * smoothMouse.x * 0.25;
  focusLook.y -= smoothMouse.y * 0.18;
}

function enterFocus(seg) {
  view.fromPos.copy(camera.position);
  view.fromLook.copy(lastLook);
  view.mode = 'focus';
  view.seg = seg;
  view.t = 0;
  // Sincroniza el scroll con este proyecto para que al salir estés ahí mismo
  const i = segments.indexOf(seg);
  suppressExitUntil = performance.now() + 400;
  s = sTarget = scrollForProject(i);
  scrollTo({ top: scrollTopFor(s), behavior: 'instant' });
  openPanel(seg.project);
}

function exitFocus() {
  if (view.mode !== 'focus') return;
  view.fromPos.copy(camera.position);
  view.fromLook.copy(lastLook);
  view.mode = 'return';
  view.t = 0;
  closePanel();
}

addEventListener('wheel', () => { if (view.mode === 'focus' && performance.now() > suppressExitUntil) exitFocus(); }, { passive: true });
addEventListener('touchmove', () => { if (view.mode === 'focus' && performance.now() > suppressExitUntil) exitFocus(); }, { passive: true });

function scrollForProject(i) {
  const zFocus = segments[i].zc + 3;
  const q = (hallStart - zFocus) / walkLen;
  return INTRO + q * (1 - INTRO);
}

const tickButtons = projects.map((p, i) => {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.textContent = `${String(i + 1).padStart(2, '0')}  ${p.title}`;
  b.addEventListener('click', () => enterFocus(segments[i]));
  li.appendChild(b);
  ticksEl.appendChild(li);
  return b;
});

const panel = document.getElementById('panel');
function openPanel(p) {
  document.getElementById('p-meta').textContent = `${p.year}`;
  document.getElementById('p-title').textContent = p.title;
  document.getElementById('p-location').textContent = p.location;
  document.getElementById('p-type').textContent = p.type;
  document.getElementById('p-surface').textContent = p.surface;
  document.getElementById('p-desc').textContent = p.description;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
}
function closePanel() {
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
}
panel.querySelector('.close').addEventListener('click', exitFocus);
addEventListener('keydown', (e) => { if (e.key === 'Escape') exitFocus(); });

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered = null;

function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(clickable, false).find((h) => h.object.parent.visible && h.object.parent.scale.x > 0.5);
  return hit ? hit.object : null;
}

addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  const obj = pick(e);
  if (obj !== hovered) {
    if (hovered) hovered.material.emissiveIntensity = 0;
    hovered = obj;
    if (hovered) hovered.material.emissiveIntensity = 0.08;
    canvas.style.cursor = hovered ? 'pointer' : '';
  }
});
canvas.addEventListener('click', (e) => {
  const obj = pick(e);
  if (obj) enterFocus(segments.find((sg) => sg.project === obj.userData.project));
  else exitFocus(); // clic en cualquier otro sitio: te apartas
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ─── Bucle ─────────────────────────────────────────────────────────────────
const smoothMouse = new THREE.Vector2();
const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  s += (sTarget - s) * (1 - Math.exp(-dt * 4.5));
  smoothMouse.lerp(mouse, 1 - Math.exp(-dt * 3));

  const build = rigAt(s);
  segments.forEach((seg, i) => setSegmentProgress(seg, clamp01((build - i * L) / (1.2 * L))));

  camLook.x += smoothMouse.x * 1.4;
  camLook.y -= smoothMouse.y * 0.7;

  if (view.mode === 'focus') {
    view.t = Math.min(1, view.t + dt / 1.2);
    const e = easeInOut(view.t);
    computeFocusPose(view.seg);
    camera.position.lerpVectors(view.fromPos, focusPos, e);
    lastLook.lerpVectors(view.fromLook, focusLook, e);
  } else if (view.mode === 'return') {
    view.t = Math.min(1, view.t + dt / 1.0);
    const e = easeInOut(view.t);
    camera.position.lerpVectors(view.fromPos, camPos, e);
    lastLook.lerpVectors(view.fromLook, camLook, e);
    if (view.t >= 1) view.mode = 'path';
  } else {
    camera.position.copy(camPos);
    lastLook.copy(camLook);
  }
  camera.lookAt(lastLook);

  // Desplaza el centro óptico para que el cuadro quede centrado en la zona no tapada por el panel
  const targetOffset = view.mode === 'focus' ? panelCover() / 2 : 0;
  view.offset += (targetOffset - view.offset) * (1 - Math.exp(-dt * 4));
  if (Math.abs(view.offset) > 0.5) camera.setViewOffset(innerWidth, innerHeight, view.offset, 0, innerWidth, innerHeight);
  else camera.clearViewOffset();

  // Viento suave en los árboles
  const time = clock.elapsedTime;
  for (const t of trees) {
    t.node.rotation.z = Math.sin(time * 0.9 + t.phase) * 0.012;
    t.node.rotation.x = Math.sin(time * 0.7 + t.phase * 1.3) * 0.008;
  }

  // Lector de coordenadas tipo AutoCAD (X, Y en planta, Z altura)
  const p = camera.position;
  coordsEl.textContent = `${p.x.toFixed(4)}, ${(-p.z).toFixed(4)}, ${p.y.toFixed(4)}`;

  introEl.classList.toggle('hidden', s > 0.02);
  fillEl.style.height = `${s * 100}%`;
  tickButtons.forEach((b, i) => b.classList.toggle('active', i === focusedIndex));
  currentEl.textContent = focusedIndex >= 0 ? `${String(focusedIndex + 1).padStart(2, '0')} — ${projects[focusedIndex].title} · clic para ver` : '';

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
