// TwinDesk microphone fork. GPL-3.0, see LICENSE.
// Use each platform's Audio-page components: header master, named routes, two direction switches.
'use strict';
(() => {
  const tr = (s) => window.I18n ? window.I18n.t(s) : s;
  const configure = (settings) => UI.api.microphone({ do: 'settings', settings, peerId: UI.state?.microphone?.peerId });
  UI.tab({
    id: 'microphone', icon: 'microphone', title: tr('Microphone'), group: 'More', order: 72,
    color: 'linear-gradient(#43b98f, #147d67)',
    desc: tr('Use one computer’s microphone on the other.'),
    wifiOnly: true,
    hidden: (s) => !!s.microphone?.mesh && !s.microphone.peerId,
    master: {
      get: (s) => !!(s.microphone && (s.microphone.send || s.microphone.receive)),
      set: (v) => configure({ send: v, receive: v }),
    },
    badge: (s) => s.microphone && (s.microphone.send || s.microphone.receive) ? 'on' : '',
    build(body) {
      const source = UI.select([{ value: '', label: tr('Default microphone') }], (input) => configure({ input }));
      const output = UI.select([{ value: '', label: tr('Choose a virtual audio device') }], (output) => configure({ output }));
      const sourceRow = UI.row(tr('Microphone source'), tr('Which of {me}’s microphones to share'), [source]);
      const purpose = UI.select([], (mode) => configure({ mode }));
      purpose.el.setAttribute('aria-label', tr('Use for'));
      const purposeRow = UI.row(tr('Use for'), '', [purpose]);
      const download = UI.button(tr('Official download'), () => UI.api.microphone({ do: 'downloadDoubao' }));
      const doubaoRow = UI.row(tr('Doubao Input Method'), '', [download]);
      const outputRow = UI.row(tr('Receive through'), tr('In the app, choose the recording side of this virtual audio device.'), [output]);
      const sendLabel = tr('Use {me}’s microphone on {name}');
      const receiveLabel = tr('Use {name}’s microphone on {me}');
      let sendRow, receiveRow, updateDirections;
      if (UI.dirCards) {
        // Windows Audio uses dirCards: incoming first, outgoing second.
        const pair = UI.dirCards(
          { on: { get: (s) => !!s.microphone.receive, set: (receive) => configure({ receive }) }, label: receiveLabel, rows: [purposeRow, doubaoRow, outputRow] },
          { on: { get: (s) => !!s.microphone.send, set: (send) => configure({ send }) }, label: sendLabel, rows: [sourceRow] },
        );
        receiveRow = pair.a.main;
        sendRow = pair.b.main;
        updateDirections = pair.update;
        body.append(pair.el);
      } else {
        // Mac Audio uses pair + dir and a native switch in each direction's first row.
        const sendSwitch = UI.switch((send) => configure({ send }), { label: sendLabel });
        const receiveSwitch = UI.switch((receive) => configure({ receive }), { label: receiveLabel });
        sendRow = UI.row(sendLabel, '', [sendSwitch], { literalHint: true });
        receiveRow = UI.row(receiveLabel, '', [receiveSwitch], { literalHint: true });
        body.append(UI.pair(UI.dir('m2w', [sendRow, sourceRow]), UI.dir('w2m', [receiveRow, outputRow])));
        updateDirections = (s) => { sendSwitch.set(s.microphone.send); receiveSwitch.set(s.microphone.receive); };
      }
      const refresh = UI.button(tr('Refresh audio devices'), () => UI.api.microphone({ do: 'devices' }));
      const stop = UI.button(tr('Stop'), () => UI.api.microphone({ do: 'stop' }), 'danger');
      body.append(UI.card(tr('Audio devices'), [UI.row(tr('Audio devices'), tr('Refreshing lists devices; it does not start recording.'), [refresh, stop])]));
      const note = UI.note('info', '');
      const error = UI.note('bad', '');
      body.append(note, error);
      return (s) => {
        const m = s.microphone;
        if (!m) return;
        note.set(tr(m.mesh
          ? 'Set microphone directions for the computer selected in the sidebar. Hold F8 to send to the computer you are controlling.'
          : 'Move the pointer to the other computer and hold F8 to speak through its selected microphone route. Release F8 to stop.'));
        updateDirections(s);
        sendRow.querySelector('input').setAttribute('aria-label', UI.fill(sendLabel));
        receiveRow.querySelector('input').setAttribute('aria-label', UI.fill(receiveLabel));
        const dictation = m.platform === 'win' && m.mode === 'dictation';
        const doubaoStatus = { installed: 'Installed', missing: 'Not installed', unavailable: 'Could not check installation', checking: 'Checking installation…' };
        purpose.options([{ value: 'microphone', label: tr('Other apps (calls and recording)') }, { value: 'dictation', label: tr('Doubao voice input') }]);
        purpose.set(m.mode || 'microphone'); purpose.el.disabled = !m.receive;
        doubaoRow.hidden = !dictation;
        doubaoRow.setHint(tr(doubaoStatus[m.doubao] || doubaoStatus.checking));
        outputRow.setHint(tr(dictation ? 'Use the recording side of this virtual audio device as the Windows input for Doubao.' : 'In the app, choose the recording side of this virtual audio device.'));
        const devices = m.devices || [];
        source.options([{ value: '', label: tr('Default microphone') }, ...devices.filter((d) => d.kind === 'audioinput' && !['default', 'communications'].includes(d.deviceId)).map((d, i) => ({ value: d.deviceId, label: d.label || tr('Microphone') + ' ' + (i + 1) }))]);
        output.options([{ value: '', label: tr('Choose a virtual audio device') }, ...devices.filter((d) => d.kind === 'audiooutput' && !['default', 'communications'].includes(d.deviceId)).map((d, i) => ({ value: d.deviceId, label: d.label || tr('Audio device') + ' ' + (i + 1) }))]);
        source.set(m.input); output.set(m.output);
        source.el.disabled = !m.send;
        output.el.disabled = !m.receive;
        refresh.disabled = !(m.send || m.receive);
        stop.disabled = !(m.sending || m.receiving);
        sendRow.setHint(!m.send ? '' : !m.connected ? tr('Not connected') : m.sending === 'ending' ? tr('Finishing microphone transfer…') : !m.peerReady ? tr('Turn on reception and choose an audio device on the other computer') : m.sending ? tr(m.sending === 'connected' ? 'Sending microphone audio' : 'Connecting microphone…') : tr('Ready — hold F8 while using the other computer'));
        receiveRow.setHint(!m.receive || (dictation && m.doubao !== 'installed') ? '' : !m.output ? tr('Choose a virtual audio device') : !m.connected ? tr('Not connected') : m.receiving ? tr(m.receiving === 'ending' ? 'Finishing microphone transfer…' : m.receiving === 'connected' ? 'Receiving microphone audio' : 'Connecting microphone…') : tr('Waiting for the other computer’s microphone'));
        error.set(m.error ? tr(m.error) : '');
      };
    },
  });
})();
