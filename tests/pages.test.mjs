import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('static assets resolve inside a GitHub Pages project URL', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const base = 'https://example.github.io/fitness-food-log/';
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const path = match[1];
    if (path.startsWith('#') || /^https?:/.test(path)) continue;
    assert.ok(new URL(path, base).href.startsWith(base), path);
  }
  assert.equal(new URL('data/foods.json', base).href, `${base}data/foods.json`);
});
