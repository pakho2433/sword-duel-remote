const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8765/'; const OUT = '/workspace/sword-duel-remote/previews/'; const errors = [];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [name, vp] of [['landscape', { width: 1180, height: 820 }], ['portrait', { width: 820, height: 1180 }]]) {
    const pg = await (await b.newContext({ viewport: vp, isMobile: true, hasTouch: true })).newPage();
    pg.on('console', (m) => m.type() === 'error' && errors.push(name + ': ' + m.text())); pg.on('pageerror', (e) => errors.push(name + ' ' + e.message));
    await pg.goto(BASE + 'index.html?mode=local&t=' + Date.now());
    await pg.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
    await pg.tap('#start');
    await pg.waitForTimeout(1300); await pg.screenshot({ path: OUT + `d_coin_${name}_flip.png` });
    await pg.waitForFunction(() => window.__game.phase === 'toss' && document.getElementById('coinTxt').className === '', null, { timeout: 10000 }); await pg.waitForTimeout(300); await pg.screenshot({ path: OUT + `d_coin_${name}_result.png` });
    console.log(name, 'first', await pg.evaluate(() => window.__game.first));
    await pg.waitForFunction(() => window.__game.phase === 'chop', null, { timeout: 10000 });
    await pg.waitForTimeout(500); await pg.screenshot({ path: OUT + `d_s1_split_${name}_ready.png` });
    const A = await pg.evaluate(() => window.__game.attacker), D = 3 - A;
    await pg.tap(`#touch .half.p${A} button[data-d="L"]`); await pg.waitForTimeout(350);
    await pg.screenshot({ path: OUT + `d_s2_split_${name}_chop.png` });
    await pg.tap(`#touch .half.p${D} button[data-d="R"]`); await pg.waitForTimeout(450);
    await pg.screenshot({ path: OUT + `d_s3_split_${name}_block.png` });
    console.log(name, JSON.stringify(await pg.evaluate(() => [window.__game.score, window.__game.log, document.body.className])));
    if (name === 'landscape') { await pg.tap('#viewBtn'); await pg.waitForTimeout(400); await pg.screenshot({ path: OUT + 'd_s4_shared_toggle.png' }); await pg.tap('#viewBtn'); }
  }
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
