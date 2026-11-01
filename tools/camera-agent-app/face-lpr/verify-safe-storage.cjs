'use strict';

const { app, safeStorage } = require('electron');

app.whenReady().then(() => {
  console.log(
    'SAFE_STORAGE_AVAILABLE:',
    safeStorage.isEncryptionAvailable()
  );
  app.quit();
}).catch(() => {
  console.error('SAFE_STORAGE_TEST_FAILED');
  app.quit();
});
