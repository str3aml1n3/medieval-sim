import * as THREE from 'three';

const E = '../export/';
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const params = new URLSearchParams(location.search);
const store = {
  get(k, d) { try { const v = localStorage.getItem('msim.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('msim.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const FOG = 0xaebcc4;
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 45, 160);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 600);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
// characters are lit by a sky/ground hemisphere + sun, then tinted by Gothic's baked light where they stand
scene.add(new THREE.HemisphereLight(0xe4ecf4, 0x6a5a40, 1.5));
const sun = new THREE.DirectionalLight(0xfff0d8, 1.4); sun.position.set(-30, 60, 20); scene.add(sun);
const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x4f7fb5) }, bottom: { value: new THREE.Color(FOG) } },
  vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vp; void main(){ float h = clamp(normalize(vp).y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); \n#include <colorspace_fragment>\n}',
}));
sky.renderOrder = -1; scene.add(sky);

// ---------------------------------------------------------------- loading
const jget = u => fetch(E + u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
const bget = u => fetch(E + u).then(r => { if (!r.ok) throw new Error(u); return r.arrayBuffer(); });
const texLoader = new THREE.TextureLoader();
const texCache = {};
function getTex(name) {
  if (!texCache[name]) {
    const t = texLoader.load(E + 'tex/' + name + '.png');
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy(); // ground seen at grazing angles smears badly below ~16x
    texCache[name] = t;
  }
  return texCache[name];
}
let world, wbin, chars, anims, dlg, wps;
try { [world, wbin, chars, anims, dlg, wps] = await Promise.all([jget('world.json'), bget('world.bin'), jget('chars.json'), jget('anims.json'), jget('dialogue.json'), jget('waypoints.json')]); }
catch (err) {
  $('loadmsg').innerHTML = 'Game assets not found or out of date (' + err.message + ').<br><small>Assets are extracted locally from your own Gothic install and are not hosted here.<br>Run <code>./export_all.sh</code> (see the README), then serve the repo root and open /web/.</small>';
  throw err;
}
const WP = Object.fromEntries(wps.map(w => [w.n, new THREE.Vector3(w.x, w.y, w.z)]));

// ---------------------------------------------------------------- Gothic UI: bitmap fonts (export_ui.py)
// A font is an atlas + 256 glyphs indexed by Windows-1252 code: [u0, v0, u1, v1, pixel width]. *_HI = highlighted.
const UI = { fonts: null, img: {} };
try {
  UI.fonts = await jget('ui/fonts.json');
  await Promise.all(Object.values(UI.fonts).map(f => new Promise((res, rej) => { const im = new Image(); im.onload = () => { UI.img[f.tex] = im; res(); }; im.onerror = rej; im.src = E + 'ui/' + f.tex + '.png'; })));
} catch { UI.fonts = null; } // older export without ui/: plain CSS text
const F10 = 'FONT_OLD_10_WHITE', F10HI = 'FONT_OLD_10_WHITE_HI', F20 = 'FONT_OLD_20_WHITE';
const CP1252 = { '€': 128, '‚': 130, '„': 132, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '–': 45, '—': 45, '™': 153 }; // Gothic's fonts have no dash glyphs: use '-'
const glyphCode = ch => { const c = ch.charCodeAt(0); return c < 256 ? c : CP1252[ch] ?? 63; };
// Gothic draws its fonts in 800x600 pixels; scale them up with the window like the original UI does
const uiScale = () => clamp(innerHeight / 680, 1, 2.4);
const applyUiScale = () => document.documentElement.style.setProperty('--ui', uiScale());
applyUiScale(); addEventListener('resize', applyUiScale);
const measure = (f, s) => { let w = 0; for (const ch of s) w += f.glyphs[glyphCode(ch)][4]; return w; };
// segs: [[text, fontName], ...] -> canvas, word-wrapped at maxW font pixels, lines centred
function renderText(segs, maxW = 1e9) {
  const lines = [[]]; let lw = 0;
  for (const [txt, fn] of segs) {
    const f = UI.fonts[fn];
    for (const word of String(txt).split(/(\s+)/)) {
      if (!word) continue;
      const sp = /^\s+$/.test(word), t = sp ? ' ' : word, w = measure(f, t);
      if (!sp && lw > 0 && lw + w > maxW) { lines.push([]); lw = 0; }
      if (sp && lw === 0) continue;
      lines[lines.length - 1].push([t, f]); lw += w;
    }
  }
  const H = Math.max(...segs.map(s => UI.fonts[s[1]].height));
  const widths = lines.map(l => l.reduce((a, [t, f]) => a + measure(f, t), 0));
  const W = Math.max(1, ...widths), k = uiScale(), dpr = devicePixelRatio || 1;
  const cv = document.createElement('canvas'); cv.className = 'gt';
  cv.width = Math.ceil(W * k * dpr); cv.height = Math.ceil(H * lines.length * k * dpr);
  cv.style.width = W * k + 'px'; cv.style.height = H * lines.length * k + 'px';
  const g = cv.getContext('2d'); g.scale(k * dpr, k * dpr); g.imageSmoothingQuality = 'high';
  lines.forEach((l, li) => {
    let x = (W - widths[li]) / 2;
    for (const [t, f] of l) {
      const im = UI.img[f.tex];
      for (const ch of t) {
        const [u0, v0, u1, v1, w] = f.glyphs[glyphCode(ch)];
        if (w && u1 > u0) g.drawImage(im, u0 * im.width, v0 * im.height, (u1 - u0) * im.width, (v1 - v0) * im.height, x, li * H, w, (v1 - v0) * im.height);
        x += w;
      }
    }
  });
  return cv;
}
// sets an element's text in Gothic's font (redraws only when the text changes)
function setText(el, segs, maxW) {
  if (typeof segs === 'string') segs = [[segs, F10]];
  const key = JSON.stringify(segs) + '|' + maxW + '|' + uiScale(); if (el._gt === key) return; el._gt = key;
  if (!UI.fonts) { el.textContent = segs.map(s => s[0]).join(''); return; }
  el.textContent = '';
  if (segs.some(s => s[0])) el.appendChild(renderText(segs, maxW));
}
let msgText = '';
function showMsg(t, ms = 0) {
  msgText = t; setText($('msg'), [[t, F20]], innerWidth * 0.8 / uiScale());
  clearTimeout(showMsg.h); if (ms) showMsg.h = setTimeout(() => { if (msgText === t) showMsg(''); }, ms);
}

// ---------------------------------------------------------------- world + collision grid
// Gothic's baked light is stored per vertex (sRGB bytes). Converting it to linear and multiplying with the
// (sRGB-decoded) texture reproduces Gothic's gamma-space "texture x light" modulation.
const LIGHT_GAIN = 1.25;
// Gothic adds an ambient term on top of the baked light, so unlit corners and hut interiors stay readable
const MIN_LIGHT = 72;
const S2L = Float32Array.from({ length: 256 }, (_, i) => Math.pow(Math.max(i, MIN_LIGHT) / 255, 2.2));
const tris = []; // {a,b,c,n,tri,col,kind}
const CELL = 3, grid = new Map();
const key = (cx, cz) => cx * 8192 + cz;
const kindOf = t => /WOOD|HOLZ|BRETT|PLANK|BOARD|BEAM|BALK|PALISAD/.test(t) ? 'WOOD' : /STONE|STEIN|ROCK|FELS|MAUER|WALL|CASTLE|BURG|PFLASTER/.test(t) ? 'STONE' : /SAND/.test(t) ? 'SAND' : 'EARTH';
function addTri(a, b, c, col, kind) {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const l = n.length(); if (l < 1e-6) return; n.divideScalar(l);
  const idx = tris.push({ a, b, c, n, tri: new THREE.Triangle(a, b, c), col, kind }) - 1;
  const x0 = Math.min(a.x, b.x, c.x), x1 = Math.max(a.x, b.x, c.x), z0 = Math.min(a.z, b.z, c.z), z1 = Math.max(a.z, b.z, c.z);
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      const k = key(cx, cz); let l2 = grid.get(k); if (!l2) grid.set(k, l2 = []); l2.push(idx);
    }
}
for (const m of world.meshes) {
  const P = new Float32Array(wbin, m.p, m.n * 3), U = new Float32Array(wbin, m.u, m.n * 2), C8 = new Uint8Array(wbin, m.c, m.n * 3);
  const C = new Float32Array(m.n * 3); for (let i = 0; i < C.length; i++) C[i] = S2L[C8[i]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  const water = m.flag === 'water', decal = m.flag.startsWith('decal'), cut = m.alpha || m.flag === 'decal';
  const blended = water || (decal && m.flag !== 'decal'), mul = m.flag === 'decal_mul' || m.flag === 'decal_mul2';
  const mat = new THREE.MeshBasicMaterial({
    map: getTex(m.tex), vertexColors: !mul, color: mul ? 0xffffff : new THREE.Color(LIGHT_GAIN, LIGHT_GAIN, LIGHT_GAIN),
    alphaTest: cut ? 0.5 : 0, side: cut || blended ? THREE.DoubleSide : THREE.FrontSide,
    transparent: blended, opacity: water ? 0.7 : 1, depthWrite: !blended, fog: !mul,
  });
  // decals blend like Gothic's alpha functions: ADD = src*alpha + dst, MUL = src*dst, MUL2 = 2*src*dst
  if (m.flag === 'decal_add') mat.blending = THREE.AdditiveBlending;
  if (mul) Object.assign(mat, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor,
    blendDst: m.flag === 'decal_mul2' ? THREE.SrcColorFactor : THREE.ZeroFactor });
  if (decal) { mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2; }
  scene.add(new THREE.Mesh(g, mat));
  // collide only with solid, opaque geometry: not foliage/fences (alpha), door curtains, open doors, decals, water
  if (m.alpha || m.flag) continue;
  const kind = kindOf(m.tex);
  for (let i = 0; i < m.n * 3; i += 9) {
    const col = new THREE.Color((C[i] + C[i + 3] + C[i + 6]) / 3, (C[i + 1] + C[i + 4] + C[i + 7]) / 3, (C[i + 2] + C[i + 5] + C[i + 8]) / 3);
    addTri(new THREE.Vector3(P[i], P[i + 1], P[i + 2]), new THREE.Vector3(P[i + 3], P[i + 4], P[i + 5]), new THREE.Vector3(P[i + 6], P[i + 7], P[i + 8]), col, kind);
  }
}
function cellTris(x, z) { return grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || []; }
function nearTris(x, z, r) {
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  if (x0 === x1 && z0 === z1) return cellTris(x, z);
  const s = new Set();
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) for (const i of grid.get(key(cx, cz)) || []) s.add(i);
  return s;
}
let gTri = -1; // triangle found by the last groundAt()
function groundAt(x, z, yRef, step = 0.7) {
  let best = null; gTri = -1;
  for (const i of cellTris(x, z)) {
    const t = tris[i]; if (t.n.y < 0.45) continue;
    const { a, b, c } = t;
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z); if (Math.abs(d) < 1e-9) continue;
    const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
    const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
    const l3 = 1 - l1 - l2; if (l1 < -0.001 || l2 < -0.001 || l3 < -0.001) continue;
    const y = l1 * a.y + l2 * b.y + l3 * c.y;
    if (y <= yRef + step && (best === null || y > best)) { best = y; gTri = i; }
  }
  return best;
}
const _c = new THREE.Vector3(), _p = new THREE.Vector3();
function pushOut(pos, r = 0.42) {
  for (let it = 0; it < 2; it++) {
    _c.set(pos.x, pos.y + 0.95, pos.z);
    for (const i of nearTris(pos.x, pos.z, r)) {
      const t = tris[i]; if (Math.abs(t.n.y) > 0.45) continue; // floors AND ceilings are not walls
      if (Math.max(t.a.y, t.b.y, t.c.y) < pos.y + 0.35 || Math.min(t.a.y, t.b.y, t.c.y) > pos.y + 1.7) continue;
      t.tri.closestPointToPoint(_c, _p);
      const dx = _c.x - _p.x, dz = _c.z - _p.z, h = Math.hypot(dx, dz), dy = _c.y - _p.y, dist = Math.hypot(h, dy);
      if (dist < r && h > 1e-5) { const k = (r - dist) / h; pos.x += dx * k; pos.z += dz * k; _c.set(pos.x, pos.y + 0.95, pos.z); }
    }
  }
}
// a move is valid if there is ground under the new spot and no floor surface between knee and head height
function canStand(from, to) {
  if (groundAt(to.x, to.z, from.y + 0.2, 0.55) === null) return false;
  const top = groundAt(to.x, to.z, from.y + 1.5, 0);
  return top === null || top <= from.y + 0.6;
}
// first hit of the segment a->b against the collision triangles (both sides); distance or null
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _h = new THREE.Vector3(), _s = new THREE.Vector3(), _q2 = new THREE.Vector3();
function segCast(a, b) {
  const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length(); if (len < 1e-4) return null; dir.divideScalar(len);
  const cand = new Set(); const steps = Math.ceil(len / 1.5);
  for (let i = 0; i <= steps; i++) { const t = (i / steps) * len; for (const k of nearTris(a.x + dir.x * t, a.z + dir.z * t, 0.8)) cand.add(k); }
  let best = null;
  for (const k of cand) {
    const { a: p0, b: p1, c: p2 } = tris[k];
    _e1.subVectors(p1, p0); _e2.subVectors(p2, p0); _h.crossVectors(dir, _e2); const det = _e1.dot(_h);
    if (Math.abs(det) < 1e-8) continue; const inv = 1 / det;
    _s.subVectors(a, p0); const u = _s.dot(_h) * inv; if (u < 0 || u > 1) continue;
    _q2.crossVectors(_s, _e1); const v = dir.dot(_q2) * inv; if (v < 0 || u + v > 1) continue;
    const t = _e2.dot(_q2) * inv; if (t > 0.05 && t < len && (best === null || t < best)) best = t;
  }
  return best;
}
function settle(e, dt) {
  const g = groundAt(e.pos.x, e.pos.z, e.pos.y + 0.2);
  if (g === null) { e.vy -= 20 * dt; e.pos.y += e.vy * dt; if (e.pos.y < e.lastGood - 30) { e.pos.y = e.lastGood; e.vy = 0; } return; }
  if (gTri >= 0) e.lightTarget.copy(tris[gTri].col);
  // stick to the ground when walking down slopes/steps instead of bouncing in free fall
  if (e.pos.y > g + 0.05 && (e.vy < -0.5 || e.pos.y > g + 0.45)) { e.vy -= 20 * dt; e.pos.y = Math.max(g, e.pos.y + e.vy * dt); if (e.pos.y === g) e.vy = 0; }
  else { e.pos.y = g; e.vy = 0; }
  e.lastGood = e.pos.y;
}

