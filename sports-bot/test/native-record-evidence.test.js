import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNhlOfficialGame} from '../src/sportsData.js';
import {predictGame} from '../src/predictionEngine.js';
import {predictionInputsAt} from '../src/inputChronology.js';
const now=Date.parse('2099-02-01T18:00:00Z'),start='2099-02-01T19:00:00Z',meta={fetchedAt:'2099-02-01T17:59:00Z',cacheState:'network'},league={key:'nhl',label:'NHL',group:'Hockey'};
const raw=(change={})=>({id:2098020001,season:20982099,gameType:2,gameState:'FUT',gameScheduleState:'OK',startTimeUTC:start,awayTeam:{id:24,abbrev:'ANA',name:{default:'Ducks'},record:'4-6-0'},homeTeam:{id:4,abbrev:'PHI',name:{default:'Flyers'},record:'3-6-3'},...change});
const parse=(r=raw(),source=meta)=>parseNhlOfficialGame(r,league,source,{asOf:now});
const factor=g=>predictGame(g,1,{now}).factors.find(row=>row.label==='Bayesian record');
const scopedGame=(change={})=>({id:'fixture',league:'NHL',leagueKey:'nhl',sportGroup:'Hockey',seasonYear:20982099,seasonType:2,statusKey:'scheduled',startTime:start,away:{name:'Away',abbr:'AAA',record:'5-5-5'},home:{name:'Home',abbr:'HHH',record:'5-5-0'},...change});
test('current native pregame regular-season records are retained rather than discarded',()=>{
 const g=parse();assert.equal(g.away.record,'4-6-0');assert.equal(g.home.record,'3-6-3');assert.equal(g.home.recordEvidence.overtimeLosses,3);assert.equal(g.home.recordEvidence.ties,0);assert.equal(g.home.recordEvidence.games,12);assert.equal(g.home.recordEvidence.nativePublicationVerified,false);
});
test('modern NHL overtime losses are losses for a full-game winner forecast, not half wins',()=>{
 const f=factor(scopedGame());assert.ok(f.value>0);assert.ok(f.detail.includes('40.0%'));assert.ok(f.detail.includes('50.0%'));
});
test('NFL true ties retain their existing half-win record calculation',()=>{
 const f=factor(scopedGame({leagueKey:'nfl',league:'NFL',sportGroup:'Football',seasonYear:2099}));assert.equal(f.value,0);
});
test('explicit zero-game native records remain visible without creating record-strength evidence',()=>{
 const r=raw();r.awayTeam.record='0-0-0';r.homeTeam.record='0-0-0';const g=parse(r);assert.equal(g.away.record,'0-0-0');assert.equal(g.away.recordEvidence.games,0);assert.equal(factor(g).present,false);
});
test('postgame, live, stale or unknown native record receipts are not backfilled into pregame inputs',()=>{
 for(const change of [{gameState:'OFF'},{gameState:'LIVE'},{gameType:1},{gameType:3},{season:20972098}])assert.equal(parse(raw(change)).away.record,'');
 for(const source of [{cacheState:'network'},{...meta,cacheState:'stale'},{...meta,fetchedAt:'2099-02-01T18:00:01Z'},{...meta,fetchedAt:'2099-02-01T17:00:00Z'},{...meta,fetchedAt:'2099-02-01T17:59:00'}])assert.equal(parse(raw(),source).away.record,'');
});
test('malformed native counts and mismatched team identities cannot manufacture season evidence',()=>{
 for(const record of [null,'4-6','4-6-0 text','-4-6-0','4.5-6-0','9999-0-0']){const r=raw();r.awayTeam.record=record;assert.equal(parse(r).away.record,'');}
 const r=raw();r.homeTeam.id=r.awayTeam.id;assert.equal(parse(r).away.record,'');
});
test('unknown NHL season or period never guesses whether a third count is a tie or an overtime loss',()=>{
 for(const change of [{seasonYear:null},{seasonType:null},{seasonYear:20032004},{seasonType:3}])assert.equal(factor(scopedGame(change)).present,false);
});
test('a known future nested record receipt is excluded even if the parent schedule receipt is old',()=>{
 const g=scopedGame();g.away.recordEvidence={schema:'sports-native-nhl-record-v1',fetchedAt:'2099-02-01T18:01:00Z'};const original=structuredClone(g),safe=predictionInputsAt(g,{},now).game;assert.equal(safe.away.record,'');assert.equal(safe.home.record,'5-5-0');assert.deepEqual(g,original);
});
test('native postponement and cancellation flags override an otherwise scheduled/final state',()=>{
 for(const change of [{gameScheduleState:'PPD'},{gameScheduleState:'CNCL'},{gameState:'SUSP'},{gameState:'UNRECOGNIZED'},{gameState:'OFF',gameScheduleState:'PPD'}]){const g=parse(raw(change));assert.equal(g.statusKey,'alert');assert.equal(g.away.record,'');}
});
test('known native final/live states still keep their normal lifecycle while unknown schedule flags stay auditable',()=>{
 assert.equal(parse(raw({gameState:'OFF'})).statusKey,'final');assert.equal(parse(raw({gameState:'CRIT'})).statusKey,'live');assert.equal(parse(raw({gameScheduleState:'UNKNOWN'})).statusKey,'alert');
});

test('explicit native neutral-site flags are preserved and omission stays unknown',()=>{
 assert.equal(parse(raw({neutralSite:true})).neutralSite,true);assert.equal(parse(raw({neutralSite:false})).neutralSite,false);assert.equal(parse(raw()).neutralSite,null);
});
test('malformed native event starts are rejected without a format-time exception',()=>{
 for(const value of ['2099-02-30T19:00:00Z','2099-02-01T19:00:00','not-a-start'])assert.equal(parse(raw({startTimeUTC:value})),null);
});
test('native record evidence expires at inference, not only when first parsed',()=>{
 const g=parse(),later=now+15*60000;
 const safe=predictionInputsAt(g,{},later);assert.equal(safe.game.away.record,'');assert.equal(safe.game.home.record,'');assert.ok(Object.keys(safe.audit.excluded).some(key=>key.includes('record_receipt_not_current_pregame')));
 assert.equal(factor({...g,away:{...g.away,recordEvidence:{...g.away.recordEvidence,fetchedAt:'2099-02-01T17:00:00Z'}}}).present,false);
});
test('retained native records are bound to their original event, season, side and counts',()=>{
 for(const mutate of [g=>g.id='nhl-2098020002',g=>g.seasonYear=20992000,g=>g.seasonType=3,g=>g.away.id='999',g=>g.home.abbr='OTHER',g=>g.away.record='99-0-0',g=>g.statusKey='live',g=>g.startTime='2099-02-01T19:01:00Z']){
  const g=parse();mutate(g);const original=structuredClone(g);assert.equal(predictionInputsAt(g,{},now).game.away.record,'');assert.deepEqual(g,original);
 }
});
