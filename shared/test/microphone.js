// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Microphone } = require('../microphone');
const { normalize } = require('../microphone-settings');

function rig(platform = 'mac') {
  let time = 0, connected = true, mode = platform === 'mac' ? 'driving' : 'driven', route = 7;
  const callbacks = {}, wire = [], commands = [];
  const cfg = { send: platform === 'mac', receive: platform === 'win', output: 'virtual-cable' };
  const link = { connected: () => connected, os: () => platform === 'mac' ? 'win' : 'mac', transport: () => 'ip', send: (m) => wire.push(m), onConnect: (f) => callbacks.connect = f, onDisconnect: (f) => callbacks.disconnect = f, on: (t, f) => callbacks[t] = f };
  let win;
  const mic = new Microphone({ link, platform, getSettings: () => cfg, now: () => time,
    route: { mode: () => mode, generation: () => route, incoming: () => route },
    createWindow: () => {
      win = new EventEmitter(); win.webContents = new EventEmitter(); win.webContents.send = (channel, m) => commands.push(m);
      win.loadFile = async () => {}; win.destroy = () => win.emit('closed');
      return win;
    },
  });
  const peerEpoch = '11111111-1111-4111-8111-111111111111';
  const round = '22222222-2222-4222-8222-222222222222';
  const policy = (accept = true, epoch = peerEpoch) => mic.message({ t: 'mic.policy', version: 2, epoch, accept });
  const remote = (t, more = {}) => mic.message({ t, id: round, epoch: peerEpoch, target: mic.epoch, ...more });
  const windowMessage = (m) => mic.fromWindow({ sender: win.webContents }, m);
  return { mic, cfg, wire, commands, policy, remote, windowMessage, round, link, callbacks,
    ready: () => windowMessage({ action: 'ready' }),
    time: (v) => time = v, mode: (v) => mode = v, route: (v) => route = v,
    disconnect: () => { connected = false; callbacks.disconnect(); },
    reconnect: () => { connected = true; callbacks.connect(); },
  };
}
(async () => {
assert.deepEqual(normalize({ send: 'false', receive: true, input: 'x'.repeat(600), component: 'old.exe', profile: 'old.json' }), { send: false, receive: true, input: '', output: '', mode: 'microphone' });
{
 const r = rig(); r.mic.key(true);
 assert.equal(r.mic.tx, null, 'unknown peer cannot start capturing');
 r.policy(); r.mic.key(true); assert.equal(r.mic.tx, null, 'policy change does not replay a held press');
 r.mic.key(false); r.mic.key(true); assert(r.mic.tx);
 const id = r.mic.tx.id;
 r.mic.key(true); assert.equal(r.mic.tx.id, id, 'duplicate down cannot create another round');
 r.mic.key(false); r.ready();
 assert(!r.commands.some((m) => m.action === 'send'), 'late media-window ready cannot replay an early-released round');
}
{
 const r = rig(); r.policy(); r.mic.key(true); r.ready(); assert(r.commands.some((m) => m.action === 'send'));
 r.mode('home'); r.mic.routeChanged(); assert.equal(r.mic.tx, null);
 r.mode('driving'); r.mic.key(true); assert.equal(r.mic.tx, null, 'route changes require release before a new round');
 r.mic.key(false); r.mic.key(true); assert(r.mic.tx);
 r.route(8); r.mic.routeChanged(); assert.equal(r.mic.tx, null, 'same peer, new route still stops capture');
}
{
 const r = rig(); r.policy(); r.mic.key(true); r.ready();
 const id = r.mic.tx.id;
 r.disconnect(); r.reconnect(); r.policy(); r.mic.key(true); assert.equal(r.mic.tx, null, 'reconnection does not restart a held key');
 r.windowMessage({ action: 'state', id, status: 'connected' }); assert.equal(r.mic.tx, null, 'late renderer state cannot restart capture');
 r.mic.key(false); r.mic.key(true); assert(r.mic.tx);
 r.time(6000); r.mic.tick(); assert.equal(r.mic.tx, null, 'missing heartbeat stops capture');
}
{
 const r = rig('win'); r.policy(); r.remote('mic.offer', { route: 7, sdp: 'offer' }); assert(r.mic.rx);
 r.ready(); assert(r.commands.some((m) => m.action === 'receive' && m.sdp === 'offer'), 'first offer survives lazy window startup only while still active');
 r.policy(false); assert(r.mic.rx, 'a sender does not need to accept reverse-direction audio to keep sending');
 r.remote('mic.stop'); await new Promise(setImmediate); assert.equal(r.mic.rx, null);
 r.remote('mic.offer', { route: 7, sdp: 'offer' }); assert.equal(r.mic.rx, null, 'stopped offer is never replayed');
 r.remote('mic.offer', { id: '33333333-3333-4333-8333-333333333333', route: 6, sdp: 'old-route' }); assert.equal(r.mic.rx, null);
 r.remote('mic.offer', { id: '33333333-3333-4333-8333-333333333333', route: 7, target: 'old-epoch', sdp: 'old-connection' }); assert.equal(r.mic.rx, null);
 r.cfg.receive = false; r.mic.changedSettings(); r.remote('mic.offer', { route: 7, sdp: 'offer' }); assert.equal(r.mic.rx, null);
}
{
 const r = rig('win'); r.policy(); r.cfg.output = ''; r.remote('mic.offer', { route: 7, sdp: 'offer' }); assert.equal(r.mic.rx, null, 'no default-speaker fallback');
 r.cfg.output = 'virtual-cable'; r.mode('home'); r.remote('mic.offer', { route: 7, sdp: 'offer' }); assert.equal(r.mic.rx, null, 'only the currently driven Windows accepts sound');
}
{
 const r = rig(); r.policy(); r.mic.key(true); r.ready();
 r.policy(false); assert.equal(r.mic.tx, null, 'receiver revocation stops capture');
 r.mic.shutdown(); assert.equal(r.mic.win, null);
}
{
 const r = rig('win'); r.policy(); r.mic.blocked = true; r.mic.policy();
 assert.equal(r.wire.at(-1).accept, false, 'locked receivers revoke their advertised availability');
 r.remote('mic.offer', { route: 7, sdp: 'offer' }); assert.equal(r.mic.rx, null, 'locked receiver cannot accept a fresh round');
 r.mic.blocked = false; r.mic.policy(); assert.equal(r.wire.at(-1).accept, true);
}
for (const platform of ['mac', 'win']) {
 const send = rig(platform); send.cfg.send = true; send.mode('driving'); send.policy(); send.mic.key(true);
 assert(send.mic.tx, platform + ' may share its own microphone'); send.mic.key(false);
 const receive = rig(platform); receive.cfg.receive = true; receive.mode('driven'); receive.policy();
 receive.remote('mic.offer', { route: 7, sdp: 'offer' }); assert(receive.mic.rx, platform + ' may use the other computer microphone');
 receive.remote('mic.stop'); await new Promise(setImmediate); assert.equal(receive.mic.rx, null);
}
{
 const r = rig('win');
 r.cfg.mode = 'dictation';
 r.mic.setDoubaoStatus('missing');
 r.policy();
 r.remote('mic.offer', { route: 7, sdp: 'offer' });
 assert.equal(r.mic.rx, null, 'the Doubao route requires an installed input method');
 r.cfg.output = '';
 r.mic.setDoubaoStatus('installed');
 assert(!r.mic.accepting, 'installation alone does not permit routing to a default speaker');
 r.cfg.output = 'virtual-cable';
 r.remote('mic.offer', { route: 7, sdp: 'offer' });
 r.ready();
 assert(r.commands.some(m => m.action === 'receive' && m.output === 'virtual-cable'));
 r.windowMessage({ action: 'prepared', id: r.round });
 assert(r.wire.some(m => m.t === 'mic.ready'));
 r.mic.setDoubaoStatus('missing');
 assert.equal(r.mic.rx, null, 'loss of installation closes the Doubao route');
 assert(r.wire.some(m => m.t === 'mic.ended' && m.ready));
 r.cfg.mode = 'microphone';
 r.mic.changedSettings();
 assert(r.mic.accepting, 'ordinary microphone routing does not depend on Doubao');
}
{
 const r=rig();r.policy();r.mic.key(true);r.ready();const id=r.mic.tx.id;
 r.windowMessage({id,t:'mic.offer',sdp:'offer'});r.mic.key(false);
 assert(r.mic.awaitingEnd);assert.equal(r.mic.view.sending,'ending');
 r.mic.key(true);assert.equal(r.mic.tx,null,'a fresh press must wait for the receiver to confirm End');
 r.remote('mic.ended',{id,ready:false});assert.equal(r.mic.awaitingEnd,null);assert.match(r.mic.error,/not confirmed/);assert(!r.mic.peer.accept);
}
console.log('microphone: settings, fresh key edges, Doubao installation gate, media stop confirmation, cancellation, route/epoch isolation, replay rejection, timeout, revocation and output gate passed');

})().catch(error=>{console.error(error);process.exitCode=1;});
