import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { sfx, unlockAudio } from './sfx.js';
import { Timer } from 'three/addons/misc/Timer.js';

const $ = (id) => document.getElementById(id);
const BASE = location.href.replace(/[^/]*(\?.*)?(#.*)?$/, '');
const TURNS = 12, CHOP_TIME = 4.0, BLOCK_BASE = 1.1;
const JOIN = (new URLSearchParams(location.search).get('join') || '').toUpperCase();
const IS_GUEST = !!JOIN; // guest screen in online remote mode: mirrors the host, relays 2P input
let BLOCK_WIN = BLOCK_BASE;
let guestConn = null, guestRtt = 0; // host side
function emit(ev, data = {}) { if (guestConn && guestConn.open) try { guestConn.send({ t: 'g', ev, ...data }); } catch (e) {} }
const DIRS = { L: '⬅️', T: '⬆️', R: '➡️' };

// ---------------- Three.js scene ----------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe3ff, 30, 80);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
const camHome = new THREE.Vector3(0, 2.6, 7.4), camLook = new THREE.Vector3(0, 1.25, 0);
camera.position.copy(camHome);

// sky dome gradient
{
  const g = new THREE.SphereGeometry(120, 32, 16);
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4aa3f0) }, bot: { value: new THREE.Color(0xfff1d0) } },
    vertexShader: 'varying vec3 p;void main(){p=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform vec3 top,bot;varying vec3 p;void main(){gl_FragColor=vec4(mix(bot,top,smoothstep(-.05,.5,p.y)),1.);}' });
  scene.add(new THREE.Mesh(g, m));
}
scene.add(new THREE.HemisphereLight(0xdff1ff, 0x6b5a3a, 1.3));
const sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
sun.position.set(6, 12, 7); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
function add(geo, mat, x, y, z, cast = true) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; scene.add(m); return m; }

