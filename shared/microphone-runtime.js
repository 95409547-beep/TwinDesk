// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const { BrowserWindow, ipcMain, powerMonitor } = require('electron');
const { Microphone } = require('./microphone');
const { normalize } = require('./microphone-settings');
function attach({ link, route, settings, platform, helper, save, changed, mesh }) {
  const mediaOwners = new WeakMap();
  const createWindow = (o, owner) => {
    const w = new BrowserWindow(o);
    mediaOwners.set(w.webContents, owner);
    w.webContents.session.setPermissionCheckHandler((wc, permission, origin, details) => {
      const cfg = mediaOwners.get(wc)?.cfg;
      return !!cfg && ((permission === 'media' && details.mediaType === 'audio' && (cfg.send || cfg.receive)) ||
        (permission === 'speaker-selection' && cfg.receive));
    });
    w.webContents.session.setPermissionRequestHandler((wc, permission, done, details) => {
      const cfg = mediaOwners.get(wc)?.cfg;
      done(!!cfg && ((permission === 'media' && cfg.send && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 &&
        details.mediaTypes.every((t) => t === 'audio')) || (permission === 'speaker-selection' && cfg.receive)));
    });
    w.webContents.on('will-navigate', (event) => event.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return w;
  };
  const mic = mesh
    ? new (require('./microphone-mesh').MeshMicrophone)({ ...mesh, settings, platform, createWindow })
    : new Microphone({ link, route, getSettings: () => settings.microphone, platform, createWindow });
  const media = (e, m) => mic.fromWindow(e, m);
  ipcMain.on('microphone:media', media);
  mic.on('change', changed);
  const timer = setInterval(() => mic.tick(), 1000);
  let configured;
  const configure = () => {
    if (!helper?.running) return;
    const on = mesh ? mic.captureEnabled : mic.cfg.send && mic.connected;
    if (configured === on) return;
    configured = on;
    helper.request('microphoneConfig', { on }).catch((e) => {
      if (configured === on) configured = undefined;
      mic.fail(e.message);
    });
  };
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
  let checking = false;
  mic.checkDoubao = async () => {
    if (platform !== 'win' || mic.cfg.mode !== 'dictation' || !helper?.running || checking) return;
    checking = true;
    try {
      const reply = await helper.request('doubaoInstalled');
      mic.setDoubaoStatus(reply.installed === true ? 'installed' : reply.installed === false ? 'missing' : 'unavailable');
    } catch {
      mic.setDoubaoStatus('unavailable');
    } finally {
      checking = false;
    }
  };
  if (helper) {
    if (mesh) {
      mesh.hub.on('peerAdded', () => mic.checkDoubao());
      mic.on('change', configure);
    } else {
      link.onConnect(configure);
      link.onDisconnect(configure);
    }
    helper.on('ready', () => { configured = undefined; mic.held = false; mic.stop('Input helper restarted'); configure(); mic.checkDoubao(); });
    helper.on('exit', () => mic.stop('Input helper stopped'));
    helper.on('event', (name, m) => { if (name === 'microphoneKey') mic.key(m.down === true); });
    configure();
  }
  if (!mesh) mic.applySettings = () => { mic.changedSettings(); configure(); mic.checkDoubao(); };
  mic.checkDoubao();
  mic.action = (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.do === 'settings') {
      if (mesh) {
        mic.configure(m.settings, m.peerId);
        configure();
        mic.checkDoubao();
        return;
      }
      const next = normalize({ ...settings.microphone, ...(m.settings || {}) });
      if (['default', 'communications'].includes(next.output)) next.output = '';
      settings.microphone = next;
      save();
      mic.applySettings();
    } else if (m.do === 'devices') {
      mic.command({ action: 'devices' });
      mic.checkDoubao();
    }
    else if (m.do === 'stop') mic.stop('Stopped from client');
  };
  const shutdown = mic.shutdown.bind(mic);
  mic.shutdown = () => { clearInterval(timer); for (const [event, fn] of Object.entries(powerEvents)) powerMonitor.removeListener(event, fn); ipcMain.removeListener('microphone:media', media); shutdown(); };
  return mic;
}
module.exports = { attach };
