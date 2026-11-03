// Squeek Shift UI controller: wires the engine, ledger, telemetry and renderer to the page.
import {
  COIN_VALUE,
  START_HEARTS,
  advance,
  createEngine,
  drainEvents,
  pressJump,
  setWorld,
  startMagnet,
  timeLeft,
  type EngineState,
  type RunMode,
  type RunResult,
  type World,
} from './engine';
import { ENTRY_COST, Ledger, browserKV, type LedgerData } from './ledger';
import { BlockWatcher, Poller, currentState, measurementAgeSeconds, type FetchFn, type Snapshot } from './telemetry';
import { drawScene, resizeCanvas, setupCanvas } from './render';
import { Sound } from './sound';

const STALL_MS = 250;
const fmt = new Intl.NumberFormat('en-US');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type View = 'ready' | 'running' | 'paused' | 'results';
type PauseReason = 'user' | 'hidden' | 'stall' | 'signal' | 'transfer';

const ledger = new Ledger(browserKV());
const sound = new Sound();
const watcher = new BlockWatcher();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Any run left active by a previous page load was abandoned: entry stays spent, no credit.
ledger.abandonActive();

const app = {
  view: 'ready' as View,
  mode: 'live' as RunMode,
  engine: null as EngineState | null,
  runId: null as string | null,
  pauseReason: null as PauseReason | null,
  lastFrame: null as number | null,
  busy: false,
  finishHandled: false,
  lastResult: null as RunResult | null,
  lastBalance: 0,
  shake: 0,
  toastTimer: 0,
  /** After a claim, the same button becomes the paid start: ignore clicks briefly so a double click never starts a run. */
  claimLockUntil: 0,
};

const canvas = $<HTMLCanvasElement>('canvas');
const ctx = setupCanvas(canvas);
const stage = $('stage');

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function announce(text: string): void {
  const el = $('announcer');
  el.textContent = '';
  window.setTimeout(() => (el.textContent = text), 30);
}

function toast(text: string, ms = 1400): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  window.clearTimeout(app.toastTimer);
  app.toastTimer = window.setTimeout(() => (el.hidden = true), ms);
}

// ---------- Telemetry ----------
const fetchFn: FetchFn = (url, init) => fetch(url, init);
const poller = new Poller(fetchFn, onSnapshot);

function signalState() {
  return currentState(poller.latest, Date.now());
}

function liveWorld(): World | null {
  const s = poller.latest;
  if (signalState() !== 'ready' || !s?.reading) return null;
  return s.reading.coreStatus === 'ACTIVE' ? 'day' : 'dream';
}

function onSnapshot(s: Snapshot): void {
  renderTelemetry();
  const e = app.engine;
  if (app.mode === 'live' && e && !e.finished && (app.view === 'running' || app.view === 'paused')) {
    if (s.state === 'ready') {
      const w = liveWorld();
      if (w) setWorld(e, w);
      if (app.view === 'running' && watcher.observe(s)) {
        startMagnet(e);
        toast('New settled block. Coin magnet!');
        sound.play('magnet');
      }
      if (app.view === 'paused' && app.pauseReason === 'signal') renderPanel();
    } else {
      watcher.observe(s); // resets the baseline: no bonus across gaps
      if (app.view === 'running') pause('signal');
      else renderPanel();
    }
  }
  if (app.view === 'ready') renderPanel();
}

const STATE_TEXT: Record<string, string> = {
  ready: 'Live: fresh validated reading',
  fault: 'Wheel counter fault',
  stale: 'Reading is stale',
  unvalidated: 'Reading not validated',
  unavailable: 'Source unavailable',
  invalid: 'Unrecognized response',
  offline: 'Cannot reach the API',
};