// ground
{
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#7cc35a'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) { x.fillStyle = `hsl(${95 + Math.random() * 25},${45 + Math.random() * 20}%,${38 + Math.random() * 18}%)`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 4); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30); t.colorSpace = THREE.SRGBColorSpace;
  const g = add(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }), 0, 0, 0, false);
  g.rotation.x = -Math.PI / 2;
}
// arena: stone platform with tiles
{
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#c9b48a'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = `hsl(38,${25 + Math.random() * 15}%,${62 + Math.random() * 12}%)`; x.fillRect(i * 64 + 3, j * 64 + 3, 58, 58); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  add(new THREE.CylinderGeometry(4.6, 4.9, 0.4, 48), [std(0x9c8a6a), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }), std(0x9c8a6a)], 0, 0.2, 0);
  const ring = add(new THREE.TorusGeometry(4.6, 0.12, 8, 64), std(0xffd54a, { metalness: 0.4, roughness: 0.4 }), 0, 0.41, 0, false); ring.rotation.x = Math.PI / 2;
  // center line
  const ln = add(new THREE.BoxGeometry(0.08, 0.02, 6), std(0xffffff), 0, 0.41, 0, false);
}
// torii-style gate behind, banners, trees, rocks, mountains
{
  const red = std(0xd9412b), dark = std(0x3a2a20);
  add(new THREE.CylinderGeometry(0.25, 0.3, 5, 12), red, -3.8, 2.5, -6); add(new THREE.CylinderGeometry(0.25, 0.3, 5, 12), red, 3.8, 2.5, -6);
  add(new THREE.BoxGeometry(9.6, 0.5, 0.6), dark, 0, 5.2, -6); add(new THREE.BoxGeometry(8.6, 0.35, 0.45), red, 0, 4.4, -6);
  add(new THREE.BoxGeometry(1.4, 0.8, 0.2), std(0xffe08a), 0, 4.75, -5.7);
  for (const [s, col] of [[-1, 0x3b82f6], [1, 0xef4444]]) {
    add(new THREE.CylinderGeometry(0.06, 0.06, 4, 8), dark, s * 5.5, 2, -2.5);
    const flag = add(new THREE.PlaneGeometry(1, 2.2, 6, 6), std(col, { side: THREE.DoubleSide }), s * 5.5 + 0.52 * -s, 2.8, -2.5);
    flag.userData.flag = true; flag.userData.s = s;
    // lanterns
    const lan = add(new THREE.SphereGeometry(0.35, 16, 12), std(0xffb347, { emissive: 0xff7a00, emissiveIntensity: 0.6 }), s * 4.8, 1.0, 2.2);
    add(new THREE.CylinderGeometry(0.08, 0.1, 0.8, 8), dark, s * 4.8, 0.4, 2.2);
    const pl = new THREE.PointLight(0xffa040, 4, 6); pl.position.set(s * 4.8, 1.2, 2.2); scene.add(pl);
  }
  const trunk = std(0x7a5232), leaf = [std(0x3f9b3a), std(0x58b947), std(0xf2a7c3)];
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 40; i++) {
    const a = rnd(0, Math.PI * 2), r = rnd(9, 30); const x = Math.cos(a) * r, z = Math.sin(a) * r - 4;
    if (z > 5 && Math.abs(x) < 8) continue;
    const s = rnd(0.8, 1.6);
    add(new THREE.CylinderGeometry(0.15 * s, 0.22 * s, 1.4 * s, 6), trunk, x, 0.7 * s, z);
    const L = leaf[i % 7 === 0 ? 2 : i % 2];
    add(new THREE.IcosahedronGeometry(1 * s, 0), L, x, 1.9 * s, z); add(new THREE.IcosahedronGeometry(0.7 * s, 0), L, x + 0.4 * s, 2.4 * s, z + 0.2);
  }
  for (let i = 0; i < 14; i++) { const r = add(new THREE.DodecahedronGeometry(rnd(0.2, 0.6), 0), std(0x8d8d8d), rnd(-14, 14), 0.2, rnd(-12, -6)); r.rotation.set(rnd(0, 3), rnd(0, 3), 0); }
  for (let i = 0; i < 9; i++) { const h = rnd(10, 22); const m = add(new THREE.ConeGeometry(rnd(8, 14), h, 7), std(i % 2 ? 0x6f8fb3 : 0x7b9cc0, { flatShading: true }), -50 + i * 12.5, h / 2 - 1, -55 - rnd(0, 10), false); const cap = add(new THREE.ConeGeometry(m.geometry.parameters.radius * 0.3, h * 0.3, 7), std(0xffffff, { flatShading: true }), m.position.x, h * 0.85 - 1, m.position.z, false); }
  // clouds
  for (let i = 0; i < 8; i++) { const g = new THREE.Group(); for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(rnd(1, 2), 12, 8), new THREE.MeshLambertMaterial({ color: 0xffffff })); s.position.set(k * 1.5, rnd(-0.3, 0.3), 0); g.add(s); } g.position.set(rnd(-40, 40), rnd(14, 22), rnd(-50, -25)); g.userData.cloud = rnd(0.3, 0.8); scene.add(g); }
}

// particles
const parts = [];
function burst(pos, color, n = 24, speed = 4, size = 0.08, star = false) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(star ? new THREE.OctahedronGeometry(size * 1.6) : new THREE.SphereGeometry(size, 6, 4), new THREE.MeshBasicMaterial({ color: Array.isArray(color) ? color[i % color.length] : color, transparent: true }));
    m.position.copy(pos);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
    parts.push({ m, v, life: 1 }); scene.add(m);
  }
}
function updParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life -= dt * 1.2; p.v.y -= 9 * dt; p.m.position.addScaledVector(p.v, dt); p.m.rotation.x += dt * 5; p.m.material.opacity = Math.max(0, p.life); if (p.life <= 0 || p.m.position.y < 0) { scene.remove(p.m); parts.splice(i, 1); } }
}
// stars circling the head on hit
const dizzy = new THREE.Group(); for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshBasicMaterial({ color: 0xffe14a })); s.position.set(Math.cos(i * 1.57) * 0.45, 0, Math.sin(i * 1.57) * 0.45); dizzy.add(s); } dizzy.visible = false; scene.add(dizzy);

