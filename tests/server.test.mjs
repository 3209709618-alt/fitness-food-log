import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.mjs';

async function withServer(options, run) {
  const server = createAppServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('USDA endpoint never forwards profile or log data and handles missing keys', async () => {
  let requested;
  await withServer({ apiKey: 'server-only-test', fetchImpl: async url => {
    requested = new URL(url);
    return new Response(JSON.stringify({ foods: [{ fdcId: 9, description: 'Test food', foodNutrients: [{ nutrientId: 1008, unitName: 'KCAL', value: 10 }] }] }), { status: 200 });
  } }, async base => {
    let res = await fetch(`${base}/api/foods?q=rice`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.foods[0].per100g.kcal, 10);
    assert.ok(!JSON.stringify(data).includes('server-only-test'));
    assert.equal(requested.searchParams.get('api_key'), 'server-only-test');
    assert.deepEqual([...requested.searchParams.keys()].sort(), ['api_key', 'dataType', 'pageSize', 'query'].sort());
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  });
  await withServer({ apiKey: '' }, async base => {
    const res = await fetch(`${base}/api/foods?q=rice`);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'NO_API_KEY');
  });
});

test('USDA proxy rejects malformed search and refuses writes', async () => {
  await withServer({ apiKey: 'test' }, async base => {
    assert.equal((await fetch(`${base}/api/foods`)).status, 400);
    assert.equal((await fetch(`${base}/api/foods?q=x&email=user%40example.com`)).status, 400);
    assert.equal((await fetch(`${base}/api/foods?q=${'a'.repeat(121)}`)).status, 400);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  });
});

test('static serving uses allowlisted paths and safely returns app files', async () => {
  await withServer({}, async base => {
    const html = await fetch(base);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /食衡/);
    assert.equal((await fetch(`${base}/domain.js`)).status, 200);
    assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/tests/server.test.mjs`)).status, 404);
  });
});

test('upstream failures become useful responses without exposing error details', async () => {
  await withServer({ apiKey: 'secret', fetchImpl: async () => { throw new Error('https://upstream?api_key=secret'); } }, async base => {
    const result = await fetch(`${base}/api/foods?q=rice`);
    assert.equal(result.status, 502);
    assert.ok(!(await result.text()).includes('secret'));
  });
  await withServer({ apiKey: 'test', fetchImpl: async () => new Response('', { status: 429 }) }, async base => {
    assert.equal((await fetch(`${base}/api/foods?q=rice`)).status, 429);
    assert.equal((await fetch(base)).status, 200);
  });
});
