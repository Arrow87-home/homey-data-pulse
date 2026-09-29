import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import type App from '../app';
import api from '../api';
import { configSchema } from '../src/core/model';
import { WatchdogService } from '../src/homey/service';
import { HomeyApiAdapter } from '../src/homey/api-adapter';
import { withUserErrors } from '../src/homey/user-errors';

const read = (file: string) => readFileSync(file, 'utf8');
const manifest = JSON.parse(read('app.json'));
const catalog = (language: string) =>
  JSON.parse(read(`locales/${language}.json`));
const requireModule = createRequire(resolve('app.ts'));
const bootstrapReached = new Error('offline bootstrap boundary');
type Listener = (args: {
  monitor: { id: string };
  delivered_at: string;
}) => Promise<unknown>;

function fixture(language: string) {
  const locale = catalog(language);
  const listeners = new Map<string, Listener>();
  const card = (id: string) => ({
    registerArgumentAutocompleteListener() {
      return this;
    },
    registerRunListener(listener: Listener) {
      listeners.set(id, listener);
      return this;
    },
  });
  const homey = {
    platform: 'local',
    platformVersion: 2,
    __(key: string): string {
      const [group, name] = key.split('.');
      assert.equal(typeof locale[group]?.[name], 'string', key);
      return locale[group][name];
    },
    flow: { getActionCard: card, getConditionCard: card },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(read('app.ts'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require(id: string) {
        if (id === 'homey')
          return {
            App: class {
              homey = homey;
            },
          };
        if (id === 'homey-api')
          return {
            HomeyAPI: {
              createAppAPI: async () => {
                throw bootstrapReached;
              },
            },
          };
        return requireModule(id);
      },
    },
  );
  const Actual = module.exports as new () => App;
  const app = new Actual();
  const config = configSchema.parse({
    version: 1,
    monitors: ['manual', 'device-last-seen'].map((kind) => ({
      id: kind,
      deviceId: kind,
      deviceName: 'Offline fixture',
      sourceAppId: 'test.app',
      sourceAppName: 'Test',
      strategy: { kind },
      expectedIntervalMs: 60000,
      staleTimeoutMs: 180000,
      enabled: true,
    })),
  });
  // Real service/engine validation, without starting an adapter or contacting Homey.
  app.service = new WatchdogService(
    { now: () => Date.parse('2026-09-28T12:00:00Z') },
    {
      loadConfig: () => config,
      loadRuntime: () => undefined,
      saveConfig() {},
      saveRuntime() {},
    },
    {} as HomeyApiAdapter,
    async () => {},
  );
  (app as unknown as { registerFlows(): void }).registerFlows();
  return { app, homey, listeners, locale };
}

for (const language of ['en', 'nl'] as const) {
  test(`actual Flow and API boundaries localize known errors without changing rejection semantics (${language})`, async () => {
    const { app, homey, listeners, locale } = fixture(language);
    const args = { monitor: { id: 'manual' }, delivered_at: 'not a time' };
    const run = (id: string) => listeners.get(id)!(args);
    for (const id of [
      'start_test_heartbeat',
      'stop_test_heartbeat',
      'send_test_heartbeat',
    ])
      await assert.rejects(run(id), {
        message: locale.errors.testSourceRequired,
      });
    await assert.rejects(app.testSourceAction('invalid'), {
      message: locale.errors.unknownTestAction,
    });
    await assert.rejects(run('record_heartbeat'), {
      message: locale.errors.invalidUpdateTime,
    });
    const request = {
      homey: { ...homey, app },
      params: { id: 'manual' },
      body: { deliveredAt: 'not a time' },
    };
    await assert.rejects(api.postHeartbeat(request), {
      message: locale.errors.invalidUpdateTime,
    });
    args.monitor.id = 'device-last-seen';
    await assert.rejects(run('record_heartbeat'), {
      message: locale.errors.confirmationMethodRequired,
    });
    args.monitor.id = 'missing';
    for (const id of [
      'record_heartbeat',
      'check_monitor',
      'device_is_healthy',
      'device_is_stale',
    ])
      await assert.rejects(run(id), { message: locale.errors.unknownMonitor });
    // The underlying service still emits its original technical error.
    await assert.rejects(app.service!.heartbeat('manual', 'invalid'), {
      message: 'deliveredAt must be an ISO timestamp with timezone',
    });
    // Both successful and rejected deliveries retain the boolean result at each boundary.
    for (const accepted of [false, true]) {
      app.service!.heartbeat = async () => accepted;
      assert.equal(await run('record_heartbeat'), accepted);
      assert.deepEqual(await api.postHeartbeat(request), { accepted });
    }
    app.service = undefined;
    await assert.rejects(api.getStatus(request), {
      message: locale.errors.starting,
    });
  });

  test(`runtime platform guard still allows only local v2 (${language})`, async () => {
    const { app, homey, locale } = fixture(language);
    for (const [platform, version] of [
      ['local', 1],
      ['cloud', 2],
      ['local', 3],
    ] as const) {
      homey.platform = platform;
      homey.platformVersion = version;
      await assert.rejects(app.onInit(), {
        message: locale.errors.unsupportedPlatform,
      });
    }
    homey.platform = 'local';
    homey.platformVersion = 2;
    await assert.rejects(app.onInit(), (error) => error === bootstrapReached);
  });
}

test('localization preserves unknown technical errors, causes and structured validation failures', async () => {
  const { homey, locale } = fixture('nl');
  const original = new Error('Watchdog runtime checkpoint failed');
  await assert.rejects(
    withUserErrors(homey, () => {
      throw original;
    }),
    (error) =>
      error instanceof Error &&
      error.message === locale.errors.checkpointFailed &&
      error.cause === original,
  );
  for (const error of [
    new Error('Internal adapter failure'),
    new Error('constructor'),
    { message: 'Invalid configuration', issues: [] },
  ])
    await assert.rejects(
      withUserErrors(homey, () => {
        throw error;
      }),
      (actual) => actual === error,
    );
});

test('test capability title and Help agree in English and Dutch', () => {
  const titles = manifest.capabilities.last_test_heartbeat.title;
  assert.deepEqual(titles, {
    en: 'Last test heartbeat',
    nl: 'Laatste testbevestiging',
  });
  for (const language of ['en', 'nl'] as const)
    assert.ok(
      catalog(language).settings.helpFirstTest.includes(titles[language]),
    );
  assert.doesNotMatch(
    JSON.stringify(catalog('nl').settings),
    /Last test heartbeat/,
  );
});

test('current guides describe shared setup, individual More-menu editing and timestamp values', () => {
  const guide = read('docs/user-guide.md');
  for (const name of [
    'Device activity',
    'Last data received',
    'Flow confirmation',
    'Select devices',
    'Use selection',
    'Expected every',
    'Notify after',
    'Adjust settings per device',
    'More menu (•••)',
    'Edit',
  ])
    assert.ok(guide.includes(name), name);
  assert.ok(
    guide.indexOf('Choose **Device activity**') <
      guide.indexOf('Open **Select devices**'),
  );
  for (const file of ['README.md', 'docs/user-guide.md', 'docs/self-test.md']) {
    const content = read(file);
    assert.doesNotMatch(
      content,
      /Delivery timestamp|Explicit heartbeat|Integration → Device/,
    );
    assert.match(content, /capability\.lastUpdated/);
  }
  for (const file of ['README.md', 'docs/self-test.md'])
    for (const name of [
      'Apparaatactiviteit',
      'Laatste gegevens ontvangen',
      'Bevestiging via Flow',
      'Instellingen per apparaat aanpassen',
      'Bewerken',
    ])
      assert.ok(read(file).includes(name), `${file}: ${name}`);
});

test('supported-model copy is explicit without changing manifest identity, version or distribution fields', () => {
  for (const file of [
    'README.md',
    'README.txt',
    'README.nl.txt',
    'docs/user-guide.md',
  ]) {
    const content = read(file);
    for (const model of [
      'Homey Pro (Early 2023)',
      'Homey Pro mini',
      'Homey Pro (2026)',
      'Homey Self-Hosted Server',
      '12.9.0',
    ])
      assert.ok(content.includes(model), `${file}: ${model}`);
  }
  assert.match(read('README.txt'), /Requires a platform v2 Homey/);
  assert.match(read('README.nl.txt'), /Vereist een platform-v2-Homey/);
  assert.match(read('README.md'), /Homey Cloud worden niet ondersteund/);
  assert.match(read('docs/user-guide.md'), /Homey Cloud are not supported/);
  assert.match(read('README.md'), /Athom bevestigd/);
  assert.equal(manifest.id, 'io.github.arrow87-home.datawatchdog');
  assert.equal(manifest.version, '0.1.2');
  assert.equal(manifest.homeyCommunityTopicId, 159768);
  assert.equal(
    manifest.source,
    'https://github.com/Arrow87-home/homey-data-pulse',
  );
  assert.deepEqual(manifest.tags, {
    en: ['monitoring', 'reliability', 'data', 'devices', 'integrations'],
  });
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  assert.equal(manifest.platformVersion, undefined);
  assert.match(read('app.ts'), /this\.homey\.platformVersion !== 2/);
});
