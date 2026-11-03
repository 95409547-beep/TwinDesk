// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../microphone-rtc.js'),'utf8');
const tick=()=>new Promise(setImmediate);
function rig() {
 let handler,resolveCapture,rejectSink=false,captureCalls=0,worklet;
 const sent=[],pcs=[],timers=new Set(),finish=[];
 const track=()=>({stopped:false,stop(){this.stopped=true;},getSettings:()=>({deviceId:'input'})});
 const stream=(t)=>({getTracks:()=>[t],getAudioTracks:()=>[t]});
 const out={srcObject:null,plays:0,audiblePlays:0,pause(){},async play(){this.plays++;if(!this.muted)this.audiblePlays++;},async setSinkId(id){if(rejectSink)throw Error('No device');this.sinkId=id;}};
 class PC {constructor(){this.connectionState='new';pcs.push(this);}close(){this.closed=true;}addTrack(){return{replaceTrack:async(t)=>this.replaced=t};}async createOffer(){return{type:'offer',sdp:'offer'};}async createAnswer(){return{type:'answer',sdp:'answer'};}async setLocalDescription(d){this.onicecandidate({candidate:{toJSON:()=>({candidate:'candidate'})}});this.localDescription=d;}async setRemoteDescription(){}async addIceCandidate(){}}
 class Context {constructor(){this.sampleRate=48000;this.audioWorklet={addModule:async()=>{}};this.destination={};}close(){return Promise.resolve();}resume(){return Promise.resolve();}createMediaStreamDestination(){return{stream:stream(track())};}createConstantSource(){return{offset:{value:1},connect(){},start(){}};}createMediaStreamSource(){return{connect(){}};}}
 class Worklet {constructor(){worklet=this;this.port={posted:[],postMessage(m){this.posted.push(m);}};}connect(){}}
 const context=vm.createContext({window:{microphoneApi:{on:f=>handler=f,send:m=>sent.push(m)},addEventListener(){}},document:{getElementById:()=>out},navigator:{mediaDevices:{addEventListener(){},enumerateDevices:async()=>[{kind:'audiooutput',deviceId:'virtual-cable'}],getUserMedia:()=>{captureCalls++;return new Promise(r=>resolveCapture=r);}}},Date,RTCPeerConnection:PC,AudioContext:Context,AudioWorkletNode:Worklet,MediaStream:function(ts){return stream(ts[0]);},setInterval:f=>{timers.add(f);return f;},clearInterval:f=>timers.delete(f),setTimeout:f=>{finish.push(f);return f;},clearTimeout(){}});
 vm.runInContext(source,context);
 return{sent,pcs,out,handler,timers,finish,get worklet(){return worklet;},get captureCalls(){return captureCalls;},capture(){const t=track();resolveCapture(stream(t));return t;},connected(){pcs.at(-1).connectionState='connected';pcs.at(-1).onconnectionstatechange();},rejectSink(){rejectSink=true;}};
}
(async()=>{
 {
 const r=rig();await r.handler({action:'send',id:'one'});r.connected();assert.equal(r.captureCalls,0,'no microphone until receiver ready');
 await r.handler({action:'capture',id:'one'});assert.equal(r.captureCalls,1);await r.handler({action:'stop'});const t=r.capture();await tick();assert(t.stopped,'late permission result closes tracks');assert(r.pcs[0].closed);
 }
 {
 const r=rig();await r.handler({action:'send',id:'one'});assert.deepEqual(r.sent.filter(m=>m.t).map(m=>m.t),['mic.offer','mic.ice']);r.connected();await r.handler({action:'capture',id:'one'});const t=r.capture();await tick();assert.equal(r.pcs[0].replaced,t);assert(r.sent.some(m=>m.action==='state'&&m.status==='connected'));await r.handler({action:'stop'});assert(t.stopped);
 }
 {
 const r=rig();r.rejectSink();await r.handler({action:'receive',id:'one',output:'virtual-cable',sdp:'offer'});assert.equal(r.out.plays,0);assert.equal(r.out.srcObject,null);assert(r.pcs[0].closed);
 }
 {
 const r=rig();await r.handler({action:'receive',id:'one',output:'default',sdp:'offer'});assert.equal(r.pcs.length,0);
 }
 {
 const r=rig();await r.handler({action:'receive',id:'one',mode:'dictation',sdp:'offer'});r.connected();r.pcs[0].ontrack({track:{stop(){},getSettings:()=>({})}});await tick();assert(r.sent.some(m=>m.action==='prepared'));assert.equal(r.out.plays,1,'muted media element drives Chromium remote decoding');assert.equal(r.out.audiblePlays,0,'dictation media element must stay muted');
 r.worklet.port.onmessage({data:{pcm:new ArrayBuffer(1920)}});assert(r.sent.some(m=>m.action==='pcm'));
 await r.handler({action:'finish',id:'one'});r.finish[0]();assert.deepEqual(r.worklet.port.posted,['flush']);r.worklet.port.onmessage({data:{flushed:true}});assert(r.sent.some(m=>m.action==='flushed'));assert(r.pcs[0].closed);
 }
 let Processor;const messages=[];
 const c=vm.createContext({AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(name,type)=>Processor=type});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../microphone-pcm-worklet.js'),'utf8'),c);
 const p=new Processor();p.process([[new Float32Array([.5,-.5,1,-1])]]);p.flush();assert.deepEqual(Array.from(new Int16Array(messages[0].pcm)),[16384,-16384,32767,-32768]);
 console.log('microphone-renderer: readiness before capture, late permission cleanup, track replacement, SDP/ICE order, no speaker fallback and dictation PCM/tail flush passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
