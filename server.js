const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
// DATA_DIR should point at a mounted Railway volume in production so saved
// progress survives redeploys; falls back to a local folder for dev.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROGRESS_DIR = path.join(DATA_DIR, 'progress');
fs.mkdirSync(PROGRESS_DIR, { recursive: true });

const indexTemplate = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
// Escaped defensively even though this only ever comes from our own env var,
// not user input — a stray quote in a misconfigured value must not be able
// to break out of the JS string literal it's substituted into.
const safeClientId = GOOGLE_CLIENT_ID.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const indexHtml = indexTemplate.replace('%%GOOGLE_CLIENT_ID%%', safeClientId);

/* ============================= cookies (no dependency) ============================= */
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}
function setSessionCookie(res, sessionId) {
  const maxAge = 60 * 60 * 24 * 180; // 180 days
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `fichero_session=${sessionId}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'fichero_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

/* ============================= sessions (in-memory) =============================
   Sessions live only for the process lifetime — a restart just signs everyone
   out (they sign back in with one click). The durable thing is progress on
   disk, keyed by Google's stable "sub" id, not the session itself. */
const sessions = new Map(); // sessionId -> {sub, email, name, picture}

/* ============================= Google ID token verification =============================
   Verified locally against Google's published RS256 keys (no dependency) —
   this is the production-correct approach, not the tokeninfo debug endpoint. */
let jwksCache = { keys: null, fetchedAt: 0 };
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
async function getGoogleKeys() {
  if (jwksCache.keys && Date.now() - jwksCache.fetchedAt < 3600000) return jwksCache.keys;
  const jwks = await fetchJson('https://www.googleapis.com/oauth2/v3/certs');
  jwksCache = { keys: jwks.keys, fetchedAt: Date.now() };
  return jwksCache.keys;
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}
// Pure verification logic, independent of the network fetch, so it can be
// unit-tested against a locally generated key pair.
function verifyGoogleIdTokenWithKeys(idToken, keys, clientId, now) {
  now = now || Date.now();
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(b64urlDecode(headerB64).toString('utf8'));
  const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  const signature = b64urlDecode(sigB64);

  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('No matching signing key');
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(headerB64 + '.' + payloadB64), publicKey, signature);
  if (!ok) throw new Error('Bad signature');

  if (payload.aud !== clientId) throw new Error('Wrong audience');
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') throw new Error('Wrong issuer');
  if (!payload.exp || payload.exp * 1000 < now) throw new Error('Expired token');
  if (payload.email_verified === false) throw new Error('Email not verified');
  return payload;
}
async function verifyGoogleIdToken(idToken) {
  // Cheap structural check first so a garbage credential fails fast without
  // ever calling out to Google's key endpoint.
  if (typeof idToken !== 'string' || idToken.split('.').length !== 3) {
    throw new Error('Malformed token');
  }
  const keys = await getGoogleKeys();
  return verifyGoogleIdTokenWithKeys(idToken, keys, GOOGLE_CLIENT_ID);
}

function progressPath(sub) {
  const safe = String(sub).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('bad subject id');
  return path.join(PROGRESS_DIR, safe + '.json');
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const session = cookies.fichero_session && sessions.get(cookies.fichero_session);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  req.user = session;
  next();
}

/* ============================= app ============================= */
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.type('html').send(indexHtml);
});

app.post('/api/auth/google', async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google sign-in is not configured on this server yet.' });
    const credential = req.body && req.body.credential;
    if (!credential) return res.status(400).json({ error: 'missing credential' });
    const payload = await verifyGoogleIdToken(credential);
    const sessionId = crypto.randomUUID();
    const user = { sub: payload.sub, email: payload.email, name: payload.name || payload.email, picture: payload.picture || '' };
    sessions.set(sessionId, user);
    setSessionCookie(res, sessionId);
    res.json({ user });
  } catch (e) {
    res.status(401).json({ error: 'invalid Google credential: ' + e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.fichero_session) sessions.delete(cookies.fichero_session);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const cookies = parseCookies(req);
  const session = cookies.fichero_session && sessions.get(cookies.fichero_session);
  res.json({ user: session || null, googleConfigured: !!GOOGLE_CLIENT_ID });
});

app.get('/api/progress', requireAuth, (req, res) => {
  const file = progressPath(req.user.sub);
  if (!fs.existsSync(file)) return res.json({ progress: null });
  try {
    res.json({ progress: JSON.parse(fs.readFileSync(file, 'utf8')) });
  } catch (e) {
    res.json({ progress: null });
  }
});

app.put('/api/progress', requireAuth, (req, res) => {
  const progress = req.body;
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    return res.status(400).json({ error: 'bad progress payload' });
  }
  fs.writeFileSync(progressPath(req.user.sub), JSON.stringify(progress));
  res.json({ ok: true });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('Fichero de Español running on port ' + PORT);
  });
}

module.exports = {
  app, verifyGoogleIdTokenWithKeys, progressPath,
  // Test-only seam: inserts a session directly so authenticated routes can
  // be exercised without a live Google token. Never reachable over HTTP.
  __testCreateSession(user) {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, user);
    return sessionId;
  }
};
