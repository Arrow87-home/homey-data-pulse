import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WatchdogEngine } from '../src/core/engine';
import { configSchema, MonitorConfig } from '../src/core/model';

const config = () =>
  configSchema.parse({
    version: 1,
    monitors: ['a', 'b'].map((id) => ({
      id,
      deviceId: id,
      deviceName: id,
      sourceAppId: 'source',
      sourceAppName: 'Source',
      strategy: {
        kind: 'timestamp-capability',
        capabilities: ['timestamp'],
        encoding: 'iso',
      },
      expectedIntervalMs: 30_000,
      staleTimeoutMs: 180_000,
      sourceContract: 'Verified source delivery timestamp',
      enabled: true,
    })),
  });

const changes: [string, (m: MonitorConfig) => void][] = [
  [
    'strategy',
    (m) => {
      m.strategy = { kind: 'manual' };
    },
  ],
  [
    'capabilities',
    (m) => {
      m.strategy = {
        kind: 'timestamp-capability',
        capabilities: ['other'],
        encoding: 'iso',
      };
    },
  ],
  [
    'encoding',
    (m) => {
      m.strategy = {
        kind: 'timestamp-capability',
        capabilities: ['timestamp'],
        encoding: 'epoch-ms',
      };
    },
  ],
  [
    'expected interval',
    (m) => {
      m.expectedIntervalMs = 60_000;
    },
  ],
  [
    'timeout',
    (m) => {
      m.staleTimeoutMs = 240_000;
    },
  ],
  [
    'enabled',
    (m) => {
      m.enabled = false;
    },
  ],
  [
    'source identity',
    (m) => {
      m.sourceAppId = 'other';
    },
  ],
];
for (const [label, change] of changes)
  test(`edit ${label}: same ID resets detection runtime, unrelated monitor remains healthy`, () => {
    let now = 1_000_000;
    const engine = new WatchdogEngine(config(), { now: () => now });
    engine.recordDelivery('a', now);
    engine.recordDelivery('b', now);
    engine.evaluate();
    const before = engine.runtimeView('b');
    now += 1000;
    const nextConfig = structuredClone(engine.config);
    change(nextConfig.monitors[0]);
    const next = engine.reconfigure(nextConfig);
    assert.deepEqual(
      next.config.monitors.map((m) => m.id),
      ['a', 'b'],
    );
    assert.equal(
      next.status('a'),
      label === 'enabled' ? 'DISABLED' : 'WARMING_UP',
    );
    assert.equal(next.runtimeView('a').lastDeliveryAt, null);
    assert.equal(next.runtimeView('a').evidenceSinceResume, false);
    assert.deepEqual(next.runtimeView('b'), before);
    assert.equal(next.status('b'), 'HEALTHY');
  });

test('presentation-only editing preserves active incident and recovery progress; restart still uses warming up', () => {
  let now = 1_000_000;
  const c = config();
  c.monitors.pop();
  const engine = new WatchdogEngine(c, { now: () => now });
  engine.recordDelivery('a', now);
  engine.evaluate();
  now += 240_000;
  engine.evaluate();
  now++;
  engine.recordDelivery('a', now);
  engine.evaluate();
  assert.equal(engine.status('a'), 'RECOVERING');
  const nextConfig = structuredClone(engine.config);
  Object.assign(nextConfig.monitors[0], {
    deviceName: 'New name',
    sourceAppName: 'New source name',
    zone: 'Upstairs',
    sourceContract: '',
  });
  const next = engine.reconfigure(nextConfig);
  assert.deepEqual(next.runtimeView('a'), engine.runtimeView('a'));
  assert.deepEqual(next.snapshot().devices, engine.snapshot().devices);
  now += 60_000;
  const events = next.evaluate();
  assert.equal(events[0].type, 'device_recovered');
  assert.equal(events[0].monitor?.deviceName, 'New name');
  assert.equal(
    new WatchdogEngine(next.config, { now: () => now }, next.snapshot()).status(
      'a',
    ),
    'WARMING_UP',
  );
});

test('enabling a disabled monitor discards previous delivery', () => {
  let now = 1_000_000;
  const engine = new WatchdogEngine(config(), { now: () => now });
  engine.recordDelivery('a', now);
  engine.evaluate();
  const disabled = structuredClone(engine.config);
  disabled.monitors[0].enabled = false;
  const stopped = engine.reconfigure(disabled);
  now++;
  const enabled = structuredClone(stopped.config);
  enabled.monitors[0].enabled = true;
  const resumed = stopped.reconfigure(enabled);
  assert.equal(resumed.status('a'), 'WARMING_UP');
  assert.equal(resumed.runtimeView('a').lastDeliveryAt, null);
});

test('metadata edit preserves integration recovery stability without duplicate incident or delayed recovery', () => {
  let now = 1_000_000;
  const engine = new WatchdogEngine(config(), { now: () => now });
  now += 240_000;
  assert.equal(engine.evaluate()[0].type, 'integration_stale');
  now++;
  for (const id of ['a', 'b']) engine.recordDelivery(id, now);
  engine.evaluate();
  now += 60_000;
  engine.evaluate();
  assert.equal(engine.integrationStatus('source'), 'RECOVERING');
  const edited = structuredClone(engine.config);
  edited.monitors[0].sourceContract = '';
  const next = engine.reconfigure(edited);
  assert.deepEqual(
    next.snapshot().integrations,
    engine.snapshot().integrations,
  );
  now += 60_000;
  const events = next.evaluate();
  assert.deepEqual(
    events.map((event) => event.type),
    ['integration_recovered'],
  );
  assert.equal(events[0].incidentId, engine.snapshot().integrations[0].id);
});
