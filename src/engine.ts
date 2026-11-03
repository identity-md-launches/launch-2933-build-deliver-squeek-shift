// Squeek Shift game engine: pure, deterministic simulation with fixed physics substeps.
// The renderer and UI only read from EngineState; nothing here touches the DOM.

export type World = 'day' | 'dream';
export type RunMode = 'live' | 'practice';

export const WORLD_W = 480;
export const WORLD_H = 300;
export const GROUND_Y = 252;
export const RUN_SECONDS = 75;
export const LEVEL_SECONDS = 15;
export const MAX_LEVEL = 5;
export const START_HEARTS = 3;
export const INVULN_SECONDS = 1.8;
export const COIN_VALUE = 100;
export const PRACTICE_SHIFT_SECONDS = 20;
export const FIXED_DT = 1 / 120;
export const MAGNET_SECONDS = 6;

export const PLAYER = { x: 72, w: 30, h: 26 } as const;

export interface Physics {
  gravity: number;
  jumpV: number;
  baseSpeed: number;
}

/** ACTIVE wheel: faster, normal gravity day lab. IDLE wheel: slower, low-gravity dream. */
export const PHYSICS: Record<World, Physics> = {
  day: { gravity: 2300, jumpV: 780, baseSpeed: 250 },
  dream: { gravity: 1350, jumpV: 600, baseSpeed: 190 },
};

/** Speed multiplier and spawn-gap scale per difficulty level 1..5. */
export const LEVELS = [
  { speed: 1.0, gap: 1.9 },
  { speed: 1.1, gap: 1.65 },
  { speed: 1.2, gap: 1.45 },
  { speed: 1.3, gap: 1.3 },
  { speed: 1.42, gap: 1.15 },
] as const;

export type HazardKind = 'spikes' | 'crate' | 'tallcrate' | 'mushroom' | 'floater';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Hazard {
  id: number;
  kind: HazardKind;
  /** Visible bounds (what is drawn). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Spike count for spike clusters. */
  n: number;
  /** Phase for floater bobbing. */
  phase: number;
  baseY: number;
  hit: boolean;
}

export interface Coin {
  id: number;
  x: number;
  y: number;
  taken: boolean;
  missed: boolean;
}

export interface EngineEvent {
  type: 'jump' | 'double' | 'land' | 'hit' | 'coin' | 'level' | 'world' | 'magnet' | 'finish';
  value?: number;
}

export interface RunResult {
  score: number;
  coinsCollected: number;
  coinsEarned: number;
  bestCombo: number;
  heartsLeft: number;
  activeSeconds: number;
  levelReached: number;
  reason: 'time' | 'hearts';
}

export interface EngineState {
  seed: number;
  rng: number;
  mode: RunMode;
  world: World;
  /** 0 (day) .. 1 (dream), eased for rendering and physics blending of speed. */
  worldBlend: number;
  time: number;
  acc: number;
  distance: number;
  speed: number;
  level: number;
  hearts: number;
  score: number;
  scoreFrac: number;
  coins: number;
  combo: number;
  bestCombo: number;
  invuln: number;
  magnet: number;
  landTimer: number;
  hitFlash: number;
  py: number;
  vy: number;
  grounded: boolean;
  jumpsUsed: number;
  /** Physics world of the current jump: a mid-air world shift applies from the next landing. */
  jumpWorld: World;
  hazards: Hazard[];
  coinsList: Coin[];
  nextSpawn: number;
  nextId: number;
  lastGroundEnd: number;
  events: EngineEvent[];
  finished: boolean;
  result: RunResult | null;
}

export function createEngine(opts: { seed: number; mode: RunMode; world: World }): EngineState {
  const s: EngineState = {
    seed: opts.seed >>> 0,
    rng: (opts.seed >>> 0) || 1,
    mode: opts.mode,
    world: opts.world,
    worldBlend: opts.world === 'dream' ? 1 : 0,
    time: 0,
    acc: 0,
    distance: 0,
    speed: PHYSICS[opts.world].baseSpeed,
    level: 1,
    hearts: START_HEARTS,
    score: 0,
    scoreFrac: 0,
    coins: 0,
    combo: 0,
    bestCombo: 0,
    invuln: 0,
    magnet: 0,
    landTimer: 0,
    hitFlash: 0,
    py: GROUND_Y,
    vy: 0,
    grounded: true,
    jumpsUsed: 0,
    jumpWorld: opts.world,
    hazards: [],
    coinsList: [],
    nextSpawn: WORLD_W + 80,
    nextId: 1,
    lastGroundEnd: -1e9,
    events: [],
    finished: false,
    result: null,
  };
  return s;
}

