// VFX EXPLAINED — MATCHMOVE.  Deterministic renderer: window.renderFrame(t) draws the frame at time t (seconds).
import * as THREE from '/node_modules/three/build/three.module.js';
import { buildPlate, W, H, ASPECT, SENSOR_W, fovOf, mulberry } from './scene.js';

const C = { navy: '#0d1220', mint: '#4ade80', coral: '#ff6b5e', orange: '#ff9a3c', cyan: '#38d6f5', pink: '#ff4fa3', white: '#f4f7ff', dim: '#8b97b8' };
const DUR = 160, FPS = 30;
const CH = [
  { t: 0, name: 'HOOK' }, { t: 12, name: 'TITLE' },
  { t: 18, tag: '01 TRACK', title: 'Lock onto details' },
  { t: 38, tag: '02 PARALLAX', title: 'Near moves fast, far moves slow' },
  { t: 58, tag: '03 LENS DISTORTION', title: 'Straighten the lens first' },
  { t: 74, tag: '04 SOLVE', title: 'Guess, check, correct' },
  { t: 100, tag: '05 FOCAL LENGTH', title: 'Only one focal length fits' },
  { t: 120, tag: '06 SCALE', title: 'Give it a ruler' },
  { t: 138, tag: '07 RESULT', title: 'A camera that matches' },
  { t: 154, name: 'OUTRO' }, { t: DUR },
];

