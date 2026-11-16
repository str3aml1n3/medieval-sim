import * as THREE from 'three';

const E = '../export/';
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const SKY = 0x9db4c8;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 45, 150);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 400);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const sun = new THREE.DirectionalLight(0xfff0d0, 1.6); sun.position.set(-30, 60, 20); scene.add(sun);

// ---------------------------------------------------------------- loading
const jget = u => fetch(E + u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
const texLoader = new THREE.TextureLoader();
const texCache = {};
function getTex(name, repeat = true) {
  if (!texCache[name]) {
    const t = texLoader.load(E + 'tex/' + name + '.png');
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    texCache[name] = t;
  }
  return texCache[name];
}
let world, chars, dlg, wps;
try { [world, chars, dlg, wps] = await Promise.all([jget('world.json'), jget('chars.json'), jget('dialogue.json'), jget('waypoints.json')]); }
catch (err) { $('loadmsg').innerHTML = 'Game assets not found.<br><small>Assets are extracted locally from your own Gothic install and are not hosted here.<br>See the README: run the export scripts, then serve the repo root and open /web/.</small>'; throw err; }
const WP = Object.fromEntries(wps.map(w => [w.n, new THREE.Vector3(w.x, w.y, w.z)]));

// ---------------------------------------------------------------- world + collision grid
const tris = []; // {a,b,c,n,minY,maxY}
const CELL = 3, grid = new Map();
const key = (cx, cz) => cx * 8192 + cz;
function addTri(a, b, c) {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const l = n.length(); if (l < 1e-6) return; n.divideScalar(l);
  const t = { a, b, c, n, tri: new THREE.Triangle(a, b, c) };
  const idx = tris.push(t) - 1;
  const x0 = Math.min(a.x, b.x, c.x), x1 = Math.max(a.x, b.x, c.x), z0 = Math.min(a.z, b.z, c.z), z1 = Math.max(a.z, b.z, c.z);
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      const k = key(cx, cz); let l2 = grid.get(k); if (!l2) grid.set(k, l2 = []); l2.push(idx);
    }
}
for (const m of world.meshes) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.u, 2));
  g.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ map: getTex(m.tex), alphaTest: m.alpha ? 0.5 : 0, side: m.alpha ? THREE.DoubleSide : THREE.FrontSide });
  scene.add(new THREE.Mesh(g, mat));
  if (!m.alpha) for (let i = 0; i < m.p.length; i += 9)
    addTri(new THREE.Vector3(m.p[i], m.p[i + 1], m.p[i + 2]), new THREE.Vector3(m.p[i + 3], m.p[i + 4], m.p[i + 5]), new THREE.Vector3(m.p[i + 6], m.p[i + 7], m.p[i + 8]));
}
function cellTris(x, z) { return grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || []; }
function groundAt(x, z, yRef, step = 0.7) {
  let best = null;
  for (const i of cellTris(x, z)) {
    const t = tris[i]; if (t.n.y < 0.45) continue;
    const { a, b, c } = t;
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z); if (Math.abs(d) < 1e-9) continue;
    const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
    const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
    const l3 = 1 - l1 - l2; if (l1 < -0.001 || l2 < -0.001 || l3 < -0.001) continue;
    const y = l1 * a.y + l2 * b.y + l3 * c.y;
    if (y <= yRef + step && (best === null || y > best)) best = y;
  }
  return best;
}
const _c = new THREE.Vector3(), _p = new THREE.Vector3();
function pushOut(pos, r = 0.42) {
  for (let it = 0; it < 2; it++) {
    _c.set(pos.x, pos.y + 0.95, pos.z);
    for (const i of cellTris(pos.x, pos.z)) {
      const t = tris[i]; if (t.n.y > 0.45) continue;
      if (Math.max(t.a.y, t.b.y, t.c.y) < pos.y + 0.35 || Math.min(t.a.y, t.b.y, t.c.y) > pos.y + 1.7) continue;
      t.tri.closestPointToPoint(_c, _p);
      const dx = _c.x - _p.x, dz = _c.z - _p.z, h = Math.hypot(dx, dz), dy = _c.y - _p.y, dist = Math.hypot(h, dy);
      if (dist < r && h > 1e-5) { const k = (r - dist) / h; pos.x += dx * k; pos.z += dz * k; _c.set(pos.x, pos.y + 0.95, pos.z); }
    }
  }
}
function settle(e, dt) {
  const g = groundAt(e.pos.x, e.pos.z, e.pos.y + 0.2);
  if (g === null) { e.vy -= 20 * dt; e.pos.y += e.vy * dt; if (e.pos.y < -60) e.pos.y = e.lastGood; return; }
  if (e.pos.y > g + 0.05) { e.vy -= 20 * dt; e.pos.y = Math.max(g, e.pos.y + e.vy * dt); if (e.pos.y === g) e.vy = 0; }
  else { e.pos.y = g; e.vy = 0; }
  e.lastGood = e.pos.y;
}

