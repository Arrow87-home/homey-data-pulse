import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { configSchema, WatchdogConfig } from '../src/core/model';
import { InventoryDevice } from '../src/homey/inventory';

/** Minimal DOM boundary; the actual shipped JS handles every action and validation. */
class Element {
  children: Element[] = [];
  textContent = '';
  className = '';
  id = '';
  type = '';
  value = '';
  disabled = false;
  hidden = false;
  checked = false;
  open = false;
  attributes = new Map<string, string>();
  onclick?: () => unknown;
  onchange?: () => unknown;
  oninput?: () => unknown;
  onsubmit?: (event: { preventDefault(): void }) => Promise<void>;
  focused = false;
  scrolled = false;
  constructor(readonly tag = 'input') {}
  replaceChildren(...children: Element[]) {
    this.children = children;
    if (this.tag === 'select') this.value = children[0]?.value ?? '';
  }
  append(...children: Element[]) {
    this.children.push(...children);
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  focus() {
    this.focused = true;
  }
  scrollIntoView() {
    this.scrolled = true;
  }
}
const text = (element: Element): string =>
  [element.textContent, ...element.children.map(text)].join(' ');
const findButton = (element: Element, label: string): Element | undefined =>
  element.tag === 'button' && element.textContent === label
    ? element
    : element.children.map((child) => findButton(child, label)).find(Boolean);
const descendants = (element: Element): Element[] => [
  element,
  ...element.children.flatMap(descendants),
];
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
const initialConfig = () =>
  configSchema.parse({
    version: 1,
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
        expectedIntervalMs: 30000,
        staleTimeoutMs: 180000,
        sourceContract: 'Real simulation timestamp',
        enabled: true,
      },
    ],
  });
