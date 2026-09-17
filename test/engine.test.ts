import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WatchdogEngine } from '../src/core/engine';
import {
  Clock,
  configSchema,
  MonitorConfig,
  WatchdogConfig,
} from '../src/core/model';

class FakeClock implements Clock {
  time = 100_000;
  now() {
    return this.time;
  }
  advance(ms: number) {
    this.time += ms;
  }
}
function config(count = 1): WatchdogConfig {
  return configSchema.parse({
    version: 1,
    policy: { correlationWindowMs: 1000, recoveryStabilityMs: 1000 },
    monitors: Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      deviceId: `d${i}`,
      deviceName: `Room ${i}`,
      sourceAppId: 'app.test',
      sourceAppName: 'Test',
      strategy: { kind: 'manual' },
      sourceContract: 'Explicit successful source report',
      expectedIntervalMs: 2000,
      staleTimeoutMs: 10_000,
      enabled: true,
    })),
  });
}
function setup(count = 1) {
  const clock = new FakeClock();
  const c = config(count);
  const e = new WatchdogEngine(c, clock);
  for (const m of c.monitors) e.recordDelivery(m.id, clock.now());
  e.evaluate();
  return { clock, c, e };
}
function outage(e: WatchdogEngine, clock: FakeClock) {
  clock.advance(10_000);
  assert.deepEqual(e.evaluate(), []);
  clock.advance(1000);
  return e.evaluate();
}