// ---------------------------------------------------------------- audio
const listener = new THREE.AudioListener(); camera.add(listener); scene.add(camera);
const actx = listener.context;
const abuf = {};
async function loadSound(n) {
  n = n.toUpperCase();
  if (abuf[n]) return abuf[n];
  abuf[n] = fetch(E + 'audio/' + n + '.wav').then(r => r.arrayBuffer()).then(b => actx.decodeAudioData(b)).catch(() => null);
  return abuf[n];
}
async function playAt(name, pos, vol = 1, ref = 7) {
  const b = await loadSound(name); if (!b) return null;
  const a = new THREE.PositionalAudio(listener); a.setBuffer(b); a.setRefDistance(ref); a.setVolume(vol);
  const o = new THREE.Object3D(); o.position.copy(pos); scene.add(o); o.add(a);
  a.onEnded = () => { a.isPlaying = false; scene.remove(o); }; a.play(); return a;
}
let voiceAudio = null;
async function playVoice(name, onDone) {
  const b = await loadSound(name);
  if (voiceAudio && voiceAudio.isPlaying) { voiceAudio.onEnded = () => {}; voiceAudio.stop(); }
  if (!b) { setTimeout(onDone, 1500); return; }
  const a = new THREE.Audio(listener); a.setBuffer(b); a.setVolume(1); a.onEnded = () => { a.isPlaying = false; onDone && onDone(); }; a.play(); voiceAudio = a;
}

// ---------------------------------------------------------------- characters
const bonesDef = chars.bones;
function partGeo(p) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(p.u, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(p.si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(p.sw, 4));
  g.computeVertexNormals(); return g;
}
const geoCache = new Map();
const gGeo = p => { if (!geoCache.has(p)) geoCache.set(p, partGeo(p)); return geoCache.get(p); };
let feetOffset = 1.02;
{ let mn = 9; for (const part of chars.outfits.GRDM) for (let i = 1; i < part.p.length; i += 3) mn = Math.min(mn, part.p[i]); feetOffset = -mn; }
const axes = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const bi = name => bonesDef.findIndex(b => b.name === name);

