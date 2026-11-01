'use strict';

const { app, safeStorage } = require('electron');

app.whenReady().then(() => {
  console.log('APP_NAME:', app.getName());
  console.log('USER_DATA:', app.getPath('userData'));
  console.log('APP_DATA:', app.getPath('appData'));
  console.log('ENCRYPTION_AVAILABLE:', safeStorage.isEncryptionAvailable());
  app.quit();
});