test('single source stops: correlation debounce, one start, then stable recovery', () => {
  const { e, clock } = setup();
  const starts = outage(e, clock);
  assert.deepEqual(
    starts.map((x) => x.type),
    ['device_stale'],
  );
  assert.equal(starts[0].startedAt, 110_000);
  assert.deepEqual(e.evaluate(), []);
  e.recordDelivery('m0', clock.now());
  assert.deepEqual(e.evaluate(), []);
  assert.equal(e.status('m0'), 'RECOVERING');
  clock.advance(1000);
  assert.deepEqual(
    e.evaluate().map((x) => x.type),
    ['device_recovered'],
  );
  assert.deepEqual(e.evaluate(), []);
});
test('new monitor stays unproven until evidence; no invented last delivery', () => {
  const clock = new FakeClock();
  const e = new WatchdogEngine(config(), clock);
  assert.equal(e.status('m0'), 'WARMING_UP');
  const [event] = outage(e, clock);
  assert.equal(event.lastDeliveryAt, null);
  assert.equal(event.type, 'device_stale');
});
test('five simultaneous failures become one integration incident', () => {
  const { e, clock } = setup(5);
  const events = outage(e, clock);
  assert.deepEqual(
    events.map((e) => e.type),
    ['integration_stale'],
  );
  assert.equal(events[0].affectedCount, 5);
  assert.equal(e.integrationStatus('app.test'), 'INTEGRATION_STALE');
  clock.advance(1000);
  assert.deepEqual(e.evaluate(), []);
});
test('sixth device joins an active incident without another start', () => {
  const { e, clock } = setup(6);
  clock.advance(10_000);
  e.recordDelivery('m5', clock.now());
  e.evaluate();
  clock.advance(1000);
  assert.equal(e.evaluate()[0].type, 'integration_stale');
  clock.advance(10_000);
  assert.deepEqual(e.evaluate(), []);
  assert.equal(e.snapshot().integrations[0].affectedIds.length, 6);
});
test('one failure within a healthy integration remains device-level', () => {
  const { e, clock } = setup(5);
  clock.advance(10_000);
  for (let i = 1; i < 5; i++) e.recordDelivery(`m${i}`, clock.now());
  e.evaluate();
  clock.advance(1000);
  assert.deepEqual(
    e.evaluate().map((x) => x.type),
    ['device_stale'],
  );
});
test('90 percent stable recovery emits one recovery and one residual device start', () => {
  const { e, clock } = setup(10);
  outage(e, clock);
  for (let i = 0; i < 9; i++) e.recordDelivery(`m${i}`, clock.now());
  e.evaluate();
  clock.advance(1000);
  e.evaluate();
  assert.equal(e.integrationStatus('app.test'), 'RECOVERING');
  clock.advance(1000);
  const events = e.evaluate();
  assert.deepEqual(
    events.map((x) => x.type),
    ['integration_recovered', 'device_stale'],
  );
  assert.equal(events[0].recoveredCount, 9);
  assert.equal(events[0].affectedCount, 1);
  assert.equal(events[1].monitor?.id, 'm9');
  assert.deepEqual(e.evaluate(), []);
});
test('full recovery suppresses all individual recovery events', () => {
  const { e, clock } = setup(5);
  outage(e, clock);
  for (let i = 0; i < 5; i++) e.recordDelivery(`m${i}`, clock.now());
  e.evaluate();
  clock.advance(1000);
  e.evaluate();
  clock.advance(1000);
  assert.deepEqual(
    e.evaluate().map((x) => x.type),
    ['integration_recovered'],
  );
});
test('flapping resets integration recovery stabilization', () => {
  const { clock, c } = setup(5);
  c.policy.recoveryStabilityMs = 6000;
  const e = new WatchdogEngine(c, clock);
  for (let i = 0; i < 5; i++) e.recordDelivery(`m${i}`, clock.now());
  outage(e, clock);
  for (let i = 0; i < 5; i++) e.recordDelivery(`m${i}`, clock.now());
  e.evaluate();
  clock.advance(6000);
  e.evaluate();
  assert.equal(e.integrationStatus('app.test'), 'RECOVERING');
  clock.advance(5000);
  assert.deepEqual(e.evaluate(), []);
  assert.equal(e.integrationStatus('app.test'), 'INTEGRATION_STALE');
});
test('restart during incident retains identity and never emits another start', () => {
  const { e, clock, c } = setup(5);
  const [start] = outage(e, clock);
  const restored = new WatchdogEngine(
    c,
    clock,
    JSON.parse(JSON.stringify(e.snapshot())),
  );
  assert.equal(restored.restoreStatus, 'restored');
  clock.advance(20_000);
  assert.deepEqual(restored.evaluate(), []);
  assert.equal(restored.snapshot().integrations[0].id, start.incidentId);
});
test('restored old data cannot recover; new source evidence can', () => {
  const { e, clock, c } = setup();
  outage(e, clock);
  const restored = new WatchdogEngine(c, clock, e.snapshot());
  assert.equal(restored.recordDelivery('m0', 100_000), false);
  assert.deepEqual(restored.evaluate(), []);
  clock.advance(1);
  restored.recordDelivery('m0', clock.now());
  restored.evaluate();
  clock.advance(1000);
  assert.equal(restored.evaluate()[0].type, 'device_recovered');
});
test('observer failure suspends inference; reconnect grants full grace', () => {
  const { e, clock } = setup();
  e.setObserving(false);
  clock.advance(100_000);
  assert.deepEqual(e.evaluate(), []);
  assert.equal(e.status('m0'), 'UNKNOWN');
  e.setObserving(true);
  assert.deepEqual(e.evaluate(), []);
  assert.equal(e.status('m0'), 'WARMING_UP');
  clock.advance(9999);
  assert.deepEqual(e.evaluate(), []);
});
test('removal is MISSING, never recovery or a smaller recovery denominator', () => {
  const { e, clock } = setup(5);
  outage(e, clock);
  e.setPresent('m4', false);
  for (let i = 0; i < 4; i++) e.recordDelivery(`m${i}`, clock.now());
  e.evaluate();
  clock.advance(1000);
  e.evaluate();
  clock.advance(1000);
  assert.deepEqual(e.evaluate(), []);
  assert.equal(e.status('m4'), 'MISSING');
  assert.equal(e.snapshot().integrations[0].memberIds.length, 5);
});
test('newly selected device preserves existing incident and frozen denominator', () => {
  const { e, clock, c } = setup(5);
  const [event] = outage(e, clock);
  const newMonitor: MonitorConfig = {
    ...c.monitors[0],
    id: 'new',
    deviceId: 'new',
    deviceName: 'New',
  };
  c.monitors.push(newMonitor);
  const next = new WatchdogEngine(c, clock, e.snapshot());
  assert.equal(next.snapshot().integrations[0].id, event.incidentId);
  assert.equal(next.snapshot().integrations[0].memberIds.length, 5);
  assert.equal(next.status('new'), 'WARMING_UP');
});
test('rename/zone change preserves incident; strategy change cancels it without recovery', () => {
  const { e, clock, c } = setup();
  outage(e, clock);
  c.monitors[0].deviceName = 'Renamed';
  c.monitors[0].zone = 'Upstairs';
  const renamed = new WatchdogEngine(c, clock, e.snapshot());
  assert.equal(renamed.snapshot().devices.length, 1);
  c.monitors[0].strategy = { kind: 'device-last-seen' };
  const changed = new WatchdogEngine(c, clock, e.snapshot());
  assert.equal(changed.snapshot().devices.length, 0);
  assert.deepEqual(changed.evaluate(), []);
});
test('old, duplicate, future, null-equivalent invalid times do not refresh receipt', () => {
  const { e, clock } = setup();
  for (const t of [NaN, Infinity, -1, 99_000, 100_000, clock.now() + 1])
    assert.equal(e.recordDelivery('m0', t), false);
  assert.equal(outage(e, clock)[0].type, 'device_stale');
});
test('a fresh heartbeat cancels suspected stale before notification', () => {
  const { e, clock } = setup();
  clock.advance(10_000);
  e.evaluate();
  assert.equal(e.status('m0'), 'SUSPECTED_STALE');
  clock.advance(500);
  e.recordDelivery('m0', clock.now());
  assert.deepEqual(e.evaluate(), []);
  assert.equal(e.status('m0'), 'HEALTHY');
});
test('unrelated apps never correlate', () => {
  const c = config(2);
  c.monitors[1].sourceAppId = 'other';
  const clock = new FakeClock();
  const e = new WatchdogEngine(c, clock);
  const events = outage(e, clock);
  assert.deepEqual(
    events.map((x) => x.type),
    ['device_stale', 'device_stale'],
  );
});
test('disabled monitors do not contribute to thresholds or generate events', () => {
  const c = config(2);
  c.monitors[1].enabled = false;
  const clock = new FakeClock();
  const e = new WatchdogEngine(c, clock);
  assert.equal(outage(e, clock)[0].type, 'device_stale');
  assert.equal(e.status('m1'), 'DISABLED');
});
test('clock reversal rearms grace without fabricated delivery', () => {
  const { e, clock } = setup();
  clock.advance(-5000);
  assert.deepEqual(e.evaluate(), []);
  assert.equal(e.status('m0'), 'WARMING_UP');
  assert.equal(e.runtimeView('m0').lastDeliveryAt, 100_000);
});
test('malformed runtime is rejected safely and invalid config is not accepted', () => {
  const e = new WatchdogEngine(config(), new FakeClock(), { version: 100 });
  assert.equal(e.restoreStatus, 'rejected');
  assert.equal(e.status('m0'), 'WARMING_UP');
  const c = config();
  c.monitors.push(c.monitors[0]);
  assert.throws(() => configSchema.parse(c));
  assert.throws(() =>
    configSchema.parse({ ...config(), policy: { recoveryFraction: 0 } }),
  );
});

test('restart never advertises saved HEALTHY or saved recovery stability as fresh observation', () => {
  const { e, c, clock } = setup();
  const restored = new WatchdogEngine(c, clock, e.snapshot());
  assert.equal(restored.status('m0'), 'WARMING_UP');
  outage(e, clock);
  e.recordDelivery('m0', clock.now());
  e.evaluate();
  clock.advance(1000);
  const duringRecovery = new WatchdogEngine(c, clock, e.snapshot());
  clock.advance(1);
  duringRecovery.recordDelivery('m0', clock.now());
  assert.deepEqual(duringRecovery.evaluate(), []);
  assert.equal(duringRecovery.status('m0'), 'RECOVERING');
});

test('integration start counts actual stale devices, not missing devices', () => {
  const { e, clock } = setup(10);
  e.setPresent('m8', false);
  e.setPresent('m9', false);
  const [event] = outage(e, clock);
  assert.equal(event.type, 'integration_stale');
  assert.equal(event.affectedCount, 8);
  assert.equal(event.monitoredCount, 10);
});
