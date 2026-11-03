import { describe, expect, it } from 'vitest';
import { BlockWatcher, CLOCK_SKEW_MS, Poller, currentState, fetchStatus, measurementAgeSeconds, parseStatus, type FetchFn } from '../src/telemetry';

const NOW = Date.parse('2026-11-03T19:46:40.000Z');

function sample(over: Record<string, unknown> = {}, m: Record<string, unknown> = {}, anchor: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    measurement: {
      freshness: 'online',
      observedAt: '2026-11-03T19:46:34.729Z',
      receivedAt: '2026-11-03T19:46:35.041Z',
      staleAfterSeconds: 120,
      provenance: 'hardware',
      coreStatus: 'ACTIVE',
      rpmMilli: 77005,
      ...m,
    },
    builder: { status: 'available', anchor: { blockHeight: '7661', blockProgress: '911286742', ...anchor }, projected: { blockHeight: '9999' } },
    oracle: { state: 'accepted' },
    ...over,
  };
}

describe('parseStatus (schemaVersion 1)', () => {
  it('reads a fresh hardware ACTIVE reading with settled anchor, not projections', () => {
    const s = parseStatus(sample(), NOW);
    expect(s.state).toBe('ready');
    expect(s.reading?.coreStatus).toBe('ACTIVE');
    expect(s.reading?.rpm).toBeCloseTo(77.005);
    expect(s.reading?.blockHeight).toBe('7661');
    expect(s.reading?.blockProgress).toBeCloseTo(0.911286742);
  });
  it('IDLE is ready (dream world), COUNTER_FAULT is a fault', () => {
    expect(parseStatus(sample({}, { coreStatus: 'IDLE', rpmMilli: 0 }), NOW).state).toBe('ready');
    expect(parseStatus(sample({}, { coreStatus: 'COUNTER_FAULT' }), NOW).state).toBe('fault');
  });
  it('status unavailable with HTTP 200 is unavailable, never a sleeping hamster', () => {
    const s = parseStatus({ status: 'unavailable', reason: 'database_unavailable' }, NOW);
    expect(s.state).toBe('unavailable');
    expect(s.reading).toBeNull();
  });
  it('rejects unknown schema versions, unknown core status and missing measurement', () => {
    expect(parseStatus(sample({ schemaVersion: 2 }), NOW).state).toBe('invalid');
    expect(parseStatus(sample({}, { coreStatus: 'SPINNING' }), NOW).state).toBe('invalid');
    expect(parseStatus(sample({ measurement: null }), NOW).state).toBe('unavailable');
    expect(parseStatus('nope', NOW).state).toBe('invalid');
    expect(parseStatus(sample({}, { rpmMilli: 'fast' }), NOW).state).toBe('invalid');
  });
  it('stale freshness or old receivedAt is stale', () => {
    expect(parseStatus(sample({}, { freshness: 'stale' }), NOW).state).toBe('stale');
    expect(parseStatus(sample(), NOW + 200_000).state).toBe('stale');
  });
  it('simulated provenance or unaccepted oracle is unvalidated', () => {
    expect(parseStatus(sample({}, { provenance: 'simulated' }), NOW).state).toBe('unvalidated');
    expect(parseStatus(sample({ oracle: { state: 'blocked' } }), NOW).state).toBe('unvalidated');
  });
  it('ignores unknown extra fields and missing builder', () => {
    const s = parseStatus(sample({ extra: { a: 1 }, builder: { status: 'unavailable', reason: 'no_measurement' } }), NOW);
    expect(s.state).toBe('ready');
    expect(s.reading?.blockHeight).toBeNull();
  });
  it('a ready snapshot ages into stale', () => {
    const s = parseStatus(sample(), NOW);
    expect(currentState(s, NOW + 1000)).toBe('ready');
    expect(currentState(s, NOW + 125_000)).toBe('stale');
    expect(currentState(null, NOW)).toBe('offline');
  });

  for (const field of ['observedAt', 'receivedAt']) {
    it.each([undefined, null, 'invalid', '2026-11-03', '2026-02-30T19:46:35Z', '2026-11-03T25:00:00Z'])(`rejects ${field} = %s`, (value) => {
      expect(parseStatus(sample({}, { [field]: value }), NOW).state).toBe('invalid');
    });
    it(`rejects future ${field} beyond a five-second clock tolerance`, () => {
      expect(parseStatus(sample({}, { [field]: new Date(NOW + CLOCK_SKEW_MS).toISOString() }), NOW).state).toBe('ready');
      expect(parseStatus(sample({}, { [field]: new Date(NOW + CLOCK_SKEW_MS + 1).toISOString() }), NOW).state).toBe('invalid');
      expect(parseStatus(sample({}, { [field]: '2099-01-01T00:00:00.000Z' }), NOW).state).toBe('invalid');
    });
  }
  it.each([undefined, null, 0, -1, 1, 121, 120.5, '120', NaN, Infinity])('requires schema-v1 staleAfterSeconds, rejecting %s', (value) => {
    expect(parseStatus(sample({}, { staleAfterSeconds: value }), NOW).state).toBe('invalid');
  });
  it('never presents a far-future receivedAt as measured zero seconds ago', () => {
    const s = parseStatus(sample({}, { observedAt: '2099-01-01T00:00:00.000Z', receivedAt: '2099-01-01T00:00:00.000Z' }), NOW);
    expect(s.state).toBe('invalid');
    expect(measurementAgeSeconds(s.reading, NOW)).toBeNull();
  });
});