// ---------------- characters ----------------
const fighters = {};
async function loadFighters() {
  const loader = new GLTFLoader();
  const [k, b] = await Promise.all(['assets/models/Knight.glb', 'assets/models/Barbarian.glb'].map((u) => loader.loadAsync(u)));
  const swordSrc = k.scene.getObjectByName('1H_Sword');
  const mk = (g, p, keep) => {
    const root = g.scene;
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    for (const slot of ['handslot.r', 'handslot.l']) { const s = root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(slot)); s.children.forEach((c) => (c.visible = keep.includes(c.name))); }
    return root;
  };
  const kroot = mk(k, 1, ['1H_Sword', 'Round_Shield']);
  const broot = mk(b, 2, ['Barbarian_Round_Shield']);
  const sw = swordSrc.clone(); sw.visible = true; broot.getObjectByName('handslotr').add(sw);
  for (const [p, g, root, x] of [[1, k, kroot, -1.6], [2, b, broot, 1.6]]) {
    root.position.set(x, 0.4, 0); root.rotation.y = p === 1 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const clips = {}; g.animations.forEach((c) => (clips[c.name] = c));
    const f = { p, root, mixer, clips, cur: null, baseX: x, lunge: 0 };
    f.play = (name, { once = false, fade = 0.15, speed = 1 } = {}) => {
      const a = mixer.clipAction(clips[name]);
      a.reset(); a.timeScale = speed; a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = once;
      if (f.cur && f.cur !== a) f.cur.crossFadeTo(a, fade, false);
      a.play(); f.cur = a; f.curName = name;
    };
    mixer.addEventListener('finished', (e) => { if (e.action === f.cur && !f.hold) f.play(state.phase === 'over' ? 'Idle' : '2H_Melee_Idle'); });
    f.play('2H_Melee_Idle');
    fighters[p] = f;
  }
}

// ---------------- game state ----------------
const state = { phase: 'lobby', mode: 'phone', turn: 0, attacker: 1, score: { 1: 0, 2: 0 }, t: 0, chopDir: null, conn: { 1: false, 2: false }, room: '', log: [] };
window.__game = state;
const other = (p) => (p === 1 ? 2 : 1);

function setBanner(txt, ms = 1000, color = '#fff') { const b = $('banner'); b.textContent = txt; b.style.color = color; b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; clearTimeout(setBanner.t); if (ms) setBanner.t = setTimeout(() => b.classList.add('hidden'), ms); }
function hud() {
  $('s1').textContent = state.score[1]; $('s2').textContent = state.score[2];
  $('turn').textContent = `${Math.min(state.turn + 1, TURNS)}/${TURNS}`;
  $('r1').textContent = state.attacker === 1 ? '⚔️' : '🛡️'; $('r2').textContent = state.attacker === 2 ? '⚔️' : '🛡️';
}
function broadcast() { for (const p of [1, 2]) send(p, { t: 'state', role: state.attacker === p ? 'atk' : 'def', phase: state.phase, score: [state.score[1], state.score[2]], turn: state.turn, turns: TURNS }); }

