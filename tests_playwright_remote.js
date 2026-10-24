const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'https://pakho2433.github.io/sword-duel-remote/';
const OUT = '/workspace/sword-duel-remote/previews/';
const errors = [];
const SIM = () => {
  const fire = (x, y, z, ra, rb, rg) => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x, y, z }, accelerationIncludingGravity: { x, y: y - 9.8, z }, rotationRate: { alpha: ra, beta: rb, gamma: rg }, interval: 16 }));
  window.__swing = async (dir) => { // ~20 samples of a real arm swing: ramp up, peak, decelerate
    for (let i = 0; i < 20; i++) { const env = Math.sin(Math.PI * i / 20) * (i < 14 ? 1 : -0.6); const s = dir === 'L' ? -1 : 1;
      if (dir === 'T') fire(1.5 * env, -16 * env, 6 * env, 20, 320 * env, 10); else fire(s * 17 * env, 2 * env, 3 * env, -s * 250 * env, 20, 30);
      await new Promise((r) => setTimeout(r, 16)); }
  };
  window.__hold = async (dir) => { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: dir === 'T' ? 75 : 40, gamma: dir === 'L' ? -45 : dir === 'R' ? 45 : 0 }));
    for (let i = 0; i < 20; i++) { fire(0.2, 0.1, 0.1, 2, 3, 1); await new Promise((r) => setTimeout(r, 16)); }
    (async () => { for (let i = 0; i < 150; i++) { fire(0.2, 0.1, 0.1, 2, 3, 1); await new Promise((r) => setTimeout(r, 16)); } })(); };
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const watch = (pg, name) => { pg.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); }); pg.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`)); };
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); watch(host, 'hostScreen');
  await host.goto(BASE + 'index.html?t=' + Date.now());
  await host.waitForFunction(() => window.__game && window.__game.ready && window.__game.peerOpen, null, { timeout: 60000 });
  await host.click('#mRemote');
  const share = await host.getAttribute('#shareLink', 'href'); const room = await host.evaluate(() => window.__game.room);
  console.log('room', room, share);
  const guest = await (await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })).newPage(); watch(guest, 'guestScreen');
  await guest.goto(share);
  await guest.waitForFunction(() => window.__game && window.__game.ready && window.__game.hostOk, null, { timeout: 60000 });
  const iphone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent, permissions: ['accelerometer', 'gyroscope'] };
  const ctl = {};
  const urls = { 1: await host.getAttribute('#qr1', 'title'), 2: await guest.getAttribute('#qr2', 'title') };
  console.log('controller urls', JSON.stringify(urls));
  for (const p of [1, 2]) { const c = await browser.newContext(iphone); await c.addInitScript(SIM); const pg = await c.newPage(); watch(pg, 'phone' + p); await pg.goto(urls[p]); ctl[p] = pg; }
  await host.waitForFunction(() => window.__game.conn[1] && window.__game.conn[2], null, { timeout: 45000 });
  for (const p of [1, 2]) await ctl[p].tap('#motion');
  await guest.waitForTimeout(1500);
  await host.screenshot({ path: OUT + 'r1_host_lobby.png' }); await guest.screenshot({ path: OUT + 'r2_guest_lobby.png' });
  console.log('ping on guest', await guest.textContent('#ping'));
  await guest.tap('#start'); // guest asks host to start
  await host.waitForFunction(() => window.__game.phase !== 'lobby', null, { timeout: 10000 });
  let seen = new Set(), i = 0, shots = 0;
  while (true) {
    const g = await host.evaluate(() => ({ phase: window.__game.phase, atk: window.__game.attacker, turn: window.__game.turn }));
    if (g.phase === 'over') break;
    if (g.phase === 'chop' && !seen.has(g.turn)) {
      seen.add(g.turn); i++;
      const dir = 'LTR'[i % 3], def = g.atk === 1 ? 2 : 1, a = ctl[g.atk], d = ctl[def];
      const hold = i % 4 === 3;
      if (hold) await d.evaluate((x) => window.__hold(x), dir);
      await a.waitForTimeout(250);
      if (g.atk === 2 && i % 4 === 0) await guest.keyboard.press({ L: 'j', T: 'k', R: 'l' }[dir]); // guest screen keyboard fallback
      else await a.evaluate((x) => window.__swing(x), dir);
      await host.waitForFunction(() => window.__game.phase !== 'chop', null, { timeout: 6000 });
      if (shots === 0) { await guest.waitForTimeout(150); await host.screenshot({ path: OUT + 'r3_host_chop.png' }); await guest.screenshot({ path: OUT + 'r4_guest_chop.png' }); }
      const bdir = i % 5 === 1 ? 'LTR'[(i + 1) % 3] : dir;
      if (!hold) {
        await d.waitForTimeout(150);
        if (def === 2 && i % 3 === 2) await guest.tap(`#touch .half.p2 button[data-d="${bdir}"]`); // guest touch fallback
        else await d.evaluate((x) => window.__swing(x), bdir);
      }
      await host.waitForFunction(() => window.__game.phase !== 'block', null, { timeout: 6000 });
      if (shots === 1) { await guest.waitForTimeout(400); await host.screenshot({ path: OUT + 'r5_host_result.png' }); await guest.screenshot({ path: OUT + 'r6_guest_result.png' }); }
      shots++;
    }
    await host.waitForTimeout(80);
  }
  await guest.waitForTimeout(2500);
  const hs = await host.evaluate(() => ({ score: window.__game.score, srcs: [...new Set(window.__game.log.map((l) => l.src))], phase: window.__game.phase }));
  const gs = await guest.evaluate(() => ({ score: window.__game.score, phase: window.__game.phase, ui: document.getElementById('f1').textContent + ':' + document.getElementById('f2').textContent }));
  console.log('HOST', JSON.stringify(hs), 'GUEST', JSON.stringify(gs), 'turns', seen.size);
  console.log('SAME', hs.score[1] === gs.score[1] && hs.score[2] === gs.score[2] && gs.phase === 'over');
  await host.screenshot({ path: OUT + 'r7_host_end.png' }); await guest.screenshot({ path: OUT + 'r8_guest_end.png' });
  await ctl[2].screenshot({ path: OUT + 'r9_phone2_end.png' });
  // guest screen reconnect: reload guest, expect re-sync
  await guest.reload();
  await guest.waitForFunction(() => window.__game && window.__game.hostOk, null, { timeout: 45000 });
  console.log('guest reconnect ok');
  // rematch from guest
  await guest.tap('#start').catch(() => {});
  await guest.evaluate(() => 0);
  await host.click('#again').catch(() => {});
  await host.waitForFunction(() => window.__game.phase !== 'over' && window.__game.turn === 0, null, { timeout: 10000 });
  await guest.waitForFunction(() => !['over', 'lobby'].includes(window.__game.phase), null, { timeout: 10000 });
  console.log('rematch ok on both');
  await guest.waitForTimeout(1500); await guest.screenshot({ path: OUT + 'r10_guest_rematch.png' });
  console.log('ERRORS', errors.length, JSON.stringify(errors, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAIL', e); console.log('ERRORS', JSON.stringify(errors)); process.exit(1); });
