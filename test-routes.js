const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-test-client-id.apps.googleusercontent.com';
process.env.DATA_DIR = '/tmp/fichero-test-data-' + Date.now();
const serverExports = require('./server.js');
const { app } = serverExports;

const server = app.listen(0, run);

function req(method, path, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const body = opts.body ? JSON.stringify(opts.body) : null;
    const r = http.request({
      host: 'localhost', port, method, path,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        body ? { 'Content-Length': Buffer.byteLength(body) } : {},
        opts.cookie ? { Cookie: opts.cookie } : {}
      )
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function extractCookie(headers) {
  const sc = headers['set-cookie'];
  if (!sc) return null;
  const m = sc[0].match(/fichero_session=([^;]+)/);
  return m ? 'fichero_session=' + m[1] : null;
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.log('FAIL', name, '->', e.message); }
}

async function run() {
  await check('GET / serves html', async () => {
    const r = await req('GET', '/');
    assert.strictEqual(r.status, 200);
    assert.ok(typeof r.body === 'string' && r.body.includes('<title>'));
  });

  await check('GET / has a syntactically valid script after client-id substitution', () => {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
      .replace('%%GOOGLE_CLIENT_ID%%', process.env.GOOGLE_CLIENT_ID);
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(blocks.length >= 2, 'expected both the client-id placeholder script and the main app script');
    blocks.forEach(b => new Function(b)); // throws SyntaxError if the substitution corrupted anything
    assert.ok(!html.includes('%%GOOGLE_CLIENT_ID%%'), 'placeholder should have been fully substituted');
    assert.ok(html.includes(process.env.GOOGLE_CLIENT_ID), 'the real client id should be present in the served page');
  });

  await check('GET /api/me with no cookie -> user null', async () => {
    const r = await req('GET', '/api/me');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.user, null);
  });

  await check('GET /api/progress with no cookie -> 401', async () => {
    const r = await req('GET', '/api/progress');
    assert.strictEqual(r.status, 401);
  });

  await check('PUT /api/progress with no cookie -> 401', async () => {
    const r = await req('PUT', '/api/progress', { body: { items: {} } });
    assert.strictEqual(r.status, 401);
  });

  await check('POST /api/auth/google with malformed credential -> 401, no network call', async () => {
    const r = await req('POST', '/api/auth/google', { body: { credential: 'not-a-jwt' } });
    assert.strictEqual(r.status, 401);
    assert.ok(/Malformed/.test(r.body.error));
  });

  await check('POST /api/auth/google with missing credential -> 400', async () => {
    const r = await req('POST', '/api/auth/google', { body: {} });
    assert.strictEqual(r.status, 400);
  });

  await check('unknown/forged session id is rejected', async () => {
    const crypto = require('crypto');
    const r = await req('GET', '/api/progress', { cookie: 'fichero_session=' + crypto.randomUUID() });
    assert.strictEqual(r.status, 401);
  });

  await check('authenticated progress round-trip: empty -> save -> read back', async () => {
    const sessionId = serverExports.__testCreateSession({ sub: 'sub-alice', email: 'alice@example.com', name: 'Alice', picture: '' });
    const cookie = 'fichero_session=' + sessionId;

    const empty = await req('GET', '/api/progress', { cookie });
    assert.strictEqual(empty.status, 200);
    assert.strictEqual(empty.body.progress, null);

    const payload = { items: { 'conj-ser-estar-ser-0': { box: 2, due: '2026-09-05', seen: 3, correct: 3, incorrect: 0 } }, streak: { count: 4, last: '2026-09-02' } };
    const put = await req('PUT', '/api/progress', { body: payload, cookie });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.ok, true);

    const readBack = await req('GET', '/api/progress', { cookie });
    assert.strictEqual(readBack.status, 200);
    assert.deepStrictEqual(readBack.body.progress, payload);
  });

  await check('two different users get isolated progress', async () => {
    const cookieA = 'fichero_session=' + serverExports.__testCreateSession({ sub: 'sub-bob', email: 'bob@example.com', name: 'Bob', picture: '' });
    const cookieB = 'fichero_session=' + serverExports.__testCreateSession({ sub: 'sub-carol', email: 'carol@example.com', name: 'Carol', picture: '' });
    await req('PUT', '/api/progress', { body: { items: { x: 1 }, who: 'bob' }, cookie: cookieA });
    await req('PUT', '/api/progress', { body: { items: { y: 2 }, who: 'carol' }, cookie: cookieB });
    const a = await req('GET', '/api/progress', { cookie: cookieA });
    const b = await req('GET', '/api/progress', { cookie: cookieB });
    assert.strictEqual(a.body.progress.who, 'bob');
    assert.strictEqual(b.body.progress.who, 'carol');
  });

  await check('progress is actually persisted to disk, not just kept in memory', async () => {
    // A fresh module load simulates a process restart: the in-memory
    // sessions Map is gone, but the saved-progress *file* must still be
    // there and readable via the same progressPath the routes use.
    delete require.cache[require.resolve('./server.js')];
    const reloaded = require('./server.js');
    const fs = require('fs');
    const file = reloaded.progressPath('sub-alice');
    assert.ok(fs.existsSync(file), 'expected a progress file on disk for sub-alice');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(onDisk.streak.count, 4);
  });

  console.log(failures === 0 ? 'ALL ROUTE TESTS PASSED' : (failures + ' FAILURES'));
  server.close();
  process.exit(failures === 0 ? 0 : 1);
}
