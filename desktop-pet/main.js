const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const path = require('path');

const W = 220, H = 260;
let win;

app.whenReady().then(() => {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: W, height: H,
    x: workArea.x + workArea.width - W - 40,
    y: workArea.y + workArea.height - H,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('index.html');
});

ipcMain.handle('bounds', () => {
  const [x, y] = win.getPosition();
  const d = screen.getDisplayNearestPoint({ x: x + W / 2, y: y + H / 2 }).workArea;
  return { x, y, minX: d.x, maxX: d.x + d.width - W, floorY: d.y + d.height - H, minY: d.y };
});
ipcMain.on('move', (_e, x, y) => win.setPosition(Math.round(x), Math.round(y)));
ipcMain.on('menu', () => {
  Menu.buildFromTemplate([{ label: '종료', click: () => app.quit() }]).popup({ window: win });
});
app.on('window-all-closed', () => app.quit());