// ---------------------------------------------------------------- audio
const listener = new THREE.AudioListener(); camera.add(listener); scene.add(camera);
const actx = listener.context;
const abuf = {};
function loadSound(n) {
  n = n.toUpperCase();
  if (!abuf[n]) abuf[n] = fetch(E + 'audio/' + n + '.wav').then(r => (r.ok ? r.arrayBuffer() : Promise.reject())).then(b => actx.decodeAudioData(b)).catch(() => null);
  return abuf[n];
}
function playBuf(b, pos, vol = 1, ref = 7) {
  if (!b) return null;
  const a = new THREE.PositionalAudio(listener); a.setBuffer(b); a.setRefDistance(ref); a.setVolume(vol);
  const o = new THREE.Object3D(); o.position.copy(pos); scene.add(o); o.add(a);
  a.onEnded = () => { a.isPlaying = false; scene.remove(o); }; a.play(); return a;
}
async function playAt(name, pos, vol = 1, ref = 7) { return playBuf(await loadSound(name), pos, vol, ref); }
const at = (c, h = 1.2) => c.pos.clone().setY(c.pos.y + h);
const sfx = {
  clash: c => playAt('CS_IAI_ME_ME_0' + (1 + Math.floor(Math.random() * 9)), at(c), 1.3),
  hit: c => playAt('CS_IAM_UD_FL_0' + (1 + Math.floor(Math.random() * 5)), at(c), 1.3),
  fall: c => playAt('M_FALL_SMALL01', at(c, 0.3), 1),
  step: (c, vol) => playAt('STEP_' + (c.groundKind || 'EARTH') + '_0' + (1 + Math.floor(Math.random() * 5)), at(c, 0.05), vol, 3),
};
// sword swing: Gothic's "Whoosh" sound effect is defined in its script SFX table, not as a plain WAV; synthesise one
const whooshBuf = (() => {
  const sr = actx.sampleRate, n = Math.floor(sr * 0.3), b = actx.createBuffer(1, n, sr), d = b.getChannelData(0); let lp = 0;
  for (let i = 0; i < n; i++) { const t = i / n, env = Math.sin(Math.PI * t) ** 2, k = 0.04 + 0.3 * Math.sin(Math.PI * t); lp += k * ((Math.random() * 2 - 1) - lp); d[i] = lp * env * 1.4; }
  return b;
})();
let voiceAudio = null;
async function playVoice(name, onDone) {
  const b = await loadSound(name);
  if (voiceAudio && voiceAudio.isPlaying) { voiceAudio.onEnded = () => {}; voiceAudio.stop(); }
  if (!b) { setTimeout(onDone, 1500); return; }
  const a = new THREE.Audio(listener); a.setBuffer(b); a.setVolume(1); a.onEnded = () => { a.isPlaying = false; onDone && onDone(); }; a.play(); voiceAudio = a;
}

