/**
 * Browser smoke test: serves the production build, drives it in Chromium at a
 * desktop and an iPhone viewport, and asserts against the live simulation
 * state rather than pixels. Screenshots land in docs/.
 *
 * Rules carried over from the earlier games in this series:
 *  - Never sleep a fixed number of ms and then assert. Headless rAF runs at
 *    roughly 16fps, so 120ms of wall clock is one or two simulated frames.
 *    Poll with waitForFunction instead.
 *  - Take the gameplay screenshots BEFORE any helper that moves the player or
 *    clears the world, or the shots prove nothing about how the game looks.
 */
import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const PORT = 4341;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(PORT, r));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

await mkdir(new URL('../docs/', import.meta.url).pathname, { recursive: true });
const browser = await chromium.launch();

const snapshot = (page) =>
  page.evaluate(() => {
    const g = window.pulseCube;
    const s = g.state;
    return {
      phase: s.phase,
      mode: s.mode,
      levelIndex: s.levelIndex,
      x: s.player.x,
      y: s.player.y,
      vy: s.player.vy,
      grounded: s.player.grounded,
      progress: s.progress,
      runBest: s.runBest,
      attempts: s.attempts,
      checkpoint: s.checkpoint,
      deathCause: s.deathCause,
      particles: s.particles.length,
      viewW: s.viewW,
      hudProgress: document.getElementById('progress-text').textContent,
      hudBest: document.getElementById('best').textContent,
      hudAttempts: document.getElementById('attempts').textContent,
      fillWidth: document.getElementById('progress-fill').style.width,
      levelName: document.getElementById('level-name').textContent,
    };
  });

async function tapCanvas(page, touch) {
  const box = await page.locator('#scene').boundingBox();
  const x = box.x + box.width * 0.6;
  const y = box.y + box.height * 0.75;
  if (touch) {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.click(x, y);
  }
}

