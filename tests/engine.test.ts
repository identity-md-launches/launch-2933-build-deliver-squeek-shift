import { describe, expect, it } from 'vitest';
import {
  GROUND_Y,
  INVULN_SECONDS,
  LEVEL_SECONDS,
  PLAYER,
  RUN_SECONDS,
  advance,
  createEngine,
  hitbox,
  playerBox,
  pressJump,
  setWorld,
  step,
  FIXED_DT,
  type EngineState,
  type RunMode,
  type World,
} from '../src/engine';

/** Deep copy of plain engine state for look-ahead simulation. */
const clone = (s: EngineState): EngineState => ({
  ...s,
  hazards: s.hazards.map((h) => ({ ...h })),
  coinsList: [],
  events: [],
});

/** Is any unhit hazard close enough ahead to matter within the horizon? */
function threatAhead(s: EngineState, seconds: number): boolean {
  const reach = PLAYER.x + PLAYER.w + s.speed * seconds;
  return s.hazards.some((h) => !h.hit && h.x < reach && h.x + h.w > PLAYER.x - 4);
}

function hitsWithin(s: EngineState, seconds: number, policy?: (c: EngineState) => void): boolean {
  const c = clone(s);
  c.invuln = 0;
  const hearts = c.hearts;
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n && !c.finished; i++) {
    policy?.(c);
    step(c, FIXED_DT);
    if (c.hearts < hearts) return true;
  }
  return false;
}

/**
 * Planning bot: at each tick it only jumps when waiting would lead to a hit, and it picks
 * the first plan (jump now, optional double jump at some delay) that clears the next 1.6 s.
 * If no plan exists the pattern is unfair: that is what the fairness test catches.
 */
function botTick(s: EngineState): void {
  if (!threatAhead(s, 1.2)) return;
  if (s.grounded) {
    if (!hitsWithin(s, 0.9)) return;
    // try to delay as long as possible: jump only if waiting one more tick is worse
    const plans = planOptions();
    const waitOne = clone(s);
    step(waitOne, FIXED_DT);
    const canWait = waitOne.hearts === s.hearts && plans.some((p) => planSafe(waitOne, p));
    if (canWait) return;
    for (const p of plans) {
      if (planSafe(s, p)) {
        pressJump(s);
        return;
      }
    }
    pressJump(s); // nothing safe found: jump anyway (test will register the hit)
  } else if (s.jumpsUsed === 1) {
    if (hitsWithin(s, 1.2)) {
      const after = clone(s);
      pressJump(after);
      if (!hitsWithin(after, 1.2)) pressJump(s);
    }
  }
}

function planOptions(): number[] {
  // -1 = single jump only; otherwise double-jump delay in seconds
  return [-1, 0.15, 0.22, 0.3, 0.38, 0.46, 0.55];
}

function planSafe(s: EngineState, plan: number): boolean {
  const c = clone(s);
  c.invuln = 0;
  const hearts = c.hearts;
  pressJump(c);
  let t = 0;
  let doubled = false;
  for (let i = 0; i < Math.round(1.6 / FIXED_DT) && !c.finished; i++) {
    if (plan >= 0 && !doubled && t >= plan) {
      pressJump(c);
      doubled = true;
    }
    step(c, FIXED_DT);
    t += FIXED_DT;
    if (c.hearts < hearts) return false;
    if (c.grounded && t > 0.1) {
      // landed: must still be able to handle what comes next without an immediate forced hit
      return true;
    }
  }
  return true;
}

function playRun(seed: number, mode: RunMode, world: World, flipEvery?: number) {
  const s = createEngine({ seed, mode, world });
  let flips = 0;
  while (!s.finished) {
    if (flipEvery && Math.floor(s.time / flipEvery) !== flips) {
      flips = Math.floor(s.time / flipEvery);
      setWorld(s, flips % 2 ? 'dream' : 'day');
    }
    botTick(s);
    const hb = s.hearts;
    step(s, FIXED_DT);
    if (s.hearts < hb) console.log(`HIT seed=${seed} t=${s.time.toFixed(2)} world=${s.world} lvl=${s.level} speed=${s.speed.toFixed(0)} py=${s.py.toFixed(0)} vy=${s.vy.toFixed(0)} j=${s.jumpsUsed} hz=${JSON.stringify(s.hazards.filter((h) => h.x < 400).map((h) => [h.kind, Math.round(h.x), Math.round(h.y), h.w, h.h]))}`);
  }
  return s;
}

