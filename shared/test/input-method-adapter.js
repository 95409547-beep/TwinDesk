// TwinDesk microphone fork. GPL-3.0, see LICENSE.
'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { InputMethodAdapter } = require('../input-method-adapter');
const epoch='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
const tick=()=>new Promise(setImmediate);
async function rig(hello = {}) {
 let child, args, written=[];
 const adapter=new InputMethodAdapter({spawnProcess:(program, argv, options)=>{
  args={program,argv,options};child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
  Object.assign(child.stdin,{destroyed:false,writableEnded:false,writableLength:0,write(frame){written.push(JSON.parse(frame.subarray(4).toString()));return true;},end(){this.writableEnded=true;}});return child;
 }});
 await adapter.configure('/fixture/input.exe','/fixture/input.json');
 const send=(m)=>{const body=Buffer.from(JSON.stringify({epoch,...m}));const frame=Buffer.alloc(body.length+4);frame.writeUInt32BE(body.length);body.copy(frame,4);child.stdout.emit('data',frame.subarray(0,3));child.stdout.emit('data',frame.subarray(3));};
 send({type:'hello',protocol:2,transport:'stdio',sample_rate:48000,channels:1,format:'s16le',ready:true,...hello});
 return {adapter,send,child,written,args};
}
(async()=>{
 {
 const r=await rig();assert(r.adapter.ready);assert.equal(r.args.options.shell,false);assert.deepEqual(r.args.argv,['--serve-stdio','/fixture/input.json']);
 const begin=r.adapter.begin(id,7);r.adapter.audio(id,new Uint8Array(1920));assert(!r.written.some(m=>m.type==='audio'),'no PCM before native start');
 r.send({type:'started',session:id});await begin;r.adapter.audio(id,new Uint8Array(1920));assert.equal(r.written.at(-1).type,'audio');
 const end=r.adapter.end(id,true);assert.equal(r.written.at(-1).type,'end');let ended=false;end.then(()=>ended=true);await tick();assert(!ended,'wait for microphone end confirmation');
 r.send({type:'ended',session:id,ready:true,reason:'end'});await end;assert(r.adapter.ready);await r.adapter.close();assert(r.child.stdin.writableEnded);
 }
 {
 const r=await rig();const begin=r.adapter.begin(id,7).then(()=>false,()=>true);const end=r.adapter.end(id,false);
 assert(await begin,'early release cancels pending start');assert.equal(r.written.at(-1).type,'cancel');
 r.send({type:'started',session:id});assert(r.adapter.active.ending,'late native start cannot resume capture');
 r.send({type:'ended',session:id,ready:true,reason:'cancelled'});await end;assert.equal(r.adapter.active,null);await r.adapter.close();
 }
 {
 const r=await rig();const begin=r.adapter.begin(id,7);r.send({type:'started',session:id});await begin;
 r.child.stdin.writableLength=40000;r.adapter.audio(id,new Uint8Array(1920));assert(!r.adapter.ready);assert(r.child.stdin.writableEnded,'bounded pressure asks child to clean up by EOF');assert.equal(r.adapter.active,null);await r.adapter.close();
 }
 {
 const r=await rig();const begin=r.adapter.begin(id,7).then(()=>false,()=>true);r.send({type:'error',session:id,ready:true,error:'microphone_busy'});assert(await begin);assert(r.adapter.ready,'busy start can be retried only with a new physical round');await r.adapter.close();
 }
 {
 const r=await rig();r.send({type:'pong',epoch:'33333333-3333-4333-8333-333333333333'});assert(!r.adapter.ready);assert(r.child.stdin.writableEnded);await r.adapter.close();
 }
 {
 const r=await rig({fixture:true});assert(!r.adapter.ready,'production adapter rejects the fake native backend');assert(r.child.stdin.writableEnded);await r.adapter.close();
 }
 console.log('input-method-adapter: private child framing, native start/end confirmation, early cancel, late start, bounded PCM, busy and epoch guards passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
