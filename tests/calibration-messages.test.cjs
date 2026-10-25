const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function fixture() {
    let now=0;
    const elements=new Map();
    const element=id=>{
        if(!elements.has(id)) elements.set(id,{value:'en',text:'',writes:0,style:{},
            get textContent(){return this.text;},set textContent(value){this.text=value;this.writes++;}});
        return elements.get(id);
    };
    const copy=prefix=>({titles:{waiting:prefix+' waiting',ready:prefix+' ready',sampling:prefix+' sampling'},
        prepare:prefix+' prepare',hold:prefix+' hold',sample:prefix+' sample',
        reasons:{players:prefix+' players {count}',center:prefix+' center',neutral:prefix+' neutral'}});
    const state={game:{gameState:'calibrating'},session:{numPlayers:2}};
    const create=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/ui/tracking-status.js'),'utf8')+'\ncreateTrackingStatus',{
        document:{getElementById:element},performance:{now:()=>now}
    });
    const app={hud:{layoutGameplayNotices(){}},localization:{translations:{en:{calibration:copy('en')},mi:{calibration:copy('mi')}}}};
    const status=create({state,app});
    return {status,element,setTime:value=>{now=value;},view:()=>[element('txt-stand-still').textContent,element('txt-learning').textContent]};
}

test('changing camera guidance waits 1500ms and then shows the latest instruction rather than queued old ones',()=>{
    const f=fixture();f.status.renderCalibration({phase:'waiting',reason:'players',progress:0});
    for(let now=100;now<1500;now+=100){
        f.setTime(now);f.status.renderCalibration({phase:'waiting',reason:now%200?'center':'neutral',progress:0});
        assert.deepEqual(f.view(),['en waiting','en players 2']);
    }
    f.setTime(1499);f.status.renderCalibration({phase:'ready',progress:0.4});
    assert.equal(f.element('calibration-bar').style.width,'40%','progress does not wait for text');
    assert.equal(f.view()[1],'en players 2');
    f.setTime(1500);f.status.renderCalibration({phase:'waiting',reason:'neutral',progress:0});
    assert.deepEqual(f.view(),['en waiting','en neutral']);
    f.setTime(2999);f.status.renderCalibration({phase:'ready',progress:0.3});
    assert.equal(f.view()[1],'en neutral');
    f.setTime(3000);f.status.renderCalibration({phase:'ready',progress:0.3});
    assert.equal(f.view()[1],'en hold');
});

test('identical camera results never rewrite text or restart its reading window',()=>{
    const f=fixture();
    for(let now=0;now<=2000;now+=10){f.setTime(now);f.status.renderCalibration({phase:'ready',progress:0.1});}
    assert.equal(f.element('txt-stand-still').writes,1);assert.equal(f.element('txt-learning').writes,1);
    f.status.renderCalibration({phase:'sampling',progress:0.6});
    assert.deepEqual(f.view(),['en sampling','en sample']);
});

test('completion waits for the final sampling message to be shown for a full 1500ms',()=>{
    const f=fixture();f.status.renderCalibration({phase:'ready',progress:0.1});
    f.setTime(1000);f.status.renderCalibration({phase:'sampling',progress:0.5});
    assert.equal(f.view()[0],'en ready');
    f.setTime(2000);assert.equal(f.status.renderCalibration({phase:'complete',progress:1}),false);
    assert.equal(f.view()[0],'en sampling');assert.equal(f.element('calibration-bar').style.width,'100%');
    f.setTime(3499);assert.equal(f.status.renderCalibration({phase:'complete',progress:1}),false);
    f.setTime(3500);assert.equal(f.status.renderCalibration({phase:'complete',progress:1}),true);
});

test('preparation, language changes and a fresh attempt honor independent reading windows',()=>{
    const f=fixture();f.status.showCalibrationPreparation();
    assert.deepEqual(f.view(),['en waiting','en prepare']);
    f.setTime(500);f.element('lang-select').value='mi';f.status.refreshCalibrationLanguage();
    assert.equal(f.view()[1],'en prepare');
    f.setTime(1500);f.status.refreshCalibrationLanguage();assert.equal(f.view()[1],'mi prepare');
    f.setTime(1600);f.status.resetCalibrationMessages();
    f.status.renderCalibration({phase:'waiting',reason:'center',progress:0});
    assert.deepEqual(f.view(),['mi waiting','mi center'],'old attempts cannot hold up fresh guidance');
    f.setTime(1700);f.element('lang-select').value='en';f.status.refreshCalibrationLanguage();
    assert.equal(f.view()[1],'mi center');
    f.setTime(3100);f.status.refreshCalibrationLanguage();assert.equal(f.view()[1],'en center');
});
