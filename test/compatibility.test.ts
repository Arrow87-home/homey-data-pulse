import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  configSchema,
  monitorFingerprint,
  compatibleMonitorFingerprint,
  WatchdogConfig,
} from '../src/core/model';
import { WatchdogEngine } from '../src/core/engine';
import {
  buildInventory,
  identifySource,
  DeviceRecord,
} from '../src/homey/inventory';
import { TEST_APP_ID, TEST_DATA_ID } from '../src/homey/test-source';

function configuration(kind = 'manual') {
  return configSchema.parse({
    version: 1,
    monitors: [
      {
        id: 'm',
        deviceId: 'd',
        deviceName: 'Source',
        sourceAppId: 'app',
        sourceAppName: 'App',
        sourceContract: 'Existing original source contract',
        expectedIntervalMs: 30000,
        staleTimeoutMs: 180000,
        enabled: true,
        strategy:
          kind === 'timestamp-capability'
            ? {
                kind,
                capabilities: ['last_timestamp', 'another_timestamp'],
                encoding: 'iso',
              }
            : { kind },
      },
    ],
  });
}
function legacyFingerprint(config: WatchdogConfig) {
  const m = config.monitors[0];
  // Exact field order/shape written by commit 96a074d, before this migration.
  return JSON.stringify({
    policy: config.policy,
    monitors: [
      {
        id: m.id,
        sourceAppId: m.sourceAppId,
        deviceId: m.deviceId,
        strategy: m.strategy,
        sourceContract: m.sourceContract,
        expectedIntervalMs: m.expectedIntervalMs,
        staleTimeoutMs: m.staleTimeoutMs,
        enabled: m.enabled,
      },
    ],
  });
}

test('optional technical note accepts empty/absent/short values and preserves existing text', () => {
  const original = configuration();
  assert.equal(
    configSchema.parse(original).monitors[0].sourceContract,
    'Existing original source contract',
  );
  for (const sourceContract of ['', undefined, 'note']) {
    const config = structuredClone(original);
    Object.assign(config.monitors[0], { sourceContract });
    assert.equal(
      configSchema.parse(config).monitors[0].sourceContract,
      sourceContract ?? '',
    );
  }
});

test('sourceContract-only edit preserves healthy runtime, grace and fingerprint', () => {
  let now = 1000000;
  const engine = new WatchdogEngine(configuration(), { now: () => now });
  engine.recordDelivery('m', now);
  engine.evaluate();
  const before = engine.snapshot();
  now += 1000;
  const edited = structuredClone(engine.config);
  edited.monitors[0].sourceContract = '';
  const next = engine.reconfigure(edited);
  assert.deepEqual(next.runtimeView('m'), engine.runtimeView('m'));
  assert.equal(next.snapshot().fingerprint, before.fingerprint);
  assert.equal(next.status('m'), 'HEALTHY');
});

for (const kind of ['manual', 'timestamp-capability', 'device-last-seen'])
  test(`existing ${kind} config and legacy runtime fingerprint restore safely`, () => {
    let now = 1000000;
    const c = configuration(kind);
    const engine = new WatchdogEngine(c, { now: () => now });
    engine.recordDelivery('m', now);
    engine.evaluate();
    now += 240000;
    engine.evaluate();
    const saved = engine.snapshot();
    saved.monitorFingerprints.m = legacyFingerprint(c);
    saved.fingerprint = legacyFingerprint(c);
    const edited = structuredClone(c);
    edited.monitors[0].sourceContract = '';
    const restored = new WatchdogEngine(edited, { now: () => now }, saved);
    assert.equal(restored.restoreStatus, 'restored');
    assert.equal(
      restored.runtimeView('m').lastDeliveryAt,
      saved.runtimes.m.lastDeliveryAt,
    );
    assert.deepEqual(restored.snapshot().devices, saved.devices);
    assert.equal(restored.status('m'), 'WARMING_UP'); // Existing restart grace is retained.
    assert.equal(
      restored.snapshot().monitorFingerprints.m,
      monitorFingerprint(edited.monitors[0]),
    );
    assert.ok(
      !restored.snapshot().monitorFingerprints.m.includes('sourceContract'),
    );
    now++;
    restored.recordDelivery('m', now);
    restored.evaluate();
    now += 60000;
    const events = restored.evaluate();
    assert.equal(events[0].type, 'device_recovered');
    assert.equal(events[0].incidentId, saved.devices[0].id);
  });

test('legacy snapshot migration preserves integration identity while keeping normal restart recovery gate', () => {
  let now = 1000000;
  const c = configuration();
  c.monitors.push({ ...c.monitors[0], id: 'm2', deviceId: 'd2' });
  const engine = new WatchdogEngine(c, { now: () => now });
  now += 240000;
  engine.evaluate();
  const saved = engine.snapshot();
  for (const monitor of c.monitors)
    saved.monitorFingerprints[monitor.id] = legacyFingerprint({
      ...c,
      monitors: [monitor],
    });
  const restored = new WatchdogEngine(c, { now: () => now }, saved);
  assert.equal(
    restored.snapshot().integrations[0].id,
    saved.integrations[0].id,
  );
  assert.equal(restored.snapshot().integrations[0].recoveringSince, null);
  assert.deepEqual(restored.evaluate(), []);
});

