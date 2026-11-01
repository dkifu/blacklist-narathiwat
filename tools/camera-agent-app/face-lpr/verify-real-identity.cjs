'use strict';

const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, createPublicKey, sign, verify } = require('node:crypto');
const { buildSignedChallengeRequest } = require('./agent-challenge-auth.cjs');

const EXPECTED_DEVICE_ID = '7676691c-9a2e-416f-b982-19360178dfe6';
const EXPECTED_SHA256 = '3F65FB6D71CE72847AB16DA426FDE7B242D0DB17371B30BC42E655DF7746EA6A';

// Match the installed Agent's persistent userData context.
const agentUserDataPath = path.join(
  app.getPath('appData'),
  'cctv-ping-agent'
);

app.setName('CCTV Ping Agent');

// ใช้ Encryption Context เดียวกับ Agent จริง
// ห้ามเรียก main.cjs หรือเปิด Ping Server ซ้อน
app.setPath('userData', agentUserDataPath);

app.whenReady().then(async () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows encryption unavailable');
    }

    const identityPath = path.join(
      app.getPath('appData'),
      'cctv-ping-agent',
      'device-identity.json'
    );

    const before = fs.readFileSync(identityPath);
    const hash = createHash('sha256').update(before).digest('hex').toUpperCase();

    if (hash !== EXPECTED_SHA256) {
      throw new Error('Identity hash mismatch');
    }

    const identity = JSON.parse(before.toString('utf8'));

    if (identity.id !== EXPECTED_DEVICE_ID) {
      throw new Error('Device ID mismatch');
    }

    const privateKey = safeStorage.decryptString(
      Buffer.from(identity.privateKeyProtected, 'base64')
    );

    const publicKey = createPublicKey(privateKey).export({
      type: 'spki',
      format: 'pem',
    });

    if (publicKey !== identity.publicKey) {
      throw new Error('Public key mismatch');
    }

    const request = await buildSignedChallengeRequest({
      deviceId: identity.id,
      agentVersion: '1.0.11',
      signBytes: bytes => sign(null, bytes, privateKey),
    });

    const message = Buffer.from([
      'CCTV-AGENT-FACE-LPR-CHALLENGE-V1',
      request.deviceId,
      request.agentVersion,
      request.issuedAt,
      request.requestNonce,
    ].join('\n'), 'utf8');

    const valid = verify(
      null,
      message,
      publicKey,
      Buffer.from(request.signatureBase64, 'base64')
    );

    if (!valid) {
      throw new Error('Signature verification failed');
    }

    const after = fs.readFileSync(identityPath);
    if (!before.equals(after)) {
      throw new Error('Identity modified');
    }

    console.log('REAL_IDENTITY_SIGNATURE: PASS');
    console.log('IDENTITY_UNCHANGED: YES');
    console.log('PRIVATE_KEY_EXPORTED: NO');
    console.log('PRODUCTION_REQUEST_SENT: NO');
    console.log('PING_SERVER_STARTED: NO');
  } catch (error) {
    console.error('REAL_IDENTITY_TEST_FAILED:', error.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}).catch(error => {
  console.error('ELECTRON_INIT_FAILED:', error.message);
  app.quit();
});
