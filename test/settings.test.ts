import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { configSchema, WatchdogConfig } from '../src/core/model';

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
async function ui(
  options: {
    adding?: boolean;
    capabilities?: { id: string; title: string; type?: string }[];
    paired?: boolean;
    missingDevice?: boolean;
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
    const element = elements.get(id);
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
        '/inventory': [
          {
            sourceAppId: 'app',
            sourceAppName: 'App',
            devices: options.missingDevice
              ? []
              : [
                  {
                    ...initialConfig().monitors[0],
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
  return {
    get,
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
    caps: () =>
      get('capability-options').children.map((label) => label.children[0]),
  };
}

test('UI Edit loads full configuration including missing fields; Save preserves ID and avoids duplicates', async () => {
  const f = await ui();
  f.edit();
  assert.equal(f.get('add').textContent, 'Save changes');
  assert.equal(f.get('source').disabled, true);
  assert.equal(f.get('device').value, 'd');
  assert.equal(f.get('expected').value, '0.5');
  assert.equal(f.get('timeout').value, '3');
  assert.equal(f.get('encoding').value, 'iso');
  assert.deepEqual(
    f
      .caps()
      .filter((i) => i.checked)
      .map((i) => i.value),
    ['timestamp', 'missing-cap'],
  );
  assert.equal(findButton(f.get('monitors'), 'Remove')!.disabled, true);
  assert.equal(findButton(f.get('monitors'), 'Disable')!.disabled, true);
  f.get('timeout').value = '4';
  f.get('enabled').checked = false;
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
  f.get('contract').value = 'Unsaved draft';
  f.choose('manual');
  f.get('cancel').onclick!();
  assert.equal(f.puts.length, 0);
  assert.deepEqual(f.saved(), f.initial);
  assert.equal(f.get('source').disabled, false);
  assert.equal(f.get('cancel').hidden, true);
  f.edit();
  assert.equal(f.get('contract').value, 'Real simulation timestamp');
  assert.equal(f.get('strategy-timestamp-capability').checked, true);
});

test('UI refresh and rejected backend save preserve the edit draft, with error beside current action', async () => {
  const f = await ui();
  f.edit();
  f.get('timeout').value = '9';
  await f.get('refresh').onclick!();
  assert.equal(f.get('timeout').value, '9');
  assert.equal(f.get('add').textContent, 'Save changes');
  f.fail();
  await f.submit();
  assert.deepEqual(f.saved(), f.initial);
  assert.equal(f.get('timeout').value, '9');
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
  assert.equal(f.caps().length, 1);
  assert.equal(f.caps()[0].checked, true);
  assert.match(f.text('capability-options'), /Last test heartbeat/);
  f.get('expected').value = '0.5';
  f.get('timeout').value = '3';
  assert.equal(f.get('contract').value, '');
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
  const input = f.caps()[0];
  input.checked = false;
  await f.submit();
  assert.equal(f.puts.length, 0);
  assert.match(
    f.get('capabilities-error').textContent,
    /Select which timestamp/,
  );
  assert.equal(f.get('capabilities-error').hidden, false);
  assert.equal(input.focused, true);
  assert.equal(input.scrolled, true);
  assert.match(f.get('form-message').textContent, /highlighted fields/);
  f.get('contract').value = 'Now the technical note is filled';
  await f.submit();
  assert.equal(f.puts.length, 0);
  input.checked = true;
  input.onchange!();
  assert.equal(f.get('capabilities-error').hidden, true);
  await f.submit();
  assert.equal(f.saved().monitors.length, 1);
});

test('timing order and backend minimum show inline errors, no writes, and clear when corrected', async () => {
  const f = await ui({ adding: true });
  f.choose('timestamp-capability');
  f.get('expected').value = '5';
  f.get('timeout').value = '3';
  await f.submit();
  assert.equal(f.puts.length, 0);
  assert.match(f.get('timeout-error').textContent, /equal to or longer/);
  assert.equal(f.get('timeout').focused, true);
  f.get('expected').value = '0.5';
  f.get('expected').oninput!();
  assert.equal(f.get('timeout-error').hidden, true);
  f.get('timeout').value = '1';
  await f.submit();
  assert.match(f.get('timeout-error').textContent, /at least 2 minutes/);
  assert.equal(f.puts.length, 0);
  f.choose('manual');
  assert.equal(f.get('timeout-error').hidden, true);
  await f.submit();
  assert.equal(f.puts.length, 1);
});

test('missing device and invalid numeric values cannot send config writes', async () => {
  const f = await ui({ adding: true, missingDevice: true });
  await f.submit();
  assert.match(f.get('device-error').textContent, /Select a device/);
  assert.equal(f.puts.length, 0);
  const g = await ui({ adding: true });
  for (const value of ['', '0', '-1', 'Infinity', '525601', '0.000001']) {
    g.get('expected').value = value;
    await g.submit();
    assert.match(g.get('expected-error').textContent, /greater than zero/);
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
    f.get('capabilities-error').textContent,
    /Select which timestamp/,
  );
  assert.equal(f.caps()[0].focused, true);
  assert.equal(f.get('add').textContent, 'Save changes');
  assert.equal(f.saved().monitors[0].id, 'stable-id');
});

test('successful config write remains visible when status refresh fails', async () => {
  const f = await ui({ adding: true });
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