class Char {
  constructor(o) {
    Object.assign(this, { name: 'NPC', hp: 100, maxHp: 100, pos: new THREE.Vector3(), vy: 0, lastGood: 0, heading: 0, speed: 0, hostile: null, state: 'idle', t: 0, atkT: -1, atkCd: 0, blocking: false, drawn: false, hurtT: 0, dead: false, deadT: 0, phase: 0, talking: false, isPlayer: false, ai: null }, o);
    this.root = new THREE.Group(); this.body = new THREE.Group(); this.body.position.y = feetOffset; this.root.add(this.body);
    this.bones = bonesDef.map(b => { const n = new THREE.Bone(); n.name = b.name; new THREE.Matrix4().fromArray(b.m).decompose(n.position, n.quaternion, n.scale); return n; });
    bonesDef.forEach((b, i) => { if (b.parent < 0) this.body.add(this.bones[i]); else this.bones[b.parent].add(this.bones[i]); });
    this.body.updateMatrixWorld(true);
    this.skel = new THREE.Skeleton(this.bones);
    const parts = [...chars.outfits[o.outfit], ...(chars.heads[o.head] || [])];
    const mk = (p, vis = true) => { const m = new THREE.SkinnedMesh(gGeo(p), new THREE.MeshLambertMaterial({ map: getTex(p.tex), alphaTest: 0.4 })); m.frustumCulled = false; this.body.add(m); m.bind(this.skel, m.matrixWorld); return m; };
    parts.forEach(p => mk(p));
    this.weapon = (chars.weapons[o.weapon] || []).map(p => mk(p)); this.weapon.forEach(m => m.visible = false);
    this.rest = this.bones.map(b => b.quaternion.clone());
    scene.add(this.root);
    this.limb = n => ({ i: bi(n), name: n });
  }
  setDrawn(v) { this.drawn = v; this.weapon.forEach(m => m.visible = v); }
  get fwd() { return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)); }
  rot(name, ang) {
    const i = bi(name); if (i < 0) return; const c = CAL[name]; if (!c) return;
    this.bones[i].quaternion.copy(this.rest[i]).multiply(new THREE.Quaternion().setFromAxisAngle(c.axis, c.sign * ang));
  }
  update(dt) {
    // reset pose
    this.bones.forEach((b, i) => b.quaternion.copy(this.rest[i]));
    const sp = this.speed, run = sp > 2.5;
    this.phase += dt * (sp > 0.1 ? 2.2 + sp * 1.4 : 0);
    const k = Math.min(1, sp / 2);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    if (!this.dead) {
      this.rot('BIP01 L THIGH', s * 0.75 * k); this.rot('BIP01 R THIGH', -s * 0.75 * k);
      this.rot('BIP01 L CALF', -(0.15 + Math.max(0, -c) * 0.9) * k); this.rot('BIP01 R CALF', -(0.15 + Math.max(0, c) * 0.9) * k);
      let armR = -s * 0.5 * k, armL = s * 0.5 * k, foreR = 0.2 + 0.25 * k, foreL = 0.2 + 0.25 * k, lean = 0.08 * k + (run ? 0.12 : 0);
      if (!this.atkT || this.atkT < 0) {
        if (this.drawn) { armR = 0.5; foreR = 1.0; armL = 0.2; }
        if (this.blocking) { armR = 1.4; foreR = 1.5; armL = 0.6; }
        if (this.talking) { const g = Math.sin(this.t * 3) * 0.3; armR = 0.5 + g; foreR = 0.9 + g; armL = 0.4 - g; foreL = 0.8; }
        if (this.cheer) { armR = 2.3 + Math.sin(this.t * 14) * 0.25; armL = 2.2 - Math.sin(this.t * 14) * 0.25; foreR = 0.3; foreL = 0.3; }
      } else {
        const a = this.atkT / 0.7; // 0..1
        const w = a < 0.4 ? a / 0.4 : a < 0.55 ? 1 - (a - 0.4) / 0.15 : 0.0 + (1 - (a - 0.55) / 0.45) * 0.0;
        armR = a < 0.4 ? 0.6 + 1.9 * (a / 0.4) : a < 0.55 ? 2.5 - 2.1 * ((a - 0.4) / 0.15) : 0.4 + 0.1 * (1 - (a - 0.55) / 0.45);
        foreR = a < 0.4 ? 1.0 : 0.3; lean = a < 0.4 ? -0.15 : a < 0.6 ? 0.55 : 0.2; armL = 0.4;
      }
      if (this.hurtT > 0) { lean = -0.5 * (this.hurtT / 0.3); }
      this.rot('BIP01 R UPPERARM', armR); this.rot('BIP01 L UPPERARM', armL);
      this.rot('BIP01 R FOREARM', foreR); this.rot('BIP01 L FOREARM', foreL);
      this.rot('BIP01 SPINE1', lean); this.rot('BIP01 SPINE', lean * 0.5);
      this.rot('BIP01 SPINE2', Math.sin(this.t * 1.7) * 0.01);
    }
    // bob
    this.body.position.y = feetOffset + (this.dead ? 0 : Math.abs(s) * 0.03 * k);
    // fall
    if (this.dead) { this.deadT = Math.min(1, this.deadT + dt * 1.6); this.root.rotation.x = -Math.PI / 2 * (1 - Math.pow(1 - this.deadT, 2)); this.body.position.y = feetOffset * 0.0 + 0.1 * this.deadT; }
    this.root.position.copy(this.pos); this.root.rotation.y = this.heading;
    if (this.dead) { const f = this.fwd; this.root.position.addScaledVector(f, 0.0); }
    this.t += dt; if (this.hurtT > 0) this.hurtT -= dt;
  }
}

