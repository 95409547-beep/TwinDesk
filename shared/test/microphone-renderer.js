// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../microphone-rtc.js'), 'utf8');
function harness() {
 let handler, resolveCapture, rejectSink = false;
 const sent = [], tracks = [], pcs = [], timers = new Set();
 const out = { srcObject: null, plays: 0, pause() {}, async play() { this.plays++; }, async setSinkId(id) { if (rejectSink) throw new Error('No device'); this.sinkId = id; } };
 class PC {
  constructor() { this.closed = false; pcs.push(this); }
  close() { this.closed = true; }
  addTrack() { return { getParameters: () => ({ encodings: [{}] }), async setParameters() {} }; }
  async createOffer() { return { type: 'offer', sdp: 'offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
  async setLocalDescription(d) { this.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'candidate' }) } }); this.localDescription = d; }
  async setRemoteDescription() {}
  async addIceCandidate() {}
 }
 const ctx = vm.createContext({ window: { microphoneApi: { on: (f) => handler = f, send: (m) => sent.push(m) }, addEventListener() {} },
 document: { getElementById: () => out }, Date, RTCPeerConnection: PC, MediaStream: function(t) { this.tracks = t; },
 navigator: { mediaDevices: { addEventListener() {}, enumerateDevices: async () => [{ kind: 'audiooutput', deviceId: 'virtual-cable' }], getUserMedia: () => new Promise((r) => resolveCapture = r) } },
 setInterval: (f) => { timers.add(f); return f; }, clearInterval: (f) => timers.delete(f),
 });
 vm.runInContext(source, ctx);
 return { sent, pcs, out, handler, timers,
 capture: () => { const t = { stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ deviceId: 'input' }) }; tracks.push(t); resolveCapture({ getTracks: () => [t], getAudioTracks: () => [t] }); return t; },
 rejectSink: () => rejectSink = true,
 };
}
(async () => {
 {
  const h = harness(); const begin = h.handler({ action: 'send', id: 'one' });
  await h.handler({ action: 'stop' }); const t = h.capture(); await begin;
  assert(t.stopped, 'late microphone permission result must stop every returned track');
  assert(!h.sent.some((m) => m.t === 'mic.offer')); assert.equal(h.timers.size, 0);
 }
 {
  const h = harness(); const begin = h.handler({ action: 'send', id: 'one' });
  const t = h.capture(); await begin;
  const messages = h.sent.filter((m) => m.t);
  assert.deepEqual(messages.map((m) => m.t), ['mic.offer', 'mic.ice'], 'SDP must precede its ICE candidates');
  await h.handler({ action: 'stop' }); assert(t.stopped); assert(h.pcs[0].closed);
 }
 {
  const h = harness(); h.rejectSink(); await h.handler({ action: 'receive', id: 'one', output: 'virtual-cable', sdp: 'offer' });
  assert.equal(h.out.plays, 0); assert.equal(h.out.srcObject, null); assert(h.pcs[0].closed, 'output selection failure closes WebRTC');
  assert(h.sent.some((m) => m.action === 'error'));
 }
 {
  const h = harness(); await h.handler({ action: 'receive', id: 'one', output: 'default', sdp: 'offer' });
  assert.equal(h.pcs.length, 0, 'a default speaker cannot be used as the microphone destination');
 }
 console.log('microphone-renderer: late capture cancellation, track cleanup, SDP/ICE order and output failure without speaker fallback passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
