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
    await pg.waitForFunction(() => window.__game.phase === 'chop', null, { timeout: 10000 });
    await pg.waitForTimeout(500); await pg.screenshot({ path: OUT + `s1_split_${name}_ready.png` });
    await pg.tap('#touch .half.p1 button[data-d="L"]'); await pg.waitForTimeout(350);
    await pg.screenshot({ path: OUT + `s2_split_${name}_chop.png` });
    await pg.tap('#touch .half.p2 button[data-d="L"]'); await pg.waitForTimeout(400);
    await pg.screenshot({ path: OUT + `s3_split_${name}_block.png` });
    console.log(name, JSON.stringify(await pg.evaluate(() => [window.__game.score, document.body.className])));
    if (name === 'landscape') { await pg.tap('#viewBtn'); await pg.waitForTimeout(400); await pg.screenshot({ path: OUT + 's4_shared_toggle.png' }); await pg.tap('#viewBtn'); }
  }
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