// calibrate limb axes once with a throw-away skeleton
const CAL = {};
{
  const tmp = new Char({ outfit: 'GRDM', head: 'BALD', weapon: 'sword' });
  tmp.root.updateMatrixWorld(true);
  const fwdWorld = new THREE.Vector3(0, 0, -1);
  const pairs = [['BIP01 L THIGH', 'BIP01 L CALF'], ['BIP01 R THIGH', 'BIP01 R CALF'], ['BIP01 L CALF', 'BIP01 L FOOT'], ['BIP01 R CALF', 'BIP01 R FOOT'],
    ['BIP01 L UPPERARM', 'BIP01 L FOREARM'], ['BIP01 R UPPERARM', 'BIP01 R FOREARM'], ['BIP01 L FOREARM', 'BIP01 L HAND'], ['BIP01 R FOREARM', 'BIP01 R HAND'],
    ['BIP01 SPINE', 'BIP01 SPINE1'], ['BIP01 SPINE1', 'BIP01 HEAD'], ['BIP01 SPINE2', 'BIP01 HEAD']];
  const wa = new THREE.Vector3(), wb = new THREE.Vector3();
  for (const [bn, cn] of pairs) {
    const bI = bi(bn), cI = bi(cn); if (bI < 0 || cI < 0) { console.warn('missing bone', bn, cn); continue; }
    let best = null;
    for (const ax of ['x', 'y', 'z']) {
      const q0 = tmp.bones[bI].quaternion.clone();
      tmp.bones[bI].quaternion.copy(q0).multiply(new THREE.Quaternion().setFromAxisAngle(axes[ax], 0.4));
      tmp.root.updateMatrixWorld(true);
      tmp.bones[bI].getWorldPosition(wa); tmp.bones[cI].getWorldPosition(wb);
      const d = wb.sub(wa).dot(fwdWorld);
      tmp.bones[bI].quaternion.copy(q0); tmp.root.updateMatrixWorld(true);
      // reference: rest displacement
      tmp.bones[bI].getWorldPosition(wa); tmp.bones[cI].getWorldPosition(wb);
      const d0 = wb.sub(wa).dot(fwdWorld);
      const delta = d - d0; if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { ax, delta };
    }
    CAL[bn] = { axis: axes[best.ax], sign: Math.sign(best.delta) || 1 };
  }
  scene.remove(tmp.root);
  console.log('calibration', Object.fromEntries(Object.entries(CAL).map(([k, v]) => [k, (v.sign > 0 ? '+' : '-') + (v.axis.x ? 'x' : v.axis.y ? 'y' : 'z')])));
}

// ---------------------------------------------------------------- entities
const entities = [];
const player = new Char({ name: 'You', outfit: 'GRDM', head: 'FIGHTER', weapon: 'sword', isPlayer: true });
player.pos.copy(WP.OCR_OUTSIDE_ARENA || new THREE.Vector3(49.7, -9.5, -42.4)); player.pos.y += 0.5; player.heading = Math.PI * 0.75; entities.push(player);
const wpFix = (name, dy = 0.6) => { const w = WP[name]; return w ? w.clone().add(new THREE.Vector3(0, dy, 0)) : new THREE.Vector3(40, -9, -34); };
const PIT = wpFix('OCR_ARENABATTLE', 0.8);
const castCfg = {
  KIRGO: { outfit: 'SLDM', head: 'FIGHTER', weapon: 'sword', pos: PIT.clone().add(new THREE.Vector3(-1.8, 0, 0)), role: 'duel' },
  WHISTLER: { outfit: 'STTM', head: 'THIEF', weapon: 'axe', pos: PIT.clone().add(new THREE.Vector3(1.8, 0, 0)), role: 'duel' },
  THORUS: { outfit: 'GRDM', head: 'BALD', weapon: 'sword', pos: wpFix('OCR_ARENA_03'), role: 'watch' },
  BLOODWYN: { outfit: 'SLDM', head: 'FATBALD', weapon: 'mace', pos: wpFix('OCR_ARENA_06'), role: 'watch' },
  FLETCHER: { outfit: 'STTM', head: 'PSIONIC', weapon: 'hammer', pos: wpFix('OCR_ARENA_09'), role: 'watch' },
  SNAF: { outfit: 'VLKM', head: 'PONY', weapon: 'mace', pos: wpFix('OCR_OUTSIDE_ARENA_BENCH1'), role: 'idle' },
};
const npcs = [];
for (const c of dlg.cast) {
  const cfg = castCfg[c.id]; if (!cfg) continue;
  const e = new Char({ name: c.name, role2: c.role, outfit: cfg.outfit, head: cfg.head, weapon: cfg.weapon, cast: c, post: cfg.pos.clone(), duty: cfg.role });
  e.pos.copy(cfg.pos); e.home = cfg.pos.clone(); entities.push(e); npcs.push(e);
}
// preload sounds
for (const s of dlg.sfx) loadSound(s);
for (const c of dlg.cast) for (const b of Object.values(c.barks)) loadSound(b);
['SVM_15_AARGH_1', 'SVM_15_AARGH_2'].forEach(loadSound);
const duelists = npcs.filter(n => n.duty === 'duel');
function startDuel() {
  const [a, b] = duelists; if (!a || !b) return;
  const p = PIT;
  [a, b].forEach((n, i) => { n.dead = false; n.deadT = 0; n.root.rotation.x = 0; n.hp = n.maxHp; n.pos.copy(p).add(new THREE.Vector3(i ? 1.8 : -1.8, 0, 0)); n.setDrawn(true); n.state = 'fight'; });
  a.hostile = b; b.hostile = a; $('msg').textContent = '';
}
startDuel();
for (const n of npcs) if (n.duty !== 'duel') { n.setDrawn(false); }