const inventoryDevice = (
  id: string,
  driverId: string | undefined = 'sensor',
  sourceAppId = 'app',
): InventoryDevice => ({
  deviceId: id,
  deviceName: `Device ${id}`,
  sourceAppId,
  sourceAppName: sourceAppId,
  driverId,
  identityResolved: true,
  zone: 'Lab',
  available: true,
  hasLastSeen: false,
  capabilities: [
    { id: 'timestamp', title: 'Delivery timestamp', type: 'string' },
  ],
});
async function ui(
  options: {
    adding?: boolean;
    capabilities?: { id: string; title: string; type?: string }[];
    paired?: boolean;
    missingDevice?: boolean;
    devices?: InventoryDevice[];
  } = {},
) {
  const elements = new Map<string, Element>();
  for (const match of readFileSync('settings/index.html', 'utf8').matchAll(
    /<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g,
  )) {
    const item = new Element(match[1]);
    item.id = match[2];
    item.value = match[0].match(/\bvalue="([^"]*)"/)?.[1] ?? '';
    item.hidden = /\bhidden\b/.test(match[0]);
    elements.set(item.id, item);
  }
  const get = (id: string) => {
    const element =
      elements.get(id) ??
      [...elements.values()].flatMap(descendants).find((e) => e.id === id);
    assert.ok(element, `Unknown DOM ID: ${id}`);
    return element;
  };
  const initial = initialConfig();
  if (options.adding) initial.monitors = [];
  let saved = structuredClone(initial);
  let fail: unknown;
  let statusFail = false;
  let running = false;
  const puts: WatchdogConfig[] = [];
  const actions: string[] = [];
  const source = () => ({
    paired: options.paired ?? false,
    running,
    intervalMs: 30000,
    lastGeneratedAt: null,
    nativeLastSeen: 'not-sent',
    manualDeliveries: 0,
  });
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
      body: unknown,
      callback: (err: unknown, value?: unknown) => void,
    ) {
      if (method === 'PUT') {
        puts.push(structuredClone(body) as WatchdogConfig);
        if (fail) {
          callback(fail);
          return;
        }
        const parsed = configSchema.safeParse(body);
        if (!parsed.success) {
          callback(parsed.error);
          return;
        }
        saved = parsed.data;
      }
      if (method === 'POST') {
        const action = (body as { action: string }).action;
        actions.push(action);
        if (action === 'start') running = true;
        if (action === 'stop') running = false;
      }
      if (statusFail && path === '/status') {
        callback(new Error('Unavailable'));
        return;
      }
      const values: Record<string, unknown> = {
        '/config': saved,
        '/inventory': options.devices
          ? [...new Set(options.devices.map((d) => d.sourceAppId))].map(
              (id) => ({
                sourceAppId: id,
                sourceAppName: id,
                devices: options.devices!.filter((d) => d.sourceAppId === id),
              }),
            )
          : [
              {
                sourceAppId: 'app',
                sourceAppName: 'App',
                devices: options.missingDevice
                  ? []
                  : [
                      {
                        ...initialConfig().monitors[0],
                        identityResolved: true,
                        driverId: 'homey:app:app:simulation',
                        capabilities: options.capabilities ?? [
                          {
                            id: 'timestamp',
                            title: 'Last test heartbeat',
                            type: 'string',
                          },
                        ],
                      },
                    ],
              },
            ],
        '/status': {
          observer: 'observing',
          restore: 'restored',
          dispatchFailures: 0,
          integrations: [{ sourceAppId: 'app', state: 'HEALTHY' }],
          monitors: saved.monitors.map((m) => ({
            ...m,
            runtime: { state: 'HEALTHY', lastDeliveryAt: 1000000 },
          })),
        },
        '/test-source': source(),
      };
      callback(null, structuredClone(values[path]));
    },
  };
  vm.runInContext('window.onHomeyReady(mockHomey)', context);
  await drain();
  assert.ok(
    !get('message').textContent.startsWith('Could not load'),
    get('message').textContent,
  );
  const choose = (kind: string) => {
    for (const k of ['manual', 'timestamp-capability', 'device-last-seen'])
      get(`strategy-${k}`).checked = kind === k;
    get(`strategy-${kind}`).onchange!();
  };
  const select = (...ids: string[]) => {
    get('select-devices').onclick!();
    for (const input of descendants(get('picker-options')).filter(
      (e) => e.type === 'checkbox' && !e.disabled,
    )) {
      input.checked = ids.includes(input.value);
      input.onchange!();
    }
    get('confirm-devices').onclick!();
  };
  const card = (id = 'd') => {
    const result = get('selected-devices').children.find(
      (e) => e.attributes.get('data-device-id') === id,
    );
    assert.ok(result, `Missing selected device: ${id}`);
    return result;
  };
  const field = (key: string, id = 'd') => {
    if (!get('edit-fields').hidden) return get(key);
    const result = descendants(card(id)).find((e) => e.id.endsWith(`-${key}`));
    assert.ok(result, `Missing setup field: ${key}`);
    return result;
  };
  return {
    get,
    field,
    select,
    card,
    puts,
    initial,
    actions,
    text: (id: string) => text(get(id)),
    saved: () => saved,
    fail: (error: unknown = new Error('Save rejected')) => {
      fail = error;
    },
    statusFail: () => {
      statusFail = true;
    },
    edit: () => findButton(get('monitors'), 'Edit')!.onclick!(),
    submit: () => get('monitor-form').onsubmit!({ preventDefault() {} }),
    choose,
    caps: (id = 'd') =>
      get('edit-fields').hidden
        ? descendants(card(id)).filter((e) => e.type === 'checkbox' && e.value)
        : get('capability-options').children.map((label) => label.children[0]),
  };
}

test('setup starts with the method, then a temporary picker; one selected source saves independently', async () => {
  const f = await ui({ adding: true });
  assert.equal(f.get('select-devices').disabled, true);
  assert.equal(f.get('device-picker').hidden, true);
  assert.equal(f.get('setup-timing').hidden, true);
  await f.submit();
  assert.equal(f.puts.length, 0);
  assert.match(f.get('strategy-error').textContent, /Choose how/);
  f.choose('device-last-seen');
  assert.equal(f.get('select-devices').disabled, false);
  f.select('d');
  assert.equal(f.get('device-picker').hidden, true);
  assert.equal(f.get('setup-timing').hidden, false);
  assert.equal(f.get('selected-devices').children.length, 1);
  await f.submit();
  assert.equal(f.puts.length, 1);
  assert.equal(f.saved().monitors[0].id, 'd');
  assert.deepEqual(f.saved().monitors[0].strategy, {
    kind: 'device-last-seen',
  });
  assert.equal(f.get('selected-devices').children.length, 0);
});

