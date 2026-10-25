const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function fixture(board=[],count=1) {
    const storage=new Map([['leaderboard_data_version','1'],['game_leaderboard_normal',JSON.stringify(board)],
        ['game_leaderboard_chill',JSON.stringify([{name:'Chill leader',score:50}])]]);
    const state={session:{numPlayers:count,currentPlayerName:'Aroha',currentPlayer2Name:'Tama'},
        game:{speedMultiplier:1,score:0,players:[{score:0},{score:0}]}};
    const create=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/storage/scores.js'),'utf8')+'\ncreateScores',{
        localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}
    });
    const scores=create({state,app:{leaderboards:{renderLeaderboard(){}}}});
    const rank=index=>JSON.parse(JSON.stringify(scores.getLiveRanking(index)));
    return {state,scores,rank,storage};
}
const record=(name,score,rank,playerIndex=null)=>({name,score,playerIndex,rank});

test('live rank follows integer score through the middle, top and bottom of saved results without saving',()=>{
    const f=fixture([{name:'Mere',score:100},{name:'Hemi',score:20}]);
    const stored=JSON.stringify([...f.storage]);
    assert.deepEqual(f.rank(0),{current:record('Aroha',0,3,0),rows:[record('Mere',100,1),record('Hemi',20,2),record('Aroha',0,3,0)]});
    f.state.game.score=42.9;
    assert.deepEqual(f.rank(0),{current:record('Aroha',42,2,0),rows:[record('Mere',100,1),record('Aroha',42,2,0),record('Hemi',20,3)]});
    f.state.game.score=101;
    assert.deepEqual(f.rank(0),{current:record('Aroha',101,1,0),rows:[record('Aroha',101,1,0),record('Mere',100,2),record('Hemi',20,3)]});
    assert.equal(JSON.stringify([...f.storage]),stored,'unfinished runs never alter saved scores');
});

test('empty boards still show the current player at rank one without fabricated neighbors',()=>{
    const f=fixture();
    assert.deepEqual(f.rank(0),{current:record('Aroha',0,1,0),rows:[record('Aroha',0,1,0)]});
});

test('the current run stays separate from its historical row below, tied with and above its personal best',()=>{
    const f=fixture([{name:'Aroha',score:40},{name:'Mere',score:40}]);f.state.game.score=40;
    const stored=JSON.stringify([...f.storage]);
    assert.deepEqual(f.rank(0),{current:record('Aroha',40,3,0),rows:[record('Aroha',40,1),record('Mere',40,2),record('Aroha',40,3,0)]});
    f.state.game.score=0;assert.equal(f.rank(0).current.score,0);assert.equal(f.rank(0).current.rank,3);
    f.state.game.score=20;assert.equal(f.rank(0).current.score,20);assert.equal(f.rank(0).current.rank,3);
    f.state.game.score=50;assert.equal(f.rank(0).current.score,50);
    assert.equal(f.rank(0).current.rank,1);assert.equal(JSON.stringify([...f.storage]),stored);
});

test('normal and chill rankings remain separate, independent of dashboard tab selection',()=>{
    const f=fixture([{name:'Normal leader',score:100}]);f.state.game.score=60;
    assert.equal(f.rank(0).current.rank,2);
    f.state.game.speedMultiplier=0.7;
    assert.equal(f.rank(0).current.rank,1);assert.equal(f.rank(0).rows[1].name,'Chill leader');
    assert.equal(f.rank(0).rows.length,2);
});

test('two live players use their own score, retain zero and have stable slot-order ties',()=>{
    const f=fixture([{name:'Mere',score:100}],2);f.state.game.score=999;
    f.state.game.players[0].score=42;f.state.game.players[1].score=50;
    assert.deepEqual(f.rank(0),{current:record('Aroha',42,3,0),rows:[record('Mere',100,1),record('Tama',50,2,1),record('Aroha',42,3,0)]});
    assert.equal(f.rank(1).current.rank,2);
    f.state.game.players[0].score=50;
    assert.equal(f.rank(0).current.rank,2);assert.equal(f.rank(1).current.rank,3);
    f.state.game.players[0].score=0;assert.equal(f.rank(0).current.score,0);
});

test('a live run below the saved top five has rank six and can climb into the displayed leaders',()=>{
    const f=fixture([100,90,80,70,60].map(score=>({name:`Player ${score}`,score})));
    assert.equal(f.rank(0).current.rank,6);assert.equal(f.rank(0).rows[1].score,60);
    assert.deepEqual(f.rank(0).rows.map(row=>row.rank),[4,5,6]);
    f.state.game.score=85;
    assert.equal(f.rank(0).current.rank,3);assert.equal(f.rank(0).rows[2].score,80);
    assert.deepEqual(f.rank(0).rows.map(row=>row.rank),[2,3,4]);
});

