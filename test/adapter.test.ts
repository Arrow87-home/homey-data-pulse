import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { HomeyAPI } from 'homey-api';
import { detectors, parseTimestamp } from '../src/core/detectors';
import { configSchema } from '../src/core/model';
import { WatchdogEngine } from '../src/core/engine';
import { HomeyApiAdapter, LocalApi, ApiDevice } from '../src/homey/api-adapter';
import { buildInventory, identifySource } from '../src/homey/inventory';
import { SettingsPersistence } from '../src/homey/persistence';
import { flowTokens } from '../src/homey/tokens';
import { WatchdogService } from '../src/homey/service';

const requireModule = createRequire(`${process.cwd()}/test/adapter.test.ts`);
const makeConfig = (kind = 'timestamp-capability') =>
  configSchema.parse({
    version: 1,
    monitors: [
      {
        id: 'm',
        deviceId: 'd',
        deviceName: 'Device',
        sourceAppId: 'test.app',
        sourceAppName: 'Test',
        strategy:
          kind === 'timestamp-capability'
            ? { kind, capabilities: ['last_report'], encoding: 'epoch-ms' }
            : { kind },
        expectedIntervalMs: 60_000,
        staleTimeoutMs: 180_000,
        sourceContract: 'Timestamp after successful source request',
        enabled: true,
      },
    ],
  });

test('official API client forwards same values with newer transaction times, suppresses duplicate time', () => {
  const DeviceCapability = requireModule(
    'homey-api/lib/HomeyAPI/HomeyAPIV3/ManagerDevices/DeviceCapability',
  );
  const device = Object.assign(new EventEmitter(), {
    capabilitiesObj: {
      measure_temperature: {
        value: 21.3,
        lastUpdated: '2026-09-17T10:00:00.000Z',
      },
    },
  });
  const received: number[] = [];
  const listener = new DeviceCapability({
    id: 'measure_temperature',
    device,
    listener: (v: number) => received.push(v),
  });
  for (const transactionTime of [
    '2026-09-17T10:05:00.000Z',
    '2026-09-17T10:05:00.000Z',
    '2026-09-17T10:10:00.000Z',
  ]) {
    device.emit('capability', {
      capabilityId: 'measure_temperature',
      value: 21.3,
      transactionTime,
    });
  }
  assert.deepEqual(received, [21.3, 21.3]);
  listener.destroy();
  assert.equal(device.listenerCount('capability'), 0);
});

test('official in-app factory selects local API v3 for the documented SHS/Pro platform tuple', async () => {
  const api = await HomeyAPI.createAppAPI({
    homey: {
      platform: 'local',
      platformVersion: 2,
      version: '12.9.0',
      api: {
        getOwnerApiToken: async () => 'offline-test-value',
        getLocalUrl: async () => 'http://127.0.0.1',
      },
      cloud: { getHomeyId: async () => 'offline-test-id' },
    },
  });
  assert.equal(api.constructor.name, 'HomeyAPIV3Local');
  assert.equal(typeof api.devices.getDevices, 'function');
  assert.equal(typeof api.apps.getApps, 'function');
  await api.disconnect();
});

test('strategies use explicit value semantics, never lastUpdated of ordinary measurements', () => {
  const m = makeConfig().monitors[0];
  assert.equal(
    detectors[0].read(m, { capabilities: { last_report: { value: 123_000 } } }),
    123_000,
  );
  assert.equal(
    detectors[0].read(m, {
      capabilities: { measure_temperature: { value: 21.3 } },
    }),
    null,
  );
  assert.equal(parseTimestamp('2026-09-17T10:00:00', 'iso'), null);
  assert.equal(parseTimestamp('1234', 'epoch-ms'), null);
  assert.equal(parseTimestamp(123, 'epoch-seconds'), 123_000);
  const activity = makeConfig('device-last-seen').monitors[0];
  assert.equal(
    detectors[1].read(activity, { lastSeenAt: new Date(123_000) }),
    123_000,
  );
});

