import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { configSchema, WatchdogConfig } from '../src/core/model';
import { buildInventory, InventoryDevice } from '../src/homey/inventory';

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
  ontoggle?: () => unknown;
  onkeydown?: (event: { key: string; preventDefault(): void }) => unknown;
  onfocusout?: (event: { relatedTarget: Element | null }) => unknown;
  contains(other: Element | null) {
    return other !== null && descendants(this).includes(other);
  }
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
  getAttribute(key: string) {
    return this.attributes.get(key);
  }
  querySelector() {
    return descendants(this).find((e) => e.tag === 'input' && !e.disabled);
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
const visibleText = (element: Element): string => {
  if (element.hidden) return '';
  const children =
    element.tag === 'details' && !element.open
      ? element.children.filter((child) => child.tag === 'summary')
      : element.children;
  return [element.textContent, ...children.map(visibleText)].join(' ');
};
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
const isoCandidate = {
  encoding: 'iso' as const,
  at: Date.parse('2026-09-22T17:42:00Z'),
};
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
    {
      id: 'timestamp',
      title: 'Last data received',
      type: 'string',
      timestampCandidate: isoCandidate,
    },
  ],
});
async function ui(
  options: {
    adding?: boolean;
    language?: string;
    monitors?: WatchdogConfig['monitors'];
    capabilities?: InventoryDevice['capabilities'];
    paired?: boolean;
    runtimeStates?: Record<string, string>;
    lastDeliveryAt?: number | null;
    sourceError?: string;
    observerState?: string;
    restoreState?: string;
    integrationState?: string;
    missingDevice?: boolean;
    devices?: InventoryDevice[];
  } = {},
) {
  const elements = new Map<string, Element>();
  const staticElements: Element[] = [];
  for (const match of readFileSync('settings/index.html', 'utf8').matchAll(
    /<(\w+)[^>]*>/g,
  )) {
    const item = new Element(match[1]);
    item.id = match[0].match(/\bid="([^"]+)"/)?.[1] ?? '';
    item.value = match[0].match(/\bvalue="([^"]*)"/)?.[1] ?? '';
    item.hidden = /\bhidden\b/.test(match[0]);
    const translation = match[0].match(/data-i18n="([^"]+)"/)?.[1];
    if (translation) item.setAttribute('data-i18n', translation);
    staticElements.push(item);
    if (item.id) elements.set(item.id, item);
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
  if (options.monitors) initial.monitors = options.monitors;
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
    lastError: options.sourceError,
  });
  const context = vm.createContext({
    window: {},
    document: {
      documentElement: new Element('html'),
      getElementById: get,
      querySelectorAll: () =>
        staticElements.filter((e) => e.getAttribute('data-i18n')),
      createElement: (tag: string) => new Element(tag),
    },
  });
  vm.runInContext(readFileSync('settings/settings.js', 'utf8'), context);
  context.mockHomey = {
    ready() {},
    __(key: string, tokens: Record<string, string | number> = {}) {
      const locale = JSON.parse(
        readFileSync(
          `locales/${options.language === 'nl' ? 'nl' : 'en'}.json`,
          'utf8',
        ),
      );
      const value = key
        .split('.')
        .reduce((current, part) => current?.[part], locale);
      assert.equal(typeof value, 'string', `Missing translation: ${key}`);
      return value.replace(/__(\w+)__/g, (_: string, name: string) =>
        String(tokens[name] ?? `__${name}__`),
      );
    },
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
                            timestampCandidate: isoCandidate,
                          },
                        ],
                      },
                    ],
              },
            ],
        '/status': {
          observer: options.observerState ?? 'observing',
          restore: options.restoreState ?? 'restored',
          dispatchFailures: 0,
          integrations: saved.monitors.length
            ? [
                {
                  sourceAppId: 'app',
                  state: options.integrationState ?? 'HEALTHY',
                },
              ]
            : [],
          monitors: saved.monitors.map((m) => ({
            ...m,
            runtime: {
              state: options.runtimeStates?.[m.id] ?? 'HEALTHY',
              lastDeliveryAt:
                options.lastDeliveryAt === undefined
                  ? 1000000
                  : options.lastDeliveryAt,
            },
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
    if (get('monitor-setup').hidden) get('add-monitor').onclick!();
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
    const controls = descendants(card(id));
    if (
      ['expected', 'timeout', 'expected-error', 'timeout-error'].includes(
        key,
      ) &&
      controls
        .find((e) => e.id.endsWith('-override'))
        ?.getAttribute('aria-pressed') !== 'true'
    )
      return get(`setup-${key}`);
    const result = controls.find((e) => e.id.endsWith(`-${key}`));
    assert.ok(result, `Missing setup field: ${key}`);
    return result;
  };
  return {
    get,
    language: () => context.document.documentElement.lang,
    field,
    select,
    card,
    translations: () =>
      staticElements
        .filter((e) => e.getAttribute('data-i18n'))
        .map((e) => e.textContent),
    override: (id = 'd') => {
      get('device-settings').open = true;
      field('override', id).onclick!();
    },
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
    submit: () => {
      if (get('monitor-setup').hidden) get('add-monitor').onclick!();
      return get('monitor-form').onsubmit!({ preventDefault() {} });
    },
    choose,
    caps: (id = 'd') =>
      get('edit-fields').hidden
        ? descendants(card(id)).filter((e) => e.type === 'checkbox' && e.value)
        : get('capability-options').children.map((label) => label.children[0]),
  };
}

test('top Add monitor opens setup before the list; close and successful save hide it without losing feedback', async () => {
  const f = await ui({ adding: true });
  const html = readFileSync('settings/index.html', 'utf8');
  assert.ok(
    html.indexOf('id="add-monitor"') < html.indexOf('id="monitor-setup"'),
  );
  assert.ok(html.indexOf('id="monitor-setup"') < html.indexOf('id="monitors"'));
  assert.equal(f.get('monitor-setup').hidden, true);
  assert.equal(f.get('add-monitor').getAttribute('aria-expanded'), 'false');
  f.get('add-monitor').onclick!();
  assert.equal(f.get('monitor-setup').hidden, false);
  assert.equal(f.get('add-monitor').getAttribute('aria-expanded'), 'true');
  assert.equal(f.get('strategy-device-last-seen').focused, true);
  f.choose('manual');
  f.select('d');
  f.get('setup-timeout').value = '90';
  f.get('close-setup').onclick!();
  assert.equal(f.get('monitor-setup').hidden, true);
  assert.equal(f.puts.length, 0);
  f.choose('manual');
  assert.equal(f.get('setup-timeout').value, '15');
  f.select('d');
  await f.submit();
  assert.equal(f.get('monitor-setup').hidden, true);
  assert.equal(f.get('add-monitor').focused, true);
  assert.equal(f.get('message').textContent, 'Monitor saved.');
  assert.equal(f.saved().monitors.length, 1);
});

for (const language of ['nl', 'en'])
  test(`${language}: compact cards show every strategy with name, status, timeout and collapsed details`, async () => {
    const original = initialConfig().monitors[0];
    const monitors = [
      {
        ...original,
        id: 'activity',
        deviceId: 'a',
        strategy: { kind: 'device-last-seen' as const },
      },
      { ...original, id: 'data', deviceId: 'b' },
      {
        ...original,
        id: 'flow',
        deviceId: 'c',
        strategy: { kind: 'manual' as const },
      },
    ];
    const f = await ui({ language, monitors });
    const methods =
      language === 'nl'
        ? [
            'Apparaatactiviteit',
            'Laatste gegevens ontvangen',
            'Bevestiging via Flow',
          ]
        : ['Device activity', 'Last data received', 'Flow confirmation'];
    const descriptions =
      language === 'nl'
        ? [
            'Controleert of Homey het apparaat recent nog heeft gezien.',
            'Gebruik dit als het apparaat of de app zelf bijhoudt wanneer er voor het laatst nieuwe gegevens zijn ontvangen.',
            'Laat een Homey Flow na een geslaagde update doorgeven dat alles nog werkt.',
          ]
        : [
            'Checks whether Homey has seen the device recently.',
            'Use this when the device or app keeps track of when new data was last received.',
            'Let a Homey Flow confirm after a successful update that everything is still working.',
          ];
    assert.equal(f.get('monitors').children.length, 3);
    for (const [index, card] of f.get('monitors').children.entries()) {
      assert.equal(card.className, 'monitor-row');
      assert.equal(card.children[0].children[0].textContent, 'Simulation');
      assert.equal(
        card.children[0].children[1].textContent,
        language === 'nl' ? 'Gezond' : 'Healthy',
      );
      const metadata = card.children.find(
        (e) => e.className === 'monitor-meta',
      )!;
      assert.ok(metadata.textContent.includes(`App · ${methods[index]} ·`));
      assert.match(metadata.textContent, /3 min/);
      assert.match(
        descendants(card).find((e) => e.className === 'monitor-last')!
          .textContent,
        language === 'nl'
          ? /^(Laatste activiteit|Laatst ontvangen):/
          : /^(Last activity|Last received):/,
      );
      assert.equal(
        card.children.some((e) => e.tag === 'dl'),
        false,
      );
      assert.equal(
        descendants(card).find((e) => e.className === 'monitor-technical')!
          .open,
        false,
      );
      assert.ok(f.translations().includes(methods[index]));
      assert.ok(f.translations().includes(descriptions[index]));
    }
    assert.deepEqual(f.saved().monitors, monitors);
    assert.equal(f.puts.length, 0);
    assert.equal(
      f.get('add-monitor').textContent,
      language === 'nl' ? '+ Monitor toevoegen' : '+ Add monitor',
    );
  });

test('compact card actions preserve individual edits, enabled state and removal with stable IDs and strategies', async () => {
  const original = initialConfig().monitors[0];
  const other = { ...original, id: 'other', deviceId: 'other-device' };
  const f = await ui({ monitors: [original, other] });
  assert.equal(f.get('monitor-setup').hidden, true);
  f.edit();
  assert.equal(f.get('monitor-setup').hidden, false);
  assert.equal(f.get('add-monitor').disabled, true);
  assert.equal(f.get('setup-fields').hidden, true);
  assert.equal(f.get('strategy-timestamp-capability').checked, true);
  f.field('timeout').value = '4';
  await f.submit();
  assert.deepEqual(f.saved().monitors[0], {
    ...original,
    staleTimeoutMs: 240000,
  });
  assert.deepEqual(f.saved().monitors[1], other);
  assert.equal(f.get('monitor-setup').hidden, true);
  await findButton(f.get('monitors').children[0], 'Disable')!.onclick!();
  assert.equal(f.saved().monitors[0].enabled, false);
  assert.match(text(f.get('monitors').children[0]), /DISABLED/);
  await findButton(f.get('monitors').children[0], 'Enable')!.onclick!();
  assert.deepEqual(f.saved().monitors[0], {
    ...original,
    staleTimeoutMs: 240000,
  });
  const remove = findButton(f.get('monitors').children[0], 'Remove')!;
  assert.equal(remove.className, 'danger');
  await remove.onclick!();
  assert.deepEqual(f.saved().monitors, [other]);
  assert.equal(f.get('monitors').children.length, 1);
});

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

for (const language of ['en', 'nl'])
  test(`${language}: setup labels, selection, validation and confirmation use Homey's locale`, async () => {
    const f = await ui({ language, adding: true });
    const dutch = language === 'nl';
    assert.equal(
      f.get('form-title').textContent,
      dutch ? 'Nieuwe monitors' : 'New monitors',
    );
    assert.equal(
      f.get('select-devices').textContent,
      dutch ? 'Apparaten kiezen' : 'Select devices',
    );
    for (const label of dutch
      ? [
          'Controleer via',
          'Apparaten',
          'Apparaatactiviteit',
          'Laatste gegevens ontvangen',
          'Bevestiging via Flow',
          'Instellingen per apparaat aanpassen',
        ]
      : [
          'Check via',
          'Devices',
          'Device activity',
          'Last data received',
          'Flow confirmation',
          'Adjust settings per device',
        ])
      assert.ok(f.translations().includes(label), label);
    f.choose('device-last-seen');
    f.get('select-devices').onclick!();
    assert.equal(f.get('form-actions').hidden, true);
    assert.equal(f.get('selection-controls').hidden, true);
    assert.equal(f.get('cancel').hidden, true);
    assert.equal(
      f.get('confirm-devices').textContent,
      dutch ? 'Selectie bevestigen' : 'Use selection',
    );
    f.get('cancel-devices').onclick!();
    assert.equal(f.get('form-actions').hidden, false);
    f.select('d');
    assert.equal(f.get('device-picker').hidden, true);
    assert.equal(f.get('device-settings').open, false);
    assert.equal(
      f.text('selection-summary'),
      dutch ? '1 gekozen · Simulation' : '1 selected · Simulation',
    );
    assert.equal(
      f.get('select-devices').textContent,
      dutch ? 'Wijzigen' : 'Change',
    );
    assert.equal(
      f.get('add').textContent,
      dutch ? 'Monitors toevoegen' : 'Add monitors',
    );
    f.get('setup-expected').value = '0.5';
    f.get('setup-timeout').value = '1';
    await f.submit();
    assert.equal(f.puts.length, 0);
    assert.match(
      f.get('setup-timeout-error').textContent,
      dutch ? /minimaal 2 minuten/ : /at least 2 minutes/,
    );
    assert.equal(f.get('setup-timeout').focused, true);
    assert.equal(f.get('device-settings').open, false);
    f.get('setup-timeout').value = '2';
    await f.submit();
    assert.equal(
      f.get('form-message').textContent,
      dutch ? 'Monitor opgeslagen.' : 'Monitor saved.',
    );
  });

test('locale catalogs cover the same settings keys and unsupported locales fall back to English', async () => {
  const en = JSON.parse(readFileSync('locales/en.json', 'utf8'));
  const nl = JSON.parse(readFileSync('locales/nl.json', 'utf8'));
  const flatten = (value: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === 'object'
        ? flatten(item as Record<string, unknown>, `${prefix}${key}.`)
        : (assert.equal(typeof item, 'string'),
          assert.ok(item),
          [`${prefix}${key}`]),
    );
  assert.deepEqual(flatten(en), flatten(nl));
  const f = await ui({ adding: true, language: 'de' });
  assert.equal(f.get('select-devices').textContent, 'Select devices');
});

test('method and device tiles retain native accessible selection semantics without visible native glyphs', async () => {
  const html = readFileSync('settings/index.html', 'utf8');
  const css = readFileSync('settings/settings.css', 'utf8');
  assert.match(
    html,
    /class="method-choice"[^]*?<input[^]*?type="radio"[^]*?name="strategy"/,
  );
  assert.match(
    css,
    /\.method-choice input,\s*\.selection-tile input,\s*\.choice input\s*\{[^}]*clip-path: inset\(50%\)/,
  );
  assert.match(css, /\.method-choice:has\(input:focus-visible\)/);
  assert.match(css, /\.selection-tile:has\(input:focus-visible\)/);
  const f = await ui({ adding: true });
  f.choose('manual');
  f.get('select-devices').onclick!();
  const tile = descendants(f.get('picker-options')).find(
    (e) => e.className === 'selection-tile',
  )!;
  assert.equal(tile.tag, 'label');
  assert.equal(tile.children[0].type, 'checkbox');
  assert.equal(tile.children[0].focused, true);
  tile.children[0].checked = true;
  tile.children[0].onchange!();
  f.get('confirm-devices').onclick!();
  await f.submit();
  assert.equal(f.saved().monitors.length, 1);
});

test('Dutch picker marks existing monitors and optional fields stay translated', async () => {
  const f = await ui({
    language: 'nl',
    devices: [inventoryDevice('d'), inventoryDevice('a')],
  });
  f.choose('timestamp-capability');
  f.get('select-devices').onclick!();
  assert.match(f.text('picker-options'), /Wordt al bewaakt/);
  f.get('cancel-devices').onclick!();
  f.select('a', 'd');
  assert.equal(f.get('selected-devices').children.length, 1);
  f.override('a');
  const content = text(f.card('a'));
  for (const phrase of [
    'Welk veld bevat het tijdstip van ontvangen gegevens?',
    'Tijdstempelformaat',
    'Verwacht update-interval',
    'Meldtermijn',
    'Notitie (optioneel)',
    'Monitor ingeschakeld',
  ])
    assert.ok(content.includes(phrase), phrase);
  f.caps('a')[0].checked = false;
  f.get('device-settings').open = false;
  await f.submit();
  assert.equal(f.get('device-settings').open, true);
  assert.match(
    f.field('capabilities-error', 'a').textContent,
    /Kies het tijdstempel/,
  );
  assert.equal(f.puts.length, 0);
});

test('six devices use one shared timing without opening individual settings or exposing driver logic', async () => {
  const devices = Array.from({ length: 6 }, (_, i) =>
    inventoryDevice(String(i)),
  );
  const f = await ui({ adding: true, devices });
  f.choose('device-last-seen');
  f.select(...devices.map((d) => d.deviceId));
  assert.equal(f.get('device-settings').open, false);
  assert.equal(f.get('device-picker').hidden, true);
  assert.match(f.text('selection-summary'), /6 selected/);
  for (const device of devices)
    assert.ok(f.text('selection-summary').includes(device.deviceName));
  assert.doesNotMatch(
    f.text('selected-devices'),
    /same app|similar devices|Apply .*times/i,
  );
  f.get('setup-expected').value = '360';
  f.get('setup-timeout').value = '1080';
  await f.submit();
  assert.equal(f.puts.length, 1);
  assert.equal(f.saved().monitors.length, 6);
  assert.ok(
    f
      .saved()
      .monitors.every(
        (m) =>
          m.expectedIntervalMs === 360 * 60000 &&
          m.staleTimeoutMs === 1080 * 60000,
      ),
  );
  assert.equal(new Set(f.saved().monitors.map((m) => m.id)).size, 6);
  assert.ok(
    f.saved().monitors.every((m) => !('group' in m) && !('override' in m)),
  );
});

test('one override affects only that device; inherited values follow shared changes and can be restored', async () => {
  const f = await ui({
    adding: true,
    devices: [
      inventoryDevice('a'),
      inventoryDevice('b', 'weather'),
      inventoryDevice('c', 'different', 'other-app'),
    ],
  });
  f.choose('manual');
  f.select('a', 'b', 'c');
  f.get('setup-expected').value = '10';
  f.get('setup-timeout').value = '90';
  f.get('setup-expected').oninput!();
  f.override('b');
  assert.equal(f.field('expected', 'b').value, '10');
  f.field('expected', 'b').value = '360';
  f.field('timeout', 'b').value = '1080';
  f.override('c');
  f.field('timeout', 'c').value = '120';
  f.override('c');
  f.get('setup-timeout').value = '100';
  f.get('setup-timeout').oninput!();
  assert.equal(f.field('timeout', 'b').value, '1080');
  assert.equal(f.field('timeout', 'c').value, '100');
  await f.submit();
  assert.deepEqual(
    f
      .saved()
      .monitors.map((m) => [
        m.deviceId,
        m.expectedIntervalMs / 60000,
        m.staleTimeoutMs / 60000,
      ]),
    [
      ['a', 10, 100],
      ['b', 360, 1080],
      ['c', 10, 100],
    ],
  );
});

test('reopening the picker adds/removes devices, retains remaining drafts and never saves deselected sources', async () => {
  const f = await ui({
    adding: true,
    devices: ['a', 'b', 'c'].map((id) => inventoryDevice(id)),
  });
  f.choose('manual');
  f.select('a', 'b');
  f.override('a');
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

test('empty or unconfirmed selection cannot save and picker is the only cancel action in setup', async () => {
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
  assert.equal(f.get('cancel').hidden, true);
  f.select();
  assert.equal(f.get('selected-devices').children.length, 0);
  assert.equal(f.saved().monitors.length, 0);
});

test('bulk setup preserves existing records; summary filters lead to individual edits with stable IDs', async () => {
  const f = await ui({
    devices: [inventoryDevice('d'), inventoryDevice('a'), inventoryDevice('b')],
  });
  assert.match(f.text('monitor-summary'), /Data · 1/);
  f.choose('manual');
  f.select('d', 'a', 'b');
  assert.equal(f.get('selected-devices').children.length, 2);
  await f.submit();
  assert.deepEqual(f.saved().monitors[0], f.initial.monitors[0]);
  assert.match(f.text('monitor-summary'), /Flow · 2/);
  findButton(f.get('monitor-summary'), 'Flow · 2')!.onclick!();
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
  f.override('b');
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

test('timestamp settings remain per device through method changes and shared timing updates', async () => {
  const f = await ui({
    adding: true,
    devices: [
      inventoryDevice('a'),
      {
        ...inventoryDevice('b'),
        capabilities: [
          {
            id: 'epoch',
            title: 'Receipt',
            type: 'number',
            timestampCandidate: { ...isoCandidate, encoding: 'epoch-ms' },
          },
        ],
      },
    ],
  });
  f.choose('timestamp-capability');
  f.select('a', 'b');
  f.field('encoding', 'b').value = 'epoch-ms';
  f.field('contract', 'b').value = 'Device b receipt timestamp';
  f.get('setup-expected').value = '7';
  f.get('setup-expected').oninput!();
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
  assert.equal(f.get('add').textContent, 'Add monitors');
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
      {
        id: 'a',
        title: 'Delivery time',
        type: 'string',
        timestampCandidate: isoCandidate,
      },
      {
        id: 'b',
        title: 'Latest receipt',
        type: 'string',
        timestampCandidate: isoCandidate,
      },
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
  assert.match(f.text('integration-status'), /App Healthy/);
  assert.match(f.get('status').textContent, /"observer"/);
  const paired = await ui({ paired: true });
  assert.equal(paired.get('test-paired').hidden, false);
  assert.equal(paired.get('test-badge').textContent, 'Stopped');
  assert.match(paired.text('test-summary'), /30 s/);
  assert.match(paired.text('test-details'), /Not sent/);
  await paired.get('test-start').onclick!();
  assert.equal(paired.get('test-badge').textContent, 'Running');
  await paired.get('test-stop').onclick!();
  await paired.get('test-send').onclick!();
  assert.equal(paired.get('test-badge').textContent, 'Stopped');
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

test('built-in Help stays collapsed and retains every localized topic without static English fallback', () => {
  const html = readFileSync('settings/index.html', 'utf8');
  assert.match(html, /<details id="help" class="secondary help-content">/);
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
    assert.match(html, new RegExp(`id="help-${topic}"`));
  assert.doesNotMatch(
    html,
    /Know when your sources|How to use Data Watchdog|<iframe/,
  );
  for (const language of ['nl', 'en']) {
    const locale = JSON.parse(
      readFileSync(`locales/${language}.json`, 'utf8'),
    ).settings;
    const plain = Object.entries(locale)
      .filter(([key]) => key.startsWith('help') || key.endsWith('Detail'))
      .map(([, value]) => value)
      .join(' ');
    for (const phrase of [
      language === 'nl'
        ? 'Data Pulse-incident gestart'
        : 'Data Pulse incident started',
      language === 'nl'
        ? 'Data Pulse-incident hersteld'
        : 'Data Pulse incident recovered',
      'Homey',
      'Data Pulse',
      language === 'nl' ? '21,3 °C' : '21.3 °C',
    ])
      assert.ok(plain.includes(phrase), phrase);
    assert.match(
      plain,
      language === 'nl'
        ? /beïnvloedt de detectie niet/
        : /does not affect detection/,
    );
    assert.match(
      plain,
      language === 'nl' ? /buiten die Homey/ : /outside that Homey/,
    );
  }
});

test('standalone user guide is linked from README and covers setup, notifications, troubleshooting and limitations', () => {
  const guide = readFileSync('docs/user-guide.md', 'utf8');
  for (const heading of [
    'What Data Pulse does',
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
  assert.match(guide, /Data Pulse incident recovered/);
  assert.match(guide, /cannot report a complete outage/);
});

for (const language of ['nl', 'en']) {
  test(`timestamp selection offers actual date values with a localized preview (${language})`, async () => {
    const at = Date.parse('2026-09-22T17:42:00Z');
    for (const [value, encoding] of [
      ['2026-09-22T17:42:00Z', 'iso'],
      [at / 1000, 'epoch-seconds'],
      [at, 'epoch-ms'],
    ] as const) {
      const capabilities = buildInventory(
        {
          d: {
            id: 'd',
            name: 'Simulation',
            ownerUri: 'homey:app:app',
            capabilitiesObj: {
              received: {
                title: language === 'nl' ? 'Laatste ontvangst' : 'Last receipt',
                value,
              },
              measure_temperature: {
                value: 21.4,
                lastUpdated: '2026-09-22T17:42:00Z',
              },
              invalid: { value: 'not a date' },
            },
          },
        },
        {},
        {},
        at + 1000,
      )[0].devices[0].capabilities;
      const f = await ui({ adding: true, language, capabilities });
      f.choose('timestamp-capability');
      f.select('d');
      assert.deepEqual(
        f.caps().map((c) => c.value),
        ['received'],
      );
      const description = text(f.field('capabilities'));
      assert.match(
        description,
        language === 'nl' ? /Laatste ontvangst/ : /Last receipt/,
      );
      assert.match(
        description,
        language === 'nl' ? /Huidige waarde:/ : /Current value:/,
      );
      assert.match(description, /2026/);
      assert.match(description, /22/);
      assert.equal(f.field('encoding').value, encoding);
      await f.submit();
      assert.equal(f.puts.length, 1);
      assert.deepEqual(f.saved().monitors[0].strategy, {
        kind: 'timestamp-capability',
        capabilities: ['received'],
        encoding,
      });
    }
  });

  test(`no valid time field explains alternative methods even with device settings collapsed (${language})`, async () => {
    const f = await ui({
      adding: true,
      language,
      capabilities: [
        { id: 'temperature', title: 'Temperature', type: 'number' },
        { id: 'co2', title: 'CO2', type: 'number' },
      ],
    });
    f.choose('timestamp-capability');
    f.select('d');
    assert.equal(f.caps().length, 0);
    assert.equal(f.get('device-settings').open, false);
    assert.equal(f.get('timestamp-setup-hint').hidden, false);
    for (const message of [
      f.text('timestamp-setup-hint'),
      text(f.field('capabilities')),
    ]) {
      assert.match(
        message,
        language === 'nl' ? /geen geschikt tijdveld/ : /no suitable time field/,
      );
      assert.match(
        message,
        language === 'nl'
          ? /Apparaatactiviteit of Bevestiging via Flow/
          : /Device activity or Flow confirmation/,
      );
    }
    await f.submit();
    assert.equal(f.puts.length, 0);
  });

  test(`saved non-candidate and missing fields stay editable with warnings (${language})`, async () => {
    const f = await ui({
      language,
      capabilities: [
        { id: 'timestamp', title: 'Previous receipt', type: 'number' },
      ],
    });
    findButton(f.get('monitors'), language === 'nl' ? 'Bewerken' : 'Edit')!
      .onclick!();
    assert.deepEqual(
      f
        .caps()
        .filter((c) => c.checked)
        .map((c) => c.value),
      ['timestamp', 'missing-cap'],
    );
    assert.match(f.text('capability-options'), /Previous receipt/);
    assert.match(
      f.text('capability-options'),
      language === 'nl'
        ? /niet als geschikt tijdstip herkend/
        : /not recognized as a suitable time/,
    );
    assert.match(
      f.text('capability-options'),
      language === 'nl' ? /ontbreekt momenteel/ : /currently missing/,
    );
    f.field('timeout').value = '6';
    await f.submit();
    assert.equal(f.puts.length, 1);
    assert.equal(f.saved().monitors.length, 1);
    assert.equal(f.saved().monitors[0].id, 'stable-id');
    assert.deepEqual(
      f.saved().monitors[0].strategy,
      f.initial.monitors[0].strategy,
    );
  });
}

test('new timestamp selections cannot silently use the wrong encoding or mixed encodings', async () => {
  const f = await ui({
    adding: true,
    capabilities: [
      {
        id: 'iso',
        title: 'Receipt',
        type: 'string',
        timestampCandidate: isoCandidate,
      },
      {
        id: 'seconds',
        title: 'Other receipt',
        type: 'number',
        timestampCandidate: { ...isoCandidate, encoding: 'epoch-seconds' },
      },
    ],
  });
  f.choose('timestamp-capability');
  f.select('d');
  for (const c of f.caps()) c.checked = true;
  await f.submit();
  assert.equal(f.puts.length, 0);
  assert.match(f.field('encoding-error').textContent, /does not match/);
  f.caps()[0].checked = false;
  f.field('encoding').value = 'epoch-seconds';
  await f.submit();
  assert.equal(f.puts.length, 1);
});

test('saved encoding mismatch warns without changing the stored selection or preventing an edit', async () => {
  const f = await ui({
    capabilities: [
      {
        id: 'timestamp',
        title: 'Receipt',
        type: 'number',
        timestampCandidate: { ...isoCandidate, encoding: 'epoch-ms' },
      },
    ],
  });
  f.edit();
  assert.match(
    f.text('capability-options'),
    /does not match the saved time format/,
  );
  await f.submit();
  assert.equal(f.puts.length, 1);
  assert.deepEqual(
    f.saved().monitors[0].strategy,
    f.initial.monitors[0].strategy,
  );
});

for (const language of ['nl', 'en']) {
  test(`${language}: complete Settings copy covers help, diagnostics, empty states, errors and the focused setup`, async () => {
    const f = await ui({ language, adding: true, paired: true });
    assert.equal(f.language(), language);
    assert.equal(f.get('settings-root').hidden, false);
    assert.equal(f.get('monitor-setup').hidden, true);
    assert.equal(f.get('help').open, false);
    assert.equal(f.get('diagnostics').open, false);
    assert.equal(
      f.get('monitor-count').textContent,
      language === 'nl' ? '0 van 0 bronnen actief' : '0 of 0 sources active',
    );
    assert.equal(f.get('monitors-empty').hidden, false);
    assert.equal(f.get('monitor-summary').hidden, true);
    assert.equal(f.get('monitors-title').textContent, 'Monitors');
    assert.equal(
      f.get('help-toggle').textContent,
      language === 'nl' ? 'Hulp' : 'Help',
    );
    assert.equal(
      f.get('observer-title').textContent,
      language === 'nl' ? 'Status van de bewaking' : 'Observation status',
    );
    assert.match(
      f.text('integration-status'),
      language === 'nl' ? /nog geen integraties/ : /No monitored integrations/,
    );
    assert.equal(
      f.get('test-badge').textContent,
      language === 'nl' ? 'Gestopt' : 'Stopped',
    );
    assert.match(
      f.text('test-summary'),
      language === 'nl'
        ? /Laatste bevestiging Nog niet/
        : /Last confirmation Never/,
    );
    assert.match(
      f.text('observer-summary'),
      language === 'nl' ? /Verbinding Verbonden/ : /Connection Connected/,
    );
    if (language === 'nl')
      assert.doesNotMatch(
        f.translations().join(' '),
        /How to use|Know when your sources|Choosing a|Could not|Local self-test|Never|Unknown|Understanding monitor/,
      );
    f.get('help-toggle').onclick!();
    assert.equal(f.get('help').open, true);
    assert.equal(f.get('help-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(f.get('help-summary').focused, true);
    f.get('help').onkeydown!({ key: 'Escape', preventDefault() {} });
    assert.equal(f.get('help').open, false);
    assert.equal(f.get('help-toggle').focused, true);
    f.choose('device-last-seen');
    assert.equal(f.get('add-monitor').className, '');
    assert.equal(f.get('method-description').hidden, false);
    assert.equal(
      f.get('method-description').textContent,
      language === 'nl'
        ? 'Controleert of Homey het apparaat recent nog heeft gezien.'
        : 'Checks whether Homey has seen the device recently.',
    );
    f.choose('manual');
    assert.match(
      f.get('method-description').textContent,
      language === 'nl' ? /^Laat een Homey Flow/ : /^Let a Homey Flow/,
    );
    f.select('d');
    assert.equal(f.get('device-picker').hidden, true);
    assert.equal(f.get('device-settings').open, false);
    f.statusFail();
    await f.get('refresh').onclick!();
    assert.equal(
      f.get('message').textContent,
      language === 'nl'
        ? 'De status kon niet worden vernieuwd. Probeer het opnieuw.'
        : 'Could not refresh the status. Try again.',
    );
    assert.equal(f.get('request-details').hidden, false);
    assert.equal(f.get('request-details').open, false);
    assert.equal(f.get('request-error-detail').textContent, 'Unavailable');
    assert.equal(f.puts.length, 0);
  });

  test(`${language}: every state is localized on the row, with the exact state restricted to technical details`, async () => {
    const states = [
      'WARMING_UP',
      'HEALTHY',
      'SUSPECTED_STALE',
      'DEVICE_STALE',
      'RECOVERING',
      'DISABLED',
      'MISSING',
      'UNKNOWN',
    ];
    const labels =
      language === 'nl'
        ? [
            'Opstarten',
            'Gezond',
            'Update vertraagd',
            'Geen gegevens',
            'Herstelt',
            'Uitgeschakeld',
            'Ontbreekt',
            'Onbekend',
          ]
        : [
            'Starting',
            'Healthy',
            'Update delayed',
            'No data',
            'Recovering',
            'Disabled',
            'Missing',
            'Unknown',
          ];
    const monitors = states.map((state) => ({
      ...initialConfig().monitors[0],
      id: state,
      deviceId: state,
      enabled: state !== 'DISABLED',
    }));
    const f = await ui({
      language,
      monitors,
      runtimeStates: Object.fromEntries(states.map((state) => [state, state])),
    });
    assert.equal(
      f.get('monitor-count').textContent,
      language === 'nl' ? '7 van 8 bronnen actief' : '7 of 8 sources active',
    );
    for (const [index, row] of f.get('monitors').children.entries()) {
      assert.equal(row.children[0].children[1].textContent, labels[index]);
      assert.equal(
        row.children[0].children[1].getAttribute('data-state'),
        states[index],
      );
      const detail = descendants(row).find(
        (e) => e.className === 'monitor-technical',
      )!;
      assert.equal(detail.open, false);
      assert.ok(text(detail).includes(states[index]));
      assert.doesNotMatch(
        visibleText(row),
        /WARMING_UP|DEVICE_STALE|SUSPECTED_STALE/,
      );
    }
    assert.deepEqual(f.saved().monitors, monitors);
  });

  test(`${language}: time presentation follows the UI locale, and exact ISO remains in technical details`, async () => {
    const at = Date.parse('2026-09-28T17:16:00Z');
    const f = await ui({ language, lastDeliveryAt: at });
    const row = f.get('monitors').children[0];
    const last = descendants(row).find((e) => e.className === 'monitor-last')!;
    const expected = new Date(at).toLocaleString(language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    assert.ok(last.textContent.endsWith(expected));
    assert.doesNotMatch(last.textContent, /T17:16|\.000Z/);
    assert.match(
      text(descendants(row).find((e) => e.className === 'monitor-technical')!),
      /2026-09-28T17:16:00\.000Z/,
    );
    const missing = await ui({ language, lastDeliveryAt: null });
    assert.match(
      text(missing.get('monitors')),
      language === 'nl' ? /Nog niet bevestigd/ : /Not confirmed yet/,
    );
  });

  test(`${language}: test-source failures are explained locally with raw diagnostics kept secondary`, async () => {
    for (const sourceError of [
      'Test heartbeat failed; source stopped',
      'Native lastSeenAt update failed; timestamp/manual remain available',
      'Unexpected backend error',
    ]) {
      const f = await ui({
        language,
        paired: true,
        sourceError,
        observerState: 'persistence-error',
        restoreState: 'rejected',
        integrationState: 'DEGRADED',
      });
      assert.equal(f.get('test-error-details').hidden, false);
      assert.equal(f.get('test-error-details').open, false);
      assert.equal(f.get('test-error-detail').textContent, sourceError);
      assert.notEqual(f.get('test-message').textContent, sourceError);
      if (language === 'nl') {
        assert.doesNotMatch(
          f.get('test-message').textContent,
          /failed|Unexpected|Native|heartbeat/,
        );
        assert.match(f.text('observer-summary'), /kan niet worden opgeslagen/);
        assert.match(f.text('integration-status'), /Aandacht nodig/);
      }
    }
  });
}

test('More uses native keyboard disclosure, exclusive expansion and focus recovery for every management action', async () => {
  const original = initialConfig().monitors[0];
  const other = { ...original, id: 'other', deviceId: 'other' };
  const f = await ui({ monitors: [original, other] });
  const overflow = (index = 0) =>
    descendants(f.get('monitors').children[index]).find(
      (e) => e.className === 'monitor-more',
    )!;
  const open = (index = 0) => {
    const more = overflow(index);
    more.open = true;
    more.ontoggle!();
    return more;
  };
  assert.equal(overflow().tag, 'details');
  assert.equal(overflow().open, false);
  assert.equal(
    descendants(overflow()).find((e) => e.className === 'monitor-technical')!
      .open,
    false,
  );
  assert.doesNotMatch(
    visibleText(f.get('monitors')),
    /Technical details|Disable|Remove/,
  );
  const summary = overflow().children[0];
  assert.equal(summary.tag, 'summary');
  assert.equal(
    summary.getAttribute('aria-label'),
    'More actions for Simulation',
  );
  assert.equal(summary.getAttribute('aria-expanded'), 'false');
  assert.equal(
    summary.getAttribute('aria-controls'),
    overflow().children[1].id,
  );
  open();
  assert.equal(summary.getAttribute('aria-expanded'), 'true');
  open(1);
  assert.equal(overflow().open, false);
  assert.equal(summary.getAttribute('aria-expanded'), 'false');
  let prevented = false;
  overflow(1).onkeydown!({
    key: 'Escape',
    preventDefault() {
      prevented = true;
    },
  });
  assert.ok(prevented);
  assert.equal(overflow(1).open, false);
  assert.equal(overflow(1).children[0].focused, true);
  const more = open();
  more.onfocusout!({ relatedTarget: more.children[1].children[0] });
  assert.equal(more.open, true);
  more.onfocusout!({ relatedTarget: f.get('refresh') });
  assert.equal(more.open, false);
  await findButton(open(), 'Disable')!.onclick!();
  assert.equal(overflow().children[0].focused, true);
  assert.equal(f.saved().monitors[0].enabled, false);
  assert.equal(overflow().open, false);
  await findButton(open(), 'Enable')!.onclick!();
  assert.deepEqual(f.saved().monitors, [original, other]);
  const remove = findButton(open(), 'Remove')!;
  assert.equal(remove.className, 'danger');
  await remove.onclick!();
  assert.deepEqual(f.saved().monitors, [other]);
  assert.equal(overflow().children[0].focused, true);
  await findButton(open(), 'Remove')!.onclick!();
  assert.equal(f.get('add-monitor').focused, true);
  assert.equal(f.get('monitors-empty').hidden, false);
});

test('filter chips preserve filtering, pressed state and keyboard focus', async () => {
  const original = initialConfig().monitors[0];
  const f = await ui({
    monitors: [
      original,
      {
        ...original,
        id: 'manual',
        deviceId: 'other',
        strategy: { kind: 'manual' },
      },
    ],
  });
  const chips = () => f.get('monitor-summary').children;
  assert.ok(
    chips().every((c) => c.className === 'filter-chip' && c.tag === 'button'),
  );
  assert.equal(chips()[0].getAttribute('aria-pressed'), 'true');
  const flow = chips().find((c) => c.getAttribute('data-filter') === 'manual')!;
  assert.equal(
    flow.getAttribute('aria-label'),
    'Flow confirmation: 1 monitors',
  );
  flow.onclick!();
  const selected = chips().find(
    (c) => c.getAttribute('data-filter') === 'manual',
  )!;
  assert.equal(selected.getAttribute('aria-pressed'), 'true');
  assert.equal(selected.focused, true);
  assert.equal(f.get('monitors').children.length, 1);
  assert.equal(
    f.get('monitors').children[0].getAttribute('data-monitor-id'),
    'manual',
  );
  chips()[0].onclick!();
  assert.equal(f.get('monitors').children.length, 2);
  assert.equal(f.puts.length, 0);
});

test('all static copy is locale-owned; compact responsive layout supports long labels without fixed card widths', async () => {
  const html = readFileSync('settings/index.html', 'utf8');
  const css = readFileSync('settings/settings.css', 'utf8');
  assert.equal(html.replace(/<[^>]*>/g, '').trim(), '');
  assert.doesNotMatch(html, /class="card"|Data Watchdog<\/h1>|method-help/);
  assert.match(css, /--accent: #245b68;/i);
  assert.doesNotMatch(css, /#175ddc|#2563df|\.actions button\s*\{\s*flex-grow/);
  assert.match(css, /\.filter-chips\s*\{[^}]*flex-wrap: wrap/);
  assert.match(
    css,
    /\.monitor-heading h3\s*\{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/,
  );
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(pointer: coarse\)/);
  const monitors = Array.from({ length: 10 }, (_, index) => ({
    ...initialConfig().monitors[0],
    id: `m${index}`,
    deviceId: `d${index}`,
    deviceName: `Lange apparaatnaam ${'ontvangst'.repeat(30)}`,
  }));
  const f = await ui({ language: 'nl', monitors });
  assert.equal(f.get('monitors').children.length, 10);
  assert.ok(
    f
      .get('monitors')
      .children.every(
        (row) =>
          row.className === 'monitor-row' &&
          !row.children.some((c) => c.className === 'card'),
      ),
  );
  assert.equal(f.get('monitor-count').textContent, '10 van 10 bronnen actief');
  assert.deepEqual(f.saved().monitors, monitors);
});

for (const language of ['nl', 'en']) {
  test(`${language}: aligned header cluster keeps add, refresh and help functional`, async () => {
    const f = await ui({ language });
    assert.equal(f.get('add-monitor').className, 'primary');
    f.get('add-monitor').onclick!();
    assert.equal(f.get('monitor-setup').hidden, false);
    f.get('close-setup').onclick!();
    await f.get('refresh').onclick!();
    assert.equal(
      f.get('message').textContent,
      language === 'nl' ? 'Status vernieuwd.' : 'Status refreshed.',
    );
    f.get('help-toggle').onclick!();
    assert.equal(f.get('help').open, true);
    assert.equal(f.get('help-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(f.get('help-summary').focused, true);
    assert.equal(f.puts.length, 0);
  });

  test(`${language}: Edit is first in More and edits the same monitor without visible row actions`, async () => {
    const original = initialConfig().monitors[0];
    const other = {
      ...original,
      id: 'other',
      deviceId: 'other-device',
      deviceName: 'Other device',
    };
    const f = await ui({ language, monitors: [original, other] });
    const row = () => f.get('monitors').children[1];
    const menu = () =>
      descendants(row()).find((e) => e.className === 'monitor-more')!;
    const labels =
      language === 'nl'
        ? ['Bewerken', 'Uitschakelen', 'Verwijderen']
        : ['Edit', 'Disable', 'Remove'];
    const actions = descendants(row()).find(
      (e) => e.className === 'monitor-actions',
    )!;
    assert.equal(actions.children.length, 1);
    assert.equal(actions.children[0], menu());
    assert.doesNotMatch(
      visibleText(row()),
      /Bewerken|Edit|Uitschakelen|Disable|Verwijderen|Remove/,
    );
    assert.deepEqual(
      menu()
        .children[1].children.filter((e) => e.tag === 'button')
        .map((e) => e.textContent),
      labels,
    );
    assert.equal(findButton(menu(), labels[2])!.className, 'danger');
    assert.equal(
      menu().children[0].getAttribute('aria-label'),
      language === 'nl'
        ? 'Meer acties voor Other device'
        : 'More actions for Other device',
    );
    menu().open = true;
    menu().ontoggle!();
    findButton(menu(), labels[0])!.onclick!();
    assert.equal(menu().open, false);
    assert.equal(f.get('monitor-setup').hidden, false);
    assert.equal(f.get('device').value, other.deviceId);
    assert.equal(f.get('strategy-timestamp-capability').focused, true);
    assert.equal(
      f.field('timeout').value,
      String(other.staleTimeoutMs / 60000),
    );
    await f.submit();
    assert.deepEqual(f.saved().monitors, [original, other]);
    assert.equal(f.saved().monitors[1].id, 'other');
    assert.equal(menu().open, false);
  });
}

test('header secondary actions share the primary width with equal columns and responsive bounds', () => {
  const css = readFileSync('settings/settings.css', 'utf8');
  assert.match(
    css,
    /\.monitor-toolbar\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*width: max-content;[^}]*max-width: 100%;[^}]*gap: 4px;/,
  );
  assert.match(
    css,
    /\.utility-actions\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*gap: 4px;/,
  );
  assert.match(css, /\.utility-actions button\s*\{[^}]*min-height: 36px;/);
});