// ───────────────────────── helpers
const sat = x => Math.max(0, Math.min(1, x));
const lerp = (a, b, u) => a + (b - a) * u;
const ss = (a, b, x) => { const u = sat((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const eio = u => { u = sat(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const eout = u => 1 - Math.pow(1 - sat(u), 3);
const eback = u => { u = sat(u); const c = 1.70158; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

const out = document.getElementById('out'); const ctx = out.getContext('2d');
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const plate = buildPlate(glc);
const viewCam = new THREE.PerspectiveCamera(30, ASPECT, 0.1, 1500);
const tmpCam = new THREE.PerspectiveCamera(30, ASPECT, 0.1, 1500);
const K0 = 0.04, KBIG = 0.075;

// ───────────────────────── the shot camera (ground truth the solver has to find)
function rawShot(tp) {
  return {
    x: 1.6 * Math.sin(2 * Math.PI * tp / 9) + 0.035 * Math.sin(tp * 2.3 + 1),
    y: 1.65 + 0.03 * Math.sin(tp * 1.3 + 1) + 0.015 * Math.sin(tp * 3.1),
    z: 9 + 0.06 * Math.sin(tp * 0.9 + 2),
    yaw: 0.0050 * Math.sin(tp * 1.7 + 0.3) + 0.0028 * Math.sin(tp * 3.3 + 1.2) + 0.0012 * Math.sin(tp * 6.1),
    pitch: 0.027 + 0.0040 * Math.sin(tp * 1.4 + 2) + 0.0022 * Math.sin(tp * 3.9) + 0.001 * Math.sin(tp * 6.7 + 1),
    roll: 0.0035 * Math.sin(tp * 1.1 + 0.5),
  };
}
const mkPose = r => ({ p: V3(r.x, r.y, r.z), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(r.pitch, r.yaw, r.roll, 'YXZ')) });
const shotPose = tp => mkPose(rawShot(tp));
function lookPose(pos, target) { const m = new THREE.Matrix4().lookAt(pos, target, V3(0, 1, 0)); return { p: pos.clone(), q: new THREE.Quaternion().setFromRotationMatrix(m) }; }
function lerpPose(a, b, u) { return { p: a.p.clone().lerp(b.p, u), q: a.q.clone().slerp(b.q, u) }; }
function applyPose(cam, pose, focal) { cam.position.copy(pose.p); cam.quaternion.copy(pose.q); cam.fov = fovOf(focal); cam.clearViewOffset(); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert(); return cam; }

// plate clock: frozen during the hook's freeze, slow-mo "frame by frame" during the tracker close-up
function tpOf(t) {
  if (t < 8) return t;
  if (t < 18) return 8;
  if (t < 24.8) return t - 7.8;
  if (t < 30.0) return 17.0 + Math.floor((t - 24.8) / 5.2 * 18) / 24;
  return t - 12.25;
}

// ───────────────────────── projection: world → undistorted (u) → lens → zoom → pixels
const _v = new THREE.Vector3();
function projU(P, cam) {
  _v.copy(P).applyMatrix4(cam.matrixWorldInverse); const depth = -_v.z; if (depth < 0.15) return null;
  _v.applyMatrix4(cam.projectionMatrix); return { x: _v.x * ASPECT, y: _v.y, depth };
}
function lensFwd(ux, uy, k) {       // undistorted → distorted (what the plate shows)
  if (k <= 0) return [ux, uy];
  const ru = Math.hypot(ux, uy); if (ru < 1e-9) return [ux, uy];
  let r = ru; for (let i = 0; i < 8; i++) r -= (r * (1 + k * r * r) - ru) / (1 + 3 * k * r * r);
  return [ux * r / ru, uy * r / ru];
}
function uToPx(ux, uy, S) {
  const [dx, dy] = lensFwd(ux, uy, S.k);
  const x = S.zdst[0] + (dx - S.zsrc[0]) * S.Z, y = S.zdst[1] + (dy - S.zsrc[1]) * S.Z;
  return [W / 2 + x * H / 2, H / 2 - y * H / 2];
}
function toPx(P, S, cam = S.cam) { const u = projU(P, cam); if (!u) return null; const p = uToPx(u.x, u.y, S); p.depth = u.depth; return p; }
function camAt(tp, focal = 35) { return applyPose(tmpCam, shotPose(tp), focal); }
const FLAT = { k: 0, Z: 1, zsrc: [0, 0], zdst: [0, 0] };

// ───────────────────────── choose trackable features (visible from the whole camera move)
const F = [];
let HERO, FAR, GROUND3, BOXA, EDGES = [];
(function selectFeatures() {
  const rc = new THREE.Raycaster(); const rnd = mulberry(7);
  const tps = [2.25, 0, 6.75, 4.5, 1.1, 5.6];
  const vis = (c) => {
    const pts = [];
    for (const tp of tps) {
      const cam = camAt(tp); const px = toPx(c.p, { ...FLAT, k: KBIG }, cam);
      if (!px || px[0] < 55 || px[0] > W - 55 || px[1] < 125 || px[1] > 885) return null;
      const dir = c.p.clone().sub(cam.position); const dist = dir.length(); rc.set(cam.position, dir.normalize()); rc.far = dist - 0.08;
      if (c.type !== 'ground' && rc.intersectObjects(plate.occluders, false).length) return null;
      if (c.type === 'ground') { rc.far = dist - 0.3; if (rc.intersectObjects(plate.occluders, false).length) return null; }
      pts.push(px);
    }
    return pts;
  };
  const cands = plate.cand.map(c => ({ ...c, s: rnd() })).sort((a, b) => a.s - b.s);

  const accept = (c, minD) => {
    const pts = vis(c); if (!pts) return false;
    for (const f of F) if (Math.hypot(f.ref[0] - pts[1][0], f.ref[1] - pts[1][1]) < minD) return false;
    F.push({ p: c.p, type: c.type, row: c.row, tag: c.tag, ref: pts[1], b: c.b, sx: c.sx }); return true;
  };
  // must-haves first: the hero box (near tracker + 1 m ruler), a few ground points
  for (const tag of ['box0_1fr', 'box0_1fl']) { const c = cands.find(c => c.tag === tag); accept(c, 0); }
  let ng = 0; for (const c of cands) if (c.type === 'ground' && !c.tag && ng < 6 && accept(c, 110)) ng++;
  let nb = 0; for (const c of cands) if (c.type === 'box' && nb < 7 && accept(c, 90)) nb++;
  let nf = 0; for (const c of cands) if (c.row >= 3 && nf < 9 && accept(c, 140)) nf++;
  for (const c of cands) { if (F.length >= 46) break; if (c.type === 'win' || c.type === 'roof') accept(c, 118); }
  HERO = F[0]; BOXA = [F[0], F[1]];
  FAR = F.filter(f => f.row >= 3).sort((a, b) => Math.hypot(a.ref[0] - 1180, a.ref[1] - 260) - Math.hypot(b.ref[0] - 1180, b.ref[1] - 260))[0];
  const g = F.filter(f => f.type === 'ground' && !f.tag); let best = 0;
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) for (let k = j + 1; k < g.length; k++) {
    const a = g[j].p.clone().sub(g[i].p).cross(g[k].p.clone().sub(g[i].p)).length(); if (a > best) { best = a; GROUND3 = [g[i], g[j], g[k]]; }
  }
  // pop order
  const order = F.map((_, i) => i).sort(() => rnd() - 0.5); order.forEach((fi, n) => F[fi].ord = n);
  // tall building edges near the frame sides, for the distortion chapter
  const roofs = plate.cand.filter(c => c.type === 'roof' && c.row >= 2 && c.b.h > 9);
  for (const side of [200, W - 200]) {
    let bestC = null, bd = 1e9;
    for (const c of roofs) { const pts = vis(c); if (!pts) continue; const d = Math.abs(pts[1][0] - side) + pts[1][1] * 0.3; if (d < bd) { bd = d; bestC = c; } }
    if (bestC) EDGES.push({ top: bestC.p.clone(), bot: bestC.p.clone().setY(bestC.b.h * 0.4) });
  }
})();

// ───────────────────────── the solver's guesses (chapter 04)
const SOLVE = (() => {
  const rnd = mulberry(99);
  const init = F.map(() => V3(rnd() * 64 - 32, rnd() * 24, -46 + rnd() * 56));
  const estRaw = (tp, e) => { const r = rawShot(tp); r.x += 3.4 * e; r.y += 2.4 * e; r.z += 5 * e; r.yaw += 0.33 * e; r.pitch -= 0.14 * e; return r; };
  const P = (i, e) => F[i].p.clone().lerp(init[i], e);
  const camT = new THREE.PerspectiveCamera(), camE = new THREE.PerspectiveCamera();
  const err = e => {
    applyPose(camT, shotPose(0), 35); applyPose(camE, mkPose(estRaw(0, e)), 35); let s = 0;
    F.forEach((f, i) => { const a = toPx(f.p, FLAT, camT), b = toPx(P(i, e), FLAT, camE); s += b ? Math.min(2500, Math.hypot(a[0] - b[0], a[1] - b[1])) : 2500; });
    return s / F.length;
  };
  const targets = [343, 49, 4.6, 0.21];
  const es = targets.map(tg => { let lo = 0, hi = 1; if (err(1) < tg) return 1; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (err(m) > tg) hi = m; else lo = m; } return (lo + hi) / 2; });
  return { init, estRaw, P, targets, es, err };
})();
function solveStage(t) {      // → {e, err}
  const seg = [[87.6, 88.7], [90.3, 91.2], [92.7, 93.5]]; let i = 0, u = 0;
  for (let s = 0; s < 3; s++) { if (t >= seg[s][1]) i = s + 1; else if (t >= seg[s][0]) { i = s; u = eio((t - seg[s][0]) / (seg[s][1] - seg[s][0])); break; } else break; }
  if (i >= 3) return { e: SOLVE.es[3], err: SOLVE.targets[3] };
  const le = lerp(Math.log(SOLVE.es[i]), Math.log(SOLVE.es[i + 1]), u), lr = lerp(Math.log(SOLVE.targets[i]), Math.log(SOLVE.targets[i + 1]), u);
  return { e: Math.exp(le), err: Math.exp(lr) };
}
const fmtErr = v => v >= 10 ? Math.round(v).toString() : v >= 1 ? v.toFixed(1) : v.toFixed(2);

// ───────────────────────── per-frame state
function kOf(t) {
  if (t < 58.5) return K0;
  if (t < 63.2) return lerp(K0, KBIG, ss(58.5, 60.3, t));
  if (t < 68.8) return KBIG * (1 - eback((t - 63.2) / 0.55));
  if (t < 72.4) return KBIG * eout((t - 68.8) / 0.45);
  if (t < 73.1) return KBIG * (1 - eback((t - 72.4) / 0.55));
  return 0;
}
function wipeHook(t) {
  if (t < 5) return lerp(-30, W + 30, eio((t - 4.0) / 1.0));
  if (t < 6.5) return lerp(W + 30, -30, eio((t - 5.7) / 0.8));
  return lerp(-30, W + 30, eio((t - 6.9) / 0.8));
}
function wipeEnd(t) {
  if (t < 151.1) return lerp(W + 30, -30, eio((t - 149.6) / 0.8));
  return lerp(-30, W + 30, eio((t - 151.1) / 0.8));
}
const orbit = (az, R, h, target) => lookPose(V3(target.x + R * Math.sin(az), h, target.z + R * Math.cos(az)), target);
const solveCamPose = t => orbit(-0.62 + 0.013 * (t - 74), 50, 21, V3(0, 5, -15));
const scaleCamPose = (t, sc = 1) => orbit(-0.55 + 0.012 * (t - 120), lerp(31, 60, sc), lerp(16, 25, sc), V3(0, lerp(6.5, 5, sc), lerp(-9, -16, sc)));
const closeCamPose = t => orbit(0.42 + 0.03 * (t - 140), 13.5, 5.2, V3(0, lerp(3.6, 1.2, eio((t - 141.0) / 1.2)), 6.6));
let HERO_MID = [0, 0];

// chapter 06: the solve floats tilted + tiny until we give it a ground plane and a ruler
const XF6 = (() => {
  const axis = V3(1, 0, 0.55).normalize(), pivot = V3(0, 0, -8);
  return t => {
    const up = eio((t - 128.7) / 1.4), sc = eio((t - 131.9) / 1.4);
    const ang = lerp(0.52, 0, up), s = lerp(0.36, 1, sc), lift = lerp(7.5, 0, up);
    const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
    const f = P => P.clone().sub(pivot).applyQuaternion(q).multiplyScalar(s).add(pivot).setY(P.clone().sub(pivot).applyQuaternion(q).y * s + lift);
    f.s = s; f.q = q; f.up = up; f.sc = sc; return f;
  };
})();
const ID = P => P;

function buildState(t) {
  const tp = tpOf(t); const r = rawShot(tp);
  const S = { t, tp, camX: r.x, k: kOf(t), Z: 1, zsrc: [0, 0], zdst: [0, 0], dim: 1, desat: 0, bright: 1, grain: 1, vig: 1, wipe: null, cryA: 'none', cryB: null, drop: 0, seed: Math.round(t * FPS) % 997, focal: 35, pose: null, diag: false };
  let pose = mkPose(r);
  if (t < 12) {
    if (t < 4) S.cryA = 'slide';
    else if (t < 7.75) { S.cryA = 'locked'; S.cryB = 'slide'; S.wipe = wipeHook(t); }
    else S.cryA = 'locked';
    S.desat = ss(8, 8.5, t); S.bright = 1 - 0.55 * ss(8, 8.5, t); S.dim = 1 - ss(11.75, 12.05, t);
  } else if (t < 18) S.dim = 0;
  else if (t < 38) {
    S.dim = ss(18, 18.5, t); S.Z = 1 + 0.12 * (1 - eout((t - 18) / 0.9));
    const z = eio((t - 24.0) / 0.8) - eio((t - 30.0) / 0.9);
    if (z > 0) { S.Z = 1 + 4 * z; S.zsrc = [HERO_MID[0] * z, HERO_MID[1] * z]; S.zdst = [0, 0.12 * z]; S.zoom = z; }
  } else if (t < 58) {
    if (t >= 47 && t < 57.6) { const u = eio((t - 47) / 1.6); r.pitch -= 1.05 * u; r.y += 12 * u; r.z += 3 * u; pose = mkPose(r); S.dim = 1 - ss(47.2, 48.3, t); S.grain = S.dim; }
    if (t >= 57.6) { S.dim = ss(57.6, 58.2, t); S.Z = 1 + 0.14 * (1 - eout((t - 57.6) / 0.9)); }
  } else if (t < 74) {
    S.dim = 1 - ss(73.7, 74.0, t); S.Z = 1 + 0.1 * ss(73.6, 74.0, t);
  } else if (t < 100) {
    const plateCut = (t >= 81.5 && t < 87.4) || (t >= 89.0 && t < 90.2) || (t >= 91.4 && t < 92.6) || (t >= 93.6 && t < 96.6);
    if (!plateCut) { S.diag = true; pose = solveCamPose(t); S.focal = 32; S.dim = t > 96.6 ? 0.32 * ss(96.9, 98.3, t) : 0; }
  } else if (t < 120) {
    const cut = t >= 105.2 && t < 108.6 ? [105.2, 28] : t >= 110.6 && t < 113.0 ? [110.6, 57] : null;
    if (cut) { const f = lerp(35, cut[1], eout((t - cut[0]) / 1.1)); r.z = 2.4 + (r.z - 2.4) * f / 35; pose = mkPose(r); S.focal = f; S.wrongF = cut[1]; }
    else { S.dim = 0; S.graph = true; }
  } else if (t < 138) {
    S.diag = true; S.focal = 32; pose = scaleCamPose(t, XF6(t).sc); S.dim = 0.32 * ss(134.0, 135.5, t);
    // push in on the 1 m box for the ruler beat
    const u = eio((t - 130.1) / 0.9) - eio((t - 131.9) / 1.4);
    if (u > 0) { const xf = XF6(t); const c = xf(BOXA[0].p.clone().lerp(BOXA[1].p, 0.5)); const near = lookPose(c.clone().add(V3(-1.0, 0.9, 2.3)), c); pose = lerpPose(pose, near, u); }
  } else if (t < 154) {
    if (t < 144.4) {
      S.diag = true; const a = scaleCamPose(138), b = closeCamPose(t);
      pose = lerpPose(a, b, eio((t - 138) / 2.2)); S.focal = 32;
      const u = eio((t - 142.6) / 1.8); pose = lerpPose(pose, mkPose(r), u); S.focal = lerp(32, 35, u);
      S.dim = lerp(0.32, 1, ss(143.4, 144.4, t)); S.fly = u;
    } else {
      const a = t - 144.9;
      if (a >= 0) { S.cryA = 'locked'; S.drop = a < 0.4 ? 7 * Math.pow(1 - a / 0.4, 2) : a < 0.9 ? 0.22 * Math.abs(Math.sin((a - 0.4) / 0.5 * Math.PI * 2)) * (1 - (a - 0.4) / 0.5) : 0; }
      if (t >= 149.6 && t < 151.9) { S.cryB = 'slide'; S.wipe = wipeEnd(t); }
      S.dim = 1 - ss(153.7, 154.15, t); S.Z = 1 + 0.08 * ss(153.6, 154.15, t);
    }
  } else S.dim = 0;
  if (S.diag) { S.k = 0; S.grain = t >= 143.4 && t < 144.4 ? ss(143.4, 144.4, t) : 0; S.vig = S.grain; }
  S.pose = pose; S.cam = applyPose(viewCam, pose, S.focal);
  return S;
}

// ───────────────────────── 2D drawing primitives
const FONT = { mono: '"JetBrains Mono"', sans: 'Inter', disp: '"Inter Display"' };
function setFont(size, font = 'mono', weight = 600, ls = 0) { ctx.font = `${weight} ${size}px ${FONT[font]}`; ctx.letterSpacing = ls + 'px'; }
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function T(str, x, y, o = {}) {
  const { size = 40, font = 'mono', weight = 600, color = C.white, align = 'left', alpha = 1, ls = 0, bg = 0, glow = 0, base = 'alphabetic' } = o;
  if (alpha <= 0.003) return 0;
  ctx.save(); ctx.globalAlpha *= alpha; setFont(size, font, weight, ls); ctx.textAlign = align; ctx.textBaseline = base;
  const w = ctx.measureText(str).width - ls;
  if (bg) { const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x; ctx.fillStyle = `rgba(9,13,24,${bg})`; rrect(x0 - size * 0.32, y - size * 0.98, w + size * 0.64, size * 1.36, size * 0.2); ctx.fill(); }
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillStyle = color; ctx.fillText(str, x, y); ctx.restore(); return w;
}
function tw(str, size, font = 'mono', weight = 600, ls = 0) { ctx.save(); setFont(size, font, weight, ls); const w = ctx.measureText(str).width - ls; ctx.restore(); return w; }
function line(pts, color, lw = 3, alpha = 1, dash = null, glow = 0) {
  if (alpha <= 0.003 || pts.length < 2) return;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; if (dash) ctx.setLineDash(dash);
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); ctx.restore();
}
function dot(x, y, r, color, alpha = 1, glow = 0) { if (alpha <= 0.003) return; ctx.save(); ctx.globalAlpha *= alpha; if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; } ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.restore(); }
function ring(x, y, r, color, lw = 3, alpha = 1) { if (alpha <= 0.003 || r <= 0) return; ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.restore(); }
function tracker(x, y, s, color, alpha = 1, lw = 4) {
  if (alpha <= 0.003) return; ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6;
  ctx.strokeRect(x - s / 2, y - s / 2, s, s); const c = s * 0.16; ctx.beginPath(); ctx.moveTo(x - c, y); ctx.lineTo(x + c, y); ctx.moveTo(x, y - c); ctx.lineTo(x, y + c); ctx.stroke(); ctx.restore();
}
function xmark(x, y, s, color, alpha = 1, lw = 5) {
  if (alpha <= 0.003) return; ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.moveTo(x - s / 2, y - s / 2); ctx.lineTo(x + s / 2, y + s / 2); ctx.moveTo(x + s / 2, y - s / 2); ctx.lineTo(x - s / 2, y + s / 2); ctx.stroke(); ctx.restore();
}
function check(x, y, s, color, alpha = 1, lw = 6) {
  if (alpha <= 0.003) return; ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s * 0.02); ctx.lineTo(x - s * 0.14, y + s * 0.38); ctx.lineTo(x + s * 0.5, y - s * 0.38); ctx.stroke(); ctx.restore();
}
function badge(x, y, r, ok, alpha = 1) {
  if (alpha <= 0.003) return; const col = ok ? C.mint : C.coral;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = 'rgba(9,13,24,0.82)'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = r * 0.13; ctx.shadowColor = col; ctx.shadowBlur = 18; ctx.stroke(); ctx.restore();
  ctx.save(); ctx.globalAlpha *= alpha; if (ok) check(x, y, r * 0.95, col, 1, r * 0.2); else { ctx.shadowBlur = 0; xmark(x, y, r * 0.8, col, 1, r * 0.2); } ctx.restore();
}
// label followed by a ✓ / ✕ / ? drawn as vector marks; returns total width. align: 'left' | 'center'
function labelMark(str, mark, x, y, o = {}) {
  const { size = 64, color = C.white, alpha = 1, align = 'center', bg = 0.6, weight = 700 } = o; if (alpha <= 0.003) return;
  const w = tw(str, size, 'mono', weight), gap = size * 0.35, mw = mark ? size * 0.7 : 0, total = w + (mark ? gap + mw : 0);
  const x0 = align === 'center' ? x - total / 2 : x;
  ctx.save(); ctx.globalAlpha *= alpha;
  if (bg) { ctx.fillStyle = `rgba(9,13,24,${bg})`; rrect(x0 - size * 0.4, y - size * 1.02, total + size * 0.8, size * 1.42, size * 0.22); ctx.fill(); }
  T(str, x0, y, { size, color, weight });
  const mx = x0 + w + gap + mw / 2, my = y - size * 0.34;
  if (mark === 'ok') check(mx, my, mw, color, 1, size * 0.11); else if (mark === 'x') xmark(mx, my, mw * 0.8, color, 1, size * 0.11);
  ctx.restore();
}
// wireframe film camera, in its own little perspective
function wireCam(cx, cy, scale, yaw, pitch, color, alpha = 1, lw = 4, glow = 0) {
  if (alpha <= 0.003) return;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const pr = ([x, y, z]) => { let X = x * cyw + z * syw, Z = -x * syw + z * cyw; let Y = y * cp - Z * sp; Z = y * sp + Z * cp; const f = 3.2 / (3.2 + Z); return [cx + X * f * scale, cy - Y * f * scale]; };
  const box = (x0, x1, y0, y1, z0, z1) => { const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(pr);
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) line([c[a], c[b]], color, lw, 1, null, glow); };
  ctx.save(); ctx.globalAlpha *= alpha;
  box(-0.34, 0.34, -0.3, 0.3, -0.35, 0.75);            // body
  box(-0.2, 0.2, 0.3, 0.52, 0.05, 0.6);                 // magazine
  const a = [[-0.14, -0.14, -0.35], [0.14, -0.14, -0.35], [0.14, 0.14, -0.35], [-0.14, 0.14, -0.35]].map(pr);
  const b = [[-0.44, -0.27, -1.0], [0.44, -0.27, -1.0], [0.44, 0.27, -1.0], [-0.44, 0.27, -1.0]].map(pr);
  for (let i = 0; i < 4; i++) { line([a[i], b[i]], color, lw, 1, null, glow); line([b[i], b[(i + 1) % 4]], color, lw, 1, null, glow); }
  ctx.restore();
}
// world-space helpers for the 3D diagram views
function seg3(a, b, S, color, lw = 3, alpha = 1, dash = null, glow = 0) { const pa = toPx(a, S), pb = toPx(b, S); if (pa && pb) line([pa, pb], color, lw, alpha, dash, glow); }
function poly3(pts, S, color, lw = 3, alpha = 1, glow = 0) { const pp = []; for (const p of pts) { const q = toPx(p, S); if (!q) return; pp.push(q); } line(pp, color, lw, alpha, null, glow); }
function frustum3(pose, focal, len, S, color, alpha = 1, lw = 4, xf = ID, sc = 1) {
  const th = SENSOR_W / 2 / focal, tv = th / ASPECT; const L = len * sc;
  const loc = [[0, 0, 0], [-th, -tv, -1], [th, -tv, -1], [th, tv, -1], [-th, tv, -1]].map(v => xf(V3(v[0] * len, v[1] * len, v[2] * len).applyQuaternion(pose.q).add(pose.p)));
  for (let i = 1; i <= 4; i++) { seg3(loc[0], loc[i], S, color, lw, alpha, null, 10); seg3(loc[i], loc[i % 4 + 1], S, color, lw, alpha, null, 10); }
  const bx = 0.16 * len, bz = 0.42 * len;
  const body = [[-bx, -bx, 0], [bx, -bx, 0], [bx, bx, 0], [-bx, bx, 0], [-bx, -bx, bz], [bx, -bx, bz], [bx, bx, bz], [-bx, bx, bz]].map(v => xf(V3(...v).applyQuaternion(pose.q).add(pose.p)));
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) seg3(body[a], body[b], S, color, lw, alpha);
  return loc[0];
}
function grid3(S, alpha, xf = ID, ext = 60, step = 6, color = '#6f86c9') {
  if (alpha <= 0.003) return;
  for (let v = -ext; v <= ext; v += step) { seg3(xf(V3(v, 0, -ext - 20)), xf(V3(v, 0, ext - 30)), S, color, 1.5, alpha * (v === 0 ? 1.6 : 1)); seg3(xf(V3(-ext, 0, v - 25)), xf(V3(ext, 0, v - 25)), S, color, 1.5, alpha); }
}
function boxesWire(S, alpha, xf = ID, color = C.cyan) {
  for (const b of plate.boxes) { const c = b.corners.map(xf);
    for (const [i, j] of [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) seg3(c[i], c[j], S, color, 2, alpha); }
}

// ───────────────────────── shared overlays
function plateLabel(S, alpha) {
  if (alpha <= 0.003) return;
  T('PLATE SHOT_042  24 fps', W - 56, 70, { size: 36, align: 'right', color: C.white, alpha: alpha * 0.92, bg: 0.5, weight: 500 });
  T('F ' + (1001 + Math.floor(S.tp * 24 + 1e-4)), W - 56, 126, { size: 36, align: 'right', color: C.mint, alpha, bg: 0.5, weight: 700 });
}
function chapterCard(t) {
  const ci = CH.findIndex((c, i) => t >= c.t && t < CH[i + 1].t); const c = CH[ci]; if (!c || !c.tag) return;
  const a = t - c.t, end = CH[ci + 1].t; const inn = eout(a / 0.45), mv = eio((a - 3.0) / 0.6), fade = 1 - ss(end - 0.3, end - 0.02, t);
  let ts = 112; const maxW = 1560; const w0 = tw(c.title, ts, 'disp', 800, -1); if (w0 > maxW) ts *= maxW / w0;
  const wT = tw(c.title, ts, 'disp', 800, -1), wG = tw(c.tag, 46, 'mono', 700, 6);
  ctx.save(); ctx.globalAlpha = inn * fade;
  if (mv < 1) { const g = ctx.createLinearGradient(0, 300, 0, 700); const al = 0.72 * (1 - mv); g.addColorStop(0, 'rgba(9,13,24,0)'); g.addColorStop(0.25, `rgba(9,13,24,${al})`); g.addColorStop(0.75, `rgba(9,13,24,${al})`); g.addColorStop(1, 'rgba(9,13,24,0)'); ctx.fillStyle = g; ctx.fillRect(0, 300, W, 400); }
  const sT = lerp(1, 40 / ts, mv), sG = lerp(1, 34 / 46, mv);
  if (mv > 0) { ctx.fillStyle = `rgba(9,13,24,${0.55 * mv})`; rrect(36, 26, Math.max(wT * 40 / ts, wG * 34 / 46) + 44, 112, 12); ctx.fill(); }
  const yo = (1 - inn) * 30;
  ctx.save(); ctx.translate(lerp(W / 2 - wG / 2, 58, mv), lerp(452, 68, mv) + yo); ctx.scale(sG, sG); T(c.tag, 0, 0, { size: 46, weight: 700, color: C.mint, ls: 6 }); ctx.restore();
  ctx.save(); ctx.translate(lerp(W / 2 - wT / 2, 58, mv), lerp(578, 120, mv) + yo); ctx.scale(sT, sT); T(c.title, 0, 0, { size: ts, font: 'disp', weight: 800, ls: -1 }); ctx.restore();
  ctx.restore();
}
function progressBar(t) {
  const x0 = 40, x1 = W - 40, y = 1064, h = 7, gap = 6;
  for (let i = 0; i < CH.length - 1; i++) {
    const a = x0 + (x1 - x0) * CH[i].t / DUR + (i ? gap / 2 : 0), b = x0 + (x1 - x0) * CH[i + 1].t / DUR - gap / 2;
    ctx.fillStyle = 'rgba(244,247,255,0.16)'; rrect(a, y, b - a, h, 3); ctx.fill();
    const u = sat((t - CH[i].t) / (CH[i + 1].t - CH[i].t)); if (u > 0) { ctx.fillStyle = C.mint; ctx.globalAlpha = u < 1 ? 1 : 0.6; rrect(a, y, Math.max(h, (b - a) * u), h, 3); ctx.fill(); ctx.globalAlpha = 1; }
  }
}
let TL = [];
function captions(t) {
  for (const l of TL) for (const c of l.caps) if (t >= c.s - 0.03 && t < c.hold) {
    const a = Math.min(sat((t - c.s + 0.03) / 0.1), sat((c.hold - t) / 0.1));
    ctx.save(); ctx.globalAlpha = a; setFont(50, 'sans', 600); const w = ctx.measureText(c.text).width;
    ctx.fillStyle = 'rgba(6,9,18,0.66)'; rrect(W / 2 - w / 2 - 30, 950, w + 60, 78, 14); ctx.fill();
    T(c.text, W / 2, 1006, { size: 50, font: 'sans', weight: 600, align: 'center' }); ctx.restore(); return;
  }
}
function wipeLine(x, alpha = 1) {
  if (x < -10 || x > W + 10) return;
  line([[x, 0], [x, H]], '#ffffff', 5, alpha, null, 22);
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 16; rrect(x - 9, 470, 18, 110, 9); ctx.fill(); ctx.restore();
}
function crystalBadges(S, t, pulse = 1) {
  const top = m => toPx(plate.crystalPos(m, S.camX, S.tp, S.drop).add(V3(0, 2.05, 0)), S);
  const r = 50 * (1 + 0.1 * Math.sin(t * 7) * pulse);
  const draw = (mode, x0, x1) => { const p = top(mode); if (!p) return; ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, H); ctx.clip(); badge(p[0], p[1], r, mode === 'locked'); ctx.restore(); };
  if (S.wipe != null && S.cryB) { draw(S.cryA, 0, S.wipe); draw(S.cryB, S.wipe, W); } else if (S.cryA !== 'none') draw(S.cryA, 0, W);
}
function trail(f, S, t0, t1, color, lw, alphaFn) {
  let prev = null; const n = Math.max(1, Math.round((t1 - t0) * 30));
  for (let i = 0; i <= n; i++) { const tt = lerp(t0, t1, i / n); const p = toPx(f.p, S, camAt(tpOf(tt))); if (prev && p) line([prev, p], color, lw, alphaFn(i / n)); prev = p; }
}

