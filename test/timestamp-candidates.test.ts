import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseCapabilityTimestamp,
  parseTimestamp,
} from '../src/core/detectors';
import { buildInventory, CapabilityRecord } from '../src/homey/inventory';

const iso = '2026-09-22T17:42:00Z';
const at = Date.parse(iso);
const now = at + 60_000;
function candidates(capabilitiesObj: Record<string, CapabilityRecord>) {
  return buildInventory(
    {
      d: {
        id: 'd',
        name: 'Device',
        ownerUri: 'homey:app:test',
        capabilitiesObj,
      },
    },
    {},
    {},
    now,
  )[0].devices[0].capabilities;
}

test('timestamp values accept timezone ISO, epoch seconds and milliseconds', () => {
  for (const [value, encoding] of [
    [iso, 'iso'],
    ['2026-09-22T19:42:00+02:00', 'iso'],
    ['2026-09-22T17:42Z', 'iso'],
    ['2026-09-22T17:42:00.000000Z', 'iso'],
    [at / 1000, 'epoch-seconds'],
    [at, 'epoch-ms'],
  ] as const)
    assert.equal(parseCapabilityTimestamp(value, encoding), at);
  assert.equal(
    parseCapabilityTimestamp('2024-02-29T01:02:03.456Z', 'iso'),
    Date.parse('2024-02-29T01:02:03.456Z'),
  );
  assert.equal(
    parseCapabilityTimestamp(946684800, 'epoch-seconds'),
    946684800000,
  );
  assert.equal(
    parseCapabilityTimestamp(4102444799999, 'epoch-ms'),
    4102444799999,
  );
});

test('invalid dates, measurements, non-finite values and epochs outside 2000–2099 are rejected', () => {
  for (const value of [
    21.4,
    400,
    73,
    1234,
    12345678,
    0,
    -1,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_VALUE,
    '',
    ' ',
    '1234',
    null,
    undefined,
    true,
    {},
    at.toString(),
  ])
    for (const encoding of ['epoch-seconds', 'epoch-ms'] as const)
      assert.equal(
        parseCapabilityTimestamp(value, encoding),
        null,
        `${String(value)} / ${encoding}`,
      );
  for (const value of [
    'invalid',
    '',
    ' ',
    '21.4',
    '2026-09-22',
    '2026-09-22T17:42:00',
    '2026-02-30T17:42:00Z',
    '2025-02-29T17:42:00Z',
    '2026-13-01T00:00:00Z',
    '2026-09-00T00:00:00Z',
    '2026-09-22T24:00:00Z',
    '2026-09-22T17:60:00Z',
    '2026-09-22T17:42:60Z',
    '2026-09-22T17:42:00+24:00',
  ])
    assert.equal(parseCapabilityTimestamp(value, 'iso'), null, value);
  assert.equal(parseCapabilityTimestamp(946684799, 'epoch-seconds'), null);
  assert.equal(parseCapabilityTimestamp(4102444800, 'epoch-seconds'), null);
  assert.equal(parseCapabilityTimestamp(946684799999, 'epoch-ms'), null);
  assert.equal(parseCapabilityTimestamp(4102444800000, 'epoch-ms'), null);
  // The stricter capability ISO validation does not change manual/activity parsing.
  assert.equal(parseTimestamp('1970-01-01T00:00:01Z', 'iso'), 1000);
});

test('inventory candidates use only current values and share detector parsing', () => {
  const fields = candidates({
    iso: { type: 'string', title: 'Last receipt', value: iso },
    seconds: { type: 'number', value: at / 1000, units: 's' },
    millis: { type: 'number', value: at, units: 'ms' },
    unknown: { value: iso },
    temperature: { type: 'number', value: 21.4, lastUpdated: iso },
    co2: { type: 'number', value: 400 },
    percent: { type: 'number', value: 73 },
    power: { type: 'number', value: 1234 },
    counter: { type: 'number', value: 12345678 },
    invalid: {
      type: 'string',
      value: '2026-02-30T00:00:00Z',
      lastUpdated: iso,
    },
    missing: { type: 'number', lastUpdated: iso },
    future: { value: new Date(now + 1).toISOString() },
    measure_temperature: { type: 'number', value: at },
    meter_counter: { type: 'number', value: at / 1000 },
    custom_measurement: { type: 'number', value: at, units: 'W' },
    enumeration: { type: 'enum', value: iso },
  });
  assert.deepEqual(
    fields.filter((f) => f.timestampCandidate).map((f) => f.id),
    ['iso', 'seconds', 'millis', 'unknown'],
  );
  assert.equal(fields[0].title, 'Last receipt');
  assert.deepEqual(
    fields.slice(0, 3).map((f) => f.timestampCandidate),
    [
      { encoding: 'iso', at },
      { encoding: 'epoch-seconds', at },
      { encoding: 'epoch-ms', at },
    ],
  );
  assert.ok(fields.every((f) => !('value' in f) && !('lastUpdated' in f)));
});
