// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const { BrowserWindow, ipcMain, powerMonitor } = require('electron');
const { Microphone } = require('./microphone');
const { normalize } = require('./microphone-settings');
function attach({ link, route, settings, platform, helper, save, changed }) {
  const mic = new Microphone({ link, route, getSettings: () => settings.microphone, platform, createWindow: (o) => {
    const w = new BrowserWindow(o);
    const owned = (wc) => wc === w.webContents;
    w.webContents.session.setPermissionCheckHandler((wc, permission, origin, details) => owned(wc) &&
      ((permission === 'media' && details.mediaType === 'audio' && (mic.cfg.send || mic.cfg.receive)) || (permission === 'speaker-selection' && mic.cfg.receive)));
    w.webContents.session.setPermissionRequestHandler((wc, permission, done, details) => done(owned(wc) &&
      ((permission === 'media' && mic.cfg.send && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every((t) => t === 'audio')) || (permission === 'speaker-selection' && mic.cfg.receive))));
    w.webContents.on('will-navigate', (event) => event.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return w;
  } });
  const media = (e, m) => mic.fromWindow(e, m);
  ipcMain.on('microphone:media', media);
  mic.on('change', changed);
  const timer = setInterval(() => mic.tick(), 1000);
  const configure = () => helper && helper.running && helper.request('microphoneConfig', { on: mic.cfg.send && mic.connected }).catch((e) => mic.fail(e.message));
  let locked = false, sleeping = false;
  const availability = () => {
    mic.stop('Device locked or sleeping');
    mic.blocked = locked || sleeping;
    mic.policy();
    configure();
    changed();
  };
  const suspend = () => { sleeping = true; availability(); };
  const resume = () => { sleeping = false; availability(); };
  const lock = () => { locked = true; availability(); };
  const unlock = () => { locked = false; availability(); };
  const powerEvents = { suspend, resume, 'lock-screen': lock, 'unlock-screen': unlock };
  for (const [event, fn] of Object.entries(powerEvents)) powerMonitor.on(event, fn);
  if (helper) {
    link.onConnect(configure);
    link.onDisconnect(configure);
    helper.on('ready', () => { mic.held = false; mic.stop('Input helper restarted'); configure(); });
    helper.on('exit', () => mic.stop('Input helper stopped'));
    helper.on('event', (name, m) => { if (name === 'microphoneKey') mic.key(m.down === true); });
    configure();
  }
  mic.applySettings = () => { mic.changedSettings(); configure(); };
  mic.action = (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.do === 'settings') {
      const next = normalize({ ...settings.microphone, ...(m.settings || {}) });
      if (['default', 'communications'].includes(next.output)) next.output = '';
      settings.microphone = next;
      save();
      mic.applySettings();
    } else if (m.do === 'devices') mic.command({ action: 'devices' });
    else if (m.do === 'stop') mic.stop('Stopped from client');
  };
  const shutdown = mic.shutdown.bind(mic);
  mic.shutdown = () => { clearInterval(timer); for (const [event, fn] of Object.entries(powerEvents)) powerMonitor.removeListener(event, fn); ipcMain.removeListener('microphone:media', media); shutdown(); };
  return mic;
}
module.exports = { attach };
