/**
 * Mobile acceptance measurements. Serves the production build and reports,
 * per viewport: horizontal overflow, every touch target's CSS-px box, the
 * backing-store DPR, and a frame-interval distribution over a fixed run.
 *
 * These are measurements, not assertions about a real handset: Chromium at a
 * 390x844 viewport is NOT an iPhone. Treat the numbers as a regression signal
 * on this machine only.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const PORT = 4342;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const SECONDS = Number(process.env.FRAME_SECONDS ?? 60);

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('nope'); }
});
await new Promise((r) => server.listen(PORT, r));

const VIEWPORTS = [
  { name: 'portrait-360x640', width: 360, height: 640 },
  { name: 'portrait-390x844', width: 390, height: 844 },
  { name: 'portrait-430x932', width: 430, height: 932 },
  { name: 'landscape-844x390', width: 844, height: 390 },
  { name: 'desktop-1280x800', width: 1280, height: 800 },
];

const browser = await chromium.launch();
const out = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 3, // ask for 3 so a cap of <=2 is observable
    hasTouch: true, isMobile: vp.name !== 'desktop-1280x800',
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.pulseCube);

  const menu = await page.evaluate(() => {
    const doc = document.documentElement;
    const boxes = [...document.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.id || b.className || b.textContent.trim().slice(0, 18), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    });
    return {
      overflowX: doc.scrollWidth - doc.clientWidth,
      bodyTouchAction: getComputedStyle(document.body).touchAction,
      sceneTouchAction: getComputedStyle(document.getElementById('scene')).touchAction,
      panelScrollable: getComputedStyle(document.querySelector('.panel')).overflowY,
      boxes,
      tooSmall: boxes.filter((b) => b.w > 0 && (b.w < 44 || b.h < 44)),
    };
  });

  // Start a run, warm up, then sample frame intervals from the live loop.
  await page.click('#overlay-action');
  await page.waitForFunction(() => window.pulseCube.state.phase === 'playing');
  const frames = await page.evaluate(async (seconds) => {
    const g = window.pulseCube;
    const canvas = document.getElementById('scene');
    const rect = canvas.getBoundingClientRect();
    const dpr = +(canvas.width / rect.width).toFixed(3);
    // Keep the loop in the play phase for the whole window by retrying the
    // instant a run ends. Same level, same layout, so the work per frame is
    // representative of real play rather than of a static overlay.
    let deaths = 0;
    const retry = setInterval(() => {
      const action = document.getElementById('overlay-action');
      if (!document.getElementById('overlay').classList.contains('hidden')) { deaths++; action.click(); }
    }, 120);
    await new Promise((r) => setTimeout(r, 2000)); // warmup
    const iv = [];
    let peakParticles = 0;
    let last = performance.now();
    await new Promise((resolve) => {
      const t0 = last;
      const step = (now) => {
        iv.push(now - last); last = now;
        if (g.state.particles.length > peakParticles) peakParticles = g.state.particles.length;
        if (now - t0 >= seconds * 1000) return resolve();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    clearInterval(retry);
    const s = iv.slice(1).sort((a, b) => a - b);
    const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
    return {
      dpr, canvasW: canvas.width, canvasH: canvas.height, deaths,
      samples: s.length,
      p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +s[s.length - 1].toFixed(2),
      over20ms: +((s.filter((x) => x > 20).length / s.length) * 100).toFixed(2),
      particlesPeak: peakParticles,
    };
  }, SECONDS);

  out.push({ viewport: vp.name, ...menu, frames });
  console.log(`\n=== ${vp.name} ===`);
  console.log(`overflowX=${menu.overflowX}px  body.touch-action=${menu.bodyTouchAction}  #scene.touch-action=${menu.sceneTouchAction}  .panel overflow-y=${menu.panelScrollable}`);
  console.log(`touch targets under 44px: ${menu.tooSmall.length}` + (menu.tooSmall.length ? ` -> ${menu.tooSmall.map((b) => `${b.id} ${b.w}x${b.h}`).join(', ')}` : ''));
  console.log(`dpr=${frames.dpr} backing store=${frames.canvasW}x${frames.canvasH}`);
  console.log(`frame interval over ${SECONDS}s (n=${frames.samples}, ${frames.deaths} retries): p50=${frames.p50}ms p95=${frames.p95}ms p99=${frames.p99}ms max=${frames.max}ms  >20ms=${frames.over20ms}%  peak particles=${frames.particlesPeak}`);
  await ctx.close();
}

await browser.close();
server.close();
console.log('\nJSON\n' + JSON.stringify(out, null, 2));
