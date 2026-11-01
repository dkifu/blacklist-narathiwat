'use strict';

const { app } = require('electron');
const { generateKeyPairSync, sign, verify, randomUUID } = require('node:crypto');
const { buildSignedChallengeRequest } = require('./agent-challenge-auth.cjs');

app.whenReady().then(async () => {
  try {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const deviceId = randomUUID();

    const request = await buildSignedChallengeRequest({
      deviceId,
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
      throw new Error('Electron signature verification failed');
    }

    console.log('ELECTRON_SIGNED_CHALLENGE: PASS');
    console.log('REAL_AGENT_KEY_USED: NO');
    console.log('PRODUCTION_REQUEST_SENT: NO');
    console.log('PING_SERVER_STARTED: NO');
  } catch (error) {
    console.error('ELECTRON_TEST_FAILED:', error.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}).catch(error => {
  console.error('ELECTRON_INIT_FAILED:', error.message);
  app.quit();
});
