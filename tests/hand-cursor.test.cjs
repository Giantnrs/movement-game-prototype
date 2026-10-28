const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test,before,after} = require('node:test');
const {chromium} = require('playwright');

let browser;
before(async()=>{browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});});
after(async()=>{await browser?.close();});

async function fixture() {
    const page=await browser.newPage({viewport:{width:800,height:600}});
    await page.setContent(`<style>
        button { position:fixed; width:40px; height:40px; padding:0; }
        #restart { left:200px; top:100px; }
        #neighbor { left:280px; top:100px; }
        #hand-cursor { pointer-events:none; position:fixed; }
    </style><button id="restart">↻</button><button id="neighbor">B</button>
    <div id="hand-cursor" hidden><svg><circle id="hand-cursor-progress"/></svg></div>`);
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../src/ui/hand-cursor.js'),'utf8')});
    await page.evaluate(()=>{
        window.clicks=[];
        document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>clicks.push(button.id)));
        window.clock=0;
        window.control=createHandCursor({state:{game:{gameState:'gameover'},session:{numPlayers:1}},app:{}});
        window.feed=(point,raw=point,frames=1)=>{
            for(let i=0;i<frames;i++)control.updateHandCursor(point,raw,clock+=100);
            return {target:document.querySelector('[data-hand-hover]')?.id||null,
                progress:Number(document.getElementById('hand-cursor').dataset.progress),
                paused:document.getElementById('hand-cursor').dataset.paused,clicks:clicks.slice()};
        };
    });
    return page;
}

test('small controls acquire a hand target outside their visible bounds without changing geometry or mouse targets',async()=>{
    const page=await fixture();
    try {
        const result=await page.evaluate(()=>{
            const button=document.getElementById('restart'),before=button.getBoundingClientRect().toJSON();
            const point={x:176,y:116};
            const actualHit=document.elementFromPoint(point.x,point.y)?.id;
            const acquired=feed(point),waiting=feed(point,point,19),clicked=feed(point),held=feed(point,point,30);
            return {before,after:button.getBoundingClientRect().toJSON(),actualHit,acquired,waiting,clicked,held};
        });
        assert.deepEqual(result.before,result.after);
        assert.equal(result.after.width,40,'the replay-sized control keeps its original width');
        assert.equal(result.after.height,40,'the replay-sized control keeps its original height');
        assert.notEqual(result.actualHit,'restart','the mouse hit box has not grown');
        assert.equal(result.acquired.target,'restart');
        assert.equal(result.waiting.clicks.length,0);
        assert.deepEqual(result.clicked.clicks,['restart']);
        assert.deepEqual(result.held.clicks,['restart'],'holding outside the visible edge does not repeat');
    } finally {await page.close();}
});

test('nearby controls use nearest acquisition, stable retention and direct-hit priority',async()=>{
    const page=await fixture();
    try {
        const result=await page.evaluate(()=>{
            const a=feed({x:248,y:116});
            const sticky=feed({x:260,y:116});
            const direct=feed({x:284,y:116});
            control.clearHandCursor();
            const b=feed({x:268,y:116});
            control.clearHandCursor();
            const distant=feed({x:150,y:116});
            const neighbor=document.getElementById('neighbor');neighbor.style.left='244px';neighbor.disabled=true;
            const blocked=feed({x:245,y:116});
            return {a,sticky,direct,b,distant,blocked};
        });
        assert.equal(result.a.target,'restart');
        assert.equal(result.sticky.target,'restart','small movement inside overlapping assistance areas retains the selection');
        assert.equal(result.direct.target,'neighbor','a direct hit on another control switches immediately');
        assert.equal(result.direct.progress,0,'target changes require a fresh hold');
        assert.equal(result.b.target,'neighbor','initial acquisition picks the nearest button');
        assert.equal(result.distant.target,null,'assistance has a bounded range');
        assert.equal(result.blocked.target,null,'a disabled control blocks proximity to its neighbor');
    } finally {await page.close();}
});

test('proximity cannot acquire disabled, hidden, inert, covered or modal-background buttons',async()=>{
    const page=await fixture();
    try {
        const results=await page.evaluate(()=>{
            const button=document.getElementById('restart'),point={x:176,y:116},blocked=[];
            const observe=()=>{control.clearHandCursor();blocked.push(feed(point,point,25));};
            button.disabled=true;observe();button.disabled=false;
            button.setAttribute('aria-disabled','true');observe();button.removeAttribute('aria-disabled');
            button.hidden=true;observe();button.hidden=false;
            button.inert=true;observe();button.inert=false;
            button.style.opacity='0';observe();button.style.opacity='';
            const invisible=document.createElement('div');invisible.style.opacity='0';
            document.body.append(invisible);invisible.append(button);observe();document.body.append(button);invisible.remove();
            const cover=document.createElement('div');cover.style.cssText='position:fixed;left:190px;top:90px;width:60px;height:60px;z-index:999';
            document.body.append(cover);observe();cover.remove();
            const dialog=document.createElement('dialog');dialog.innerHTML='<button id="modal-close" style="left:500px;top:200px">X</button>';
            document.body.append(dialog);dialog.showModal();observe();
            const modalTarget=feed({x:480,y:216});
            return {blocked,modalTarget,inModal:document.getElementById('hand-cursor').parentNode===dialog};
        });
        for(const value of results.blocked)assert.deepEqual(value,{target:null,progress:0,paused:'false',clicks:[]});
        assert.equal(results.modalTarget.target,'modal-close');
        assert.equal(results.inModal,true);
    } finally {await page.close();}
});

test('small-target assistance tolerates tremor but raw departure still pauses and then cancels a pending click',async()=>{
    const page=await fixture();
    try {
        const result=await page.evaluate(()=>{
            const point={x:176,y:116};
            feed(point);
            let stable;
            for(let i=0;i<19;i++)stable=feed({x:176+(i%2?8:-8),y:116}, {x:176+(i%2?18:-18),y:116});
            const spike=feed(point,{x:400,y:400});
            const returned=feed(point);
            const clicked=feed(point);
            control.clearHandCursor();clicks=[];
            feed(point,point,16);
            const departed=feed(point,{x:400,y:400},3);
            const reentered=feed(point);
            return {stable,spike,returned,clicked,departed,reentered};
        });
        assert.equal(result.stable.progress,0.95);
        assert.equal(result.stable.clicks.length,0);
        assert.equal(result.spike.progress,0.95);
        assert.equal(result.spike.paused,'true');
        assert.equal(result.returned.progress,0.95,'unconfirmed intervals do not count toward dwell');
        assert.deepEqual(result.clicked.clicks,['restart']);
        assert.equal(result.departed.target,null);
        assert.equal(result.departed.clicks.length,0);
        assert.equal(result.reentered.progress,0);
    } finally {await page.close();}
});

test('fractional camera timestamps complete exactly two confirmed seconds without completing early',async()=>{
    const page=await fixture();
    try {
        const result=await page.evaluate(()=>{
            const point={x:220,y:120};
            clock=1000/60;
            control.updateHandCursor(point,point,clock);
            control.updateHandCursor(point,point,clock+=100);
            for(let i=0;i<18;i++)control.updateHandCursor(point,point,clock+=100);
            const early=clicks.slice();
            // Simulate the sub-nanosecond error from fractional frame-time sums.
            control.updateHandCursor(point,point,clock+100-1e-10);
            return {early,completed:clicks.slice()};
        });
        assert.deepEqual(result.early,[]);
        assert.deepEqual(result.completed,['restart']);
    } finally {await page.close();}
});