async function run(label, contextOptions, shots) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const touch = !!contextOptions.hasTouch;

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.pulseCube);

  const vw = contextOptions.viewport.width;
  const vh = contextOptions.viewport.height;
  const box = await page.locator('#scene').boundingBox();
  check(
    `${label}: canvas fills the viewport`,
    Math.abs(box.width - vw) < 2 && Math.abs(box.height - vh) < 2,
    `${Math.round(box.width)}x${Math.round(box.height)}`,
  );
  check(`${label}: start overlay visible`, await page.locator('#overlay').isVisible());
  const help = await page.locator('#overlay-body').innerText();
  check(`${label}: help explains the one button`, /one button/i.test(help));
  check(`${label}: help explains spikes`, /spike/i.test(help));
  check(`${label}: three levels offered`, (await page.locator('button.level').count()) === 3);
  check(`${label}: both modes offered`, (await page.locator('button.mode').count()) === 2);
  await page.screenshot({ path: `docs/${shots.menu}` });

  const view = await page.evaluate(() => window.pulseCube.state.viewW);
  check(`${label}: camera width inside playable clamp`, view >= 12 && view <= 34, `viewW=${view.toFixed(1)}`);
  const square = await page.evaluate(() => {
    const s = window.pulseCube.state;
    const c = document.getElementById('scene');
    return Math.abs(c.width / s.viewW - c.height / s.viewH);
  });
  check(`${label}: pixel scale is uniform (the cube is square)`, square < 0.01, `delta=${square.toFixed(4)}`);

  // --- start level 1, normal mode -----------------------------------------
  await page.locator('#overlay-action').click();
  await page.waitForFunction(() => window.pulseCube.state.phase === 'playing');
  check(`${label}: overlay hidden after start`, await page.locator('#overlay').isHidden());

  // The cube auto-runs without any input at all.
  const x0 = (await snapshot(page)).x;
  await page.waitForFunction((x) => window.pulseCube.state.player.x > x + 3, x0, { timeout: 6000 });
  const moving = await snapshot(page);
  check(`${label}: cube auto-runs forward`, moving.x > x0 + 3, `x=${moving.x.toFixed(1)}`);
  check(`${label}: progress bar advances`, moving.progress > 0 && moving.fillWidth !== '0%', `fill=${moving.fillWidth}`);
  // Wait until real geometry is inside the camera before shooting, otherwise
  // the "gameplay" screenshot is an empty stretch of floor and proves nothing.
  await page.waitForFunction(
    () => {
      const s = window.pulseCube.state;
      const left = s.player.x - s.viewW * 0.3;
      return window.__levels[s.levelIndex].entities.some(
        (e) => e.kind !== 'block' && e.x > left && e.x < left + s.viewW,
      );
    },
    null,
    { timeout: 10000 },
  );
  await page.screenshot({ path: `docs/${shots.play}` });

  // --- one-button jump, keyboard and pointer -------------------------------
  await page.waitForFunction(() => window.pulseCube.state.player.grounded, null, { timeout: 6000 });
  await page.keyboard.press('Space');
  const jumped = await page
    .waitForFunction(() => window.pulseCube.state.player.vy > 1, null, { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  check(`${label}: Space jumps`, jumped);

  await page.waitForFunction(() => window.pulseCube.state.player.grounded, null, { timeout: 6000 });
  await tapCanvas(page, touch);
  const tapped = await page
    .waitForFunction(() => window.pulseCube.state.player.vy > 1, null, { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  check(`${label}: ${touch ? 'tap' : 'click'} jumps`, tapped);

  // --- pause freezes the run ----------------------------------------------
  await page.locator('#pause-btn').click();
  await page.waitForFunction(() => window.pulseCube.state.phase === 'paused');
  check(`${label}: pause shows the overlay`, await page.locator('#overlay').isVisible());
  const pausedX = (await snapshot(page)).x;
  await page.waitForTimeout(400);
  check(`${label}: cube frozen while paused`, (await snapshot(page)).x === pausedX);
  check(`${label}: level picker hidden mid-run`, await page.locator('button.level').first().isHidden());
  await page.locator('#overlay-action').click();
  await page.waitForFunction(() => window.pulseCube.state.phase === 'playing');
  check(`${label}: resume returns to play`, await page.locator('#overlay').isHidden());

  // --- dying on a spike ----------------------------------------------------
  await page.waitForFunction(() => window.pulseCube.state.phase === 'dead', null, { timeout: 25000 });
  const dead = await snapshot(page);
  check(`${label}: run ends on contact`, dead.phase === 'dead' && dead.deathCause !== null, `cause=${dead.deathCause}`);
  check(`${label}: death throws debris`, dead.particles > 10, `${dead.particles} pieces`);
  check(`${label}: game over overlay visible`, await page.locator('#overlay').isVisible());
  const overText = await page.locator('#overlay-body').innerText();
  check(`${label}: game over reports the attempt`, /Attempt/i.test(overText));
  check(`${label}: level picker back on the results screen`, await page.locator('button.level').first().isVisible());
  check(`${label}: best progress recorded`, dead.hudBest !== '0%', `best=${dead.hudBest}`);
  await page.screenshot({ path: `docs/${shots.over}` });

  // --- normal mode restarts from the beginning ------------------------------
  await page.locator('#overlay-action').click();
  await page.waitForFunction(() => window.pulseCube.state.phase === 'playing');
  const restarted = await snapshot(page);
  check(
    `${label}: normal restart returns to the start`,
    restarted.x < 2 && restarted.progress < 0.05 && restarted.attempts === 1,
    `x=${restarted.x.toFixed(2)} attempts=${restarted.attempts}`,
  );

  // --- practice mode respawns at the checkpoint ----------------------------
  await page.locator('#pause-btn').click();
  await page.waitForFunction(() => window.pulseCube.state.phase === 'paused');
  await page.evaluate(() => {
    // Die on purpose to get back to a screen with the picker on it.
    window.pulseCube.state.phase = 'playing';
  });
  await page.evaluate(() => window.pulseCube.seekTo(1e6));
  await page.waitForFunction(() => window.pulseCube.state.phase === 'cleared', null, { timeout: 6000 });
  check(`${label}: reaching the finish clears the level`, (await snapshot(page)).progress === 1);
  const clearedText = await page.locator('#overlay-body').innerText();
  check(`${label}: clear screen reports 100%`, /100%/.test(clearedText));
  await page.screenshot({ path: `docs/${shots.clear}` });

  await page.locator('button.mode[data-mode="practice"]').click();
  await page.locator('button.level[data-level="0"]').click();
  await page.locator('#overlay-action').click();
  await page.waitForFunction(() => window.pulseCube.state.phase === 'playing');
  check(`${label}: practice mode selected`, (await snapshot(page)).mode === 'practice');
  // Walk past the second checkpoint, then die.
  await page.evaluate(() => window.pulseCube.seekTo(76));
  await page.waitForFunction(() => window.pulseCube.state.checkpoint >= 1, null, { timeout: 8000 });
  const cpIndex = (await snapshot(page)).checkpoint;
  await page.waitForFunction(() => window.pulseCube.state.phase === 'dead', null, { timeout: 25000 });
  await page.locator('#overlay-action').click();
  await page.waitForFunction(() => window.pulseCube.state.phase === 'playing');
  const respawned = await snapshot(page);
  const expected = await page.evaluate((i) => window.__levels[0].checkpoints[i], cpIndex);
  check(
    `${label}: practice respawns at the last checkpoint`,
    Math.abs(respawned.x - expected) < 0.001,
    `x=${respawned.x.toFixed(1)} expected=${expected}`,
  );
  check(`${label}: practice keeps counting attempts`, respawned.attempts >= 2, `attempts=${respawned.attempts}`);

  // --- mute ----------------------------------------------------------------
  await page.locator('#mute-btn').click();
  check(`${label}: mute button reports muted`, /off/i.test(await page.locator('#mute-btn').innerText()));
  await page.locator('#mute-btn').click();
  check(`${label}: unmute restores`, /on/i.test(await page.locator('#mute-btn').innerText()));

  check(`${label}: no console or page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

await run('desktop', { viewport: { width: 1280, height: 800 } }, {
  menu: 'desktop-menu.png', play: 'desktop-play.png', over: 'desktop-over.png', clear: 'desktop-clear.png',
});
await run('mobile', { ...devices['iPhone 13'] }, {
  menu: 'mobile-menu.png', play: 'mobile-play.png', over: 'mobile-over.png', clear: 'mobile-clear.png',
});

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
