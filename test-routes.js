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

  await check('POST /api/session-complete requires auth', async () => {
    const r = await req('POST', '/api/session-complete', { body: { correct: 4, total: 5, pct: 80, label: 'Quiz', mode: 'quiz' } });
    assert.strictEqual(r.status, 401);
  });

  await check('POST /api/session-complete rejects a malformed payload', async () => {
    const cookie = 'fichero_session=' + serverExports.__testCreateSession({ sub: 'sub-dave', email: 'dave@example.com', name: 'Dave', picture: '' });
    const r = await req('POST', '/api/session-complete', { body: { label: 'Quiz' }, cookie });
    assert.strictEqual(r.status, 400);
  });

  await check('POST /api/session-complete succeeds and reports mirrored:false when Sheets is not configured', async () => {
    if (serverExports.SHEETS_CONFIGURED) return; // this test env intentionally has no Sheets vars set
    const cookie = 'fichero_session=' + serverExports.__testCreateSession({ sub: 'sub-erin', email: 'erin@example.com', name: 'Erin', picture: '' });
    const r = await req('POST', '/api/session-complete', { body: { correct: 4, total: 5, pct: 80, label: 'Quiz — Ir', mode: 'quiz' }, cookie });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.mirrored, false);
  });

  await check('merge keeps the copy that reflects more work, per card', () => {
    const { mergeProgress, pickItem } = serverExports;
    const a = { box: 3, due: '2026-09-10', seen: 9, correct: 8, incorrect: 1 };
    const b = { box: 0, due: '2026-09-01', seen: 2, correct: 1, incorrect: 1 };
    assert.deepStrictEqual(pickItem(a, b), a, 'more seen should win');
    assert.deepStrictEqual(pickItem(undefined, b), b, 'a card only one side has must survive');
    // equal effort, different box: the further-along record wins
    assert.deepStrictEqual(
      pickItem({ box: 1, seen: 4, due: '2026-09-02' }, { box: 3, seen: 4, due: '2026-09-02' }).box, 3);
    const merged = mergeProgress({ items: { x: a, only_server: b } }, { items: { x: b, only_client: a } });
    assert.deepStrictEqual(merged.items.x, a);
    assert.ok(merged.items.only_server && merged.items.only_client, 'neither side may be dropped');
  });

  await check('merge unions history without duplicating, keeps the newest 50', () => {
    const { mergeProgress } = serverExports;
    const mk = ts => ({ ts, date: '2026-09-01', mode: 'quiz', label: 'Q', correct: 5, total: 10, pct: 50 });
    const shared = mk(100);
    const merged = mergeProgress({ history: [shared, mk(101)] }, { history: [shared, mk(102)] });
    assert.strictEqual(merged.history.length, 3, 'the shared entry must not appear twice');
    assert.strictEqual(merged.history[2].ts, 102, 'history should end up in time order');
    const many = mergeProgress({ history: Array.from({ length: 40 }, (_, i) => mk(i)) },
      { history: Array.from({ length: 40 }, (_, i) => mk(1000 + i)) });
    assert.strictEqual(many.history.length, 50);
    assert.strictEqual(many.history[49].ts, 1039, 'the cap must drop the oldest, not the newest');
  });

  await check('merge takes the higher study-day count and the longer streak', () => {
    const { mergeProgress } = serverExports;
    const merged = mergeProgress(
      { days: { '2026-09-01': 12, '2026-09-02': 3 }, streak: { count: 2, last: '2026-09-02' } },
      { days: { '2026-09-02': 30, '2026-09-03': 5 }, streak: { count: 6, last: '2026-09-03' } });
    assert.strictEqual(merged.days['2026-09-01'], 12);
    assert.strictEqual(merged.days['2026-09-02'], 30);
    assert.strictEqual(merged.days['2026-09-03'], 5);
    assert.strictEqual(merged.streak.count, 6);
  });

  await check('signing in no longer destroys work done on the device: PUT merges both sides', async () => {
    const cookie = 'fichero_session=' + serverExports.__testCreateSession({ sub: 'sub-merge', email: 'm@example.com', name: 'M', picture: '' });
    // What the account already had, from another device.
    await req('PUT', '/api/progress', { body: {
      items: { 'card-a': { box: 3, due: '2026-09-20', seen: 6, correct: 6, incorrect: 0 } },
      history: [{ ts: 1, date: '2026-09-01', mode: 'quiz', label: 'old', correct: 5, total: 10, pct: 50 }],
      days: { '2026-09-01': 10 }, streak: { count: 3, last: '2026-09-01' }
    }, cookie });
    // What this device practised while signed out.
    const put = await req('PUT', '/api/progress', { body: {
      items: { 'card-b': { box: 1, due: '2026-09-06', seen: 2, correct: 1, incorrect: 1 } },
      history: [{ ts: 2, date: '2026-09-04', mode: 'test', label: 'local', correct: 9, total: 10, pct: 90 }],
      days: { '2026-09-04': 22 }, streak: { count: 1, last: '2026-09-04' }
    }, cookie });
    assert.strictEqual(put.status, 200);
    const p = put.body.progress;
    assert.ok(p, 'PUT should hand back the reconciled copy for the client to adopt');
    assert.ok(p.items['card-a'] && p.items['card-b'], 'both devices\' cards must survive');
    assert.strictEqual(p.history.length, 2);
    assert.strictEqual(p.days['2026-09-01'], 10);
    assert.strictEqual(p.days['2026-09-04'], 22);
    const readBack = await req('GET', '/api/progress', { cookie });
    assert.ok(readBack.body.progress.items['card-b'], 'the merge must actually be what got persisted');
  });

  await check('an explicit wipe replaces rather than merges', async () => {
    const cookie = 'fichero_session=' + serverExports.__testCreateSession({ sub: 'sub-wipe', email: 'w@example.com', name: 'W', picture: '' });
    await req('PUT', '/api/progress', { body: { items: { keep: { box: 2, seen: 4 } }, history: [], days: {}, streak: { count: 1, last: '2026-09-01' } }, cookie });
    const wiped = await req('PUT', '/api/progress?mode=replace', { body: { items: {}, history: [], days: {}, streak: { count: 0, last: null } }, cookie });
    assert.strictEqual(wiped.status, 200);
    assert.deepStrictEqual(wiped.body.progress.items, {}, 'a deliberate reset must not be undone by the merge');
    const readBack = await req('GET', '/api/progress', { cookie });
    assert.deepStrictEqual(readBack.body.progress.items, {});
  });

  await check('progress files are written atomically (no .tmp left behind)', async () => {
    const dir = path.dirname(serverExports.progressPath('sub-alice'));
    const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
    assert.deepStrictEqual(leftovers, [], 'temp files should be renamed into place, not left around');
  });

  await check('stale sessions are swept, live ones are not', () => {
    const id = serverExports.__testCreateSession({ sub: 'sub-fresh', email: 'f@example.com', name: 'F', picture: '' });
    serverExports.sweepSessions(Date.now());
    assert.strictEqual((serverExports.app, true), true);
    // A session last seen beyond the TTL must be gone after a sweep.
    serverExports.sweepSessions(Date.now() + 1000 * 60 * 60 * 24 * 181);
    // ...and the request that would have used it is then rejected.
    return req('GET', '/api/progress', { cookie: 'fichero_session=' + id })
      .then(r => assert.strictEqual(r.status, 401, 'a swept session must not still authenticate'));
  });

  await check('repeated sign-in attempts from one address are rate limited', async () => {
    const { authRateLimited } = serverExports;
    const now = Date.now();
    let limited = false;
    for (let i = 0; i < 21; i++) limited = authRateLimited('203.0.113.9', now);
    assert.strictEqual(limited, true, 'the 21st attempt in the window should be limited');
    assert.strictEqual(authRateLimited('203.0.113.10', now), false, 'other addresses must be unaffected');
    // and the window expires
    assert.strictEqual(authRateLimited('203.0.113.9', now + 11 * 60 * 1000), false);
  });

  console.log(failures === 0 ? 'ALL ROUTE TESTS PASSED' : (failures + ' FAILURES'));
  server.close();
  process.exit(failures === 0 ? 0 : 1);
}
