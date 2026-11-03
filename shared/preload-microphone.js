// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('microphoneApi', {
  on: (fn) => ipcRenderer.on('microphone', (_e, m) => fn(m)),
  send: (m) => ipcRenderer.send('microphone:media', m),
});
