import fs from 'node:fs';
const strings = [
  'source_app',
  'source_app_id',
  'device',
  'device_id',
  'zone',
  'capability',
  'last_delivery',
  'affected_devices',
  'stale_since',
  'status',
  'incident_id',
  'evidence_kind',
];
const numbers = [
  'age_minutes',
  'expected_interval',
  'stale_timeout',
  'affected_count',
  'monitored_count',
  'recovered_count',
  'incident_duration',
];
const tokens = [
  ...strings.map((name) => ({
    name,
    type: 'string',
    title: { en: name.replaceAll('_', ' ') },
  })),
  ...numbers.map((name) => ({
    name,
    type: 'number',
    title: { en: name.replaceAll('_', ' ') },
  })),
  {
    name: 'has_delivery',
    type: 'boolean',
    title: { en: 'Known last delivery' },
  },
];
const argument = (name) => ({
  name,
  type: 'autocomplete',
  title: { en: name },
});
const manifest = {
  id: 'io.github.arrow87-home.datawatchdog',
  version: '0.1.1',
  sdk: 3,
  compatibility: '>=12.9.0',
  runtime: 'nodejs',
  platforms: ['local'],
  name: { en: 'Data Watchdog', nl: 'Data Watchdog' },
  description: {
    en: 'Know when your Homey data stops arriving',
    nl: 'Weet wanneer je Homey-data niet meer binnenkomt',
  },
  tags: {
    en: ['monitoring', 'watchdog', 'reliability', 'devices', 'integrations'],
  },
  category: ['tools'],
  brandColor: '#245B68',
  images: {
    small: '/assets/images/small.png',
    large: '/assets/images/large.png',
    xlarge: '/assets/images/xlarge.png',
  },
  author: { name: 'Arrow87-home' },
  permissions: ['homey:manager:api'],
  capabilities: {
    last_test_heartbeat: {
      type: 'string',
      title: { en: 'Last test heartbeat' },
      getable: true,
      setable: false,
      uiComponent: 'sensor',
      icon: '/drivers/test-source/assets/icon.svg',
    },
  },
  drivers: [
    {
      id: 'test-source',
      name: { en: 'Data Watchdog Test Source (simulation)' },
      class: 'sensor',
      images: {
        small: '/drivers/test-source/assets/images/small.png',
        large: '/drivers/test-source/assets/images/large.png',
        xlarge: '/drivers/test-source/assets/images/xlarge.png',
      },
      capabilities: ['last_test_heartbeat'],
      capabilitiesOptions: { last_test_heartbeat: { preventInsights: true } },
      pair: [
        {
          id: 'list_devices',
          template: 'list_devices',
          navigation: { next: 'add_devices' },
          options: { singular: true },
        },
        { id: 'add_devices', template: 'add_devices' },
      ],
    },
  ],
  flow: {
    triggers: [
      ['device_stale', 'Device became stale'],
      ['device_recovered', 'Device recovered'],
      ['integration_stale', 'Integration became stale'],
      ['integration_recovered', 'Integration recovered'],
      ['any_incident_started', 'Any watchdog incident started'],
      ['any_incident_recovered', 'Any watchdog incident recovered'],
    ].map(([id, title]) => ({ id, title: { en: title }, tokens })),
    conditions: ['device', 'integration'].flatMap((scope) =>
      ['healthy', 'stale'].map((state) => ({
        id: `${scope}_is_${state}`,
        titleFormatted: {
          en: `[[${scope === 'device' ? 'monitor' : 'source'}]] is ${state}`,
        },
        title: {
          en: `${scope === 'device' ? 'Device' : 'Integration'} is ${state}`,
        },
        args: [argument(scope === 'device' ? 'monitor' : 'source')],
      })),
    ),
    actions: [
      ...[
        ['start', 'Start test heartbeat'],
        ['stop', 'Stop test heartbeat'],
        ['send', 'Send test heartbeat now'],
      ].map(([action, title]) => ({
        id: `${action}_test_heartbeat`,
        title: { en: title },
        hint: {
          en: 'Local Data Watchdog simulation only. Requires the optional test source device.',
        },
      })),
      { id: 'check_all', title: { en: 'Check all monitors now' } },
      {
        id: 'check_monitor',
        titleFormatted: { en: 'Check [[monitor]] now' },
        title: { en: 'Check monitor now' },
        args: [argument('monitor')],
      },
      {
        id: 'record_heartbeat',
        titleFormatted: {
          en: 'Record delivery for [[monitor]] at [[delivered_at]]',
        },
        title: { en: 'Record a confirmed delivery' },
        hint: {
          en: 'Only call after a successful source delivery. Supply its ISO timestamp, never a blind periodic timer.',
        },
        args: [
          argument('monitor'),
          {
            name: 'delivered_at',
            type: 'text',
            title: { en: 'Delivery timestamp (ISO with timezone)' },
          },
        ],
      },
    ],
  },
  api: Object.fromEntries(
    [
      ['getTestSource', 'GET', '/test-source'],
      ['postTestSource', 'POST', '/test-source'],
      ['getInventory', 'GET', '/inventory'],
      ['getStatus', 'GET', '/status'],
      ['getConfig', 'GET', '/config'],
      ['putConfig', 'PUT', '/config'],
      ['postHeartbeat', 'POST', '/heartbeat/:id'],
    ].map(([id, method, path]) => [id, { method, path, public: false }]),
  ),
};
fs.writeFileSync('app.json', JSON.stringify(manifest, null, 2) + '\n');