function renderTelemetry(): void {
  const now = Date.now();
  const st = signalState();
  const snap = poller.latest;
  const r = snap?.reading ?? poller.lastReading;
  const historical = st !== 'ready';
  let conn = 'Connecting';
  if (snap) {
    if (st === 'ready' || st === 'stale' || !snap.reason) conn = STATE_TEXT[st];
    else if (st === 'offline') conn = `Offline: ${snap.reason.toLowerCase()}`;
    else conn = snap.reason;
  }
  $('conn-text').textContent = conn;
  $('conn-dot').className = `dot ${!snap ? '' : st === 'ready' ? 'ok' : 'bad'}`;
  const prefix = historical && r ? 'Last: ' : '';
  $('t-status').textContent = r?.coreStatus ? `${prefix}${r.coreStatus === 'ACTIVE' ? 'Running' : r.coreStatus === 'IDLE' ? 'Resting' : 'Counter fault'}` : 'Unknown';
  $('t-rpm').textContent = r?.rpm != null ? `${prefix}${r.rpm.toFixed(1)} rpm` : 'Unknown';
  $('t-block').textContent = r?.blockHeight ? `${prefix}${fmt.format(Number(r.blockHeight))}` : 'Unknown';
  $('t-progress').textContent = r?.blockProgress != null ? `${prefix}${(r.blockProgress * 100).toFixed(1)}%` : 'Unknown';
  $('t-bar').style.width = r?.blockProgress != null ? `${(r.blockProgress * 100).toFixed(1)}%` : '0';
  const age = measurementAgeSeconds(r, now);
  $('t-age').textContent = age == null ? 'Unknown' : `${formatAge(age)} ago${historical ? ' (historical)' : ''}`;
}

