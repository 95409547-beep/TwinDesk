// TwinDesk microphone fork. GPL-3.0, see LICENSE.
// Paired Mac/Windows computers, either direction, one-to-one. Media only exists during a fresh physical F8 hold.
'use strict';
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const path = require('path');
const { normalize } = require('./microphone-settings');
const TYPES = ['ptt-mic.policy', 'ptt-mic.offer', 'ptt-mic.answer', 'ptt-mic.ice', 'ptt-mic.stop', 'ptt-mic.pulse', 'ptt-mic.ready', 'ptt-mic.ended'];
const validId = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);

class Microphone extends EventEmitter {
  constructor({ link, route, getSettings, platform, createWindow, now = Date.now }) {
    super();
    Object.assign(this, { link, route, getSettings, platform, createWindow, now });
    this.epoch = randomUUID();
    this.peer = null;
    this.held = false;
    this.blocked = false;
    this.doubao = 'checking';
    this.tx = null;
    this.awaitingEnd = null;
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
  get paired() { return this.link.connected() && ['mac', 'win'].includes(this.link.os()) && this.link.transport() !== 'ble'; }
  get connected() { return this.paired && !this.blocked; }
  get accepting() {
    const { receive, output, mode } = this.cfg;
    return this.connected && receive && !!output && !this.rx?.ending &&
      (mode !== 'dictation' || (this.platform === 'win' && this.doubao === 'installed'));
  }
  setDoubaoStatus(status) {
    if (this.doubao === status) return;
    this.doubao = status;
    if (status !== 'installed' && this.cfg.mode === 'dictation' && this.rx) this.stop('Doubao Input Method unavailable');
    this.policy();
    this.emit('change');
  }
  send(m) { if (this.connected) this.link.send(m); }
  policy() {
    this.lastPolicy = this.now();
    if (this.paired) this.link.send({ t: 'ptt-mic.policy', version: 2, epoch: this.epoch, accept: this.accepting, mode: this.cfg.mode });
  }
  reset() {
    this.stop('Connection changed');
    this.awaitingEnd = null;
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
    if (!down) { this.held = false; this.stop('Released', true); return; }
    if (this.held) return;
    this.held = true;
    if (!this.cfg.send) return;
    if (this.tx || this.rx || this.awaitingEnd) { this.error = 'The previous voice session is still ending'; this.emit('change'); return; }
    if (!this.connected || !this.peer || !this.peer.accept) return this.fail('Turn on reception and choose an audio device on the other computer');
    if (this.route.mode() !== 'driving' || !this.route.generation()) return;
    this.error = '';
    const s = this.tx = { id: randomUUID(), route: this.route.generation(), at: this.now(), status: 'starting' };
    this.command({ action: 'send', id: s.id, route: s.route, input: this.cfg.input });
    this.emit('change');
  }
  fail(text) { this.error = String(text).slice(0, 300); this.stop(this.error); this.emit('change'); }
  stop(reason, drain = false) {
    if (this.tx && !this.tx.ending) {
      const s = this.tx;
      this.finished.add(s.id); this.tx = null;
      if (s.offered && this.peer) this.awaitingEnd = { id: s.id, at: this.now(), localEpoch: this.epoch, peerEpoch: this.peer.epoch };
      this.send({ t: 'ptt-mic.stop', id: s.id, epoch: this.epoch, target: this.peer && this.peer.epoch, drain });
      this.command({ action: 'stop' });
    }
    const s = this.rx;
    if (s && !s.ending) {
      s.ending = true; s.status = 'ending';
      this.policy();
      this.send({ t: 'ptt-mic.stop', id: s.id, epoch: s.localEpoch, target: s.peerEpoch });
      if (drain && s.mediaReady) {
        this.command({ action: 'finish', id: s.id });
        s.flushDeadline = setTimeout(() => this.finishReceive(s), 600);
      } else this.finishReceive(s);
    }
    if (this.finished.size > 256) { this.peer = null; this.finished.clear(); this.epoch = randomUUID(); }
    this.emit('change');
  }
  finishReceive(s) {
    if (this.rx !== s) return;
    clearTimeout(s.flushDeadline);
    this.command({ action: 'stop' });
    this.rx = null; this.finished.add(s.id);
    if (this.epoch === s.localEpoch && this.peer && this.peer.epoch === s.peerEpoch)
      this.send({ t: 'ptt-mic.ended', id: s.id, epoch: s.localEpoch, target: s.peerEpoch, ready: true });
    this.policy(); this.emit('change');
  }
  receivePrepared(s) {
    if (this.rx !== s || s.ending || s.signalled || !s.mediaReady) return;
    s.signalled = true;
    this.send({ t: 'ptt-mic.ready', id: s.id, epoch: s.localEpoch, target: s.peerEpoch });
  }
  message(m) {
    if (!this.connected || !m || typeof m !== 'object' || !TYPES.includes(m.t)) return;
    if (m.t === 'ptt-mic.policy') {
      if (m.version !== 2 || !validId(m.epoch)) return;
      const first = !this.peer || this.peer.epoch !== m.epoch;
      if (first || (this.tx && m.accept !== true)) this.stop('Receiver policy changed');
      if (first) this.awaitingEnd = null;
      this.peer = { epoch: m.epoch, accept: m.accept === true, mode: m.mode === 'dictation' ? 'dictation' : 'microphone' };
      if (first) this.policy();
      this.emit('change');
      return;
    }
    if (!this.peer || m.epoch !== this.peer.epoch || m.target !== this.epoch || !validId(m.id)) return;
    if (m.t === 'ptt-mic.ended' && this.awaitingEnd && m.id === this.awaitingEnd.id) {
      this.awaitingEnd = null;
      if (m.ready !== true) { this.peer.accept = false; this.error = 'Microphone stop was not confirmed'; }
      else if (this.error === 'The previous voice session is still ending') this.error = '';
      this.emit('change'); return;
    }
    if (m.t === 'ptt-mic.offer') {
      if (!this.accepting || this.route.mode() !== 'driven' || m.route !== this.route.incoming() || !Number.isSafeInteger(m.route) || m.route <= 0 || typeof m.sdp !== 'string' || m.sdp.length > 65536) return;
      // Never replace a live round with a different offer. New rounds follow an explicit stop.
      if (this.rx || this.finished.has(m.id)) return;
      this.rx = { id: m.id, route: m.route, at: this.now(), status: 'connecting', sdp: m.sdp, mediaReady: false, localEpoch: this.epoch, peerEpoch: this.peer.epoch };
      this.command({ action: 'receive', id: m.id, sdp: m.sdp, output: this.cfg.output });
      this.emit('change');
      return;
    }
    const s = this.tx || this.rx;
    if (!s || s.id !== m.id) return;
    if (m.t === 'ptt-mic.stop') this.stop('Peer stopped', m.drain === true);
    else if (m.t === 'ptt-mic.ready' && this.tx) { this.tx.captureWanted = true; this.command({ action: 'capture', id: s.id }); }
    else if (m.t === 'ptt-mic.pulse') { s.at = this.now(); this.command({ action: 'pulse', id: s.id }); }
    else if (m.t === 'ptt-mic.answer' && this.tx && typeof m.sdp === 'string' && m.sdp.length <= 65536) this.command({ action: 'answer', id: s.id, sdp: m.sdp });
    else if (m.t === 'ptt-mic.ice' && m.candidate && typeof m.candidate.candidate === 'string' && m.candidate.candidate.length <= 4096) this.command({ action: 'ice', id: s.id, candidate: m.candidate });
  }
  tick() {
    this.routeChanged();
    if (this.awaitingEnd && this.now() - this.awaitingEnd.at > 8000) {
      this.awaitingEnd = null;
      this.error = 'Microphone stop was not confirmed';
      this.emit('change');
    }
    if (this.now() - this.lastPolicy > 3000) this.policy(); // capability discovery also works when this side starts later
    const s = this.tx || this.rx;
    if (!s) return;
    if (this.now() - s.at > 5000) return this.fail('Microphone connection timed out');
    this.send({ t: 'ptt-mic.pulse', id: s.id, epoch: this.epoch, target: this.peer && this.peer.epoch });
    this.command({ action: 'pulse', id: s.id }); // renderer stops too if the main process stalls
  }
  command(m) {
    if (m.action === 'stop' && !this.win) return;
    if (!this.win) {
      this.win = this.createWindow({
        show: false,
        webPreferences: { preload: path.join(__dirname, 'preload-microphone.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:twindesk-microphone', backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
      }, this);
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
      if (this.tx) if (!this.tx.ending) this.command({ action: 'send', ...this.tx, input: this.cfg.input });
      if (this.rx && !this.rx.ending) this.command({ action: 'receive', id: this.rx.id, sdp: this.rx.sdp, output: this.cfg.output });
      if (this.tx && this.tx.captureWanted) this.command({ action: 'capture', id: this.tx.id }); // offers are not replayed after stop
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
    if (this.rx === s && m.action === 'prepared') { s.mediaReady = true; this.receivePrepared(s); return; }
    if (this.rx === s && m.action === 'flushed' && s.ending) { this.finishReceive(s); return; }
    if (m.action === 'state') {
      s.status = String(m.status).slice(0, 40);
      if (['failed', 'disconnected', 'closed'].includes(s.status)) return this.fail('Microphone media connection ended');
      this.emit('change');
    } else if (['ptt-mic.offer', 'ptt-mic.answer', 'ptt-mic.ice'].includes(m.t)) {
      if (m.t === 'ptt-mic.offer' && this.tx === s) s.offered = true;
      const payload = m.t === 'ptt-mic.ice' ? { candidate: m.candidate } : { sdp: m.sdp };
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
    return { ...this.cfg, platform: this.platform, doubao: this.doubao, connected: this.connected, peerReady: !!(this.peer && this.peer.accept), sending: this.tx ? this.tx.status : this.awaitingEnd ? 'ending' : null, receiving: this.rx && this.rx.status, error: this.error, devices: this.devices };
  }
}
module.exports = { Microphone, TYPES };