function startMatch() {
  unlockAudio(); emit('start');
  BLOCK_WIN = state.mode === 'remote' ? BLOCK_BASE + 0.15 + Math.min(0.25, guestRtt / 2000) : BLOCK_BASE;
  state.turn = 0; state.score = { 1: 0, 2: 0 }; state.attacker = 1; state.log = [];
  $('lobby').classList.add('hidden'); $('result').classList.add('hidden'); $('hud').classList.remove('hidden');
  touchFor();
  for (const p of [1, 2]) { fighters[p].hold = false; fighters[p].play('2H_Melee_Idle'); }
  sfx.gong();
  setBanner('準備！', 1200, '#ffd54a');
  nextTurn(1.4);
}
function nextTurn(delay = 0) {
  state.phase = 'wait'; state.t = delay; hud(); broadcast(); touchFor();
}
function beginChopWindow() {
  emit('chopwin');
  state.phase = 'chop'; state.t = CHOP_TIME; state.chopDir = null; state.early = { 1: 0, 2: 0 };
  hud(); broadcast();
  setBanner(state.attacker === 1 ? '🛡️ ⚔️ 劈！' : '🪓 ⚔️ 劈！', 900, state.attacker === 1 ? '#7fb2ff' : '#ff8a8a');
  sfx.tick();
}
const ATK_CLIP = { L: '1H_Melee_Attack_Slice_Diagonal', R: '1H_Melee_Attack_Slice_Horizontal', T: '1H_Melee_Attack_Chop' };
function doChop(dir) {
  emit('chop', { dir, win: BLOCK_WIN });
  const a = fighters[state.attacker];
  state.phase = 'block'; state.chopDir = dir; state.t = BLOCK_WIN; state.blockDir = null;
  a.play(ATK_CLIP[dir], { once: true, speed: 0.75 }); a.lunge = 1;
  sfx.whoosh();
  // telegraph arrow above attacker
  const ar = $('arrow'); ar.textContent = DIRS[dir]; ar.classList.remove('hidden'); ar.style.animation = 'none'; void ar.offsetWidth; ar.style.animation = '';
  state.arrowP = state.attacker;
  broadcast(); send(other(state.attacker), { t: 'incoming', dir });
}
function input(p, dir, src = 'key') {
  if (IS_GUEST) { if (hostConn && hostConn.open) hostConn.send({ t: 'act', dir, src: 'guest-' + src }); return; }
  state.log.push({ p, dir, src, phase: state.phase });
  if (state.phase === 'chop' && p === state.attacker) return doChop(dir);
  if (state.phase === 'chop' && p !== state.attacker) { state.early[p] = 0.35; return; } // early block ignored
  if (state.phase === 'block' && p !== state.attacker && !state.blockDir) { resolve(dir); }
}
function resolve(blockDir) {
  emit('res', { blockDir: blockDir || null });
  const A = state.attacker, D = other(A); const a = fighters[A], d = fighters[D];
  state.blockDir = blockDir || null;
  const ok = blockDir === state.chopDir;
  $('arrow').classList.add('hidden');
  state.phase = 'result'; state.t = 1.6;
  const hit = new THREE.Vector3(0, 1.4, 0.2);
  if (ok) {
    state.score[D]++; d.play('Block', { once: true }); sfx.clang(); burst(hit, [0xffffff, 0xffe14a, 0xffa500], 36, 5, 0.06);
    setBanner('🛡️ 擋到！+1', 1300, D === 1 ? '#7fb2ff' : '#ff8a8a'); state.shake = 0.25;
    send(D, { t: 'fx', kind: 'good' }); send(A, { t: 'fx', kind: 'bad' });
  } else {
    state.score[A]++; d.play('Hit_A', { once: true }); sfx.bonk();
    burst(new THREE.Vector3(d.baseX, 2.1, 0), [0xffe14a, 0xffffff], 14, 3, 0.07, true);
    dizzy.visible = true; dizzy.userData.p = D; dizzy.userData.t = 1.4;
    setBanner(blockDir ? '❌ 方向錯！' : '💥 中招！', 1300, A === 1 ? '#7fb2ff' : '#ff8a8a'); state.shake = 0.15;
    send(A, { t: 'fx', kind: 'good' }); send(D, { t: 'fx', kind: 'bad' });
  }
  hud(); broadcast();
}
function afterResult() {
  emit('next');
  state.turn++;
  if (state.turn >= TURNS) return IS_GUEST ? null : endMatch();
  state.attacker = other(state.attacker);
  setBanner('🔄', 600);
  nextTurn(0.7);
}
function endMatch() {
  emit('over');
  state.phase = 'over'; hud(); broadcast();
  const s = state.score; const w = s[1] > s[2] ? 1 : s[2] > s[1] ? 2 : 0;
  for (const p of [1, 2]) { fighters[p].hold = true; fighters[p].play(w === 0 || w === p ? 'Cheer' : 'Sit_Floor_Down', { once: w !== p && w !== 0 }); }
  sfx.fanfare();
  burst(new THREE.Vector3(w ? fighters[w].baseX : 0, 2.5, 0), [0xff4d4d, 0x4da6ff, 0xffe14a, 0x5cd65c, 0xff66cc], 120, 7, 0.07);
  $('winner').textContent = w === 0 ? '🤝 平手！' : (w === 1 ? '🛡️ 1P 勝利！🏆' : '🪓 2P 勝利！🏆');
  $('f1').textContent = s[1]; $('f2').textContent = s[2];
  setTimeout(() => { $('result').classList.remove('hidden'); $('touch').classList.add('hidden'); }, 1200);
  for (const p of [1, 2]) send(p, { t: 'over', win: w === p, draw: w === 0 });
}