// ---------------------------------------------------------------- animation data
// Gothic's own clips (export_anims.py): local bone rotations per frame + root (BIP01) translation, whose
// horizontal part is the root motion that moves the character, plus the combat event frames from HUMANS.MDS.
const bonesDef = chars.bones, NB = bonesDef.length;
const boneIdx = Object.fromEntries(bonesDef.map((b, i) => [b.name, i]));
const rest = bonesDef.map(b => { const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); new THREE.Matrix4().fromArray(b.m).decompose(p, q, s); return { p, q }; });
const CLIPS = {};
for (const [k, c] of Object.entries(anims.clips))
  CLIPS[k] = { name: k, fps: c.fps, n: c.n, nodes: c.nodes, q: Float32Array.from(c.q), root: Float32Array.from(c.root), ev: c.ev || {}, speed: c.speed || 0 };
const clipOf = (name, style) => (style && CLIPS[style + ':' + name]) || CLIPS[name];
const GESTURES = Object.keys(CLIPS).filter(k => k.startsWith('T_DIALOGGESTURE_'));
function frameAt(st) {
  const n = st.clip.n; let f = st.t * st.clip.fps;
  if (st.loop) { f %= n; if (st.rev) f = (n - f) % n; } else { f = Math.min(f, n - 1); if (st.rev) f = n - 1 - f; }
  return f;
}
const ended = st => !st.loop && st.t * st.clip.fps >= st.clip.n - 1;
function sample(c, f, loop, out) { // slerps this clip's channels into out[]; returns the root height
  const f0 = Math.floor(f), a = f - f0, f1 = f0 + 1 < c.n ? f0 + 1 : loop ? 0 : f0, nn = c.nodes.length;
  for (let k = 0; k < nn; k++) THREE.Quaternion.slerpFlat(out, c.nodes[k] * 4, c.q, (f0 * nn + k) * 4, c.q, (f1 * nn + k) * 4, a);
  return c.root.length ? c.root[f0 * 3 + 1] * (1 - a) + c.root[f1 * 3 + 1] * a : null;
}
function rootXZ(c, f) {
  if (!c.root.length) return [0, 0];
  const f0 = Math.floor(f), a = f - f0, f1 = Math.min(f0 + 1, c.n - 1);
  return [c.root[f0 * 3] * (1 - a) + c.root[f1 * 3] * a, c.root[f0 * 3 + 2] * (1 - a) + c.root[f1 * 3 + 2] * a];
}
const smooth = x => x * x * (3 - 2 * x);

// ---------------------------------------------------------------- characters
function skinGeo(p) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(p.u, 2));
  if (p.si) { g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(p.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(p.sw, 4)); }
  g.computeVertexNormals(); return g;
}
const geoCache = new Map();
const gGeo = p => { if (!geoCache.has(p)) geoCache.set(p, skinGeo(p)); return geoCache.get(p); };
let FOOT_ADJ = 0; // lifts the model so the soles touch the ground in Gothic's standing pose (computed below)
const tmpPose = new Float32Array(NB * 4);
let actId = 0;

class Char {
  constructor(o) {
    Object.assign(this, {
      name: 'NPC', hp: 100, maxHp: 100, str: 20, wdmg: 12, prot: 0, style: '', skill: 0.5,
      pos: new THREE.Vector3(), vy: 0, lastGood: 0, heading: 0, isPlayer: false,
      drawn: false, drawing: null, gait: 'run', mv: { f: 0, s: 0 }, act: null, downed: false, hostile: null, idlePose: null,
      light: new THREE.Color(0.6, 0.6, 0.6), lightTarget: new THREE.Color(0.6, 0.6, 0.6), groundKind: 'EARTH', t: 0, stepPh: 0,
    }, o);
    this.root = new THREE.Group(); this.body = new THREE.Group(); this.body.position.y = FOOT_ADJ; this.root.add(this.body);
    this.bones = bonesDef.map((b, i) => { const n = new THREE.Bone(); n.name = b.name; n.position.copy(rest[i].p); n.quaternion.copy(rest[i].q); return n; });
    bonesDef.forEach((b, i) => (b.parent < 0 ? this.body : this.bones[b.parent]).add(this.bones[i]));
    this.root.updateMatrixWorld(true);
    this.skel = new THREE.Skeleton(this.bones);
    this.mats = [];
    for (const p of [...chars.outfits[o.outfit], ...(chars.heads[o.head] || [])]) {
      const mat = new THREE.MeshLambertMaterial({ map: getTex(p.tex), alphaTest: 0.4 }); this.mats.push(mat);
      const m = new THREE.SkinnedMesh(gGeo(p), mat); m.frustumCulled = false; this.body.add(m);
      // the mesh's world matrix must be current *before* binding, or every bone pivots ~1 m away from its joint
      this.root.updateMatrixWorld(true); m.bind(this.skel, m.matrixWorld);
    }
    // the weapon is a plain mesh hung on a slot bone: ZS_SWORD (hip) when sheathed, ZS_RIGHTHAND when drawn
    this.weapon = new THREE.Group();
    for (const p of (chars.weaponsLocal && chars.weaponsLocal[o.weapon]) || []) {
      const mat = new THREE.MeshLambertMaterial({ map: getTex(p.tex), alphaTest: 0.4, side: THREE.DoubleSide }); this.mats.push(mat);
      this.weapon.add(new THREE.Mesh(gGeo(p), mat));
    }
    this.slot(false);
    this.cur = new Float32Array(NB * 4); this.snap = new Float32Array(NB * 4);
    rest.forEach((r, i) => r.q.toArray(this.cur, i * 4));
    this.rootY = 1; this.snapY = 1; this.blendT = 0; this.blendDur = 0; this.base = null; this.over = null;
    scene.add(this.root);
  }
  slot(inHand) { this.bones[boneIdx[inHand ? 'ZS_RIGHTHAND' : 'ZS_SWORD']].add(this.weapon); }
  get fwd() { return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)); }
  // base layer: one full-body clip, cross-faded from the previous pose
  play(name, { loop = true, rate = 1, rev = false, blend = 0.15, rm = false, restart = false } = {}) {
    const clip = clipOf(name, this.style); if (!clip) { console.warn('missing clip', name); return false; }
    const b = this.base;
    if (!restart && b && b.clip === clip && b.rev === rev && b.loop === loop) { b.rate = rate; return true; }
    this.snap.set(this.cur); this.snapY = this.rootY; this.blendT = 0; this.blendDur = blend;
    this.base = { clip, name, t: 0, rate, loop, rev, rm, prevF: rev ? clip.n - 1 : 0 };
    return true;
  }
  // overlay layer: a partial clip (upper body etc.) mixed on top, faded in and out
  overlay(name, { rate = 1, rev = false } = {}) { const clip = clipOf(name, this.style); if (clip) this.over = { clip, t: 0, rate, rev, loop: false }; }
  frame() { return this.base ? frameAt(this.base) : 0; }
  done() { return !this.base || ended(this.base); }
  update(dt) {
    const b = this.base;
    if (b) { b.prevF = frameAt(b); b.t += dt * b.rate; }
    rest.forEach((r, i) => r.q.toArray(this.cur, i * 4));
    let y = this.rootY;
    if (b) { const ry = sample(b.clip, frameAt(b), b.loop, this.cur); if (ry !== null) y = ry; }
    if (this.blendT < this.blendDur) {
      this.blendT += dt; const w = smooth(Math.min(1, this.blendT / this.blendDur));
      for (let i = 0; i < NB; i++) THREE.Quaternion.slerpFlat(this.cur, i * 4, this.snap, i * 4, this.cur, i * 4, w);
      y = this.snapY + (y - this.snapY) * w;
    }
    const o = this.over;
    if (o) {
      o.t += dt * o.rate; const total = (o.clip.n - 1) / o.clip.fps;
      if (o.t >= total) this.over = null;
      else {
        const w = Math.min(1, o.t / 0.1, (total - o.t) / 0.12);
        tmpPose.set(this.cur); sample(o.clip, frameAt(o), false, tmpPose);
        for (const i of o.clip.nodes) if (i !== 0) THREE.Quaternion.slerpFlat(this.cur, i * 4, this.cur, i * 4, tmpPose, i * 4, w);
      }
    }
    this.rootY = y;
    for (let i = 0; i < NB; i++) this.bones[i].quaternion.fromArray(this.cur, i * 4);
    this.bones[0].position.set(0, y, 0);
    this.light.lerp(this.lightTarget, Math.min(1, dt * 4));
    const k = clamp(this.light.r * 1.7, 0.3, 1.25), k2 = clamp(this.light.g * 1.7, 0.3, 1.25), k3 = clamp(this.light.b * 1.7, 0.3, 1.25);
    for (const m of this.mats) m.color.setRGB(k, k2, k3);
    this.t += dt;
  }
  // horizontal root motion of the base clip since the last frame, in the character's local space
  rootMotion() {
    const b = this.base; if (!b || !b.rm) return null;
    const [x1, z1] = rootXZ(b.clip, frameAt(b)), [x0, z0] = rootXZ(b.clip, b.prevF);
    return [x1 - x0, z1 - z0];
  }
  sync() { this.root.position.copy(this.pos); this.root.rotation.y = this.heading; }
}

