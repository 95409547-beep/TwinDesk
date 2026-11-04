// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const { EventEmitter } = require('events');
const { Microphone, TYPES } = require('./microphone');
const { DEFAULTS, normalize } = require('./microphone-settings');
const { T } = require('./protocol');

// Each authenticated link has its own policy and epoch. Only KVM's current partner can use media.
class MeshMicrophone extends EventEmitter {
  constructor({ hub, kvm, platform, settings, store, createWindow }) {
    super();
    Object.assign(this, { hub, kvm, platform, settings, store, createWindow });
    this.routes = new Map(Object.entries(store.read('multi.json', {})?.microphoneRoutes || {}));
    this.peers = new Map();
    this.localDirections = new Map();
    this.devices = [];
    this.doubao = 'checking';
    this.held = false;
    this.keyOwner = null;
    this.blocked = false;
    for (const t of TYPES) hub.bus.on(t, (message, from) => this.peers.get(from)?.message(message));
    hub.bus.on(T.PAIR_SYNC, (message, from) => this.sync(message, from));
    hub.bus.onPeer('welcome', (id) => this.connect(id));
    hub.bus.onPeer('closed', (id) => this.disconnect(id));
    hub.bus.onPeer('transport', (id) => this.peers.get(id)?.reset());
    hub.on('selected', () => this.changed());
    for (const id of hub.bus.connectedIds()) this.connect(id);
  }
  changed() {
    if (this.pendingChange) return;
    this.pendingChange = true;
    queueMicrotask(() => {
      this.pendingChange = false;
      this.emit('change');
    });
  }
  get active() {
    if ((this.kvm.mode === 'driven' && this.kvm.sub) || (this.kvm.mode === 'driving' && this.kvm.via)) return null;
    return this.peers.get(this.kvm.partner);
  }
  get selected() { return this.peers.get(this.hub.selectedId); }
  get captureEnabled() { return !!(this.active?.connected && this.active.cfg.send && this.kvm.mode === 'driving'); }
  get cfg() {
    const routes = [...this.peers.values()].map((mic) => mic.cfg);
    return {
      send: routes.some((cfg) => cfg.send),
      receive: routes.some((cfg) => cfg.receive),
      mode: routes.some((cfg) => cfg.mode === 'dictation') ? 'dictation' : 'microphone',
    };
  }
  config(id) {
    const saved = this.settings.pairSync?.[id]?.microphone;
    const initial = { ...this.settings.microphone, send: saved?.out === true, receive: saved?.in === true };
    return normalize(this.routes.get(id) || initial);
  }
  connect(id) {
    const session = this.hub.sessions.get(id);
    if (this.peers.has(id) || !session?.connected || !['mac', 'win'].includes(session.peerOs)) return;
    const mic = new Microphone({
      platform: this.platform,
      createWindow: this.createWindow,
      getSettings: () => this.config(id),
      route: {
        mode: () => this.active === mic ? this.kvm.mode : 'home',
        generation: () => this.kvm.route,
        incoming: () => this.kvm.peerRoute,
      },
      link: {
        connected: () => session.connected, os: () => session.peerOs, transport: () => session.transport,
        send: (message) => this.hub.bus.send(id, message),
        on() {}, onConnect() {}, onDisconnect() {},
      },
    });
    mic.blocked = this.blocked;
    mic.doubao = this.doubao;
    this.peers.set(id, mic);
    let devices = mic.devices;
    mic.on('change', () => {
      if (devices !== mic.devices) this.devices = devices = mic.devices;
      this.changed();
    });
    const hosting = session.role === (this.platform === 'mac' ? 'guest' : 'host');
    if (hosting) {
      const { send, receive } = mic.cfg;
      this.hub.bus.send(id, { t: T.PAIR_SYNC, all: { microphone: { out: send, in: receive } } });
    }
    mic.policy();
    this.changed();
  }
  disconnect(id) {
    const mic = this.peers.get(id);
    if (!mic) return;
    this.peers.delete(id);
    this.localDirections.delete(id);
    if (this.keyOwner === mic) this.keyOwner = null;
    mic.shutdown();
    this.changed();
  }
  sync(message, id) {
    const directions = message.all?.microphone;
    if (directions) {
      // A host's initial snapshot may arrive after the user already changed a switch.
      const edited = this.localDirections.get(id);
      this.configure({
        send: edited?.has('send') ? undefined : directions.in,
        receive: edited?.has('receive') ? undefined : directions.out,
      }, id, false);
    } else if (message.feature === 'microphone' && ['out', 'in'].includes(message.dir)) {
      this.configure({ [message.dir === 'out' ? 'receive' : 'send']: message.on }, id, false);
    }
  }
  configure(partial, id, notify = true) {
    const mic = this.peers.get(id);
    if (!mic || !partial || typeof partial !== 'object') return;
    const prev = mic.cfg;
    const next = normalize({
      ...prev, ...partial,
      send: typeof partial.send === 'boolean' ? partial.send : prev.send,
      receive: typeof partial.receive === 'boolean' ? partial.receive : prev.receive,
    });
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      this.routes.set(id, next);
      const stored = this.store.read('multi.json', {});
      this.store.write('multi.json', { ...stored, microphoneRoutes: Object.fromEntries(this.routes) });
      mic.changedSettings();
    }
    if (!notify) return;
    for (const [key, dir] of [['send', 'out'], ['receive', 'in']]) {
      if (typeof partial[key] !== 'boolean') continue;
      if (!this.localDirections.has(id)) this.localDirections.set(id, new Set());
      this.localDirections.get(id).add(key);
      this.hub.bus.send(id, { t: T.PAIR_SYNC, feature: 'microphone', dir, on: next[key] });
    }
  }
  key(down) {
    if (!down) {
      this.held = false;
      this.keyOwner?.key(false);
      this.keyOwner = null;
    } else if (!this.held) {
      this.held = true;
      this.keyOwner = this.active;
      this.keyOwner?.key(true);
    }
  }
  fromWindow(event, message) {
    for (const mic of this.peers.values()) mic.fromWindow(event, message);
  }
  command(message) { (this.selected || this.active)?.command(message); }
  policy() {
    for (const mic of this.peers.values()) {
      mic.blocked = this.blocked;
      mic.policy();
    }
  }
  setDoubaoStatus(status) {
    this.doubao = status;
    for (const mic of this.peers.values()) mic.setDoubaoStatus(status);
  }
  routeChanged() { for (const mic of this.peers.values()) mic.routeChanged(); }
  tick() { for (const mic of this.peers.values()) mic.tick(); }
  fail(error) { this.active?.fail(error); }
  stop(reason) {
    for (const mic of this.peers.values()) mic.stop(reason);
    if (!this.held && this.keyOwner) {
      this.keyOwner.held = false;
      this.keyOwner = null;
    }
  }
  shutdown() { for (const id of this.peers.keys()) this.disconnect(id); }
  get view() {
    const mic = this.selected;
    if (!mic) return { ...DEFAULTS, platform: this.platform, mesh: true, peerId: null, devices: this.devices };
    return { ...mic.view, mesh: true, peerId: this.hub.selectedId, devices: this.devices };
  }
}
module.exports = { MeshMicrophone };
