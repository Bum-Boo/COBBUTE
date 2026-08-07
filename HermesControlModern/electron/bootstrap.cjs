if (process.platform === 'win32') {
  require('./main.cjs');
} else if (process.platform === 'linux') {
  require('./main-linux.cjs');
} else {
  const { app, dialog } = require('electron');
  app.whenReady().then(async () => {
    await dialog.showMessageBox({
      type: 'error',
      title: 'AI Framework Controller',
      message: `Unsupported platform: ${process.platform}`,
      detail: 'Official builds currently support Windows and Linux.'
    });
    app.quit();
  });
}
