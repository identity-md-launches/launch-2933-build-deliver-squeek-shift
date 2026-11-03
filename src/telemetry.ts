// Squeekchain live wheel telemetry: GET https://api.squeekchain.com/v1/status (schemaVersion 1).
// Public, no key, CORS open. Polled every 15 s with an 8 s timeout.

export const STATUS_URL = 'https://api.squeekchain.com/v1/status';
export const DOCS_URL = 'https://docs.squeekchain.com/developers/api/';
export const POLL_MS = 15_000;
export const TIMEOUT_MS = 8_000;

export type CoreStatus = 'ACTIVE' | 'IDLE' | 'COUNTER_FAULT';

export type SignalState =
  | 'ready' // fresh, validated, hardware reading with ACTIVE or IDLE
  | 'fault' // COUNTER_FAULT
  | 'stale' // freshness stale or older than staleAfterSeconds
  | 'unvalidated' // provenance not hardware, or oracle not accepted
  | 'unavailable' // endpoint answered but with no usable measurement
  | 'invalid' // unknown schema or malformed fields
  | 'offline'; // network error, timeout or HTTP error

export interface Reading {
  coreStatus: CoreStatus | null;
  rpm: number | null;
  observedAt: string | null;
  receivedAt: string | null;
  freshness: string | null;
  provenance: string | null;
  staleAfterSeconds: number;
  oracleState: string | null;
  /** Settled anchor height as a decimal string (parsed with BigInt). */
  blockHeight: string | null;
  /** Settled anchor progress, 0..1 (blockProgress / 1e9). */
  blockProgress: number | null;
}

export interface Snapshot {
  state: SignalState;
  reason: string;
  reading: Reading | null;
  fetchedAt: number;
}

