// TwinDesk microphone fork. GPL-3.0, see LICENSE.
// Owns one explicitly selected external input component over private child pipes, never TCP.
'use strict';
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
class InputMethodAdapter extends EventEmitter {
  constructor({ spawnProcess = spawn, deadline = 6000, allowFixture = false } = {}) {
    super(); Object.assign(this, { spawnProcess, deadline, allowFixture });
    this.proc = null; this.epoch = ''; this.sequence = 0n; this.active = null;
    this.health = false; this.status = 'off'; this.error = ''; this.buffer = Buffer.alloc(0); this.generation = 0;
    this.args = ''; this.heartbeat = null;
  }
  get ready() { return !!(this.proc && this.health && this.status !== 'closing'); }
  changed() { this.emit('change'); }
  async configure(program, profile) {
    const args = program && profile ? JSON.stringify([program, profile]) : '';
    if (args === this.args && this.proc) return;
    const generation = ++this.generation;
    this.args = args;
    await this.close();
    if (generation !== this.generation || !args) return;
    if (!path.isAbsolute(program) || !path.isAbsolute(profile)) { this.fail('Input method component and configuration must use absolute paths'); return; }
    this.status = 'starting'; this.error = ''; this.health = false; this.epoch = ''; this.sequence = 0n; this.buffer = Buffer.alloc(0);
    let child;
    try { child = this.spawnProcess(program, ['--serve-stdio', profile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false }); }
    catch { this.fail('Cannot start the input method component'); return; }
    this.proc = child; this.changed();
    const hello = setTimeout(() => { if (this.proc === child && !this.epoch) this.fail('Input method component did not become ready'); }, this.deadline);
    this.helloTimer = hello;
    child.stdout.on('data', (chunk) => {
      if (this.proc !== child) return;
      try {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length > 131080) throw new Error('oversize');
        while (this.buffer.length >= 4) {
          const length = this.buffer.readUInt32BE(0);
          if (!length || length > 65536) throw new Error('invalid frame');
          if (this.buffer.length < length + 4) break;
          const m = JSON.parse(this.buffer.subarray(4, length + 4).toString('utf8'));
          this.buffer = this.buffer.subarray(length + 4);
          this.message(m);
        }
      } catch { this.fail('Invalid reply from the input method component'); }
    });
    // Drain stderr without recording configuration paths or native runtime details.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => { if (this.proc === child) this.fail('Input method component pipe closed'); });
    const gone = () => {
      clearTimeout(hello);
      if (this.proc !== child) return;
      this.proc = null; clearInterval(this.heartbeat); this.heartbeat = null;
      this.health = false;
      if (this.status !== 'closing') { this.status = 'failed'; if (!this.error) this.error = 'Input method component stopped'; }
      else this.status = 'off';
      const wasActive = !!this.active;
      this.rejectActive('Input method component stopped');
      if (wasActive) this.emit('failure', 'Input method component stopped');
      this.changed();
    };
    child.on('error', gone); child.on('close', gone);
    this.heartbeat = setInterval(() => { if (this.proc === child && this.epoch) this.write({ type: 'ping', epoch: this.epoch }); }, 2000);
  }
  write(m, audio = false) {
    if (!this.proc || this.proc.stdin.destroyed || this.proc.stdin.writableEnded) return false;
    const body = Buffer.from(JSON.stringify(m));
    if (body.length > 65536 || (audio && this.proc.stdin.writableLength + body.length + 4 > 32768)) return false;
    const frame = Buffer.alloc(body.length + 4); frame.writeUInt32BE(body.length); body.copy(frame, 4);
    this.proc.stdin.write(frame); return true;
  }
  message(m) {
    if (!m || typeof m !== 'object') return this.fail('Invalid reply from the input method component');
    if (!this.epoch) {
      if ((m.fixture === true && !this.allowFixture) || m.type !== 'hello' || m.protocol !== 2 || m.transport !== 'stdio' || !uuid(m.epoch) || m.sample_rate !== 48000 || m.channels !== 1 || m.format !== 's16le') return this.fail('The input method component needs an update');
      clearTimeout(this.helloTimer);
      this.epoch = m.epoch; this.health = m.ready === true;
      this.status = this.health ? 'ready' : 'failed'; this.error = this.health ? '' : 'Input method preflight failed'; this.changed(); return;
    }
    if (m.epoch !== this.epoch) return this.fail('Input method connection identity changed');
    if (m.type === 'pong') return;
    const s = this.active;
    if (m.type === 'error') {
      if (s && m.session && m.session !== s.id && m.ready === true) return;
      this.health = m.ready === true;
      if (s && m.session === s.id) this.rejectActive('Input method rejected this voice session');
      this.error = 'Input method rejected this voice session'; this.status = this.health ? 'ready' : 'failed'; this.changed(); return;
    }
    if (!s || m.session !== s.id) return;
    if (m.type === 'started') {
      if (s.ending) return; // cancel is already queued; a late start cannot re-open microphone capture
      clearTimeout(s.beginTimer); s.started = true; this.status = 'speaking'; this.error = ''; s.resolveBegin(); this.changed();
    } else if (m.type === 'ended') {
      this.active = null; this.health = m.ready === true; this.status = this.health ? 'ready' : 'failed';
      clearTimeout(s.beginTimer); clearTimeout(s.endTimer);
      if (!s.started) s.rejectBegin(new Error('Input method ended before starting'));
      if (s.resolveEnd) { if (this.health) s.resolveEnd(m); else s.rejectEnd(new Error('Input method stop was not confirmed')); }
      this.emit('ended', s.id, m.reason, this.health); this.changed();
    }
  }
  begin(id, generation) {
    if (!this.ready || this.active || !uuid(id)) return Promise.reject(new Error('Input method is not ready'));
    return new Promise((resolve, reject) => {
      const s = this.active = { id, started: false, ending: false, resolveBegin: resolve, rejectBegin: reject };
      this.status = 'preparing'; this.error = ''; this.changed();
      s.beginTimer = setTimeout(() => { if (this.active === s) { reject(new Error('Input method start timed out')); this.end(id, false).catch(() => {}); } }, this.deadline);
      if (!this.write({ type: 'begin', epoch: this.epoch, session: id, sequence: String(++this.sequence), generation: String(generation) })) this.fail('Input method component pipe closed');
    });
  }
  audio(id, bytes) {
    const s = this.active;
    if (!s || s.id !== id || !s.started || s.ending) return;
    const pcm = Buffer.from(bytes);
    if (!pcm.length || pcm.length > 19200 || pcm.length % 2) return this.fail('Invalid input method audio frame');
    if (!this.write({ type: 'audio', epoch: this.epoch, session: id, pcm: pcm.toString('base64') }, true)) this.fail('Input method audio queue is full');
  }
  end(id, drain) {
    const s = this.active;
    if (!s || s.id !== id) return this.health ? Promise.resolve() : Promise.reject(new Error('Input method stop was not confirmed'));
    if (s.endPromise) return s.endPromise;
    s.ending = true; clearTimeout(s.beginTimer);
    if (!s.started) s.rejectBegin(new Error('Input method start was cancelled'));
    this.status = 'ending'; this.changed();
    s.endPromise = new Promise((resolve, reject) => {
      s.resolveEnd = resolve; s.rejectEnd = reject;
      s.endTimer = setTimeout(() => { if (this.active === s) this.fail('Input method stop was not confirmed'); }, this.deadline);
      if (!this.write({ type: drain ? 'end' : 'cancel', epoch: this.epoch, session: id })) this.fail('Input method component pipe closed');
    });
    return s.endPromise;
  }
  rejectActive(message) {
    const s = this.active; if (!s) return;
    this.active = null; clearTimeout(s.beginTimer); clearTimeout(s.endTimer);
    s.rejectBegin(new Error(message)); if (s.rejectEnd) s.rejectEnd(new Error(message));
  }
  fail(message) {
    this.health = false; this.status = 'failed'; this.error = message; this.rejectActive(message);
    // EOF asks the owned child to cancel/confirm its capture. No process kill or speculative native retry.
    if (this.proc && !this.proc.stdin.writableEnded) this.proc.stdin.end();
    this.emit('failure', message); this.changed();
  }
  async close() {
    clearTimeout(this.helloTimer);
    const child = this.proc; if (!child) return;
    this.status = 'closing'; this.changed();
    if (this.active) { try { await this.end(this.active.id, false); } catch {} }
    if (this.proc !== child) return;
    clearInterval(this.heartbeat); this.heartbeat = null;
    this.health = false; this.proc = null;
    if (!child.stdin.writableEnded) child.stdin.end();
    this.status = 'off'; this.changed();
  }
  get view() { return { ready: this.ready, status: this.status, error: this.error }; }
}
module.exports = { InputMethodAdapter };
