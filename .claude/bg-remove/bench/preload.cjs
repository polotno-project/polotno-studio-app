const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bench', {
  save: (name, bytes) => ipcRenderer.invoke('save', name, bytes),
  log: (msg) => ipcRenderer.send('log', msg),
  done: (result) => ipcRenderer.send('done', result)
})