// feet: in the bind pose the soles sit `sole` below the foot bone; pose a test model and lift it accordingly
{
  let mn = 9; for (const part of chars.outfits.GRDM) for (let i = 1; i < part.p.length; i += 3) mn = Math.min(mn, part.p[i]);
  const tmp = new Char({ outfit: 'GRDM', head: 'BALD', weapon: 'sword' });
  const v = new THREE.Vector3(), feet = ['BIP01 L FOOT', 'BIP01 R FOOT'].map(n => tmp.bones[boneIdx[n]]);
  tmp.root.updateMatrixWorld(true); const sole = feet[0].getWorldPosition(v).y - mn;
  tmp.play('S_RUN', { blend: 0 }); tmp.update(0); tmp.root.updateMatrixWorld(true);
  FOOT_ADJ = -Math.min(...feet.map(f => f.getWorldPosition(v).y - sole));
  scene.remove(tmp.root);
}

// ---------------------------------------------------------------- movement (Gothic: run by default, Shift walks, sneak toggles)
const LOCO = {
  free: {
    idle: { run: 'S_RUN', walk: 'S_RUN', sneak: 'S_SNEAK' }, fwd: { run: 'S_RUNL', walk: 'S_WALKL', sneak: 'S_SNEAKL' },
    back: { run: 'S_WALKL', walk: 'S_WALKL', sneak: 'S_SNEAKL' },
    left: { run: 'T_RUNSTRAFEL', walk: 'T_WALKSTRAFEL', sneak: 'T_SNEAKSTRAFEL' }, right: { run: 'T_RUNSTRAFER', walk: 'T_WALKSTRAFER', sneak: '-T_SNEAKSTRAFEL' },
  },
  '1h': {
    idle: { run: 'S_1HRUN', walk: 'S_1HRUN', sneak: 'S_1HSNEAK' }, fwd: { run: 'S_1HRUNL', walk: 'S_1HWALKL', sneak: 'S_1HSNEAKL' },
    back: { run: 'S_1HWALKL', walk: 'S_1HWALKL', sneak: 'S_1HSNEAKL' },
    left: { run: 'T_1HRUNSTRAFEL', walk: 'T_1HRUNSTRAFEL', sneak: 'T_1HSNEAKSTRAFEL' }, right: { run: 'T_1HRUNSTRAFER', walk: 'T_1HRUNSTRAFER', sneak: '-T_1HSNEAKSTRAFEL' },
  },
};
const STEP_VOL = { run: 0.45, walk: 0.22, sneak: 0.04 };
// picks the locomotion clip; returns this frame's world-space displacement (speed comes from the clip's root motion)
function locomote(c, dt) {
  const { f, s } = c.mv, set = LOCO[c.drawn ? '1h' : 'free'];
  const k = f > 0 ? 'fwd' : f < 0 ? 'back' : s < 0 ? 'left' : s > 0 ? 'right' : 'idle';
  let name = set[k][c.gait], rev = k === 'back';
  if (name[0] === '-') { name = name.slice(1); rev = !rev; }
  const rate = (k === 'left' || k === 'right') && c.gait === 'walk' ? 0.6 : 1;
  c.play(name, { loop: true, rev, rate, blend: 0.2 });
  if (k === 'idle') return null;
  const clip = c.base.clip, sp = clip.speed * rate;
  // footsteps twice per cycle
  const ph = frameAt(c.base) / clip.n, prev = c.stepPh; c.stepPh = ph;
  if ((prev < 0.5 && ph >= 0.5) || ph < prev) if (c.isPlayer || dist2(c, player) < 14) sfx.step(c, STEP_VOL[c.gait] * (c.isPlayer ? 1 : 0.7));
  const lx = f ? s * 0.7 : s, lz = -f; const l = Math.hypot(lx, lz) || 1;
  const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  const wx = (lx * ch + lz * sh) / l, wz = (-lx * sh + lz * ch) / l;
  return [wx * sp * dt, wz * sp * dt];
}
function moveBy(c, dx, dz) {
  const old = c.pos.clone(); c.pos.x += dx; c.pos.z += dz; pushOut(c.pos);
  if (!canStand(old, c.pos)) c.pos.copy(old);
  else if (!c.isPlayer) { const g = groundAt(c.pos.x, c.pos.z, old.y + 0.2); if (g !== null && g < old.y - 1.2) c.pos.copy(old); } // NPCs don't walk off ledges
}
// NPC duty poses (spectating, standing guard): intro clip, then its loop
const POSES = { watch: ['T_STAND_2_WATCHFIGHT', 'S_WATCHFIGHT'], guard: ['T_STAND_2_HGUARD', 'S_HGUARD'] };
function poseTick(c) {
  const [intro, loop] = POSES[c.idlePose], nm = c.base && c.base.name;
  if (nm === loop) return;
  if (nm === intro) { if (c.done()) c.play(loop, { blend: 0.1 }); return; }
  c.play(intro, { loop: false, blend: 0.3 });
}

// ---------------------------------------------------------------- entities
const W_DMG = { sword: 15, axe: 18, mace: 16, hammer: 14 };
const entities = [];
const PLAYER_START = () => (WP.OCR_OUTSIDE_ARENA || new THREE.Vector3(49.7, -9.5, -42.4)).clone().add(new THREE.Vector3(0, 0.5, 0));
const player = new Char({ name: 'You', outfit: 'GRDM', head: 'FIGHTER', weapon: 'sword', isPlayer: true, hp: 150, maxHp: 150, str: 25, wdmg: W_DMG.sword, prot: 25, style: store.get('style', '') });
player.pos.copy(PLAYER_START()); player.heading = Math.PI * 0.75; entities.push(player);
const wpFix = (name, dy = 0.6) => { const w = WP[name]; return w ? w.clone().add(new THREE.Vector3(0, dy, 0)) : new THREE.Vector3(40, -9, -34); };
// Arena floor = centre of the OCR_ARENA_01..09 ring. (OCR_ARENABATTLE is the fighters' room *under* the arena.)
const ring = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => WP['OCR_ARENA_0' + i]).filter(Boolean);
const PIT = ring.length ? ring.reduce((a, b) => a.clone().add(b)).divideScalar(ring.length).add(new THREE.Vector3(0, 0.6, 0)) : wpFix('OCR_ARENA_01');
// Fighting skill: Gothic's 1H talent picks the animation set (untrained / HUMANS_1HST1 / HUMANS_1HST2) and with it the
// combo length; `skill` is how reliably the AI parries and chains combos. Damage = strength + weapon - armour.
const castCfg = {
  KIRGO: { outfit: 'SLDM', head: 'FIGHTER', weapon: 'sword', pos: PIT.clone().add(new THREE.Vector3(-1.8, 0, 0)), duty: 'duel', hp: 160, str: 35, prot: 20, style: '1HST1', skill: 0.5 },
  WHISTLER: { outfit: 'STTM', head: 'THIEF', weapon: 'axe', pos: PIT.clone().add(new THREE.Vector3(1.8, 0, 0)), duty: 'duel', hp: 120, str: 30, prot: 10, style: '', skill: 0.35 },
  THORUS: { outfit: 'GRDM', head: 'BALD', weapon: 'sword', pos: wpFix('OCR_ARENA_BARONS_HUT'), duty: 'guard', guard: true, hp: 400, str: 80, prot: 45, style: '1HST2', skill: 0.85 },
  BLOODWYN: { outfit: 'SLDM', head: 'FATBALD', weapon: 'mace', pos: wpFix('OCR_OUTSIDE_ARENA_HANGAROUND'), duty: 'watch', guard: true, hp: 280, str: 60, prot: 40, style: '1HST2', skill: 0.7 },
  FLETCHER: { outfit: 'STTM', head: 'PSIONIC', weapon: 'hammer', pos: wpFix('OCR_OUTSIDE_ARENA_01'), duty: 'watch', guard: true, hp: 200, str: 45, prot: 30, style: '1HST1', skill: 0.55 },
  SNAF: { outfit: 'VLKM', head: 'PONY', weapon: 'mace', pos: wpFix('OCR_OUTSIDE_ARENA_BENCH1'), duty: 'idle', hp: 60, str: 15, prot: 5, style: '', skill: 0.2 },
};
const npcs = [];
for (const c of dlg.cast) {
  const cfg = castCfg[c.id]; if (!cfg) continue;
  const e = new Char({ name: c.name, outfit: cfg.outfit, head: cfg.head, weapon: cfg.weapon, cast: c, duty: cfg.duty, guard: !!cfg.guard,
    hp: cfg.hp, maxHp: cfg.hp, str: cfg.str, wdmg: W_DMG[cfg.weapon], prot: cfg.prot, style: cfg.style, skill: cfg.skill });
  e.pos.copy(cfg.pos); e.home = cfg.pos.clone(); e.heading = Math.atan2(-(PIT.x - e.pos.x), -(PIT.z - e.pos.z));
  entities.push(e); npcs.push(e);
}
for (const s of dlg.sfx) loadSound(s);
for (const c of dlg.cast) for (const b of Object.values(c.barks)) loadSound(b);
['SVM_15_AARGH_1', 'SVM_15_AARGH_2'].forEach(loadSound);
const duelists = npcs.filter(n => n.duty === 'duel');
let duelWait = 0;
function startDuel() {
  const [a, b] = duelists; if (!a || !b || a.downed || b.downed) return;
  a.hostile = b; b.hostile = a; duelWait = 0;
}
startDuel();

