const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'https://pakho2433.github.io/sword-duel-remote/';
const OUT = '/workspace/sword-duel-remote/previews/';
const errors = [];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const watch = (pg, name) => { pg.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); }); pg.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`)); };
  const hostCtx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  const host = await hostCtx.newPage(); watch(host, 'host');
  await host.goto(BASE + 'index.html?t=' + Date.now());
  await host.waitForFunction(() => window.__game && window.__game.ready && window.__game.peerOpen, null, { timeout: 60000 });
  const room = await host.evaluate(() => window.__game.room);
  console.log('room', room);
  await host.waitForTimeout(800);
  await host.screenshot({ path: OUT + '1-lobby-desktop.png' });
  const iphone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent, permissions: ['accelerometer', 'gyroscope'] };
  const ctl = {};
  for (const p of [1, 2]) {
    const c = await browser.newContext(iphone); const pg = await c.newPage(); watch(pg, 'ctl' + p);
    await pg.goto(`${BASE}controller.html?room=${room}&p=${p}`);
    ctl[p] = pg;
  }
  await host.waitForFunction(() => window.__game.conn[1] && window.__game.conn[2], null, { timeout: 45000 });
  console.log('both connected');
  await host.waitForTimeout(500);
  await host.screenshot({ path: OUT + '2-lobby-connected.png' });
  await ctl[1].screenshot({ path: OUT + '3-controller-p1-lobby.png' });
  // start from phone 1
  for (const p of [1, 2]) await ctl[p].tap('#motion');
  console.log('motion btn', await ctl[1].textContent('#motion'));
  await ctl[1].tap('#startBtn');
  await host.waitForFunction(() => window.__game.phase !== 'lobby', null, { timeout: 10000 });
  let turnsSeen = new Set(), shots = 0, motionUsed = 0, i = 0;
  while (true) {
    const g = await host.evaluate(() => ({ phase: window.__game.phase, atk: window.__game.attacker, turn: window.__game.turn, dir: window.__game.chopDir }));
    if (g.phase === 'over') break;
    if (g.phase === 'chop' && !turnsSeen.has(g.turn)) {
      turnsSeen.add(g.turn); i++;
      const dir = 'LTR'[i % 3];
      const a = ctl[g.atk], d = ctl[g.atk === 1 ? 2 : 1];
      await a.waitForTimeout(300);
      if (i % 3 === 0) { // motion swing on the attacker
        await a.evaluate((dir) => { const x = dir === 'L' ? -25 : dir === 'R' ? 25 : 2; const y = dir === 'T' ? -28 : 1; window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x, y, z: 1 }, accelerationIncludingGravity: { x, y: y - 9.8, z: 1 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16 })); }, dir);
        motionUsed++;
      } else await a.tap('#b' + dir);
      await host.waitForFunction(() => window.__game.phase === 'block', null, { timeout: 5000 }).catch(async (e) => { console.log('DBG', JSON.stringify(await host.evaluate(() => ({ ph: window.__game.phase, log: window.__game.log.slice(-3) }))), JSON.stringify(await a.evaluate(() => window.__ctl))); throw e; });
      if (shots === 0) { await host.waitForTimeout(250); await host.screenshot({ path: OUT + '4-chop-telegraph.png' }); await d.screenshot({ path: OUT + '5-controller-defender.png' }); await a.screenshot({ path: OUT + '5b-controller-attacker.png' }); }
      const bdir = i % 4 === 1 ? 'LTR'[(i + 1) % 3] : dir; // sometimes wrong block
      await d.waitForTimeout(250);
      if (i % 5 === 2) await d.evaluate((dir) => { const x = dir === 'L' ? -22 : dir === 'R' ? 22 : 1; const y = dir === 'T' ? -26 : 1; window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x, y, z: 0 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16 })); }, bdir), motionUsed++;
      else await d.tap('#b' + bdir);
      await host.waitForFunction(() => window.__game.phase !== 'block', null, { timeout: 5000 }); const lg = await host.evaluate(() => window.__game.log.slice(-2)); console.log('turn', g.turn, JSON.stringify(lg), await host.evaluate(() => window.__game.blockDir));
      if (shots < 2) { await host.waitForTimeout(350); await host.screenshot({ path: OUT + `6-result-${shots}.png` }); }
      shots++;
    }
    await host.waitForTimeout(100);
  }
  const fin = await host.evaluate(() => ({ score: window.__game.score, log: window.__game.log.length, srcs: [...new Set(window.__game.log.map((l) => l.src))] }));
  console.log('final', JSON.stringify(fin), 'turns', turnsSeen.size, 'motion', motionUsed);
  await host.waitForTimeout(2000);
  await host.screenshot({ path: OUT + '7-result-desktop.png' });
  await ctl[1].screenshot({ path: OUT + '8-controller-p1-over.png' });
  await ctl[2].screenshot({ path: OUT + '8b-controller-p2-over.png' });
  // reconnect test: reload controller 2
  await ctl[2].reload();
  await host.waitForFunction(() => window.__game.conn[2], null, { timeout: 30000 });
  await ctl[2].waitForFunction(() => window.__ctl.connected, null, { timeout: 30000 });
  console.log('reconnect ok');
  // iPad host, local mode, touch + keyboard
  const ipadCtx = await browser.newContext({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const ipad = await ipadCtx.newPage(); watch(ipad, 'ipad');
  await ipad.goto(BASE + 'index.html?mode=local&t=' + Date.now());
  await ipad.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
  await ipad.screenshot({ path: OUT + '9-ipad-lobby-local.png' });
  await ipad.tap('#start');
  let n = 0, last = -1;
  while (n < 3) {
    const g = await ipad.evaluate(() => ({ phase: window.__game.phase, atk: window.__game.attacker, turn: window.__game.turn }));
    if (g.phase === 'chop' && g.turn !== last) {
      last = g.turn; n++;
      await ipad.tap(`#touch .half.p${g.atk} button[data-d="T"]`);
      await ipad.waitForTimeout(300);
      if (n === 1) await ipad.screenshot({ path: OUT + '10-ipad-local-chop.png' });
      const def = g.atk === 1 ? 2 : 1;
      if (n === 2) await ipad.keyboard.press(def === 1 ? 's' : 'k'); else await ipad.tap(`#touch .half.p${def} button[data-d="T"]`);
      await ipad.waitForFunction(() => window.__game.phase === 'result', null, { timeout: 5000 });
      if (n === 1) { await ipad.waitForTimeout(300); await ipad.screenshot({ path: OUT + '11-ipad-local-block.png' }); }
    }
    await ipad.waitForTimeout(100);
  }
  console.log('ipad local score', JSON.stringify(await ipad.evaluate(() => window.__game.score)));
  // iPad portrait-ish phone-mode lobby
  const ip2 = await (await browser.newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true })).newPage(); watch(ip2, 'ipadP');
  await ip2.goto(BASE + 'index.html?t=' + Date.now()); await ip2.waitForFunction(() => window.__game && window.__game.ready && window.__game.peerOpen, null, { timeout: 60000 });
  await ip2.waitForTimeout(500); await ip2.screenshot({ path: OUT + '12-ipad-portrait-lobby.png' });
  console.log('ERRORS', errors.length, JSON.stringify(errors, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAIL', e); console.log('ERRORS', JSON.stringify(errors)); process.exit(1); });
