const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function pose(x=0.5, size=1) {
    const points=Array.from({length:33},()=>({x,y:0.8,visibility:1,presence:1}));
    for(const [id,px,py] of [[11,x+0.1*size,0.4],[12,x-0.1*size,0.4],
        [23,x+0.07*size,0.4+0.3*size],[24,x-0.07*size,0.4+0.3*size]]) points[id]={x:px,y:py,visibility:1,presence:1};
    return points;
}

function fixture() {
    let now=0;
    const calls=[],events={};
    const state={session:{isCameraInitialized:true},game:{gameState:'loading'}};
    const document={hidden:false,focused:true,hasFocus(){return this.focused;},addEventListener:(type,fn)=>{events[type]=fn;}};
    const window={innerWidth:1280,innerHeight:800,addEventListener:(type,fn)=>{events[type]=fn;}};
    const app={camera:{videoElement:{paused:false,ended:false}},handCursor:{
        clearHandCursor(){calls.push(null);},updateHandCursor(point,raw,time){calls.push({point,raw,time});}
    }};
    const create=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/input/hand-pointer.js'),'utf8')+'\ncreateHandPointer',
        {document,window,performance:{now:()=>now}});
    const pointer=create({state,app});
    return {pointer,state,app,document,window,calls,events,
        step(body,ms=100){now+=ms;pointer.observeHandPointer(body);return calls.at(-1);},
        advance(ms){now+=ms;}};
}

test('hand pointer is inactive before camera startup, with lowered hands, or with uncertain joints',()=>{
    const f=fixture(),body=pose();
    assert.equal(f.step(body),null);
    body[16]={x:0.5,y:0.3};f.state.session.isCameraInitialized=false;
    assert.equal(f.step(body),null);
    f.state.session.isCameraInitialized=true;
    for(const id of [11,12,23,24,16]) {
        const bad=JSON.parse(JSON.stringify(body));bad[id].visibility=0.5;
        assert.equal(f.step(bad),null);
    }
    for(const value of [NaN,Infinity,1.1,-0.1]) {
        const bad=JSON.parse(JSON.stringify(body));bad[16].x=value;
        assert.equal(f.step(bad),null);
    }
});

test('gameplay disables hand input and clears progress until the interface returns',()=>{
    const f=fixture(),body=pose();body[16]={x:0.5,y:0.3};
    assert.ok(f.step(body));
    f.state.game.gameState='playing';f.pointer.checkHandPointer();assert.equal(f.calls.at(-1),null);
    for(let i=0;i<30;i++) assert.equal(f.step(body),null);
    f.state.game.gameState='gameover';assert.ok(f.step(body),'results accept a fresh hand observation');
});

test('either raised hand moves a mirrored cursor and preserves the selected hand until lowered',()=>{
    const f=fixture(),body=pose();
    body[16]={x:0.3,y:0.3};
    assert.ok(f.step(body).raw.x>640,'raw left moves toward the displayed right');
    body[15]={x:0.7,y:0.3};
    assert.ok(f.step(body).raw.x>640,'raising the second hand does not steal control');
    body[16].y=0.8;
    assert.ok(f.step(body).raw.x<640,'the other hand takes over after lowering the active one');
    assert.equal(f.calls.at(-2),null,'switching hands cancels any previous dwell');
});

test('Player 1 can reach all viewport edges from their side, in portrait and landscape',()=>{
    for(const [width,height] of [[1280,800],[390,844]]) for(const x of [0.5,0.75,0.85]) {
        const f=fixture(),body=pose(x);f.window.innerWidth=width;f.window.innerHeight=height;
        body[16]={x:Math.min(0.98,x+0.24),y:0.13};
        let value=f.step(body);assert.ok(Math.abs(value.raw.x-26)<1e-6);assert.ok(Math.abs(value.raw.y-26)<1e-6);
        body[16]={x:Math.max(0.02,x-0.24),y:0.46};
        value=f.step(body);assert.ok(Math.abs(value.raw.x-(width-26))<1e-6);assert.ok(Math.abs(value.raw.y-(height-26))<1e-6);
    }
});

