import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as testSource from '../src/homey/test-source';

/** Execute real driver/device entrypoints with only the SDK boundary substituted. */
function load<T>(
  path: string,
  sdk: object,
  clock: { now(): number } = Date,
): T {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    Date: clock,
    require(id: string) {
      if (id === 'homey') return sdk;
      if (id === '../../src/homey/test-source') return testSource;
      throw new Error(`Unexpected driver dependency: ${id}`);
    },
  });
  return module.exports as T;
}

for (const language of ['en', 'nl'])
  test(`SDK pairing offers one localized Data Pulse source and refuses an additional source (${language})`, async () => {
    let paired = false;
    const locale = JSON.parse(readFileSync(`locales/${language}.json`, 'utf8'));
    class Driver {
      homey = { __: (key: string) => locale[key] };
      getDevices() {
        return paired ? [{}] : [];
      }
    }
    const Actual = load<
      new () => {
        onPairListDevices(): Promise<{ name: string; data: { id: string } }[]>;
      }
    >('drivers/test-source/driver.ts', { Driver });
    const driver = new Actual();
    const devices = await driver.onPairListDevices();
    assert.equal(devices.length, 1);
    assert.equal(
      devices[0].name,
      language === 'en'
        ? 'Data Pulse Test Source (simulation)'
        : 'Data Pulse Testbron (simulatie)',
    );
    assert.equal(devices[0].data.id, testSource.TEST_DATA_ID);
    paired = true;
    assert.equal((await driver.onPairListDevices()).length, 0);
  });

test('real SDK device init/reinit/delete/uninit has one controller, own-capability writes, native no-argument activity and complete cleanup', async () => {
  let now = 1_000_000;
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  let source: testSource.TestSource | undefined;
  let timestamp: string | null = null;
  const writes: string[] = [];
  const native: unknown[][] = [];
  const timers = new Set<() => void>();
  const app = {
    registerTestSource(value: testSource.TestSource) {
      assert.equal(source, undefined);
      source = value;
    },
    unregisterTestSource(value: testSource.TestSource) {
      if (source === value) source = undefined;
    },
  };
  class Device {
    homey = {
      app,
      setTimeout(callback: () => void) {
        timers.add(callback);
        return callback;
      },
      clearTimeout(callback: () => void) {
        timers.delete(callback);
      },
    };
    getCapabilityValue(id: string) {
      assert.equal(id, testSource.TEST_CAPABILITY);
      return timestamp;
    }
    async setCapabilityValue(id: string, value: string) {
      assert.equal(id, testSource.TEST_CAPABILITY);
      writes.push(value);
      timestamp = value;
    }
    async setLastSeenAt(...args: unknown[]) {
      native.push(args);
    }
  }
  const Actual = load<
    new () => {
      onInit(): Promise<void>;
      onDeleted(): Promise<void>;
      onUninit(): Promise<void>;
    }
  >('drivers/test-source/device.ts', { Device }, Clock);
  const device = new Actual();
  await device.onInit();
  assert.equal(source!.status().running, false);
  assert.equal(writes.length, 0);
  const first = source!;
  await first.action('start');
  assert.equal(timers.size, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(native, [[]]);
  now += 30_000;
  await device.onInit();
  assert.notEqual(source, first);
  assert.equal(timers.size, 0);
  assert.equal(source!.status().running, false);
  assert.equal(writes.length, 1);
  assert.equal(source!.status().lastGeneratedAt, timestamp);
  await assert.rejects(first.action('send'), /removed/);
  await source!.action('start');
  assert.equal(timers.size, 1);
  const current = source!;
  await device.onDeleted();
  await device.onUninit();
  assert.equal(source, undefined);
  assert.equal(timers.size, 0);
  await assert.rejects(current.action('start'), /removed/);
});
