// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MeshMicrophone } = require('../microphone-mesh');
const { T } = require('../protocol');

const devices = new Map([['mac', 'mac'], ['win-a', 'win'], ['win-b', 'win']]);
const nodes = new Map();
const wire = [];
const flush = () => new Promise(setImmediate);

function computer(id) {
  const handlers = new EventEmitter();
  const life = new EventEmitter();
  const hub = new EventEmitter();
  hub.sessions = new Map([...devices].filter(([peer]) => peer !== id).map(([peer, os]) =>
    [peer, { connected: true, peerOs: os, transport: 'ip' }]));
  hub.bus = {
    on: handlers.on.bind(handlers),
    onPeer: life.on.bind(life),
    connectedIds: () => [...hub.sessions.keys()],
    send(peer, message) {
      wire.push({ from: id, to: peer, message });
      queueMicrotask(() => nodes.get(peer)?.handlers.emit(message.t, message, id));
    },
  };
  const data = {};
  const store = { read: (name, fallback) => data[name] || fallback, write: (name, value) => { data[name] = value; } };
  const kvm = { mode: 'home', partner: null, route: 0, peerRoute: 0 };
  const mic = new MeshMicrophone({
    hub, kvm, platform: devices.get(id), settings: {}, store,
    createWindow: () => {
      const w = new EventEmitter();
      w.webContents = new EventEmitter();
      w.webContents.send = () => {};
      w.loadFile = async () => {};
      w.destroy = () => w.emit('closed');
      return w;
    },
  });
  const node = { id, handlers, life, hub, kvm, mic, data };
  nodes.set(id, node);
  return node;
}

function drive(source, target) {
  Object.assign(source.kvm, { mode: 'driving', partner: target.id, route: source.kvm.route + 1 });
  Object.assign(target.kvm, { mode: 'driven', partner: source.id, peerRoute: source.kvm.route });
  source.mic.routeChanged();
  target.mic.routeChanged();
}

function offer(source, target) {
  const mic = source.mic.peers.get(target.id);
  const event = { sender: mic.win.webContents };
  mic.fromWindow(event, { action: 'ready' });
  mic.fromWindow(event, { t: 'ptt-mic.offer', id: mic.tx.id, sdp: 'test-offer' });
}

(async () => {
  const mac = computer('mac'), a = computer('win-a'), b = computer('win-b');
  mac.hub.selectedId = a.id;
  mac.mic.configure({ send: true }, a.id);
  mac.mic.configure({ send: true }, b.id);
  a.hub.bus.send(mac.id, { t: T.PAIR_SYNC, all: { microphone: { in: false, out: true } } });
  a.mic.configure({ output: 'cable-a' }, mac.id);
  b.mic.configure({ output: 'cable-b' }, mac.id);
  await flush();
  assert.equal(a.mic.peers.get(mac.id).cfg.receive, true);
  assert.equal(mac.mic.peers.get(a.id).cfg.send, true, 'a late snapshot cannot undo a local switch');
  assert.equal(mac.mic.peers.get(a.id).cfg.receive, true, 'an untouched direction still follows the host');
  assert.equal(b.mic.peers.get(mac.id).cfg.receive, true);
  assert.equal(a.mic.peers.get(b.id).cfg.receive, false);
  assert.equal(mac.data['multi.json'].microphoneRoutes[b.id].send, true);
  assert.equal(mac.mic.view.peerId, a.id);

  drive(mac, b);
  mac.mic.key(true);
  assert.equal(mac.mic.peers.get(a.id).tx, null, 'sidebar selection cannot choose a live destination');
  offer(mac, b);
  await flush();
  assert(b.mic.peers.get(mac.id).rx);
  assert.equal(a.mic.peers.get(mac.id).rx, null);

  // Even with the right generation and the target's epoch, a device without KVM ownership is rejected.
  const aToB = a.mic.peers.get(b.id);
  b.mic.configure({ receive: true, output: 'cable-b' }, a.id);
  a.hub.bus.send(b.id, {
    t: 'ptt-mic.offer', id: '11111111-1111-4111-8111-111111111111', epoch: aToB.epoch,
    target: b.mic.peers.get(a.id).epoch, route: b.kvm.peerRoute, sdp: 'wrong-owner',
  });
  await flush();
  assert.equal(b.mic.peers.get(a.id).rx, null);

  drive(mac, a);
  await flush();
  assert.equal(b.mic.peers.get(mac.id).rx, null);
  mac.mic.key(true);
  assert.equal(mac.mic.peers.get(a.id).tx, null, 'holding F8 across computers does not start a new round');
  mac.mic.key(false);
  mac.mic.key(true);
  offer(mac, a);
  await flush();
  assert(a.mic.peers.get(mac.id).rx);
  mac.mic.key(false);
  await flush();
  assert.equal(a.mic.peers.get(mac.id).rx, null);

  drive(a, b);
  a.mic.key(true);
  offer(a, b);
  await flush();
  assert(b.mic.peers.get(a.id).rx, 'Windows can forward to another Windows computer');
  a.hub.sessions.get(b.id).connected = false;
  b.hub.sessions.get(a.id).connected = false;
  a.life.emit('closed', b.id);
  b.life.emit('closed', a.id);
  assert(!a.mic.peers.has(b.id) && !b.mic.peers.has(a.id));
  assert.equal(wire.filter(({ from, to, message }) => from === mac.id && to === a.id && message.t === T.PAIR_SYNC).length, 1);
  for (const node of nodes.values()) node.mic.shutdown();
  console.log('mesh microphone: per-pair settings, Win-to-Win, KVM ownership, peer handover and F8 release passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