const isDec = (v: unknown): v is string => typeof v === 'string' && /^\d{1,30}$/.test(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function measurementAgeSeconds(r: Reading | null, now: number): number | null {
  if (!r) return null;
  const t = Date.parse(r.receivedAt ?? r.observedAt ?? '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / 1000);
}

/** Validate an untrusted /v1/status body. Unknown extra fields are ignored. */
export function parseStatus(body: unknown, now: number): Snapshot {
  const fail = (state: SignalState, reason: string, reading: Reading | null = null): Snapshot => ({ state, reason, reading, fetchedAt: now });
  if (!body || typeof body !== 'object') return fail('invalid', 'Response was not a JSON object');
  const b = body as Record<string, unknown>;
  if (b.status === 'unavailable') return fail('unavailable', `Source unavailable${typeof b.reason === 'string' ? `: ${b.reason}` : ''}`);
  if (b.schemaVersion !== 1) return fail('invalid', `Unsupported schemaVersion ${String(b.schemaVersion)}`);
  const m = b.measurement as Record<string, unknown> | null | undefined;
  if (!m || typeof m !== 'object') return fail('unavailable', 'No measurement yet');

  const core = m.coreStatus;
  const coreStatus: CoreStatus | null = core === 'ACTIVE' || core === 'IDLE' || core === 'COUNTER_FAULT' ? core : null;
  const builder = b.builder as Record<string, unknown> | undefined;
  const anchor = builder && builder.status === 'available' ? (builder.anchor as Record<string, unknown> | undefined) : undefined;
  const oracle = b.oracle as Record<string, unknown> | undefined;
  const reading: Reading = {
    coreStatus,
    rpm: isInt(m.rpmMilli) && m.rpmMilli >= 0 ? m.rpmMilli / 1000 : null,
    observedAt: typeof m.observedAt === 'string' ? m.observedAt : null,
    receivedAt: typeof m.receivedAt === 'string' ? m.receivedAt : null,
    freshness: typeof m.freshness === 'string' ? m.freshness : null,
    provenance: typeof m.provenance === 'string' ? m.provenance : null,
    staleAfterSeconds: isInt(m.staleAfterSeconds) && m.staleAfterSeconds > 0 ? m.staleAfterSeconds : 120,
    oracleState: oracle && typeof oracle.state === 'string' ? oracle.state : null,
    blockHeight: anchor && isDec(anchor.blockHeight) ? anchor.blockHeight : null,
    blockProgress: anchor && isDec(anchor.blockProgress) ? Math.min(1, Number(anchor.blockProgress) / 1e9) : null,
  };

  if (coreStatus === null) return fail('invalid', `Unknown wheel status ${String(core)}`, reading);
  if (coreStatus === 'COUNTER_FAULT') return fail('fault', 'Wheel counter fault reported', reading);
  if (!reading.receivedAt || !Number.isFinite(Date.parse(reading.receivedAt))) return fail('invalid', 'Missing measurement time', reading);
  const age = measurementAgeSeconds(reading, now) ?? Infinity;
  if (reading.freshness !== 'online' || age > reading.staleAfterSeconds) return fail('stale', 'Wheel reading is stale', reading);
  if (reading.provenance !== 'hardware') return fail('unvalidated', `Reading provenance is ${reading.provenance ?? 'missing'}, not hardware`, reading);
  if (reading.oracleState !== 'accepted') return fail('unvalidated', `Oracle state is ${reading.oracleState ?? 'missing'}`, reading);
  if (reading.rpm === null) return fail('invalid', 'Missing wheel speed', reading);
  return { state: 'ready', reason: coreStatus === 'ACTIVE' ? 'Wheel running' : 'Wheel resting', reading, fetchedAt: now };
}

/** Re-evaluate a ready snapshot as time passes, so a reading that ages out becomes stale. */
export function currentState(s: Snapshot | null, now: number): SignalState {
  if (!s) return 'offline';
  if (s.state !== 'ready') return s.state;
  const age = measurementAgeSeconds(s.reading, now);
  if (age === null || age > (s.reading?.staleAfterSeconds ?? 120)) return 'stale';
  // A ready snapshot older than two poll intervals means polls have been failing silently.
  if (now - s.fetchedAt > POLL_MS * 2 + TIMEOUT_MS) return 'stale';
  return 'ready';
}

/**
 * Tracks settled block height across consecutive ready polls during one run. A bonus fires
 * only when two back-to-back ready readings show the height rising. Initial load, gaps after
 * a failed poll (reconnect), rollbacks and non-ready data reset the baseline instead.
 */
export class BlockWatcher {
  private baseline: bigint | null = null;

  reset(): void {
    this.baseline = null;
  }

  /** Feed each poll result while a live run is in progress. Returns true when a bonus is earned. */
  observe(s: Snapshot): boolean {
    if (s.state !== 'ready' || !s.reading?.blockHeight) {
      this.baseline = null;
      return false;
    }
    const h = BigInt(s.reading.blockHeight);
    const prev = this.baseline;
    this.baseline = h;
    if (prev === null) return false;
    return h > prev;
  }
}

export type FetchFn = (url: string, init: { signal: AbortSignal; cache: RequestCache; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function fetchStatus(fetchFn: FetchFn, now: () => number = Date.now, timeoutMs = TIMEOUT_MS): Promise<Snapshot> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(STATUS_URL, { signal: ctl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return { state: 'offline', reason: `HTTP ${res.status}`, reading: null, fetchedAt: now() };
    const body = await res.json();
    return parseStatus(body, now());
  } catch (e) {
    const aborted = ctl.signal.aborted;
    return { state: 'offline', reason: aborted ? 'Timed out after 8 seconds' : 'Network error', reading: null, fetchedAt: now() };
  } finally {
    clearTimeout(timer);
  }
}

/** Polls the status endpoint every 15 s; keeps the last usable reading as history. */
export class Poller {
  latest: Snapshot | null = null;
  lastReading: Reading | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight = false;
  private stopped = false;

  constructor(
    private fetchFn: FetchFn,
    private onUpdate: (s: Snapshot) => void,
    private intervalMs = POLL_MS,
  ) {}

  start(): void {
    this.stopped = false;
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    if (this.timer) clearTimeout(this.timer);
    const s = await fetchStatus(this.fetchFn);
    this.inflight = false;
    this.latest = s;
    if (s.reading) this.lastReading = s.reading;
    this.onUpdate(s);
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), this.intervalMs);
  }
}
