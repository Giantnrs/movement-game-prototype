const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { root } = require('../scripts/build.cjs');
function fixture(fetch) {
    let now=0;
    const stored=new Map();
    const create=vm.runInNewContext(fs.readFileSync(path.join(root,'src/debug/recorder.js'),'utf8')+'\ncreateDebugRecorder',{
        URLSearchParams, crypto: {randomUUID:()=> 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},
        Date, performance:{now:()=>now++},navigator:{userAgent:'test'},innerWidth:640,innerHeight:480,devicePixelRatio:1,
        window:{location:{search:'?debug=1',protocol:'http:',hostname:'127.0.0.1',origin:'http://127.0.0.1:8080',pathname:'/'},addEventListener(){}},
        localStorage:{setItem:(key,value)=>stored.set(key,value)},fetch,clearInterval(){}
    });
    return {recorder:create({state:{game:{gameState:'playing'}}}),stored};
}

test('debug recorder bounds recent telemetry and counts dropped events',()=>{
    const {recorder}=fixture();
    for(let i=0;i<3000;i++)recorder.record('frame',{payload:'x'.repeat(400)});
    const data=recorder.debugSnapshot();
    assert.ok(data.events.length<=2000);assert.ok(data.events.length<3000);
    assert.equal(data.droppedEvents,3000-data.events.length);
    assert.equal(data.events.at(-1).seq,3000);
    assert.ok(JSON.stringify(data).length<800000);
});

test('finish waits for an in-flight save then persists the final mark and stops recording',async()=>{
    const calls=[];let release;
    const {recorder}=fixture((url,body)=>{
        calls.push(JSON.parse(body.body));
        if(calls.length===1)return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({file:'first.json'})});});
        return Promise.resolve({ok:true,json:async()=>({file:'final.json'})});
    });
    recorder.record('before');const pending=recorder.flushDebugLog();
    const finished=recorder.finishDebugLog();release();await pending;await finished;
    assert.equal(calls.length,2);assert.equal(calls[1].events.at(-1).type,'human.finish');
    recorder.record('ignored');assert.equal(recorder.debugSnapshot().events.length,2);
    assert.equal(recorder.status().recording,false);
});

test('failed autosave retains the complete browser copy and offers download',async()=>{
    const {recorder,stored}=fixture(async()=>{throw Error('offline');});
    recorder.record('human.mark',{note:'warning missing'});await recorder.finishDebugLog();
    assert.match(recorder.status().saveState,/Auto-save failed.*Download/);
    const copy=JSON.parse(stored.get('active_runner_debug_last_session'));
    assert.equal(copy.events[0].data.note,'warning missing');assert.equal(copy.events.at(-1).type,'human.finish');
});
