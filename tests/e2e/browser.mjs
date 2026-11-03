// Browser interaction checks for the built export (dist/). Run: npm run build && node tests/e2e/browser.mjs
// Needs Playwright: set IMD_PLAYWRIGHT=/path/to/playwright/index.mjs or have `playwright` importable.
// The Squeekchain API is mocked per scenario with page.route so every state is reproducible.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const pwPath = process.env.IMD_PLAYWRIGHT;
const { chromium } = pwPath ? await import(pwPath) : await import('playwright');
const root = path.resolve('dist');
const shotDir = process.env.SHOTS || '';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname.replace(/^\/preview/, '') || '/';
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;

let api = { kind: 'ok', core: 'ACTIVE', height: '7661' };
const body = () => {
  if (api.kind === 'unavailable') return { status: 'unavailable', reason: 'database_unavailable' };
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    measurement: { freshness: 'online', observedAt: now, receivedAt: now, staleAfterSeconds: 120, provenance: 'hardware', coreStatus: api.core, rpmMilli: api.core === 'ACTIVE' ? 64000 : 0 },
    builder: { status: 'available', anchor: { blockHeight: api.height, blockProgress: '500000000' } },
    oracle: { state: 'accepted' },
  };
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch();
async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // A deliberately aborted API request (offline scenario) logs net::ERR_FAILED; that is the
  // simulated outage, not an app error. Everything else counts.
  page.on('console', (m) => m.type() === 'error' && !(api.kind === 'offline' && m.text().includes('net::ERR_FAILED')) && errors.push(m.text()));
  page.on('requestfailed', (r) => !r.url().startsWith('https://api.squeekchain.com/') && errors.push(`request failed ${r.url()}`));
  await page.route('https://api.squeekchain.com/**', (route) => {
    if (api.kind === 'offline') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body()) });
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__squeek?.state().signal !== undefined);
  return { ctx, page, errors };
}
const st = (page) => page.evaluate(() => {
  const s = window.__squeek.state();
  return { view: s.view, mode: s.mode, pause: s.pauseReason, signal: s.signal, balance: s.ledger.balance, claimed: s.ledger.claimed, bests: s.ledger.bests, runs: s.ledger.runs, e: s.engine && { py: s.engine.py, jumps: s.engine.jumpsUsed, world: s.engine.world, time: s.engine.time, magnet: s.engine.magnet, finished: s.engine.finished, coins: s.engine.coins, bestCombo: s.engine.bestCombo } };
});
const poll = (page) => page.evaluate(() => window.__squeek.poller.poll());
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ---- Phone 390, touch ----
{
  const { page, errors, ctx } = await open({ width: 390, height: 844 }, { touch: true });
  await page.waitForTimeout(300);
  const btn = page.locator('#primary-btn');
  const box = await btn.boundingBox();
  check('390: main action visible on first screen', box && box.y + box.height <= 844, `bottom ${box && Math.round(box.y + box.height)}px`);
  const canvasBox = await page.locator('#stage').boundingBox();
  check('390: game scene on first screen', canvasBox && canvasBox.y < 400, `top ${canvasBox && Math.round(canvasBox.y)}px`);
  check('390: first visit offers claim', (await btn.textContent()) === 'Claim 5,000 free coins');
  check('390: no horizontal overflow', (await overflow(page)) <= 0);
  if (shotDir) await page.screenshot({ path: `${shotDir}/390-first.png` });
  await btn.dblclick();
  let s = await st(page);
  check('claim grants 5,000 once (double click)', s.balance === 5000 && s.claimed && s.view === 'ready', `balance ${s.balance}`);
  check('after claim: start label', (await btn.textContent()) === 'Start run · 1,000 coins');
  await page.waitForTimeout(900);
  await btn.dblclick();
  await page.waitForTimeout(100);
  s = await st(page);
  check('live run starts and debits exactly 1,000 on double click', s.view === 'running' && s.balance === 4000 && s.mode === 'live', `balance ${s.balance}`);
  check('ACTIVE wheel -> day world', s.e.world === 'day');
  await page.locator('#stage').tap();
  await page.waitForTimeout(60);
  s = await st(page);
  check('tap on scene jumps', s.e.py < 252, `py ${s.e.py.toFixed(1)}`);
  await page.locator('#jump-btn').tap();
  await page.waitForTimeout(30);
  s = await st(page);
  check('Jump button double-jumps', s.e.jumps === 2);
  if (shotDir) await page.screenshot({ path: `${shotDir}/390-running.png` });
  check('390 running: no horizontal overflow', (await overflow(page)) <= 0);
  check('390: no uncaught errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- Desktop 1440, keyboard ----
{
  api = { kind: 'ok', core: 'IDLE', height: '100' };
  const { page, errors, ctx } = await open({ width: 1440, height: 900 });
  // keyboard: Tab to the claim button and activate with Enter (native activation)
  await page.locator('#primary-btn').focus();
  await page.keyboard.press('Enter');
  let s = await st(page);
  check('keyboard Enter on claim button works', s.balance === 5000);
  await page.keyboard.press('Space');
  s = await st(page);
  check('Space right after claim does not start a paid run', s.view === 'ready' && s.balance === 5000);
  await page.waitForTimeout(900);
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  s = await st(page);
  check('keyboard Space on start button starts run (native activation)', s.view === 'running' && s.balance === 4000);
  check('IDLE wheel -> dream world', s.e.world === 'dream');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(40);
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(20);
  s = await st(page);
  check('Up then W: jump + double jump', s.e.jumps === 2 && s.e.py < 252, JSON.stringify({ v: s.view, p: s.pause, j: s.e.jumps, py: s.e.py, a: await page.evaluate(() => document.activeElement?.id) }));
  await page.keyboard.press('KeyP');
  s = await st(page);
  const t1 = s.e.time;
  await page.waitForTimeout(400);
  s = await st(page);
  check('P pauses, time frozen, no debit', s.view === 'paused' && s.pause === 'user' && s.e.time === t1 && s.balance === 4000);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);
  s = await st(page);
  check('P resumes, no debit', s.view === 'running' && s.e.time > t1 && s.balance === 4000);

  // block bonus: baseline poll, then increase
  await poll(page);
  api.height = '101';
  await poll(page);
  s = await st(page);
  check('settled block increase during run -> coin magnet', s.e.magnet > 0);
  api.height = '100';
  await page.evaluate(() => (window.__squeek.state().engine.magnet = 0));
  await poll(page);
  api.height = '101';
  await poll(page);
  s = await st(page);
  check('rollback then recovery: bonus only from rising consecutive reads', s.e.magnet > 0, 'rollback reset baseline, then rise');

  // stall > 250ms pauses
  await page.evaluate(() => {
    const t = performance.now();
    while (performance.now() - t < 400) {}
  });
  await page.waitForTimeout(100);
  s = await st(page);
  check('browser stall over 250 ms pauses', s.view === 'paused' && s.pause === 'stall', `pause ${s.pause}`);
  await page.locator('#resume-btn').click();
  // hidden page pauses
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  s = await st(page);
  check('hidden page pauses', s.view === 'paused' && s.pause === 'hidden');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });
  await page.locator('#resume-btn').click();

  // telemetry loss: unavailable with HTTP 200
  api.kind = 'unavailable';
  await poll(page);
  s = await st(page);
  check('status unavailable (HTTP 200) pauses the live run', s.view === 'paused' && s.signal === 'unavailable');
  check('resume disabled until fresh signal', await page.locator('#resume-btn').isDisabled());
  check('last reading shown as history', (await page.locator('#t-status').textContent()).startsWith('Last:'));
  if (shotDir) await page.screenshot({ path: `${shotDir}/1440-signal-lost.png` });
  // reconnect then resume requires the player
  api.kind = 'ok';
  await poll(page);
  s = await st(page);
  check('fresh signal does not auto-resume', s.view === 'paused');
  check('resume enabled after fresh signal', !(await page.locator('#resume-btn').isDisabled()));
  await page.locator('#resume-btn').click();
  s = await st(page);
  check('player resumes after reconnect, no extra charge', s.view === 'running' && s.balance === 4000);

  // lose signal again -> transfer to practice
  api.kind = 'offline';
  await poll(page);
  s = await st(page);
  check('network failure pauses live run', s.view === 'paused' && s.signal === 'offline');
  await page.locator('#transfer-btn').click();
  check('transfer button gone after use (no repeated refunds)', await page.locator('#transfer-btn').isHidden());
  s = await st(page);
  const runs = Object.values(s.runs);
  check('transfer: refund live + charge practice once (net zero)', s.balance === 4000 && s.mode === 'practice' && runs.filter((r) => r.status === 'refunded').length === 1 && runs.filter((r) => r.status === 'active').length === 1, `balance ${s.balance}`);
  await page.locator('#resume-btn').click();
  s = await st(page);
  check('practice run plays offline', s.view === 'running' && s.mode === 'practice');
  // fast-forward to the end of the run
  await page.evaluate(() => {
    const e = window.__squeek.state().engine;
    e.time = 74.98;
    e.coins = 3;
    e.bestCombo = 3;
  });
  await page.waitForTimeout(250);
  s = await st(page);
  check('run ends at 75 s with results', s.view === 'results');
  const earned = await page.locator('#r-earned').textContent();
  const bal = await page.locator('#r-balance').textContent();
  check('results show earned, cost, balance', earned === '300' && (await page.locator('#r-cost').textContent()) === '1,000' && bal === '4,300', `${earned} / ${bal}`);
  check('practice record separate from live', s.bests.practice.runs === 1 && s.bests.live.runs === 0 && s.bests.practice.combo === 3);
  if (shotDir) await page.screenshot({ path: `${shotDir}/1440-results.png` });
  await page.reload();
  await page.waitForFunction(() => window.__squeek);
  s = await st(page);
  check('reload keeps balance and records, no double credit', s.balance === 4300 && s.bests.practice.runs === 1);
  check('1440: no horizontal overflow', (await overflow(page)) <= 0);
  check('1440: no uncaught errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- Insufficient funds, shop, abandoned run, replay ----
{
  api = { kind: 'ok', core: 'ACTIVE', height: '5' };
  const { page, errors, ctx } = await open({ width: 390, height: 844 }, { touch: true });
  await page.evaluate(() => {
    localStorage.setItem('squeek-shift:ledger:v1', JSON.stringify({ version: 1, balance: 500, claimed: true, runs: {}, ops: [], bests: {} }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__squeek);
  await page.locator('#mode-practice').click();
  await page.locator('#primary-btn').click();
  check('insufficient balance opens the coin shop', await page.locator('#shop').evaluate((d) => d.open));
  check('shop states test coins only', (await page.locator('#shop .warn').textContent()) === 'Test coins only. No real payment.');
  if (shotDir) await page.screenshot({ path: `${shotDir}/390-shop.png` });
  await page.locator('[data-pack="5000"]').dblclick();
  let s = await st(page);
  check('simulated purchase adds 5,000 once on double click', s.balance === 5500, `balance ${s.balance}`);
  await page.locator('[data-pack="15000"]').click();
  await page.waitForTimeout(450);
  await page.locator('[data-pack="50000"]').click();
  s = await st(page);
  check('15,000 and 50,000 packs', s.balance === 70500);
  await page.locator('#shop button[value="close"]').click();
  await page.locator('#primary-btn').click();
  s = await st(page);
  check('practice run starts after purchase', s.view === 'running' && s.balance === 69500);
  await page.reload();
  await page.waitForFunction(() => window.__squeek);
  s = await st(page);
  const r = Object.values(s.runs);
  check('reload mid-run forfeits: abandoned, no refund, no credit', s.balance === 69500 && r.length === 1 && r[0].status === 'abandoned');
  // replay twice
  await page.locator('#mode-practice').click();
  await page.locator('#primary-btn').click();
  await page.evaluate(() => (window.__squeek.state().engine.hearts = 0));
  await page.waitForTimeout(200);
  s = await st(page);
  check('three lost hearts end the run', s.view === 'results' && (await page.locator('#results-title').textContent()) === 'Out of hearts');
  await page.locator('#again-btn').click();
  s = await st(page);
  check('play again replays and charges once', s.view === 'running' && s.balance === 67500);
  check('320/390 mobile: no uncaught errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- 320 reflow with no live signal ----
{
  api = { kind: 'offline' };
  const { page, errors, ctx } = await open({ width: 320, height: 640 }, { touch: true });
  await page.waitForTimeout(300);
  check('320: no horizontal overflow', (await overflow(page)) <= 0);
  await page.locator('#primary-btn').click();
  await page.waitForTimeout(100);
  const note = await page.locator('#ready-note').textContent();
  const disabled = await page.locator('#primary-btn').isDisabled();
  check('offline: live start disabled with honest reason', disabled && /fresh wheel signal/.test(note), note);
  check('offline: wheel never shown as resting', (await page.locator('#world-tag').textContent()) === 'Wheel state unknown');
  if (shotDir) await page.screenshot({ path: `${shotDir}/320-offline.png`, fullPage: true });
  check('320: no uncaught errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
