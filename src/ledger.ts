// Device-local, idempotent test-coin ledger. Test coins only: no real payment, no redemption.
// Data lives in this browser's localStorage, so it is untrusted and is not a secure economy.

import type { RunMode, RunResult } from './engine';

export const ENTRY_COST = 1000;
export const FREE_CLAIM = 5000;
export const PACKS = [5000, 15000, 50000] as const;
export const STORAGE_KEY = 'squeek-shift:ledger:v1';

export type RunStatus = 'active' | 'finished' | 'refunded' | 'abandoned';

export interface RunRecord {
  id: string;
  /** A new owner for each loaded page; other tabs cannot abandon or finish this run. */
  ownerId: string | null;
  mode: RunMode;
  status: RunStatus;
  cost: number;
  credited: number;
  startedAt: number;
}

export interface Best {
  score: number;
  coins: number;
  combo: number;
  runs: number;
}

export interface LedgerData {
  version: 1;
  balance: number;
  claimed: boolean;
  runs: Record<string, RunRecord>;
  ops: string[];
  bests: Record<RunMode, Best>;
}

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function emptyBest(): Best {
  return { score: 0, coins: 0, combo: 0, runs: 0 };
}

export function emptyLedger(): LedgerData {
  return { version: 1, balance: 0, claimed: false, runs: {}, ops: [], bests: { live: emptyBest(), practice: emptyBest() } };
}

const nat = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Parse untrusted stored JSON into a valid ledger; anything malformed falls back to safe values. */
export function sanitize(raw: unknown): LedgerData {
  const d = emptyLedger();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  d.balance = nat(r.balance);
  d.claimed = r.claimed === true;
  if (Array.isArray(r.ops)) d.ops = r.ops.filter((o): o is string => typeof o === 'string').slice(-200);
  if (r.runs && typeof r.runs === 'object') {
    const entries = Object.entries(r.runs as Record<string, unknown>).slice(-60);
    for (const [id, v] of entries) {
      if (!v || typeof v !== 'object') continue;
      const x = v as Record<string, unknown>;
      const status = ['active', 'finished', 'refunded', 'abandoned'].includes(x.status as string) ? (x.status as RunStatus) : 'abandoned';
      const mode: RunMode = x.mode === 'practice' ? 'practice' : 'live';
      d.runs[id] = { id, ownerId: typeof x.ownerId === 'string' ? x.ownerId : null, mode, status, cost: nat(x.cost), credited: nat(x.credited), startedAt: nat(x.startedAt) };
    }
  }
  const b = r.bests as Record<string, unknown> | undefined;
  for (const m of ['live', 'practice'] as const) {
    const s = (b && typeof b === 'object' ? (b[m] as Record<string, unknown>) : undefined) ?? {};
    d.bests[m] = { score: nat(s.score), coins: nat(s.coins), combo: nat(s.combo), runs: nat(s.runs) };
  }
  return d;
}

export type LedgerError = 'insufficient' | 'duplicate' | 'not-active' | 'already-claimed' | 'invalid';

export interface OpResult {
  ok: boolean;
  error?: LedgerError;
  data: LedgerData;
}

export class Ledger {
  private memory: string | null = null;
  private storageAvailable: boolean;

  constructor(private kv: KV | null, private readonly ownerId: string = crypto.randomUUID()) {
    let ok = false;
    if (kv) {
      try {
        const probe = '__squeek_probe__';
        kv.set(probe, '1');
        ok = kv.get(probe) === '1';
      } catch {
        ok = false;
      }
    }
    this.storageAvailable = ok;
  }

  get persistent(): boolean {
    return this.storageAvailable;
  }

  read(): LedgerData {
    let text: string | null = null;
    if (this.persistent && this.kv) {
      try {
        text = this.kv.get(STORAGE_KEY);
        this.memory = text;
      } catch {
        this.storageAvailable = false;
        text = this.memory;
      }
    } else text = this.memory;
    if (!text) return emptyLedger();
    try {
      return sanitize(JSON.parse(text));
    } catch {
      return emptyLedger();
    }
  }

  private write(d: LedgerData): void {
    const text = JSON.stringify(d);
    this.memory = text;
    if (this.persistent && this.kv) {
      try {
        this.kv.set(STORAGE_KEY, text);
      } catch {
        // Stay on the current snapshot for this page, even if storage later recovers.
        this.storageAvailable = false;
      }
    }
  }

