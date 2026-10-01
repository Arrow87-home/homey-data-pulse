import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
const tokenTitles = {
  source_app: { en: 'Source app', nl: 'Bron-app' },
  source_app_id: { en: 'Source app ID', nl: 'Bron-app-ID' },
  device: { en: 'Monitored source', nl: 'Bewaakte bron' },
  device_id: { en: 'Device ID', nl: 'Apparaat-ID' },
  zone: { en: 'Zone', nl: 'Zone' },
  capability: { en: 'Time field', nl: 'Tijdveld' },
  last_delivery: {
    en: 'Last confirmed update',
    nl: 'Laatste bevestigde update',
  },
  affected_devices: { en: 'Affected sources', nl: 'Getroffen bronnen' },
  stale_since: { en: 'Incident started at', nl: 'Incident gestart op' },
  status: { en: 'Status', nl: 'Status' },
  incident_id: { en: 'Incident ID', nl: 'Incident-ID' },
  evidence_kind: { en: 'Monitoring method', nl: 'Controlemethode' },
  age_minutes: {
    en: 'Minutes since last update',
    nl: 'Minuten sinds laatste update',
  },
  expected_interval: {
    en: 'Expected update interval (minutes)',
    nl: 'Verwacht update-interval (minuten)',
  },
  stale_timeout: { en: 'Alert threshold (minutes)', nl: 'Meldgrens (minuten)' },
  affected_count: {
    en: 'Affected source count',
    nl: 'Aantal getroffen bronnen',
  },
  monitored_count: {
    en: 'Monitored source count',
    nl: 'Aantal bewaakte bronnen',
  },
  recovered_count: {
    en: 'Recovered source count',
    nl: 'Aantal herstelde bronnen',
  },
  incident_duration: {
    en: 'Incident duration (minutes)',
    nl: 'Duur incident (minuten)',
  },
  has_delivery: {
    en: 'Confirmed update known',
    nl: 'Bevestigde update bekend',
  },
};
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
    title: tokenTitles[name],
  })),
  ...numbers.map((name) => ({
    name,
    type: 'number',
    title: tokenTitles[name],
  })),
  {
    name: 'has_delivery',
    type: 'boolean',
    title: tokenTitles.has_delivery,
  },
];
const argument = (name) => ({
  name,
  type: 'autocomplete',
  title:
    name === 'monitor'
      ? { en: 'Monitored source', nl: 'Bewaakte bron' }
      : { en: 'Integration', nl: 'Integratie' },
});
const manifest = {
  id: 'io.github.arrow87-home.datawatchdog',
  version: '0.1.4',
  sdk: 3,
  compatibility: '>=12.9.0',
  runtime: 'nodejs',
  platforms: ['local'],
  name: { en: 'Data Pulse', nl: 'Data Pulse' },
  description: {
    en: 'Know when your Homey data stops arriving',
    nl: 'Weet wanneer je Homey-data niet meer binnenkomt',
  },
  homeyCommunityTopicId: 159768,
  source: 'https://github.com/Arrow87-home/homey-data-pulse',
  tags: {
    en: ['monitoring', 'reliability', 'data', 'devices', 'integrations'],
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
      title: { en: 'Last test heartbeat', nl: 'Laatste testbevestiging' },
      getable: true,
      setable: false,
      uiComponent: 'sensor',
      icon: '/drivers/test-source/assets/icon.svg',
    },
  },
  drivers: [
    {
      id: 'test-source',
      name: {
        en: 'Data Pulse Test Source (simulation)',
        nl: 'Data Pulse Testbron (simulatie)',
      },
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
      [
        'device_stale',
        'Monitored source stopped updating',
        'Bewaakte bron ontvangt geen updates meer',
      ],
      [
        'device_recovered',
        'Monitored source recovered',
        'Bewaakte bron is hersteld',
      ],
      [
        'integration_stale',
        'Integration incident started',
        'Integratie-incident gestart',
      ],
      [
        'integration_recovered',
        'Integration incident recovered',
        'Integratie-incident hersteld',
      ],
      [
        'any_incident_started',
        'Data Pulse incident started',
        'Data Pulse-incident gestart',
      ],
      [
        'any_incident_recovered',
        'Data Pulse incident recovered',
        'Data Pulse-incident hersteld',
      ],
    ].map(([id, en, nl]) => ({ id, title: { en, nl }, tokens })),
    conditions: ['device', 'integration'].flatMap((scope) =>
      ['healthy', 'stale'].map((state) => ({
        id: `${scope}_is_${state}`,
        titleFormatted: {
          en: `[[${scope === 'device' ? 'monitor' : 'source'}]] ${state === 'healthy' ? 'is healthy' : scope === 'device' ? 'has stopped updating' : 'has an incident awaiting recovery'}`,
          nl: `[[${scope === 'device' ? 'monitor' : 'source'}]] ${state === 'healthy' ? 'is gezond' : scope === 'device' ? 'ontvangt geen updates meer' : 'heeft een incident dat op herstel wacht'}`,
        },
        title: {
          en: `${scope === 'device' ? 'Monitored source' : 'Integration'} ${state === 'healthy' ? 'is healthy' : scope === 'device' ? 'has stopped updating' : 'has an incident awaiting recovery'}`,
          nl: `${scope === 'device' ? 'Bewaakte bron' : 'Integratie'} ${state === 'healthy' ? 'is gezond' : scope === 'device' ? 'ontvangt geen updates meer' : 'heeft een incident dat op herstel wacht'}`,
        },
        args: [argument(scope === 'device' ? 'monitor' : 'source')],
      })),
    ),
    actions: [
      ...[
        ['start', 'Start test updates', 'Start testupdates'],
        ['stop', 'Stop test updates', 'Stop testupdates'],
        ['send', 'Send a test update now', 'Stuur nu een testupdate'],
      ].map(([action, en, nl]) => ({
        id: `${action}_test_heartbeat`,
        title: { en, nl },
        hint: {
          en: 'Local Data Pulse simulation only. Requires the optional test source device.',
          nl: 'Alleen een lokale Data Pulse-simulatie. Vereist het optionele testbronapparaat.',
        },
      })),
      {
        id: 'check_all',
        title: {
          en: 'Check all monitored sources now',
          nl: 'Controleer nu alle bewaakte bronnen',
        },
      },
      {
        id: 'check_monitor',
        titleFormatted: {
          en: 'Check [[monitor]] now',
          nl: 'Controleer [[monitor]] nu',
        },
        title: {
          en: 'Check a monitored source now',
          nl: 'Controleer nu een bewaakte bron',
        },
        args: [argument('monitor')],
      },
      {
        id: 'record_heartbeat',
        titleFormatted: {
          en: 'Confirm a successful update for [[monitor]] at [[delivered_at]]',
          nl: 'Bevestig een geslaagde update voor [[monitor]] op [[delivered_at]]',
        },
        title: {
          en: 'Confirm a successful update',
          nl: 'Bevestig een geslaagde update',
        },
        hint: {
          en: 'Use only after a successful update. Enter the actual update time as an ISO date and time with timezone. Never confirm using only a periodic timer.',
          nl: 'Gebruik dit alleen na een geslaagde update. Vul het werkelijke tijdstip in als ISO-datum en -tijd met tijdzone. Bevestig nooit alleen op basis van een periodieke timer.',
        },
        args: [
          argument('monitor'),
          {
            name: 'delivered_at',
            type: 'text',
            title: {
              en: 'Update time (ISO with timezone)',
              nl: 'Tijdstip update (ISO met tijdzone)',
            },
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
const formatConfig = await prettier.resolveConfig(
  fileURLToPath(new URL('../app.json', import.meta.url)),
);
fs.writeFileSync(
  'app.json',
  await prettier.format(JSON.stringify(manifest, null, 2), {
    ...formatConfig,
    parser: 'json',
  }),
);