// ---------------- input: keyboard + touch ----------------
const KEYS = { a: [1, 'L'], s: [1, 'T'], d: [1, 'R'], j: [2, 'L'], k: [2, 'T'], l: [2, 'R'], w: [1, 'T'], i: [2, 'T'] };
addEventListener('keydown', (e) => { const k = KEYS[e.key.toLowerCase()]; if (k && !e.repeat) input(state.mode === 'remote' && !IS_GUEST ? 1 : k[0], k[1], 'key'); if (e.key === 'Enter' && state.phase === 'lobby') $('start').onclick(); });
document.querySelectorAll('#touch button').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); unlockAudio(); input(+b.dataset.p, b.dataset.d, 'touch'); }));

// ---------------- networking (PeerJS) ----------------
let peer = null; const conns = { 1: null, 2: null }, lastSeen = { 1: 0, 2: 0 };
function send(p, msg) { const c = conns[p]; if (c && c.open) try { c.send(msg); } catch (e) {} }
function makeCode() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }
function qr(el, url) { const q = qrcode(0, 'M'); q.addData(url); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); el.title = url; }
function setDot(p, on) { state.conn[p] = on; $('d' + p).classList.toggle('on', on); }
function startPeer() {
  const qs = new URLSearchParams(location.search);
  let code = qs.get('room') || sessionStorage.getItem('sdr-room') || makeCode();
  code = code.toUpperCase(); sessionStorage.setItem('sdr-room', code);
  state.room = code; $('roomcode').textContent = code;
  for (const p of [1, 2]) qr($('qr' + p), `${BASE}controller.html?room=${code}&p=${p}`);
  const share = `${BASE}index.html?join=${code}`; qr($('qrShare'), share); $('shareLink').textContent = share; $('shareLink').href = share;
  peer = new Peer('sdr-' + code, { debug: 0 });
  peer.on('open', () => { $('netst').textContent = '🟢'; state.peerOpen = true; });
  peer.on('connection', (c) => {
    c.on('open', () => {});
    c.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello' && m.screen) { if (guestConn && guestConn !== c) try { guestConn.close(); } catch (e) {} guestConn = c; c._guest = true; document.querySelectorAll('#dg,#dgH').forEach((x)=>x.classList.add('on')); sfx.ding(); c.send({ t: 'snap', ...snap(), sync: true }); return; }
      if (c._guest) {
        if (m.t === 'gpr') { guestRtt = performance.now() - m.ts; $('ping').textContent = '📶 ' + Math.round(guestRtt) + 'ms'; }
        if (m.t === 'act' && 'LTR'.includes(m.dir)) input(2, m.dir, m.src);
        if (m.t === 'start' && (state.phase === 'lobby' || state.phase === 'over')) startMatch();
        return;
      }
      if (m.t === 'hello') { const p = m.p === 2 ? 2 : 1; if (conns[p] && conns[p] !== c) try { conns[p].close(); } catch (e) {} conns[p] = c; c._p = p; lastSeen[p] = performance.now(); setDot(p, true); sfx.ding(); broadcast(); return; }
      const p = c._p; if (!p) return; lastSeen[p] = performance.now();
      if (m.t === 'act' && 'LTR'.includes(m.dir)) input(p, m.dir, m.src || 'phone');
      if (m.t === 'start' && (state.phase === 'lobby' || state.phase === 'over')) startMatch();
    });
    c.on('close', () => { if (c === guestConn) { guestConn = null; document.querySelectorAll('#dg,#dgH').forEach((x)=>x.classList.remove('on')); $('ping').textContent = '📶 ❌'; } if (c._p && conns[c._p] === c) { conns[c._p] = null; setDot(c._p, false); } });
    c.on('error', () => {});
  });
  peer.on('disconnected', () => { $('netst').textContent = '🟠'; setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 1500); });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { sessionStorage.removeItem('sdr-room'); const u = new URL(location.href); u.searchParams.delete('room'); history.replaceState(null, '', u); peer.destroy(); setTimeout(startPeer, 300); return; }
    $('netst').textContent = '🔴'; console.warn('peer', e.type);
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) setTimeout(() => { if (peer.destroyed) startPeer(); else try { peer.reconnect(); } catch (x) {} }, 3000);
  });
}
setInterval(() => { const now = performance.now(); for (const p of [1, 2]) { if (conns[p] && now - lastSeen[p] > 7000) { setDot(p, false); } else if (conns[p] && conns[p].open) setDot(p, true); send(p, { t: 'ping' }); } }, 2000);

