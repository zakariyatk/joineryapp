// Exposes a small, explicit API to the renderer. Nothing else from Node is reachable.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('joinery', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (json) => ipcRenderer.invoke('data:save', json),
  dataLocation: () => ipcRenderer.invoke('data:location'),
  saveText: (opts) => ipcRenderer.invoke('file:saveText', opts),
  savePdf: (opts) => ipcRenderer.invoke('file:savePdf', opts),
  reveal: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
});
