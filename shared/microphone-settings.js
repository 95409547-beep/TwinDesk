// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const DEFAULTS = Object.freeze({ send: false, receive: false, input: '', output: '', mode: 'microphone' });
function normalize(value) {
  const v = value && typeof value === 'object' ? value : {};
  const device = (id) => typeof id === 'string' && id.length <= 512 ? id : '';
  return { mode: v.mode === 'dictation' ? 'dictation' : 'microphone', send: v.send === true, receive: v.receive === true, input: device(v.input), output: ['default', 'communications'].includes(v.output) ? '' : device(v.output) };
}
module.exports = { DEFAULTS, normalize };