test('legacy compatibility never ignores detection fields, unknown additions or malformed fingerprints', () => {
  const c = configuration();
  const monitor = c.monitors[0];
  const legacy = legacyFingerprint(c);
  assert.equal(compatibleMonitorFingerprint(legacy, monitor), true);
  assert.equal(
    compatibleMonitorFingerprint(legacy, {
      ...monitor,
      staleTimeoutMs: 240000,
    }),
    false,
  );
  assert.equal(
    compatibleMonitorFingerprint(legacy, { ...monitor, enabled: false }),
    false,
  );
  const extra = JSON.parse(legacy);
  extra.monitors[0].futureRule = true;
  assert.equal(
    compatibleMonitorFingerprint(JSON.stringify(extra), monitor),
    false,
  );
  for (const invalid of [
    undefined,
    '',
    '{',
    'null',
    '{}',
    '{"monitors":[null]}',
  ])
    assert.equal(compatibleMonitorFingerprint(invalid, monitor), false);
});

function modern(driverId: string, ownerUri?: string): DeviceRecord {
  return {
    id: 'd',
    name: 'Device',
    driverId,
    ownerUri,
    get driverUri(): string {
      throw new Error('Deprecated getter must never be accessed');
    },
  };
}
for (const app of ['com.plugwise', 'com.mqtt', 'com.tibber', TEST_APP_ID])
  test(`modern ${app} driver identity never touches driverUri`, () => {
    assert.deepEqual(identifySource(modern(`homey:app:${app}:driver`)), {
      id: app,
      resolved: true,
    });
  });
test('modern built-in manager driver also avoids the deprecated getter', () => {
  assert.deepEqual(
    identifySource(
      modern('homey:manager:vdevice:virtual', 'homey:manager:vdevice'),
    ),
    { id: 'homey:manager:vdevice', resolved: false },
  );
});
test('short local driver uses owner, while legacy records retain lazy data-property fallback and conflict detection', () => {
  assert.deepEqual(identifySource(modern('local-driver', 'homey:app:app')), {
    id: 'app',
    resolved: true,
  });
  assert.deepEqual(
    identifySource({ id: 'd', name: 'Old', driverUri: 'homey:app:legacy' }),
    { id: 'legacy', resolved: true },
  );
  assert.deepEqual(
    identifySource({
      id: 'd',
      name: 'Old',
      driverId: 'local-driver',
      driverUri: 'homey:app:legacy',
    }),
    { id: 'legacy', resolved: true },
  );
  assert.equal(
    identifySource(modern('homey:app:a:driver', 'homey:app:b')).resolved,
    false,
  );
  assert.equal(
    identifySource({
      id: 'd',
      name: 'Old',
      driverId: 'local',
      ownerUri: 'homey:app:a',
      driverUri: 'homey:app:b',
    }).resolved,
    false,
  );
  // Qualified driverId is authoritative; the legacy fallback must not be used.
  assert.equal(
    identifySource({
      id: 'd',
      name: 'Modern',
      driverId: 'homey:app:a:driver',
      driverUri: 'homey:app:b',
    }).id,
    'a',
  );
});
test('test-source recognition accepts full and local driver IDs without accessing driverUri', () => {
  for (const driverId of [
    `homey:app:${TEST_APP_ID}:test-source`,
    'test-source',
  ]) {
    const device = modern(driverId, `homey:app:${TEST_APP_ID}`);
    device.data = { id: TEST_DATA_ID };
    assert.equal(
      buildInventory({ d: device }, {}, {})[0].devices[0].isTestSource,
      true,
    );
  }
  const wrong = modern(
    'homey:app:other:test-source',
    `homey:app:${TEST_APP_ID}`,
  );
  wrong.data = { id: TEST_DATA_ID };
  assert.equal(
    buildInventory({ d: wrong }, {}, {})[0].devices[0].isTestSource,
    false,
  );
});

test('note-only change preserves an active device incident and its recovery progress exactly', () => {
  let now = 1000000;
  const engine = new WatchdogEngine(configuration(), { now: () => now });
  now += 240000;
  engine.evaluate();
  now++;
  engine.recordDelivery('m', now);
  engine.evaluate();
  assert.equal(engine.status('m'), 'RECOVERING');
  const edited = structuredClone(engine.config);
  edited.monitors[0].sourceContract = '';
  const next = engine.reconfigure(edited);
  assert.deepEqual(next.runtimeView('m'), engine.runtimeView('m'));
  assert.deepEqual(next.snapshot().devices, engine.snapshot().devices);
  now += 60000;
  assert.equal(next.evaluate()[0].incidentId, engine.snapshot().devices[0].id);
});
