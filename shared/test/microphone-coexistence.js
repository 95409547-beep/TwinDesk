// TwinDesk microphone fork. GPL-3.0, see LICENSE.
// Exercise upstream continuous audio and F8 audio on the same link and Electron process.
'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const sessions = new Map();
class Window extends EventEmitter {
  constructor(options = {}) {
    super();
    const partition = options.webPreferences?.partition || 'default';
    if (!sessions.has(partition)) sessions.set(partition, {
      setPermissionCheckHandler(fn) { this.check = fn; },
      setPermissionRequestHandler(fn) { this.request = fn; },
    });
    this.webContents = Object.assign(new EventEmitter(), {
      session: sessions.get(partition), send() {}, setWindowOpenHandler() {},
    });
  }
  isDestroyed() { return !!this.dead; }
  loadFile() { return Promise.resolve(); }
  destroy() { this.dead = true; this.emit('closed'); }
}
const ipcMain = new EventEmitter(), powerMonitor = new EventEmitter();
const load = Module._load;
Module._load = function (id, ...args) {
  return id === 'electron' ? { BrowserWindow: Window, ipcMain, powerMonitor } : load.call(this, id, ...args);
};
let Mic, attach;
try {
  ({ Mic } = require('../mic'));
  ({ attach } = require('../microphone-runtime'));
} finally { Module._load = load; }
const link = Object.assign(new EventEmitter(), { status: { state: 'connected' }, send() {} });
const cfg = { micSend: true, micReceive: true };
const continuous = new Mic({ link, cfg: () => cfg, platform: 'win' });
const held = attach({
  platform: 'win', settings: { microphone: { send: true, receive: true, output: 'cable' } },
  changed() {}, save() {}, route: { mode: () => 'driving', generation: () => 7, incoming: () => 7 },
  link: { connected: () => true, os: () => 'win', transport: () => 'ip',
    on: (...args) => link.on(...args), onConnect() {}, onDisconnect() {}, send() {} },
});
(async () => {
  try {
    const tick = () => new Promise(setImmediate);
    const { T } = require('../protocol');
    link.emit(T.MIC_POLICY, { t: T.MIC_POLICY, accept: true });
    await tick();
    assert(continuous.sending, 'upstream audio starts on its own policy');
    assert.equal(held.peer, null, 'the upstream policy cannot enable F8 capture');
    const session = continuous.sending;
    link.emit('ptt-mic.policy', { t: 'ptt-mic.policy', version: 2,
      epoch: '11111111-1111-4111-8111-111111111111', accept: false });
    assert(held.peer && !held.peer.accept);
    assert.equal(continuous.sending, session, 'F8 policy cannot stop continuous audio');
    held.stop('Released');
    assert.equal(continuous.sending, session, 'F8 release cannot stop continuous audio');
    held.command({ action: 'devices' });
    const normal = continuous.win.webContents, gated = held.win.webContents;
    assert.notEqual(normal.session, gated.session, 'F8 permissions have a separate session');
    assert.equal(normal.session.check, undefined, 'upstream permission handling stays intact');
    assert(gated.session.check(gated, 'media', '', { mediaType: 'audio' }));
    assert(!gated.session.check(normal, 'media', '', { mediaType: 'audio' }));
    assert(!gated.session.check(gated, 'media', '', { mediaType: 'video' }));
    console.log('microphone-coexistence: upstream/F8 policies, release and media permissions stay independent');
  } finally { held.shutdown(); await continuous.shutdown(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