// ---------------------------------------------------------------- input
const keys = {}; let yaw = 0.0, pitch = 0.25, lockedUI = false;
addEventListener('keydown', e => { keys[e.code] = true; onKey(e); });
addEventListener('keyup', e => { keys[e.code] = false; });
renderer.domElement.addEventListener('click', () => { if (!lockedUI && !document.pointerLockElement) renderer.domElement.requestPointerLock(); });
addEventListener('mousemove', e => { if (document.pointerLockElement) { yaw -= e.movementX * 0.0025; pitch = Math.max(-0.3, Math.min(1.1, pitch + e.movementY * 0.0025)); } });
addEventListener('mousedown', e => { if (!document.pointerLockElement || lockedUI) return; if (e.button === 0) playerAttack(); if (e.button === 2) player.blocking = true; });
addEventListener('mouseup', e => { if (e.button === 2) player.blocking = false; });
addEventListener('contextmenu', e => e.preventDefault());
$('start').addEventListener('click', async () => { $('start').style.display = 'none'; if (actx.state !== 'running') await actx.resume(); startMusic(); renderer.domElement.requestPointerLock(); });
$('loadmsg').textContent = 'Click to begin';

// ---------------------------------------------------------------- combat
function dist2(a, b) { return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z); }
function bark(e, name) { if (e.cast && e.cast.barks[name]) playAt(e.cast.barks[name], e.pos.clone().setY(e.pos.y + 1.6), 1.2, 9); else if (e.isPlayer) playAt(pick(['SVM_15_AARGH_1', 'SVM_15_AARGH_2']), e.pos, 1); }
function hurt(target, attacker, dmg) {
  if (target.dead) return;
  const toA = new THREE.Vector3().subVectors(attacker.pos, target.pos).setY(0).normalize();
  if (target.blocking && target.fwd.dot(toA) > 0.3) { playAt('ANVILHIT0' + (1 + Math.floor(Math.random() * 2)), target.pos.clone().setY(target.pos.y + 1.2), 1.2); dmg *= 0.15; }
  else playAt('SWORD_FINALHIT', target.pos.clone().setY(target.pos.y + 1.2), 1.4);
  target.hp -= dmg; target.hurtT = 0.3;
  if (target.cast && Math.random() < 0.5) bark(target, pick(['AARGH_1', 'AARGH_2', 'AARGH_3'])); else if (target.isPlayer) bark(target, '');
  if (target.hp <= 0) die(target, attacker);
  else if (!target.isPlayer && !target.hostile && target.duty !== 'duel') { target.hostile = attacker; target.state = 'fight'; target.setDrawn(true); }
  else if (!target.isPlayer && target.duty === 'duel' && attacker.isPlayer) { target.hostile = attacker; }
  // crowd cheers
  for (const n of npcs) if (!n.dead && n !== target && n !== attacker && n.duty === 'watch' && Math.random() < 0.18) { n.cheerT = 1.2; bark(n, pick(['CHEERFIGHT', 'THERESAFIGHT', 'OOH'])); }
}
function die(t, killer) {
  t.dead = true; t.hp = 0; t.speed = 0; t.talking = false; t.blocking = false; t.cheer = false; t.hostile = null;
  if (t.cast) bark(t, 'DEAD');
  if (t.isPlayer) { $('msg').textContent = 'You were defeated… (R to restart)'; }
  else if (killer && killer.isPlayer) { $('msg').textContent = t.name + ' is down'; setTimeout(() => $('msg').textContent = '', 3000); }
  if (killer && killer.cast) { killer.hostile = null; setTimeout(() => bark(killer, pick(['ITWASAGOODFIGHT', 'YEAHWELLDONE'])), 600); }
  if (t.duty === 'duel') setTimeout(() => { if (duelists.every(d => d.dead || d.hostile === null || true)) startDuel(); }, 9000);
  else if (!t.isPlayer) setTimeout(() => { t.dead = false; t.deadT = 0; t.root.rotation.x = 0; t.hp = t.maxHp; t.pos.copy(t.home); t.hostile = null; t.state = 'idle'; t.setDrawn(false); }, 20000);
}
function playerAttack() {
  const p = player; if (p.dead || p.talking || p.atkT >= 0 || p.atkCd > 0) return;
  if (!p.drawn) { p.setDrawn(true); playAt('SWORD_DRAW_01', p.pos, 1); return; }
  p.atkT = 0; p.atkCd = 0.85; p.hitDone = false;
}
function strike(att, targets, dmgMin, dmgMax, range = 2.3) {
  for (const t of targets) {
    if (t === att || t.dead) continue;
    const to = new THREE.Vector3().subVectors(t.pos, att.pos).setY(0); const d = to.length(); if (d > range) continue;
    to.normalize(); if (att.fwd.dot(to) < 0.4) continue;
    hurt(t, att, rand(dmgMin, dmgMax));
  }
}

