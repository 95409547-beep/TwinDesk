// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
(() => {
  const tr = (s) => window.I18n ? window.I18n.t(s) : s;
  UI.tab({
    id: 'microphone', icon: 'microphone', title: tr('Microphone'), group: 'More', order: 72,
    color: 'linear-gradient(#43b98f, #147d67)',
    desc: tr('Use the Mac microphone on Windows while holding F8.'),
    badge: (s) => s.microphone && (s.microphone.sending || s.microphone.receiving) ? 'on' : '',
    build(body) {
      const api = UI.api;
      const action = (m) => api.microphone(m);
      const enabled = UI.switch((v) => action({ do: 'settings', settings: UI.state.microphone.platform === 'mac' ? { send: v } : { receive: v } }), { label: tr('Shared microphone') });
      const source = UI.select([{ value: '', label: tr('Default microphone') }], (v) => action({ do: 'settings', settings: { input: v } }));
      const output = UI.select([{ value: '', label: tr('Choose a virtual cable output') }], (v) => action({ do: 'settings', settings: { output: v } }));
      const refresh = UI.button(tr('Refresh audio devices'), () => action({ do: 'devices' }));
      const stop = UI.button(tr('Stop'), () => action({ do: 'stop' }), 'danger');
      const toggleRow = UI.row(tr('Shared microphone'), '', [enabled]);
      const sourceRow = UI.row(tr('Microphone source'), '', [source]);
      const outputRow = UI.row(tr('Receive through'), tr('Choose CABLE Input here; choose CABLE Output in the Windows app.'), [output]);
      const controls = UI.row(tr('Audio devices'), '', [refresh, stop]);
      const status = UI.note('info', '');
      const instructions = UI.note('info', '');
      body.append(UI.card(tr('Shared microphone'), [toggleRow, sourceRow, outputRow, controls]), status, instructions);
      return (s) => {
        const m = s.microphone;
        if (!m) { status.set(tr('Microphone is available in a one-to-one Mac and Windows session.')); return; }
        const mac = m.platform === 'mac';
        const on = mac ? m.send : m.receive;
        enabled.set(on);
        sourceRow.hidden = !mac;
        outputRow.hidden = mac;
        source.options([{ value: '', label: tr('Default microphone') }, ...m.devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => ({ value: d.deviceId, label: d.label || tr('Microphone') + ' ' + (i + 1) }))]);
        output.options([{ value: '', label: tr('Choose a virtual cable output') }, ...m.devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => ({ value: d.deviceId, label: d.label || tr('Audio device') + ' ' + (i + 1) }))]);
        source.set(m.input); output.set(m.output);
        refresh.disabled = !on;
        stop.disabled = !(m.sending || m.receiving);
        toggleRow.setHint(mac ? tr('Send only while F8 is held on the Windows screen.') : tr('Allow the paired Mac to use the selected audio output.'));
        controls.setHint(tr('Refreshing lists devices; it does not start recording.'));
        const state = (m.error && tr(m.error)) || (!on ? tr('Microphone sharing is off') : !m.connected ? tr('Connect a Mac and Windows over Wi-Fi or a cable') : m.sending ? tr(m.sending === 'connected' ? 'Sending microphone audio' : 'Connecting microphone…') : m.receiving ? tr(m.receiving === 'connected' ? 'Receiving microphone audio' : 'Connecting microphone…') : mac && !m.peerReady ? tr('Enable reception and select a virtual cable on Windows') : !mac && !m.output ? tr('Choose a virtual cable output') : tr('Ready — hold F8 on the Windows screen'));
        status.set(state);
        instructions.set(mac ? tr('Move the pointer to Windows, then hold F8 to talk. Release F8 to stop. Some Mac keyboards require Fn+F8. Returning home, locking or disconnecting also stops the microphone.') : tr('Install a virtual audio cable separately. Select its playback endpoint here and its recording endpoint in your Windows app. This preview does not automatically start or stop an input method.'));
      };
    },
  });
})();