// ---------------------------------------------------------------- combat
const REACH = 2.1; // centre-to-centre reach of a one-handed weapon
const dist2 = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
const dirTo = (a, b) => new THREE.Vector3(b.pos.x - a.pos.x, 0, b.pos.z - a.pos.z).normalize();
function bark(e, name, delay = 0) {
  if (!e.cast || !e.cast.barks[name]) return;
  const now = performance.now() + delay; if (e.barkUntil > now) return; e.barkUntil = now + 2500;
  setTimeout(() => playAt(e.cast.barks[name], at(e, 1.6), 1.2, 9), delay);
}
function toggleWeapon(c) {
  if (c.drawing || c.downed || (c.act && c.act.type !== 'parade')) return;
  const draw = !c.drawn, clip = clipOf('T_MOVE_2_1HMOVE', c.style);
  const sw = clip && clip.ev.set_fight_mode ? clip.ev.set_fight_mode[0] / clip.fps : 0.2; // when the hand reaches the hilt
  c.drawing = { t: 0, draw, at: draw ? sw : (clip.n - 1) / clip.fps - sw, len: (clip.n - 1) / clip.fps };
  c.overlay('T_MOVE_2_1HMOVE', { rev: !draw });
  if (draw) c.drawn = true; else playAt('SWORD_UNDRAW_01', at(c), 0.8);
}
function drawTick(c, dt) {
  const d = c.drawing; if (!d) return;
  d.t += dt;
  if (!d.switched && d.t >= d.at) { d.switched = true; c.slot(d.draw); if (d.draw) playAt(pick(['SWORD_DRAW_01', 'SWORD_DRAW_02']), at(c), 0.8); else c.drawn = false; }
  if (d.t >= d.len) c.drawing = null;
}
function aimAt(c) { // Gothic turns the fighter towards the focused enemy when a swing starts
  const t = c.isPlayer ? c.focus : c.hostile; if (!t || t.downed || dist2(c, t) > 3.5) return;
  const to = dirTo(c, t); if (c.fwd.dot(to) < 0.4) return;
  c.heading = Math.atan2(-to.x, -to.z);
}
function startAttack(c, dir) {
  const name = dir === 'L' ? 'T_1HATTACKL' : dir === 'R' ? 'T_1HATTACKR' : 'S_1HATTACK';
  if (!c.play(name, { loop: false, rm: true, restart: true, blend: 0.08 })) return;
  const clip = c.base.clip, ev = clip.ev;
  c.act = { type: 'attack', id: ++actId, dir, t: 0, seg: 0, hit: false, whoosh: false, queued: null, failed: false,
    opt: ev.optimal_frame || [Math.round(clip.n * 0.35)], end: ev.hit_end || [clip.n - 1], win: ev.combo_window || [] };
  aimAt(c);
}
const winOf = a => [a.win[a.seg * 2] ?? 0, a.win[a.seg * 2 + 1] ?? 1e9];
// the attack clip runs through combo segments: hit at OPTIMAL_FRAME, segment ends at HIT_END. Pressing attack again
// inside the COMBO_WINDOW chains the next segment; pressing before the window opens breaks the combo.
function attackTick(c, a) {
  const f = c.frame(), n = c.base.clip.n;
  const opt = a.opt[a.seg] ?? 0, end = Math.min(a.end[a.seg] ?? n - 1, n - 1);
  if (!a.whoosh && f >= opt - 3) { a.whoosh = true; playBuf(whooshBuf, at(c, 1.4), c.isPlayer ? 0.5 : 0.4, 5); }
  if (!a.hit && f >= opt) { a.hit = true; strike(c, a.dir); }
  if (!c.isPlayer && !a.decided && c.hostile) {
    const [ws] = winOf(a);
    if (f >= ws) { a.decided = true; if (Math.random() < c.skill && dist2(c, c.hostile) < REACH + 0.4) a.queued = Math.random() < 0.75 ? 'F' : pick(['L', 'R']); }
  }
  if (f >= end - 0.01 || c.done()) {
    const q = a.queued;
    if (q && !a.failed) {
      if (q === 'F' && a.dir === 'F' && a.seg + 1 < a.opt.length) { Object.assign(a, { seg: a.seg + 1, hit: false, whoosh: false, queued: null, decided: false }); aimAt(c); return; }
      startAttack(c, q); return;
    }
    c.act = null;
  }
}
function parade(c) {
  if (c.downed || c.drawing || (c.act && c.act.type !== 'parade')) return;
  c.play('T_1HPARADE_O', { loop: false, restart: true, blend: 0.06 }); c.act = { type: 'parade', id: ++actId, t: 0 };
}
function jumpBack(c) {
  if (c.downed || c.drawing || c.act) return;
  c.play('T_1HPARADEJUMPB', { loop: false, rm: true, restart: true, blend: 0.06 }); c.act = { type: 'jumpb', id: ++actId, t: 0 };
}
function strike(att, dir) {
  for (const t of entities) {
    if (t === att || t.downed) continue;
    const d = dist2(att, t); if (d > REACH) continue;
    if (att.fwd.dot(dirTo(att, t)) < (dir === 'F' ? 0.55 : 0.1)) continue; // side swings sweep a wider arc
    hurt(t, att);
  }
}
function hurt(t, att) {
  const toA = dirTo(t, att), facing = t.fwd.dot(toA);
  // parade: blocks a blow from the front while the parry animation is up
  if (t.act && t.act.type === 'parade' && facing > 0.4 && t.act.t < 0.95) {
    sfx.clash(t); if (att.act && att.act.type === 'attack') att.act.failed = true; return;
  }
  const dmg = Math.max(1, att.str + att.wdmg - t.prot);
  sfx.hit(t);
  if (t.cast && Math.random() < 0.6) bark(t, pick(['AARGH_1', 'AARGH_2', 'AARGH_3'])); else if (t.isPlayer) playAt(pick(['SVM_15_AARGH_1', 'SVM_15_AARGH_2']), at(t, 1.6), 1);
  t.hp -= dmg;
  // humans fighting with melee weapons don't kill each other: at 1 HP they go down unconscious (as in Gothic's arena)
  if (t.hp <= 1) { t.hp = 1; knockDown(t, att); }
  else {
    t.drawing = null; if (!t.drawn) { t.drawn = true; t.slot(true); }
    t.play(facing < -0.3 ? 'T_STUMBLEB' : 'T_STUMBLE', { loop: false, rm: true, restart: true, blend: 0.05 });
    t.act = { type: 'stumble', id: ++actId, t: 0 };
  }
  if (!t.isPlayer && t.hostile !== att && !t.downed) { if (att.isPlayer) bark(t, 'WATCHYOURAIM'); t.hostile = att; }
  for (const n of npcs) if (!n.downed && n !== t && n !== att && !n.hostile && n.idlePose === 'watch' && dist2(n, t) < 25 && Math.random() < 0.35) {
    n.overlay(Math.random() < 0.6 ? 'T_WATCHFIGHT_YEAH' : 'T_WATCHFIGHT_OHNO');
    if (Math.random() < 0.5) bark(n, pick(['CHEERFIGHT', 'THERESAFIGHT', 'OOH']), 200);
  }
}
function knockDown(t, att) {
  t.downed = true; t.drawing = null; t.mv.f = t.mv.s = 0; t.over = null;
  t.act = { type: 'down', id: ++actId, t: 0, phase: 'fall', until: t.isPlayer ? 8 : rand(12, 16) };
  t.play('T_STAND_2_WOUNDED', { loop: false, rate: 1.3, blend: 0.1 });
  for (const e of entities) if (e.hostile === t) e.hostile = null;
  t.hostile = null;
  if (t.isPlayer) { showMsg('You were knocked down… (R to get up)'); if (att.cast) bark(att, pick(['ITWASAGOODFIGHT', 'YEAHWELLDONE']), 1200); }
  else {
    if (att.isPlayer) showMsg(t.name + ' is down', 3000);
    else if (att.cast) bark(att, 'ITWASAGOODFIGHT', 1200);
    const fan = npcs.find(n => n !== t && n !== att && !n.downed && !n.hostile && dist2(n, t) < 25);
    if (fan) bark(fan, 'HEDEFEATEDHIM', 2500);
  }
}
function getUp(c) {
  c.play('T_WOUNDED_2_STAND', { loop: false, rate: 2, blend: 0.2 }); c.act = { type: 'getup', id: ++actId, t: 0 };
  c.hp = c.isPlayer ? Math.max(c.hp, Math.round(c.maxHp * 0.5)) : c.maxHp;
  if (c.isPlayer) showMsg('');
}
function tickAction(c, dt) {
  const a = c.act; if (!a) return;
  a.t += dt;
  if (a.type === 'attack') return attackTick(c, a);
  if (a.type === 'down') {
    if (a.phase === 'fall') { if (!a.snd && c.frame() > 44) { a.snd = true; sfx.fall(c); } if (c.done()) { a.phase = 'lie'; a.t = 0; c.play('S_WOUNDED', { blend: 0.3 }); } }
    else if (a.t > a.until) getUp(c);
    return;
  }
  if (a.type === 'getup') { if (c.done()) { c.act = null; c.downed = false; if (c.cast && Math.random() < 0.5) bark(c, 'YOUDEFEATEDMEWELL'); } return; }
  if (c.done()) c.act = null; // parade, jump back, stumble
}

