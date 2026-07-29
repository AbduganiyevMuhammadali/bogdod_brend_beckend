const { app, BrowserWindow, Tray, Menu } = require('electron');
const path = require('path');
const { host, port } = require('./startup/config');
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}
let mainWindow = null;
const createWindow = () => {
  // Create the browser window.
   mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      //preload: path.join(__dirname, 'preload.js')
      devTools: false,
      nodeIntegration: true
    },
    autoHideMenuBar:true,
  });
  mainWindow.hide();
  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // mainWindow.loadURL(`http:/${host}:${port}/`);
  // Open the DevTools.
  //mainWindow.webContents.openDevTools();
  mainWindow.on('close', function (event) {
    event.preventDefault();
    mainWindow.hide();
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
   app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  let tray = null
  app.whenReady().then(() => {
    require('./server');

    createWindow()

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0)  createWindow()
    })

    tray = new Tray(path.join(__dirname, '../build/icon.ico'))
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click:  function(){
            mainWindow.show();
        } },
        { label: 'Quit', click:  function(){
            mainWindow.destroy();
            app.quit();
        } }
    ])
    tray.setToolTip('This is my application.')
    tray.setContextMenu(contextMenu)
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
