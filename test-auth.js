const crypto = require('crypto');
const assert = require('assert');
const { verifyGoogleIdTokenWithKeys, buildServiceAccountJWT } = require('./server.js');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'test-key-1';
jwk.alg = 'RS256';
jwk.use = 'sig';
const keys = [jwk];

const CLIENT_ID = '123-fake.apps.googleusercontent.com';

function signToken(payloadOverrides, headerOverrides) {
  const header = Object.assign({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' }, headerOverrides || {});
  const payload = Object.assign({
    iss: 'accounts.google.com',
    aud: CLIENT_ID,
    sub: 'user-sub-42',
    email: 'friend@example.com',
    email_verified: true,
    name: 'Test Friend',
    picture: 'https://example.com/pic.jpg',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  }, payloadOverrides || {});
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = headerB64 + '.' + payloadB64;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return signingInput + '.' + b64url(signature);
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.log('FAIL', name, '->', e.message); }
}

check('valid token verifies and returns payload', () => {
  const token = signToken();
  const payload = verifyGoogleIdTokenWithKeys(token, keys, CLIENT_ID);
  assert.strictEqual(payload.sub, 'user-sub-42');
  assert.strictEqual(payload.email, 'friend@example.com');
});

check('tampered payload is rejected (signature no longer matches)', () => {
  const token = signToken();
  const parts = token.split('.');
  const tamperedPayload = b64url(Buffer.from(JSON.stringify({
    iss: 'accounts.google.com', aud: CLIENT_ID, sub: 'attacker-sub', email: 'attacker@evil.com',
    email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600
  })));
  const forged = parts[0] + '.' + tamperedPayload + '.' + parts[2];
  assert.throws(() => verifyGoogleIdTokenWithKeys(forged, keys, CLIENT_ID), /Bad signature/);
});

check('wrong audience is rejected', () => {
  const token = signToken({ aud: 'someone-elses-client-id.apps.googleusercontent.com' });
  assert.throws(() => verifyGoogleIdTokenWithKeys(token, keys, CLIENT_ID), /Wrong audience/);
});

check('wrong issuer is rejected', () => {
  const token = signToken({ iss: 'evil.example.com' });
  assert.throws(() => verifyGoogleIdTokenWithKeys(token, keys, CLIENT_ID), /Wrong issuer/);
});

check('expired token is rejected', () => {
  const token = signToken({ exp: Math.floor(Date.now() / 1000) - 10 });
  assert.throws(() => verifyGoogleIdTokenWithKeys(token, keys, CLIENT_ID), /Expired/);
});

check('unverified email is rejected', () => {
  const token = signToken({ email_verified: false });
  assert.throws(() => verifyGoogleIdTokenWithKeys(token, keys, CLIENT_ID), /Email not verified/);
});

check('unknown signing key (kid) is rejected', () => {
  const token = signToken({}, { kid: 'no-such-key' });
  assert.throws(() => verifyGoogleIdTokenWithKeys(token, keys, CLIENT_ID), /No matching signing key/);
});

check('malformed token is rejected', () => {
  assert.throws(() => verifyGoogleIdTokenWithKeys('not.a.validtoken.extra', keys, CLIENT_ID), /Malformed/);
});

check('token signed by a different key pair entirely is rejected', () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const header = { alg: 'RS256', kid: 'test-key-1', typ: 'JWT' };
  const payload = { iss: 'accounts.google.com', aud: CLIENT_ID, sub: 'x', email: 'x@x.com', email_verified: true, exp: Math.floor(Date.now()/1000)+3600 };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(headerB64+'.'+payloadB64), other.privateKey);
  const forged = headerB64 + '.' + payloadB64 + '.' + b64url(sig);
  assert.throws(() => verifyGoogleIdTokenWithKeys(forged, keys, CLIENT_ID), /Bad signature/);
});

// --- Sheets service-account JWT signing (the outbound side — Google's
// oauth2 endpoint verifies these; we can't reach that from here, but we can
// prove the JWT this function builds is exactly the assertion a correct
// implementation of the RFC 7523 JWT-bearer flow would produce: a valid
// RS256 signature over the header+claims, with the right shape. ---
const svc = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const svcPrivatePem = svc.privateKey.export({ type: 'pkcs1', format: 'pem' });
const svcPublicPem = svc.publicKey.export({ type: 'pkcs1', format: 'pem' });

check('service-account JWT has correct header, claims, and a verifiable signature', () => {
  const now = Math.floor(Date.now() / 1000);
  const jwt = buildServiceAccountJWT('bot@project.iam.gserviceaccount.com', svcPrivatePem, 'https://www.googleapis.com/auth/spreadsheets', now);
  const parts = jwt.split('.');
  assert.strictEqual(parts.length, 3, 'expected a three-part JWT');
  const header = JSON.parse(Buffer.from(parts[0].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
  assert.strictEqual(header.alg, 'RS256');
  assert.strictEqual(claims.iss, 'bot@project.iam.gserviceaccount.com');
  assert.strictEqual(claims.scope, 'https://www.googleapis.com/auth/spreadsheets');
  assert.strictEqual(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.strictEqual(claims.exp, now + 3600);
  assert.strictEqual(claims.iat, now);

  const signingInput = Buffer.from(parts[0] + '.' + parts[1]);
  const signature = Buffer.from(parts[2].replace(/-/g,'+').replace(/_/g,'/'), 'base64');
  const ok = crypto.verify('RSA-SHA256', signingInput, svcPublicPem, signature);
  assert.ok(ok, 'signature should verify against the matching public key');
});

check('service-account JWT signed with the wrong key fails verification (sanity check on the check itself)', () => {
  const wrongKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = buildServiceAccountJWT('bot@project.iam.gserviceaccount.com', wrongKey.privateKey, 'scope', Math.floor(Date.now()/1000));
  const parts = jwt.split('.');
  const signingInput = Buffer.from(parts[0] + '.' + parts[1]);
  const signature = Buffer.from(parts[2].replace(/-/g,'+').replace(/_/g,'/'), 'base64');
  const ok = crypto.verify('RSA-SHA256', signingInput, svcPublicPem, signature);
  assert.strictEqual(ok, false, 'a JWT signed by a different key must not verify against this public key');
});

console.log(failures === 0 ? 'ALL AUTH UNIT TESTS PASSED' : (failures + ' FAILURES'));
process.exit(failures === 0 ? 0 : 1);