// ---------------- lobby UI ----------------
$('mPhone').onclick = () => { state.mode = 'phone'; $('mPhone').classList.add('on'); $('mLocal').classList.remove('on'); $('phonePane').classList.remove('hidden'); $('localPane').classList.add('hidden'); };
function setMode(m) {
  state.mode = m;
  for (const [id, mm] of [['mPhone', 'phone'], ['mLocal', 'local'], ['mRemote', 'remote']]) $(id).classList.toggle('on', m === mm);
  $('phonePane').classList.toggle('hidden', m === 'local'); $('localPane').classList.toggle('hidden', m !== 'local');
  $('remotePane').classList.toggle('hidden', m !== 'remote'); $('qrcard2').classList.toggle('hidden', m === 'remote');
  $('ping').classList.toggle('hidden', m !== 'remote'); document.body.classList.toggle('remote', m === 'remote'); $('qrcardS').classList.toggle('hidden', m !== 'remote' || IS_GUEST);
}
function touchFor() { const on = state.mode === 'local' || state.mode === 'remote'; $('touch').classList.toggle('hidden', !on || state.phase === 'lobby' || state.phase === 'over');
  document.querySelector('#touch .half.p1').style.visibility = state.mode === 'remote' && IS_GUEST ? 'hidden' : 'visible';
  document.querySelector('#touch .half.p2').style.visibility = state.mode === 'remote' && !IS_GUEST ? 'hidden' : 'visible'; }
$('mRemote').onclick = () => setMode('remote');
$('mPhone').onclick = () => setMode('phone');
$('mLocal').onclick = () => setMode('local');
const startBtn = () => { if (IS_GUEST) { unlockAudio(); hostConn && hostConn.open && hostConn.send({ t: 'start' }); } else startMatch(); };
$('start').onclick = startBtn; $('again').onclick = startBtn;
$('toLobby').onclick = () => { if (IS_GUEST) return; emit('lobby'); toLobbyView(); };
function toLobbyView() { state.phase = 'lobby'; touchFor(); $('result').classList.add('hidden'); $('hud').classList.add('hidden'); $('lobby').classList.remove('hidden'); for (const p of [1, 2]) { fighters[p].hold = false; fighters[p].play('2H_Melee_Idle'); } broadcast(); }
if (new URLSearchParams(location.search).get('mode') === 'local') $('mLocal').onclick();

