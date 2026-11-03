// TwinDesk microphone fork. GPL-3.0, see LICENSE.
// Actual platform UI kits, Audio direction cards, native master/intro lifecycle; synthetic state.
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twindesk-microphone-ui-'));
app.setPath('userData', path.join(tmp, 'profile'));
const resultDir = process.env.TWINDESK_MIC_UI_OUTPUT || tmp;
fs.mkdirSync(resultDir, { recursive: true });
app.on('window-all-closed', () => {});
let state, currentWindow;
const actions = [];
const pause = (ms) => new Promise(r => setTimeout(r, ms));
function action(m) {
  actions.push(m);
  if (m.do === 'settings') {
    Object.assign(state.microphone, m.settings);
    currentWindow.webContents.send('state', state);
  }
}
ipcMain.handle('getState', () => state);
ipcMain.on('microphone', (_e, m) => action(m));
ipcMain.handle('microphone', (_e, m) => action(m));
app.whenReady().then(async () => {
 try {
  for (const platform of ['mac', 'win']) {
    state = {
      macName: 'QA Mac', device: { name: 'QA Windows' }, client: { name: 'QA Windows', os: 'win' }, peer: { name: 'QA Mac', os: 'mac' },
      microphone: { platform, send: true, receive: true, input: 'qa-mic', output: 'qa-cable', connected: true, peerReady: true, sending: null, receiving: null, error: '', devices: [
        { kind: 'audioinput', deviceId: 'qa-mic', label: 'QA USB Microphone' }, { kind: 'audiooutput', deviceId: 'qa-cable', label: 'QA Virtual Audio' },
      ] },
    };
    const base = pathToFileURL(path.join(root, platform === 'mac' ? 'mac/' : 'windows/')).href;
    const boot = path.join(tmp, 'boot-' + platform + '.js');
    fs.writeFileSync(boot, `(async()=>{
      UI.state=await UI.api.getState();const d=UI.tabs[0];
      const nav=document.querySelector('.nav-item');const tile=UI.el('span',{class:'tile'},[UI.icon(d.icon)]);tile.style.background=d.color;nav.prepend(tile);
      const page=UI.el('section',{class:'page',id:'page-microphone'});
      const master=UI.switch(v=>d.master.set(v),{label:d.title});
      page.append(UI.el('header',{class:'page-head'},[UI.el('div',{class:'titles'},[UI.el('h1',{text:d.title}),UI.el('p',{text:d.desc})]),master.el]));
      const art=FeatureArt.create(d.id,{color:d.color,onDismiss:()=>apply(UI.state)});page.append(art.el);
      const body=UI.el('div',{class:'page-body'});page.append(body);document.getElementById('pages').append(page);
      const render=d.build(body);
      function apply(s){UI.state=s;const on=d.master.get(s);master.set(on);page.classList.toggle('off',!on);art.set(!on);body.hidden=!art.el.hidden;render(s);if(UI.names)UI.names(s);if(UI.fillTree)UI.fillTree(page);}
      UI.api.onState(apply);apply(UI.state);window.qaReady=true;
    })()`);
    const css = platform === 'mac' ? ['control.css','control-pages.css'] : ['app.css','app-pages.css'];
    const html = path.join(tmp, platform + '.html');
    fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><base href="${base}">${css.map(f=>'<link rel="stylesheet" href="'+f+'">').join('')}</head><body><nav id="sidebar"><div class="identity"><div class="who"><div class="app-name">TwinDesk</div><div class="peer">麦克风开发预览</div></div></div><ul id="nav"><li><button class="nav-item active"><span class="label">麦克风</span></button></li></ul></nav><main id="content"><div id="pages"></div></main><script src="../shared/lang/en.js"></script><script src="../shared/lang/zh-CN.js"></script><script src="../shared/i18n.js"></script><script src="i18n.js"></script><script src="../shared/protocol.js"></script><script src="${platform==='mac'?'control.js':'ui-kit.js'}"></script><script src="../shared/feature-art.js"></script><script src="../shared/ui-microphone.js"></script><script src="${pathToFileURL(boot).href}"></script></body></html>`);
    const w = currentWindow = new BrowserWindow({ width: 1100, height: 760, show: false, webPreferences: { preload: path.join(root, platform === 'mac' ? 'mac/preload-control.js' : 'windows/preload-app.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const errors = [];
    w.webContents.on('console-message', event => { if (event.level === 'error' && !event.message.includes('Content-Security-Policy')) errors.push(event.message); });
    await w.loadFile(html, { query: { language: 'zh-CN' } });
    for (let i=0;i<40;i++) { if (await w.webContents.executeJavaScript('!!window.qaReady')) break; await pause(50); }
    assert(await w.webContents.executeJavaScript('!!window.qaReady'), 'UI failed: ' + errors.join(';'));
    const inspect = await w.webContents.executeJavaScript(`({text:document.body.innerText,switches:document.querySelectorAll('#page-microphone input[role="switch"]').length,routes:document.querySelectorAll('.dir-head .route').length,icon:!!document.querySelector('#nav .tile svg path[d]')})`);
    assert.equal(inspect.switches,3,'one header master and two independent direction switches');assert.equal(inspect.routes,2);assert(inspect.icon);
    assert(inspect.text.includes('在 QA Windows 上使用 QA Mac 的麦克风'));assert(inspect.text.includes('在 QA Mac 上使用 QA Windows 的麦克风'));
    assert(!inspect.text.includes('undefined'));assert.equal(errors.length,0,errors.join(';'));
    await w.webContents.executeJavaScript(`document.querySelector('.page-head input').click();void 0;`);await pause(100);
    assert.equal(state.microphone.send,false);assert.equal(state.microphone.receive,false);
    assert(await w.webContents.executeJavaScript(`!document.querySelector('.feature-art').hidden`),'off page uses the normal feature introduction');
    await w.webContents.executeJavaScript(`document.querySelector('.page-head input').click();void 0;`);await pause(100);
    assert(state.microphone.send && state.microphone.receive);
    await w.webContents.executeJavaScript(`document.querySelector('.dir-card input').click();void 0;`);await pause(100);
    assert.equal(platform==='mac'?state.microphone.send:state.microphone.receive,false);
    assert.equal(platform==='mac'?state.microphone.receive:state.microphone.send,true,'one direction does not change the other');
    await w.webContents.executeJavaScript(`document.querySelector('.dir-card input').click();document.querySelector('.page-body button.btn').click();void 0;`);await pause(600);
    assert(actions.some(m=>m.do==='devices'));
    fs.writeFileSync(path.join(resultDir,'microphone-'+platform+'.png'),(await w.webContents.capturePage()).toPNG());
    w.destroy();
  }
  console.log('microphone-ui: icon, native master/intro, two named routes, independent directions, source/receive devices and refresh passed on both UI kits');app.quit();
 } catch(e) {console.error(e);app.exit(1);}
});