// ---------------------------------------------------------------- input
const keys = {}; let pitch = 0.22, lockedUI = false, sneakOn = false, rmb = false;
let sens = store.get('sens', 1);
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
addEventListener('keydown', e => { if (MOVE_KEYS.includes(e.code) || e.code === 'Space') e.preventDefault(); if (!e.repeat) onKey(e); keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; rmb = false; });
function lockPointer() {
  // raw (unaccelerated) mouse deltas where supported; avoids OS acceleration making turning inconsistent
  try { const r = renderer.domElement.requestPointerLock({ unadjustedMovement: true }); if (r && r.catch) r.catch(() => renderer.domElement.requestPointerLock()); }
  catch { renderer.domElement.requestPointerLock(); }
}
renderer.domElement.addEventListener('click', () => { if (started && !lockedUI && !paused && !document.pointerLockElement) lockPointer(); });
// Gothic-style: the mouse turns the hero; the camera stays locked behind him
addEventListener('mousemove', e => {
  if (!document.pointerLockElement || lockedUI || paused) return;
  const mx = e.movementX, my = e.movementY;
  if (Math.abs(mx) > 300 || Math.abs(my) > 300) return; // Chrome on Windows sometimes reports huge bogus jumps under pointer lock
  if (!player.downed) player.heading -= mx * 0.0022 * sens;
  pitch = clamp(pitch + my * 0.0016 * sens, -0.35, 1.1);
});
const dirKeys = () => (keys.KeyA || keys.ArrowLeft ? 'L' : keys.KeyD || keys.ArrowRight ? 'R' : keys.KeyS || keys.ArrowDown ? 'B' : 'F');
addEventListener('mousedown', e => {
  if (!document.pointerLockElement || lockedUI || paused) return;
  if (e.button === 0) actionInput(dirKeys());
  if (e.button === 2) { rmb = true; if (player.drawn) parade(player); }
});
addEventListener('mouseup', e => { if (e.button === 2) rmb = false; });
addEventListener('contextmenu', e => e.preventDefault());
function actionInput(dir) {
  const p = player; if (p.downed) return;
  if (!p.drawn && !p.drawing) { if (!convo) toggleWeapon(p); return; }
  if (p.drawing) return;
  if (dir === 'B') return parade(p);
  const a = p.act;
  if (a && a.type === 'attack') { const f = p.frame(), [ws, we] = winOf(a); if (f < ws) a.failed = true; else if (f <= we + 0.5) a.queued = dir; return; }
  if (a && a.type !== 'parade') return;
  startAttack(p, dir);
}
// ---- start screen + pause menu (controls legend, volumes, mouse, restart)
let started = false, paused = false;
for (const id of ['startLegend', 'pauseLegend']) $(id).appendChild($('legendTpl').content.cloneNode(true));
function setPaused(v) {
  paused = v; $('pause').style.display = v ? 'flex' : 'none';
  if (v) { for (const k in keys) keys[k] = false; rmb = false; if (document.pointerLockElement) document.exitPointerLock(); $('btnResume').focus(); }
  else lockPointer();
}
// Esc releases pointer lock in every browser; treat losing the lock mid-game as "open the menu"
document.addEventListener('pointerlockchange', () => { if (started && !document.pointerLockElement && !lockedUI && !paused) setPaused(true); });
$('btnResume').addEventListener('click', () => setPaused(false));
$('btnRestart').addEventListener('click', () => { restartArena(); setPaused(false); });
$('volMusic').addEventListener('input', e => { musicVol = e.target.value / 100; if (musicVol > 0 && !musicOn) musicOn = true; applyMusicLevel(); });
$('volSfx').addEventListener('input', e => listener.setMasterVolume(e.target.value / 100));
$('sens').value = Math.round(sens * 100);
$('sens').addEventListener('input', e => { sens = e.target.value / 100; store.set('sens', sens); });
const STYLE_NAMES = { '': 'untrained', '1HST1': 'trained', '1HST2': 'master' };
function setStyle(s) { player.style = s; store.set('style', s); $('style').textContent = STYLE_NAMES[s]; }
setStyle(player.style in STYLE_NAMES ? player.style : '');
function restartArena() {
  if (convo) closeConvo();
  for (const c of entities) {
    Object.assign(c, { downed: false, act: null, drawing: null, hostile: null, vy: 0, hp: c.maxHp, over: null, lookT: 0, warn: 0, weapT: 0 });
    c.drawn = false; c.slot(false); c.play(c.isPlayer ? 'S_RUN' : 'S_RUN', { blend: 0 });
  }
  player.pos.copy(PLAYER_START()); player.heading = Math.PI * 0.75; showMsg('');
  for (const n of npcs) n.pos.copy(n.home);
  startDuel();
}
$('start').addEventListener('click', async () => { $('start').style.display = 'none'; started = true; if (actx.state !== 'running') await actx.resume(); startMusic(); lockPointer(); });
setText($('loadmsg'), [['Click to begin', F20]]);
setText($('startTitle'), [['THE ARENA', F20]]); setText($('pauseTitle'), [['PAUSED', F20]]);

// ---------------------------------------------------------------- dialogue
let convo = null;
function nearestTalker() {
  let b = null, bd = 3.2;
  for (const n of npcs) { if (n.downed || n.hostile || n.act) continue; const d = dist2(n, player); if (d < bd) { bd = d; b = n; } }
  return b;
}
function topicLabel(t) { const pl = t.lines.find(l => l.who === 'player') || t.lines[0]; const s = pl.text.replace(/\s+/g, ' '); return s.length > 56 ? s.slice(0, 54) + '…' : s; }
function openMenu(n) {
  convo = { npc: n, state: 'menu' }; lockedUI = true; document.exitPointerLock(); n.talking = false;
  const m = $('menu'); m.style.display = 'block'; m.innerHTML = '';
  const h = document.createElement('h3'); m.appendChild(h); setText(h, [[n.name + ' — ' + n.cast.role, F10HI]]);
  const opts = n.cast.topics.map(t => ({ label: topicLabel(t), run: () => playTopic(n, t) }));
  if (n.duty !== 'idle') opts.push({ label: '⚔ I challenge you to a fight!', run: () => { closeConvo(); n.hostile = player; bark(n, 'YOUASKEDFORIT'); } });
  opts.push({ label: 'Goodbye', run: closeConvo });
  n.cast.topics.forEach(t => t.lines.forEach(l => loadSound(l.wav)));
  // Gothic marks the hovered choice with the highlighted font
  opts.forEach((o, i) => {
    const d = document.createElement('div'), label = (i + 1) + '. ' + o.label; m.appendChild(d); d.onclick = o.run;
    setText(d, [[label, F10]]); d.onmouseenter = () => setText(d, [[label, F10HI]]); d.onmouseleave = () => setText(d, [[label, F10]]);
  });
  convo.opts = opts;
}
function playTopic(n, t) {
  $('menu').style.display = 'none'; convo.state = 'talk'; let i = 0;
  const next = () => {
    if (!convo || convo.npc !== n) return;
    if (i >= t.lines.length) { setText($('sub'), ''); n.talking = false; return openMenu(n); }
    const l = t.lines[i++]; n.talking = l.who === 'npc';
    setText($('sub'), [[(l.who === 'npc' ? n.name : 'You') + ': ', F10HI], [l.text, F10]], innerWidth * 0.6 / uiScale());
    playVoice(l.wav, () => setTimeout(next, 350));
  };
  next();
}
function closeConvo() { if (convo) convo.npc.talking = false; convo = null; lockedUI = false; $('menu').style.display = 'none'; setText($('sub'), ''); if (voiceAudio && voiceAudio.isPlaying) { voiceAudio.onEnded = () => {}; voiceAudio.stop(); } lockPointer(); }
const flash = t => showMsg(t, 2000);
function onKey(e) {
  if (!started) return;
  if (paused) { if (e.code === 'Escape' || e.code === 'KeyP') setPaused(false); return; }
  if (e.code === 'KeyP' && !convo) return setPaused(true);
  if (convo && convo.state === 'menu') { const i = parseInt(e.key) - 1; if (convo.opts[i]) convo.opts[i].run(); if (e.code === 'Escape') closeConvo(); return; }
  if (convo && e.code === 'Escape') return closeConvo();
  if (convo) return;
  const p = player;
  if (e.code === 'KeyE' && !p.downed && !p.drawn) { const n = nearestTalker(); if (n) openMenu(n); }
  if ((e.code === 'Space' || e.code === 'KeyF') && !p.downed) toggleWeapon(p);
  if (e.code === 'KeyC' || e.code === 'NumpadMultiply') { sneakOn = !sneakOn; flash(sneakOn ? 'Sneaking' : 'Running'); }
  if (e.code === 'KeyT') { const order = ['', '1HST1', '1HST2']; setStyle(order[(order.indexOf(p.style) + 1) % 3]); flash('One-handed: ' + STYLE_NAMES[p.style]); }
  if (e.code === 'KeyM') toggleMusic();
  if (e.code === 'KeyR' && p.downed && p.act && p.act.type === 'down') getUp(p);
}
function playerInput() {
  const p = player, k = keys;
  p.mv.f = 0; p.mv.s = 0;
  if (p.downed || lockedUI) return;
  p.mv.f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  p.mv.s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  p.gait = sneakOn ? 'sneak' : k.ShiftLeft || k.ShiftRight ? 'walk' : 'run';
  if (p.drawn && !p.drawing && p.mv.f < 0) { p.mv.f = 0; if (!p.act) jumpBack(p); }
  if (rmb && p.drawn && !p.drawing && !p.act) parade(p);
  // focus: the NPC the hero is looking at
  let best = null, bs = 1e9;
  for (const n of npcs) {
    if (n.downed) continue; const d = dist2(p, n); if (d > (p.drawn ? 10 : 7)) continue;
    const dot = p.fwd.dot(dirTo(p, n)); if (dot < 0.6) continue;
    const s = d * (2.2 - dot); if (s < bs) { bs = s; best = n; }
  }
  p.focus = best;
}