test('same app and driver shortcut copies timing; individual overrides and other types stay independent', async () => {
  const devices = [
    inventoryDevice('a'),
    inventoryDevice('b'),
    inventoryDevice('c', 'weather'),
  ];
  const f = await ui({ adding: true, devices });
  f.choose('device-last-seen');
  f.select('a', 'b', 'c');
  assert.equal(f.get('selected-devices').children.length, 3);
  assert.equal(f.get('similar-devices').children.length, 1);
  f.field('expected', 'a').value = '360';
  f.field('timeout', 'a').value = '1080';
  findButton(f.get('similar-devices'), "Apply Device a's times to all 2")!
    .onclick!();
  assert.equal(f.field('expected', 'b').value, '360');
  assert.equal(f.field('timeout', 'b').value, '1080');
  assert.equal(f.field('expected', 'c').value, '5');
  f.field('timeout', 'b').value = '1440';
  f.field('expected', 'c').value = '10';
  f.field('timeout', 'c').value = '90';
  await f.submit();
  assert.equal(f.puts.length, 1);
  assert.deepEqual(
    f
      .saved()
      .monitors.map((m) => [
        m.id,
        m.expectedIntervalMs / 60000,
        m.staleTimeoutMs / 60000,
      ]),
    [
      ['a', 360, 1080],
      ['b', 360, 1440],
      ['c', 10, 90],
    ],
  );
  assert.ok(
    f.saved().monitors.every((m) => !('group' in m) && !('driverId' in m)),
  );
});

test('similar names, same app alone, missing driver metadata and unresolved identities never create timing groups', async () => {
  const devices = [
    inventoryDevice('a'),
    inventoryDevice('b', 'different-driver'),
    inventoryDevice('c', 'sensor', 'another-app'),
    { ...inventoryDevice('d'), driverId: undefined },
    { ...inventoryDevice('e'), identityResolved: false },
  ].map((d) => ({ ...d, deviceName: 'Smoke detector' }));
  const f = await ui({ adding: true, devices });
  f.choose('manual');
  f.select(...devices.map((d) => d.deviceId));
  assert.equal(f.get('similar-devices').children.length, 0);
  await f.submit();
  assert.equal(f.saved().monitors.length, 5);
  assert.equal(
    f.saved().monitors.find((m) => m.deviceId === 'c')!.sourceAppId,
    'another-app',
  );
});

test('reopening the picker adds/removes devices, retains remaining drafts and never saves deselected sources', async () => {
  const f = await ui({
    adding: true,
    devices: ['a', 'b', 'c'].map((id) => inventoryDevice(id)),
  });
  f.choose('manual');
  f.select('a', 'b');
  f.field('timeout', 'a').value = '99';
  f.select('a', 'c');
  assert.equal(f.field('timeout', 'a').value, '99');
  assert.equal(f.get('selected-devices').children.length, 2);
  f.get('select-devices').onclick!();
  const a = descendants(f.get('picker-options')).find(
    (e) => e.type === 'checkbox' && e.value === 'a',
  )!;
  a.checked = false;
  a.onchange!();
  f.get('cancel-devices').onclick!();
  assert.equal(f.get('device-picker').hidden, true);
  assert.equal(f.field('timeout', 'a').value, '99');
  await f.submit();
  assert.deepEqual(
    f.saved().monitors.map((m) => m.deviceId),
    ['a', 'c'],
  );
});

test('empty or unconfirmed device selection cannot save; cancelling setup creates nothing', async () => {
  const f = await ui({ adding: true });
  f.choose('manual');
  f.select('d');
  f.get('select-devices').onclick!();
  await f.submit();
  assert.match(f.get('selection-error').textContent, /Confirm or cancel/);
  f.get('cancel-devices').onclick!();
  f.select();
  await f.submit();
  assert.equal(f.puts.length, 0);
  assert.match(f.get('selection-error').textContent, /Select a device/);
  f.select('d');
  f.get('cancel').onclick!();
  assert.equal(f.get('selected-devices').children.length, 0);
  assert.equal(f.get('select-devices').disabled, true);
  assert.equal(f.saved().monitors.length, 0);
});

