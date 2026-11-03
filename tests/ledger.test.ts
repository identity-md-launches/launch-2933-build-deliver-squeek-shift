import { describe, expect, it } from 'vitest';
import { ENTRY_COST, FREE_CLAIM, Ledger, STORAGE_KEY, type KV } from '../src/ledger';
import type { RunResult } from '../src/engine';

function memKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

const result = (coins: number, score = 1234, combo = 4): RunResult => ({
  score,
  coinsCollected: coins,
  coinsEarned: coins * 100,
  bestCombo: combo,
  heartsLeft: 1,
  activeSeconds: 75,
  levelReached: 5,
  reason: 'time',
});

describe('ledger', () => {
  it('claims 5,000 exactly once, even across reloads', () => {
    const kv = memKV();
    const a = new Ledger(kv);
    expect(a.read().balance).toBe(0);
    expect(a.claim().ok).toBe(true);
    expect(a.claim().error).toBe('already-claimed');
    const reloaded = new Ledger(kv);
    expect(reloaded.claim().ok).toBe(false);
    expect(reloaded.read().balance).toBe(FREE_CLAIM);
  });

  it('debits 1,000 once per run id and refuses insufficient balance', () => {
    const l = new Ledger(memKV());
    expect(l.startRun('r0', 'live').error).toBe('insufficient');
    l.claim();
    expect(l.startRun('r1', 'live').ok).toBe(true);
    expect(l.startRun('r1', 'live').error).toBe('duplicate'); // double click
    expect(l.read().balance).toBe(FREE_CLAIM - ENTRY_COST);
    for (let i = 2; i <= 5; i++) l.startRun(`r${i}`, 'practice');
    expect(l.read().balance).toBe(0);
    expect(l.startRun('r6', 'practice').error).toBe('insufficient');
    expect(l.read().balance).toBe(0);
  });

  it('credits earnings once, ignoring repeated finish callbacks', () => {
    const l = new Ledger(memKV());
    l.claim();
    l.startRun('r1', 'live');
    expect(l.finishRun('r1', result(7)).ok).toBe(true);
    expect(l.finishRun('r1', result(7)).ok).toBe(false);
    expect(l.read().balance).toBe(FREE_CLAIM - ENTRY_COST + 700);
  });

  it('keeps live and practice records separate', () => {
    const l = new Ledger(memKV());
    l.claim();
    l.startRun('a', 'live');
    l.finishRun('a', result(3, 900, 3));
    l.startRun('b', 'practice');
    l.finishRun('b', result(9, 4000, 9));
    const d = l.read();
    expect(d.bests.live).toEqual({ score: 900, coins: 300, combo: 3, runs: 1 });
    expect(d.bests.practice).toEqual({ score: 4000, coins: 900, combo: 9, runs: 1 });
  });

  it('simulated purchases add packs once per operation id', () => {
    const l = new Ledger(memKV());
    expect(l.simulatePurchase(15000, 'op1').ok).toBe(true);
    expect(l.simulatePurchase(15000, 'op1').error).toBe('duplicate');
    expect(l.simulatePurchase(999, 'op2').error).toBe('invalid');
    expect(l.simulatePurchase(50000, 'op3').ok).toBe(true);
    expect(l.read().balance).toBe(65000);
  });

  it('transfer to practice refunds the live entry once and charges practice once (net zero)', () => {
    const l = new Ledger(memKV());
    l.claim();
    l.startRun('live1', 'live');
    const before = l.read().balance;
    expect(l.transferToPractice('live1', 'prac1').ok).toBe(true);
    expect(l.read().balance).toBe(before);
    expect(l.transferToPractice('live1', 'prac2').ok).toBe(false); // no repeated refund
    expect(l.read().balance).toBe(before);
    expect(l.read().runs.live1.status).toBe('refunded');
    expect(l.finishRun('live1', result(50)).ok).toBe(false); // discarded unfinished earnings
    expect(l.finishRun('prac1', result(2)).ok).toBe(true);
    expect(l.read().balance).toBe(before + 200);
  });

  it('transfer is refused for practice or finished runs', () => {
    const l = new Ledger(memKV());
    l.claim();
    l.startRun('p', 'practice');
    expect(l.transferToPractice('p', 'x').ok).toBe(false);
    l.startRun('l', 'live');
    l.finishRun('l', result(1));
    expect(l.transferToPractice('l', 'y').ok).toBe(false);
  });

  it('abandons runs left active by a reload so they can never be credited', () => {
    const kv = memKV();
    const a = new Ledger(kv);
    a.claim();
    a.startRun('r1', 'live');
    a.abandonActive(); // this page's non-cached pagehide, before the reload
    const b = new Ledger(kv);
    b.abandonActive();
    expect(b.read().runs.r1.status).toBe('abandoned');
    expect(a.finishRun('r1', result(10)).ok).toBe(false);
    expect(b.read().balance).toBe(FREE_CLAIM - ENTRY_COST);
  });

  it('opening and closing another page preserves the first page’s run and earnings', () => {
    const kv = memKV();
    const a = new Ledger(kv, 'page-a');
    a.claim();
    a.startRun('r1', 'practice');
    const b = new Ledger(kv, 'page-b');
    b.startRun('r2', 'live');
    expect(b.finishRun('r1', result(3)).error).toBe('not-active');
    expect(b.transferToPractice('r1', 'wrong-owner').error).toBe('not-active');
    b.abandonActive();
    expect(a.read().runs.r1.status).toBe('active');
    expect(a.read().runs.r2.status).toBe('abandoned');
    expect(a.finishRun('r1', result(3, 73, 3)).ok).toBe(true);
    expect(a.finishRun('r1', result(3)).error).toBe('not-active');
    expect(a.read().balance).toBe(3300);
    expect(a.read().bests.practice).toEqual({ score: 73, coins: 300, combo: 3, runs: 1 });
  });

  it('a new page cannot credit or refund a crashed page’s unfinished run', () => {
    const kv = memKV();
    const a = new Ledger(kv, 'crashed-page');
    a.claim();
    a.startRun('orphan', 'live'); // no pagehide cleanup after a crash
    const b = new Ledger(kv, 'new-page');
    expect(b.finishRun('orphan', result(10)).error).toBe('not-active');
    expect(b.transferToPractice('orphan', 'bypass').error).toBe('not-active');
    expect(b.read().balance).toBe(4000);
  });

  it('treats corrupted storage as untrusted: never negative or NaN', () => {
    const kv = memKV();
    kv.set(STORAGE_KEY, JSON.stringify({ balance: -5, claimed: 'yes', bests: { live: { score: 'NaN' } } }));
    const l = new Ledger(kv);
    const d = l.read();
    expect(d.balance).toBe(0);
    expect(d.claimed).toBe(false);
    expect(d.bests.live.score).toBe(0);
    kv.set(STORAGE_KEY, '{not json');
    expect(new Ledger(kv).read().balance).toBe(0);
    kv.set(STORAGE_KEY, JSON.stringify({ balance: 1e400 }));
    expect(Number.isFinite(new Ledger(kv).read().balance)).toBe(true);
  });

  it('falls back to memory when storage is denied', () => {
    const denied: KV = {
      get: () => {
        throw new Error('SecurityError');
      },
      set: () => {
        throw new Error('SecurityError');
      },
    };
    const l = new Ledger(denied);
    expect(l.persistent).toBe(false);
    expect(l.claim().ok).toBe(true);
    expect(l.read().balance).toBe(FREE_CLAIM);
    expect(new Ledger(null).persistent).toBe(false);
  });

  for (const phase of ['claim', 'entry', 'reward', 'transfer'] as const) {
    it(`retains the current snapshot when storage starts failing at ${phase}`, () => {
      const kv = memKV();
      let denied = false;
      const l = new Ledger({ get: kv.get, set: (k, v) => {
        if (denied && k === STORAGE_KEY) throw new Error('QuotaExceededError');
        kv.set(k, v);
      } });
      expect(l.persistent).toBe(true);
      if (phase !== 'claim') l.claim();
      if (phase === 'reward' || phase === 'transfer') l.startRun('r1', 'live');
      denied = true;
      if (phase === 'claim') expect(l.claim().ok).toBe(true);
      if (phase === 'entry') expect(l.startRun('r1', 'live').ok).toBe(true);
      if (phase === 'reward') expect(l.finishRun('r1', result(3)).ok).toBe(true);
      if (phase === 'transfer') expect(l.transferToPractice('r1', 'p1').ok).toBe(true);
      expect(l.persistent).toBe(false);
      expect(l.read().balance).toBe(phase === 'claim' ? 5000 : phase === 'reward' ? 4300 : 4000);
      expect(l.claim().error).toBe('already-claimed');
      if (phase === 'entry') expect(l.startRun('r1', 'live').error).toBe('duplicate');
      if (phase === 'reward') expect(l.finishRun('r1', result(3)).error).toBe('not-active');
      if (phase === 'transfer') expect(l.transferToPractice('r1', 'p2').error).toBe('not-active');
      // A storage recovery or another tab's stale snapshot must not overwrite this page.
      denied = false;
      kv.set(STORAGE_KEY, JSON.stringify({ balance: 0, claimed: false }));
      expect(l.simulatePurchase(5000, 'pack').ok).toBe(true);
      expect(l.simulatePurchase(5000, 'pack').error).toBe('duplicate');
      expect(l.read().balance).toBe(phase === 'claim' ? 10000 : phase === 'reward' ? 9300 : 9000);
      expect(l.read().claimed).toBe(true);
      if (phase === 'reward') expect(l.read().bests.live.combo).toBe(4);
    });
  }

  it('uses its latest read snapshot if storage reads later become denied', () => {
    const kv = memKV();
    let denied = false;
    const l = new Ledger({ set: kv.set, get: (k) => {
      if (denied) throw new Error('SecurityError');
      return kv.get(k);
    } });
    l.claim();
    l.startRun('r1', 'practice');
    expect(l.read().balance).toBe(4000);
    denied = true;
    expect(l.read().balance).toBe(4000);
    expect(l.persistent).toBe(false);
    expect(l.finishRun('r1', result(3)).ok).toBe(true);
    expect(l.read().balance).toBe(4300);
  });
});