describe('BlockWatcher magnet bonus', () => {
  const at = (h: string) => parseStatus(sample({}, {}, { blockHeight: h }), NOW);
  it('no bonus from the first reading; bonus on a settled increase', () => {
    const w = new BlockWatcher();
    expect(w.observe(at('100'))).toBe(false);
    expect(w.observe(at('100'))).toBe(false);
    expect(w.observe(at('101'))).toBe(true);
  });
  it('no bonus across a reconnect gap, rollback, stale or simulated data', () => {
    const w = new BlockWatcher();
    w.observe(at('100'));
    expect(w.observe({ state: 'offline', reason: 'x', reading: null, fetchedAt: NOW })).toBe(false);
    expect(w.observe(at('105'))).toBe(false); // first reading after reconnect
    expect(w.observe(at('104'))).toBe(false); // rollback
    expect(w.observe(parseStatus(sample({}, { provenance: 'simulated' }, { blockHeight: '200' }), NOW))).toBe(false);
    expect(w.observe(parseStatus(sample({}, { freshness: 'stale' }, { blockHeight: '201' }), NOW))).toBe(false);
    w.reset();
    expect(w.observe(at('300'))).toBe(false);
  });
  it('does not reward a rollback recovery; only a new high-water mark earns a bonus', () => {
    const w = new BlockWatcher();
    expect(['100', '101', '100', '101', '99', '100', '101', '102'].map((h) => w.observe(at(h))))
      .toEqual([false, true, false, false, false, false, false, true]);
  });
});

describe('fetchStatus', () => {
  it('times out and reports offline', async () => {
    const never: FetchFn = (_u, init) =>
      new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    const s = await fetchStatus(never, () => NOW, 20);
    expect(s.state).toBe('offline');
    expect(s.reason).toMatch(/Timed out/);
  });
  it('reports HTTP errors and network failures as offline', async () => {
    const e500: FetchFn = async () => ({ ok: false, status: 503, json: async () => ({}) });
    expect((await fetchStatus(e500, () => NOW)).state).toBe('offline');
    const boom: FetchFn = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect((await fetchStatus(boom, () => NOW)).reason).toBe('Network error');
  });
  it('poller keeps the last reading as history after a failure', async () => {
    let fail = false;
    const f: FetchFn = async () => {
      if (fail) throw new TypeError('down');
      return { ok: true, status: 200, json: async () => sample({}, { receivedAt: new Date().toISOString() }) };
    };
    const seen: string[] = [];
    const p = new Poller(f, (s) => seen.push(s.state), 1_000_000);
    await p.poll();
    fail = true;
    await p.poll();
    p.stop();
    expect(seen).toEqual(['ready', 'offline']);
    expect(p.lastReading?.blockHeight).toBe('7661');
  });
  it('malformed time fields never replace the last validated historical reading', async () => {
    let malformed = false;
    const now = new Date().toISOString();
    const p = new Poller(async () => ({ ok: true, status: 200, json: async () => sample({}, {
      observedAt: malformed ? 'invalid' : now,
      receivedAt: now,
    }, { blockHeight: malformed ? '99999' : '7661' }) }), () => {}, 1_000_000);
    await p.poll();
    malformed = true;
    await p.poll();
    p.stop();
    expect(p.latest?.state).toBe('invalid');
    expect(p.lastReading?.blockHeight).toBe('7661');
  });
});