// ---------------------------------------------------------------- dialogue
let convo = null;
function nearestTalker() {
  let b = null, bd = 3.2; for (const n of npcs) { if (n.dead || n.hostile || n.state === 'fight') continue; const d = dist2(n, player); if (d < bd) { bd = d; b = n; } } return b;
}
function topicLabel(t) { const pl = t.lines.find(l => l.who === 'player') || t.lines[0]; const s = pl.text.replace(/\s+/g, ' '); return s.length > 56 ? s.slice(0, 54) + '…' : s; }
function openMenu(n) {
  convo = { npc: n, state: 'menu' }; lockedUI = true; document.exitPointerLock(); n.talking = false;
  const m = $('menu'); m.style.display = 'block'; m.innerHTML = '';
  const h = document.createElement('h3'); h.textContent = n.name + ' — ' + n.cast.role; m.appendChild(h);
  const opts = n.cast.topics.map(t => ({ label: topicLabel(t), run: () => playTopic(n, t) }));
  if (n.duty !== 'idle') opts.push({ label: '⚔ I challenge you to a fight!', run: () => { closeConvo(); n.hostile = player; n.state = 'fight'; n.setDrawn(true); bark(n, 'WATCHYOURAIM'); } });
  opts.push({ label: 'Goodbye', run: closeConvo });
  n.cast.topics.forEach(t => t.lines.forEach(l => loadSound(l.wav)));
  opts.forEach((o, i) => { const d = document.createElement('div'); d.textContent = (i + 1) + '. ' + o.label; d.onclick = o.run; m.appendChild(d); });
  convo.opts = opts;
}
function playTopic(n, t) {
  $('menu').style.display = 'none'; convo.state = 'talk'; let i = 0; n.talking = true;
  const next = () => {
    if (!convo || convo.npc !== n) return;
    if (i >= t.lines.length) { $('sub').innerHTML = ''; n.talking = false; return openMenu(n); }
    const l = t.lines[i++]; $('sub').innerHTML = '<b>' + (l.who === 'npc' ? n.name : 'You') + ':</b> ' + l.text;
    playVoice(l.wav, () => setTimeout(next, 350));
  };
  next();
}
function closeConvo() { if (convo) convo.npc.talking = false; convo = null; lockedUI = false; $('menu').style.display = 'none'; $('sub').innerHTML = ''; if (voiceAudio && voiceAudio.isPlaying) { voiceAudio.onEnded = () => {}; voiceAudio.stop(); } renderer.domElement.requestPointerLock(); }
function onKey(e) {
  if (convo && convo.state === 'menu') { const i = parseInt(e.key) - 1; if (convo.opts[i]) convo.opts[i].run(); if (e.code === 'Escape') closeConvo(); return; }
  if (convo && e.code === 'Escape') return closeConvo();
  if (e.code === 'KeyE' && !convo && !player.dead) { const n = nearestTalker(); if (n) openMenu(n); }
  if (e.code === 'KeyF' && !player.dead) { player.setDrawn(!player.drawn); playAt(player.drawn ? 'SWORD_DRAW_01' : 'SWORD_UNDRAW_01', player.pos, 1); }
  if (e.code === 'KeyM') toggleMusic();
  if (e.code === 'KeyR' && player.dead) { player.dead = false; player.deadT = 0; player.root.rotation.x = 0; player.hp = 100; player.pos.copy(WP.OCR_OUTSIDE_ARENA).y += 0.5; $('msg').textContent = ''; }
  if (e.code === 'Space') playerAttack();
}