test('bulk setup preserves existing records; summary filters lead to individual edits with stable IDs', async () => {
  const f = await ui({
    devices: [inventoryDevice('d'), inventoryDevice('a'), inventoryDevice('b')],
  });
  assert.match(f.text('monitor-summary'), /Delivery timestamp · 1/);
  f.choose('manual');
  f.select('d', 'a', 'b');
  assert.equal(f.get('selected-devices').children.length, 2);
  await f.submit();
  assert.deepEqual(f.saved().monitors[0], f.initial.monitors[0]);
  assert.match(f.text('monitor-summary'), /Explicit heartbeat · 2/);
  findButton(f.get('monitor-summary'), 'Explicit heartbeat · 2')!.onclick!();
  assert.equal(f.get('monitors').children.length, 2);
  f.edit();
  assert.equal(f.get('edit-fields').hidden, false);
  assert.equal(f.get('setup-fields').hidden, true);
  f.field('timeout').value = '77';
  await f.submit();
  assert.equal(f.saved().monitors.length, 3);
  assert.deepEqual(
    f.saved().monitors.map((m) => m.id),
    ['stable-id', 'a', 'b'],
  );
  assert.equal(f.saved().monitors[1].staleTimeoutMs, 77 * 60000);
  assert.equal(f.saved().monitors[2].staleTimeoutMs, 15 * 60000);
  assert.deepEqual(f.saved().monitors[0], f.initial.monitors[0]);
  findButton(f.get('monitor-summary'), 'All · 3')!.onclick!();
  assert.equal(f.get('monitors').children.length, 3);
});

test('one invalid draft blocks the whole batch; failed saves and refresh retain every independent draft', async () => {
  const f = await ui({
    adding: true,
    devices: [inventoryDevice('a'), inventoryDevice('b')],
  });
  f.choose('manual');
  f.select('a', 'b');
  f.field('expected', 'a').value = '9';
  f.field('timeout', 'b').value = '1';
  await f.submit();
  assert.equal(f.puts.length, 0);
  assert.equal(f.field('timeout', 'b').focused, true);
  f.field('timeout', 'b').value = '20';
  f.fail();
  await f.submit();
  assert.equal(f.saved().monitors.length, 0);
  assert.equal(f.get('save-details').hidden, false);
  await f.get('refresh').onclick!();
  assert.equal(f.field('expected', 'a').value, '9');
  assert.equal(f.field('timeout', 'b').value, '20');
  f.fail(null);
  await f.submit();
  assert.equal(f.saved().monitors.length, 2);
});

test('timestamp settings remain per device through method changes and are not copied by timing shortcut', async () => {
  const f = await ui({
    adding: true,
    devices: [
      inventoryDevice('a'),
      {
        ...inventoryDevice('b'),
        capabilities: [{ id: 'epoch', title: 'Receipt', type: 'number' }],
      },
    ],
  });
  f.choose('timestamp-capability');
  f.select('a', 'b');
  f.field('encoding', 'b').value = 'epoch-ms';
  f.field('contract', 'b').value = 'Device b receipt timestamp';
  findButton(f.get('similar-devices'), "Apply Device a's times to all 2")!
    .onclick!();
  f.choose('manual');
  assert.equal(f.field('timestamp-fields', 'a').hidden, true);
  f.choose('timestamp-capability');
  assert.equal(f.field('timestamp-fields', 'a').hidden, false);
  await f.submit();
  assert.deepEqual(
    f.saved().monitors.map((m) => m.strategy),
    [
      {
        kind: 'timestamp-capability',
        capabilities: ['timestamp'],
        encoding: 'iso',
      },
      {
        kind: 'timestamp-capability',
        capabilities: ['epoch'],
        encoding: 'epoch-ms',
      },
    ],
  );
  assert.equal(
    f.saved().monitors[1].sourceContract,
    'Device b receipt timestamp',
  );
});

test('a source removed during inventory refresh blocks save and can still be deselected', async () => {
  const devices = [inventoryDevice('a'), inventoryDevice('b')];
  const f = await ui({ adding: true, devices });
  f.choose('manual');
  f.select('a', 'b');
  devices.pop();
  await f.get('refresh').onclick!();
  await f.submit();
  assert.equal(f.puts.length, 0);
  assert.match(f.get('selection-error').textContent, /Device b is no longer/);
  f.select('a');
  await f.submit();
  assert.deepEqual(
    f.saved().monitors.map((m) => m.deviceId),
    ['a'],
  );
});