// ---------------------------------------------------------------- AI
function turnTo(n, p, dt, rate = 6) {
  const target = Math.atan2(-(p.x - n.pos.x), -(p.z - n.pos.z));
  let d = target - n.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  n.heading += clamp(d, -rate * dt, rate * dt);
  return Math.abs(d);
}
// what the NPC notices about the hero: noise depends on gait (sneaking is silent), sight on a forward cone
function perceive(n, dt) {
  const p = player; if (p.downed) return;
  const d = dist2(n, p), sees = d < 9 && n.fwd.dot(dirTo(n, p)) > 0.15, moving = p.mv.f || p.mv.s;
  const noise = p.act && p.act.type === 'attack' ? 10 : moving ? { run: 7, walk: 2.5, sneak: 0 }[p.gait] : 0;
  if (d < noise || (sees && d < 2.5)) n.lookT = Math.max(n.lookT || 0, 2.5);
  if (p.gait === 'sneak' && moving && sees && d < 6 && !(n.sneakCd > 0)) { bark(n, 'WHATAREYOUDOING'); n.sneakCd = 15; n.lookT = 4; }
  n.sneakCd = (n.sneakCd || 0) - dt;
  if (p.drawn && sees && d < 4 && n.duty !== 'duel') {
    n.weapT = (n.weapT || 0) + dt; n.warn = n.warn || 0;
    if (n.weapT > 0.8 && n.warn === 0) { bark(n, 'WEAPONDOWN'); n.warn = 1; n.lookT = 5; }
    else if (n.weapT > 6 && n.warn === 1) { bark(n, 'ISAIDWEAPONDOWN'); n.warn = 2; n.lookT = 5; }
    else if (n.weapT > 11 && n.warn === 2 && n.guard) { bark(n, 'YOUASKEDFORIT'); n.hostile = p; n.warn = 0; n.weapT = 0; }
  } else if (!p.drawn) { n.weapT = 0; n.warn = 0; }
}
function fight(n, tgt, dt) {
  const d = dist2(n, tgt);
  n.idlePose = null; n.gait = 'run';
  if (!n.drawn && !n.drawing) toggleWeapon(n);
  if (n.act) return; // attack/parade/jump in progress (combos are decided in attackTick)
  turnTo(n, tgt.pos, dt, 7);
  if (n.drawing) { if (d > 2) n.mv.f = 1; return; }
  if (d > REACH - 0.2) { n.mv.f = 1; return; }
  if (n.strafeT > 0) { n.strafeT -= dt; n.mv.s = n.strafeDir; return; }
  if (d < 0.9) return jumpBack(n);
  const ta = tgt.act;
  if (ta && ta.type === 'attack' && !ta.hit && tgt.fwd.dot(dirTo(tgt, n)) > 0.5) {
    const k = ta.id + ':' + ta.seg;
    if (n.reacted !== k) { n.reacted = k; if (Math.random() < n.skill * 0.85) return Math.random() < 0.8 ? parade(n) : jumpBack(n); }
  }
  n.think = (n.think || 0) - dt; if (n.think > 0) return;
  n.think = rand(0.3, 0.9) * (1.5 - n.skill);
  const r = Math.random();
  if (r < 0.55) startAttack(n, 'F'); else if (r < 0.8) startAttack(n, pick(['L', 'R'])); else { n.strafeT = rand(0.3, 0.6); n.strafeDir = pick([-1, 1]); }
}
function aiStep(n, dt) {
  n.mv.f = 0; n.mv.s = 0; n.gait = 'run';
  if (n.downed) return;
  if (convo && convo.npc === n) {
    n.idlePose = null; turnTo(n, player.pos, dt);
    n.gestT = (n.gestT || 0) - dt; if (n.talking && n.gestT < 0 && GESTURES.length) { n.overlay(pick(GESTURES)); n.gestT = rand(2.5, 4.5); }
    return;
  }
  if (n.hostile && n.hostile.downed) n.hostile = null;
  if (n.hostile) return fight(n, n.hostile, dt);
  if (n.drawn && !n.drawing && !n.act) { n.calmT = (n.calmT || 0) + dt; if (n.calmT > 1.5) { toggleWeapon(n); n.calmT = 0; } }
  if (n.act) return;
  perceive(n, dt);
  if (n.hostile) return;
  if (n.lookT > 0) { n.lookT -= dt; n.idlePose = null; turnTo(n, player.pos, dt, 4); return; }
  const dh = Math.hypot(n.pos.x - n.home.x, n.pos.z - n.home.z);
  if (dh > (n.duty === 'idle' ? 4 : 0.7)) { n.idlePose = null; n.gait = 'walk'; if (turnTo(n, n.home, dt, 5) < 0.6) n.mv.f = 1; return; }
  if (n.duty === 'watch' || n.duty === 'duel') {
    const away = turnTo(n, PIT, dt, 3);
    if (n.duty === 'watch' && away < 0.3) {
      n.idlePose = 'watch';
      n.rndT = (n.rndT || rand(2, 6)) - dt; if (n.rndT < 0) { n.rndT = rand(4, 9); if (n.base && n.base.name === 'S_WATCHFIGHT') n.overlay(pick(['T_WATCHFIGHTRANDOM1', 'T_WATCHFIGHTRANDOM2', 'T_WATCHFIGHTRANDOM3', 'T_WATCHFIGHTRANDOM4'])); }
    }
  } else if (n.duty === 'guard') { if (turnTo(n, PIT, dt, 3) < 0.3) n.idlePose = 'guard'; }
  else if (n.duty === 'idle') {
    n.idlePose = null; n.wt = (n.wt || 0) - dt;
    if (n.wt < 0) { n.wt = rand(4, 9); n.wander = n.home.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3))); }
    if (n.wander && Math.hypot(n.wander.x - n.pos.x, n.wander.z - n.pos.z) > 0.4) { n.gait = 'walk'; if (turnTo(n, n.wander, dt, 4) < 0.5) n.mv.f = 1; }
  }
}