function formatAge(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

// ---------- Ledger views ----------
function renderWallet(d: LedgerData = ledger.read()): void {
  $('balance').textContent = fmt.format(d.balance);
  $('storage-note').textContent = ledger.persistent
    ? 'Stored on this device only. Local data can be edited, so this is not a secure balance.'
    : 'Storage is blocked in this browser, so coins and records last only while this tab is open.';
  for (const m of ['live', 'practice'] as const) {
    const b = d.bests[m];
    $(`b-${m}-score`).textContent = fmt.format(b.score);
    $(`b-${m}-coins`).textContent = fmt.format(b.coins);
    $(`b-${m}-combo`).textContent = fmt.format(b.combo);
    $(`b-${m}-runs`).textContent = fmt.format(b.runs);
  }
}

// ---------- Views ----------
function setView(v: View): void {
  app.view = v;
  document.querySelectorAll<HTMLElement>('#panel [data-view]').forEach((el) => (el.hidden = el.dataset.view !== v));
  renderPanel();
}

function renderPanel(): void {
  const d = ledger.read();
  if (app.view === 'ready') {
    $('mode-live').setAttribute('aria-checked', String(app.mode === 'live'));
    $('mode-practice').setAttribute('aria-checked', String(app.mode === 'practice'));
    const btn = $<HTMLButtonElement>('primary-btn');
    const note = $('ready-note');
    note.classList.remove('alert');
    if (!d.claimed) {
      btn.textContent = 'Claim 5,000 free coins';
      btn.disabled = app.busy;
      note.textContent = 'A one-time gift of test coins for this device. Each run costs 1,000.';
      return;
    }
    btn.textContent = 'Start run · 1,000 coins';
    const st = signalState();
    if (app.mode === 'live' && st !== 'ready') {
      btn.disabled = true;
      note.classList.add('alert');
      note.textContent = poller.latest
        ? `Live play needs a fresh wheel signal (${STATE_TEXT[st].toLowerCase()}). Try Practice · simulated meanwhile.`
        : 'Checking the Squeekchain wheel. Practice · simulated works right away.';
    } else {
      btn.disabled = app.busy;
      if (d.balance < ENTRY_COST) note.textContent = `Balance ${fmt.format(d.balance)} is below 1,000. Starting opens the coin shop.`;
      else if (app.mode === 'live') note.textContent = liveWorld() === 'day' ? 'The wheel is running: fast day lab, normal gravity.' : 'The wheel is resting: slow dream world, low gravity, floating orbs.';
      else note.textContent = 'Simulated wheel, works offline. Day and dream swap every 20 seconds. Separate records.';
    }
  } else if (app.view === 'paused') {
    const reason = app.pauseReason;
    const resume = $<HTMLButtonElement>('resume-btn');
    const transfer = $<HTMLButtonElement>('transfer-btn');
    const title = $('pause-title');
    const note = $('pause-note');
    transfer.hidden = true;
    resume.disabled = false;
    if (reason === 'signal' || (app.mode === 'live' && signalState() !== 'ready')) {
      const fresh = signalState() === 'ready';
      title.textContent = fresh ? 'Live signal is back' : 'Live signal lost';
      note.textContent = fresh
        ? 'A fresh reading arrived. Resume when you are ready. No extra charge.'
        : `${STATE_TEXT[signalState()]}. The last reading is shown as history. Your run is paused, not charged again. Switch to practice to refund this live entry, drop its unfinished coins and charge one practice entry instead.`;
      resume.disabled = !fresh;
      resume.textContent = fresh ? 'Resume live run' : 'Waiting for fresh signal';
      transfer.hidden = false;
    } else {
      title.textContent = reason === 'transfer' ? 'Practice run ready' : 'Paused';
      note.textContent =
        reason === 'hidden'
          ? 'Paused while the page was hidden.'
          : reason === 'stall'
            ? 'Paused because the browser stalled. Timing resets when you resume.'
            : reason === 'transfer'
              ? 'Your live entry was refunded and one practice entry charged. Net cost of switching: zero.'
              : 'Take a breath. No extra charge for pausing.';
      resume.textContent = 'Resume';
    }
  } else if (app.view === 'results' && app.lastResult) {
    const r = app.lastResult;
    $('results-title').textContent = r.reason === 'time' ? 'Time! Run complete' : 'Out of hearts';
    $('r-score').textContent = fmt.format(r.score);
    $('r-earned').textContent = fmt.format(r.coinsEarned);
    $('r-cost').textContent = fmt.format(ENTRY_COST);
    $('r-balance').textContent = fmt.format(app.lastBalance);
    $('r-combo').textContent = fmt.format(r.bestCombo);
    $('r-mode').textContent = app.mode === 'live' ? 'Live' : 'Practice';
    const again = $<HTMLButtonElement>('again-btn');
    again.disabled = app.busy || (app.mode === 'live' && signalState() !== 'ready');
    again.textContent = 'Play again · 1,000 coins';
  }
}

function renderHud(): void {
  const e = app.engine;
  const hearts = e ? Math.max(0, e.hearts) : START_HEARTS;
  const hEl = $('hud-hearts');
  if (hEl.dataset.n !== String(hearts)) {
    hEl.dataset.n = String(hearts);
    hEl.innerHTML = Array.from({ length: START_HEARTS }, (_, i) => `<svg viewBox="0 0 24 24" class="${i < hearts ? '' : 'lost'}"><use href="#heart"/></svg>`).join('');
    hEl.setAttribute('aria-label', `${hearts} of ${START_HEARTS} hearts`);
  }
  $('hud-time').textContent = e ? String(Math.ceil(timeLeft(e) - 1e-6)) : '75';
  $('hud-score').textContent = fmt.format(e?.score ?? 0);
  $('hud-coins').textContent = fmt.format((e?.coins ?? 0) * COIN_VALUE);
  $('hud-level').textContent = `${e?.level ?? 1}/5`;
}

function sceneWorld(): { blend: number; muted: boolean; label: string } {
  const e = app.engine;
  if (e && app.view !== 'ready') {
    const label = e.world === 'day' ? 'Day lab' : 'Dream';
    const muted = app.view === 'paused';
    return { blend: e.worldBlend, muted, label: app.mode === 'practice' ? `${label} · simulated` : label };
  }
  if (app.mode === 'practice') return { blend: 0, muted: false, label: 'Day lab · simulated' };
  const w = liveWorld();
  if (!w) return { blend: 0, muted: true, label: poller.latest ? 'Wheel state unknown' : 'Checking wheel' };
  return { blend: w === 'dream' ? 1 : 0, muted: false, label: w === 'day' ? 'Day lab · wheel running' : 'Dream · wheel resting' };
}

// ---------- Run lifecycle ----------
function startRun(mode: RunMode): void {
  if (app.busy) return;
  const d = ledger.read();
  if (!d.claimed) return;
  if (d.balance < ENTRY_COST) {
    openShop('Your balance is below 1,000 test coins. Add a pack to keep playing.');
    return;
  }
  if (mode === 'live' && signalState() !== 'ready') {
    renderPanel();
    return;
  }
  app.busy = true;
  const runId = newId();
  const res = ledger.startRun(runId, mode);
  app.busy = false;
  if (!res.ok) {
    if (res.error === 'insufficient') openShop('Your balance is below 1,000 test coins.');
    renderWallet();
    renderPanel();
    return;
  }
  app.mode = mode;
  beginEngine(runId, mode);
  renderWallet(res.data);
  announce(`${mode === 'live' ? 'Live' : 'Practice'} run started. 1,000 test coins charged.`);
}

function beginEngine(runId: string, mode: RunMode, startPaused?: PauseReason): void {
  const world: World = mode === 'live' ? (liveWorld() ?? 'day') : 'day';
  app.runId = runId;
  app.finishHandled = false;
  app.engine = createEngine({ seed: (Math.random() * 2 ** 31) | 0, mode, world });
  app.lastFrame = null;
  watcher.reset();
  if (startPaused) {
    app.pauseReason = startPaused;
    setView('paused');
    $('resume-btn').focus();
  } else {
    app.pauseReason = null;
    setView('running');
    stage.focus({ preventScroll: true });
  }
}

function pause(reason: PauseReason): void {
  if (app.view !== 'running') return;
  app.pauseReason = reason;
  app.lastFrame = null;
  setView('paused');
  announce(reason === 'signal' ? 'Live signal lost. Run paused.' : 'Paused.');
  if (reason !== 'hidden') $('resume-btn').focus({ preventScroll: true });
}

function resume(): void {
  if (app.view !== 'paused' || !app.engine) return;
  if (app.mode === 'live') {
    if (signalState() !== 'ready') {
      app.pauseReason = 'signal';
      renderPanel();
      return;
    }
    const w = liveWorld();
    if (w) setWorld(app.engine, w);
    watcher.reset(); // a reconnect gap never counts as a block increase
  }
  app.pauseReason = null;
  app.lastFrame = null;
  setView('running');
  stage.focus({ preventScroll: true });
}

function transferToPractice(): void {
  if (app.busy || app.mode !== 'live' || !app.runId || app.view !== 'paused') return;
  app.busy = true;
  const practiceId = newId();
  const res = ledger.transferToPractice(app.runId, practiceId);
  app.busy = false;
  if (!res.ok) {
    renderPanel();
    return;
  }
  app.mode = 'practice';
  renderWallet(res.data);
  beginEngine(practiceId, 'practice', 'transfer');
  announce('Live entry refunded. Practice run charged and ready.');
}

function handleFinish(e: EngineState): void {
  if (app.finishHandled || !e.result || !app.runId) return;
  app.finishHandled = true;
  const r = e.result;
  const res = ledger.finishRun(app.runId, r);
  app.lastResult = r;
  app.lastBalance = res.data.balance;
  renderWallet(res.data);
  setView('results');
  sound.play('finish');
  announce(`Run over. Score ${fmt.format(r.score)}. ${fmt.format(r.coinsEarned)} coins earned. Balance ${fmt.format(res.data.balance)}.`);
  $('again-btn').focus({ preventScroll: true });
}

function jump(): void {
  if (app.view !== 'running' || !app.engine) return;
  pressJump(app.engine);
}

// ---------- Main loop ----------
function frame(now: number): void {
  const e = app.engine;
  if (app.view === 'running' && e && !e.finished) {
    if (app.lastFrame !== null) {
      const dtMs = now - app.lastFrame;
      if (dtMs > STALL_MS) {
        pause('stall');
      } else {
        advance(e, dtMs / 1000);
        // Live mode: a reading that ages out mid-run pauses the run.
        if (app.mode === 'live' && signalState() !== 'ready') pause('signal');
      }
    }
    app.lastFrame = now;
    for (const ev of drainEvents(e)) {
      if (ev.type === 'hit') {
        sound.play('hit');
        if (!reducedMotion.matches) app.shake = 6;
        announce(`Ouch. ${ev.value} hearts left.`);
      } else if (ev.type === 'coin') sound.play('coin');
      else if (ev.type === 'jump' || ev.type === 'double') sound.play(ev.type);
      else if (ev.type === 'land') sound.play('land');
      else if (ev.type === 'level') toast(`Level ${ev.value}`);
      else if (ev.type === 'world') toast(e.world === 'day' ? 'Day lab' : 'Dream world');
    }
    if (e.finished) handleFinish(e);
  }
  const scale = resizeCanvas(canvas);
  const sw = sceneWorld();
  const tag = $('world-tag');
  if (tag.textContent !== sw.label) tag.textContent = sw.label;
  drawScene(
    ctx,
    scale,
    { blend: sw.blend, distance: app.engine && app.view !== 'ready' ? app.engine.distance : now * 0.03, time: reducedMotion.matches ? 0 : now / 1000, muted: sw.muted },
    app.view === 'ready' ? null : app.engine,
    app.shake,
  );
  app.shake = Math.max(0, app.shake - 0.5);
  renderHud();
  requestAnimationFrame(frame);
}

// ---------- Shop ----------
const shop = $<HTMLDialogElement>('shop');
function openShop(message?: string): void {
  $('shop-note').textContent = message ?? 'Each run costs 1,000 test coins. Pick a pack to add it to this device.';
  $('shop-status').textContent = '';
  if (!shop.open) shop.showModal();
}
shop.querySelectorAll<HTMLButtonElement>('[data-pack]').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.disabled) return;
    b.disabled = true;
    const pack = Number(b.dataset.pack);
    const res = ledger.simulatePurchase(pack, newId());
    $('shop-status').textContent = res.ok ? `Added ${fmt.format(pack)} test coins. Balance ${fmt.format(res.data.balance)}.` : 'That purchase could not be simulated. Try again.';
    renderWallet(res.data);
    renderPanel();
    window.setTimeout(() => (b.disabled = false), 400);
  });
});
shop.addEventListener('close', () => {
  renderPanel();
});

