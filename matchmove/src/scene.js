// The "plate": a stylised dusk city, rendered with three.js into an off-screen target,
// then pushed through a lens pass (barrel distortion, grain, wipe, grade).
import * as THREE from '/node_modules/three/build/three.module.js';

export const W = 1920, H = 1080, ASPECT = W / H;
export const SENSOR_W = 54.12;                    // large-format gate, so 35 mm reads wide
export const SENSOR_H = SENSOR_W / ASPECT;
export const fovOf = f => 2 * Math.atan(SENSOR_H / 2 / f) * 180 / Math.PI;

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

THREE.ColorManagement.enabled = false;

const HAZE = new THREE.Color(0.66, 0.36, 0.42);

const BLD_VS = `
varying vec3 vPos; varying vec3 vN; varying float vDepth;
void main(){ vPos = position; vN = normal; vec4 mv = modelViewMatrix * vec4(position,1.); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
const BLD_FS = `
precision highp float;
uniform vec3 uSize; uniform vec2 uN; uniform sampler2D uWin; uniform vec3 uBase; uniform vec3 uHaze;
varying vec3 vPos; varying vec3 vN; varying float vDepth;
void main(){
  vec3 col;
  if (vN.y > 0.5) { col = uBase * 0.6; }
  else {
    float fx; float shade; float isFront = step(0.5, abs(vN.z));
    float nxs = max(1., floor(uN.x * uSize.z / uSize.x + 0.5));
    if (isFront > 0.5) { fx = (vPos.x / uSize.x + 0.5) * uN.x; shade = 1.0; }
    else { fx = (vPos.z / uSize.z + 0.5) * nxs; shade = vN.x < 0. ? 1.7 : 0.72; }
    float fy = (vPos.y / uSize.y + 0.5) * uN.y;
    vec2 g = vec2(fx, fy); vec2 cell = floor(g); vec2 f = fract(g) - 0.5; vec2 aw = fwidth(g) * 0.75;
    float win = (1. - smoothstep(0.30 - aw.x, 0.30 + aw.x, abs(f.x))) * (1. - smoothstep(0.32 - aw.y, 0.32 + aw.y, abs(f.y)));
    float ci = isFront > 0.5 ? cell.x : mod(cell.x * 3. + 5., uN.x);
    vec4 w = texture2D(uWin, (vec2(ci, cell.y) + 0.5) / uN);
    vec3 wall = uBase * shade * (0.9 + 0.1 * vPos.y / uSize.y);
    vec3 lit = mix(vec3(1.0, 0.66, 0.30), vec3(1.0, 0.88, 0.56), w.g);
    if (w.b > 0.5) lit = vec3(0.50, 0.88, 1.0);
    vec3 glass = wall * 0.5 + vec3(0.05, 0.04, 0.10);
    col = mix(wall, mix(glass, lit, step(0.5, w.r)), win);
  }
  float fog = 1. - exp(-vDepth * 0.0105);
  col = mix(col, uHaze, fog * 0.9);
  gl_FragColor = vec4(col, 1.);
}`;

const SKY_FS = `
precision highp float; varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 c = mix(vec3(1.0, 0.68, 0.36), vec3(0.96, 0.44, 0.38), smoothstep(0.02, 0.14, h));
  c = mix(c, vec3(0.60, 0.27, 0.52), smoothstep(0.11, 0.27, h));
  c = mix(c, vec3(0.27, 0.17, 0.44), smoothstep(0.24, 0.42, h));
  c = mix(c, vec3(0.10, 0.09, 0.26), smoothstep(0.40, 0.75, h));
  float s = max(dot(d, normalize(vec3(-0.42, 0.02, -1.))), 0.);
  c += vec3(1.0, 0.72, 0.40) * (pow(s, 60.) * 0.55 + pow(s, 8.) * 0.16);
  // thin cloud bands
  float b = sin(h * 95. + sin(d.x * 5.) * 1.6) * 0.5 + 0.5;
  c += vec3(0.25, 0.08, 0.10) * smoothstep(0.86, 1.0, b) * smoothstep(0.04, 0.10, h) * (1. - smoothstep(0.16, 0.30, h));
  c = mix(c, vec3(${HAZE.r}, ${HAZE.g}, ${HAZE.b}), smoothstep(0.0, -0.03, h));
  gl_FragColor = vec4(c, 1.);
}`;

const GROUND_FS = `
precision highp float; varying vec3 vW; varying float vDepth; uniform vec3 uHaze;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main(){
  float n = vnoise(vW.xz * 0.9) * 0.6 + vnoise(vW.xz * 4.3) * 0.3 + vnoise(vW.xz * 17.) * 0.1;
  vec3 col = vec3(0.105, 0.09, 0.15) * (0.75 + 0.55 * n);
  // faint paving joints
  vec2 g = abs(fract(vW.xz / 3.0) - 0.5); vec2 aw = fwidth(vW.xz / 3.0);
  float joint = 1. - min(smoothstep(0.0, aw.x * 1.5, 0.5 - g.x), smoothstep(0.0, aw.y * 1.5, 0.5 - g.y));
  col *= 1. - 0.28 * joint * exp(-vDepth * 0.04);
  col += vec3(0.30, 0.14, 0.10) * exp(-abs(vW.x + 4.5 + vW.z * 0.42) * 0.22) * 0.20;   // warm sky bounce
  float fog = 1. - exp(-vDepth * 0.016);
  col = mix(col, uHaze * 0.9, fog);
  gl_FragColor = vec4(col, 1.);
}`;

const LENS_FS = `
precision highp float; varying vec2 vUv;
uniform sampler2D tA; uniform sampler2D tB;
uniform float uK, uZ, uWipe, uUseB, uDesat, uBright, uGrain, uSeed, uDim, uVig;
uniform vec2 uZsrc, uZdst, uRmin, uRsize;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 d = (vUv * 2. - 1.) * vec2(${ASPECT.toFixed(6)}, 1.);
  vec2 d0 = uZsrc + (d - uZdst) / uZ;
  vec2 u = d0 * (1. + uK * dot(d0, d0));
  vec2 uv = (u - uRmin) / uRsize;
  vec3 c = texture2D(tA, uv).rgb;
  if (uUseB > 0.5 && vUv.x * ${W}. > uWipe) c = texture2D(tB, uv).rgb;
  // grade
  c = pow(c, vec3(0.95)) * 1.04;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l) * vec3(0.86, 0.93, 1.08), uDesat) * uBright;
  float r2 = dot(d, d);
  c *= 1. - uVig * 0.085 * r2;
  // film grain: soft, 1.5 px, luminance weighted
  vec2 gp = floor(vUv * vec2(${W}., ${H}.) / 1.5);
  float g = hash(gp + uSeed * 17.31) + hash(gp * 1.7 + uSeed * 9.13) - 1.;
  c += g * uGrain * (0.028 + 0.024 * (1. - l));
  vec3 navy = vec3(0.051, 0.071, 0.125);
  c = mix(navy, c, uDim);
  gl_FragColor = vec4(c, 1.);
}`;

export function buildPlate(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setSize(W, H, false);
  const RW = 2304, RH = 1296;
  const mkRT = () => new THREE.WebGLRenderTarget(RW, RH, { samples: 4, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const rtA = mkRT(), rtB = mkRT();

  const scene = new THREE.Scene();
  const rnd = mulberry(42);
  const occluders = [];
  const cand = [];          // feature candidates {p:Vector3, type, row, tag}

  // ---- sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: SKY_FS }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  // ---- ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.ShaderMaterial({
    uniforms: { uHaze: { value: HAZE } },
    vertexShader: `varying vec3 vW; varying float vDepth; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: GROUND_FS }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);

  // ---- painted ground marks
  const markMat = new THREE.MeshBasicMaterial({ color: 0xb9a9c4 });
  const markMat2 = new THREE.MeshBasicMaterial({ color: 0xe0a04a });
  const addMark = (x, z, w, d, mat = markMat, feat = true) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); scene.add(m);
    if (feat) for (const sx of [-1, 1]) cand.push({ p: new THREE.Vector3(x + sx * w / 2, 0, z + d / 2), type: 'ground', row: 0 });
  };
  for (let x = -18; x <= 18; x += 3) addMark(x + 0.4, 0.4, 1.5, 0.2);
  for (let x = -27; x <= 27; x += 3) addMark(x, -6.2, 0.16, 5.0, markMat, Math.abs(x) < 12);
  for (let x = -30; x <= 30; x += 6) addMark(x, -3.6, 5.6, 0.14, markMat2, false);

  // ---- lights for lambert stuff
  scene.add(new THREE.AmbientLight(0x807890, 2.0));
  const sun = new THREE.DirectionalLight(0xffa870, 4.2); sun.position.set(-6, 3.2, -5); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xb4b4e0, 2.0); fill.position.set(3, 5, 8); scene.add(fill);

  // ---- soft blob shadow texture
  const blob = (inner, outer) => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, inner); g.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.35)')); g.addColorStop(1, outer);
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
  };
  const shadowTex = blob('rgba(4,3,10,0.85)', 'rgba(4,3,10,0)');
  const glowTex = blob('rgba(255,70,160,0.75)', 'rgba(255,70,160,0)');
  const addShadow = (parent, w, d, y = 0.02) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = y; parent.add(m); return m;
  };

  // ---- teal boxes
  const boxes = [];
  const boxDefs = [
    { x: -2.45, z: 2.5, w: 1.0, h: 1.0, d: 1.0, r: 0.22, c: 0x14c8a8 },
    { x: 2.55, z: 2.2, w: 1.3, h: 0.8, d: 1.0, r: -0.32, c: 0x12ad94 },
    { x: 4.4, z: -0.8, w: 1.0, h: 1.5, d: 1.0, r: 0.12, c: 0x18bda0 },
    { x: -4.9, z: 0.1, w: 1.3, h: 0.7, d: 1.2, r: 0.5, c: 0x10a58c },
    { x: -0.9, z: -3.2, w: 0.9, h: 0.9, d: 0.9, r: -0.15, c: 0x16b89c },
  ];
  boxDefs.forEach((b, bi) => {
    const g = new THREE.Group(); g.position.set(b.x, 0, b.z); g.rotation.y = b.r; scene.add(g);
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshLambertMaterial({ color: b.c, emissive: 0x06302e }));
    m.position.y = b.h / 2; g.add(m); occluders.push(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x7ff3e6, transparent: true, opacity: 0.55 }));
    e.position.y = b.h / 2; g.add(e);
    addShadow(g, b.w * 2.3, b.d * 2.3);
    g.updateMatrixWorld(true);
    const corners = [];
    for (const sy of [0, 1]) for (const sz of [1, -1]) for (const sx of [-1, 1]) {
      const p = new THREE.Vector3(sx * b.w / 2, sy * b.h, sz * b.d / 2).applyMatrix4(g.matrixWorld);
      corners.push(p);
      if (sy === 1 || sz === 1) cand.push({ p, type: sy ? 'box' : 'ground', row: 0, tag: `box${bi}_${sy}${sz > 0 ? 'f' : 'b'}${sx > 0 ? 'r' : 'l'}` });
    }
    boxes.push({ ...b, corners });
  });

  // ---- buildings
  const buildings = [];
  const rows = [
    { z: -14, x0: -34, x1: 34, w: [5, 8], h: [4.5, 7.5], gap: [1.5, 4.5], d: 6, cell: [1.25, 1.35] },
    { z: -27, x0: -50, x1: 50, w: [6, 10], h: [8, 13], gap: [1, 4], d: 8, cell: [1.4, 1.5] },
    { z: -44, x0: -72, x1: 72, w: [7, 12], h: [12, 21], gap: [0.5, 4], d: 10, cell: [1.6, 1.7] },
    { z: -72, x0: -110, x1: 110, w: [9, 16], h: [18, 34], gap: [0, 5], d: 12, cell: [2.0, 2.1] },
  ];
  rows.forEach((R, ri) => {
    let x = R.x0;
    while (x < R.x1) {
      const w = R.w[0] + rnd() * (R.w[1] - R.w[0]), h = R.h[0] + rnd() * (R.h[1] - R.h[0]);
      const nx = Math.max(2, Math.round(w / R.cell[0])), ny = Math.max(3, Math.round(h / R.cell[1]));
      const data = new Uint8Array(nx * ny * 4); const litp = 0.34 + rnd() * 0.3; const cool = rnd() < 0.2;
      for (let i = 0; i < nx * ny; i++) {
        const cy = Math.floor(i / nx);
        const lit = rnd() < litp && cy > 0;
        data[i * 4] = lit ? 255 : 0; data[i * 4 + 1] = Math.floor(rnd() * 255); data[i * 4 + 2] = (cool && rnd() < 0.5) || rnd() < 0.05 ? 255 : 0; data[i * 4 + 3] = 255;
      }
      const tex = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat); tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
      const tone = 0.8 + rnd() * 0.5; const hue = rnd();
      const base = new THREE.Color(0.105 * tone + 0.03 * hue, 0.085 * tone, 0.17 * tone + 0.03 * (1 - hue));
      const mat = new THREE.ShaderMaterial({ uniforms: { uSize: { value: new THREE.Vector3(w, h, R.d) }, uN: { value: new THREE.Vector2(nx, ny) }, uWin: { value: tex }, uBase: { value: base }, uHaze: { value: HAZE } }, vertexShader: BLD_VS, fragmentShader: BLD_FS });
      const zj = R.z + (rnd() - 0.5) * 3;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, R.d), mat); m.position.set(x + w / 2, h / 2, zj); scene.add(m); occluders.push(m);
      m.updateMatrixWorld(true);
      const B = { x: x + w / 2, z: zj, w, h, d: R.d, row: ri + 1 }; buildings.push(B);
      // features: corners of lit windows (bright against dark wall), roof corners (dark against sky)
      for (let cy = 1; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
        if (!data[(cy * nx + cx) * 4]) continue;
        const sx = rnd() < 0.5 ? -1 : 1, sy = rnd() < 0.5 ? -1 : 1;
        cand.push({ p: new THREE.Vector3(B.x + ((cx + 0.5 + sx * 0.30) / nx - 0.5) * w, ((cy + 0.5 + sy * 0.32) / ny) * h, zj + R.d / 2), type: 'win', row: ri + 1 });
      }
      for (const sx of [-1, 1]) cand.push({ p: new THREE.Vector3(B.x + sx * w / 2, h, zj + R.d / 2), type: 'roof', row: ri + 1, b: B, sx });
      x += w + R.gap[0] + rnd() * (R.gap[1] - R.gap[0]);
    }
  });

  // ---- the CG crystal (pink)
  const crystal = new THREE.Group(); scene.add(crystal);
  const cmat = new THREE.MeshLambertMaterial({ color: 0xff4fa3, emissive: 0xa81868, flatShading: true });
  const shard = (rb, rt, h, tip, x, z, tiltX, tiltZ, ry) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 6, 1), cmat); body.position.y = h / 2; g.add(body);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(rt, tip, 6, 1), cmat); cap.position.y = h + tip / 2; g.add(cap);
    for (const m of [body, cap]) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0xffc2e2, transparent: true, opacity: 0.7 })); e.position.copy(m.position); g.add(e); }
    g.position.set(x, -0.03, z); g.rotation.set(tiltX, ry, tiltZ); crystal.add(g);
  };
  shard(0.30, 0.24, 0.95, 0.5, 0, 0, 0.03, -0.04, 0.3);
  shard(0.17, 0.13, 0.50, 0.3, 0.36, 0.12, 0.10, -0.42, 0.9);
  shard(0.15, 0.11, 0.38, 0.26, -0.33, 0.16, 0.16, 0.5, 0.2);
  shard(0.12, 0.09, 0.30, 0.2, 0.05, 0.36, 0.55, 0.05, 0.5);
  const cShadow = addShadow(scene, 2.0, 2.0, 0.025);
  const cGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
  cGlow.rotation.x = -Math.PI / 2; cGlow.position.y = 0.03; scene.add(cGlow);
  const CRYSTAL_HOME = new THREE.Vector3(0, 0, 2.4);

  // ---- lens pass
  const quadScene = new THREE.Scene(); const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const U = { tA: { value: rtA.texture }, tB: { value: rtB.texture }, uK: { value: 0 }, uZ: { value: 1 }, uWipe: { value: 0 }, uUseB: { value: 0 }, uDesat: { value: 0 }, uBright: { value: 1 }, uGrain: { value: 1 }, uSeed: { value: 0 }, uDim: { value: 1 }, uVig: { value: 1 },
    uZsrc: { value: new THREE.Vector2() }, uZdst: { value: new THREE.Vector2() }, uRmin: { value: new THREE.Vector2() }, uRsize: { value: new THREE.Vector2(1, 1) } };
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: U, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`, fragmentShader: LENS_FS, depthTest: false })));

  const rtCam = new THREE.PerspectiveCamera(30, ASPECT, 0.1, 1500);

  function setCrystal(mode, camX, tp, drop) {
    const on = mode && mode !== 'none';
    crystal.visible = cShadow.visible = cGlow.visible = !!on;
    if (!on) return;
    let x = CRYSTAL_HOME.x, y = 0, z = CRYSTAL_HOME.z;
    if (mode === 'slide') { x += 0.5 * camX + 0.3; y = 0.13 + 0.05 * Math.sin(tp * 2.3); z += 0.12 * Math.sin(tp * 1.1); }
    y += drop || 0;
    crystal.position.set(x, y, z);
    cShadow.position.set(x, 0.025, z); cGlow.position.set(x, 0.03, z);
    const lift = Math.min(1, y / 2.5);
    cShadow.material.opacity = 1 - 0.75 * lift; cShadow.scale.setScalar(1 + lift * 1.5);
    cGlow.material.opacity = 0.55 * (1 - lift);
  }
  function crystalPos(mode, camX, tp, drop) {
    const v = CRYSTAL_HOME.clone();
    if (mode === 'slide') { v.x += 0.5 * camX + 0.3; v.y = 0.13 + 0.05 * Math.sin(tp * 2.3); v.z += 0.12 * Math.sin(tp * 1.1); }
    v.y += drop || 0; return v;
  }

  // S: { cam (PerspectiveCamera, matrices current), k, Z, zsrc, zdst, dim, desat, bright, grain, wipe, cryA, cryB, drop, tp, camX, seed }
  function render(S) {
    if (S.dim <= 0.001) { renderer.setRenderTarget(null); renderer.setClearColor(0x0d1220, 1); renderer.clear(); return; }
    // u-space rectangle the display actually needs (keeps full sharpness at any zoom / distortion)
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i <= 16; i++) for (const [dx, dy] of [[-ASPECT + 2 * ASPECT * i / 16, -1], [-ASPECT + 2 * ASPECT * i / 16, 1], [-ASPECT, -1 + 2 * i / 16], [ASPECT, -1 + 2 * i / 16]]) {
      const ax = S.zsrc[0] + (dx - S.zdst[0]) / S.Z, ay = S.zsrc[1] + (dy - S.zdst[1]) / S.Z; const s = 1 + S.k * (ax * ax + ay * ay);
      x0 = Math.min(x0, ax * s); x1 = Math.max(x1, ax * s); y0 = Math.min(y0, ay * s); y1 = Math.max(y1, ay * s);
    }
    let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2 * 1.01, hh = (y1 - y0) / 2 * 1.01;
    if (hw / hh > ASPECT) hh = hw / ASPECT; else hw = hh * ASPECT;
    rtCam.position.copy(S.cam.position); rtCam.quaternion.copy(S.cam.quaternion); rtCam.fov = S.cam.fov; rtCam.aspect = ASPECT;
    rtCam.setViewOffset(W, H, (cx - hw + ASPECT) / (2 * ASPECT) * W, (1 - (cy + hh)) / 2 * H, hw / ASPECT * W, hh * H);
    rtCam.updateMatrixWorld(true);
    sky.position.copy(rtCam.position);
    const pass = (rt, mode) => { setCrystal(mode, S.camX, S.tp, S.drop); renderer.setRenderTarget(rt); renderer.render(scene, rtCam); };
    pass(rtA, S.cryA);
    const useB = S.wipe != null && S.cryB;
    if (useB) pass(rtB, S.cryB);
    U.uK.value = S.k; U.uZ.value = S.Z; U.uZsrc.value.set(...S.zsrc); U.uZdst.value.set(...S.zdst);
    U.uRmin.value.set(cx - hw, cy - hh); U.uRsize.value.set(2 * hw, 2 * hh);
    U.uWipe.value = S.wipe ?? 0; U.uUseB.value = useB ? 1 : 0; U.uDesat.value = S.desat; U.uBright.value = S.bright; U.uGrain.value = S.grain; U.uSeed.value = S.seed; U.uDim.value = S.dim; U.uVig.value = S.vig ?? 1;
    renderer.setRenderTarget(null); renderer.render(quadScene, quadCam);
  }

  return { render, cand, occluders, boxes, buildings, crystalPos, CRYSTAL_HOME };
}
