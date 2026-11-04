// TwinDesk microphone fork. GPL-3.0, see LICENSE.
// Run using Electron. Synthetic microphone; output is stubbed before a track is attached.
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { Microphone } = require('../microphone');
const dictation = process.env.TWINDESK_MIC_SMOKE_DICTATION === '1';
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'twindesk-mic-smoke-profile-')));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, why, timeout = 12000) { const at = Date.now(); while (!await fn()) { if (Date.now() - at > timeout) throw new Error(why); await wait(40); } }
let sender, receiver;
const reverse = process.env.TWINDESK_MIC_SMOKE_REVERSE === '1';
const senderPlatform = reverse ? 'win' : 'mac';
const wire = [];
function make(platform) {
 const callbacks = new Map();
 const mic = new Microphone({ platform,
  getSettings: () => ({ send: platform === senderPlatform, receive: platform !== senderPlatform, input: '', output: 'virtual-cable', mode: dictation && platform !== senderPlatform ? 'dictation' : 'microphone' }),
  route: { mode: () => platform === senderPlatform ? 'driving' : 'driven', generation: () => 7, incoming: () => 7 },
  link: { connected: () => true, os: () => platform === 'mac' ? 'win' : 'mac', transport: () => 'ip', onConnect() {}, onDisconnect() {}, on: (t, fn) => callbacks.set(t, fn), send: (m) => { wire.push(m); setImmediate(() => { const peer = platform === senderPlatform ? receiver : sender; if (peer) peer.message(m); }); } },
  createWindow: (options) => new BrowserWindow({ ...options, webPreferences: { ...options.webPreferences, partition: platform + '-synthetic-smoke' } }),
 });
 return mic;
}
ipcMain.on('microphone:media', (e, m) => { if (sender) sender.fromWindow(e, m); if (receiver) receiver.fromWindow(e, m); });
app.whenReady().then(async () => {
 try {
  assert(!(dictation && reverse), 'the Doubao receiver is Windows only');
  sender = make(senderPlatform); receiver = make(reverse ? 'mac' : 'win');
  if (dictation) receiver.setDoubaoStatus('installed');
  sender.command({ action: 'devices' }); receiver.command({ action: 'devices' });
  await until(() => sender.windowReady && receiver.windowReady, 'media preload failed');
  await receiver.win.webContents.executeJavaScript(`
    HTMLMediaElement.prototype.setSinkId = async function(id) { this.__testSink = id; };
    HTMLMediaElement.prototype.play = async function() {};
    navigator.mediaDevices.enumerateDevices = async () => [{kind:'audiooutput',deviceId:'virtual-cable',label:'Synthetic cable'}];
    void 0;
  `);
  await sender.win.webContents.executeJavaScript(`window.qaCaptureCalls=0;const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=(...args)=>{window.qaCaptureCalls++;return original(...args);};void 0;`);
  sender.policy(); receiver.policy();
  await until(() => sender.peer && sender.peer.accept && receiver.peer, 'capability handshake failed');
  sender.key(true);
  const timer = setInterval(() => { sender.tick(); receiver.tick(); }, 500);
  try {
    await until(() => sender.tx && sender.tx.status === 'connected' && receiver.rx && receiver.rx.status === 'connected', 'synthetic WebRTC did not connect: ' + sender.error + receiver.error);
    await wait(3500); // capability refresh must not stop a one-way microphone session
    assert(sender.tx && receiver.rx, 'one-way session stopped: '+JSON.stringify({sender:sender.error,receiver:receiver.error}));
    let received = 0, energy = 0;
    await until(async () => {
      const stats = await receiver.win.webContents.executeJavaScript(`(async () => { const stats = Array.from((await active.pc.getStats()).values()).filter(x=>x.type==='inbound-rtp' && x.kind==='audio'); return { bytes:stats.reduce((n,x)=>n+(x.bytesReceived||0),0), energy:stats.reduce((n,x)=>n+(x.totalAudioEnergy||0),0) }; })()`);
      received = stats.bytes; energy = stats.energy;
      return received > 1024 && energy > 0;
    }, 'no synthetic RTP/decoded audio received');
    const capture = await sender.win.webContents.executeJavaScript('window.qaCaptureCalls');
    assert.equal(capture,1);
    const codecs = await sender.win.webContents.executeJavaScript(`(async()=>Array.from((await active.pc.getStats()).values()).filter(x=>x.type==='codec').map(x=>x.mimeType))()`);
    assert(codecs.some((c) => /opus/i.test(c)), 'Opus must be available on the negotiated audio session');
    sender.key(false);
    await until(() => !sender.tx && !sender.awaitingEnd && !receiver.rx, 'release did not confirm the end on both controllers');
    await until(async () => await sender.win.webContents.executeJavaScript('active === null') && await receiver.win.webContents.executeJavaScript('active === null'), 'release left renderer media running');
    receiver.message(wire.find((m) => m.t === 'mic.offer'));
    assert.equal(receiver.rx, null, 'late offer restarted receiver');
    const result = { ok: true, direction: reverse ? 'win-to-mac' : 'mac-to-win', electron: process.versions.electron, syntheticAudio: true, realMicrophoneOpened: false, virtualCableStubbed: true, receivedRtpBytes: received, decodedAudioEnergy: energy, opus: true, bothStoppedOnRelease: true, lateOfferRejected: true, dictation };
    console.log(JSON.stringify(result));
    if (process.env.TWINDESK_MIC_SMOKE_RESULT) fs.writeFileSync(process.env.TWINDESK_MIC_SMOKE_RESULT, JSON.stringify(result, null, 2));
  } finally { clearInterval(timer); }
  sender.shutdown(); receiver.shutdown(); app.quit();
 } catch (e) {
  console.error(e);
  if (sender) sender.shutdown();
  if (receiver) receiver.shutdown();
  app.exit(1);
 }
});