test('every live position keeps a full three-entry window including the current run',()=>{
    const f=fixture([100,90,80,70,60].map(score=>({name:`Player ${score}`,score})));
    for(const [score,ranks] of [[110,[1,2,3]],[95,[1,2,3]],[85,[2,3,4]],[75,[3,4,5]],[65,[4,5,6]],[0,[4,5,6]]]) {
        f.state.game.score=score;
        const result=f.rank(0);
        assert.deepEqual(result.rows.map(row=>row.rank),ranks);
        assert.equal(result.rows.filter(row=>row.playerIndex===0).length,1);
    }
});

test('existing duplicate names keep their maximum before selecting five distinct players and persist the cleanup',()=>{
    const f=fixture([
        {name:' Aroha ',score:20},{name:'Mere',score:80},{name:'AROHA',score:100},
        {name:'aroha',score:90},{name:'Hemi',score:70},{name:'Tama',score:60},{name:'Kiri',score:50},{name:'Rangi',score:40}
    ]);
    const expected=[{name:'AROHA',score:100},{name:'Mere',score:80},{name:'Hemi',score:70},{name:'Tama',score:60},{name:'Kiri',score:50}];
    assert.deepEqual(JSON.parse(f.storage.get('game_leaderboard_normal')),expected);
    assert.deepEqual(JSON.parse(JSON.stringify(f.scores.getLeaderboard())),expected);
    assert.deepEqual(JSON.parse(f.storage.get('game_leaderboard_chill')),[{name:'Chill leader',score:50}]);
});

test('saving a lower/equal score retains the best; improving replaces it once and keeps modes independent',()=>{
    const f=fixture([{name:'AROHA',score:100},{name:'Mere',score:80}]);
    f.state.session.currentPlayerName=' aroha ';
    for(const score of [20,100,99.9]) f.scores.saveScore(score);
    assert.deepEqual(JSON.parse(f.storage.get('game_leaderboard_normal')),[{name:'AROHA',score:100},{name:'Mere',score:80}]);
    f.scores.saveScore(120.9);
    assert.deepEqual(JSON.parse(f.storage.get('game_leaderboard_normal')),[{name:'aroha',score:120},{name:'Mere',score:80}]);
    f.state.game.speedMultiplier=0.5;f.scores.saveScore(30);f.scores.saveScore(10);
    assert.deepEqual(JSON.parse(f.storage.get('game_leaderboard_chill')),[{name:'Chill leader',score:50},{name:'aroha',score:30}]);
    assert.equal(JSON.parse(f.storage.get('game_leaderboard_normal'))[0].score,120);
});

test('same-name active slots retain independent live scores alongside their saved personal best',()=>{
    const f=fixture([{name:'AROHA',score:100},{name:'Mere',score:80}],2);
    f.state.session.currentPlayerName=' aroha ';f.state.session.currentPlayer2Name='Aroha';
    f.state.game.players[0].score=20;f.state.game.players[1].score=120;
    const stored=JSON.stringify([...f.storage]);
    for(const index of [0,1]) {
        const result=f.rank(index);
        assert.equal(result.rows.length,3);assert.equal(result.current.score,index===0?20:120);
        assert.equal(result.current.playerIndex,index);assert.equal(result.current.rank,index===0?4:1);
        assert.equal(result.rows.filter(row=>row.name.trim().toLowerCase()==='aroha').length,2);
        assert.ok(result.rows.some(row=>row.score===100 && row.playerIndex===null),'saved best remains a separate historical entry');
    }
    assert.equal(JSON.stringify([...f.storage]),stored,'provisional personal best is not saved');
});

test('both players live scores rank alongside case-matched personal bests without changing either mode’s saved board',()=>{
    const f=fixture([{name:'AROHA',score:100},{name:'TAMA',score:90},{name:'Mere',score:50}],2);
    f.state.game.players[0].score=10;f.state.game.players[1].score=20;
    const stored=JSON.stringify([...f.storage]);
    assert.deepEqual(f.rank(0).rows,[record('Mere',50,3),record('Tama',20,4,1),record('Aroha',10,5,0)]);
    assert.equal(f.rank(1).current.score,20);
    f.state.game.speedMultiplier=0.5;
    assert.equal(f.rank(0).current.score,10);assert.equal(f.rank(1).current.score,20);
    assert.equal(JSON.stringify([...f.storage]),stored);
});

test('name keys normalize Unicode spelling and case without merging names with different macrons',()=>{
    const f=fixture([{name:'Ma\u0304ui',score:50},{name:'MĀUI',score:70},{name:'Maui',score:60},
        {name:'__proto__',score:30},{name:'__proto__',score:40}]);
    assert.deepEqual(JSON.parse(f.storage.get('game_leaderboard_normal')),[{name:'MĀUI',score:70},{name:'Maui',score:60},{name:'__proto__',score:40}]);
});