// ---------- Events ----------
$('primary-btn').addEventListener('click', () => {
  if (performance.now() < app.claimLockUntil) return;
  const d = ledger.read();
  if (!d.claimed) {
    if (app.busy) return;
    app.busy = true;
    const res = ledger.claim();
    app.busy = false;
    app.claimLockUntil = performance.now() + 800;
    window.setTimeout(renderPanel, 820);
    renderWallet(res.data);
    renderPanel();
    if (res.ok) announce('5,000 free test coins added. Start a run when you are ready.');
    return;
  }
  startRun(app.mode);
});
$('again-btn').addEventListener('click', () => startRun(app.mode));
$('back-btn').addEventListener('click', () => {
  app.engine = null;
  setView('ready');
  $('primary-btn').focus();
});
$('mode-live').addEventListener('click', () => {
  app.mode = 'live';
  renderPanel();
});
$('mode-practice').addEventListener('click', () => {
  app.mode = 'practice';
  renderPanel();
});
$('mode-live').addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
    ev.preventDefault();
    app.mode = 'practice';
    renderPanel();
    $('mode-practice').focus();
  }
});
$('mode-practice').addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    app.mode = 'live';
    renderPanel();
    $('mode-live').focus();
  }
});
$('resume-btn').addEventListener('click', resume);
$('transfer-btn').addEventListener('click', transferToPractice);
$('pause-btn').addEventListener('click', () => pause('user'));
$('shop-btn').addEventListener('click', () => openShop());
$('help-btn').addEventListener('click', () => {
  if (app.view === 'running') pause('user');
  $<HTMLDialogElement>('help').showModal();
});
$('sound-btn').addEventListener('click', () => {
  sound.enabled = !sound.enabled;
  $('sound-btn').textContent = sound.enabled ? 'Sound on' : 'Sound off';
  $('sound-btn').setAttribute('aria-pressed', String(sound.enabled));
  if (sound.enabled) sound.play('coin');
});

