(() => {
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  let room = (qs.get('room') || '').toUpperCase(), P = qs.get('p') === '2' ? 2 : 1;
  const S = { role: null, phase: 'lobby', connected: false, sent: [] };
  window.__ctl = S;
  let peer = null, conn = null, lastMsg = 0, retry = null;

  function ui() {
    document.body.className = 'p' + P;
    $('me').textContent = P === 1 ? '1P 🛡️' : '2P 🪓';
    $('conn').textContent = S.connected ? '🟢' : '🔴';
    const atk = S.role === 'atk';
    $('role').textContent = S.phase === 'over' ? (S.win ? '🏆' : S.draw ? '🤝' : '💪') : !S.connected ? '⏳' : S.phase === 'lobby' ? '✅' : atk ? '⚔️' : '🛡️';
    $('roleTxt').textContent = S.phase === 'over' ? (S.win ? '勝利！' : S.draw ? '平手' : '加油！') : !S.connected ? '連接中…' : S.phase === 'lobby' ? '已連接' : atk ? '你劈！' : '你擋！';
    $('calib').classList.toggle('hidden', !(S.phase === 'lobby' || S.phase === 'over')); $('score').classList.toggle('hidden', S.phase === 'lobby');
    $('startBtn').classList.toggle('hidden', !(S.connected && (S.phase === 'lobby' || S.phase === 'over')));
    if (S.score) $('score').textContent = `🛡️ ${S.score[0]} : ${S.score[1]} 🪓`;
  }
  function vib(ms) { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

  function connect() {
    clearTimeout(retry);
    if (!room) { $('overlay').classList.remove('hidden'); return; }
    if (!peer || peer.destroyed) {
      peer = new Peer({ debug: 0 });
      peer.on('open', openConn);
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
      peer.on('error', (e) => { S.lastErr = e.type; if (e.type === 'peer-unavailable') { setConnected(false); retry = setTimeout(openConn, 2000); } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) { setConnected(false); retry = setTimeout(() => { try { peer.destroy(); } catch (x) {} peer = null; connect(); }, 2500); } });
    } else if (peer.open) openConn();
  }
  function openConn() {
    clearTimeout(retry);
    if (conn) try { conn.close(); } catch (e) {}
    const c = peer.connect('sdr-' + room, { reliable: true });
    conn = c;
    c.on('open', () => { if (conn !== c) return; setConnected(true); c.send({ t: 'hello', p: P }); lastMsg = Date.now(); });
    c.on('data', onData);
    c.on('close', () => { if (conn !== c) return; setConnected(false); retry = setTimeout(openConn, 1500); });
    c.on('error', () => {});
  }
  function setConnected(v) { S.connected = v; ui(); }
  function onData(m) {
    lastMsg = Date.now();
    if (m.t === 'state') { const changed = m.role !== S.role || m.phase !== S.phase; Object.assign(S, { role: m.role, phase: m.phase, score: m.score }); if (m.phase !== 'block') $('incoming').textContent = ''; if (changed && m.phase === 'chop') vib(m.role === 'atk' ? 60 : 0); ui(); }
    if (m.t === 'incoming') { $('incoming').textContent = '❗'; vib([40, 30, 40]); S.phase = 'block'; S.onIncoming && S.onIncoming(); }
    if (m.t === 'fx') { document.body.classList.remove('good', 'bad'); void document.body.offsetWidth; document.body.classList.add(m.kind); vib(m.kind === 'bad' ? 200 : 50); }
    if (m.t === 'over') { S.phase = 'over'; S.win = m.win; S.draw = m.draw; ui(); vib(m.win ? [100, 50, 100, 50, 300] : 100); }
  }
  // heartbeat / watchdog
  setInterval(() => {
    if (conn && conn.open) { try { conn.send({ t: 'ping' }); } catch (e) {} }
    if (S.connected && Date.now() - lastMsg > 7000) { setConnected(false); openConn(); }
  }, 2000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !S.connected) connect(); });

  let lastAct = 0;
  function act(dir, src) {
    const now = Date.now(); if (now - lastAct < 350) return; lastAct = now;
    S.sent.push({ dir, src, t: now });
    if (src !== 'btn') { const c = $('lastSwing'); c.textContent = ({ L: '⬅️', T: '⬆️', R: '➡️' })[dir]; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
    if (conn && conn.open) conn.send({ t: 'act', dir, src });
    const fx = $('swingFx'); fx.textContent = S.role === 'atk' ? '⚔️' : '🛡️'; fx.classList.remove('show'); void fx.offsetWidth; fx.classList.add('show');
    const b = $('b' + dir); b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 150);
    vib(30);
  }
  document.querySelectorAll('#pad button').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); act(b.dataset.d, 'btn'); }));
  $('startBtn').onclick = () => conn && conn.open && conn.send({ t: 'start' });

  // ---- motion: real arm swings (forgiving for kids) ----
  // Swing = big burst of linear acceleration OR fast rotation. Direction from the dominant axis over the
  // first ~120 ms of the swing (sideways = ⬅️/➡️, downward chop = ⬆️). Guard = phone raised and held steady
  // in a pose (tilt left / upright / tilt right) when the chop arrives.
  const SENS = { 1: 1.35, 2: 1, 3: 0.7 }; let sens = +(localStorage.getItem('sdr-sens') || 2);
  let grav = null, motionOn = false, cool = 0, win = null, steadyMs = 0, lastT = 0, ori = { beta: 0, gamma: 0 }, level = 0;
  S.guard = null; S.swings = 0;
  function poseDir() {
    const { beta, gamma } = ori; // beta: front/back tilt (90 = upright), gamma: left/right tilt
    if (Math.abs(gamma) > 28) return gamma < 0 ? 'L' : 'R';
    if (beta > 50) return 'T';
    return null; // flat in the lap = no guard
  }
  addEventListener('deviceorientation', (e) => { if (e.beta != null) ori = { beta: e.beta, gamma: e.gamma }; });
  function onMotion(e) {
    const now = performance.now(), dt = lastT ? Math.min(100, now - lastT) : 16; lastT = now;
    const a = e.acceleration && e.acceleration.x != null ? e.acceleration : null;
    let x, y, z;
    if (a) { x = a.x; y = a.y; z = a.z; } else { // no gravity-free data: high-pass filter the raw signal (works on both iOS/Android sign conventions)
      const g = e.accelerationIncludingGravity || {}; const gx = g.x || 0, gy = g.y || 0, gz = g.z || 0;
      grav = grav ? [grav[0] * 0.85 + gx * 0.15, grav[1] * 0.85 + gy * 0.15, grav[2] * 0.85 + gz * 0.15] : [gx, gy, gz];
      x = gx - grav[0]; y = gy - grav[1]; z = gz - grav[2]; }
    const r = e.rotationRate || {}; const ra = r.alpha || 0, rb = r.beta || 0, rg = r.gamma || 0;
    const acc = Math.hypot(x, y, z), rot = Math.hypot(ra, rb, rg);
    const k = SENS[sens];
    const power = Math.max(acc / (9 * k), rot / (220 * k)); // 1.0 = swing
    level = Math.max(power, level * 0.9); meter(level);
    // steadiness for guard
    if (acc < 2.5 && rot < 40) steadyMs += dt; else steadyMs = 0;
    S.guard = steadyMs > 150 ? poseDir() : null; S.guardAt = now; guardUI();
    if (win) { // collecting direction evidence
      win.h += Math.abs(x) * 1.0 + Math.abs(ra) * 0.03 + Math.abs(rg) * 0.02;
      win.v += Math.abs(y) * 0.8 + Math.abs(z) * 0.6 + Math.abs(rb) * 0.03;
      if (!win.sx && Math.abs(x) > 3) win.sx = Math.sign(x);
      if (now - win.t0 > 120) { const d = win.h > win.v * 1.1 ? (win.sx < 0 || (!win.sx && ra > 0) ? 'L' : 'R') : 'T'; win = null; S.lastMotion = { dir: d }; S.swings++; act(d, 'motion'); }
      return;
    }
    if (power >= 1 && now > cool) {
      cool = now + 450;
      win = { t0: now, h: 0, v: 0, sx: Math.abs(x) > 3 ? Math.sign(x) : 0 };
      win.h += Math.abs(x) + Math.abs(ra) * 0.03 + Math.abs(rg) * 0.02; win.v += Math.abs(y) * 0.8 + Math.abs(z) * 0.6 + Math.abs(rb) * 0.03;
    }
  }
  function meter(v) { const f = $('meterFill'); if (f) { f.style.width = Math.min(100, v * 80) + '%'; f.style.background = v >= 1 ? '#22c55e' : '#ffd54a'; } }
  function guardUI() { const g = $('guard'); if (g) g.textContent = S.guard ? '🛡️' + ({ L: '⬅️', T: '⬆️', R: '➡️' })[S.guard] : ''; }
  // when a chop is incoming and the defender is already holding a guard pose, that counts as the block
  const fresh = () => S.guard && performance.now() - (S.guardAt || 0) < 400;
  S.onIncoming = () => { if (motionOn && fresh()) setTimeout(() => act(S.guard, 'guard'), 120); else { const t0 = Date.now(); const iv = setInterval(() => { if (S.phase !== 'block' || Date.now() - t0 > 1000) return clearInterval(iv); if (fresh()) { clearInterval(iv); act(S.guard, 'guard'); } }, 50); } };
  document.querySelectorAll('#sens button').forEach((b) => { b.classList.toggle('on', +b.dataset.s === sens); b.onclick = () => { sens = +b.dataset.s; localStorage.setItem('sdr-sens', sens); document.querySelectorAll('#sens button').forEach((x) => x.classList.toggle('on', x === b)); }; });
  function enableMotion() {
    const go = () => { if (!motionOn) { addEventListener('devicemotion', onMotion); motionOn = true; } if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().catch(() => {}); $('motion').classList.add('on'); $('motion').textContent = '📳 ✅'; };
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().then((s) => { if (s === 'granted') go(); else $('motion').textContent = '📳 ❌'; }).catch(() => { $('motion').textContent = '📳 ❌'; });
    } else go();
  }
  $('motion').onclick = enableMotion;
  S.enableMotion = enableMotion;
  // No permission API: enable now. Otherwise the first tap anywhere asks (iOS shows its prompt; Android grants silently).
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission !== 'function') enableMotion();
  else addEventListener('pointerup', function first() { removeEventListener('pointerup', first); if (!motionOn) enableMotion(); });

  // manual room entry
  const pick = (p) => { const v = $('codeIn').value.trim().toUpperCase(); if (v.length < 4) return; room = v; P = p; history.replaceState(null, '', `?room=${room}&p=${P}`); $('overlay').classList.add('hidden'); ui(); connect(); };
  $('p1b').onclick = () => pick(1); $('p2b').onclick = () => pick(2);
  ui(); connect();
})();