// ---------------------------------------------------------------- AI
function aiStep(n, dt) {
  n.atkCd -= dt; n.cheerT = (n.cheerT || 0) - dt; n.cheer = n.cheerT > 0;
  if (n.dead) { n.speed = 0; return; }
  if (convo && convo.npc === n) { faceTo(n, player.pos, dt * 6); n.speed = 0; return; }
  const tgt = n.hostile && !n.hostile.dead ? n.hostile : null;
  if (!tgt && n.hostile) { n.hostile = null; if (n.duty !== 'duel') { n.state = 'idle'; n.setDrawn(false); } }
  let move = 0;
  if (tgt) {
    const d = dist2(n, tgt); faceTo(n, tgt.pos, dt * 8);
    n.blocking = false;
    if (n.atkT >= 0) { n.atkT += dt; if (!n.hitDone && n.atkT > 0.34) { n.hitDone = true; strike(n, entities, 6, 13); } if (n.atkT > 0.7) n.atkT = -1; }
    else if (d > 1.7) move = d > 5 ? 3.4 : 2.2;
    else if (n.atkCd <= 0 && Math.random() < dt * 2.5) { n.atkT = 0; n.atkCd = rand(1.1, 1.8); n.hitDone = false; }
    else if (Math.random() < dt * 0.4) n.blocking = true;
    if (d < 1.2) move = -1.0;
  } else {
    // idle: duty
    if (n.duty === 'watch') { faceTo(n, PIT, dt * 3); if (Math.random() < dt * 0.05) { n.cheerT = 1.0; } }
    else if (n.duty === 'idle') { n.wt = (n.wt || 0) - dt; if (n.wt < 0) { n.wt = rand(4, 9); n.wander = n.home.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3))); } if (n.wander && dist2({ pos: n.wander }, n) > 0.4) { faceTo(n, n.wander, dt * 4); move = 1.2; } }
  }
  n.speed = Math.abs(move);
  if (move) { const f = n.fwd; const m = move * dt; const old = n.pos.clone(); n.pos.x += f.x * m; n.pos.z += f.z * m; pushOut(n.pos); const g = groundAt(n.pos.x, n.pos.z, n.pos.y + 0.5); if (g === null || g < old.y - 1.2) { n.pos.copy(old); } }
  // entity separation
  for (const o of entities) if (o !== n && !o.dead) { const dx = n.pos.x - o.pos.x, dz = n.pos.z - o.pos.z, d = Math.hypot(dx, dz); if (d < 0.8 && d > 1e-4) { n.pos.x += dx / d * (0.8 - d) * 0.5; n.pos.z += dz / d * (0.8 - d) * 0.5; } }
}
function faceTo(n, p, k) {
  const target = Math.atan2(-(p.x - n.pos.x), -(p.z - n.pos.z));
  let d = target - n.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; n.heading += d * Math.min(1, k);
}

// ---------------------------------------------------------------- music (procedural)
let musicOn = true, mgain = null, nextNote = 0, step = 0, intensity = 0;
function startMusic() {
  if (mgain) return; mgain = actx.createGain(); mgain.gain.value = 0.22; mgain.connect(actx.destination);
  // drone
  [73.42, 110, 146.83].forEach((f, i) => { const o = actx.createOscillator(); o.type = i ? 'triangle' : 'sawtooth'; o.frequency.value = f; const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; const g = actx.createGain(); g.gain.value = i ? 0.05 : 0.07; o.connect(lp).connect(g).connect(mgain); o.start(); });
  nextNote = actx.currentTime + 0.2; setInterval(schedule, 100);
}
function toggleMusic() { musicOn = !musicOn; if (mgain) mgain.gain.value = musicOn ? 0.22 : 0; }
const DORIAN = [0, 2, 3, 5, 7, 9, 10], ROOT = 146.83;
const CHORDS = [[0, 2, 4], [6, 1, 3], [3, 5, 0], [0, 2, 4]];
const noteF = d => ROOT * Math.pow(2, (DORIAN[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7)) / 12);
function pluck(t, f, v = 0.35, len = 1.2) {
  const o = actx.createOscillator(), o2 = actx.createOscillator(), g = actx.createGain(), lp = actx.createBiquadFilter();
  o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2; lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(500, t + len);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(lp); o2.connect(lp); lp.connect(g).connect(mgain); o.start(t); o2.start(t); o.stop(t + len + .1); o2.stop(t + len + .1);
}
function thump(t, f = 70, v = 0.8) { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.setValueAtTime(f * 1.8, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.12); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); o.connect(g).connect(mgain); o.start(t); o.stop(t + .4); }
function schedule() {
  const spb = 60 / (92 + intensity * 28) / 2;
  while (nextNote < actx.currentTime + 0.4) {
    const bar = Math.floor(step / 8) % CHORDS.length, ch = CHORDS[bar], s8 = step % 8;
    const arp = [0, 1, 2, 1, 0, 2, 1, 2][s8];
    pluck(nextNote, noteF(ch[arp] + 7), 0.28 + (s8 % 4 == 0 ? 0.1 : 0), 1.1);
    if (s8 === 0) pluck(nextNote, noteF(ch[0] - 7), 0.35, 2.4);
    if (s8 === 4 && Math.random() < 0.7) pluck(nextNote, noteF(ch[2] + 14 + (Math.random() < .5 ? 0 : -1)), 0.2, 1.5);
    if (intensity > 0.2 && s8 % 2 === 0) thump(nextNote, s8 % 4 === 0 ? 62 : 85, 0.5 + intensity * 0.4);
    nextNote += spb; step++;
  }
}

