import * as THREE from 'three';

// Assets: export/ when it exists (extracted from your own Gothic install, see the README), otherwise the committed
// stand-ins in standin/ (original placeholders, tools/standin/make_standin.py) so a plain clone runs for development
// and tests. ?assets=standin or ?assets=export picks one explicitly.
const ASSETS = new URLSearchParams(location.search).get('assets');
const E = ASSETS === 'standin' ? '../standin/' : ASSETS === 'export' ? '../export/'
  : await fetch('../export/world.json', { method: 'HEAD' }).then(r => (r.ok ? '../export/' : '../standin/')).catch(() => '../standin/');
const STANDIN = E === '../standin/';
// the HUD's CSS images come from the same asset folder
for (const [v, f] of [['--bar-back', 'BAR_BACK'], ['--bar-health', 'BAR_HEALTH'], ['--dlg-choice', 'DLG_CHOICE']])
  document.documentElement.style.setProperty(v, `url(${E}ui/${f}.png)`);
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// volume sliders (0-100) to gain: loudness is roughly logarithmic, so a linear gain sounds nearly full until the very
// bottom of the slider; squaring it spreads the range evenly (50 -> -12 dB, 10 -> -40 dB, 0 -> silent)
const volCurve = v => (clamp(+v, 0, 100) / 100) ** 2;
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
const hemi = new THREE.HemisphereLight(0xe4ecf4, 0x6a5a40, 1.5); scene.add(hemi);
let SKY_DIM = 1; // < 1 under rain clouds: scales the world's baked light and the characters' light (weather section)
const sun = new THREE.DirectionalLight(0xfff0d8, 1.4); sun.position.set(-50, 45, 20); scene.add(sun);
// Gothic's day sky: two scrolling cloud layers on a flat sky plane (SKYDAY_LAYER0 = opaque base tinted sky blue,
// SKYDAY_LAYER1 = alpha clouds over it), fading into the fog colour at the horizon. Math is done in sRGB, like Gothic.
const skyTex = n => { const t = new THREE.TextureLoader().load(E + 'ui/' + n + '.png'); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
const fogSRGB = new THREE.Vector3(((FOG >> 16) & 255) / 255, ((FOG >> 8) & 255) / 255, (FOG & 255) / 255);
const SUN_DIR = sun.position.clone().normalize();
const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { l0: { value: skyTex('SKYDAY_LAYER0_A0') }, l1: { value: skyTex('SKYDAY_LAYER1_A0') }, l2: { value: skyTex('SKYRAINCLOUDS') },
    fogc: { value: fogSRGB.clone() }, time: { value: 0 }, cloud: { value: 0 } },
  vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D l0, l1, l2; uniform vec3 fogc; uniform float time, cloud; varying vec3 vp;
    void main(){
      vec3 d = normalize(vp);
      vec2 uv = d.xz / (max(d.y, 0.0) + 0.12);              // flat sky plane seen from below
      vec3 base = texture2D(l0, uv * 0.55 + vec2(time * 0.004, time * 0.0015)).rgb * vec3(0.72, 0.95, 1.42);
      vec4 cl = texture2D(l1, uv * 0.8 + vec2(time * 0.009, time * 0.003));
      vec3 c = mix(base, cl.rgb * vec3(0.96, 0.97, 1.0), cl.a * 0.85);
      // weather: Gothic's rain cloud layer (SKYRAINCLOUDS) rolls in over the day sky
      vec3 rc = texture2D(l2, uv * 0.6 + vec2(time * 0.012, time * 0.004)).rgb * 0.85;
      c = mix(c, rc, cloud * 0.92);
      gl_FragColor = vec4(mix(fogc, c, smoothstep(0.0, 0.28, d.y)), 1.0);
    }`,
}));
sky.renderOrder = -1; scene.add(sky);
// the sun (UNSUN5: additive, black background) in the direction of the sun light
// drawn with the sky (opaque pass, before the world), so roofs and walls hide it instead of it shining through them
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: skyTex('UNSUN5'), color: 0xffdca0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, transparent: false }));
sunSprite.position.copy(SUN_DIR).multiplyScalar(380); sunSprite.scale.set(70, 70, 1); sunSprite.renderOrder = -0.95; sky.add(sunSprite);

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
  $('loadmsg').innerHTML = 'Game assets not found or out of date (' + E + err.message + ').<br><small>Gothic assets are extracted locally from your own install and are not hosted here:<br>run <code>./export_all.sh</code> (see the README). Without them the game uses the committed stand-ins in <code>standin/</code>;<br>regenerate those with <code>python tools/standin/make_standin.py</code>. Serve the repo root and open /web/.</small>';
  throw err;
}
if (STANDIN) { $('help').insertAdjacentHTML('afterbegin', '<span style="color:#e0b860">stand-in assets</span> · '); console.info('Using stand-in assets (standin/): export/ not found'); }
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
// A small floor keeps pitch-black corners from going to pure black; hut interiors stay as dark as Gothic bakes them.
// `brightness` (pause menu, like Gothic's own brightness option) lowers the gamma of the light: shadows and hut
// interiors brighten a lot, fully lit ground hardly changes. 1.0 = Gothic's own look.
const MIN_LIGHT = 24;
let brightness = store.get('light', 1.0); // ('light' replaces the old 'bright' key, whose default over-lit interiors)
const S2L = new Float32Array(256);
const buildS2L = () => { for (let i = 0; i < 256; i++) S2L[i] = Math.pow(Math.max(i, MIN_LIGHT) / 255, 2.2 / brightness); };
buildS2L();
const PORTAL_FADE = [8, 20]; // metres: invisible nearer than 8 m, solid beyond 20 m
const litMeshes = [];
const worldMats = []; // world materials tinted by the baked light: dimmed under rain clouds // [raw light bytes, colour attribute] per world mesh, re-lit when the brightness changes
const tris = []; // {a,b,c,n,tri,c8 (light bytes),col,kind}
const CELL = 3, grid = new Map();
const key = (cx, cz) => cx * 8192 + cz;
const kindOf = t => /WOOD|HOLZ|BRETT|PLANK|BOARD|BEAM|BALK|PALISAD/.test(t) ? 'WOOD' : /STONE|STEIN|ROCK|FELS|MAUER|WALL|CASTLE|BURG|PFLASTER/.test(t) ? 'STONE' : /SAND/.test(t) ? 'SAND' : 'EARTH';
function addTri(a, b, c, c8, kind, door = null) {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const l = n.length(); if (l < 1e-6) return; n.divideScalar(l);
  const idx = tris.push({ a, b, c, n, tri: new THREE.Triangle(a, b, c), c8, col: new THREE.Color(S2L[c8[0]], S2L[c8[1]], S2L[c8[2]]), kind, door }) - 1;
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
  g.setAttribute('color', new THREE.BufferAttribute(C, 3)); litMeshes.push([C8, g.attributes.color]);
  const water = m.flag === 'water', decal = m.flag.startsWith('decal'), cut = m.alpha || m.flag === 'decal', portal = m.flag === 'portal';
  const blended = water || portal || (decal && m.flag !== 'decal'), mul = m.flag === 'decal_mul' || m.flag === 'decal_mul2';
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
  // Gothic's doorway portals (OC_W_FARDOOR, OC_W_HUETTENTOR...) are a stand-in seen from afar: they fade out as the
  // camera comes near, so up close you look and walk straight into the hut
  if (portal) mat.onBeforeCompile = sh => {
    sh.vertexShader = 'varying float vCamDist;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vCamDist = -mvPosition.z;');
    sh.fragmentShader = 'varying float vCamDist;\n' + sh.fragmentShader.replace('#include <alphatest_fragment>',
      '#include <alphatest_fragment>\n  diffuseColor.a *= smoothstep(' + PORTAL_FADE[0].toFixed(1) + ', ' + PORTAL_FADE[1].toFixed(1) + ', vCamDist);');
  };
  scene.add(new THREE.Mesh(g, mat)); if (!mul) worldMats.push(mat);
  // collide only with solid, opaque geometry: not foliage/fences (alpha), door curtains, open doors, decals, water
  if (m.alpha || m.flag) continue;
  const kind = kindOf(m.tex);
  for (let i = 0; i < m.n * 3; i += 9) {
    const c8 = [0, 1, 2].map(k => Math.round((C8[i + k] + C8[i + 3 + k] + C8[i + 6 + k]) / 3));
    addTri(new THREE.Vector3(P[i], P[i + 1], P[i + 2]), new THREE.Vector3(P[i + 3], P[i + 4], P[i + 5]), new THREE.Vector3(P[i + 6], P[i + 7], P[i + 8]), c8, kind);
  }
}
// ---------------------------------------------------------------- doors
// Gothic's wooden doors (DOOR_WOODEN.MDS): the leaf swings on its hinge with the model's own open/close clips,
// exported as one hinge matrix per frame (export_world.py). Used with the action key / E when in focus; locked
// ones only rattle. A shut door blocks characters and the camera.
const DOOR_SND = { open: ['DOOR_OPEN01', 'DOOR_OPEN02'], close: ['DOOR_CLOSE01B', 'DOOR_CLOSE02B'], try: ['DOOR_TRY'] };
const doors = [];
if (world.doors) {
  const parts = world.doorMesh.map(m => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(m.u, 2));
    return { tex: m.tex, g, p: m.p };
  });
  const M = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const d of world.doors) {
    const grp = new THREE.Group(); grp.matrixAutoUpdate = false; grp.matrix.fromArray(d.open[0]); scene.add(grp);
    const door = { name: 'Door', locked: d.locked, open: d.open, close: d.close, grp, mats: [], c8: d.light, state: 'shut', t: 0, hl: false };
    M.fromArray(d.open[0]); const box = new THREE.Box3();
    for (const pt of parts) {
      const mat = new THREE.MeshBasicMaterial({ map: getTex(pt.tex), side: THREE.DoubleSide }); door.mats.push(mat);
      grp.add(new THREE.Mesh(pt.g, mat));
      for (let i = 0; i < pt.p.length; i += 9) { // the shut leaf as collision triangles
        const q = [0, 3, 6].map(k => v.set(pt.p[i + k], pt.p[i + k + 1], pt.p[i + k + 2]).applyMatrix4(M).clone());
        q.forEach(x => box.expandByPoint(x)); addTri(q[0], q[1], q[2], d.light, 'WOOD', door);
      }
    }
    door.pos = box.getCenter(new THREE.Vector3()).setY(box.min.y); // the name floats above the leaf, like an NPC's
    doors.push(door);
  }
}
function doorLight(d) { // baked light where the door stands, dimmed by the weather, brighter while in focus
  const h = d.hl ? 0.25 : 0, k = LIGHT_GAIN * SKY_DIM * (1 + h);
  for (const m of d.mats) m.color.setRGB(S2L[d.c8[0]] * k + h, S2L[d.c8[1]] * k + h, S2L[d.c8[2]] * k + h);
}
function useDoor(d) {
  if (d.state === 'opening' || d.state === 'closing') return;
  if (d.locked) { loadSound(pick(DOOR_SND.try)).then(b => playBuf(b, d.pos.clone().setY(d.pos.y + 1), 0.9, 6)); showMsg('Locked', 1500); return; }
  d.state = d.state === 'shut' ? 'opening' : 'closing'; d.t = 0; d.snd = false;
}
function updateDoors(dt) {
  const fps = world.doorFps || 25, sfx = world.doorSfx || { open: 4, close: 0 };
  for (const d of doors) {
    doorLight(d);
    if (d.state !== 'opening' && d.state !== 'closing') continue;
    const clip = d.state === 'opening' ? d.open : d.close, f = (d.t += dt) * fps;
    if (!d.snd && f >= (d.state === 'opening' ? sfx.open : sfx.close)) {
      d.snd = true; loadSound(pick(DOOR_SND[d.state === 'opening' ? 'open' : 'close'])).then(b => playBuf(b, d.pos.clone().setY(d.pos.y + 1), 0.9, 6));
    }
    if (f >= clip.length - 1) { d.grp.matrix.fromArray(clip[clip.length - 1]); d.state = d.state === 'opening' ? 'open' : 'shut'; continue; }
    d.grp.matrix.fromArray(clip[Math.floor(f)]); // (frames are 1/25 s apart: no need to blend)
  }
}
function setBrightness(b) {
  brightness = b; store.set('light', b); buildS2L();
  for (const [c8, attr] of litMeshes) { const a = attr.array; for (let i = 0; i < a.length; i++) a[i] = S2L[c8[i]]; attr.needsUpdate = true; }
  for (const t of tris) t.col.setRGB(S2L[t.c8[0]], S2L[t.c8[1]], S2L[t.c8[2]]);
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
    const t = tris[i]; if (t.n.y < 0.45 || t.door) continue;
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
      if (t.door && t.door.state !== 'shut') continue; // an open (or moving) door doesn't block
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
    if (tris[k].door && tris[k].door.state !== 'shut') continue;
    const { a: p0, b: p1, c: p2 } = tris[k];
    _e1.subVectors(p1, p0); _e2.subVectors(p2, p0); _h.crossVectors(dir, _e2); const det = _e1.dot(_h);
    if (Math.abs(det) < 1e-8) continue; const inv = 1 / det;
    _s.subVectors(a, p0); const u = _s.dot(_h) * inv; if (u < 0 || u > 1) continue;
    _q2.crossVectors(_s, _e1); const v = dir.dot(_q2) * inv; if (v < 0 || u + v > 1) continue;
    const t = _e2.dot(_q2) * inv; if (t > 0.05 && t < len && (best === null || t < best)) best = t;
  }
  return best;
}
const GRAVITY = 20, JUMP_GRAVITY = 14;
function settle(e, dt) {
  if (e.act && e.act.type === 'climb') return;
  const g = groundAt(e.pos.x, e.pos.z, e.pos.y + 0.2), gi = gTri;
  if (g !== null) { e.groundY = g; if (gi >= 0) { e.groundN.copy(tris[gi].n); e.lightTarget.copy(tris[gi].col); } }
  else e.groundY = e.pos.y - 9;
  if (e.air) { // jumping: ballistic until the feet are back on a floor
    e.vy -= JUMP_GRAVITY * dt; e.pos.y += e.vy * dt;
    if (g !== null && e.vy <= 0 && e.pos.y <= g) { e.pos.y = g; e.vy = 0; e.air = false; landed(e); }
    else if (e.pos.y < e.lastGood - 30) { e.pos.y = e.lastGood; e.vy = 0; e.air = false; landed(e); }
    gTri = gi; return;
  }
  if (g === null) { e.vy -= GRAVITY * dt; e.pos.y += e.vy * dt; fallTick(e, dt); if (e.pos.y < e.lastGood - 30) { e.pos.y = e.lastGood; e.vy = 0; } return; }
  // stick to the ground when walking down slopes/steps instead of bouncing in free fall
  if (e.pos.y > g + 0.05 && (e.vy < -0.5 || e.pos.y > g + 0.45)) { e.vy -= GRAVITY * dt; e.pos.y = Math.max(g, e.pos.y + e.vy * dt); if (e.pos.y === g) { e.vy = 0; landed(e); } else fallTick(e, dt); }
  else { if (e.fallT) landed(e); e.pos.y = g; e.vy = 0; }
  e.lastGood = e.pos.y; gTri = gi;
}
// walked off a ledge: after a moment in the air Gothic switches to its falling pose
function fallTick(e, dt) {
  e.fallT = (e.fallT || 0) + dt;
  if (e.fallT > 0.3 && !e.act && !e.downed) { e.act = { type: 'fall', id: ++actId, t: 0 }; e.play('S_FALLDN', { blend: 0.25, fixY: true }); }
}
function landed(e) {
  const a = e.act, fell = e.fallT || 0; e.fallT = 0;
  if (!a || (a.type !== 'jump' && a.type !== 'fall')) return;
  sfx.step(e, 0.6);
  // landing from a running jump while still running: straight back into the run, otherwise Gothic's landing clip
  if (a.type === 'jump' && a.fwd && e.mv.f > 0) { e.act = null; return; }
  e.act = { type: 'land', id: ++actId, t: 0 };
  e.play(a.type === 'jump' && a.fwd ? 'T_JUMP_2_STAND' : 'T_FALLDN_2_STAND', { loop: false, blend: 0.08, rate: fell > 0.8 || a.type === 'jump' ? 1 : 1.6 });
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
// Gothic draws a soft dark blob under each character; it lies on the floor triangle below and fades with height
const blobTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.9)'); gr.addColorStop(0.5, 'rgba(0,0,0,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const blobGeo = new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2);
const _up = new THREE.Vector3(0, 1, 0);
function skinGeo(p) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(p.u, 2));
  if (p.si) { g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(p.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(p.sw, 4)); }
  g.computeVertexNormals(); return g;
}
// Mdl_SetModelFatness: each vertex moves along its (smooth) normal by fatness * 0.5 cm, as in Gothic's engine.
// Applied to the bind-pose geometry; normals are averaged over vertices that share a position so seams stay closed.
function fattenGeo(p, fat) {
  const g = skinGeo(p); if (!fat) return g;
  const pos = g.attributes.position, n = pos.count, acc = new Map(), keys = new Array(n);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let i = 0; i < n; i++) keys[i] = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    fn.subVectors(c, b).cross(b.clone().sub(a)); // area-weighted face normal
    for (let k = 0; k < 3; k++) { const v = acc.get(keys[i + k]) || acc.set(keys[i + k], new THREE.Vector3()).get(keys[i + k]); v.add(fn); }
  }
  const d = fat * 0.005; // 0.5 cm per unit of fatness, in metres
  for (let i = 0; i < n; i++) {
    const v = acc.get(keys[i]).clone(); if (v.lengthSq() < 1e-12) continue; v.normalize();
    pos.setXYZ(i, pos.getX(i) + v.x * d, pos.getY(i) + v.y * d, pos.getZ(i) + v.z * d);
  }
  g.computeVertexNormals(); return g;
}
const geoCache = new Map();
const gGeo = p => { if (!geoCache.has(p)) geoCache.set(p, skinGeo(p)); return geoCache.get(p); };
let STAND_Y = 0.977; // root height of Gothic's standing pose (S_RUN), set below
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
    // `tex` maps a mesh's default texture to this character's variant (Gothic's body/head/teeth _V and skin _C numbers)
    const swap = o.tex || {};
    if (o.scale) this.body.scale.fromArray(o.scale);
    const geo = p => (o.fat ? fattenGeo(p, o.fat) : gGeo(p));
    for (const p of [...chars.outfits[o.outfit], ...(chars.heads[o.head] || [])]) {
      const mat = new THREE.MeshLambertMaterial({ map: getTex(swap[p.tex] || p.tex), alphaTest: 0.4 }); this.mats.push(mat);
      const m = new THREE.SkinnedMesh(geo(p), mat); m.frustumCulled = false; this.body.add(m);
      // the mesh's world matrix must be current *before* binding, or every bone pivots ~1 m away from its joint
      this.root.updateMatrixWorld(true); m.bind(this.skel, m.matrixWorld);
    }
    // the weapon is a plain mesh hung on a slot bone: ZS_SWORD (hip) when sheathed, ZS_RIGHTHAND when drawn
    this.weapon = new THREE.Group();
    for (const p of (chars.weaponsLocal && chars.weaponsLocal[o.weapon]) || []) {
      const mat = new THREE.MeshLambertMaterial({ map: getTex(p.tex), alphaTest: 0.4, side: THREE.DoubleSide }); this.mats.push(mat);
      this.weapon.add(new THREE.Mesh(geo(p), mat));
    }
    this.slot(false);
    // a bow or crossbow: on the back (ZS_BOW / ZS_CROSSBOW); drawn, a bow sits in the left hand and a crossbow in the
    // right, as Gothic binds them. A drawn bow shows its nocked arrow in the right hand.
    this.mode = 'melee'; // what is drawn when drawn: 'melee' or 'ranged'
    if (o.ranged) {
      this.rweapon = new THREE.Group(); this.nock = new THREE.Group(); this.nock.visible = false;
      for (const p of (chars.weaponsLocal && chars.weaponsLocal[o.ranged.id]) || []) {
        const mat = new THREE.MeshLambertMaterial({ map: getTex(p.tex), alphaTest: 0.4, side: THREE.DoubleSide }); this.mats.push(mat);
        this.rweapon.add(new THREE.Mesh(geo(p), mat));
      }
      for (const p of (chars.weaponsLocal && chars.weaponsLocal[o.ranged.ammoId]) || []) {
        const mat = new THREE.MeshLambertMaterial({ map: getTex(p.tex), alphaTest: 0.4, side: THREE.DoubleSide }); this.mats.push(mat);
        this.nock.add(new THREE.Mesh(geo(p), mat));
      }
      if (chars.nockRot) this.nock.rotation.set(...chars.nockRot.map(THREE.MathUtils.degToRad)); // stand-ins: arrow along the arm
      this.bones[boneIdx.ZS_RIGHTHAND].add(this.nock);
      this.ammo = o.ranged.ammo || 0; this.ammo0 = this.ammo;
      this.rslot(false);
    }
    this.cur = new Float32Array(NB * 4); this.snap = new Float32Array(NB * 4);
    rest.forEach((r, i) => r.q.toArray(this.cur, i * 4));
    this.rootY = 1; this.snapY = 1; this.blendT = 0; this.blendDur = 0; this.base = null; this.over = null;
    scene.add(this.root);
    this.shadow = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.shadow.renderOrder = 1; this.groundY = 0; this.groundN = new THREE.Vector3(0, 1, 0); scene.add(this.shadow);
  }
  // a two-hander is sheathed on the back (ZS_LONGSWORD) like in Gothic, a one-hander at the hip
  // Gothic's clip for this character: a two-hander plays the 2H version of a 1H clip; the talent's style overlay
  // (1HST1/2, 2HST1/2) and the NPC's walk overlay (Humans_Militia / Humans_Relaxed) replace base clips where they have one
  clip(name) {
    const look = n => (this.style && CLIPS[this.style + ':' + n]) || (this.ovl && CLIPS[this.ovl + ':' + n]) || CLIPS[n];
    return (this.twoHanded && look(name.replace(/1H/g, '2H'))) || look(name);
  }
  rslot(inHand) {
    if (!this.rweapon) return;
    const r = this.ranged, hand = r.kind === 'bow' ? 'ZS_LEFTHAND' : 'ZS_RIGHTHAND';
    this.bones[boneIdx[inHand ? hand : r.slot]].add(this.rweapon);
  }
  slot(inHand) { this.bones[boneIdx[inHand ? 'ZS_RIGHTHAND' : this.twoHanded ? 'ZS_LONGSWORD' : 'ZS_SWORD']].add(this.weapon); }
  get fwd() { return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)); }
  // base layer: one full-body clip, cross-faded from the previous pose
  play(name, { loop = true, rate = 1, rev = false, blend = 0.15, rm = false, restart = false, fixY = false } = {}) {
    const clip = this.clip(name); if (!clip) { console.warn('missing clip', name); return false; }
    const b = this.base;
    if (!restart && b && b.clip === clip && b.rev === rev && b.loop === loop) { b.rate = rate; return true; }
    this.snap.set(this.cur); this.snapY = this.rootY; this.blendT = 0; this.blendDur = blend;
    this.base = { clip, name, t: 0, rate, loop, rev, rm, fixY, prevF: rev ? clip.n - 1 : 0 };
    return true;
  }
  // overlay layer: a partial clip (upper body etc.) mixed on top, faded in and out
  overlay(name, { rate = 1, rev = false } = {}) { const clip = this.clip(name); if (clip) this.over = { clip, t: 0, rate, rev, loop: false }; }
  frame() { return this.base ? frameAt(this.base) : 0; }
  done() { return !this.base || ended(this.base); }
  update(dt) {
    const b = this.base;
    if (b) { b.prevF = frameAt(b); b.t += dt * b.rate; }
    rest.forEach((r, i) => r.q.toArray(this.cur, i * 4));
    let y = this.rootY;
    if (b) { const ry = sample(b.clip, frameAt(b), b.loop, this.cur); if (ry !== null) y = b.fixY ? STAND_Y : b.k ? STAND_Y + (ry - STAND_Y) * b.k : ry; }
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
    // climbing: the body visibly travels up and over the edge while pos stays at the foot of the wall until the end
    if (b && b.kz) { const [rx, rz] = rootXZ(b.clip, frameAt(b)); this.bones[0].position.set(rx, y, rz * b.kz); }
    else this.bones[0].position.set(0, y, 0);
    this.light.lerp(this.lightTarget, Math.min(1, dt * 4));
    const hl = this.hl ? 0.22 : 0; // in the hero's focus: lifted towards white, so it shows even in the dark
    const lift = v => v * (1 + hl) + hl;
    const k = lift(clamp(this.light.r * 1.7, 0.3, 1.25) * SKY_DIM), k2 = lift(clamp(this.light.g * 1.7, 0.3, 1.25) * SKY_DIM), k3 = lift(clamp(this.light.b * 1.7, 0.3, 1.25) * SKY_DIM);
    for (const m of this.mats) m.color.setRGB(k, k2, k3);
    this.t += dt;
  }
  // horizontal root motion of the base clip since the last frame, in the character's local space
  rootMotion() {
    const b = this.base; if (!b || !b.rm) return null;
    const [x1, z1] = rootXZ(b.clip, frameAt(b)), [x0, z0] = rootXZ(b.clip, b.prevF);
    return [x1 - x0, z1 - z0];
  }
  sync() {
    this.root.position.copy(this.pos); this.root.rotation.y = this.heading;
    const h = this.pos.y - this.groundY, sh = this.shadow; sh.visible = h < 4;
    sh.position.set(this.pos.x, this.groundY + 0.02, this.pos.z); sh.quaternion.setFromUnitVectors(_up, this.groundN);
    sh.material.opacity = clamp(1 - h / 4, 0, 1); sh.scale.setScalar(this.downed ? 1.5 : 1 + h * 0.15);
  }
}

// feet: in the bind pose the soles sit `sole` below the foot bone; pose a test model and lift it accordingly
{
  let mn = 9; for (const part of chars.outfits.GRDM) for (let i = 1; i < part.p.length; i += 3) mn = Math.min(mn, part.p[i]);
  const tmp = new Char({ outfit: 'GRDM', head: 'BALD', weapon: 'sword' });
  const v = new THREE.Vector3(), feet = ['BIP01 L FOOT', 'BIP01 R FOOT'].map(n => tmp.bones[boneIdx[n]]);
  tmp.root.updateMatrixWorld(true); const sole = feet[0].getWorldPosition(v).y - mn;
  tmp.play('S_RUN', { blend: 0 }); tmp.update(0); tmp.root.updateMatrixWorld(true); STAND_Y = tmp.rootY;
  FOOT_ADJ = -Math.min(...feet.map(f => f.getWorldPosition(v).y - sole));
  scene.remove(tmp.root); scene.remove(tmp.shadow);
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
for (const [k, K] of [['bow', 'BOW'], ['cbow', 'CBOW']]) LOCO[k] = {
  idle: { run: `S_${K}RUN`, walk: `S_${K}RUN`, sneak: `S_${K}SNEAK` }, fwd: { run: `S_${K}RUNL`, walk: `S_${K}WALKL`, sneak: `S_${K}SNEAKL` },
  back: { run: `S_${K}WALKL`, walk: `S_${K}WALKL`, sneak: `S_${K}SNEAKL` },
  left: { run: `T_${K}RUNSTRAFEL`, walk: `T_${K}RUNSTRAFEL`, sneak: `T_${K}SNEAKSTRAFEL` }, right: { run: `T_${K}RUNSTRAFER`, walk: `T_${K}RUNSTRAFER`, sneak: `-T_${K}SNEAKSTRAFEL` },
};
const STEP_VOL = { run: 0.45, walk: 0.22, sneak: 0.04 };
const weaponSet = c => (!c.drawn ? 'free' : c.mode === 'ranged' ? c.ranged.kind : '1h');
// picks the locomotion clip; returns this frame's world-space displacement (speed comes from the clip's root motion)
function locomote(c, dt) {
  const { f, s } = c.mv, set = LOCO[weaponSet(c)];
  const k = f > 0 ? 'fwd' : f < 0 ? 'back' : s < 0 ? 'left' : s > 0 ? 'right' : 'idle';
  let name = set[k][c.gait], rev = k === 'back';
  if (k === 'idle' && c.mv.turn && c.gait !== 'sneak') name = ({ free: 'T_RUNTURN', '1h': 'T_1HRUNTURN', bow: 'T_BOWRUNTURN', cbow: 'T_CBOWRUNTURN' })[weaponSet(c)] + (c.mv.turn < 0 ? 'L' : 'R');
  if (name[0] === '-') { name = name.slice(1); rev = !rev; }
  const rate = (k === 'left' || k === 'right') && c.gait === 'walk' ? 0.6 : 1;
  c.play(name, { loop: true, rev, rate, blend: 0.2 });
  if (k === 'idle') return null; // (turning on the spot moves nothing either)
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
// Gothic 1 melee damage: max(strength + weapon damage - target's armour protection against that damage type, 0).
// The player is a custom guard: Gothic's guard armour and crude sword, with a seasoned guard's strength and health.
const ITEMS = chars.items || {};
const PLAYER_ARMOR = (ITEMS.GRD_ARMOR_M || {}).prot || { edge: 55, blunt: 55 };
const PLAYER_SWORD = ITEMS.ITMW_1H_SWORD_01 || { dmg: 20, dtype: 'edge', range: 100 };
const reachOf = range => 1.1 + (range || 100) / 100; // centre-to-centre: two bodies plus the weapon's range (cm)
const entities = [];
const PLAYER_START = () => (WP.OCR_OUTSIDE_ARENA || new THREE.Vector3(49.7, -9.5, -42.4)).clone().add(new THREE.Vector3(0, 0.5, 0));
// the hero: Gothic's own head, face and skin (PC_HERO: the ponytail), in guard armour with a sword
const HERO_LOOK = (chars.looks && chars.looks.HERO) || { head: 'PONY', tex: {} };
const player = new Char({ name: 'You', outfit: 'GRDM', head: chars.heads[HERO_LOOK.head] ? HERO_LOOK.head : 'FIGHTER', tex: HERO_LOOK.tex, weapon: 'sword', isPlayer: true, hp: 220, maxHp: 220, str: 70,
  wdmg: PLAYER_SWORD.dmg, dtype: PLAYER_SWORD.dtype, reach: reachOf(PLAYER_SWORD.range), prot: PLAYER_ARMOR, style: store.get('style', ''),
  ranged: ITEMS.ITRW_CROSSBOW_01 ? { ...ITEMS.ITRW_CROSSBOW_01, ammo: 30 } : null, dex: 50 }); // a guard's light crossbow, 30 bolts
player.pos.copy(PLAYER_START()); player.heading = Math.PI * 0.75; entities.push(player);
const wpFix = (name, dy = 0.6) => { const w = WP[name]; return w ? w.clone().add(new THREE.Vector3(0, dy, 0)) : new THREE.Vector3(40, -9, -34); };
// Arena floor = centre of the OCR_ARENA_01..09 ring. (OCR_ARENABATTLE is the fighters' room *under* the arena.)
const ring = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => WP['OCR_ARENA_0' + i]).filter(Boolean);
const PIT = ring.length ? ring.reduce((a, b) => a.clone().add(b)).divideScalar(ring.length).add(new THREE.Vector3(0, 0.6, 0)) : wpFix('OCR_ARENA_01');
// Looks, hit points, strength, armour, weapons, fighting talent and walk overlay come from Gothic's scripts via
// chars.looks (export_chars.py); castCfg only places the scene. `skill` is how well the AI fights.
// Fighting skill: Gothic's 1H talent picks the animation set (untrained / HUMANS_1HST1 / HUMANS_1HST2) and with it the
// combo length; `skill` is how reliably the AI parries and chains combos. Damage = strength + weapon - armour.
const castCfg = {
  KIRGO: { pos: wpFix('OCR_OUTSIDE_ARENA_BARONS_HUT'), duty: 'watch', skill: 0.5 },
  WHISTLER: { pos: wpFix('OCR_OUTSIDE_ARENA_BENCH2'), duty: 'watch', skill: 0.35 },
  // the duel in the pit: Gothic's arena fighters Kharim (New Camp) and Gor Hanis (Sect Camp), an even match
  KHARIM: { pos: PIT.clone().add(new THREE.Vector3(-1.8, 0, 0)), duty: 'duel', skill: 0.6 },
  GORHANIS: { pos: PIT.clone().add(new THREE.Vector3(1.8, 0, 0)), duty: 'duel', skill: 0.6 },
  THORUS: { pos: wpFix('OCR_ARENA_BARONS_HUT'), duty: 'guard', guard: true, skill: 0.85 },
  BLOODWYN: { pos: wpFix('OCR_OUTSIDE_ARENA_HANGAROUND'), duty: 'watch', guard: true, skill: 0.7 },
  FLETCHER: { pos: wpFix('OCR_OUTSIDE_ARENA_01'), duty: 'watch', guard: true, skill: 0.55 },
  SNAF: { pos: wpFix('OCR_OUTSIDE_ARENA_BENCH1'), duty: 'idle', skill: 0.2 },
};
const npcs = [];
if (!chars.looks) console.warn('export/chars.json has no NPC looks: re-run ./run.sh export_chars.py');
for (const c of dlg.cast) {
  const cfg = castCfg[c.id], look = chars.looks && chars.looks[c.id]; if (!cfg || !look) continue;
  const w = look.weapon || { id: 'sword', twoHanded: false, dmg: 0, dtype: 'blunt', range: 100 };
  const e = new Char({ name: c.name, outfit: look.outfit, head: look.head, tex: look.tex, scale: look.scale, fat: look.fat, ovl: look.overlay,
    weapon: w.id, twoHanded: w.twoHanded, ranged: look.ranged, dex: look.dex || 0, cast: c, duty: cfg.duty, guard: !!cfg.guard,
    hp: look.hp, maxHp: look.hp, str: look.str, wdmg: w.dmg, dtype: w.dtype, reach: reachOf(w.range), prot: look.prot || {}, style: look.style, skill: cfg.skill });
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
const DRAW_CLIP = { melee: 'T_MOVE_2_1HMOVE', bow: 'T_MOVE_2_BOWMOVE', cbow: 'T_MOVE_2_CBOWMOVE' };
// draw (`mode`: 'melee' by default, or 'ranged') or sheathe what is drawn
function toggleWeapon(c, mode = 'melee') {
  if (c.drawing || c.downed || (c.act && c.act.type !== 'parade')) return;
  const draw = !c.drawn; if (draw) { if (mode === 'ranged' && !c.ranged) return; } else mode = c.mode;
  const name = DRAW_CLIP[mode === 'ranged' ? c.ranged.kind : 'melee'], clip = c.clip(name);
  const sw = clip && clip.ev.set_fight_mode ? clip.ev.set_fight_mode[0] / clip.fps : 0.2; // when the hand reaches the weapon
  const len = clip ? (clip.n - 1) / clip.fps : 0.6;
  c.drawing = { t: 0, draw, mode, at: draw ? sw : len - sw, len };
  c.overlay(name, { rev: !draw });
  if (draw) { c.drawn = true; c.mode = mode; } else if (mode === 'melee') playAt('SWORD_UNDRAW_01', at(c), 0.8);
}
// sheathe what is drawn and draw the other weapon
function switchWeapon(c, mode) {
  if (c.drawn && c.mode === mode) return;
  if (!c.drawn) return toggleWeapon(c, mode);
  c.switchTo = mode; toggleWeapon(c);
}
function drawTick(c, dt) {
  const d = c.drawing; if (!d) return;
  d.t += dt;
  if (!d.switched && d.t >= d.at) {
    d.switched = true;
    if (d.mode === 'ranged') c.rslot(d.draw); else { c.slot(d.draw); if (d.draw) playAt(pick(['SWORD_DRAW_01', 'SWORD_DRAW_02']), at(c), 0.8); }
    if (!d.draw) c.drawn = false;
  }
  if (d.t >= d.len) { c.drawing = null; if (!d.draw && c.switchTo) { const m = c.switchTo; c.switchTo = null; toggleWeapon(c, m); } }
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
    if (f >= ws) { a.decided = true; if (Math.random() < c.skill && dist2(c, c.hostile) < (c.reach || REACH) + 0.4) a.queued = Math.random() < 0.75 ? 'F' : pick(['L', 'R']); }
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
  if (c.downed || c.drawing || (c.act && c.act.type !== 'parade') || (c.drawn && c.mode === 'ranged')) return;
  c.play('T_1HPARADE_O', { loop: false, restart: true, blend: 0.06 }); c.act = { type: 'parade', id: ++actId, t: 0 };
}
// Gothic's jump: forward from a run/walk (T_RUNL_2_JUMP, then S_JUMP while still in the air), straight up when
// standing (T_STAND_2_JUMPUP -> S_JUMPUP -> S_FALLDN). The arc is physics; the clips' own root height is ignored.
function jump(c) {
  if (c.air || c.downed || c.drawing || c.act || c.vy !== 0) return;
  const ledge = findLedge(c); if (ledge) return startClimb(c, ledge);
  const fwd = c.mv.f > 0, sp = fwd ? (c.gait === 'run' ? 5 : 3.2) : 0, h = c.heading;
  c.air = true; c.vy = fwd ? 4.6 : 5.0;
  c.act = { type: 'jump', id: ++actId, t: 0, fwd, vx: -Math.sin(h) * sp, vz: -Math.cos(h) * sp };
  c.play(fwd ? 'T_RUNL_2_JUMP' : 'T_STAND_2_JUMPUP', { loop: false, blend: 0.08, fixY: true });
}
// Climbing (Gothic: the jump key in front of a ledge). The ledge height picks Gothic's own sequence: low (waist),
// mid (chest) or high (jump up, hang on the edge, pull up). Each sequence's root rises by a fixed amount, so its clips
// are scaled to the real height; at the end the hero is put on top where the last clip leaves the body.
const CLIMBS = [
  { max: 1.2, seq: ['T_STAND_2_JUMPUPLOW', 'S_JUMPUPLOW', 'T_JUMPUPLOW_2_STAND'] },
  { max: 1.85, seq: ['T_STAND_2_JUMPUPMID', 'S_JUMPUPMID', 'T_JUMPUPMID_2_STAND'] },
  { max: 2.75, seq: ['T_STAND_2_JUMPUP', 'T_JUMP_2_HANG', 'S_HANG', 'T_HANG_2_STAND'] },
].filter(k => k.seq.every(n => CLIPS[n]));
for (const k of CLIMBS) { const r = CLIPS[k.seq[k.seq.length - 1]].root, n = r.length; k.rise = r[n - 2] - STAND_Y; k.fwd = -r[n - 1]; }
const CLIMB_MIN = 0.55; // lower than this is a step the hero just walks up
const _v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function findLedge(c) {
  if (!CLIMBS.length) return null;
  const f = c.fwd, y0 = c.pos.y, maxH = CLIMBS[CLIMBS.length - 1].max;
  for (const d of [0.5, 0.65, 0.8, 0.95]) {
    const x = c.pos.x + f.x * d, z = c.pos.z + f.z * d;
    const top = groundAt(x, z, y0 + maxH, 0); if (top === null) continue;
    const H = top - y0; if (H < CLIMB_MIN) continue; // still open floor here: look a bit further ahead
    // room to stand up on top, and nothing overhead on the way up
    if (segCast(_v3(x, top + 0.15, z), _v3(x, top + 1.75, z)) !== null) return null;
    if (segCast(_v3(c.pos.x, y0 + 1.2, c.pos.z), _v3(c.pos.x, top + 1.8, c.pos.z)) !== null) return null;
    // where to stand afterwards: a little past the edge, on that same top surface
    for (const dl of [d + 0.3, d + 0.15]) {
      const lx = c.pos.x + f.x * dl, lz = c.pos.z + f.z * dl, g = groundAt(lx, lz, top + 0.3, 0.6);
      if (g !== null && Math.abs(g - top) < 0.3) return { H: g - y0, top: g, dist: dl, x: lx, z: lz, kind: CLIMBS.find(k => H <= k.max) };
    }
    return null;
  }
  return null;
}
function startClimb(c, L) {
  const k = L.kind; c.mv.f = c.mv.s = 0; c.over = null;
  c.act = { type: 'climb', id: ++actId, t: 0, i: 0, seq: k.seq, H: L.H, k: L.H / k.rise, kz: L.dist / k.fwd, land: _v3(L.x, L.top, L.z), hold: 0 };
  climbClip(c, c.act);
}
function climbClip(c, a) {
  c.play(a.seq[a.i], { loop: false, restart: true, blend: a.i ? 0.06 : 0.12 });
  c.base.k = a.k; c.base.kz = a.kz;
}
function climbTick(c, a, dt) {
  if (!c.done()) return;
  if (a.seq[a.i] === 'S_HANG' && (a.hold += dt) < 0.25) return; // a moment hanging on the edge
  if (++a.i < a.seq.length) return climbClip(c, a);
  // on top: move the hero to where the clip left the body and lower the pose by the same amount, so nothing jumps
  c.pos.copy(a.land); c.vy = 0; c.lastGood = a.land.y; c.rootY -= a.H; c.act = null;
  c.base.kz = 0; c.play('S_RUN', { blend: 0.15 }); sfx.step(c, 0.5);
}
function jumpTick(c, a, dt) {
  if (a.vx || a.vz) { const x = c.pos.x, z = c.pos.z; moveBy(c, a.vx * dt, a.vz * dt); if (c.pos.x === x && c.pos.z === z) a.vx = a.vz = 0; }
  if (c.done()) c.play(a.fwd ? 'S_JUMP' : c.vy > 0 ? 'S_JUMPUP' : 'S_FALLDN', { blend: 0.15, fixY: true });
}
function jumpBack(c) {
  if (c.downed || c.drawing || c.act) return;
  const name = c.drawn && c.mode === 'ranged' ? `T_${c.ranged.kind.toUpperCase()}JUMPB` : 'T_1HPARADEJUMPB';
  c.play(name, { loop: false, rm: true, restart: true, blend: 0.06 }); c.act = { type: 'jumpb', id: ++actId, t: 0 };
}
// ---------------------------------------------------------------- bows and crossbows
// Gothic 1's rules (as OpenGothic implements them): the projectile flies at 30 m/s under gravity, aimed at the
// target's centre with the arc compensated; the hit chance is 100% up close, the shooter's dexterity % at 20 m and
// nothing beyond 45 m. A hit does the weapon's damage minus the target's protection against arrows ('point'); a
// miss is shot off to the side. Shots can't be parried.
const BULLET_SPEED = 30, BULLET_G = 9.8, REF_RANGE = 20, MAX_RANGE = 45;
const projectiles = [];
const hitChance = (dex, d) => d < REF_RANGE ? 1 + (dex / 100 - 1) * (d / REF_RANGE) : d < MAX_RANGE ? (dex / 100) * (1 - (d - REF_RANGE) / (MAX_RANGE - REF_RANGE)) : 0;
const _ax = new THREE.Vector3(-1, 0, 0); // the ammunition meshes point along their local -x
function shoot(c) {
  if (c.downed || c.drawing || !c.drawn || c.mode !== 'ranged' || c.act) return false;
  if (!(c.ammo > 0)) { if (c.isPlayer) showMsg('No ' + (c.ranged.kind === 'bow' ? 'arrows' : 'bolts') + ' left', 1500); return false; }
  const K = c.ranged.kind.toUpperCase();
  c.act = { type: 'shoot', id: ++actId, t: 0, phase: 'raise', K };
  c.play(`T_${K}RUN_2_${K}AIM`, { loop: false, blend: 0.08 });
  return true;
}
function shootTarget(c) { return c.isPlayer ? (c.focus && c.focus.cast ? c.focus : null) : c.hostile; }
function shootTick(c, a, dt) {
  const tgt = shootTarget(c);
  if (tgt && !tgt.downed && !c.isPlayer) turnTo(c, tgt.pos, dt, 8);
  if (tgt && !tgt.downed && c.isPlayer && c.focus === lockOn) turnTo(c, tgt.pos, dt, 8);
  if (a.phase === 'raise' && c.done()) { a.phase = 'aim'; a.t = 0; c.play(`C_${a.K}_5`, { loop: true, blend: 0.05 }); }
  else if (a.phase === 'aim' && a.t > 0.3) { fire(c, tgt && !tgt.downed ? tgt : null); a.phase = 'shot'; a.t = 0; c.play(`S_${a.K}SHOOT`, { loop: true, blend: 0.03 }); }
  else if (a.phase === 'shot' && a.t > 0.2) { a.phase = 'reload'; a.t = 0; c.play(`T_${a.K}RELOAD`, { loop: false, blend: 0.08 }); }
  else if (a.phase === 'reload' && c.done()) c.act = null; // back to the bow / crossbow stance
}
function fire(c, tgt) {
  const r = c.ranged, from = new THREE.Vector3();
  c.root.updateMatrixWorld(true);
  c.bones[boneIdx[r.kind === 'bow' ? 'ZS_LEFTHAND' : 'ZS_RIGHTHAND']].getWorldPosition(from);
  let aim, hit = false;
  if (tgt) {
    aim = tgt.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
    hit = Math.random() < hitChance(c.dex || 0, from.distanceTo(aim));
    if (!hit) { // a miss: shoot off to one side (and a little high or low) of the target
      const side = new THREE.Vector3(aim.z - from.z, 0, from.x - aim.x).normalize();
      aim.addScaledVector(side, pick([-1, 1]) * rand(0.7, 1.4)).add(new THREE.Vector3(0, rand(-0.4, 0.6), 0));
    }
  } else aim = from.clone().addScaledVector(c.fwd, 30);
  const dx = aim.x - from.x, dz = aim.z - from.z, lxz = Math.hypot(dx, dz) || 1, t = lxz / BULLET_SPEED;
  const vel = new THREE.Vector3(dx / t, (aim.y - from.y) / t + 0.5 * BULLET_G * t, dz / t);
  const mesh = c.nock.clone(); mesh.visible = true; scene.add(mesh);
  projectiles.push({ mesh, pos: from.clone(), vel, owner: c, target: tgt, hit, dmg: r.dmg, dtype: r.dtype || 'point', life: 0, stuck: false });
  c.ammo--; playBuf(whooshBuf, from, c.isPlayer ? 0.6 : 0.5, 6);
}
const _seg = new THREE.Line3(), _cp = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const b = projectiles[i]; b.life += dt;
    if (b.stuck) { if (b.life > 8) { scene.remove(b.mesh); projectiles.splice(i, 1); } continue; }
    const prev = b.pos.clone(); b.vel.y -= BULLET_G * dt; b.pos.addScaledVector(b.vel, dt);
    b.mesh.position.copy(b.pos); b.mesh.quaternion.setFromUnitVectors(_ax, b.vel.clone().normalize());
    // a person in the way: the segment passes within 0.35 m of their body axis (knee to head)
    let victim = null;
    for (const e of entities) {
      if (e === b.owner || e.downed) continue;
      _a.set(e.pos.x, e.pos.y + 0.4, e.pos.z); _b.set(e.pos.x, e.pos.y + 1.8, e.pos.z);
      _seg.set(prev, b.pos); const d = segSegDist(prev, b.pos, _a, _b); if (d < 0.35) { victim = e; break; }
    }
    if (victim) {
      // the aimed-at target only takes damage when the shot's hit roll succeeded; anyone else in the way is hit
      if (victim !== b.target || b.hit) hurt(victim, b.owner, { dmg: b.dmg, dtype: b.dtype });
      scene.remove(b.mesh); projectiles.splice(i, 1); continue;
    }
    const w = segCast(prev, b.pos);
    if (w !== null) { b.pos.copy(prev).addScaledVector(b.pos.clone().sub(prev).normalize(), w); b.mesh.position.copy(b.pos); b.stuck = true; b.life = 0; continue; }
    if (b.life > 4) { scene.remove(b.mesh); projectiles.splice(i, 1); }
  }
}
function segSegDist(p1, q1, p2, q2) { // closest distance between segments p1q1 and p2q2
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r); let s = 0, t = 0;
  if (a < 1e-9) { t = clamp(f / e, 0, 1); } else {
    const c = d1.dot(r), bb = d1.dot(d2), den = a * e - bb * bb;
    s = den > 1e-9 ? clamp((bb * f - c * e) / den, 0, 1) : 0;
    t = (bb * s + f) / e;
    if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((bb - c) / a, 0, 1); }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}
// the nocked arrow: on the string while drawn and aiming, gone from the shot until the reload places the next one
function nockTick(c) {
  if (!c.nock) return;
  const a = c.act, show = c.drawn && c.mode === 'ranged' && c.ranged.kind === 'bow' && c.ammo > 0 && !c.drawing;
  let on = show;
  if (show && a && a.type === 'shoot') {
    const ev = c.base && c.base.clip.ev.munition_place;
    on = a.phase === 'raise' || a.phase === 'aim' || (a.phase === 'reload' && ev && c.frame() >= ev[0]);
  }
  c.nock.visible = on;
}
function strike(att, dir) {
  for (const t of entities) {
    if (t === att || t.downed) continue;
    const d = dist2(att, t); if (d > (att.reach || REACH)) continue;
    if (att.fwd.dot(dirTo(att, t)) < (dir === 'F' ? 0.55 : 0.1)) continue; // side swings sweep a wider arc
    hurt(t, att);
  }
}
function hurt(t, att, shot = null) {
  if (t.act && t.act.type === 'sit') t.act.slot.taken = null; // hit while seated: the seat is free again
  const toA = dirTo(t, att), facing = t.fwd.dot(toA);
  // parade: blocks a blow from the front while the parry animation is up (not a bolt or an arrow)
  if (!shot && t.act && t.act.type === 'parade' && facing > 0.4 && t.act.t < 0.95) {
    sfx.clash(t); if (att.act && att.act.type === 'attack') att.act.failed = true; return;
  }
  const prot = type => (t.prot && t.prot[type]) || 0;
  const dmg = shot ? Math.max(0, shot.dmg - prot(shot.dtype)) : Math.max(0, att.str + att.wdmg - prot(att.dtype || 'edge'));
  sfx.hit(t);
  if (t.cast && Math.random() < 0.6) bark(t, pick(['AARGH_1', 'AARGH_2', 'AARGH_3'])); else if (t.isPlayer) playAt(pick(['SVM_15_AARGH_1', 'SVM_15_AARGH_2']), at(t, 1.6), 1);
  t.hp -= dmg;
  // humans fighting with melee weapons don't kill each other: at 1 HP they go down unconscious (as in Gothic's arena)
  if (t.hp <= 1) { t.hp = 1; knockDown(t, att); }
  else {
    t.drawing = null; if (!t.drawn) { t.drawn = true; t.mode = 'melee'; t.slot(true); }
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
  if (a.type === 'jump') return jumpTick(c, a, dt);
  if (a.type === 'climb') return climbTick(c, a, dt);
  if (a.type === 'sit') return sitTick(c, a, dt);
  if (a.type === 'shoot') return shootTick(c, a, dt);
  if (a.type === 'fall') return;
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
let spaceT = 0; const SPACE_WINDOW = 120; // ms: Space and a direction pressed this close together are a combination
let walkOn = false;
// modern scheme: Space and the right mouse button are the same key. Held + A/D: strafe; held + S: parry (weapon
// drawn; unarmed you just walk back) - both in playerInput. Pressed together with forward (W): jump (or climb),
// except while focusing. W may come a moment after the press, so a press without it waits a short window.
const modHeld = () => !!keys.Space || rmb;
function modPress() {
  clearTimeout(spaceT);
  const tryJump = () => {
    const p = player; if (convo || paused || p.downed) return false;
    const fwd = keys.KeyW || keys.ArrowUp, sideKey = keys.KeyA || keys.KeyD || keys.ArrowLeft || keys.ArrowRight;
    if (!fwd || sideKey || keys.KeyS || keys.ArrowDown || actionHeld()) return false;
    jump(p); return true;
  };
  if (!tryJump()) spaceT = setTimeout(tryJump, SPACE_WINDOW);
} // Tab switches between running and walking for good; Shift switches only while held
// two control schemes: 'gothic' (the original's keys) and 'modern' (Space jumps, Ctrl draws, X sneaks, R looks back,
// right mouse locks the focus on an enemy). Picked in the pause menu, remembered per browser.
let scheme = store.get('controls', 'modern') === 'gothic' ? 'gothic' : 'modern'; // modern is the default ('controls' replaces an older key that always stored 'gothic')
let lockOn = null; // modern scheme: the NPC the hero stays turned towards
let sens = store.get('sens', 1);
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
addEventListener('keydown', e => {
  if (MOVE_KEYS.includes(e.code) || e.code === 'Space' || e.code === 'Tab' || e.key === 'Alt' || (started && !paused && !lockedUI && (e.key === 'Control' || e.ctrlKey))) e.preventDefault();
  if (!e.repeat) onKey(e); keys[e.code] = true;
});
// Ctrl is the draw key in the modern scheme, and browsers don't let a page block Ctrl+W: ask before the tab closes
addEventListener('beforeunload', e => { if (started && scheme === 'modern') { e.preventDefault(); e.returnValue = ''; } });
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'KeyE') actionRelease(); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; rmb = false; lmb = false; lockOn = null; attackBuf = null; });
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
  if (!player.downed && !lockOn && !isSeated(player)) player.heading -= mx * 0.0022 * sens; // locked on / seated: no turning
  pitch = clamp(pitch + my * 0.0016 * sens, -0.35, 1.1);
});
const dirKeys = () => (keys.KeyA || keys.ArrowLeft ? 'L' : keys.KeyD || keys.ArrowRight ? 'R' : keys.KeyS || keys.ArrowDown ? 'B' : 'F');
addEventListener('mousedown', e => {
  if (!document.pointerLockElement || lockedUI || paused) return;
  // Gothic scheme: left = attack. Modern: left = lock focus on a target (E is the action key there). Right = parry in both.
  if (e.button === 0) { if (scheme === 'modern') { lmb = true; actionPress(); } else actionInput(dirKeys()); }
  if (e.button === 2) { rmb = true; if (scheme === 'modern') modPress(); else if (player.drawn) parade(player); } // modern: same as Space
});
addEventListener('mouseup', e => { if (e.button === 2) rmb = false; if (e.button === 0) { lmb = false; actionRelease(); } });
addEventListener('contextmenu', e => e.preventDefault());
const LOCK_RANGE = 15;
// Modern scheme: E is the action key (talk; attack with the weapon drawn). Holding left mouse keeps the focus on a
// target, and an attack needs both: left mouse held + E
let lmb = false;
// Modern scheme, Gothic-style action key: left mouse OR E. Holding it locks the focus on a target; with the weapon
// drawn the movement keys then fight instead of moving: W attacks, A/D swing left/right, S parries.
// Pressed with the weapon sheathed it talks to the NPC nearby.
const actionHeld = () => scheme === 'modern' && (lmb || !!keys.KeyE);
const ACTION_DIRS = { KeyW: 'F', ArrowUp: 'F', KeyA: 'L', ArrowLeft: 'L', KeyD: 'R', ArrowRight: 'R', KeyS: 'B', ArrowDown: 'B' };
function actionPress() {
  const p = player; if (p.downed) return;
  acquireLock();
  if (!p.drawn && !p.drawing) { interact(); return; }
  const held = Object.keys(ACTION_DIRS).find(k => keys[k] && !(modHeld() && 'LR'.includes(ACTION_DIRS[k]))); if (held) actionInput(ACTION_DIRS[held]); // direction already down
}
function interact() {
  const p = player, n = p.focus && !p.focus.hostile && !p.focus.downed && dist2(p, p.focus) < 3.2 ? p.focus : null;
  if (n) return openMenu(n);
  if (isSeated(p)) return standUp(p);
  if (p.focusDoor) return p.focusDoor.slots === undefined && p.focusDoor.kind ? sit(p, p.focusDoor) : useDoor(p.focusDoor);
  const t = nearestTalker(); if (t) openMenu(t);
}
function actionRelease() { if (!actionHeld()) lockOn = null; }
function toggleLock() { if (lockOn) lockOn = null; else acquireLock(); }
function acquireLock() {
  // the NPC in focus, else the nearest one roughly in front
  let best = player.focus, bs = 1e9;
  if (!best) for (const n of npcs) {
    if (n.downed) continue; const d = dist2(player, n); if (d > LOCK_RANGE) continue;
    const dot = player.fwd.dot(dirTo(player, n)); if (dot < 0.3) continue;
    const s = d * (2.2 - dot); if (s < bs) { bs = s; best = n; }
  }
  lockOn = best || null;
}
// an attack pressed while the hero can't swing yet (drawing, stumbling, jumping back, the tail of a swing after its
// combo window) is kept for a moment and starts as soon as he can, instead of being lost
let attackBuf = null; const ATTACK_BUF_MS = 400;
function actionInput(dir) {
  const p = player; if (p.downed) return;
  attackBuf = null;
  if (!p.drawn && !p.drawing) { if (!convo) toggleWeapon(p, p.lastMode || 'melee'); return; }
  if (p.drawing) { attackBuf = { dir, at: performance.now() }; return; }
  if (p.mode === 'ranged') { if (dir === 'F') shoot(p); return; } // aim + shoot; the other directions do nothing
  if (dir === 'B') return parade(p);
  const a = p.act;
  if (a && a.type === 'attack') {
    const f = p.frame(), [ws, we] = winOf(a);
    if (f < ws) a.failed = true; else if (f <= we + 0.5) a.queued = dir; else attackBuf = { dir, at: performance.now() };
    return;
  }
  if (a && a.type !== 'parade') { attackBuf = { dir, at: performance.now() }; return; }
  startAttack(p, dir);
}
function attackBufTick() {
  if (!attackBuf) return;
  const p = player;
  if (performance.now() - attackBuf.at > ATTACK_BUF_MS || p.downed || !p.drawn || convo) { attackBuf = null; return; }
  if (p.drawing || (p.act && p.act.type !== 'parade')) return;
  const d = attackBuf.dir; attackBuf = null; actionInput(d);
}
// ---- start screen + pause menu (controls legend, volumes, mouse, restart)
let started = false, paused = false;
function showLegends() {
  for (const id of ['startLegend', 'pauseLegend']) $(id).replaceChildren($(scheme === 'modern' ? 'legendModern' : 'legendTpl').content.cloneNode(true));
}
function setScheme(v) { scheme = v; store.set('controls', v); lockOn = null; $('scheme').value = v; showLegends(); }
$('scheme').addEventListener('change', e => setScheme(e.target.value));
setScheme(scheme);
function setPaused(v) {
  paused = v; $('pause').style.display = v ? 'flex' : 'none'; if (v) renderJournal();
  if (v) { for (const k in keys) keys[k] = false; rmb = false; lmb = false; attackBuf = null; lockOn = null; if (document.pointerLockElement) document.exitPointerLock(); $('btnResume').focus(); }
  else lockPointer();
}
// Esc releases pointer lock in every browser; treat losing the lock mid-game as "open the menu"
document.addEventListener('pointerlockchange', () => { if (started && !document.pointerLockElement && !lockedUI && !paused) setPaused(true); });
$('btnResume').addEventListener('click', () => setPaused(false));
$('btnRestart').addEventListener('click', () => { restartArena(); setPaused(false); });
$('volMusic').addEventListener('input', e => { musicVol = volCurve(e.target.value); if (musicVol > 0 && !musicOn) musicOn = true; applyMusicLevel(); });
$('volSfx').addEventListener('input', e => listener.setMasterVolume(volCurve(e.target.value)));
$('sens').value = Math.round(sens * 100);
$('bright').value = Math.round(brightness * 100);
$('bright').addEventListener('input', e => setBrightness(e.target.value / 100));
$('sens').addEventListener('input', e => { sens = e.target.value / 100; store.set('sens', sens); });
const STYLE_NAMES = { '': 'untrained', '1HST1': 'trained', '1HST2': 'master' };
function setStyle(s) { player.style = s; store.set('style', s); $('style').textContent = STYLE_NAMES[s]; }
setStyle(player.style in STYLE_NAMES ? player.style : '');
function restartArena() {
  if (convo) closeConvo(); lockOn = null;
  for (const sl of seatSlots) sl.taken = null;
  for (const b of projectiles) scene.remove(b.mesh); projectiles.length = 0;
  for (const c of entities) if (c.ranged) { c.ammo = c.ammo0; c.rslot(false); c.mode = 'melee'; c.switchTo = null; }
  for (const d of doors) { d.state = 'shut'; d.grp.matrix.fromArray(d.open[0]); }
  for (const c of entities) {
    Object.assign(c, { downed: false, act: null, drawing: null, hostile: null, vy: 0, air: false, fallT: 0, hp: c.maxHp, over: null, lookT: 0, warn: 0, weapT: 0 });
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
// ---- story state: Gothic-style conditional topics (dialogue/arena.json -> dialogue.json). A topic shows while its
// conditions hold (cond.has / cond.not flags) and, unless once:false, until it has been heard. Afterwards it can set
// flags, add a journal entry, give ore and trigger an effect.
const story = { flags: new Set(), heard: new Set(), journal: [], ore: 0, title: (dlg.quest && dlg.quest.title) || 'Journal' };
const castName = Object.fromEntries(dlg.cast.map(c => [c.id, c.name]));
const fmt = t => t.replace(/\{([A-Z_]+)\}/g, (m, id) => castName[id] || m); // {KHARIM} -> that NPC's name
function topicOpen(n, t) {
  const c = t.cond || {};
  return (t.once === false || !story.heard.has(n.cast.id + ':' + t.id))
    && (c.has || []).every(f => story.flags.has(f)) && !(c.not || []).some(f => story.flags.has(f));
}
function addJournal(text) {
  text = fmt(text); if (story.journal.includes(text)) return;
  story.journal.push(text); showMsg('New journal entry: ' + story.title, 3000); renderJournal();
}
function renderJournal() {
  const j = $('journal'); if (!j) return;
  j.innerHTML = '';
  const h = document.createElement('div'); h.className = 'jtitle'; h.textContent = story.title + (story.journal.length ? '' : ' (nothing yet)'); j.appendChild(h);
  for (const e of story.journal) { const d = document.createElement('div'); d.className = 'jentry'; d.textContent = e; j.appendChild(d); }
  const o = document.createElement('div'); o.className = 'jore'; o.textContent = 'Ore: ' + story.ore; j.appendChild(o);
}
// what a heard topic changes; effects that start a fight run once the conversation has closed
function topicDone(n, t) {
  story.heard.add(n.cast.id + ':' + t.id);
  for (const f of t.set || []) story.flags.add(f);
  if (t.ore) { story.ore += t.ore; showMsg('+' + t.ore + ' ore', 2500); renderJournal(); }
  if (t.journal) addJournal(t.journal);
  const [kind, id, val] = (t.effect || '').split(':'), byId = id && npcs.find(x => x.cast && x.cast.id === id);
  if (kind === 'weaken' && byId) byId.str = Math.max(0, byId.str - (+val || 0));
  if (kind === 'fight') return () => { n.hostile = player; bark(n, 'YOUASKEDFORIT'); };
  if (kind === 'hostile' && byId) return () => setTimeout(() => { if (!byId.downed) { byId.hostile = player; bark(byId, 'YOUASKEDFORIT'); } }, 2500);
  return null;
}
function nearestTalker() {
  let b = null, bd = 3.2;
  for (const n of npcs) { if (n.downed || n.hostile || n.act) continue; const d = dist2(n, player); if (d < bd) { bd = d; b = n; } }
  return b;
}
function topicLabel(t) { const pl = t.label ? { text: t.label } : t.lines.find(l => l.who === 'player') || t.lines[0]; const s = fmt(pl.text).replace(/\s+/g, ' '); return s.length > 120 ? s.slice(0, 118) + '…' : s; }
function openMenu(n) {
  convo = { npc: n, state: 'menu' }; lockedUI = true; document.exitPointerLock(); n.talking = false;
  const m = $('menu'); m.style.display = 'block'; m.innerHTML = ''; $('hp').style.visibility = 'hidden';
  const opts = n.cast.topics.filter(t => topicOpen(n, t)).map(t => ({ label: topicLabel(t), run: () => playTopic(n, t) }));
  if (n.duty !== 'idle') opts.push({ label: '⚔ I challenge you to a fight!', run: () => { closeConvo(); n.hostile = player; bark(n, 'YOUASKEDFORIT'); } });
  opts.push({ label: 'Goodbye', run: closeConvo });
  n.cast.topics.forEach(t => t.lines.forEach(l => loadSound(l.wav)));
  // Gothic's choice box: plain lines across the bottom of the screen, the selected one in the highlighted font
  opts.forEach((o, i) => {
    const d = document.createElement('div'); m.appendChild(d); o.el = d; d.onmouseenter = () => selectOpt(i);
  });
  convo.opts = opts; convo.sel = -1; convo.openedAt = performance.now(); selectOpt(0);
}
function selectOpt(i) {
  const o = convo.opts; convo.sel = (i + o.length) % o.length;
  o.forEach((x, k) => setText(x.el, [[x.label, k === convo.sel ? F10HI : F10]]));
}
function playTopic(n, t) {
  $('menu').style.display = 'none'; $('hp').style.visibility = ''; convo.state = 'talk'; let i = 0;
  const next = () => {
    if (!convo || convo.npc !== n) return;
    if (i >= t.lines.length) {
      setText($('sub'), ''); n.talking = false;
      const after = topicDone(n, t);
      if (after) { closeConvo(); after(); return; }
      return openMenu(n);
    }
    const l = t.lines[i++], line = ++convo.line; n.talking = l.who === 'npc';
    setText($('sub'), [[(l.who === 'npc' ? n.name : 'You') + ': ', F10HI], [fmt(l.text), F10]], innerWidth * 0.6 / uiScale());
    // each line advances once: when its voice ends, or when it is skipped (right click), whichever comes first
    playVoice(l.wav, () => setTimeout(() => { if (convo && convo.line === line) next(); }, 350));
  };
  convo.line = 0;
  convo.skip = () => { if (voiceAudio && voiceAudio.isPlaying) { voiceAudio.onEnded = () => {}; voiceAudio.stop(); voiceAudio.isPlaying = false; } next(); };
  next();
}
// right click skips the line being spoken (the pointer is free during a conversation, so this has its own listener)
// mouse in a conversation: the wheel moves through the choices, left click takes the highlighted one (clicks in the
// first moments are ignored: in the modern scheme the click that opened the talk would otherwise pick at once),
// right click skips the line being spoken. The pointer is free while talking, so these have their own listeners.
addEventListener('mousedown', e => {
  if (!convo) return;
  if (e.button === 2 && convo.state === 'talk' && convo.skip) convo.skip();
  if (e.button === 0 && convo.state === 'menu' && performance.now() - convo.openedAt > 300) convo.opts[convo.sel].run();
});
addEventListener('wheel', e => {
  if (!convo || convo.state !== 'menu' || !e.deltaY) return;
  e.preventDefault(); selectOpt(convo.sel + Math.sign(e.deltaY));
}, { passive: false });
function closeConvo() { if (convo) convo.npc.talking = false; convo = null; lockedUI = false; $('menu').style.display = 'none'; $('hp').style.visibility = ''; setText($('sub'), ''); if (voiceAudio && voiceAudio.isPlaying) { voiceAudio.onEnded = () => {}; voiceAudio.stop(); } lockPointer(); }
const flash = t => showMsg(t, 2000);
function onKey(e) {
  if (!started) return;
  if (paused) { if (e.code === 'Escape' || e.code === 'KeyP') setPaused(false); return; }
  if (e.code === 'KeyP' && !convo) return setPaused(true);
  if (convo && convo.state === 'menu') {
    // arrows (or W/S) move the selection, Enter/Space/E takes it, 1-9 pick directly
    if (e.code === 'ArrowUp' || e.code === 'KeyW') return selectOpt(convo.sel - 1);
    if (e.code === 'ArrowDown' || e.code === 'KeyS') return selectOpt(convo.sel + 1);
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code === 'KeyE') return convo.opts[convo.sel].run();
    const i = parseInt(e.key) - 1; if (convo.opts[i]) convo.opts[i].run(); if (e.code === 'Escape') closeConvo(); return;
  }
  if (convo && e.code === 'Escape') return closeConvo();
  if (convo) return;
  const p = player;
  const modern = scheme === 'modern';
  if (modern) {
    if (e.code === 'KeyE') actionPress();
    else if (ACTION_DIRS[e.code] && actionHeld() && (p.drawn || p.drawing) && !p.downed && !(modHeld() && 'LR'.includes(ACTION_DIRS[e.code])))
      actionInput(ACTION_DIRS[e.code]); // action + direction (with Space / right mouse held, A/D strafe instead of swinging)
  } else if (e.code === 'KeyE' && !p.downed && !p.drawn) interact();
  if ((modern ? e.code === 'ControlLeft' || e.code === 'ControlRight' : e.code === 'Space' || e.code === 'KeyF') && !p.downed) toggleWeapon(p, p.lastMode || 'melee');
  // Gothic's weapon keys: 1 = melee weapon, 2 = bow / crossbow (pressing the drawn one's key sheathes it)
  if ((e.code === 'Digit1' || e.code === 'Digit2') && !p.downed) {
    const m = e.code === 'Digit1' ? 'melee' : 'ranged';
    if (m === 'ranged' && !p.ranged) flash('No bow or crossbow');
    else { p.lastMode = m; if (p.drawn && p.mode === m) toggleWeapon(p); else switchWeapon(p, m); }
  }
  if (modern && e.code === 'Space') modPress();
  else if (!modern && (e.code === 'AltLeft' || e.code === 'AltRight' || e.code === 'KeyV')) jump(p);
  if (e.code === 'Tab') { walkOn = !walkOn; flash(walkOn ? 'Walking' : 'Running'); }
  if ((modern ? e.code === 'KeyX' : e.code === 'KeyC') || e.code === 'NumpadMultiply') { sneakOn = !sneakOn; flash(sneakOn ? 'Sneaking' : 'Running'); }
  if (e.code === 'KeyT') { const order = ['', '1HST1', '1HST2']; setStyle(order[(order.indexOf(p.style) + 1) % 3]); flash('One-handed: ' + STYLE_NAMES[p.style]); }
  if (e.code === 'KeyM') toggleMusic();
  if (e.code === 'KeyR' && p.downed && p.act && p.act.type === 'down') getUp(p);
}
const TURN_RATE = 2.6; // rad/s: turning on the spot with A/D (modern scheme)
function playerInput(dt) {
  const p = player, k = keys;
  p.mv.f = 0; p.mv.s = 0; p.mv.turn = 0;
  if (p.downed || lockedUI) return;
  attackBufTick();
  p.mv.f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  const side = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  p.gait = sneakOn ? 'sneak' : walkOn !== !!(k.ShiftLeft || k.ShiftRight) ? 'walk' : 'run';
  const modern = scheme === 'modern', back = k.KeyS || k.ArrowDown, strafeMod = modHeld(); // Space / right mouse held + A/D: strafe (focused or not, armed or not)
  // modern: A/D turn on the spot (armed or not); with the right mouse button or Space held they strafe,
  // and right mouse + S parries. Gothic scheme: A/D strafe, right mouse parries.
  if (!modern || strafeMod) p.mv.s = side;
  else if (side && !(p.drawn && actionHeld())) { p.heading -= side * TURN_RATE * dt; p.mv.turn = side; }
  if (p.drawn && actionHeld()) { p.mv.f = 0; if (!strafeMod) p.mv.s = 0; } // holding the action key: the direction keys fight, not walk (Space / right mouse + A/D still strafe)
  // modern: Space / right mouse + S parries (held). Gothic scheme: right mouse parries.
  const parry = p.drawn && (modern ? modHeld() && back : rmb);
  if (parry) { p.mv.f = 0; if (!p.drawing && !p.act) parade(p); }
  else if (!modern && p.drawn && !p.drawing && p.mv.f < 0) { p.mv.f = 0; if (!p.act) jumpBack(p); } // (Gothic scheme: S jumps back)
  // locked focus (modern scheme): keep facing the target; A/D then circle around it
  if (lockOn && (lockOn.downed || dist2(p, lockOn) > (p.drawn && p.mode === 'ranged' ? MAX_RANGE : LOCK_RANGE))) lockOn = null;
  if (actionHeld() && !lockOn) acquireLock(); // still holding: take the next target that comes into view
  p.focusDoor = null;
  if (isSeated(p)) { p.mv.f = p.mv.s = 0; p.mv.turn = 0; if (k.KeyW || k.KeyS || k.KeyA || k.KeyD || k.Space) standUp(p); return; }
  if (lockOn) { if (!p.act || p.act.type === 'parade' || (p.act.type === 'attack' && !p.act.hit)) turnTo(p, lockOn.pos, dt, 9); p.focus = lockOn; return; }
  // focus: the NPC the hero is looking at
  let best = null, bs = 1e9;
  for (const n of npcs) {
    const rng = p.drawn && p.mode === 'ranged';
    if (n.downed) continue; const d = dist2(p, n); if (d > (rng ? MAX_RANGE : p.drawn ? 10 : 7)) continue;
    const dot = p.fwd.dot(dirTo(p, n)); if (dot < (rng ? 0.9 : 0.6)) continue;
    const s = d * (2.2 - dot); if (s < bs) { bs = s; best = n; }
  }
  p.focus = best;
  if (!best && !p.drawn) {
    let bd = 2.6;
    for (const d of doors) {
      const dd = Math.hypot(d.pos.x - p.pos.x, d.pos.z - p.pos.z); if (dd > bd || Math.abs(d.pos.y - p.pos.y) > 1.5) continue;
      const to = new THREE.Vector3(d.pos.x - p.pos.x, 0, d.pos.z - p.pos.z).normalize(); if (p.fwd.dot(to) < 0.5) continue;
      bd = dd; p.focusDoor = d;
    }
    if (!p.focusDoor) { // a free seat close in front
      let bs = 1.4;
      for (const sl of seatSlots) {
        if (sl.taken) continue; const dd = Math.hypot(sl.p.x - p.pos.x, sl.p.z - p.pos.z); if (dd > bs || Math.abs(sl.p.y - p.pos.y) > 0.8) continue;
        const to = new THREE.Vector3(sl.p.x - p.pos.x, 0, sl.p.z - p.pos.z); if (dd > 0.4 && p.fwd.dot(to.normalize()) < 0.5) continue;
        bs = dd; p.focusDoor = sl;
      }
    }
  }
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
  const noise = p.act && p.act.type === 'attack' ? 10 : p.air ? 6 : moving ? { run: 7, walk: 2.5, sneak: 0 }[p.gait] : 0;
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
  if (n.ranged && !n.drawing && !n.act) {
    const sees = segCast(n.pos.clone().setY(n.pos.y + 1.5), tgt.pos.clone().setY(tgt.pos.y + 1.3)) === null;
    const want = n.ammo > 0 && sees && d > 7 ? 'ranged' : d < 4.5 || !(n.ammo > 0) || !sees ? 'melee' : n.drawn ? n.mode : 'melee';
    if (!n.drawn || n.mode !== want) { switchWeapon(n, want); return; }
  }
  if (n.drawn && n.mode === 'ranged') {
    if (n.drawing || n.act) return;
    turnTo(n, tgt.pos, dt, 6);
    n.shotCd = (n.shotCd || rand(0.3, 0.8)) - dt;
    if (n.shotCd <= 0 && n.fwd.dot(dirTo(n, tgt)) > 0.95) { shoot(n); n.shotCd = rand(0.8, 1.8) * (1.4 - n.skill); }
    return;
  }
  if (!n.drawn && !n.drawing) toggleWeapon(n, 'melee');
  if (n.act) return; // attack/parade/jump in progress (combos are decided in attackTick)
  turnTo(n, tgt.pos, dt, 7);
  if (n.drawing) { if (d > 2) n.mv.f = 1; return; }
  if (d > (n.reach || REACH) - 0.2) { n.mv.f = 1; return; }
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
    n.idlePose = null; if (!isSeated(n)) turnTo(n, player.pos, dt);
    n.gestT = (n.gestT || 0) - dt; if (n.talking && n.gestT < 0 && GESTURES.length) { n.overlay(pick(GESTURES)); n.gestT = rand(2.5, 4.5); }
    return;
  }
  if (n.hostile && n.hostile.downed) n.hostile = null;
  if (isSeated(n)) {
    if (n.hostile || (n.sitT -= dt) < 0) standUp(n);
    return; // (a seated NPC talks from his seat, without turning)
  }
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
    if (n.wt < 0) {
      n.wt = rand(4, 9); n.seatGoal = null;
      // now and then: sit down on a free seat near home for a while
      const free = Math.random() < 0.5 && seatSlots.filter(sl => !sl.taken && sl.p.distanceTo(n.home) < 7);
      if (free && free.length) { n.seatGoal = pick(free); n.wander = n.seatGoal.p.clone(); }
      else n.wander = n.home.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3)));
    }
    if (n.seatGoal && !n.seatGoal.taken && Math.hypot(n.seatGoal.p.x - n.pos.x, n.seatGoal.p.z - n.pos.z) < 0.45) {
      if (sit(n, n.seatGoal)) n.sitT = rand(20, 40); n.seatGoal = null; return;
    }
    if (n.wander && Math.hypot(n.wander.x - n.pos.x, n.wander.z - n.pos.z) > 0.4) { n.gait = 'walk'; if (turnTo(n, n.wander, dt, 4) < 0.5) n.mv.f = 1; }
  }
}

// ---------------------------------------------------------------- music
// Prefers the game's own themes rendered by export_music.py. Like Gothic, exactly one theme plays: the calm camp theme,
// or the fight theme while someone is attacking the hero (a short crossfade when it switches).
// Falls back to a small procedural score if those files are missing.
let musicOn = true, mgain = null, nextNote = 0, step = 0, intensity = 0, musicVol = volCurve($('volMusic').value), procedural = false, theme = 'std', calmT = 0;
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
      const g = actx.createGain(); g.gain.value = k === theme ? 1 : 0; s.connect(g).connect(mgain); s.start(); tracks[k] = g;
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
// threatened = an NPC is fighting the hero. Switch to the fight theme at once, back to calm after 6 s of peace.
function updateMusic(threatened, dt) {
  calmT = threatened ? 0 : calmT + dt;
  const want = threatened ? 'fgt' : calmT > 6 ? 'std' : theme;
  intensity += ((want === 'fgt' ? 1 : 0) - intensity) * Math.min(1, dt * 0.6); // tempo of the procedural fallback
  if (want === theme) return; theme = want;
  if (!tracks.std) return;
  for (const k of ['std', 'fgt']) { const g = tracks[k].gain; g.cancelScheduledValues(actx.currentTime); g.setTargetAtTime(k === theme ? 1 : 0, actx.currentTime, 0.5); }
}
// a hidden tab goes silent (otherwise two open tabs play two soundtracks over each other)
document.addEventListener('visibilitychange', () => { if (document.hidden) actx.suspend(); else if (started) actx.resume(); });
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

// ---------------------------------------------------------------- the barrier
// Gothic 1's magic barrier: the dome over the valley (MAGICFRONTIER_OUT), drawn by the engine with the BARRIERE
// texture. Mostly a faint shimmer; every few seconds a patch of it flares up, often with a lightning bolt
// (THUNDER_A0..A3) crackling across it and the barrier's sound. It is far bigger than the camera's range, so like the
// sky it follows the camera, at half scale: always behind the world, with a little parallax.
const barrierData = await jget('barrier.json').catch(() => null);
const BARRIER_K = 0.5;
const barrier = new THREE.Group(); barrier.scale.setScalar(BARRIER_K); scene.add(barrier);
const domeVerts = [], flashes = [], bolts = [];
let domeGlow = null, flashT = rand(2, 5);
// additive, drawn right after the sky with no depth test, before the (opaque) world covers it
const glowMat = (uniforms, frag, vert) => new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag,
  blending: THREE.AdditiveBlending, transparent: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false });
if (barrierData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(barrierData.p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(barrierData.u, 2));
  domeGlow = new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1); g.setAttribute('glow', domeGlow);
  const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) domeVerts.push(new THREE.Vector3().fromBufferAttribute(pa, i));
  const dome = new THREE.Mesh(g, glowMat({ map: { value: skyTex('BARRIERE') }, time: { value: 0 } },
    // the lightning veins (BARRIERE) projected from the dome's position in two drifting layers (the mesh's own UVs
    // stretch one tile over hundreds of metres); they show in large patches that wander over the sky, plus flares
    `uniform sampler2D map; uniform float time; varying float vg; varying vec3 vpos;
     void main(){
       vec3 t = texture2D(map, vec2(vpos.x + vpos.y * 0.4, vpos.z - vpos.y * 0.3) / 300.0 + vec2(time * 0.006, time * 0.011)).rgb;
       float w = sin(vpos.x * 0.017 + time * 0.09) * sin(vpos.z * 0.021 - time * 0.07) + 0.5 * sin(vpos.y * 0.03 + vpos.x * 0.008 + time * 0.05);
       float patchv = smoothstep(0.2, 0.9, w) * 0.45;
       gl_FragColor = vec4(t * vec3(0.6, 0.8, 1.0) * (patchv + vg), 1.0); }`,
    'attribute float glow; varying float vg; varying vec3 vpos; void main(){ vg = glow; vpos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'));
  dome.renderOrder = -0.9; dome.frustumCulled = false; barrier.add(dome);
}
const thunderTex = [0, 1, 2, 3].map(i => skyTex('THUNDER_A' + i));
const boltVert = 'varying vec2 vuv; void main(){ vuv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const boltFrag = 'uniform sampler2D map; uniform float k; varying vec2 vuv; void main(){ gl_FragColor = vec4(texture2D(map, vuv).rgb * vec3(0.8, 0.9, 1.0) * k * 1.8, 1.0); }';
['MFX_BARRIERE_AMBIENT', 'MFX_BARRIERE_SHOOT'].forEach(loadSound);
function barrierFlash() {
  const up = domeVerts.filter(v => v.y > 60); if (!up.length) return;
  // mostly where the hero is looking (the dome follows the camera, so direction = dome point - camera position)
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const seen = up.filter(v => v.clone().sub(camera.position).normalize().dot(fwd) > 0.87); // within ~30° of the view
  const c = pick(seen.length && Math.random() < 0.75 ? seen : up); flashes.push({ c, r: rand(90, 220), t: 0, dur: rand(1.2, 2.6), peak: rand(0.35, 0.8) });
  if (Math.random() < 0.65) {
    // a jagged bolt along the dome from the flash towards a neighbouring point
    const near = up.filter(v => { const d = v.distanceTo(c); return d > 80 && d < 260; }); if (!near.length) return;
    const b = pick(near), ctr = new THREE.Vector3(0, 0, 0), pts = [];
    for (let i = 0; i <= 10; i++) {
      const p = c.clone().lerp(b, i / 10); if (i && i < 10) p.add(new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14)));
      pts.push(p);
    }
    const pos = [], uv = [], W = 28;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], e = pts[i + 1], dir = e.clone().sub(a).normalize(), out = a.clone().sub(ctr).normalize();
      const side = new THREE.Vector3().crossVectors(dir, out).normalize().multiplyScalar(W);
      const q = [a.clone().add(side), a.clone().sub(side), e.clone().add(side), e.clone().sub(side)], v0 = i / 10, v1 = (i + 1) / 10;
      pos.push(...q[0].toArray(), ...q[1].toArray(), ...q[2].toArray(), ...q[1].toArray(), ...q[3].toArray(), ...q[2].toArray());
      uv.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, glowMat({ map: { value: thunderTex[0] }, k: { value: 1 } }, boltFrag, boltVert));
    m.renderOrder = -0.8; m.frustumCulled = false; barrier.add(m);
    bolts.push({ m, t: 0, life: rand(0.45, 0.9) });
    // the crackle, from the bolt's direction
    const wp = c.clone().multiplyScalar(BARRIER_K).add(camera.position.clone().multiplyScalar(1 - BARRIER_K));
    const at = camera.position.clone().add(wp.sub(camera.position).normalize().multiplyScalar(30));
    loadSound(pick(['MFX_BARRIERE_AMBIENT', 'MFX_BARRIERE_SHOOT'])).then(buf => playBuf(buf, at, 0.55, 30));
  }
}
function updateBarrier(dt) {
  barrier.position.copy(camera.position).multiplyScalar(1 - BARRIER_K);
  if (!domeGlow) return;
  barrier.children[0].material.uniforms.time.value = clock.elapsedTime;
  if ((flashT -= dt) < 0) { flashT = rand(3, 10); barrierFlash(); }
  const gl = domeGlow.array; gl.fill(0);
  for (let f = flashes.length - 1; f >= 0; f--) {
    const F = flashes[f]; F.t += dt; if (F.t > F.dur) { flashes.splice(f, 1); continue; }
    const env = F.peak * Math.min(1, F.t / 0.15) * (1 - F.t / F.dur) * (0.75 + 0.25 * Math.sin(F.t * 40)); // flickering fade
    for (let i = 0; i < domeVerts.length; i++) { const d = domeVerts[i].distanceTo(F.c); if (d < F.r) gl[i] += env * (1 - d / F.r); }
  }
  domeGlow.needsUpdate = true;
  for (let i = bolts.length - 1; i >= 0; i--) {
    const B = bolts[i]; B.t += dt; const u = B.m.material.uniforms;
    if (B.t > B.life) { barrier.remove(B.m); B.m.geometry.dispose(); B.m.material.dispose(); bolts.splice(i, 1); continue; }
    u.map.value = thunderTex[Math.floor(B.t * 20) % 4]; u.k.value = (1 - B.t / B.life) * (Math.random() < 0.8 ? 1 : 0.3);
  }
}

// ---------------------------------------------------------------- weather
// Dynamic: clear spells and showers alternate. Clouds build up over ~40 s, Gothic's rain clouds cover the sky, fog
// closes in, light dims, rain falls around the camera with Gothic's rain loop (muffled and hidden under a roof).
// Pause menu: Dynamic / Clear / Rain.
let weatherMode = store.get('weather', 'dynamic');
const wx = { cloud: 0, rain: 0, wantRain: false, t: rand(120, 300), indoor: false, roofT: 0 };
const FOG_CLEAR = new THREE.Color(FOG), FOG_RAIN = new THREE.Color(0x646c72);
const RAIN_N = 1600, RAIN_BOX = [34, 20, 34], rainPos = new Float32Array(RAIN_N * 6), rainSeed = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) { rainSeed[i * 3] = Math.random(); rainSeed[i * 3 + 1] = Math.random(); rainSeed[i * 3 + 2] = Math.random(); }
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0xb4bec6, transparent: true, opacity: 0, depthWrite: false });
const rainLines = new THREE.LineSegments(rainGeo, rainMat); rainLines.frustumCulled = false; scene.add(rainLines);
let rainSrc = null, rainGain = null, rainLP = null;
function startRainSound() {
  if (rainSrc || actx.state !== 'running') return;
  rainSrc = actx.createBufferSource(); rainGain = actx.createGain(); rainLP = actx.createBiquadFilter();
  rainGain.gain.value = 0; rainLP.type = 'lowpass'; rainLP.frequency.value = 20000;
  // through the listener's gain, so the rain follows the effects volume like every other sound
  loadSound('RAIN_01').then(b => { if (!b) return; rainSrc.buffer = b; rainSrc.loop = true; rainSrc.connect(rainLP).connect(rainGain).connect(listener.getInput()); rainSrc.start(); });
}
function setWeather(m) { weatherMode = m; store.set('weather', m); $('weather').value = m; }
$('weather').addEventListener('change', e => setWeather(e.target.value));
setWeather(weatherMode);
function updateWeather(dt) {
  // what the sky is heading for
  if (weatherMode === 'dynamic') { if ((wx.t -= dt) < 0) { wx.wantRain = !wx.wantRain; wx.t = wx.wantRain ? rand(90, 180) : rand(120, 300); } }
  else wx.wantRain = weatherMode === 'rain';
  wx.cloud = clamp(wx.cloud + (wx.wantRain ? dt : -dt) / 40, 0, 1);
  wx.rain = smooth(clamp((wx.cloud - 0.55) / 0.45, 0, 1));
  const c = smooth(wx.cloud);
  // sky, fog and light
  const fc = FOG_CLEAR.clone().lerp(FOG_RAIN, c); scene.fog.color.copy(fc); scene.background.copy(fc);
  scene.fog.near = 45 - 20 * c; scene.fog.far = 160 - 70 * c;
  const su = sky.material.uniforms, fs = fc.clone().convertLinearToSRGB(); su.cloud.value = c; su.fogc.value.set(fs.r, fs.g, fs.b); // the sky works in sRGB
  SKY_DIM = 1 - 0.38 * c;
  for (const m of worldMats) m.color.setScalar(LIGHT_GAIN * SKY_DIM);
  hemi.intensity = 1.5 * (1 - 0.3 * c); sun.intensity = 1.4 * (1 - 0.8 * c); sunSprite.material.opacity = 1 - c;
  // under a roof? (checked a few times a second): no rain in view, muffled sound
  if ((wx.roofT -= dt) < 0) { wx.roofT = 0.3; const p = camera.position; wx.indoor = segCast(p, p.clone().add(new THREE.Vector3(0, 15, 0))) !== null; }
  const r = wx.rain;
  rainLines.visible = r > 0.01 && !wx.indoor;
  if (rainLines.visible) {
    rainMat.opacity = 0.45 * r;
    const cp = camera.position, t = clock.elapsedTime, fall = 13, wind = [2.2, 0.9], len = 0.55;
    const n = Math.floor(RAIN_N * r);
    for (let i = 0; i < RAIN_N; i++) {
      const o = i * 6, s3 = i * 3;
      if (i >= n) { rainPos.fill(0, o, o + 6); continue; }
      // each drop loops through a box that moves with the camera
      const y = ((rainSeed[s3 + 1] * RAIN_BOX[1] - t * fall) % RAIN_BOX[1] + RAIN_BOX[1]) % RAIN_BOX[1];
      const fallen = RAIN_BOX[1] - y;
      const x = cp.x + ((rainSeed[s3] * RAIN_BOX[0] + fallen * wind[0] / fall - cp.x) % RAIN_BOX[0] + RAIN_BOX[0]) % RAIN_BOX[0] - RAIN_BOX[0] / 2;
      const z = cp.z + ((rainSeed[s3 + 2] * RAIN_BOX[2] + fallen * wind[1] / fall - cp.z) % RAIN_BOX[2] + RAIN_BOX[2]) % RAIN_BOX[2] - RAIN_BOX[2] / 2;
      const yy = cp.y - 6 + y;
      rainPos[o] = x; rainPos[o + 1] = yy; rainPos[o + 2] = z;
      rainPos[o + 3] = x - wind[0] / fall * len; rainPos[o + 4] = yy + len; rainPos[o + 5] = z - wind[1] / fall * len;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  if (r > 0.01) startRainSound();
  if (rainGain) {
    rainGain.gain.setTargetAtTime(r * (wx.indoor ? 0.35 : 0.8), actx.currentTime, 0.3);
    rainLP.frequency.setTargetAtTime(wx.indoor ? 900 : 20000, actx.currentTime, 0.3);
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
  flames.push({ pl, flicker: L.flicker, ph: Math.random() * 10 });
}

// ---------------------------------------------------------------- particle effects (Gothic .PFX: fires, smoke, torches, embers)
// Each effect's settings come from Gothic's PARTICLEFX.DAT (export_world.py): emission rate, lifetime, emitter shape,
// direction and speed, gravity, size growth, colour and alpha over life, additive or blended. Emitters within
// PFX_RANGE of the camera run; particles are camera-facing points sized in world units.
const PFX_RANGE = 45, PFX_MAX_EMITTERS = 48;
const pfxSystems = [];
const pfxVert = `attribute float size; attribute vec4 pcolor; varying vec4 vColor; uniform float scale;
  void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * scale / max(0.1, -mv.z); vColor = pcolor; }`;
const pfxFrag = (add) => `uniform sampler2D map; varying vec4 vColor;
  void main(){ vec4 t = texture2D(map, gl_PointCoord); float a = t.a * vColor.a; if (a < 0.01) discard;
    gl_FragColor = ${add ? 'vec4(t.rgb * vColor.rgb * a, 1.0)' : 'vec4(t.rgb * vColor.rgb, a)'}; }`;
for (const [name, d] of Object.entries(world.pfxDefs || {})) {
  const emitters = (world.pfx || []).filter(e => e.n === name).map(e => ({ p: new THREE.Vector3(...e.p), acc: Math.random() }));
  if (!emitters.length) continue;
  const perEmitter = Math.ceil(d.pps * (d.life + d.lifeVar) * 1.15) + 2, cap = perEmitter * Math.min(emitters.length, PFX_MAX_EMITTERS);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(cap), 1));
  g.setAttribute('pcolor', new THREE.BufferAttribute(new Float32Array(cap * 4), 4));
  const add = d.blend === 'ADD';
  const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: getTex(d.tex) }, scale: { value: 1 } }, vertexShader: pfxVert, fragmentShader: pfxFrag(add),
    transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 2; scene.add(pts);
  pfxSystems.push({ d, emitters, cap, g, mat, parts: [] });
}
const _rv = new THREE.Vector3();
function pfxSpawn(sys, e) {
  const d = sys.d, r = d.dim;
  if (d.shape === 'SPHERE') { _rv.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)); if (_rv.lengthSq() > 1) _rv.normalize(); _rv.multiplyScalar(d.volume ? r : r * 0.9); }
  else if (d.shape === 'CIRCLE') { const a = rand(0, Math.PI * 2), k = d.volume ? Math.sqrt(Math.random()) : 1; _rv.set(Math.cos(a) * r * k, 0, Math.sin(a) * r * k); }
  else _rv.set(0, 0, 0);
  const pos = e.p.clone().add(_rv).add(new THREE.Vector3(...d.offset));
  let dir;
  if (d.dirMode === 'RAND') dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
  else {
    const el = THREE.MathUtils.degToRad(d.elev + rand(-1, 1) * d.elevVar), hd = THREE.MathUtils.degToRad(rand(-1, 1) * d.headVar);
    dir = new THREE.Vector3(Math.cos(el) * Math.cos(hd), Math.sin(el), Math.cos(el) * Math.sin(hd));
  }
  const life = Math.max(0.05, d.life + rand(-1, 1) * d.lifeVar);
  sys.parts.push({ pos, vel: dir.multiplyScalar(d.vel + rand(-1, 1) * d.velVar), age: 0, life });
}
function updatePfx(dt) {
  const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  for (const sys of pfxSystems) {
    const d = sys.d, grav = new THREE.Vector3(...d.gravity);
    // emit from the nearest emitters only
    const near = sys.emitters.filter(e => e.p.distanceToSquared(camera.position) < PFX_RANGE * PFX_RANGE);
    near.sort((a, b) => a.p.distanceToSquared(camera.position) - b.p.distanceToSquared(camera.position));
    for (const e of near.slice(0, PFX_MAX_EMITTERS)) { e.acc += d.pps * dt; while (e.acc >= 1 && sys.parts.length < sys.cap) { e.acc -= 1; pfxSpawn(sys, e); } }
    const P = sys.g.attributes.position.array, S = sys.g.attributes.size.array, C = sys.g.attributes.pcolor.array;
    let n = 0;
    for (let i = sys.parts.length - 1; i >= 0; i--) {
      const q = sys.parts[i]; q.age += dt;
      if (q.age >= q.life) { sys.parts[i] = sys.parts[sys.parts.length - 1]; sys.parts.pop(); continue; }
      q.vel.addScaledVector(grav, dt); q.pos.addScaledVector(q.vel, dt);
      const t = q.age / q.life, [c0, c1] = d.color;
      P[n * 3] = q.pos.x; P[n * 3 + 1] = q.pos.y; P[n * 3 + 2] = q.pos.z;
      S[n] = d.size[0] * (1 + (d.sizeEnd - 1) * t);
      C[n * 4] = c0[0] + (c1[0] - c0[0]) * t; C[n * 4 + 1] = c0[1] + (c1[1] - c0[1]) * t; C[n * 4 + 2] = c0[2] + (c1[2] - c0[2]) * t;
      C[n * 4 + 3] = (d.alpha[0] + (d.alpha[1] - d.alpha[0]) * t) * SKY_DIM_FX();
      n++;
    }
    sys.g.setDrawRange(0, n);
    for (const k of ['position', 'size', 'pcolor']) sys.g.attributes[k].needsUpdate = true;
    sys.mat.uniforms.scale.value = scale;
  }
}
const SKY_DIM_FX = () => 1; // (hook: flames are self-lit, so the weather doesn't dim them)

// ---------------------------------------------------------------- seats (chairs, benches, thrones)
// Gothic's mob seats: each slot (ZS_POS* node) is where the sitter stands and which way he faces. Sitting plays the
// human model's own clips: T_x_STAND_2_S0 -> T_x_S0_2_S1 -> S_x_S1 (seated); standing up plays them backwards.
// Their root carries the step back onto the seat, so it is drawn (base.kz) instead of moving the character.
const seatSlots = [];
for (const st of world.seats || []) for (const sl of st.slots) {
  const dir = new THREE.Vector2(sl.dir[0], sl.dir[1]);
  seatSlots.push({ kind: st.kind, name: st.kind === 'CHAIR' ? 'Chair' : st.kind === 'BENCH' ? 'Bench' : 'Throne', p: new THREE.Vector3(...sl.p),
    heading: Math.atan2(-dir.x, -dir.y), taken: null });
}
seatSlots.forEach(sl => (sl.pos = sl.p)); // the focus tag floats above .pos, like an NPC's
function sitClip(c, name, rev = false) {
  if (!c.play(name, { loop: false, rev, restart: true, blend: 0.15 })) return false;
  c.base.kz = 1; return true;
}
function sit(c, slot) {
  if (c.downed || c.act || c.drawing || c.drawn || slot.taken) return false;
  slot.taken = c; c.pos.copy(slot.p); c.heading = slot.heading; c.mv.f = c.mv.s = 0;
  c.act = { type: 'sit', id: ++actId, t: 0, phase: 'down0', slot, K: slot.kind };
  sitClip(c, `T_${slot.kind}_STAND_2_S0`); return true;
}
function standUp(c) {
  const a = c.act; if (!a || a.type !== 'sit' || a.phase === 'up1' || a.phase === 'up0') return;
  a.phase = 'up1'; sitClip(c, `T_${a.K}_S0_2_S1`, true);
}
function sitTick(c, a, dt) {
  if (a.phase === 'down0' && c.done()) { a.phase = 'down1'; sitClip(c, `T_${a.K}_S0_2_S1`); }
  else if (a.phase === 'down1' && c.done()) { a.phase = 'seated'; a.t = 0; c.play(`S_${a.K}_S1`, { loop: true, blend: 0.2 }); c.base.kz = 1; a.fidget = rand(5, 12); }
  else if (a.phase === 'seated') {
    if (c.base) c.base.kz = 1;
    if (a.K === 'CHAIR' && (a.fidget -= dt) < 0) { a.fidget = rand(6, 14); c.overlay(`R_CHAIR_RANDOM_${1 + Math.floor(Math.random() * 4)}`); }
  }
  else if (a.phase === 'up1' && c.done()) { a.phase = 'up0'; sitClip(c, `T_${a.K}_STAND_2_S0`, true); }
  else if (a.phase === 'up0' && c.done()) { a.slot.taken = null; c.act = null; c.play('S_RUN', { blend: 0.2 }); }
}
const isSeated = c => c.act && c.act.type === 'sit';
// idle NPCs whose post is at a seat start the scene sitting on it (Snaf's waypoint is on a bench): home is that seat
for (const n of npcs) {
  if (n.duty !== 'idle') continue;
  const sl = seatSlots.filter(x => !x.taken && x.p.distanceTo(n.home) < 2.5).sort((a, b) => a.p.distanceTo(n.home) - b.p.distanceTo(n.home))[0];
  if (sl) { n.home.copy(sl.p); n.pos.copy(sl.p); if (sit(n, sl)) n.sitT = rand(25, 45); }
}

// ---------------------------------------------------------------- HUD
function updateHud() {
  const p = player, f = p.focus || p.focusDoor, tag = $('ftag');
  if (f && !convo) {
    const v = f.pos.clone().setY(f.pos.y + 2.05).project(camera);
    if (v.z < 1 && v.z > 0) { tag.style.display = 'block'; tag.style.left = (v.x * 0.5 + 0.5) * innerWidth + 'px'; tag.style.top = (-v.y * 0.5 + 0.5) * innerHeight + 'px'; setText(tag, f === lockOn ? [['» ' + f.name + ' «', F10HI]] : f.name); }
    else tag.style.display = 'none';
  } else tag.style.display = 'none';
  // Gothic shows the focused opponent's health at the top while you fight
  const foe = f && f.cast && (p.drawn || f.hostile === p) ? f : null;
  $('ehp').style.display = foe ? 'block' : 'none';
  if (foe) { setText($('ehpn'), foe.name); $('ehpf').style.width = Math.max(0, (100 * foe.hp) / foe.maxHp) + '%'; }
  $('hpf').style.width = Math.max(0, (100 * p.hp) / p.maxHp) + '%';
  const gaitTxt = sneakOn ? 'sneaking' : walkOn !== !!(keys.ShiftLeft || keys.ShiftRight) ? 'walking' : '';
  const ammoTxt = p.ranged && p.drawn && p.mode === 'ranged' ? (p.ranged.kind === 'bow' ? 'Arrows ' : 'Bolts ') + p.ammo : '';
  setText($('gait'), [ammoTxt, gaitTxt].filter(Boolean).join('  ·  '));
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock(); let pivotY = null, hudT = 0;
function updateCamera(dt) {
  const p = player, h = p.heading + (scheme === 'modern' && keys.KeyR && !p.downed && !lockedUI ? Math.PI : 0); // R: look back
  const climbY = p.act && p.act.type === 'climb' ? p.rootY - STAND_Y : 0;
  const headY = p.pos.y + climbY + (p.downed ? 0.6 : p.gait === 'sneak' ? 1.25 : 1.6);
  pivotY = pivotY === null ? headY : pivotY + (headY - pivotY) * Math.min(1, dt * 10); // smooth steps, not turning
  const piv = new THREE.Vector3(p.pos.x, pivotY, p.pos.z);
  const dist = p.drawn ? 2.7 : 3.2;
  const off = new THREE.Vector3(Math.sin(h) * Math.cos(pitch), Math.sin(pitch), Math.cos(h) * Math.cos(pitch));
  const hit = segCast(piv, piv.clone().addScaledVector(off, dist + 0.3));
  const dd = hit === null ? dist : Math.max(0.3, Math.min(dist, hit - 0.3));
  camera.position.copy(piv).addScaledVector(off, dd);
  camera.lookAt(piv);
  if (window.__dbgCam) { camera.position.copy(window.__dbgCam.pos); camera.lookAt(window.__dbgCam.target); }
  sky.position.copy(camera.position); sky.material.uniforms.time.value = clock.elapsedTime;
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (paused) { if (rainGain) rainGain.gain.setTargetAtTime(0, actx.currentTime, 0.2); renderer.render(scene, camera); requestAnimationFrame(frame); return; } // world frozen behind the menu
  playerInput(dt);
  for (const n of npcs) n.hl = n === player.focus && !convo;
  for (const d of doors) d.hl = d === player.focusDoor && !convo;
  updatePfx(dt);
  updateDoors(dt); updateProjectiles(dt);
  for (const c of entities) nockTick(c);
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
  updateMusic(npcs.some(n => n.hostile === player && !n.downed), dt);
  updateCamera(dt);
  updateBarrier(dt); updateWeather(dt);
  const now = performance.now() * 0.001;
  for (const f of flames) { const k = f.flicker ? 0.82 + 0.12 * Math.sin(now * 11 + f.ph) + 0.06 * Math.random() : 1; f.pl.intensity = 8 * k; }
  if ((hudT += dt) > 0.05) { hudT = 0; updateHud(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
window.__game = {
  player, npcs, camera, scene, THREE, CLIPS, PIT, startDuel, jump, seatSlots, sit, standUp, pfxSystems, shoot, switchWeapon, projectiles, hitChance, story, openMenu, get convo() { return convo; }, barrierState: { flashes, bolts, barrier }, doors, useDoor, setWeather, wx, barrierFlash, findLedge, setScheme, toggleLock, get lockOn() { return lockOn; }, groundAt, setBrightness, get theme() { return theme; }, startAttack, parade, jumpBack, toggleWeapon, knockDown, actionInput, setStyle, hurt, tris: tris.length,
  get yaw() { return player.heading; }, set yaw(v) { player.heading = v; }, set pitch(v) { pitch = v; },
  set sneak(v) { sneakOn = v; },
};
if (params.has('auto')) { $('start').style.display = 'none'; started = true; startMusic(); }
frame();