// ---------------- loop ----------------
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 1 ? 62 : 42; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const timer = new Timer(); let tAcc = 0;
const tmp = new THREE.Vector3();
renderer.setAnimationLoop((ts) => {
  timer.update(ts); const dt = Math.min(timer.getDelta(), 0.05); tAcc += dt;
  for (const p of [1, 2]) { const f = fighters[p]; if (!f) continue; f.mixer.update(dt); f.lunge = Math.max(0, f.lunge - dt * 1.4); const dirx = p === 1 ? 1 : -1; f.root.position.x = f.baseX + dirx * Math.sin(Math.min(1, f.lunge) * Math.PI) * 0.35; }
  // phases
  if (IS_GUEST) { if (state.t > 0) state.t -= dt; if (state.phase === 'chop') $('timerfill').style.width = (100 * state.t / CHOP_TIME) + '%'; if (state.phase === 'block') $('timerfill').style.width = (100 * state.t / BLOCK_WIN) + '%'; }
  else if (state.phase === 'wait') { state.t -= dt; if (state.t <= 0) beginChopWindow(); }
  else if (state.phase === 'chop') { state.t -= dt; $('timerfill').style.width = (100 * state.t / CHOP_TIME) + '%'; if (state.t <= 0) doChop('LTR'[Math.floor(Math.random() * 3)]); }
  else if (state.phase === 'block') { state.t -= dt; $('timerfill').style.width = (100 * state.t / BLOCK_WIN) + '%'; if (state.t <= 0) resolve(null); }
  else if (state.phase === 'result') { state.t -= dt; if (state.t <= 0) afterResult(); }
  // arrow follows attacker head
  if (!$('arrow').classList.contains('hidden') && fighters[state.arrowP]) { tmp.set(fighters[state.arrowP].baseX * 0.6, 2.7, 0).project(camera); const ar = $('arrow'); ar.style.left = ((tmp.x + 1) / 2 * innerWidth) + 'px'; ar.style.top = ((1 - tmp.y) / 2 * innerHeight) + 'px'; }
  if (dizzy.visible) { dizzy.userData.t -= dt; const f = fighters[dizzy.userData.p]; dizzy.position.set(f.root.position.x, 2.25, 0); dizzy.rotation.y += dt * 6; if (dizzy.userData.t <= 0) dizzy.visible = false; }
  updParts(dt);
  scene.traverse((o) => { if (o.userData.flag) { const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, Math.sin(tAcc * 3 + x * 3 + o.userData.s) * 0.12 * (x + 0.5)); } pos.needsUpdate = true; } if (o.userData.cloud) o.position.x += o.userData.cloud * dt; });
  // camera: gentle sway + shake
  const sh = state.shake || 0; state.shake = Math.max(0, sh - dt);
  const orbit = state.phase === 'lobby' ? Math.sin(tAcc * 0.25) * 2.5 : Math.sin(tAcc * 0.3) * 0.4;
  camera.position.set(camHome.x + orbit + (Math.random() - 0.5) * sh, camHome.y + (Math.random() - 0.5) * sh, camHome.z);
  camera.lookAt(camLook);
  renderer.render(scene, camera);
});

loadFighters().then(() => { $('loading').remove(); state.ready = true; }).catch((e) => { console.error(e); $('loading').textContent = '⚠️ ' + e.message; });