test('source identity is stable, detects conflicts and isolates unresolved devices', () => {
  assert.deepEqual(
    identifySource({ id: 'd', name: 'x', ownerUri: 'homey:app:plugwise' }),
    { id: 'plugwise', resolved: true },
  );
  assert.deepEqual(
    identifySource({
      id: 'd',
      name: 'x',
      driverId: 'homey:app:plugwise:thermostat',
    }),
    { id: 'plugwise', resolved: true },
  );
  assert.equal(
    identifySource({
      id: 'd',
      name: 'x',
      ownerUri: 'homey:app:a',
      driverId: 'homey:app:b:driver',
    }).resolved,
    false,
  );
  assert.notEqual(
    identifySource({ id: 'a', name: 'x' }).id,
    identifySource({ id: 'b', name: 'x' }).id,
  );
});
test('inventory includes apps without devices and tracks names/zones without auto-selection', () => {
  const inventory = buildInventory(
    {
      d: {
        id: 'd',
        name: 'Bedroom',
        ownerUri: 'homey:app:test',
        zone: 'z',
        capabilities: ['temperature'],
      },
    },
    {
      test: { id: 'test', name: 'Test app' },
      empty: { id: 'empty', name: 'Empty' },
    },
    { z: { name: 'Upstairs' } },
  );
  assert.equal(inventory.length, 2);
  assert.equal(
    inventory.find((g) => g.sourceAppId === 'test')?.devices[0].zone,
    'Upstairs',
  );
  assert.equal(
    inventory.find((g) => g.sourceAppId === 'empty')?.devices.length,
    0,
  );
});

test('inventory exposes actual driver metadata for UI shortcuts without inferring a type from names', () => {
  const [group] = buildInventory(
    {
      a: { id: 'a', name: 'Same name', driverId: 'homey:app:test:sensor' },
      b: { id: 'b', name: 'Same name', ownerUri: 'homey:app:test' },
      c: {
        id: 'c',
        name: 'Other name',
        ownerUri: 'homey:app:test',
        driverId: 'sensor',
      },
    },
    {},
    {},
  );
  assert.deepEqual(
    group.devices.map((d) => d.driverId),
    ['homey:app:test:sensor', undefined, 'sensor'],
  );
  assert.ok(group.devices.every((d) => d.identityResolved));
});