test('UI Edit loads full configuration including missing fields; Save preserves ID and avoids duplicates', async () => {
  const f = await ui();
  f.edit();
  assert.equal(f.get('add').textContent, 'Save changes');
  assert.equal(f.get('source').disabled, true);
  assert.equal(f.get('device').value, 'd');
  assert.equal(f.field('expected').value, '0.5');
  assert.equal(f.field('timeout').value, '3');
  assert.equal(f.field('encoding').value, 'iso');
  assert.deepEqual(
    f
      .caps()
      .filter((i) => i.checked)
      .map((i) => i.value),
    ['timestamp', 'missing-cap'],
  );
  assert.equal(findButton(f.get('monitors'), 'Remove')!.disabled, true);
  assert.equal(findButton(f.get('monitors'), 'Disable')!.disabled, true);
  f.field('timeout').value = '4';
  f.field('enabled').checked = false;
  await f.submit();
  assert.equal(f.puts.length, 1);
  assert.equal(f.saved().monitors.length, 1);
  assert.equal(f.saved().monitors[0].id, 'stable-id');
  assert.equal(f.saved().monitors[0].staleTimeoutMs, 240000);
  assert.equal(f.saved().monitors[0].enabled, false);
  assert.equal(f.get('add').textContent, 'Add monitor');
  assert.equal(f.get('cancel').hidden, true);
});

test('UI Cancel discards draft, restores initial config, and performs no write', async () => {
  const f = await ui();
  f.edit();
  f.field('contract').value = 'Unsaved draft';
  f.choose('manual');
  f.get('cancel').onclick!();
  assert.equal(f.puts.length, 0);
  assert.deepEqual(f.saved(), f.initial);
  assert.equal(f.get('source').disabled, false);
  assert.equal(f.get('cancel').hidden, true);
  f.edit();
  assert.equal(f.field('contract').value, 'Real simulation timestamp');
  assert.equal(f.get('strategy-timestamp-capability').checked, true);
});

test('UI refresh and rejected backend save preserve the edit draft, with error beside current action', async () => {
  const f = await ui();
  f.edit();
  f.field('timeout').value = '9';
  await f.get('refresh').onclick!();
  assert.equal(f.field('timeout').value, '9');
  assert.equal(f.get('add').textContent, 'Save changes');
  f.fail();
  await f.submit();
  assert.deepEqual(f.saved(), f.initial);
  assert.equal(f.field('timeout').value, '9');
  assert.equal(f.get('add').disabled, false);
  assert.match(f.get('form-message').textContent, /could not be saved/);
  assert.equal(f.get('form-message').focused, true);
  assert.equal(f.get('save-details').hidden, false);
});

test('timestamp fields are conditional for all three choices', async () => {
  const f = await ui({ adding: true });
  for (const kind of ['manual', 'timestamp-capability', 'device-last-seen']) {
    f.choose(kind);
    assert.equal(
      f.get('timestamp-fields').hidden,
      kind !== 'timestamp-capability',
    );
  }
});

test('one compatible timestamp field is auto-selected; empty note saves successfully and monitor appears', async () => {
  const f = await ui({ adding: true });
  f.choose('timestamp-capability');
  f.select('d');
  assert.equal(f.caps().length, 1);
  assert.equal(f.caps()[0].checked, true);
  assert.match(text(f.card()), /Last test heartbeat/);
  f.field('expected').value = '0.5';
  f.field('timeout').value = '3';
  assert.equal(f.field('contract').value, '');
  await f.submit();
  assert.equal(f.puts.length, 1);
  assert.equal(f.saved().monitors.length, 1);
  assert.equal(f.saved().monitors[0].sourceContract, '');
  assert.match(f.text('monitors'), /Simulation/);
  assert.match(f.get('form-message').textContent, /Monitor saved/);
});

test('multiple capabilities use independent checkboxes with clear names and preserve selected array', async () => {
  const f = await ui({
    adding: true,
    capabilities: [
      { id: 'a', title: 'Delivery time', type: 'string' },
      { id: 'b', title: 'Latest receipt', type: 'number' },
      { id: 'switch', title: 'Switch', type: 'boolean' },
    ],
  });
  f.choose('timestamp-capability');
  f.select('d');
  assert.equal(f.caps().length, 2);
  assert.ok(
    f.caps().every((input) => input.type === 'checkbox' && !input.checked),
  );
  for (const input of f.caps()) {
    input.checked = true;
    input.onchange!();
  }
  await f.submit();
  assert.deepEqual(f.saved().monitors[0].strategy, {
    kind: 'timestamp-capability',
    capabilities: ['a', 'b'],
    encoding: 'iso',
  });
});