function rand(s: EngineState): number {
  // xorshift32, deterministic per seed
  let x = s.rng;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  s.rng = x || 1;
  return (s.rng % 1_000_000) / 1_000_000;
}

export function levelFor(time: number): number {
  return Math.min(MAX_LEVEL, Math.floor(time / LEVEL_SECONDS) + 1);
}

export function practiceWorldAt(time: number): World {
  return Math.floor(time / PRACTICE_SHIFT_SECONDS) % 2 === 0 ? 'day' : 'dream';
}

export function targetSpeed(world: World, level: number): number {
  return PHYSICS[world].baseSpeed * LEVELS[level - 1].speed;
}

/** Full single-jump airtime for a world. */
export function airtime(world: World): number {
  const p = PHYSICS[world];
  return (2 * p.jumpV) / p.gravity;
}

/** Hitbox for a hazard: always inside its visible bounds. */
export function hitbox(h: Hazard): Box {
  switch (h.kind) {
    case 'spikes':
      // Triangular tips are narrow; trim the sides and the top so contact needs a real overlap.
      return { x: h.x + 4, y: h.y + 6, w: h.w - 8, h: h.h - 6 };
    case 'floater':
      return { x: h.x + 4, y: h.y + 4, w: h.w - 8, h: h.h - 8 };
    default:
      return { x: h.x + 3, y: h.y + 3, w: h.w - 6, h: h.h - 3 };
  }
}

export function playerBox(s: EngineState): Box {
  return { x: PLAYER.x + 3, y: s.py - PLAYER.h + 3, w: PLAYER.w - 6, h: PLAYER.h - 3 };
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Queue a jump press. Returns true when the press caused a jump or double jump. */
export function pressJump(s: EngineState): boolean {
  if (s.finished) return false;
  if (s.grounded) {
    s.jumpWorld = s.world;
  }
  const p = PHYSICS[s.jumpWorld];
  if (s.grounded) {
    s.vy = -p.jumpV;
    s.grounded = false;
    s.jumpsUsed = 1;
    s.events.push({ type: 'jump' });
    return true;
  }
  if (s.jumpsUsed < 2) {
    s.vy = -p.jumpV;
    s.jumpsUsed = 2;
    s.events.push({ type: 'double' });
    return true;
  }
  return false;
}

export function setWorld(s: EngineState, world: World): void {
  if (s.world !== world) {
    s.world = world;
    s.events.push({ type: 'world' });
  }
}

export function startMagnet(s: EngineState, seconds = MAGNET_SECONDS): void {
  if (s.finished) return;
  s.magnet = Math.max(s.magnet, seconds);
  s.events.push({ type: 'magnet' });
}

function addHazard(s: EngineState, kind: HazardKind, x: number, n = 1, y?: number): Hazard {
  let w = 30;
  let h = 34;
  if (kind === 'spikes') {
    w = 18 * n;
    h = 22;
  } else if (kind === 'tallcrate') {
    h = 50;
  } else if (kind === 'mushroom') {
    w = 32;
    h = 30;
  } else if (kind === 'floater') {
    w = 26;
    h = 26;
  }
  const top = y ?? GROUND_Y - h;
  const hz: Hazard = { id: s.nextId++, kind, x, y: top, w, h, n, phase: rand(s) * Math.PI * 2, baseY: top, hit: false };
  s.hazards.push(hz);
  if (kind !== 'floater') s.lastGroundEnd = Math.max(s.lastGroundEnd, x + w);
  return hz;
}

function addCoin(s: EngineState, x: number, y: number): void {
  s.coinsList.push({ id: s.nextId++, x, y, taken: false, missed: false });
}

/** Coin arc following a natural single-jump path over a hazard centred at cx. */
function coinArc(s: EngineState, cx: number, peakY: number, count = 3): void {
  const spread = 26;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    addCoin(s, cx + t * spread * (count - 1) * 0.5, peakY + Math.abs(t) * 18);
  }
}

/**
 * Spawn the next pattern at world x >= s.nextSpawn. Every pattern is clearable:
 * consecutive ground groups start at least one full single-jump airtime apart (plus margin),
 * any wider group fits inside a double jump, and floaters leave running clearance under them
 * and never share a jump window with a ground hazard.
 */
