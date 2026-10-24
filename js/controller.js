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
    $('startBtn').classList.toggle('hidden', !(S.connected && (S.phase === 'lobby' || S.phase === 'over')));
    if (S.score) $('score').textContent = `🛡️ ${S.score[0]} : ${S.score[1]} 🪓`;
  }
  function vib(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

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
    if (m.t === 'incoming') { $('incoming').textContent = '❗' ; vib([40, 30, 40]); }
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
    if (conn && conn.open) conn.send({ t: 'act', dir, src });
    const fx = $('swingFx'); fx.textContent = S.role === 'atk' ? '⚔️' : '🛡️'; fx.classList.remove('show'); void fx.offsetWidth; fx.classList.add('show');
    const b = $('b' + dir); b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 150);
    vib(30);
  }
  document.querySelectorAll('#pad button').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); act(b.dataset.d, 'btn'); }));
  $('startBtn').onclick = () => conn && conn.open && conn.send({ t: 'start' });

  // ---- motion: swing detection ----
  // Phone held upright in portrait, screen facing player. Sideways swing -> strong x accel; downward chop -> strong y/z.
  const TH = 14; let motionOn = false, peakT = 0;
  function onMotion(e) {
    const a = e.acceleration && e.acceleration.x != null ? e.acceleration : null;
    let x, y, z;
    if (a) { x = a.x; y = a.y; z = a.z; } else { const g = e.accelerationIncludingGravity || {}; x = g.x || 0; y = (g.y || 0) + 9.8; z = g.z || 0; }
    const r = e.rotationRate || {};
    const mag = Math.hypot(x, y, z);
    const now = Date.now();
    if (mag > TH && now - peakT > 500) {
      peakT = now;
      let dir;
      if (Math.abs(x) > Math.max(Math.abs(y), Math.abs(z)) * 0.9) dir = x < 0 ? 'L' : 'R';
      else dir = 'T';
      // rotation around z (twist) also hints left/right
      if (dir === 'T' && Math.abs(r.gamma || 0) > 250) dir = r.gamma > 0 ? 'L' : 'R';
      S.lastMotion = { x, y, z, dir };
      act(dir, 'motion');
    }
  }
  function enableMotion() {
    const go = () => { if (!motionOn) { addEventListener('devicemotion', onMotion); motionOn = true; } $('motion').classList.add('on'); $('motion').textContent = '📳 ✅'; };
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().then((s) => { if (s === 'granted') go(); else $('motion').textContent = '📳 ❌'; }).catch(() => { $('motion').textContent = '📳 ❌'; });
    } else go();
  }
  $('motion').onclick = enableMotion;
  S.enableMotion = enableMotion;
  // Non-iOS: enable automatically
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission !== 'function') enableMotion();

  // manual room entry
  const pick = (p) => { const v = $('codeIn').value.trim().toUpperCase(); if (v.length < 4) return; room = v; P = p; history.replaceState(null, '', `?room=${room}&p=${P}`); $('overlay').classList.add('hidden'); ui(); connect(); };
  $('p1b').onclick = () => pick(1); $('p2b').onclick = () => pick(2);
  ui(); connect();
})();
