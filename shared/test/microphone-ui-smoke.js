// TwinDesk microphone fork. GPL-3.0, see LICENSE.
// Actual UI kits and Microphone component, synthetic state, no input/audio services.
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twindesk-microphone-ui-'));
app.setPath('userData', path.join(tmp, 'profile'));
const resultDir = process.env.TWINDESK_MIC_UI_OUTPUT || tmp;
fs.mkdirSync(resultDir, { recursive: true });
app.on('window-all-closed', () => {});
let state;
const actions = [];
ipcMain.handle('getState', () => state);
ipcMain.on('microphone', (_e, m) => actions.push(m));
ipcMain.handle('microphone', (_e, m) => actions.push(m));
app.whenReady().then(async () => {
 try {
  for (const platform of ['mac', 'win']) {
    state = { microphone: { platform, send: platform === 'mac', receive: platform === 'win', input: 'qa-mic', output: 'qa-cable', connected: true, peerReady: true, sending: null, receiving: null, error: '', devices: [
      { kind: 'audioinput', deviceId: 'qa-mic', label: 'QA USB Microphone' },
      { kind: 'audiooutput', deviceId: 'qa-cable', label: 'CABLE Input (QA Virtual Cable)' },
    ] } };
    const base = pathToFileURL(path.join(root, platform === 'mac' ? 'mac/' : 'windows/')).href;
    const boot = path.join(tmp, 'boot-' + platform + '.js');
    fs.writeFileSync(boot, `(async()=>{ UI.state=await UI.api.getState(); const d=UI.tabs[0]; const page=UI.el('section',{class:'page',id:'page-microphone'}); page.append(UI.el('header',{class:'page-head'},[UI.el('div',{class:'titles'},[UI.el('h1',{text:d.title}),UI.el('p',{text:d.desc})])])); const body=UI.el('div',{class:'page-body'});page.append(body);document.getElementById('pages').append(page);const render=d.build(body);render(UI.state);window.qaReady=true;})()`);
    const css = platform === 'mac' ? ['control.css','control-pages.css'] : ['app.css','app-pages.css'];
    const html = path.join(tmp, platform + '.html');
    fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><base href="${base}">${css.map((f)=>'<link rel="stylesheet" href="'+f+'">').join('')}</head><body><nav id="sidebar"><div class="identity"><div class="who"><div class="app-name">TwinDesk</div><div class="peer">麦克风开发预览</div></div></div><ul id="nav"><li><button class="nav-item active"><span class="label">麦克风</span></button></li></ul></nav><main id="content"><div id="pages"></div></main><script src="../shared/lang/en.js"></script><script src="../shared/lang/zh-CN.js"></script><script src="../shared/i18n.js"></script><script src="i18n.js"></script><script src="../shared/protocol.js"></script><script src="${platform==='mac'?'control.js':'ui-kit.js'}"></script><script src="../shared/ui-microphone.js"></script><script src="${pathToFileURL(boot).href}"></script></body></html>`);
    const w = new BrowserWindow({ width: 1100, height: 760, show: false, webPreferences: { preload: path.join(root, platform === 'mac' ? 'mac/preload-control.js' : 'windows/preload-app.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const errors = [];
    w.webContents.on('console-message', (event) => { if (event.level === 'error' && !event.message.includes('Content-Security-Policy')) errors.push(event.message); });
    await w.loadFile(html, { query: { language: 'zh-CN' } });
    for (let i=0;i<40;i++) { if (await w.webContents.executeJavaScript('!!window.qaReady')) break; await new Promise((r)=>setTimeout(r,50)); }
    assert(await w.webContents.executeJavaScript('!!window.qaReady'), 'UI failed to render: ' + errors.join(';'));
    const text = await w.webContents.executeJavaScript('document.body.innerText');
    assert(text.includes('共享麦克风')); assert(text.includes(platform === 'mac' ? 'QA USB Microphone' : 'CABLE Input'));
    assert(!text.includes('undefined')); assert.equal(errors.length, 0, errors.join(';'));
    await w.webContents.executeJavaScript(`document.querySelector('input[role="switch"]').click();document.querySelector('button.btn').click();void 0;`);
    await new Promise((r)=>setTimeout(r,100));
    assert(actions.some((m)=>m.do==='settings')); assert(actions.some((m)=>m.do==='devices'));
    await w.webContents.executeJavaScript(`document.querySelector('input[role="switch"]').click();void 0;`);
    await new Promise((r)=>setTimeout(r,600));
    const image = await w.webContents.capturePage();
    fs.writeFileSync(path.join(resultDir, 'microphone-' + platform + '.png'), image.toPNG());
    w.destroy();
  }
  console.log('microphone-ui: Mac/Windows actual component rendering, Chinese labels, selected devices and settings/device actions passed');
  app.quit();
 } catch(e) { console.error(e); app.exit(1); }
});