function spawnPattern(s: EngineState): void {
  const world = s.world;
  const level = s.level;
  const speed = targetSpeed(world, level);
  const T1 = airtime(world);
  const minStep = speed * T1 + 64; // start-to-start spacing that always allows land + re-jump
  let x0 = s.nextSpawn;
  const r = rand(s);
  const ground = world === 'day' ? 'crate' : 'mushroom';
  let groupEnd = x0;

  const roll = (opts: Array<[number, () => void]>) => {
    const total = opts.reduce((a, o) => a + o[0], 0);
    let v = r * total;
    for (const [wgt, fn] of opts) {
      if ((v -= wgt) <= 0) return fn();
    }
    opts[opts.length - 1][1]();
  };

  roll([
    [3, () => {
      // Spike cluster of 1..3 (wider with level)
      const n = 1 + Math.floor(rand(s) * Math.min(3, 1 + level));
      const h = addHazard(s, 'spikes', x0, n);
      coinArc(s, x0 + h.w / 2, GROUND_Y - 118, 3);
      groupEnd = x0 + h.w;
    }],
    [2, () => {
      const h = addHazard(s, ground, x0);
      coinArc(s, x0 + h.w / 2, GROUND_Y - 128, 3);
      groupEnd = x0 + h.w;
    }],
    [level >= 2 ? 2 : 0, () => {
      // Ground coin line, then an obstacle one safe step later
      for (let i = 0; i < 4; i++) addCoin(s, x0 + i * 28, GROUND_Y - 16);
      const hx = x0 + Math.max(minStep, 150);
      const h = addHazard(s, level >= 3 && world === 'day' ? 'tallcrate' : 'spikes', hx, 2);
      coinArc(s, hx + h.w / 2, GROUND_Y - 130, 3);
      groupEnd = hx + h.w;
    }],
    [level >= 3 ? 2 : 0, () => {
      // Twin cluster: needs a double jump, span bounded by double-jump reach at this speed.
      // A lead-in run-up of a quarter second lets the player land and take off in time.
      x0 += speed * 0.3;
      const n1 = 2;
      const n2 = 1 + Math.floor(rand(s) * 2);
      const span = Math.min(speed * 0.5, 190);
      const a = addHazard(s, 'spikes', x0, n1);
      const bx = x0 + span - 18 * n2;
      addHazard(s, 'spikes', Math.max(bx, a.x + a.w + 40), n2);
      for (let i = 0; i < 4; i++) addCoin(s, x0 + (span * (i + 0.5)) / 4, GROUND_Y - 190 + Math.abs(i - 1.5) * 12);
      groupEnd = Math.max(bx, a.x + a.w + 40) + 18 * n2;
    }],
    [world === 'dream' ? 3 : 0, () => {
      // Dream floater: run under it (low) or stay low while it drifts (high). Coins under it.
      const low = rand(s) < 0.6;
      const cy = low ? GROUND_Y - 70 : GROUND_Y - 150;
      addHazard(s, 'floater', x0, 1, cy - 13);
      if (low) for (let i = 0; i < 3; i++) addCoin(s, x0 - 20 + i * 26, GROUND_Y - 14);
      else for (let i = 0; i < 3; i++) addCoin(s, x0 - 20 + i * 26, GROUND_Y - 60);
      groupEnd = x0 + 26;
      // keep the next ground hazard out of this jump window on both sides
    }],
  ]);

  const gapScale = LEVELS[level - 1].gap;
  const extra = rand(s) * speed * 0.35 * gapScale;
  s.nextSpawn = groupEnd + Math.max(minStep, minStep * gapScale * 0.75) + extra;
}

