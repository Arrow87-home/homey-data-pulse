import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Small DOM boundary; execute the shipped UI and its actual button handlers. */
class Element {
  children: Element[] = [];
  textContent = '';
  disabled = false;
  hidden = false;
  checked = false;
  selected = false;
  private current = '';
  onclick?: () => unknown;
  onchange?: () => unknown;
  constructor(readonly tag = 'input') {}
  get value(): string {
    return (
      this.current ||
      (this.tag === 'select' ? (this.children[0]?.value ?? '') : '')
    );
  }
  set value(value: string) {
    this.current = value;
  }
  get options() {
    return this.children;
  }
  get selectedOptions() {
    return this.children.filter((o) => o.selected);
  }
  replaceChildren(...children: Element[]) {
    this.children = children;
    this.current = '';
  }
  append(...children: Element[]) {
    this.children.push(...children);
  }
}
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
async function ui() {
  const elements = new Map<string, Element>();
  for (const id of ['source', 'device', 'strategy', 'encoding', 'capabilities'])
    elements.set(id, new Element('select'));
  const get = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const initial = {
    version: 1,
    policy: {},
    monitors: [
      {
        id: 'stable-id',
        deviceId: 'd',
        deviceName: 'Simulation',
        sourceAppId: 'app',
        sourceAppName: 'App',
        zone: 'Lab',
        strategy: {
          kind: 'timestamp-capability',
          capabilities: ['timestamp', 'missing-cap'],
          encoding: 'iso',
        },
        expectedIntervalMs: 30_000,
        staleTimeoutMs: 180_000,
        sourceContract: 'Real simulation timestamp',
        enabled: true,
      },
    ],
  };
  let saved = structuredClone(initial);
  let fail = false;
  const puts: (typeof initial)[] = [];
  const context = vm.createContext({
    window: {},
    document: {
      getElementById: get,
      createElement: (tag: string) => new Element(tag),
    },
  });
  vm.runInContext(readFileSync('settings/settings.js', 'utf8'), context);
  context.mockHomey = {
    ready() {},
    api(
      method: string,
      path: string,
      body: typeof initial | null,
      callback: (err: unknown, value?: unknown) => void,
    ) {
      if (method === 'PUT') {
        puts.push(structuredClone(body!));
        if (fail) {
          callback(new Error('Save rejected'));
          return;
        }
        saved = structuredClone(body!);
      }
      const values: Record<string, unknown> = {
        '/config': saved,
        '/inventory': [
          {
            sourceAppId: 'app',
            sourceAppName: 'App',
            devices: [
              {
                ...initial.monitors[0],
                capabilities: [{ id: 'timestamp', title: 'Timestamp' }],
              },
            ],
          },
        ],
        '/status': { monitors: [] },
        '/test-source': { paired: false },
      };
      callback(null, structuredClone(values[path]));
    },
  };
  vm.runInContext('window.onHomeyReady(mockHomey)', context);
  await drain();
  return {
    get,
    puts,
    initial,
    saved: () => saved,
    fail: () => {
      fail = true;
    },
    edit: () => get('monitors').children[0].children[1].onclick!(),
  };
}

test('UI Edit loads full configuration, save preserves ID and does not duplicate monitor', async () => {
  const f = await ui();
  f.edit();
  assert.equal(f.get('add').textContent, 'Save changes');
  assert.equal(f.get('source').disabled, true);
  assert.equal(f.get('device').value, 'd');
  assert.equal(f.get('expected').value, '0.5');
  assert.equal(f.get('timeout').value, '3');
  assert.equal(f.get('encoding').value, 'iso');
  assert.deepEqual(
    f.get('capabilities').selectedOptions.map((o) => o.value),
    ['timestamp', 'missing-cap'],
  );
  f.get('timeout').value = '4';
  f.get('enabled').checked = false;
  await f.get('add').onclick!();
  assert.equal(f.puts.length, 1);
  assert.equal(f.saved().monitors.length, 1);
  assert.equal(f.saved().monitors[0].id, 'stable-id');
  assert.equal(f.saved().monitors[0].staleTimeoutMs, 240_000);
  assert.equal(f.saved().monitors[0].enabled, false);
  assert.equal(f.get('add').textContent, 'Add monitor');
  assert.equal(f.get('cancel').hidden, true);
});

test('UI Cancel discards draft, exits edit mode, performs no config write', async () => {
  const f = await ui();
  f.edit();
  f.get('contract').value = 'Unsaved draft';
  f.get('strategy').value = 'manual';
  f.get('cancel').onclick!();
  await drain();
  assert.equal(f.puts.length, 0);
  assert.deepEqual(f.saved(), f.initial);
  assert.equal(f.get('source').disabled, false);
  assert.equal(f.get('cancel').hidden, true);
  f.edit();
  assert.equal(f.get('contract').value, 'Real simulation timestamp');
  assert.equal(f.get('strategy').value, 'timestamp-capability');
});

test('UI refresh preserves edit draft; rejected save retains draft and original configuration', async () => {
  const f = await ui();
  f.edit();
  f.get('timeout').value = '9';
  f.get('refresh').onclick!();
  await drain();
  assert.equal(f.get('timeout').value, '9');
  assert.equal(f.get('add').textContent, 'Save changes');
  f.fail();
  await f.get('add').onclick!();
  assert.deepEqual(f.saved(), f.initial);
  assert.equal(f.get('timeout').value, '9');
  assert.equal(f.get('add').disabled, false);
  assert.equal(f.get('add').textContent, 'Save changes');
});
