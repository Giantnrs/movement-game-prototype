const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { root } = require('../scripts/build.cjs');

function fixture(count = 1) {
    let now=0, paused=false;
    const document={hidden:false};
    const create=vm.runInNewContext(fs.readFileSync(path.join(root,'src/game/energy.js'),'utf8')+'\ncreateEnergy',{
        performance:{now:()=>now},document
    });
    const players=Array.from({length:count},()=>({lives:3,isResting:false,restingMode:false,stats:{squats:0,jumps:0}}));
    const state={session:{numPlayers:count},game:{gameState:'playing',players,score:0,speedMultiplier:1}};
    const energy=create({state,app:{trackingSafety:{isGameplayPaused:()=>paused}}});
    energy.resetEnergy();
    const step=ms=>{now+=ms;energy.updateEnergy();};
    return {energy,state,players,document,step,setNow:ms=>{now=ms;},pause(value){energy.suspendEnergy(value);paused=value;}};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} ≈ ${b}`);

test('MET energy calculation scales with real duration and mass, rejecting invalid inputs',()=>{
    const {energy}=fixture();
    near(energy.estimateKcal(3,60000),3.675);
    near(energy.estimateKcal(3,60000,35),1.8375);
    for(const values of [[NaN,1000],[3,-1],[3,1000,0],[3,Infinity]]) assert.equal(energy.estimateKcal(...values),0);
});

test('calories depend on time and activity rather than score, speed, or gesture counters',()=>{
    for(const fps of [15,30,60]) {
        const f=fixture();
        f.state.game.score=100000;f.state.game.speedMultiplier=2;
        f.players[0].stats={squats:10000,jumps:10000};
        for(let i=0;i<fps*60;i++) f.step(1000/fps);
        near(f.energy.readEnergy(f.players[0]),f.energy.estimateKcal(1.3,60000));
    }
});

test('recognized actions open a bounded activity window, with no per-action calorie bonus',()=>{
    const f=fixture();const player=f.players[0];
    f.energy.recordEnergyAction(player);assert.equal(f.energy.readEnergy(player),0);
    for(let i=0;i<20;i++)f.step(200);
    near(f.energy.readEnergy(player),f.energy.estimateKcal(3,2500)+f.energy.estimateKcal(1.3,1500));
    f.energy.recordEnergyAction(player);
    for(let i=0;i<100;i++)f.energy.recordEnergyAction(player);
    near(f.energy.readEnergy(player),f.energy.estimateKcal(3,2500)+f.energy.estimateKcal(1.3,1500));
});

test('a late action never retroactively changes preceding idle energy',()=>{
    const f=fixture();f.setNow(200);f.energy.recordEnergyAction(f.players[0]);
    near(f.energy.readEnergy(f.players[0]),f.energy.estimateKcal(1.3,200));
});

test('pause, hidden tabs and long frame gaps cannot add large calorie jumps',()=>{
    const f=fixture();f.energy.recordEnergyAction(f.players[0]);f.step(100);
    f.pause(true);const before=f.energy.readEnergy(f.players[0]);
    f.step(10000);f.energy.recordEnergyAction(f.players[0]);f.pause(false);
    assert.equal(f.energy.readEnergy(f.players[0]),before);
    f.step(100);near(f.energy.readEnergy(f.players[0])-before,f.energy.estimateKcal(1.3,100));
    f.document.hidden=true;const hidden=f.energy.readEnergy(f.players[0]);f.step(10000);
    assert.equal(f.energy.readEnergy(f.players[0]),hidden);
    f.document.hidden=false;f.step(10000);
    near(f.energy.readEnergy(f.players[0])-hidden,f.energy.estimateKcal(1.3,250));
});

test('players have independent estimates and rest/death/end/reset are respected',()=>{
    const f=fixture(2);f.energy.recordEnergyAction(f.players[0]);f.step(200);
    near(f.energy.readEnergy(f.players[0]),f.energy.estimateKcal(3,200));
    near(f.energy.readEnergy(f.players[1]),f.energy.estimateKcal(1.3,200));
    f.players[0].isResting=true;const rest=f.energy.readEnergy(f.players[0]);f.step(100);
    near(f.energy.readEnergy(f.players[0])-rest,f.energy.estimateKcal(1.3,100));
    f.players[1].lives=0;const dead=f.energy.readEnergy(f.players[1]);f.step(100);
    assert.equal(f.energy.readEnergy(f.players[1]),dead);
    f.energy.stopEnergy();const ended=f.energy.readEnergy(f.players[0]);f.step(1000);
    assert.equal(f.energy.readEnergy(f.players[0]),ended);
    f.energy.resetEnergy();assert.equal(f.energy.readEnergy(f.players[0]),0);
});
