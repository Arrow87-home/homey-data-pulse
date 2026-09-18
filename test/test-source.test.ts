import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import {
  TestSource,
  TEST_APP_ID,
  TEST_CAPABILITY,
  TEST_DATA_ID,
  TEST_INTERVAL_MS,
  deliverTestHeartbeat,
} from '../src/homey/test-source';
import { configSchema } from '../src/core/model';
import { WatchdogService } from '../src/homey/service';
import { SettingsPersistence } from '../src/homey/persistence';
import { HomeyApiAdapter, ApiDevice, LocalApi } from '../src/homey/api-adapter';
import { dispatchFlows } from '../src/homey/flows';
import { buildInventory } from '../src/homey/inventory';

function timerFixture() {
  let now = Date.parse('2026-09-18T12:00:00Z');
  let sequence = 0;
  const timers = new Map<number, () => void>();
  const writes: string[] = [];
  const manual: string[] = [];
  const native: unknown[][] = [];
  const ports = {
    now: () => now,
    setTimeout(callback: () => void, delay: number) {
      assert.equal(delay, TEST_INTERVAL_MS);
      timers.set(++sequence, callback);
      return sequence;
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number);
    },
    async writeTimestamp(iso: string) {
      writes.push(iso);
    },
    async markLastSeen(...args: unknown[]) {
      native.push(args);
    },
    async deliverManual(iso: string) {
      manual.push(iso);
      return 1;
    },
  };
  return {
    ports,
    timers,
    writes,
    manual,
    native,
    advance(ms = TEST_INTERVAL_MS) {
      now += ms;
    },
    async fire() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

test('test heartbeat: stopped by default, start idempotent, one timer, stop freezes, send stays stopped', async () => {
  const f = timerFixture();
  const source = new TestSource(f.ports);
  assert.equal(source.status().running, false);
  assert.equal(f.writes.length, 0);
  await Promise.all([source.action('start'), source.action('start')]);
  assert.equal(f.writes.length, 1);
  assert.equal(f.timers.size, 1);
  f.advance();
  await f.fire();
  assert.equal(f.writes.length, 2);
  assert.equal(f.timers.size, 1);
  const late = [...f.timers.values()][0];
  await source.action('stop');
  const frozen = source.status().lastGeneratedAt;
  f.advance();
  late();
  await f.fire();
  assert.equal(source.status().lastGeneratedAt, frozen);
  assert.equal(f.timers.size, 0);
  await source.action('send');
  assert.equal(f.writes.length, 3);
  assert.equal(source.status().running, false);
  await source.action('send'); // Same millisecond is not manufactured evidence.
  assert.equal(f.writes.length, 3);
  assert.deepEqual(f.manual, f.writes);
  assert.deepEqual(f.native, [[], [], []]);
  await source.dispose();
});

test('restart retains only actual last timestamp, never enabled state; removal drains and prevents future writes', async () => {
  const f = timerFixture();
  const old = new TestSource(f.ports);
  await old.action('start');
  const last = old.status().lastGeneratedAt;
  const late = [...f.timers.values()][0];
  await old.dispose();
  await old.dispose();
  const next = new TestSource(f.ports, last);
  assert.equal(next.status().lastGeneratedAt, last);
  assert.equal(next.status().running, false);
  f.advance();
  late();
  await f.fire();
  assert.equal(f.timers.size, 0);
  assert.equal(f.writes.length, 1);
  await assert.rejects(old.action('send'), /removed/);
  await next.action('start');
  assert.equal(f.timers.size, 1);
  await next.dispose();
  assert.equal(f.timers.size, 0);
});

test('stop waits for a pending write; no writes after stop resolves, no overlapping beats', async () => {
  const f = timerFixture();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const source = new TestSource({
    ...f.ports,
    async writeTimestamp(iso) {
      await blocked;
      f.writes.push(iso);
    },
  });
  const start = source.action('start');
  const stop = source.action('stop');
  release();
  await Promise.all([start, stop]);
  assert.equal(f.writes.length, 1);
  assert.equal(f.timers.size, 0);
  f.advance();
  await f.fire();
  assert.equal(f.writes.length, 1);
  await source.dispose();
});

test('unsupported/failing native lastSeen leaves deterministic manual and timestamp paths working', async () => {
  for (const markLastSeen of [
    undefined,
    async () => {
      throw new Error('SDK unavailable');
    },
  ]) {
    const f = timerFixture();
    const source = new TestSource({ ...f.ports, markLastSeen });
    await source.action('start');
    assert.equal(f.writes.length, 1);
    assert.equal(f.manual.length, 1);
    assert.equal(
      source.status().nativeLastSeen,
      markLastSeen ? 'failed' : 'unavailable',
    );
    await source.dispose();
  }
});

test('failed timestamp write stops scheduler and does not create manual evidence', async () => {
  const f = timerFixture();
  const source = new TestSource({
    ...f.ports,
    async writeTimestamp() {
      throw new Error('SDK');
    },
  });
  await assert.rejects(source.action('start'));
  assert.equal(source.status().running, false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.manual.length, 0);
  assert.equal(source.status().lastGeneratedAt, null);
  await source.dispose();
});

for (const kind of [
  'manual',
  'timestamp-capability',
  'device-last-seen',
] as const) {
  test(`${kind}: own test activity → real adapter/service/engine → normal stale/recovered Flow dispatch (offline SDK boundary)`, async () => {
    const f = timerFixture();
    let callback: ((value: unknown) => void) | undefined;
    let listeners = 0;
    let present = true;
    const device: ApiDevice = {
      id: 'test-device',
      name: 'Simulation',
      data: { id: TEST_DATA_ID },
      ownerUri: `homey:app:${TEST_APP_ID}`,
      driverId: `homey:app:${TEST_APP_ID}:test-source`,
      capabilitiesObj: { [TEST_CAPABILITY]: { value: null, type: 'string' } },
      async connect() {},
      makeCapabilityInstance(_id, listener) {
        callback = listener;
        listeners++;
        return {
          destroy() {
            callback = undefined;
            listeners--;
          },
        };
      },
    };
    const emitter = new EventEmitter();
    const api: LocalApi = {
      devices: Object.assign(emitter, {
        async connect() {},
        async disconnect() {},
        isConnected: () => true,
        async getDevices(): Promise<Record<string, ApiDevice>> {
          return present ? { 'test-device': device } : {};
        },
      }),
      apps: {
        async getApps() {
          return { [TEST_APP_ID]: { id: TEST_APP_ID, name: 'Data Watchdog' } };
        },
      },
      zones: {
        async getZones() {
          return {};
        },
      },
      isConnected: () => true,
      async disconnect() {},
    };
    const config = configSchema.parse({
      version: 1,
      monitors: [
        {
          id: 'test-monitor',
          deviceId: device.id,
          deviceName: device.name,
          sourceAppId: TEST_APP_ID,
          sourceAppName: 'Data Watchdog',
          strategy:
            kind === 'timestamp-capability'
              ? { kind, capabilities: [TEST_CAPABILITY], encoding: 'iso' }
              : { kind },
          expectedIntervalMs: 30_000,
          staleTimeoutMs: 180_000,
          sourceContract: 'Local simulation delivers every 30s while running',
          enabled: true,
        },
      ],
    });
    const memory = new Map<string, unknown>([['watchdog-config', config]]);
    const store = new SettingsPersistence({
      get: (k) => memory.get(k),
      set: (k, v) => {
        memory.set(k, v);
      },
    });
    const fired: { id: string; tokens: Record<string, unknown> }[] = [];
    const service = new WatchdogService(
      f.ports,
      store,
      new HomeyApiAdapter(api),
      (event) =>
        dispatchFlows(
          {
            getTriggerCard: (id) => ({
              async trigger(tokens) {
                fired.push({ id, tokens });
              },
            }),
          },
          event,
        ),
    );
    await service.start();
    const source = new TestSource({
      ...f.ports,
      async writeTimestamp(iso) {
        device.capabilitiesObj![TEST_CAPABILITY].value = iso;
        callback?.(iso);
        f.writes.push(iso);
      },
      // Mock only the documented SDK boundary; this is not a claim about a live SHS.
      async markLastSeen() {
        device.lastSeenAt = new Date(f.ports.now());
      },
      deliverManual: (iso) => deliverTestHeartbeat(service, iso),
    });
    async function advance(seconds: number, running: boolean) {
      for (let i = 0; i < seconds; i += 10) {
        f.advance(10_000);
        if (running && (i + 10) % 30 === 0) await f.fire();
        await service.tick();
      }
    }
    await source.action('start');
    await advance(60, true);
    assert.equal(service.engine.status('test-monitor'), 'HEALTHY');
    await source.action('stop');
    const frozen = device.capabilitiesObj![TEST_CAPABILITY].value;
    const lastSeen = device.lastSeenAt;
    await advance(250, false);
    assert.equal(device.capabilitiesObj![TEST_CAPABILITY].value, frozen);
    assert.equal(device.lastSeenAt, lastSeen);
    assert.equal(service.engine.status('test-monitor'), 'DEVICE_STALE');
    assert.deepEqual(
      fired.map((e) => e.id),
      ['device_stale', 'any_incident_started'],
    );
    await source.action('start');
    await advance(130, true);
    assert.equal(service.engine.status('test-monitor'), 'HEALTHY');
    assert.deepEqual(
      fired.map((e) => e.id),
      [
        'device_stale',
        'any_incident_started',
        'device_recovered',
        'any_incident_recovered',
      ],
    );
    assert.equal(fired[1].tokens.incident_id, fired[3].tokens.incident_id);
    assert.equal(fired[1].tokens.source_app_id, TEST_APP_ID);
    assert.equal(fired[1].tokens.device_id, device.id);
    await source.dispose();
    present = false;
    await advance(60, false);
    assert.equal(service.engine.status('test-monitor'), 'MISSING');
    assert.equal(listeners, 0);
    assert.equal(f.timers.size, 0);
    await service.stop();
    assert.equal(emitter.listenerCount('device.update'), 0);
  });
}

test('manual self-test routing rejects lookalikes and does not heartbeat production monitors', async () => {
  const devices = buildInventory(
    {
      production: {
        id: 'production',
        name: 'Data Watchdog Test Source',
        ownerUri: 'homey:app:plugwise',
        driverId: 'homey:app:plugwise:test-source',
        data: { id: TEST_DATA_ID },
      },
      wrongDriver: {
        id: 'wrong',
        name: 'Simulation',
        ownerUri: `homey:app:${TEST_APP_ID}`,
        driverId: `homey:app:${TEST_APP_ID}:other`,
        data: { id: TEST_DATA_ID },
      },
    },
    {},
    {},
  );
  let calls = 0;
  const service = {
    adapter: { inventory: devices },
    heartbeat: async () => {
      calls++;
    },
  } as unknown as WatchdogService;
  assert.equal(await deliverTestHeartbeat(service, '2026-09-18T12:00:00Z'), 0);
  assert.equal(calls, 0);
});

test('manual routing selects only the verified simulator and passes an atomic identity guard', async () => {
  const devices = buildInventory(
    {
      test: {
        id: 'own-device',
        name: 'Simulation',
        data: { id: TEST_DATA_ID },
        ownerUri: `homey:app:${TEST_APP_ID}`,
        driverId: `homey:app:${TEST_APP_ID}:test-source`,
      },
      production: {
        id: 'production',
        name: 'Production',
        ownerUri: 'homey:app:real.integration',
      },
    },
    {},
    {},
  );
  const calls: unknown[][] = [];
  const service = {
    adapter: { inventory: devices },
    engine: {
      config: {
        monitors: [
          {
            id: 'production-monitor',
            deviceId: 'production',
            sourceAppId: 'real.integration',
            enabled: true,
            strategy: { kind: 'manual' },
          },
          {
            id: 'own-monitor',
            deviceId: 'own-device',
            sourceAppId: TEST_APP_ID,
            enabled: true,
            strategy: { kind: 'manual' },
          },
        ],
      },
    },
    async heartbeat(...args: unknown[]) {
      calls.push(args);
      return true;
    },
  } as unknown as WatchdogService;
  const iso = '2026-09-18T12:00:00Z';
  assert.equal(await deliverTestHeartbeat(service, iso), 1);
  assert.deepEqual(calls, [
    ['own-monitor', iso, { deviceId: 'own-device', sourceAppId: TEST_APP_ID }],
  ]);
});