describe('timer and difficulty', () => {
  it('runs exactly 75 active seconds at 10 FPS with substeps', () => {
    const s = createEngine({ seed: 7, mode: 'practice', world: 'day' });
    s.hearts = 1e9; // ignore hits for timing
    let frames = 0;
    while (!s.finished) {
      advance(s, 0.1);
      frames++;
    }
    expect(s.result?.reason).toBe('time');
    expect(s.result?.activeSeconds).toBeCloseTo(RUN_SECONDS, 1);
    expect(frames).toBeGreaterThanOrEqual(749);
    expect(frames).toBeLessThanOrEqual(751);
  });

  it('clamps a stall frame to 250 ms so a hitch never skips time', () => {
    const s = createEngine({ seed: 7, mode: 'practice', world: 'day' });
    advance(s, 5);
    expect(s.time).toBeLessThanOrEqual(0.26);
  });

  it('steps through five levels every 15 seconds with rising speed', () => {
    const s = createEngine({ seed: 3, mode: 'live', world: 'day' });
    s.hearts = 1e9;
    const levels: number[] = [];
    const speeds: number[] = [];
    while (!s.finished) {
      step(s, FIXED_DT);
      if (levels[levels.length - 1] !== s.level) levels.push(s.level);
      if (Math.abs((s.time % LEVEL_SECONDS) - 14) < FIXED_DT / 2) speeds.push(s.speed);
    }
    expect(levels).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeGreaterThan(speeds[i - 1]);
  });

  it('practice shifts day and dream every 20 seconds', () => {
    const s = createEngine({ seed: 1, mode: 'practice', world: 'day' });
    s.hearts = 1e9;
    const worlds: string[] = [];
    while (s.time < 61) {
      step(s, FIXED_DT);
      if (worlds[worlds.length - 1] !== s.world) worlds.push(s.world);
    }
    expect(worlds).toEqual(['day', 'dream', 'day', 'dream']);
  });

  it('dream world is slower with lower gravity than day', () => {
    const d = createEngine({ seed: 1, mode: 'live', world: 'day' });
    const n = createEngine({ seed: 1, mode: 'live', world: 'dream' });
    pressJump(d);
    pressJump(n);
    let td = 0;
    let tn = 0;
    while (!d.grounded || td === 0) (step(d, FIXED_DT), (td += FIXED_DT));
    while (!n.grounded || tn === 0) (step(n, FIXED_DT), (tn += FIXED_DT));
    expect(tn).toBeGreaterThan(td);
    expect(n.speed).toBeLessThan(d.speed);
  });
});

describe('jumping', () => {
  it('allows one double jump in the air and lands with a squash animation', () => {
    const s = createEngine({ seed: 1, mode: 'live', world: 'day' });
    expect(pressJump(s)).toBe(true);
    for (let i = 0; i < 40; i++) step(s, FIXED_DT);
    expect(pressJump(s)).toBe(true);
    expect(pressJump(s)).toBe(false);
    let peak = GROUND_Y;
    while (!s.grounded) {
      step(s, FIXED_DT);
      peak = Math.min(peak, s.py);
    }
    expect(GROUND_Y - peak).toBeGreaterThan(200);
    expect(s.landTimer).toBeGreaterThan(0);
  });
});

describe('collisions', () => {
  it('every hitbox lies inside its visible hazard', () => {
    for (const world of ['day', 'dream'] as const) {
      const s = createEngine({ seed: 11, mode: 'live', world });
      s.hearts = 1e9;
      for (let i = 0; i < 120 * 60; i++) {
        step(s, FIXED_DT);
        for (const h of s.hazards) {
          const b = hitbox(h);
          expect(b.x).toBeGreaterThanOrEqual(h.x);
          expect(b.y).toBeGreaterThanOrEqual(h.y);
          expect(b.x + b.w).toBeLessThanOrEqual(h.x + h.w);
          expect(b.y + b.h).toBeLessThanOrEqual(h.y + h.h + 1e-9);
        }
      }
    }
  });

  it('player hitbox is inside the drawn hamster body', () => {
    const s = createEngine({ seed: 1, mode: 'live', world: 'day' });
    const b = playerBox(s);
    expect(b.x).toBeGreaterThanOrEqual(PLAYER.x);
    expect(b.x + b.w).toBeLessThanOrEqual(PLAYER.x + PLAYER.w);
  });

  it('a hit costs one heart and grants 1.8 s of invulnerability', () => {
    const s = createEngine({ seed: 5, mode: 'live', world: 'day' });
    // run into hazards without jumping
    let hitAt = -1;
    while (s.hearts === 3 && s.time < 30) step(s, FIXED_DT);
    hitAt = s.time;
    expect(s.hearts).toBe(2);
    expect(s.invuln).toBeCloseTo(INVULN_SECONDS, 1);
    while (s.time < hitAt + INVULN_SECONDS - 0.02) {
      step(s, FIXED_DT);
      expect(s.hearts).toBe(2);
    }
  });

  it('three hits end the run with the engine result preserving best combo', () => {
    const s = createEngine({ seed: 5, mode: 'live', world: 'day' });
    while (!s.finished) step(s, FIXED_DT);
    expect(s.result?.reason).toBe('hearts');
    expect(s.result?.heartsLeft).toBe(0);
    expect(s.result?.bestCombo).toBe(s.bestCombo);
    expect(s.result?.coinsEarned).toBe(s.coins * 100);
  });
});

describe('fairness: every pattern is clearable with a double jump', () => {
  const seeds = Array.from({ length: 10 }, (_, i) => 1000 + i * 37);
  for (const world of ['day', 'dream'] as const) {
    it(`bot clears all five levels without a hit in the ${world} world`, () => {
      for (const seed of seeds) {
        const s = playRun(seed, 'live', world);
        expect({ seed, world, hearts: s.hearts, reason: s.result?.reason }).toEqual({ seed, world, hearts: 3, reason: 'time' });
        expect(s.level).toBe(5);
      }
    });
  }
  it('bot clears practice runs that swap worlds mid-pattern', () => {
    for (const seed of seeds.slice(0, 6)) {
      const s = playRun(seed, 'practice', 'day');
      expect({ seed, hearts: s.hearts }).toEqual({ seed, hearts: 3 });
    }
  });
  it('bot clears live runs whose wheel state flips every 7 seconds', () => {
    for (const seed of seeds.slice(0, 6)) {
      const s = playRun(seed, 'live', 'day', 7);
      expect({ seed, hearts: s.hearts }).toEqual({ seed, hearts: 3 });
    }
  });
  it('bot collects coins and builds combos', () => {
    const s = playRun(4242, 'live', 'day');
    expect(s.coins).toBeGreaterThan(5);
    expect(s.bestCombo).toBeGreaterThan(1);
  });
});