// ---------------------------------------------------------------- lights
const flames = [];
for (let i = 1; i <= 9; i += 2) { const p = WP['OCR_ARENA_0' + i]; if (!p) continue; const l = new THREE.PointLight(0xff9040, 14, 16, 1.6); l.position.copy(p).add(new THREE.Vector3(0, 2.2, 0)); scene.add(l); flames.push(l);
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 })); s.position.copy(l.position); scene.add(s); }

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock(); const camPos = new THREE.Vector3(); let camInit = false;
const bars = {};
function updateBars() {
  for (const n of npcs) {
    let b = bars[n.name]; if (!b) { b = bars[n.name] = document.createElement('div'); b.className = 'nb'; b.innerHTML = '<span>' + n.name + '</span><i></i>'; $('bars').appendChild(b); }
    const v = n.pos.clone().setY(n.pos.y + 2.2).project(camera); const d = dist2(n, player);
    if (v.z > 1 || v.z < 0 || n.dead || d > 25) { b.style.display = 'none'; continue; }
    b.style.display = 'block'; b.style.left = (v.x * 0.5 + 0.5) * innerWidth + 'px'; b.style.top = (-v.y * 0.5 + 0.5) * innerHeight + 'px'; b.lastChild.style.width = Math.max(0, n.hp) + '%';
  }
  $('hpf').style.width = Math.max(0, player.hp) + '%';
  const t = nearestTalker(); $('prompt').textContent = (!convo && t && !player.dead) ? 'E — talk to ' + t.name : '';
}
let hudT = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const p = player;
  if (!p.dead && !lockedUI) {
    let f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const spd = (keys.ShiftLeft || keys.ShiftRight) ? 4.2 : 2.3;
    if (f || s) {
      const dir = new THREE.Vector3(s, 0, -f).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const target = Math.atan2(-dir.x, -dir.z); let d = target - p.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p.heading += d * Math.min(1, dt * 12);
      const old = p.pos.clone(); const sp = p.atkT >= 0 ? spd * 0.3 : p.blocking ? spd * 0.5 : spd;
      p.pos.addScaledVector(dir, sp * dt); pushOut(p.pos);
      const g = groundAt(p.pos.x, p.pos.z, p.pos.y + 0.2, 0.75); if (g === null && p.vy === 0) p.pos.copy(old);
      p.speed = sp;
    } else p.speed = 0;
    if (p.atkT >= 0) { p.atkT += dt; if (!p.hitDone && p.atkT > 0.34) { p.hitDone = true; p.heading = p.heading; strike(p, npcs, 16, 26); } if (p.atkT > 0.7) p.atkT = -1; }
    p.atkCd -= dt;
  } else if (!p.dead && convo) { p.speed = 0; faceTo(p, convo.npc.pos, dt * 6); }
  settle(p, dt);
  for (const n of npcs) { aiStep(n, dt); settle(n, dt); }
  entities.forEach(e => e.update(dt));
  // music intensity
  const fighting = npcs.some(n => n.hostile && !n.dead);
  intensity += ((fighting ? 1 : 0) - intensity) * Math.min(1, dt * 0.8);
  // camera
  const tgt = p.pos.clone().setY(p.pos.y + 1.55); const dist = 4.2;
  const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
  const wantPos = tgt.clone().add(off);
  if (!camInit) { camPos.copy(wantPos); camInit = true; } else camPos.lerp(wantPos, Math.min(1, dt * 12));
  camera.position.copy(camPos); camera.lookAt(tgt);
  const gc = groundAt(camera.position.x, camera.position.z, camera.position.y + 5, 10); if (gc !== null && camera.position.y < gc + 0.4) camera.position.y = gc + 0.4;
  flames.forEach(l => l.intensity = 12 + Math.sin(performance.now() * 0.02 + l.position.x) * 2.5 + Math.random());
  if ((hudT += dt) > 0.05) { hudT = 0; updateBars(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
window.__game = { player, npcs, camera, scene, THREE, get yaw() { return yaw; }, set yaw(v) { yaw = v; }, set pitch(v) { pitch = v; }, CAL, startDuel, tris: tris.length };
if (params.has('auto')) { $('start').style.display = 'none'; startMusic(); }
frame();
