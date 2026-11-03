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
  clearInterval(s.timer);
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
  pc.onicecandidate = (e) => { if (e.candidate && current(s)) { const m = { t: 'mic.ice', candidate: e.candidate.toJSON() }; if (s.signalled) report(s, m); else if (s.local.length < 64) s.local.push(m); } };
  pc.onconnectionstatechange = () => report(s, { action: 'state', status: pc.connectionState });
  return s;
}
function description(s, m) {
  report(s, m);
  s.signalled = true;
  for (const candidate of s.local.splice(0)) report(s, candidate);
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
      s = start(m.id);
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { ...(m.input ? { deviceId: { exact: m.input } } : {}), channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
      // The OS permission prompt can outlive a release, disconnect or new round.
      if (!current(s)) { for (const t of stream.getTracks()) t.stop(); return; }
      s.stream = stream;
      for (const track of stream.getAudioTracks()) {
        track.onended = () => { report(s, { action: 'error', error: 'Microphone device disconnected' }); if (current(s)) stop(); };
        const sender = s.pc.addTrack(track, stream);
        const p = sender.getParameters();
        if (p.encodings && p.encodings.length) { p.encodings[0].maxBitrate = 48000; await sender.setParameters(p); }
      }
      const offer = await s.pc.createOffer();
      if (!current(s)) return;
      await s.pc.setLocalDescription(offer);
      description(s, { t: 'mic.offer', sdp: s.pc.localDescription.sdp });
      await devices();
      return;
    }
    if (m.action === 'receive') {
      if (!m.output || m.output === 'default' || m.output === 'communications') throw new Error('Choose an explicit virtual cable output');
      s = start(m.id);
      // Select before attaching any track. Failure never falls back to a speaker.
      await out.setSinkId(m.output);
      if (!current(s)) return;
      const sinks = await navigator.mediaDevices.enumerateDevices();
      if (!current(s)) return;
      if (!sinks.some((d) => d.kind === 'audiooutput' && d.deviceId === m.output)) throw new Error('The selected output device is unavailable');
      s.pc.ontrack = (e) => {
        if (!current(s)) return;
        out.srcObject = new MediaStream([e.track]);
        out.play().catch((e) => { report(s, { action: 'error', error: e.message }); if (current(s)) stop(); });
      };
      await remote(s, { type: 'offer', sdp: m.sdp });
      if (!current(s)) return;
      await s.pc.setLocalDescription(await s.pc.createAnswer());
      description(s, { t: 'mic.answer', sdp: s.pc.localDescription.sdp });
      return;
    }
    if (!s || s.id !== m.id) return;
    if (m.action === 'pulse') s.pulse = Date.now();
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
    const input = s && s.stream && s.stream.getAudioTracks()[0].getSettings().deviceId;
    const output = s && !s.stream && out.sinkId;
    if (s && ((input && !all.some((d) => d.kind === 'audioinput' && d.deviceId === input)) || (output && !all.some((d) => d.kind === 'audiooutput' && d.deviceId === output)))) { report(s, { action: 'error', error: 'Selected audio device disconnected' }); stop(); }
    await devices();
  } catch {}
});
window.addEventListener('beforeunload', stop);
api.send({ action: 'ready' });