function fakeApi() {
  let connected = true,
    calls = 0,
    created = 0,
    destroyed = 0;
  let callback: ((v: unknown) => void) | undefined;
  const emitter = new EventEmitter();
  const device: ApiDevice = {
    id: 'd',
    name: 'Renamed',
    ownerUri: 'homey:app:test.app',
    capabilitiesObj: { last_report: { value: 100_000 } },
    async connect() {},
    makeCapabilityInstance(_id, listener) {
      created++;
      callback = listener;
      return {
        destroy() {
          destroyed++;
          callback = undefined;
        },
      };
    },
  };
  let present = true;
  const api: LocalApi = {
    devices: Object.assign(emitter, {
      async connect() {},
      async disconnect() {},
      isConnected: () => connected,
      async getDevices(): Promise<Record<string, ApiDevice>> {
        calls++;
        if (!connected) throw new Error('offline');
        return present ? { d: device } : {};
      },
    }),
    apps: {
      async getApps() {
        return { 'test.app': { id: 'test.app', name: 'Test' } };
      },
    },
    zones: {
      async getZones() {
        return {};
      },
    },
    isConnected: () => connected,
    async disconnect() {},
  };
  return {
    api,
    device,
    emitter,
    emit: (v: unknown) => callback?.(v),
    setConnected: (v: boolean) => {
      connected = v;
    },
    setPresent: (v: boolean) => {
      present = v;
    },
    counts: () => ({ calls, created, destroyed }),
  };
}
test('adapter deduplicates listeners, treats snapshots at source time, cleans up removed devices', async () => {
  const fake = fakeApi();
  const adapter = new HomeyApiAdapter(fake.api);
  let time = 100_000;
  const e = new WatchdogEngine(makeConfig(), { now: () => time });
  await adapter.start();
  await adapter.refresh(e, true);
  await adapter.refresh(e, false);
  assert.equal(fake.counts().created, 1);
  assert.equal(e.runtimeView('m').lastDeliveryAt, 100_000);
  time = 101_000;
  fake.emit(101_000);
  assert.equal(e.runtimeView('m').lastDeliveryAt, 101_000);
  fake.setPresent(false);
  await adapter.refresh(e, false);
  assert.equal(e.status('m'), 'MISSING');
  assert.equal(fake.counts().destroyed, 1);
  await adapter.stop();
  assert.equal(fake.emitter.listenerCount('device.update'), 0);
});
test('snapshot refetch and administrative metadata cannot refresh last delivery', async () => {
  const fake = fakeApi();
  const adapter = new HomeyApiAdapter(fake.api);
  let time = 100_000;
  const e = new WatchdogEngine(makeConfig(), { now: () => time });
  await adapter.start();
  await adapter.refresh(e, true);
  time += 10_000;
  fake.device.name = 'New name';
  fake.emitter.emit('device.update', fake.device);
  await adapter.refresh(e, false);
  assert.equal(e.runtimeView('m').lastDeliveryAt, 100_000);
  assert.equal(e.monitor('m').deviceName, 'New name');
  await adapter.stop();
});
test('missing selected capability becomes unobservable, not a false data-delivery failure', async () => {
  const fake = fakeApi();
  fake.device.capabilitiesObj = {};
  const adapter = new HomeyApiAdapter(fake.api);
  const e = new WatchdogEngine(makeConfig(), { now: () => 100_000 });
  await adapter.start();
  await adapter.refresh(e, true);
  assert.equal(e.status('m'), 'MISSING');
  assert.equal(fake.counts().created, 0);
  await adapter.stop();
});
test('settings retain separate config/runtime and reject malformed config', () => {
  const memory = new Map<string, unknown>();
  const store = new SettingsPersistence({
    get: (key) => memory.get(key),
    set: (key, value) => {
      memory.set(key, value);
    },
  });
  store.saveConfig(makeConfig());
  const e = new WatchdogEngine(makeConfig(), { now: () => 1 });
  store.saveRuntime(e.snapshot());
  assert.equal(store.loadConfig().monitors.length, 1);
  assert.equal(memory.size, 2);
  memory.set('watchdog-config', { version: 999 });
  assert.throws(() => store.loadConfig());
});
test('Flow payload is primitive, includes uncertainty and matches manifest tokens', () => {
  const c = makeConfig();
  let time = 100_000;
  const e = new WatchdogEngine(c, { now: () => time });
  time += 180_000;
  e.evaluate();
  time += 60_000;
  const [event] = e.evaluate();
  const tokens = flowTokens(event);
  assert.equal(tokens.last_delivery, '');
  assert.equal(tokens.age_minutes, -1);
  assert.equal(tokens.has_delivery, false);
  const manifest = requireModule('../app.json');
  for (const card of manifest.flow.triggers) {
    assert.deepEqual(
      Object.keys(tokens).sort(),
      card.tokens.map((t: { name: string }) => t.name).sort(),
    );
    for (const t of card.tokens) assert.equal(typeof tokens[t.name], t.type);
  }
});
test('service coalesces scans, suspends on disconnection, bounds retries and resumes with grace', async () => {
  const fake = fakeApi();
  const adapter = new HomeyApiAdapter(fake.api);
  let time = 100_000;
  const data = new Map<string, unknown>([['watchdog-config', makeConfig()]]);
  const store = new SettingsPersistence({
    get: (k) => data.get(k),
    set: (k, v) => {
      data.set(k, v);
    },
  });
  const events: unknown[] = [];
  const service = new WatchdogService(
    { now: () => time },
    store,
    adapter,
    async (e) => {
      events.push(e);
    },
  );
  await service.start();
  assert.equal(service.observerStatus, 'observing');
  await Promise.all([service.tick(), service.tick(), service.tick()]);
  assert.equal(fake.counts().calls, 1);
  fake.setConnected(false);
  time += 10_000;
  await service.tick();
  assert.equal(service.engine.status('m'), 'UNKNOWN');
  time += 60_000;
  await service.tick();
  const count = fake.counts().calls;
  await service.tick();
  assert.equal(fake.counts().calls, count);
  fake.setConnected(true);
  time += 60_000;
  await service.tick();
  assert.equal(service.engine.status('m'), 'WARMING_UP');
  assert.deepEqual(events, []);
  await service.stop();
});