// ---------------------------------------------------------------- music
// Prefers the game's own themes rendered by export_music.py (calm + fight, crossfaded by combat intensity).
// Falls back to a small procedural score if those files are missing.
let musicOn = true, mgain = null, nextNote = 0, step = 0, intensity = 0, musicVol = 0.7, procedural = false;
const tracks = {};
const musicLevel = () => (musicOn ? musicVol * (procedural ? 0.32 : 1) : 0);
const fetchBuf = u => fetch(u).then(r => (r.ok ? r.arrayBuffer() : null)).then(b => b && actx.decodeAudioData(b)).catch(() => null);
async function startMusic() {
  if (mgain) return; mgain = actx.createGain(); mgain.gain.value = 0; mgain.connect(actx.destination);
  $('musicSrc').textContent = 'loading…';
  const [std, fgt] = await Promise.all([fetchBuf(E + 'music/oc_std.wav'), fetchBuf(E + 'music/oc_fgt.wav')]);
  if (std) {
    for (const [k, b] of [['std', std], ['fgt', fgt || std]]) {
      const s = actx.createBufferSource(); s.buffer = b; s.loop = true;
      const g = actx.createGain(); g.gain.value = k === 'std' ? 1 : 0; s.connect(g).connect(mgain); s.start(); tracks[k] = g;
    }
    $('musicSrc').textContent = 'Old Camp theme';
  } else {
    procedural = true; $('musicSrc').textContent = 'generated';
    [73.42, 110, 146.83].forEach((f, i) => { const o = actx.createOscillator(); o.type = i ? 'triangle' : 'sawtooth'; o.frequency.value = f; const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; const g = actx.createGain(); g.gain.value = i ? 0.05 : 0.07; o.connect(lp).connect(g).connect(mgain); o.start(); });
    nextNote = actx.currentTime + 0.2; setInterval(schedule, 100);
  }
  mgain.gain.setTargetAtTime(musicLevel(), actx.currentTime, 0.8);
}
function applyMusicLevel() { if (mgain) mgain.gain.setTargetAtTime(musicLevel(), actx.currentTime, 0.15); }
function toggleMusic() { musicOn = !musicOn; applyMusicLevel(); }
function mixMusic() { // equal-power crossfade between calm and fight themes
  if (!tracks.std) return;
  tracks.std.gain.value = Math.cos(intensity * Math.PI / 2); tracks.fgt.gain.value = Math.sin(intensity * Math.PI / 2);
}
const DORIAN = [0, 2, 3, 5, 7, 9, 10], ROOT = 146.83;
const CHORDS = [[0, 2, 4], [6, 1, 3], [3, 5, 0], [0, 2, 4]];
const noteF = d => ROOT * Math.pow(2, (DORIAN[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7)) / 12);
function pluck(t, f, v = 0.35, len = 1.2) {
  const o = actx.createOscillator(), o2 = actx.createOscillator(), g = actx.createGain(), lp = actx.createBiquadFilter();
  o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2; lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(500, t + len);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(lp); o2.connect(lp); lp.connect(g).connect(mgain); o.start(t); o2.start(t); o.stop(t + len + 0.1); o2.stop(t + len + 0.1);
}
function thump(t, f = 70, v = 0.8) { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.setValueAtTime(f * 1.8, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.12); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); o.connect(g).connect(mgain); o.start(t); o.stop(t + 0.4); }
function schedule() {
  const spb = 60 / (92 + intensity * 28) / 2;
  while (nextNote < actx.currentTime + 0.4) {
    const bar = Math.floor(step / 8) % CHORDS.length, ch = CHORDS[bar], s8 = step % 8;
    const arp = [0, 1, 2, 1, 0, 2, 1, 2][s8];
    pluck(nextNote, noteF(ch[arp] + 7), 0.28 + (s8 % 4 === 0 ? 0.1 : 0), 1.1);
    if (s8 === 0) pluck(nextNote, noteF(ch[0] - 7), 0.35, 2.4);
    if (s8 === 4 && Math.random() < 0.7) pluck(nextNote, noteF(ch[2] + 14 + (Math.random() < 0.5 ? 0 : -1)), 0.2, 1.5);
    if (intensity > 0.2 && s8 % 2 === 0) thump(nextNote, s8 % 4 === 0 ? 62 : 85, 0.5 + intensity * 0.4);
    nextNote += spb; step++;
  }
}

// ---------------------------------------------------------------- torches and fires (Gothic's dynamic light vobs)
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const flames = [];
for (const L of world.lights || []) {
  const col = new THREE.Color(L.c[0] / 255, L.c[1] / 255, L.c[2] / 255);
  const pl = new THREE.PointLight(col, 8, Math.min(L.r, 15), 1.5); pl.position.set(...L.p); scene.add(pl);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true }));
  s.position.copy(pl.position); s.scale.set(1.4, 1.4, 1); scene.add(s);
  flames.push({ pl, s, flicker: L.flicker, ph: Math.random() * 10 });
}

// ---------------------------------------------------------------- HUD
function updateHud() {
  const p = player, f = p.focus, tag = $('ftag');
  if (f && !convo) {
    const v = f.pos.clone().setY(f.pos.y + 2.05).project(camera);
    if (v.z < 1 && v.z > 0) { tag.style.display = 'block'; tag.style.left = (v.x * 0.5 + 0.5) * innerWidth + 'px'; tag.style.top = (-v.y * 0.5 + 0.5) * innerHeight + 'px'; setText(tag, f.name); }
    else tag.style.display = 'none';
  } else tag.style.display = 'none';
  // Gothic shows the focused opponent's health at the top while you fight
  const foe = f && (p.drawn || f.hostile === p) ? f : null;
  $('ehp').style.display = foe ? 'block' : 'none';
  if (foe) { setText($('ehpn'), foe.name); $('ehpf').style.width = Math.max(0, (100 * foe.hp) / foe.maxHp) + '%'; }
  $('hpf').style.width = Math.max(0, (100 * p.hp) / p.maxHp) + '%';
  setText($('gait'), sneakOn ? 'sneaking' : keys.ShiftLeft || keys.ShiftRight ? 'walking' : '');
  const t = nearestTalker(); setText($('prompt'), !convo && t && !p.downed && !p.drawn ? 'E — talk to ' + t.name : '');
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock(); let pivotY = null, hudT = 0;
function updateCamera(dt) {
  const p = player, h = p.heading;
  const headY = p.pos.y + (p.downed ? 0.6 : p.gait === 'sneak' ? 1.25 : 1.6);
  pivotY = pivotY === null ? headY : pivotY + (headY - pivotY) * Math.min(1, dt * 10); // smooth steps, not turning
  const piv = new THREE.Vector3(p.pos.x, pivotY, p.pos.z);
  const dist = p.drawn ? 2.7 : 3.2;
  const off = new THREE.Vector3(Math.sin(h) * Math.cos(pitch), Math.sin(pitch), Math.cos(h) * Math.cos(pitch));
  const hit = segCast(piv, piv.clone().addScaledVector(off, dist + 0.3));
  const dd = hit === null ? dist : Math.max(0.3, Math.min(dist, hit - 0.3));
  camera.position.copy(piv).addScaledVector(off, dd);
  camera.lookAt(piv);
  if (window.__dbgCam) { camera.position.copy(window.__dbgCam.pos); camera.lookAt(window.__dbgCam.target); }
  sky.position.copy(camera.position);
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (paused) { renderer.render(scene, camera); requestAnimationFrame(frame); return; } // world frozen behind the menu
  playerInput();
  if (convo) { player.mv.f = player.mv.s = 0; turnTo(player, convo.npc.pos, dt); }
  const ai = !window.__freezeAI;
  if (ai) for (const n of npcs) aiStep(n, dt);
  // duellists start again a few seconds after both are back on their feet
  if (duelists.length === 2 && duelists.every(d => !d.downed && !d.hostile && !d.act)) { duelWait += dt; if (duelWait > 4) startDuel(); } else duelWait = 0;
  for (const c of entities) {
    if (!c.isPlayer && !ai) { c.update(0); c.sync(); continue; }
    drawTick(c, dt); tickAction(c, dt);
    let mv = null;
    if (!c.act) { if (!c.mv.f && !c.mv.s && c.idlePose) poseTick(c); else mv = locomote(c, dt); }
    c.update(dt);
    if (mv) moveBy(c, mv[0], mv[1]);
    const rm = c.act ? c.rootMotion() : null;
    if (rm) { const ch = Math.cos(c.heading), sh = Math.sin(c.heading); moveBy(c, rm[0] * ch + rm[1] * sh, -rm[0] * sh + rm[1] * ch); }
    settle(c, dt);
    if (gTri >= 0) c.groundKind = tris[gTri].kind;
  }
  for (const n of entities) for (const o of entities) {
    if (o === n || o.downed || n.downed) continue;
    const dx = n.pos.x - o.pos.x, dz = n.pos.z - o.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.75 && d > 1e-4) { n.pos.x += (dx / d) * (0.75 - d) * 0.5; n.pos.z += (dz / d) * (0.75 - d) * 0.5; }
  }
  entities.forEach(e => e.sync());
  const fighting = npcs.some(n => n.hostile && !n.downed);
  intensity += ((fighting ? 1 : 0) - intensity) * Math.min(1, dt * 0.6); mixMusic();
  updateCamera(dt);
  const now = performance.now() * 0.001;
  for (const f of flames) { const k = f.flicker ? 0.82 + 0.12 * Math.sin(now * 11 + f.ph) + 0.06 * Math.random() : 1; f.pl.intensity = 8 * k; f.s.scale.setScalar(1.4 * k); }
  if ((hudT += dt) > 0.05) { hudT = 0; updateHud(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
window.__game = {
  player, npcs, camera, scene, THREE, CLIPS, PIT, startDuel, startAttack, parade, jumpBack, toggleWeapon, knockDown, actionInput, setStyle, hurt, tris: tris.length,
  get yaw() { return player.heading; }, set yaw(v) { player.heading = v; }, set pitch(v) { pitch = v; },
  set sneak(v) { sneakOn = v; },
};
if (params.has('auto')) { $('start').style.display = 'none'; started = true; startMusic(); }
frame();