test('live regression: no timestamp selected, then note filled still fails visibly; selecting it saves', async () => {
  const f = await ui({ adding: true });
  f.choose('timestamp-capability');
  f.select('d');
  const input = f.caps()[0];
  input.checked = false;
  await f.submit();
  assert.equal(f.puts.length, 0);
  assert.match(
    f.field('capabilities-error').textContent,
    /Select which timestamp/,
  );
  assert.equal(f.field('capabilities-error').hidden, false);
  assert.equal(input.focused, true);
  assert.equal(input.scrolled, true);
  assert.match(f.get('form-message').textContent, /highlighted fields/);
  f.field('contract').value = 'Now the technical note is filled';
  await f.submit();
  assert.equal(f.puts.length, 0);
  input.checked = true;
  input.onchange!();
  assert.equal(f.field('capabilities-error').hidden, true);
  await f.submit();
  assert.equal(f.saved().monitors.length, 1);
});

test('timing order and backend minimum show inline errors, no writes, and clear when corrected', async () => {
  const f = await ui({ adding: true });
  f.choose('timestamp-capability');
  f.select('d');
  f.field('expected').value = '5';
  f.field('timeout').value = '3';
  await f.submit();
  assert.equal(f.puts.length, 0);
  assert.match(f.field('timeout-error').textContent, /equal to or longer/);
  assert.equal(f.field('timeout').focused, true);
  f.field('expected').value = '0.5';
  f.field('expected').oninput!();
  assert.equal(f.field('timeout-error').hidden, true);
  f.field('timeout').value = '1';
  await f.submit();
  assert.match(f.field('timeout-error').textContent, /at least 2 minutes/);
  assert.equal(f.puts.length, 0);
  f.choose('manual');
  assert.equal(f.field('timeout-error').hidden, true);
  await f.submit();
  assert.equal(f.puts.length, 1);
});

test('missing device and invalid numeric values cannot send config writes', async () => {
  const f = await ui({ adding: true, missingDevice: true });
  await f.submit();
  assert.match(f.get('selection-error').textContent, /Select a device/);
  assert.equal(f.puts.length, 0);
  const g = await ui({ adding: true });
  g.choose('manual');
  g.select('d');
  for (const value of ['', '0', '-1', 'Infinity', '525601', '0.000001']) {
    g.field('expected').value = value;
    await g.submit();
    assert.match(g.field('expected-error').textContent, /greater than zero/);
  }
  assert.equal(g.puts.length, 0);
});

test('serialized backend Zod error is translated and focuses the relevant field', async () => {
  const f = await ui();
  f.edit();
  f.fail({
    message: JSON.stringify([
      {
        code: 'too_small',
        path: ['monitors', 0, 'strategy', 'capabilities'],
        message: 'Too small: expected array to have >=1 items',
      },
    ]),
  });
  await f.submit();
  assert.match(
    f.field('capabilities-error').textContent,
    /Select which timestamp/,
  );
  assert.equal(f.caps()[0].focused, true);
  assert.equal(f.get('add').textContent, 'Save changes');
  assert.equal(f.saved().monitors[0].id, 'stable-id');
});

test('successful config write remains visible when status refresh fails', async () => {
  const f = await ui({ adding: true });
  f.choose('manual');
  f.select('d');
  f.statusFail();
  await f.submit();
  assert.equal(f.saved().monitors.length, 1);
  assert.match(f.text('monitors'), /Simulation/);
  assert.match(
    f.get('form-message').textContent,
    /Monitor saved.*could not be refreshed/,
  );
});

test('self-test and observer use readable summaries; unpaired controls are hidden', async () => {
  const f = await ui();
  assert.equal(f.get('test-paired').hidden, true);
  assert.equal(f.get('test-unpaired').hidden, false);
  assert.match(f.text('observer-summary'), /Connected/);
  assert.match(f.text('observer-summary'), /Dispatch failures 0/);
  assert.match(f.text('integration-status'), /App HEALTHY/);
  assert.match(f.get('status').textContent, /"observer"/);
  const paired = await ui({ paired: true });
  assert.equal(paired.get('test-paired').hidden, false);
  assert.equal(paired.get('test-badge').textContent, 'STOPPED');
  assert.match(paired.text('test-summary'), /30 s/);
  assert.match(paired.text('test-details'), /Not sent/);
  await paired.get('test-start').onclick!();
  assert.equal(paired.get('test-badge').textContent, 'RUNNING');
  await paired.get('test-stop').onclick!();
  await paired.get('test-send').onclick!();
  assert.equal(paired.get('test-badge').textContent, 'STOPPED');
  assert.deepEqual(paired.actions, ['start', 'stop', 'send']);
});

