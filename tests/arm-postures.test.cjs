const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { root } = require('../scripts/build.cjs');

function fixture(width = 640, height = 480, scale = 1) {
    const create = vm.runInNewContext(fs.readFileSync(path.join(root,'src/input/arm-postures.js'),'utf8') + '\ncreateArmPostures');
    const detector = create({ app: { camera: { videoElement: { videoWidth:width,videoHeight:height } } } });
    function pose(leftAngle = 0, rightAngle = 0) {
        const points = Array.from({length:33},()=>({x:0.5,y:0.4,visibility:1,presence:1}));
        points[11].x += 64 * scale / width;
        points[12].x -= 64 * scale / width;
        for(const [shoulder,elbow,wrist,direction,angle] of [[11,13,15,1,leftAngle],[12,14,16,-1,rightAngle]]) {
            const radians=angle*Math.PI/180;
            points[wrist]={x:points[shoulder].x+direction*Math.cos(radians)*140*scale/width,
                y:points[shoulder].y-Math.sin(radians)*140*scale/height,visibility:1,presence:1};
            points[elbow]={x:(points[shoulder].x+points[wrist].x)/2,
                y:(points[shoulder].y+points[wrist].y)/2,visibility:1,presence:1};
        }
        return points;
    }
    return { pose, read:detector.readLevelArms };
}

test('extended level arms allow natural angle tolerance across camera sizes and player scales',()=>{
    for(const [width,height] of [[640,480],[1280,720]]) {
        for(const scale of [0.6,1,1.4]) {
            const {pose,read}=fixture(width,height,scale);
            for(const angle of [-19,0,19]) assert.equal(read(pose(angle,-angle)).detected,true);
            for(const angle of [-25,25,60,-80]) assert.equal(read(pose(angle,angle)).detected,false);
        }
    }
});

test('hands in front of the chest and bent elbows do not count as level arms',()=>{
    const {pose,read}=fixture();
    const chest=pose();
    chest[15]={x:0.54,y:0.48};chest[16]={x:0.46,y:0.48};
    chest[13]={x:0.65,y:0.55};chest[14]={x:0.35,y:0.55};
    assert.equal(read(chest).detected,false);
    const short=pose();
    short[15].x=0.64;short[16].x=0.36;
    short[13].x=0.62;short[14].x=0.38;
    assert.equal(read(short).detected,false,'shoulder-height hands alone are insufficient');
    const bent=pose();bent[13].y+=0.15;bent[14].y+=0.15;
    assert.equal(read(bent).detected,false,'horizontal wrists with lowered elbows are insufficient');
});

test('both arms must qualify and missing, low-confidence or degenerate joints fail closed',()=>{
    const {pose,read}=fixture();
    assert.equal(read(pose(0,-80)).detected,false);
    for(const index of [11,12,13,14,15,16]) {
        for(const key of ['visibility','presence']) {
            const bad=pose();bad[index][key]=0.1;assert.equal(read(bad).detected,false);
        }
        const missing=pose();missing[index]=null;assert.equal(read(missing).detected,false);
    }
    const bad=pose();bad[13].x=NaN;assert.equal(read(bad).detected,false);
    const folded=pose();folded[13]={...folded[11]};assert.equal(read(folded).detected,false);
});