/** One fixed physics substep. */
export function step(s: EngineState, dt: number): void {
  if (s.finished) return;
  s.time += dt;
  const lvl = levelFor(s.time);
  if (lvl !== s.level) {
    s.level = lvl;
    s.events.push({ type: 'level', value: lvl });
  }
  if (s.mode === 'practice') setWorld(s, practiceWorldAt(s.time));

  const target = targetSpeed(s.world, s.level);
  s.speed += (target - s.speed) * Math.min(1, dt * 2.5);
  const blendTarget = s.world === 'dream' ? 1 : 0;
  s.worldBlend += (blendTarget - s.worldBlend) * Math.min(1, dt * 2);

  const dx = s.speed * dt;
  s.distance += dx;

  // Player physics (the jump keeps the gravity it started with)
  const p = PHYSICS[s.grounded ? s.world : s.jumpWorld];
  if (!s.grounded) {
    s.vy += p.gravity * dt;
    s.py += s.vy * dt;
    if (s.py >= GROUND_Y) {
      s.py = GROUND_Y;
      s.vy = 0;
      s.grounded = true;
      s.jumpsUsed = 0;
      s.landTimer = 0.14;
      s.events.push({ type: 'land' });
    }
  }
  s.landTimer = Math.max(0, s.landTimer - dt);
  s.invuln = Math.max(0, s.invuln - dt);
  s.hitFlash = Math.max(0, s.hitFlash - dt);
  s.magnet = Math.max(0, s.magnet - dt);

  // Scroll world
  s.nextSpawn -= dx;
  s.lastGroundEnd -= dx;
  for (const h of s.hazards) {
    h.x -= dx;
    if (h.kind === 'floater') h.y = h.baseY + Math.sin(s.time * 2.2 + h.phase) * 8;
  }
  for (const c of s.coinsList) c.x -= dx;
  while (s.nextSpawn < WORLD_W + 60) spawnPattern(s);

  // Collisions
  const pb = playerBox(s);
  if (s.invuln <= 0) {
    for (const h of s.hazards) {
      if (h.hit) continue;
      if (overlap(pb, hitbox(h))) {
        h.hit = true;
        s.hearts -= 1;
        s.invuln = INVULN_SECONDS;
        s.hitFlash = 0.35;
        s.combo = 0;
        s.events.push({ type: 'hit', value: s.hearts });
        break;
      }
    }
  }

  // Coins (with optional magnet pull)
  const pcx = PLAYER.x + PLAYER.w / 2;
  const pcy = s.py - PLAYER.h / 2;
  for (const c of s.coinsList) {
    if (c.taken || c.missed) continue;
    if (s.magnet > 0) {
      const ddx = pcx - c.x;
      const ddy = pcy - c.y;
      const d = Math.hypot(ddx, ddy);
      if (d < 190 && d > 0.001) {
        const pull = Math.min(d, 520 * dt);
        c.x += (ddx / d) * pull;
        c.y += (ddy / d) * pull;
      }
    }
    if (Math.abs(c.x - pcx) < 22 && Math.abs(c.y - pcy) < 24) {
      c.taken = true;
      s.coins += 1;
      s.combo += 1;
      s.bestCombo = Math.max(s.bestCombo, s.combo);
      s.score += 50 * Math.min(s.combo, 10);
      s.events.push({ type: 'coin', value: s.combo });
    } else if (c.x < PLAYER.x - 30) {
      c.missed = true;
      s.combo = 0;
    }
  }

  // Distance score: 10 points per active second
  s.scoreFrac += dt * 10;
  if (s.scoreFrac >= 1) {
    const whole = Math.floor(s.scoreFrac);
    s.score += whole;
    s.scoreFrac -= whole;
  }

  s.hazards = s.hazards.filter((h) => h.x + h.w > -60);
  s.coinsList = s.coinsList.filter((c) => c.x > -60 && !(c.taken && c.x < -10));

  if (s.hearts <= 0) finish(s, 'hearts');
  else if (s.time >= RUN_SECONDS - 1e-9) finish(s, 'time');
}

function finish(s: EngineState, reason: 'time' | 'hearts'): void {
  if (s.finished) return;
  s.finished = true;
  s.time = Math.min(s.time, RUN_SECONDS);
  s.result = {
    score: s.score,
    coinsCollected: s.coins,
    coinsEarned: s.coins * COIN_VALUE,
    bestCombo: s.bestCombo,
    heartsLeft: Math.max(0, s.hearts),
    activeSeconds: Math.round(s.time * 1000) / 1000,
    levelReached: s.level,
    reason,
  };
  s.events.push({ type: 'finish' });
}

/**
 * Advance by a real frame delta using fixed substeps. The caller must not pass stalls:
 * frames over the stall limit are handled by pausing in the UI, so here dt is clamped
 * defensively to 0.25 s. Returns substeps run.
 */
export function advance(s: EngineState, frameDt: number): number {
  if (s.finished) return 0;
  const dt = Math.max(0, Math.min(frameDt, 0.25));
  s.acc += dt;
  let n = 0;
  while (s.acc >= FIXED_DT - 1e-12 && !s.finished) {
    // never run past the end of the run
    step(s, FIXED_DT);
    s.acc -= FIXED_DT;
    n++;
  }
  return n;
}

export function timeLeft(s: EngineState): number {
  return Math.max(0, RUN_SECONDS - s.time);
}

export function drainEvents(s: EngineState): EngineEvent[] {
  const e = s.events;
  s.events = [];
  return e;
}