// ───────────────────────── chapter overlays
function ovHook(t, S) {
  plateLabel(S, 1 - ss(8, 8.4, t));
  if (t < 8) { crystalBadges(S, t); if (S.wipe != null) wipeLine(S.wipe); }
  else {
    const a = eout((t - 8.3) / 0.5) * (1 - ss(11.7, 12.0, t));
    wireCam(W / 2 - 170, 450, 300 * lerp(0.7, 1, a), -0.75 + 0.35 * Math.sin((t - 8) * 0.9), 0.28 + 0.06 * Math.sin(t * 1.3), C.orange, a, 6, 14);
    const pq = eback((t - 8.7) / 0.45) * (1 - ss(11.7, 12.0, t));
    ctx.save(); ctx.translate(W / 2 + 400, 560); ctx.scale(pq * (1 + 0.05 * Math.sin(t * 5)), pq * (1 + 0.05 * Math.sin(t * 5)));
    T('?', 0, 0, { size: 340, font: 'disp', weight: 900, align: 'center', color: C.white, glow: 30, alpha: sat(pq) }); ctx.restore();
  }
}
function ovTitle(t) {
  const a = t - 12, fade = 1 - ss(17.6, 18.0, t);
  const rnd = mulberry(1000 + Math.floor(a * 30 / 5));
  for (let i = 0; i < 4; i++) wireCam(140 + rnd() * 1640, 150 + rnd() * 640, 90 + rnd() * 110, rnd() * 6.28, rnd() * 0.8 - 0.2, C.orange, (0.16 + rnd() * 0.2) * fade * sat(a / 0.3), 3);
  const fl = [24, 85, 50, 35, 18, 70, 28, 40, 100, 21]; const f = fl[Math.floor(a * 30 / 9) % fl.length];
  T(f + 'mm', W / 2, 800, { size: 96, weight: 700, align: 'center', color: C.orange, alpha: 0.85 * fade * sat((a - 0.5) / 0.3) });
  const s = lerp(3.2, 1, eout((a - 0.15) / 0.22)); const al = sat((a - 0.15) / 0.08) * fade;
  const sh = a > 0.37 && a < 0.7 ? Math.sin(a * 90) * 9 * (1 - (a - 0.37) / 0.33) : 0;
  ctx.save(); ctx.translate(W / 2 + sh, 560); ctx.scale(s, s);
  let sz = 250; const w = tw('MATCHMOVE', sz, 'disp', 900, -4); if (w > 1560) sz *= 1560 / w;
  T('MATCHMOVE', 0, 70, { size: sz, font: 'disp', weight: 900, align: 'center', ls: -4, alpha: al }); ctx.restore();
  T('VFX EXPLAINED', W / 2, 378, { size: 44, weight: 700, align: 'center', color: C.mint, ls: 14, alpha: fade * eout((a - 0.5) / 0.4) });
}
function ovTrack(t, S) {
  plateLabel(S, S.dim);
  const z = S.zoom || 0;
  const others = (1 - z) * (t >= 38 ? 1 - ss(39.6, 40.6, t) : 1);
  const trA = t >= 38 ? others : ss(30.7, 31.6, t) * (1 - z);
  for (const f of F) {
    const ap = t - (20.3 + f.ord * 0.065); if (ap < 0) continue;
    const special = f === HERO || (t >= 38 && f === FAR);
    const p = toPx(f.p, S); if (!p) continue;
    if (special && t >= 38) continue;
    const al = f === HERO ? 1 : others; if (al <= 0.003) continue;
    if (trA > 0.01 && f !== HERO || (f === HERO && trA > 0.01)) trail(f, S, t - 0.9, t, C.mint, 4, u => trA * u * 0.9);
    if (f === HERO && z > 0.001) continue;
    const s = 44 * (1 + 1.3 * (1 - eout(ap / 0.3)));
    tracker(p[0], p[1], s, C.mint, al * sat(ap / 0.12));
  }
  if (z > 0.001) {         // close-up: pattern box inside its search area, re-found on every frame
    const cur = toPx(HERO.p, S); const stepping = t >= 24.8 && t < 30;
    let pat = cur, sea = cur, flash = 0;
    if (stepping) {
      const ph = ((t - 24.8) / 5.2 * 18) % 1; const prev = toPx(HERO.p, S, camAt(S.tp - 1 / 24));
      const u1 = eout((ph - 0.22) / 0.28), u2 = eio((ph - 0.5) / 0.4);
      pat = [lerp(prev[0], cur[0], u1), lerp(prev[1], cur[1], u1)]; sea = [lerp(prev[0], cur[0], u2), lerp(prev[1], cur[1], u2)];
      flash = ph > 0.5 ? 1 - sat((ph - 0.5) / 0.3) : 0;
      if (ph < 0.22) ring(cur[0], cur[1], 14 + ph * 120, C.white, 3, 0.6 * (1 - ph / 0.22));
    }
    const ps = lerp(44, 150, z), sw = lerp(60, 430, z);
    ctx.save(); ctx.globalAlpha = z; ctx.strokeStyle = C.mint; ctx.lineWidth = 4; ctx.setLineDash([18, 12]); ctx.strokeRect(sea[0] - sw / 2, sea[1] - sw / 2, sw, sw); ctx.restore();
    if (flash > 0) { ctx.save(); ctx.globalAlpha = flash * 0.25; ctx.fillStyle = C.mint; ctx.fillRect(pat[0] - ps / 2, pat[1] - ps / 2, ps, ps); ctx.restore(); }
    tracker(pat[0], pat[1], ps, C.mint, 1, lerp(4, 7, z));
    const la = ss(0.85, 1, z);
    T('SEARCH AREA', sea[0] - sw / 2, sea[1] - sw / 2 - 18, { size: 40, color: C.mint, alpha: la * 0.9, bg: 0.55 });
    T('PATTERN', pat[0], pat[1] + ps / 2 + 52, { size: 40, color: C.white, alpha: la, align: 'center', bg: 0.55 });
  }
  if (t < 38) labelMark(`${F.length} TRACKS`, null, W / 2, 190, { size: 60, color: C.mint, alpha: ss(31.4, 32.0, t) * (1 - ss(37.3, 37.8, t)) });
}
function ovParallax(t, S) {
  plateLabel(S, S.dim * (t < 47.2 || t > 57.6 ? 1 : 0));
  if (t < 48.4) {
    ctx.save(); ctx.globalAlpha = S.dim;
    ovTrack(t, S);
    const m = ss(39.6, 40.6, t); const t0 = 41.5, t1 = Math.min(t, 46.0);
    for (const [f, col, name, dy] of [[HERO, C.orange, 'NEAR', 96], [FAR, C.cyan, 'FAR', -62]]) {
      const p = toPx(f.p, S); if (!p) continue;
      let len = 0;
      if (t > t0) {
        const start = toPx(f.p, S, camAt(tpOf(t0))); let prev = start; const n = Math.round((t1 - t0) * 30);
        const pts = [start]; for (let i = 1; i <= n; i++) { const q = toPx(f.p, S, camAt(tpOf(lerp(t0, t1, i / n)))); len += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; pts.push(q); }
        line(pts, col, 9, 0.95, null, 16); dot(start[0], start[1], 11, col); ring(start[0], start[1], 20, col, 3, 0.7);
      }
      if (m < 1) tracker(p[0], p[1], 44, C.mint, 1 - m);
      tracker(p[0], p[1], lerp(44, 70, m), col, m, 6);
      const la = ss(40.9, 41.4, t);
      const lx = Math.max(180, Math.min(W - 180, p[0]));
      if (dy > 0) { T(name, lx, p[1] + dy, { size: 64, weight: 800, color: col, align: 'center', alpha: la, bg: 0.6 });
        if (t > t0 + 0.3) T(`${Math.round(len)} px`, lx, p[1] + dy + 66, { size: 46, weight: 600, color: C.white, align: 'center', alpha: sat((t - t0 - 0.3) / 0.3), bg: 0.6 }); }
      else { T(name, p[0] + 70, p[1] + 22, { size: 64, weight: 800, color: col, alpha: la, bg: 0.6 });
        if (t > t0 + 0.3) T(`${Math.round(len)} px`, p[0] + 70, p[1] + 88, { size: 46, weight: 600, color: C.white, alpha: sat((t - t0 - 0.3) / 0.3), bg: 0.6 }); }
    }
    ctx.restore();
  }
  // top-down schematic
  const a = ss(47.8, 48.7, t) * (1 - ss(57.2, 57.7, t)); if (a <= 0.003) return;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - eout((t - 47.8) / 0.9)) * 70);
  for (let y = 170; y <= 820; y += 65) line([[120, y], [1800, y]], '#6f86c9', 1.5, 0.22);
  for (let x = 120; x <= 1800; x += 140) line([[x, 170], [x, 820]], '#6f86c9', 1.5, 0.22);
  const cx = W / 2 + 240 * Math.sin((t - 48.2) * 2 * Math.PI / 4.2), cy = 820; const near = [W / 2, 680], far = [W / 2, 190];
  line([[W / 2 - 340, cy], [W / 2 + 340, cy]], C.orange, 3, 0.55, [14, 12]);
  line([[cx, cy], [cx, 150]], C.white, 2, 0.35, [8, 10]);                       // camera forward axis
  const items = [[near, C.orange, 'NEAR', 110], [far, C.cyan, 'FAR', 300]];
  for (const [pt, col, name, rad] of items) {
    line([[cx, cy], pt], col, 5, 0.95, null, 12);
    const ang = Math.atan2(pt[0] - cx, cy - pt[1]);
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + ang, ang < 0); ctx.stroke();
    ctx.globalAlpha *= 0.16; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + ang, ang < 0); ctx.fill(); ctx.restore();
    dot(pt[0], pt[1], 17, col, 1, 20); ring(pt[0], pt[1], 30, col, 3, 0.6);
    const ly = pt[1] + (name === 'NEAR' ? -34 : 20); T(name, pt[0] + 60, ly, { size: 60, weight: 800, color: col });
    const deg = Math.round(Math.abs(ang) * 180 / Math.PI);
    T(`${deg < 10 ? ' ' : ''}${deg}°`, pt[0] + 60 + tw(name + ' ', 60, 'mono', 800), ly, { size: 60, weight: 600, color: C.white });
  }
  // camera icon (top view)
  ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = C.navy; ctx.strokeStyle = C.orange; ctx.lineWidth = 5; ctx.shadowColor = C.orange; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(-34, -40); ctx.lineTo(34, -40); ctx.lineTo(14, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
  rrect(-30, -8, 60, 46, 6); ctx.fill(); ctx.stroke(); ctx.restore();
  T('CAMERA', cx, cy + 82, { size: 40, weight: 700, color: C.orange, align: 'center' });
  ctx.restore();
}
function ovLens(t, S) {
  plateLabel(S, S.dim);
  const ga = ss(59.2, 60.2, t) * (1 - ss(73.3, 73.8, t)); const straight = S.k < 0.004;
  if (ga > 0) {
    const col = straight ? C.mint : '#e8ecff';
    for (let gx = -2.25; gx <= 2.26; gx += 0.25) { const pts = []; for (let i = 0; i <= 40; i++) pts.push(uToPx(gx, -1.5 + 3 * i / 40, S)); line(pts, col, 2.5, ga * 0.5); }
    for (let gy = -1.25; gy <= 1.26; gy += 0.25) { const pts = []; for (let i = 0; i <= 60; i++) pts.push(uToPx(-2.4 + 4.8 * i / 60, gy, S)); line(pts, col, 2.5, ga * 0.5); }
    for (const e of EDGES) {
      const pts = []; for (let i = 0; i <= 14; i++) { const p = toPx(e.top.clone().lerp(e.bot, i / 14), S); if (p) pts.push(p); }
      if (pts.length < 2) continue; const ea = ga * ss(60.4, 61.0, t);
      if (!straight) line([pts[0], pts[pts.length - 1]], C.white, 3, ea * 0.9, [12, 10]);
      line(pts, straight ? C.mint : C.coral, 7, ea, null, 14);
    }
  }
  const mis = t >= 68.8 && t < 73.1;
  if (mis) {
    const a = ss(68.9, 69.3, t) * (1 - ss(72.9, 73.1, t));
    for (const f of F) { const u = projU(f.p, S.cam); const p = uToPx(u.x, u.y, S); const q = uToPx(u.x, u.y, { ...S, k: 0 });
      line([p, q], C.coral, 3, a * 0.8); tracker(p[0], p[1], 40, C.mint, a); xmark(q[0], q[1], 30, C.coral, a); }
  }
  const lab = (a, str, mark, col) => labelMark(str, mark, W / 2, 205, { size: 64, color: col, alpha: a });
  lab(ss(60.3, 60.7, t) * (1 - ss(63.1, 63.3, t)), 'DISTORTED', null, C.coral);
  lab(ss(63.4, 63.7, t) * (1 - ss(68.6, 68.8, t)), 'UNDISTORTED', 'ok', C.mint);
  lab(ss(69.1, 69.4, t) * (1 - ss(72.3, 72.5, t)), 'MISMATCH', 'x', C.coral);
  lab(ss(72.8, 73.1, t) * (1 - ss(73.5, 73.8, t)), 'UNDISTORTED', 'ok', C.mint);
}
function errReadout(t, st) {
  if (t < 85.5) return; const a = ss(85.5, 85.9, t);
  if (t < 94.9) {
    const col = st.err < 1 ? C.mint : C.coral; const s = `ERROR ${fmtErr(st.err)} px`;
    labelMark(s, null, W / 2, 210, { size: 84, color: col, alpha: a, bg: 0.7 });
  } else { const p = eback((t - 94.9) / 0.4); ctx.save(); ctx.translate(W / 2, 185); ctx.scale(0.8 + 0.2 * p, 0.8 + 0.2 * p); labelMark('CONVERGED', 'ok', 0, 25, { size: 84, color: C.mint, bg: 0.7, alpha: (1 - ss(99.6, 99.95, t)) }); ctx.restore(); }
}
function ovSolve(t, S) {
  const st = solveStage(t);
  if (S.diag) {
    const late = t > 96.6; const ia = late ? ss(96.6, 96.9, t) : 1;
    grid3(S, 0.2 * ia);
    const est = mkPose(SOLVE.estRaw(S.tp, st.e));
    F.forEach((f, i) => {
      const ap = late ? 1 : sat((t - 74.25 - f.ord * 0.03) / 0.25); if (ap <= 0) return;
      const P = SOLVE.P(i, st.e); const p = toPx(P, S); if (!p) return;
      const g = toPx(P.clone().setY(0), S); if (g && !late) line([p, g], C.cyan, 1.5, 0.22 * ap);
      const r = Math.max(5, 420 / p.depth) * (0.4 + 0.6 * eback(ap));
      dot(p[0], p[1], r, C.cyan, ia, 14);
    });
    if (late) { boxesWire(S, 0.5 * ia); const path = []; for (let i = 0; i <= 90; i++) path.push(shotPose(S.tp - 4.5 + i * 0.1).p); poly3(path, S, C.orange, 4, 0.9 * ia, 10); }
    const ca = late ? ia : eout((t - 75.6) / 0.5);
    const apex = toPx(frustum3(est, 35, late ? 3.2 : 8, S, C.orange, ca, 4), S);
    if (!late) {
      labelMark('3D POINTS ?', null, 420, 330, { size: 60, color: C.cyan, alpha: ss(76.9, 77.3, t) * (t < 87 ? 1 - ss(81.2, 81.5, t) : 0), bg: 0.5 });
      if (apex) labelMark('CAMERA ?', null, Math.min(W - 260, apex[0] + 40), apex[1] - 120, { size: 60, color: C.orange, alpha: ss(79.0, 79.4, t) * (t < 87 ? 1 - ss(81.2, 81.5, t) : 0), bg: 0.5 });
    }
  } else {
    plateLabel(S, 1);
    const estCam = applyPose(new THREE.PerspectiveCamera(30, ASPECT, 0.1, 1500), mkPose(SOLVE.estRaw(S.tp, st.e)), 35);
    const done = t >= 93.6; const lg = t < 87.4 ? eout((t - 84.9) / 0.9) : 1;
    F.forEach((f, i) => {
      const p = toPx(f.p, S); const q = toPx(SOLVE.P(i, st.e), S, estCam);
      const ap = t < 87.4 ? sat((t - 81.75 - f.ord * 0.045) / 0.2) : 1;
      if (q && ap > 0 && !done) { if (lg > 0) line([p, [lerp(p[0], q[0], lg), lerp(p[1], q[1], lg)]], C.coral, 2.5, 0.65); xmark(q[0], q[1], 30 * (2 - eout(ap)), C.coral, ap); }
      const fl = done ? 1 - sat((t - 93.6) / 0.5) : 0;
      tracker(p[0], p[1], 44 + fl * 26, C.mint, 1, 4 + fl * 3);
      if (done && q) xmark(q[0], q[1], 22, C.mint, 0.9, 4);
    });
  }
  errReadout(t, st);
}
const GR = { x0: 250, x1: 1700, y0: 240, y1: 790, fx: f => 250 + Math.log(f / 18) / Math.log(85 / 18) * 1450, err: f => 0.21 + 30 * Math.pow(Math.log(f / 35), 2), ey: e => 790 - e / 26 * 550 };
function focalAt(t) {
  const lf = (a, b, u) => Math.exp(lerp(Math.log(a), Math.log(b), u));
  if (t < 103.3) return 50 + 2.5 * Math.sin((t - 100) * 2.2);
  if (t < 108.8) return lf(50, 28, eio((t - 103.3) / 1.7));
  if (t < 113.2) return lf(28, 57, eio((t - 108.75) / 1.7));
  const u = (t - 113.3) / 2.2; if (u >= 1) return 35;
  return lf(57, 35, eio(u)) * (1 + 0.0 * u);
}
function ovFocal(t, S) {
  if (S.graph) {
    const g = GR; const ain = ss(100.0, 100.5, t) * (1 - ss(119.6, 119.95, t));
    ctx.save(); ctx.globalAlpha = ain;
    for (let e = 0; e <= 25; e += 5) { line([[g.x0, g.ey(e)], [g.x1, g.ey(e)]], '#6f86c9', 1.5, e ? 0.2 : 0); if (e) T(String(e), g.x0 - 24, g.ey(e) + 14, { size: 38, color: C.dim, align: 'right', weight: 500 }); }
    line([[g.x0, g.y0 - 40], [g.x0, g.y1], [g.x1 + 30, g.y1]], C.white, 3, 0.8);
    for (const f of [18, 24, 35, 50, 85]) { const x = g.fx(f); line([[x, g.y1], [x, g.y1 + 14]], C.white, 3, 0.8); T(String(f), x, g.y1 + 62, { size: 42, align: 'center', color: f === 35 && t > 115.3 ? C.mint : C.white, weight: f === 35 && t > 115.3 ? 800 : 500 }); }
    T('FOCAL LENGTH  mm', g.x1 + 30, g.y1 + 112, { size: 36, align: 'right', color: C.dim, weight: 600, ls: 2 });
    T('ERROR  px', g.x0 - 60, g.y0 - 66, { size: 36, color: C.dim, weight: 600, ls: 2 });
    const cu = eio((t - 100.3) / 1.2); const pts = []; for (let i = 0; i <= 160 * cu; i++) { const f = 18 * Math.pow(85 / 18, i / 160); const e = g.err(f); if (e <= 27) pts.push([g.fx(f), g.ey(e)]); }
    ctx.save(); ctx.beginPath(); ctx.rect(g.x0, g.y0 - 60, g.x1 - g.x0 + 40, g.y1 - g.y0 + 62); ctx.clip(); line(pts, C.white, 6, 0.95, null, 10); ctx.restore();
    const f = focalAt(t); const mx = g.fx(f), my = g.ey(g.err(f)); const ok = Math.abs(f - 35) < 0.4 && t > 115; const col = ok ? C.mint : C.coral;
    const ma = ss(101.2, 101.6, t);
    line([[mx, my], [mx, g.y1]], col, 3, 0.8 * ma, [10, 9]);
    if (ok) for (let i = 0; i < 2; i++) { const ph = ((t - 115.4) * 0.7 + i * 0.5) % 1; ring(mx, my, 20 + ph * 90, C.mint, 4, (1 - ph) * 0.8); }
    dot(mx, my, 20, col, ma, 26); ring(mx, my, 20, C.white, 3, ma);
    if (!ok) labelMark(`${Math.round(f)} mm`, null, mx, my - 56, { size: 60, color: col, alpha: ma, bg: 0.6 });
    if (t > 115.4) { const p = eback((t - 115.4) / 0.45); ctx.save(); ctx.translate(W / 2, 440); ctx.scale(p, p); labelMark('35 mm', 'ok', 0, 0, { size: 150, color: C.mint, bg: 0.0, weight: 800 }); ctx.restore(); }
    ctx.restore();
  } else {
    const trueCam = applyPose(new THREE.PerspectiveCamera(30, ASPECT, 0.1, 1500), shotPose(S.tp), 35);
    let sum = 0;
    for (const f of F) { const p = toPx(f.p, S, trueCam), q = toPx(f.p, S); if (!p || !q) continue; sum += Math.hypot(p[0] - q[0], p[1] - q[1]);
      line([p, q], C.coral, 2.5, 0.7); tracker(p[0], p[1], 44, C.mint, 1); xmark(q[0], q[1], 30, C.coral, 1); }
    labelMark(`${S.wrongF} mm`, 'x', W / 2, 215, { size: 110, color: C.coral, bg: 0.7, weight: 800 });
  }
}
function ovScale(t, S) {
  const xf = XF6(t); const fade = 1;
  grid3(S, 0.22);
  // local ground plane of the solve, once three ground points are picked
  const pa = ss(128.3, 128.8, t) * (1 - ss(133.6, 134.6, t));
  if (pa > 0) { const q = [V3(-26, 0, 8), V3(26, 0, 8), V3(26, 0, -62), V3(-26, 0, -62)].map(xf).map(p => toPx(p, S)); if (q.every(Boolean)) { ctx.save(); ctx.globalAlpha = pa * 0.16; ctx.fillStyle = C.mint; ctx.beginPath(); ctx.moveTo(...q[0]); for (const p of q.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.fill(); ctx.restore(); line([...q, q[0]], C.mint, 3, pa * 0.8); } }
  boxesWire(S, 0.55, xf);
  const path = []; for (let i = 0; i <= 90; i++) path.push(xf(shotPose(S.tp - 4.5 + i * 0.1).p)); poly3(path, S, C.orange, 4, 0.9, 10);
  const sp = shotPose(S.tp); const cq = { p: xf(sp.p), q: xf.q.clone().multiply(sp.q) };
  frustum3(cq, 35, 3.2 * xf.s, S, C.orange, 1, 4);
  for (const f of F) { const p = toPx(xf(f.p), S); if (!p) continue; dot(p[0], p[1], Math.min(13, Math.max(3.5, 360 * Math.sqrt(xf.s) / p.depth)), C.cyan, 1, 12); }
  // "which way is up" arrow, riding on the solve
  const a0 = toPx(xf(V3(0, 0, -8)), S), a1 = toPx(xf(V3(0, 26, -8)), S); const upDone = t > 130.0; const ucol = upDone ? C.mint : C.white;
  const ua = 1 - ss(130.1, 130.7, t);
  if (a0 && a1 && ua > 0) { line([a0, a1], ucol, 5, ua, null, 10); const d = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]); for (const s of [-1, 1]) line([a1, [a1[0] - 26 * Math.cos(d + s * 0.45), a1[1] - 26 * Math.sin(d + s * 0.45)]], ucol, 5, ua); }
  // ground picks
  GROUND3.forEach((f, i) => { const tt = 127.6 + i * 0.3; if (t < tt) return; const p = toPx(xf(f.p), S); if (!p) return; const a = (1 - ss(133.6, 134.4, t));
    dot(p[0], p[1], 9, C.mint, a, 16); ring(p[0], p[1], 16 + 40 * (1 - eout((t - tt) / 0.5)), C.mint, 4, a); });
  if (t > 128.3) { const tri = GROUND3.map(f => toPx(xf(f.p), S)); if (tri.every(Boolean)) line([...tri, tri[0]], C.mint, 3, pa); }
  // 1 m ruler on the box
  const ra = ss(130.5, 130.8, t) * (1 - ss(134.2, 135.0, t));
  if (ra > 0) {
    const p = BOXA.map(f => toPx(xf(f.p), S));
    if (p.every(Boolean)) { BOXA.forEach((f, i) => { const tt = 130.6 + i * 0.3; if (t < tt) return; dot(p[i][0], p[i][1], 10, C.mint, ra, 16); ring(p[i][0], p[i][1], 18 + 40 * (1 - eout((t - tt) / 0.5)), C.mint, 4, ra); });
      if (t > 131.0) { const u = eout((t - 131.0) / 0.4); line([p[0], [lerp(p[0][0], p[1][0], u), lerp(p[0][1], p[1][1], u)]], C.mint, 6, ra, null, 12);
        const mx = (p[0][0] + p[1][0]) / 2, my = Math.min(p[0][1], p[1][1]) - 84; labelMark('1.00 m', null, Math.max(200, Math.min(W - 200, mx)), Math.max(260, my), { size: 68, color: C.mint, alpha: ra * sat((t - 131.1) / 0.3), bg: 0.65 }); } }
  }
  // status labels
  const la = ss(123.3, 123.8, t) * (1 - ss(137.5, 137.95, t));
  const upP = t > 130.0 ? eback((t - 130.0) / 0.35) : 1, scP = t > 133.3 ? eback((t - 133.3) / 0.35) : 1;
  ctx.save(); ctx.translate(150, 380); ctx.scale(upP, upP); labelMark(upDone ? 'UP' : 'UP ?', upDone ? 'ok' : null, 0, 0, { size: 76, color: upDone ? C.mint : C.white, alpha: la, align: 'left', bg: 0.5, weight: 800 }); ctx.restore();
  const scDone = t > 133.3;
  ctx.save(); ctx.translate(150, 500); ctx.scale(scP, scP); labelMark(scDone ? 'SCALE' : 'SCALE ?', scDone ? 'ok' : null, 0, 0, { size: 76, color: scDone ? C.mint : C.white, alpha: la, align: 'left', bg: 0.5, weight: 800 }); ctx.restore();
  // axes gizmo
  const ga = eout((t - 133.6) / 0.6) * (1 - ss(137.5, 137.95, t));
  if (ga > 0) { const o = V3(-10, 0, 7); for (const [d, n] of [[V3(8, 0, 0), 'X'], [V3(0, 8, 0), 'Y'], [V3(0, 0, -8), 'Z']]) { const e = o.clone().add(d.multiplyScalar(ga)); seg3(o, e, S, C.white, 6, ga, null, 8); const p = toPx(e, S); if (p) T(n, p[0] + 14, p[1] - 10, { size: 44, weight: 800, alpha: ga }); } const p0 = toPx(o, S); if (p0) dot(p0[0], p0[1], 8, C.white, ga); }
}
function ovResult(t, S) {
  if (S.diag) {
    const a = 1 - ss(143.3, 144.2, t);
    ctx.save(); ctx.globalAlpha = a;
    grid3(S, 0.2); boxesWire(S, 0.55);
    for (const f of F) { const p = toPx(f.p, S); if (!p) continue; dot(p[0], p[1], Math.max(3.5, Math.min(12, 360 / p.depth)), C.cyan, 1, 12); }
    const path = []; for (let i = 0; i <= 90; i++) path.push(shotPose(S.tp - 4.5 + i * 0.1).p); poly3(path, S, C.orange, 5, 0.95, 12);
    for (let i = 0; i <= 90; i += 5) { const p = toPx(path[i], S); if (p) dot(p[0], p[1], 5, C.white, 0.8); }
    frustum3(shotPose(S.tp), 35, 3.0, S, C.orange, 1 - (S.fly || 0), 5);
    const labs = [['POSITION', 138.5, 470], ['ROTATION', 139.4, 960], ['LENS', 140.1, 1400]];
    labs.forEach(([s, tt, x]) => { if (t < tt) return; const p = eback((t - tt) / 0.35); ctx.save(); ctx.translate(x, 240); ctx.scale(p, p); labelMark(s, 'ok', 0, 0, { size: 64, color: C.orange, bg: 0.55, alpha: 1 - ss(141.0, 141.3, t), weight: 800 }); ctx.restore(); });
    if (t > 141.2) labelMark('FRAME ' + (1001 + Math.floor(S.tp * 24)), 'ok', W / 2, 240, { size: 76, color: C.orange, bg: 0.55, alpha: ss(141.2, 141.5, t) * (1 - ss(142.6, 143.1, t)), weight: 800 });
    ctx.restore();
  }
  if (t >= 143.6) plateLabel(S, ss(143.8, 144.4, t) * S.dim);
  if (t >= 146.5 && t < 154) {
    const pa = eback((t - 146.5) / 0.4) * S.dim;
    ctx.save(); ctx.globalAlpha = sat(pa); crystalBadges(S, t, t > 148.5 && t < 149.5 ? 2 : 0.6); ctx.restore();
    if (S.wipe != null) wipeLine(S.wipe);
    const lk = ss(148.6, 148.9, t) * (1 - ss(149.4, 149.7, t)) + ss(152.0, 152.3, t) * (1 - ss(153.6, 153.9, t));
    labelMark('LOCKED', 'ok', W / 2, 210, { size: 84, color: C.mint, alpha: lk, bg: 0.7, weight: 800 });
  }
}
function ovOutro(t) {
  const a = t - 154; const al = ss(0.1, 0.6, a);
  T('VFX EXPLAINED', 130, 330, { size: 44, weight: 700, color: C.mint, ls: 12, alpha: al });
  ctx.save(); ctx.translate((1 - eout((a - 0.2) / 0.6)) * -60, 0);
  T('NEXT', 130, 470, { size: 60, weight: 700, color: C.dim, alpha: ss(0.3, 0.8, a), ls: 6 });
  T('ROTOSCOPING', 126, 590, { size: 118, font: 'disp', weight: 900, alpha: ss(0.4, 0.9, a), ls: -2 }); ctx.restore();
  // little roto shape teaser: a spline hugging a silhouette, points breathing
  const ra = ss(0.8, 1.4, a); if (ra <= 0) return;
  const bx = 430, by = 900, k = 0.85; const sil = [[-165, 4], [-185, -75], [-105, -105], [-78, -205], [0, -285], [78, -205], [105, -105], [190, -85], [165, 4], [0, 14]].map(([x, y]) => [x * k, y * k]); const n = sil.length;
  ctx.save(); ctx.globalAlpha = ra * 0.55; ctx.fillStyle = C.pink;
  for (const poly of [[[-62, 0], [-70, -195], [0, -262], [70, -195], [62, 0]], [[-150, 0], [-168, -66], [-112, -92], [-70, 0]], [[150, 0], [172, -74], [116, -92], [70, 0]]]) { ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(bx + x * k, by + y * k) : ctx.moveTo(bx + x * k, by + y * k)); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  const settle = 1 - eout((a - 0.9) / 1.6);
  const pts = sil.map(([x, y], i) => [bx + x * (1 + 0.35 * settle) + 7 * Math.sin(a * 1.9 + i * 2.1), by + y * (1 + 0.35 * settle) + 6 * Math.sin(a * 1.5 + i * 1.3)]);
  ctx.save(); ctx.globalAlpha = ra; ctx.beginPath();
  for (let i = 0; i < n; i++) { const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]; if (!i) ctx.moveTo(p1[0], p1[1]);
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]); }
  ctx.closePath(); ctx.fillStyle = 'rgba(74,222,128,0.08)'; ctx.fill(); ctx.strokeStyle = C.mint; ctx.lineWidth = 5; ctx.setLineDash([22, 12]); ctx.lineDashOffset = -a * 50; ctx.shadowColor = C.mint; ctx.shadowBlur = 14; ctx.stroke(); ctx.restore();
  for (const p of pts) { ctx.save(); ctx.globalAlpha = ra; ctx.fillStyle = C.navy; ctx.strokeStyle = C.white; ctx.lineWidth = 4; ctx.fillRect(p[0] - 9, p[1] - 9, 18, 18); ctx.strokeRect(p[0] - 9, p[1] - 9, 18, 18); ctx.restore(); }
}

