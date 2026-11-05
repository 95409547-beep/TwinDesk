// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const api = window.microphoneApi;
const out = document.getElementById('microphone-output');
let active = null;
function stop() {
  const s = active;
  active = null;
  out.pause(); out.srcObject = null;
  if (!s) return;
  clearInterval(s.timer); clearTimeout(s.finishTimer);
  if (s.ctx) s.ctx.close().catch(() => {});
  if (s.placeholder) for (const t of s.placeholder.getTracks()) t.stop();
  if (s.stream) for (const track of s.stream.getTracks()) track.stop();
  if (s.pc) s.pc.close();
}
function current(s) { return active === s; }
function report(s, m) { if (current(s)) api.send({ ...m, id: s.id }); }
function start(id) {
  stop();
  const s = active = { id, pending: [], local: [], signalled: false, remote: false, pulse: Date.now() };
  s.timer = setInterval(() => { if (current(s) && Date.now() - s.pulse > 5000) { report(s, { action: 'error', error: 'Microphone heartbeat stopped' }); stop(); } }, 500);
  const pc = s.pc = new RTCPeerConnection({ iceServers: [] });
  pc.onicecandidate = (e) => { if (e.candidate && current(s)) { const m = { t: 'ptt-mic.ice', candidate: e.candidate.toJSON() }; if (s.signalled) report(s, m); else if (s.local.length < 64) s.local.push(m); } };
  pc.onconnectionstatechange = () => {
    report(s, { action: 'state', status: s.sending && !s.captured && pc.connectionState === 'connected' ? 'preparing' : pc.connectionState });
    maybePrepared(s); maybeCapture(s);
  };
  return s;
}
function description(s, m) {
  report(s, m);
  s.signalled = true;
  for (const candidate of s.local.splice(0)) report(s, candidate);
}
function maybePrepared(s) {
  if (current(s) && !s.sending && !s.prepared && s.trackReady && s.pc.connectionState === 'connected') {
    s.prepared = true; report(s, { action: 'prepared' });
  }
}
async function maybeCapture(s) {
  if (!current(s) || !s.sending || !s.captureWanted || s.captureRequested || s.pc.connectionState !== 'connected') return;
  s.captureRequested = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { ...(s.input ? { deviceId: { exact: s.input } } : {}), channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    if (!current(s)) { for (const track of stream.getTracks()) track.stop(); return; }
    s.stream = stream;
    const track = stream.getAudioTracks()[0];
    track.onended = () => { report(s, { action: 'error', error: 'Microphone device disconnected' }); if (current(s)) stop(); };
    await s.sender.replaceTrack(track);
    if (!current(s)) return;
    s.captured = true;
    report(s, { action: 'state', status: 'connected' });
    await devices();
  } catch (e) { report(s, { action: 'error', error: e.message }); if (current(s)) stop(); }
}
async function receiveTrack(s, track) {
  try {
    if (!current(s)) return;
    s.stream = new MediaStream([track]);
    out.srcObject = s.stream;
    await out.play();
    if (!current(s)) return;
    s.trackReady = true; maybePrepared(s);
  } catch (e) { report(s, { action: 'error', error: e.message }); if (current(s)) stop(); }
}
async function remote(s, description) {
  await s.pc.setRemoteDescription(description);
  if (!current(s)) return;
  s.remote = true;
  for (const c of s.pending.splice(0)) await s.pc.addIceCandidate(c);
}
async function devices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  api.send({ action: 'devices', devices: all.filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput').map((d) => ({ kind: d.kind, deviceId: d.deviceId, label: d.label })) });
}
api.on(async (m) => {
  let s = active;
  try {
    if (m.action === 'stop') return stop();
    if (m.action === 'devices') return await devices();
    if (m.action === 'send') {
      s = start(m.id); s.sending = true; s.input = m.input;
      // Negotiate with a silent track. Real capture waits for receiver readiness.
      s.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      const destination = s.ctx.createMediaStreamDestination(); destination.channelCount = 1;
      const silence = s.ctx.createConstantSource(); silence.offset.value = 0; silence.connect(destination); silence.start();
      s.placeholder = destination.stream;
      s.sender = s.pc.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
      if (typeof s.sender.getParameters === 'function') {
        const parameters = s.sender.getParameters();
        parameters.encodings = parameters.encodings && parameters.encodings.length ? parameters.encodings : [{}];
        parameters.encodings[0].maxBitrate = 48000;
        try { await s.sender.setParameters(parameters); } catch {} // some Chromium versions reject an initial cap
      }
      await s.ctx.resume();
      if (!current(s)) return;
      const offer = await s.pc.createOffer();
      if (!current(s)) return;
      await s.pc.setLocalDescription(offer);
      description(s, { t: 'ptt-mic.offer', sdp: s.pc.localDescription.sdp });
      return;
    }
    if (m.action === 'receive') {
      if (!m.output || m.output === 'default' || m.output === 'communications') throw new Error('Choose an explicit virtual cable output');
      s = start(m.id);
      // Select before attaching a track. Failure never falls back to a speaker.
      await out.setSinkId(m.output);
      if (!current(s)) return;
      const sinks = await navigator.mediaDevices.enumerateDevices();
      if (!current(s)) return;
      if (!sinks.some((d) => d.kind === 'audiooutput' && d.deviceId === m.output)) throw new Error('The selected output device is unavailable');
      s.pc.ontrack = (e) => receiveTrack(s, e.track);
      await remote(s, { type: 'offer', sdp: m.sdp });
      if (!current(s)) return;
      await s.pc.setLocalDescription(await s.pc.createAnswer());
      description(s, { t: 'ptt-mic.answer', sdp: s.pc.localDescription.sdp });
      return;
    }
    if (!s || s.id !== m.id) return;
    if (m.action === 'pulse') s.pulse = Date.now();
    else if (m.action === 'capture') { s.captureWanted = true; maybeCapture(s); }
    else if (m.action === 'finish' && !s.sending && !s.finishing) {
      s.finishing = true;
      s.finishTimer = setTimeout(() => {
        if (!current(s)) return;
        report(s, { action: 'flushed' });
        stop();
      }, 150);
    }
    else if (m.action === 'answer') await remote(s, { type: 'answer', sdp: m.sdp });
    else if (m.action === 'ice') {
      if (s.remote) await s.pc.addIceCandidate(m.candidate);
      else if (s.pending.length < 64) s.pending.push(m.candidate);
      else throw new Error('Too many pending microphone ICE candidates');
    }
  } catch (e) {
    if (s && current(s)) { report(s, { action: 'error', error: e.message }); stop(); }
    else if (!s) api.send({ action: 'devices', devices: [] });
  }
});
navigator.mediaDevices.addEventListener('devicechange', async () => {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const s = active;
    const input = s && s.sending && s.stream && s.stream.getAudioTracks()[0].getSettings().deviceId;
    const output = s && !s.sending && out.sinkId;
    if (s && ((input && !all.some((d) => d.kind === 'audioinput' && d.deviceId === input)) || (output && !all.some((d) => d.kind === 'audiooutput' && d.deviceId === output)))) { report(s, { action: 'error', error: 'Selected audio device disconnected' }); stop(); }
    await devices();
  } catch {}
});
window.addEventListener('beforeunload', stop);
api.send({ action: 'ready' });