// ---------------- online remote mode ----------------
function snap() { return { phase: state.phase, turn: state.turn, attacker: state.attacker, score: state.score, conn: state.conn, rtt: guestRtt, win: BLOCK_WIN }; }
setInterval(() => { if (!guestConn || !guestConn.open) return; emit('ping'); try { guestConn.send({ t: 'gping', ts: performance.now() }); guestConn.send({ t: 'snap', ...snap() }); } catch (e) {} }, 1000);
setInterval(() => { if (guestConn && guestConn.open) try { guestConn.send({ t: 'snap', ...snap() }); } catch (e) {} }, 250);
let hostConn = null, hostPeer = null, hostRetry = null, hostLast = 0;
function startGuest() {
  state.mode = 'remote'; state.room = JOIN;
  document.body.classList.add('guest');
  $('mPhone').classList.add('hidden'); $('mLocal').classList.add('hidden'); setMode('remote');
  $('remoteHost').classList.add('hidden'); $('remoteGuest').classList.remove('hidden');
  $('qrcard1').classList.add('hidden'); $('qrcard2').classList.remove('hidden');
  $('roomcode').textContent = JOIN;
  qr($('qr2'), `${BASE}controller.html?room=${JOIN}&p=2`);
  const go = () => {
    clearTimeout(hostRetry);
    if (!hostPeer || hostPeer.destroyed) {
      hostPeer = new Peer({ debug: 0 });
      hostPeer.on('open', () => { state.peerOpen = true; $('netst').textContent = '🟢'; go(); });
      hostPeer.on('disconnected', () => { try { hostPeer.reconnect(); } catch (e) {} });
      hostPeer.on('error', (e) => { console.warn('guest peer', e.type); setHost(false); hostRetry = setTimeout(() => { if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) { try { hostPeer.destroy(); } catch (x) {} hostPeer = null; } go(); }, 2000); });
      return;
    }
    if (!hostPeer.open) return;
    const c = hostPeer.connect('sdr-' + JOIN, { reliable: true }); hostConn = c;
    c.on('open', () => { if (hostConn !== c) return; c.send({ t: 'hello', screen: true }); hostLast = Date.now(); setHost(true); });
    c.on('data', onHostMsg);
    c.on('close', () => { if (hostConn !== c) return; setHost(false); hostRetry = setTimeout(go, 1500); });
  };
  setInterval(() => { if (state.hostOk && Date.now() - hostLast > 6000) { setHost(false); try { hostConn.close(); } catch (e) {} hostConn = null; go(); } }, 2000);
  go();
}
function setHost(v) { state.hostOk = v; document.querySelectorAll('#dg,#dgH').forEach((x)=>x.classList.toggle('on', v)); if (!v) $('ping').textContent = '📶 ❌'; }
function onHostMsg(m) {
  hostLast = Date.now();
  if (m.t === 'gping') { hostConn.send({ t: 'gpr', ts: m.ts }); return; }
  if (m.t === 'snap') {
    $('ping').textContent = '📶 ' + Math.round(m.rtt || 0) + 'ms';
    for (const p of [1, 2]) setDot(p, !!m.conn[p]);
    if (m.win) BLOCK_WIN = m.win;
    const inMatch = !['lobby', 'over'].includes(m.phase);
    if (m.sync || (inMatch && state.phase === 'lobby')) { // (re)joined mid-match: jump to host state
      if (inMatch) { $('lobby').classList.add('hidden'); $('result').classList.add('hidden'); $('hud').classList.remove('hidden'); }
      state.phase = m.phase === 'block' ? 'wait' : m.phase;
    }
    state.score = { 1: m.score[1], 2: m.score[2] }; state.turn = m.turn; state.attacker = m.attacker; if (inMatch) { hud(); touchFor(); }
    return;
  }
  if (m.t !== 'g') return;
  switch (m.ev) {
    case 'start': startMatch(); break;
    case 'chopwin': beginChopWindow(); break;
    case 'chop': BLOCK_WIN = m.win || BLOCK_WIN; doChop(m.dir); break;
    case 'res': if (state.phase !== 'block') { state.chopDir = state.chopDir || 'T'; } resolve(m.blockDir); break;
    case 'next': afterResult(); break;
    case 'over': endMatch(); break;
    case 'lobby': toLobbyView(); break;
  }
}

if (IS_GUEST) startGuest(); else startPeer();