// ───────────────────────── frame
function renderFrame(t) {
  const S = buildState(t);
  plate.render(S);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, H);
  ctx.drawImage(glc, 0, 0);
  if (S.dim < 0.999 && (S.diag || S.graph || (t >= 12 && t < 18) || t >= 154 || (t > 47 && t < 58.3))) {   // faint backdrop glow for diagram scenes
    const g = ctx.createRadialGradient(W / 2, 470, 60, W / 2, 470, 1100); g.addColorStop(0, `rgba(42,58,110,${0.34 * (1 - S.dim)})`); g.addColorStop(1, 'rgba(13,18,32,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (t < 12) ovHook(t, S); else if (t < 18) ovTitle(t); else if (t < 38) ovTrack(t, S); else if (t < 58) ovParallax(t, S); else if (t < 74) ovLens(t, S);
  else if (t < 100) ovSolve(t, S); else if (t < 120) ovFocal(t, S); else if (t < 138) ovScale(t, S); else if (t < 154) ovResult(t, S); else ovOutro(t);
  chapterCard(t); progressBar(t); captions(t);
}

async function init() {
  TL = await (await fetch('./timeline.json')).json();
  await Promise.all(['900 100px "Inter Display"', '800 100px "Inter Display"', '600 50px Inter', '500 40px "JetBrains Mono"', '600 40px "JetBrains Mono"', '700 40px "JetBrains Mono"', '800 40px "JetBrains Mono"'].map(f => document.fonts.load(f)));
  HERO_MID = (() => { const p = toPx(HERO.p, { ...FLAT, k: K0 }, camAt(17.375)); return [(p[0] - W / 2) / (H / 2), (H / 2 - p[1]) / (H / 2)]; })();
  window.renderFrame = renderFrame;
  window.grab = (q = 0.96) => out.toDataURL('image/jpeg', q);
  window.INFO = { features: F.length, solve: SOLVE.es, far: FAR && FAR.ref, edges: EDGES.length, ground: GROUND3 && GROUND3.map(g => g.ref) };
  window.READY = true;
}
init().catch(e => { window.ERR = String(e.stack || e); });