test('camera stalls, time reversal, focus/visibility loss and resize clear the cursor and dwell',()=>{
    const f=fixture(),body=pose();body[16]={x:0.5,y:0.3};
    f.step(body);f.advance(251);f.pointer.checkHandPointer();assert.equal(f.calls.at(-1),null);
    f.step(body);f.advance(-10);f.pointer.checkHandPointer();assert.equal(f.calls.at(-1),null);
    for(const type of ['blur','resize','visibilitychange']) {
        f.step(body);f.events[type]();assert.equal(f.calls.at(-1),null,type);
    }
    f.document.hidden=true;assert.equal(f.step(body),null);
    f.document.hidden=false;f.step(body);f.app.camera.videoElement.paused=true;
    f.pointer.checkHandPointer();assert.equal(f.calls.at(-1),null);
    f.app.camera.videoElement.paused=false;f.document.focused=false;
    assert.equal(f.step(body),null,'an unfocused visible window cannot dwell-click');
});

test('holding a hand still is unaffected by jitter in shoulder, hip and body-width measurements',()=>{
    for(const fps of [15,30,60]) {
        const f=fixture(),initial=pose();initial[16]={x:0.5,y:0.3};
        const start=f.step(initial,1000/fps).point;
        for(let i=0;i<fps*3;i++) {
            const body=pose();body[16]={x:0.5,y:0.3};
            for(const id of [11,12,23,24]) {
                body[id].x+=Math.sin(i*2.3+id)*0.008;
                body[id].y+=Math.cos(i*1.7+id)*0.008;
            }
            const value=f.step(body,1000/fps);
            assert.ok(Math.hypot(value.point.x-start.x,value.point.y-start.y)<0.01,`${fps}fps torso jitter cannot move the pointer`);
        }
    }
});

test('median filtering and a deadzone suppress wrist noise and isolated large spikes at different camera rates',()=>{
    for(const fps of [15,30,60]) {
        const f=fixture(),body=pose();body[16]={x:0.5,y:0.3};
        const start=f.step(body,1000/fps).point;
        let seed=12345,maxDistance=0;
        const noise=()=>{seed=(1664525*seed+1013904223)>>>0;return (seed/2**32-0.5)*0.012;};
        for(let i=0;i<fps*4;i++) {
            body[16]={x:0.5+noise(),y:0.3+noise()};
            if(i%23===15) body[16]={x:0.65,y:0.15};
            const value=f.step(body,1000/fps);
            maxDistance=Math.max(maxDistance,Math.hypot(value.point.x-start.x,value.point.y-start.y));
        }
        assert.ok(maxDistance<9,`${fps}fps stable-hand movement is bounded: ${maxDistance}px`);
    }
});

test('deliberate large moves remain responsive and lowering the hand recalibrates the control area',()=>{
    const f=fixture(),body=pose();body[16]={x:0.5,y:0.3};
    f.step(body,1000/30);
    body[16].x=0.35;
    let value;
    for(let i=0;i<9;i++) value=f.step(body,1000/30);
    assert.ok(Math.abs(value.point.x-value.raw.x)<45,'large movements reach their target promptly');
    for(let i=0;i<20;i++) value=f.step(body,1000/30);
    assert.ok(Math.abs(value.point.x-value.raw.x)<9,'small remaining motion settles inside the deadzone');
    body[16].y=0.8;assert.equal(f.step(body),null);
    const shifted=pose(0.7);shifted[16]={x:0.7,y:0.3};
    value=f.step(shifted);
    assert.ok(Math.abs(value.point.x-640)<0.01,'a fresh raise uses the new body position');
});

test('hand-height hysteresis and a short confidence dropout do not bounce between hands',()=>{
    const f=fixture(),body=pose();body[16]={x:0.3,y:0.45};f.step(body);
    body[15]={x:0.7,y:0.3};
    for(const y of [0.465,0.475,0.455,0.48,0.45]) {
        body[16].y=y;
        assert.ok(f.step(body).raw.x>640,'near-shoulder motion retains the active right hand');
    }
    body[16].visibility=0.3;assert.equal(f.step(body),null,'uncertain input suspends clicks');
    body[16].visibility=1;assert.ok(f.step(body).raw.x>640,'the same hand recovers without selecting the other');
});