  /** Read-modify-write on the freshest stored copy so other tabs' changes are not lost. */
  private tx(fn: (d: LedgerData) => LedgerError | null): OpResult {
    const d = this.read();
    const err = fn(d);
    if (err) return { ok: false, error: err, data: d };
    if (!(Number.isSafeInteger(d.balance) && d.balance >= 0)) return { ok: false, error: 'invalid', data: this.read() };
    this.write(d);
    return { ok: true, data: d };
  }

  /** One-time free claim. Never grants twice. */
  claim(): OpResult {
    return this.tx((d) => {
      if (d.claimed) return 'already-claimed';
      d.claimed = true;
      d.balance += FREE_CLAIM;
      return null;
    });
  }

  /** Simulated purchase; opId de-duplicates double clicks. No real payment happens. */
  simulatePurchase(pack: number, opId: string): OpResult {
    return this.tx((d) => {
      if (!(PACKS as readonly number[]).includes(pack)) return 'invalid';
      if (d.ops.includes(opId)) return 'duplicate';
      d.ops.push(opId);
      d.ops = d.ops.slice(-200);
      d.balance += pack;
      return null;
    });
  }

  /** Debit the entry once for a run id. A repeated call for the same id is a no-op. */
  startRun(runId: string, mode: RunMode, now = Date.now()): OpResult {
    return this.tx((d) => {
      if (d.runs[runId]) return 'duplicate';
      if (d.balance < ENTRY_COST) return 'insufficient';
      d.balance -= ENTRY_COST;
      d.runs[runId] = { id: runId, ownerId: this.ownerId, mode, status: 'active', cost: ENTRY_COST, credited: 0, startedAt: now };
      pruneRuns(d);
      return null;
    });
  }

  /** Credit earned coins exactly once for an active run; repeated finish callbacks are ignored. */
  finishRun(runId: string, result: RunResult): OpResult {
    return this.tx((d) => {
      const run = d.runs[runId];
      if (!run || run.status !== 'active' || run.ownerId !== this.ownerId) return 'not-active';
      const earned = nat(result.coinsEarned);
      run.status = 'finished';
      run.credited = earned;
      d.balance += earned;
      const b = d.bests[run.mode];
      b.runs += 1;
      b.score = Math.max(b.score, nat(result.score));
      b.coins = Math.max(b.coins, earned);
      b.combo = Math.max(b.combo, nat(result.bestCombo));
      return null;
    });
  }

  /**
   * Telemetry failed during a paid live run: refund that live entry once, discard its
   * unfinished earnings, and charge one practice entry. Net fee for switching: zero.
   */
  transferToPractice(liveRunId: string, practiceRunId: string, now = Date.now()): OpResult {
    return this.tx((d) => {
      const run = d.runs[liveRunId];
      if (!run || run.status !== 'active' || run.mode !== 'live' || run.ownerId !== this.ownerId) return 'not-active';
      if (d.runs[practiceRunId]) return 'duplicate';
      run.status = 'refunded';
      d.balance += run.cost;
      if (d.balance < ENTRY_COST) return 'insufficient';
      d.balance -= ENTRY_COST;
      d.runs[practiceRunId] = { id: practiceRunId, ownerId: this.ownerId, mode: 'practice', status: 'active', cost: ENTRY_COST, credited: 0, startedAt: now };
      return null;
    });
  }

  /**
   * On this page's departure, abandon only its own runs. Other open pages retain theirs.
   * If a crash prevents departure cleanup, the new page has a different owner and cannot
   * finish or refund the orphaned run. Its entry stays spent; earnings are never credited.
   */
  abandonActive(): OpResult {
    return this.tx((d) => {
      for (const r of Object.values(d.runs)) if (r.status === 'active' && r.ownerId === this.ownerId) r.status = 'abandoned';
      return null;
    });
  }
}

function pruneRuns(d: LedgerData): void {
  const ids = Object.keys(d.runs);
  if (ids.length <= 50) return;
  const sorted = ids.map((id) => d.runs[id]).sort((a, b) => a.startedAt - b.startedAt);
  for (const r of sorted.slice(0, ids.length - 50)) if (r.status !== 'active') delete d.runs[r.id];
}

export function browserKV(): KV | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    return { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v) };
  } catch {
    return null;
  }
}