test('both minute inputs configure half-minute arrow steps without native step validation changing save semantics', () => {
  const html = readFileSync('settings/index.html', 'utf8');
  for (const id of ['expected', 'timeout']) {
    const input = html.match(
      new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`),
    )?.[0];
    assert.ok(input, `${id} input exists`);
    assert.match(input, /\btype="number"/);
    assert.match(input, /\bstep="0\.5"/);
  }
  assert.match(html, /<form\b[^>]*id="monitor-form"[^>]*\bnovalidate\b/);
});

for (const minutes of [0.5, 1.5])
  test(`${minutes} minute inputs save as exact milliseconds with existing strategy limits`, async () => {
    const f = await ui({ adding: true });
    f.choose('manual');
    f.select('d');
    f.field('expected').value = String(minutes);
    f.field('timeout').value = String(minutes);
    await f.submit();
    assert.equal(f.puts.length, 1);
    assert.equal(f.saved().monitors[0].expectedIntervalMs, minutes * 60000);
    assert.equal(f.saved().monitors[0].staleTimeoutMs, minutes * 60000);
    const observed = await ui({ adding: true });
    observed.choose('timestamp-capability');
    observed.select('d');
    observed.field('expected').value = String(minutes);
    observed.field('timeout').value = '2';
    await observed.submit();
    assert.equal(observed.puts.length, 1);
    assert.equal(
      observed.saved().monitors[0].expectedIntervalMs,
      minutes * 60000,
    );
  });

test('built-in Help is collapsed, local, structured and covers everyday use', () => {
  const html = readFileSync('settings/index.html', 'utf8');
  const start = html.indexOf('<details id="help"');
  const end = html.indexOf('<p id="message"', start);
  assert.ok(start >= 0 && end > start);
  const help = html.slice(start, end);
  const plain = help.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const opening = help.match(/^<details\b[^>]*>/)![0];
  assert.doesNotMatch(opening, /\bopen(?:\s|=|>)/);
  assert.match(help, /<summary>How to use Data Watchdog<\/summary>/);
  for (const topic of [
    'basics',
    'quick-start',
    'methods',
    'timing',
    'statuses',
    'notifications',
    'self-test',
    'advanced',
    'troubleshooting',
    'limitations',
  ])
    assert.match(help, new RegExp(`id="help-${topic}"`));
  assert.match(help, /Quick start/);
  assert.match(help, /<ol>/);
  for (const method of [
    'Device activity',
    'Delivery timestamp',
    'Explicit heartbeat',
  ])
    assert.ok(plain.includes(method));
  for (const state of [
    'WARMING_UP',
    'HEALTHY',
    'SUSPECTED_STALE',
    'DEVICE_STALE',
    'RECOVERING',
    'DISABLED',
    'MISSING',
    'UNKNOWN',
  ])
    assert.ok(help.includes(`<dt>${state}</dt>`));
  for (const term of [
    'Any watchdog incident started',
    'Any watchdog incident recovered',
    'Send a push notification',
    'Start heartbeat',
    'Stop',
    'Send once',
    'STOPPED',
  ])
    assert.ok(plain.includes(term));
  assert.match(plain, /Technical note is optional/);
  assert.match(plain, /does not affect detection/);
  assert.match(plain, /21\.3 °C/);
  assert.doesNotMatch(help, /https?:\/\/|<iframe|<script/);
});

test('standalone user guide is linked from README and covers setup, notifications, troubleshooting and limitations', () => {
  const guide = readFileSync('docs/user-guide.md', 'utf8');
  for (const heading of [
    'What Data Watchdog does',
    'Quick start',
    'Choosing a freshness method',
    'Choosing the timing',
    'Understanding monitor statuses',
    'Getting notifications',
    'Editing and disabling monitors',
    'Using the local self-test',
    'Troubleshooting',
    'Good monitoring examples',
    'Important limitations',
  ])
    assert.ok(guide.includes(`## ${heading}`));
  assert.match(
    readFileSync('README.md', 'utf8'),
    /\[User Guide\]\(docs\/user-guide\.md\)/,
  );
  assert.match(guide, /Any watchdog incident recovered/);
  assert.match(guide, /cannot report a complete outage/);
});