test('a future timestamp cannot hide a valid second timestamp in any-of strategy', () => {
  const m = makeConfig().monitors[0];
  m.strategy = {
    kind: 'timestamp-capability',
    capabilities: ['a', 'b'],
    encoding: 'epoch-ms',
  };
  assert.equal(
    detectors[0].read(
      m,
      { capabilities: { a: { value: 300_000 }, b: { value: 100_000 } } },
      100_000,
    ),
    100_000,
  );
  assert.equal(
    detectors[1].read(makeConfig('device-last-seen').monitors[0], {
      lastSeenAt: new Date(NaN),
    }),
    null,
  );
});

test('service does not send alerts after a failed checkpoint and exposes persistence failure', async () => {
  const fake = fakeApi();
  const adapter = new HomeyApiAdapter(fake.api);
  let time = 100_000;
  const c = makeConfig('manual');
  c.monitors[0].expectedIntervalMs = 1000;
  c.monitors[0].staleTimeoutMs = 10_000;
  c.policy.correlationWindowMs = 1000;
  let fail = false;
  const data = new Map<string, unknown>([['watchdog-config', c]]);
  const store = new SettingsPersistence({
    get: (k) => data.get(k),
    set: (k, v) => {
      if (fail) throw new Error('disk');
      data.set(k, v);
    },
  });
  const events: unknown[] = [];
  const service = new WatchdogService(
    { now: () => time },
    store,
    adapter,
    async (e) => {
      events.push(e);
    },
  );
  await service.start();
  time += 10_000;
  await service.tick();
  fail = true;
  time += 1000;
  await assert.rejects(service.tick());
  assert.deepEqual(events, []);
  assert.equal(service.observerStatus, 'persistence-error');
  fail = false;
  await service.stop();
});

test('editing reuses listeners targeting the current engine; strategy removal and re-add never duplicate listeners', async () => {
  const fake = fakeApi();
  const adapter = new HomeyApiAdapter(fake.api);
  let time = 100_000;
  const memory = new Map<string, unknown>([['watchdog-config', makeConfig()]]);
  const store = new SettingsPersistence({
    get: (k) => memory.get(k),
    set: (k, v) => {
      memory.set(k, v);
    },
  });
  const service = new WatchdogService(
    { now: () => time },
    store,
    adapter,
    async () => {},
  );
  await service.start();
  const initial = service.engine;
  assert.equal(initial.status('m'), 'HEALTHY');
  for (let i = 0; i < 3; i++) {
    time += 1000;
    const config = structuredClone(service.engine.config);
    config.monitors[0].deviceName = 'UI metadata edit';
    await service.configure(config);
    assert.equal(service.engine.status('m'), 'HEALTHY');
  }
  assert.equal(fake.counts().created, 1);
  time += 1000;
  fake.emit(time);
  await service.tick();
  assert.equal(service.engine.runtimeView('m').lastDeliveryAt, time);
  assert.equal(initial.runtimeView('m').lastDeliveryAt, 100_000);
  const changed = structuredClone(service.engine.config);
  changed.monitors[0].strategy = { kind: 'manual' };
  time += 1000;
  await service.configure(changed);
  assert.equal(service.engine.status('m'), 'WARMING_UP');
  assert.equal(fake.counts().destroyed, 1);
  await assert.rejects(
    service.heartbeat('m', new Date(time).toISOString(), {
      deviceId: 'another',
      sourceAppId: 'test.app',
    }),
    /target changed/,
  );
  assert.equal(service.engine.runtimeView('m').lastDeliveryAt, null);
  await service.configure(makeConfig());
  assert.equal(fake.counts().created, 2);
  await service.stop();
  assert.equal(fake.counts().destroyed, 2);
  assert.equal(fake.emitter.listenerCount('device.update'), 0);
});
