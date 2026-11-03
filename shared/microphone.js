// TwinDesk microphone fork. GPL-3.0, see LICENSE.
// Mac -> Windows, one-to-one. Media only exists during a fresh physical F8 hold.
'use strict';
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const path = require('path');
const { normalize } = require('./microphone-settings');
const TYPES = ['mic.policy', 'mic.offer', 'mic.answer', 'mic.ice', 'mic.stop', 'mic.pulse'];
const validId = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);

class Microphone extends EventEmitter {
  constructor({ link, route, getSettings, platform, createWindow, now = Date.now }) {
    super();
    Object.assign(this, { link, route, getSettings, platform, createWindow, now });
    this.epoch = randomUUID();
    this.peer = null;
    this.held = false;
    this.blocked = false;
    this.tx = null;
    this.rx = null;
    this.win = null;
    this.windowReady = false;
    this.error = '';
    this.devices = [];
    this.finished = new Set();
    this.lastPolicy = 0;
    link.onConnect(() => this.reset());
    link.onDisconnect(() => this.reset());
    for (const type of TYPES) link.on(type, (m) => this.message(m));
  }
  get cfg() { return normalize(this.getSettings()); }
  get paired() { return this.link.connected() && this.link.os() === (this.platform === 'mac' ? 'win' : 'mac') && this.link.transport() !== 'ble'; }
  get connected() { return this.paired && !this.blocked; }
  get accepting() { return this.platform === 'win' && this.connected && this.cfg.receive && !!this.cfg.output; }
  send(m) { if (this.connected) this.link.send(m); }
  policy() {
    this.lastPolicy = this.now();
    if (this.paired) this.link.send({ t: 'mic.policy', version: 1, epoch: this.epoch, accept: this.accepting });
  }
  reset() {
    this.stop('Connection changed');
    this.peer = null;
    this.finished.clear();
    this.epoch = randomUUID();
    this.policy();
    this.emit('change');
  }
  changedSettings() {
    this.stop('Microphone settings changed');
    this.error = '';
    this.policy();
    this.emit('change');
  }
  routeChanged() {
    if (this.tx && (!this.connected || this.route.mode() !== 'driving' || this.tx.route !== this.route.generation())) this.stop('Input moved');
    if (this.rx && (!this.connected || this.route.mode() !== 'driven' || this.rx.route !== this.route.incoming())) this.stop('Input moved');
    this.emit('change');
  }
  key(down) {
    if (!down) { this.held = false; this.stop('Released'); return; }
    if (this.held) return;
    this.held = true;
    if (this.platform !== 'mac' || !this.cfg.send) return;
    if (!this.connected || !this.peer || !this.peer.accept) return this.fail('Enable microphone reception and choose a virtual cable on Windows');
    if (this.route.mode() !== 'driving' || !this.route.generation()) return;
    this.error = '';
    const s = this.tx = { id: randomUUID(), route: this.route.generation(), at: this.now(), status: 'starting' };
    this.command({ action: 'send', id: s.id, route: s.route, input: this.cfg.input });
    this.emit('change');
  }
  fail(text) { this.error = String(text).slice(0, 300); this.stop(this.error); this.emit('change'); }
  stop(reason) {
    for (const s of [this.tx, this.rx]) if (s) {
      this.finished.add(s.id);
      this.send({ t: 'mic.stop', id: s.id, epoch: this.epoch, target: this.peer && this.peer.epoch });
    }
    if (this.finished.size > 256) { this.peer = null; this.finished.clear(); this.epoch = randomUUID(); }
    this.tx = this.rx = null;
    this.command({ action: 'stop' });
    this.emit('change');
  }
  message(m) {
    if (!this.connected || !m || typeof m !== 'object') return;
    if (m.t === 'mic.policy') {
      if (m.version !== 1 || !validId(m.epoch)) return;
      const first = !this.peer || this.peer.epoch !== m.epoch;
      if (first || (this.tx && m.accept !== true)) this.stop('Receiver policy changed');
      this.peer = { epoch: m.epoch, accept: m.accept === true };
      if (first) this.policy();
      this.emit('change');
      return;
    }
    if (!this.peer || m.epoch !== this.peer.epoch || m.target !== this.epoch || !validId(m.id)) return;
    if (m.t === 'mic.offer') {
      if (!this.accepting || this.route.mode() !== 'driven' || m.route !== this.route.incoming() || !Number.isSafeInteger(m.route) || m.route <= 0 || typeof m.sdp !== 'string' || m.sdp.length > 65536) return;
      // Never replace a live round with a different offer. New rounds follow an explicit stop.
      if (this.rx || this.finished.has(m.id)) return;
      this.rx = { id: m.id, route: m.route, at: this.now(), status: 'connecting', sdp: m.sdp };
      this.command({ action: 'receive', id: m.id, sdp: m.sdp, output: this.cfg.output });
      this.emit('change');
      return;
    }
    const s = this.tx || this.rx;
    if (!s || s.id !== m.id) return;
    if (m.t === 'mic.stop') this.stop('Peer stopped');
    else if (m.t === 'mic.pulse') { s.at = this.now(); this.command({ action: 'pulse', id: s.id }); }
    else if (m.t === 'mic.answer' && this.tx && typeof m.sdp === 'string' && m.sdp.length <= 65536) this.command({ action: 'answer', id: s.id, sdp: m.sdp });
    else if (m.t === 'mic.ice' && m.candidate && typeof m.candidate.candidate === 'string' && m.candidate.candidate.length <= 4096) this.command({ action: 'ice', id: s.id, candidate: m.candidate });
  }
  tick() {
    this.routeChanged();
    if (this.now() - this.lastPolicy > 3000) this.policy(); // capability discovery also works when this side starts later
    const s = this.tx || this.rx;
    if (!s) return;
    if (this.now() - s.at > 5000) return this.fail('Microphone connection timed out');
    this.send({ t: 'mic.pulse', id: s.id, epoch: this.epoch, target: this.peer && this.peer.epoch });
    this.command({ action: 'pulse', id: s.id }); // renderer stops too if the main process stalls
  }
  command(m) {
    if (m.action === 'stop' && !this.win) return;
    if (!this.win) {
      this.win = this.createWindow({
        show: false,
        webPreferences: { preload: path.join(__dirname, 'preload-microphone.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:twindesk-microphone', backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
      });
      const w = this.win;
      w.webContents.on('render-process-gone', () => {
        if (this.win !== w) return;
        this.win = null; this.windowReady = false;
        this.fail('Microphone media process stopped');
        w.destroy();
      });
      w.on('closed', () => { if (this.win === w) { this.win = null; this.windowReady = false; this.fail('Microphone media window closed'); } });
      w.loadFile(path.join(__dirname, 'microphone.html')).catch(() => this.fail('Cannot load microphone media window'));
    }
    if (this.windowReady) this.win.webContents.send('microphone', m);
    // No command queue: readiness samples only the still-active round.
  }
  fromWindow(event, m) {
    if (!this.win || event.sender !== this.win.webContents || !m || typeof m !== 'object') return;
    if (m.action === 'ready') {
      if (this.windowReady) return;
      this.windowReady = true;
      if (this.tx) this.command({ action: 'send', ...this.tx, input: this.cfg.input });
      if (this.rx) this.command({ action: 'receive', id: this.rx.id, sdp: this.rx.sdp, output: this.cfg.output }); // offers are not replayed after stop
      this.command({ action: 'devices' });
      return;
    }
    if (m.action === 'devices') {
      this.devices = Array.isArray(m.devices) ? m.devices.slice(0, 100).filter((d) => d && ['audioinput', 'audiooutput'].includes(d.kind) && typeof d.deviceId === 'string' && d.deviceId.length <= 512).map((d) => ({ kind: d.kind, deviceId: d.deviceId, label: String(d.label || '').slice(0, 200) })) : [];
      this.emit('change');
      return;
    }
    const s = this.tx || this.rx;
    if (!s || s.id !== m.id) return;
    if (m.action === 'error') return this.fail(m.error);
    if (m.action === 'state') {
      s.status = String(m.status).slice(0, 40);
      if (['failed', 'disconnected', 'closed'].includes(s.status)) return this.fail('Microphone media connection ended');
      this.emit('change');
    } else if (['mic.offer', 'mic.answer', 'mic.ice'].includes(m.t)) {
      const payload = m.t === 'mic.ice' ? { candidate: m.candidate } : { sdp: m.sdp };
      this.send({ ...payload, t: m.t, id: s.id, route: s.route, epoch: this.epoch, target: this.peer && this.peer.epoch });
    }
  }
  shutdown() {
    this.stop('Stopped');
    const w = this.win;
    this.win = null;
    this.windowReady = false;
    if (w) w.destroy();
  }
  get view() {
    return { ...this.cfg, platform: this.platform, connected: this.connected, peerReady: !!(this.peer && this.peer.accept), sending: this.tx && this.tx.status, receiving: this.rx && this.rx.status, error: this.error, devices: this.devices };
  }
}
module.exports = { Microphone, TYPES };
