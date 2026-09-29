import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import prettier from 'prettier';
import { configSchema } from '../src/core/model';
import {
  TEST_APP_ID,
  TEST_CAPABILITY,
  TEST_DATA_ID,
  TEST_DRIVER_ID,
} from '../src/homey/test-source';

const manifest = JSON.parse(readFileSync('app.json', 'utf8'));
const locale = (language: string) =>
  JSON.parse(readFileSync(`locales/${language}.json`, 'utf8'));

test('Data Pulse manifest generation is deterministic, canonical and localized', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'data-pulse-manifest-'));
  try {
    execFileSync(process.execPath, [resolve('scripts/generate-manifest.mjs')], {
      cwd: directory,
    });
    const generated = readFileSync(join(directory, 'app.json'), 'utf8');
    assert.equal(generated, readFileSync('app.json', 'utf8'));
    assert.equal(
      await prettier.check(generated, {
        ...(await prettier.resolveConfig(resolve('app.json'))),
        parser: 'json',
      }),
      true,
    );
    execFileSync(process.execPath, [resolve('scripts/generate-manifest.mjs')], {
      cwd: directory,
    });
    assert.equal(readFileSync(join(directory, 'app.json'), 'utf8'), generated);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.deepEqual(manifest.name, { en: 'Data Pulse', nl: 'Data Pulse' });
  for (const language of ['en', 'nl']) {
    assert.equal(
      manifest.drivers[0].name[language],
      locale(language).testSourceName,
    );
    assert.match(locale(language).settings.help_basics_0, /Data Pulse/);
    assert.match(locale(language).settings.testUnpaired, /Data Pulse/);
  }
});

test('current public copy uses Data Pulse while technical identity remains unchanged', () => {
  for (const file of [
    'README.md',
    'README.txt',
    'README.nl.txt',
    'docs/user-guide.md',
    'docs/self-test.md',
    'docs/architecture.md',
    'locales/en.json',
    'locales/nl.json',
    'app.json',
  ]) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /Data Watchdog/i, file);
    assert.match(content, /Data Pulse/, file);
  }
  assert.doesNotMatch(
    readFileSync('settings/index.html', 'utf8') +
      readFileSync('settings/settings.js', 'utf8'),
    /Data Watchdog/i,
  );
  assert.equal(manifest.id, 'io.github.arrow87-home.datawatchdog');
  assert.equal(TEST_APP_ID, manifest.id);
  assert.equal(TEST_DRIVER_ID, 'test-source');
  assert.equal(TEST_DATA_ID, 'watchdog-local-test-source');
  assert.deepEqual(
    manifest.drivers.map((d: { id: string }) => d.id),
    ['test-source'],
  );
  assert.deepEqual(Object.keys(manifest.capabilities), ['last_test_heartbeat']);
  assert.equal(TEST_CAPABILITY, 'last_test_heartbeat');
  assert.equal(
    JSON.parse(readFileSync('package.json', 'utf8')).name,
    'homey-data-watchdog',
  );
  assert.deepEqual(
    manifest.flow.triggers.map((c: { id: string }) => c.id),
    [
      'device_stale',
      'device_recovered',
      'integration_stale',
      'integration_recovered',
      'any_incident_started',
      'any_incident_recovered',
    ],
  );
  assert.deepEqual(
    manifest.flow.conditions.map((c: { id: string }) => c.id),
    [
      'device_is_healthy',
      'device_is_stale',
      'integration_is_healthy',
      'integration_is_stale',
    ],
  );
  assert.deepEqual(
    manifest.flow.actions.map((c: { id: string }) => c.id),
    [
      'start_test_heartbeat',
      'stop_test_heartbeat',
      'send_test_heartbeat',
      'check_all',
      'check_monitor',
      'record_heartbeat',
    ],
  );
  assert.deepEqual(Object.keys(manifest.api), [
    'getTestSource',
    'postTestSource',
    'getInventory',
    'getStatus',
    'getConfig',
    'putConfig',
    'postHeartbeat',
  ]);
  assert.ok(
    Object.values(manifest.api).every(
      (route) => !(route as { public: boolean }).public,
    ),
  );
});

test('existing monitor names, IDs and evidence settings need no brand migration', () => {
  for (const kind of [
    'manual',
    'device-last-seen',
    'timestamp-capability',
  ] as const) {
    const input = {
      version: 1,
      monitors: [
        {
          id: 'existing-id',
          deviceId: 'existing-device',
          deviceName: 'Data Watchdog Test Source (simulation)',
          sourceAppId: TEST_APP_ID,
          sourceAppName: 'Data Watchdog',
          zone: '',
          strategy:
            kind === 'timestamp-capability'
              ? { kind, capabilities: [TEST_CAPABILITY], encoding: 'iso' }
              : { kind },
          expectedIntervalMs: 30000,
          staleTimeoutMs: 180000,
          enabled: true,
          sourceContract: '',
        },
      ],
    };
    const parsed = configSchema.parse(input);
    assert.deepEqual(parsed.monitors[0], input.monitors[0]);
  }
});

test('store positioning is opt-in and the next release notes explain compatibility in both languages', () => {
  assert.match(
    readFileSync('README.txt', 'utf8'),
    /selected Homey data sources/,
  );
  assert.match(
    readFileSync('README.txt', 'utf8'),
    /does not automatically monitor every device/,
  );
  assert.match(
    readFileSync('README.nl.txt', 'utf8'),
    /geselecteerde Homey-databronnen/,
  );
  assert.match(
    readFileSync('README.nl.txt', 'utf8'),
    /niet automatisch ieder apparaat/,
  );
  for (const file of ['README.txt', 'README.nl.txt'])
    assert.doesNotMatch(readFileSync(file, 'utf8'), /https?:\/\/|^#/m);
  const changelog = JSON.parse(readFileSync('.homeychangelog.json', 'utf8'));
  assert.match(changelog['0.1.2'].en, /Data Watchdog is now Data Pulse/);
  assert.match(changelog['0.1.2'].nl, /Data Watchdog heet voortaan Data Pulse/);
  assert.match(changelog['0.1.2'].en, /without migration/);
  assert.match(changelog['0.1.2'].nl, /zonder migratie/);
});
