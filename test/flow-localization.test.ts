import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const flow = JSON.parse(readFileSync('app.json', 'utf8')).flow;

function withoutCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCopy);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['title', 'titleFormatted', 'hint'].includes(key))
        .map(([key, child]) => [key, withoutCopy(child)]),
    );
  return value;
}

test('Flow IDs, token names/types, arguments and all non-copy properties match the pre-localization contract', () => {
  // Captured from d92d28f before changing display copy. Includes all 16 cards.
  assert.equal(
    createHash('sha256')
      .update(JSON.stringify(withoutCopy(flow)))
      .digest('hex'),
    'af0c79724488a4bf564b20e0111e615ce7ad4a376daed300caf76ca86bccd4b1',
  );
});

test('every Flow card, token, argument, formatted title and hint has English and Dutch copy', () => {
  function check(value: unknown): void {
    if (Array.isArray(value)) return value.forEach(check);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['title', 'titleFormatted', 'hint'].includes(key)) {
        const copy = child as Record<string, string>;
        for (const language of ['en', 'nl']) {
          assert.ok(copy[language]?.trim(), `${key}: ${language}`);
          assert.doesNotMatch(
            copy[language],
            /watchdog|\bstale\b|heartbeat|producer|evidence kind/i,
          );
        }
        assert.deepEqual(
          copy.en.match(/\[\[[^\]]+\]\]/g) ?? [],
          copy.nl.match(/\[\[[^\]]+\]\]/g) ?? [],
          'formatted arguments remain identical',
        );
      } else check(child);
    }
  }
  check(flow);
  for (const cards of Object.values(flow) as Array<
    Array<{
      title: unknown;
      tokens?: Array<{ title: unknown }>;
      args?: Array<{ title: unknown }>;
    }>
  >)
    for (const card of cards) {
      assert.ok(card.title);
      for (const field of [...(card.tokens ?? []), ...(card.args ?? [])])
        assert.ok(field.title);
    }
});

test('incident trigger titles and Help use the same localized names', () => {
  const expected = [
    [
      'Monitored source stopped updating',
      'Bewaakte bron ontvangt geen updates meer',
    ],
    ['Monitored source recovered', 'Bewaakte bron is hersteld'],
    ['Integration incident started', 'Integratie-incident gestart'],
    ['Integration incident recovered', 'Integratie-incident hersteld'],
    ['Data Pulse incident started', 'Data Pulse-incident gestart'],
    ['Data Pulse incident recovered', 'Data Pulse-incident hersteld'],
  ];
  assert.deepEqual(
    flow.triggers.map((card: { title: { en: string; nl: string } }) => [
      card.title.en,
      card.title.nl,
    ]),
    expected,
  );
  for (const language of ['en', 'nl']) {
    const settings = JSON.parse(
      readFileSync(`locales/${language}.json`, 'utf8'),
    ).settings;
    const started = flow.triggers[4].title[language];
    const recovered = flow.triggers[5].title[language];
    assert.ok(settings.help_quick_start_4.includes(started));
    assert.ok(settings.help_notifications_2.includes(started));
    assert.ok(settings.help_notifications_4.includes(recovered));
    assert.doesNotMatch(JSON.stringify(settings), /watchdog/i);
  }
  for (const [file, language] of [
    ['README.md', 'nl'],
    ['docs/user-guide.md', 'en'],
  ]) {
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes(flow.triggers[4].title[language]));
    assert.ok(text.includes(flow.triggers[5].title[language]));
    assert.ok(text.includes(flow.actions[5].title[language]));
    assert.doesNotMatch(
      text,
      /watchdog incident|Device became stale|Device recovered|Integration became stale|Integration recovered/i,
    );
  }
});
