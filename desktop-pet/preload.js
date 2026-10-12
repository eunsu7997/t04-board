const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pet', {
  bounds: () => ipcRenderer.invoke('bounds'),
  move: (x, y) => ipcRenderer.send('move', x, y),
  menu: () => ipcRenderer.send('menu'),
});