// Jump button: pointerdown for low-latency touch; keyboard activation arrives as a click with detail 0.
const jumpBtn = $('jump-btn');
jumpBtn.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  jump();
});
jumpBtn.addEventListener('click', (ev) => {
  if ((ev as MouseEvent).detail === 0) jump();
});
stage.addEventListener('pointerdown', (ev) => {
  if (app.view !== 'running') return;
  ev.preventDefault();
  jump();
});

const INTERACTIVE = 'button, a, input, select, textarea, summary, [role="radio"]';
window.addEventListener('keydown', (ev) => {
  if (document.querySelector('dialog[open]')) return;
  const target = ev.target as HTMLElement | null;
  const onControl = !!target?.closest?.(INTERACTIVE);
  if (ev.code === 'KeyP' && !ev.repeat && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
    if (app.view === 'running') pause('user');
    else if (app.view === 'paused') resume();
    return;
  }
  if (ev.code === 'Space' || ev.code === 'ArrowUp' || ev.code === 'KeyW') {
    if (onControl || app.view !== 'running') return; // keep native activation on buttons and links
    ev.preventDefault();
    if (!ev.repeat) jump();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause('hidden');
});
window.addEventListener('storage', () => {
  renderWallet();
  renderPanel();
});

window.setInterval(() => {
  renderTelemetry();
  if (app.view === 'ready' || app.view === 'paused' || app.view === 'results') renderPanel();
}, 1000);

// ---------- Boot ----------
renderWallet();
setView('ready');
poller.start();
requestAnimationFrame(frame);

// Test hook for automated interaction checks (read-only state + controls the player already has).
(window as unknown as { __squeek: unknown }).__squeek = {
  state: () => ({ view: app.view, mode: app.mode, pauseReason: app.pauseReason, engine: app.engine, ledger: ledger.read(), signal: signalState() }),
  poller,
};
