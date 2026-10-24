import test from 'node:test';
import assert from 'node:assert/strict';
process.env.AUTO_ENRICH_ENABLED='false';process.env.AUTO_LEARNING_ENABLED='false';process.env.FEATURE_WAREHOUSE_ENABLED='false';process.env.HISTORICAL_REPLAY_ENABLED='false';process.env.LOCAL_ML_ENABLED='false';process.env.ADVANCED_DATASETS_ENABLED='false';process.env.AUTO_OFFICIAL_SOURCES='false';process.env.LOCAL_ONLY='false';
const {buildDailySlate,parseEspnEvent}=await import('../src/sportsData.js');
const {cdnWindowEvidence,scoreboardCoverage}=await import('../src/scoreboardWindow.js');
const league={key:'nba',label:'NBA',group:'Basketball'};
const event=(date,id='fixture')=>({id,date,season:{year:2099,type:2},status:{type:{name:'STATUS_SCHEDULED',state:'pre'}},competitions:[{competitors:[{homeAway:'away',team:{id:'away',displayName:'Away',abbreviation:'AWY'},records:[{summary:'10-10'}]},{homeAway:'home',team:{id:'home',displayName:'Home',abbreviation:'HOM'},records:[{summary:'10-10'}]}]}]});
test('CDN fallback uses its declared singular date selector and discovers the requested local-day game',async t=>{
 const urls=[];t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input);urls.push(url);if(url.hostname==='site.api.espn.com')return new Response('Denied',{status:403});const requested=url.searchParams.get('date')==='20990201';return Response.json({content:{dateParams:{date:requested?'20990201':'20990131'},isWeekOriented:false,sbData:{events:[event(requested?'2099-02-02T01:00Z':'2099-02-01T01:00Z')]}}});});
 const slate=await buildDailySlate(new Date('2099-02-01T18:00:00Z'),{guildId:'cdn-selector',includeOdds:false,leagueKeys:['nba']});assert.equal(slate.games.length,1);const request=urls.find(u=>u.hostname==='cdn.espn.com');assert.equal(request.searchParams.get('date'),'20990201');assert.equal(request.searchParams.has('dates'),false);assert.equal(slate.games[0].dateKey,'2099-02-01');
 assert.equal(slate.scoreboardCoverage[0].windowStatus,'declared_requested_day');assert.equal(slate.predictions[0].evidenceCoverage.sources.schedule.requestWindow.acceptedLocalDayGames,1);
 const calls=urls.length,again=await buildDailySlate(new Date('2099-02-01T18:00:00Z'),{guildId:'cdn-selector-cache',includeOdds:false,leagueKeys:['nba']});assert.equal(urls.length,calls);assert.equal(again.scoreboardCoverage[0].cacheState,'fresh');assert.equal(again.scoreboardCoverage[0].windowStatus,'declared_requested_day');
});
test('malformed and unzoned ESPN starts are rejected before local-time formatting or calibration',()=>{
 for(const date of ['2099-02-30T20:00:00Z','2099-02-01T20:00:00','not-a-date'])assert.equal(parseEspnEvent(event(date),league),null);
});
test('valid minute-precision source starts remain supported',()=>{
 assert.equal(parseEspnEvent(event('2099-02-02T01:00Z'),league).dateKey,'2099-02-01');
});
test('native selector declarations survive compaction without inventing schedule completeness',()=>{
 const evidence=cdnWindowEvidence({content:{dateParams:{date:'20990201'},isWeekOriented:false,sbData:{day:{date:'2099-02-01'}}}});assert.deepEqual(evidence.declaredDays,['2099-02-01']);
 const report=scoreboardCoverage({leagueKey:'nba',provider:'ESPN CDN',requestedDay:'2099-02-01',reportedEvents:0,windowEvidence:evidence});assert.equal(report.windowStatus,'declared_requested_day');assert.equal(report.completenessVerified,false);
});
test('weekly declarations stay weekly even when a requested date is echoed',()=>{
 const evidence=cdnWindowEvidence({content:{dateParams:{date:'20990201',year:2099,week:7,seasontype:2},isWeekOriented:true}});
 const report=scoreboardCoverage({leagueKey:'nfl',provider:'ESPN CDN',requestedDay:'2099-02-01',reportedEvents:0,windowEvidence:evidence});assert.equal(report.windowStatus,'declared_weekly_window');assert.equal(report.windowEvidence.weekContext.week,7);assert.equal(report.completenessVerified,false);
});
test('conflicting and malformed provider days remain explicit without normalized impossible dates',()=>{
 const conflict=cdnWindowEvidence({content:{dateParams:{date:'20990201'},sbData:{day:{date:'2099-02-02'}}}});assert.equal(scoreboardCoverage({requestedDay:'2099-02-01',reportedEvents:0,windowEvidence:conflict}).windowStatus,'conflicting_provider_days');
 for(const value of ['20990230',true,0,'2099-02-01T00:00:00Z']){const evidence=cdnWindowEvidence({content:{dateParams:{date:value}}});assert.equal(evidence.declaredDays.length,0);assert.equal(evidence.invalidDayDeclarations,1);}
});
test('undeclared windows and a valid zero-event response do not certify a complete market',()=>{
 const report=scoreboardCoverage({leagueKey:'nba',provider:'ESPN CDN',requestedDay:'2099-02-01',reportedEvents:0,windowEvidence:cdnWindowEvidence({})});assert.equal(report.windowStatus,'provider_day_unverified');assert.equal(report.reportedEvents,0);assert.equal(report.completenessVerified,false);
});
test('wrong-day and malformed rows are counted while valid local-day observations remain usable',async t=>{
 t.mock.method(globalThis,'fetch',async input=>{const url=new URL(input);if(url.hostname==='site.api.espn.com')return new Response('Denied',{status:403});return Response.json({content:{dateParams:{date:'20990202'},isWeekOriented:false,sbData:{events:[event('2099-02-04T01:00Z','wanted'),event('2099-02-03T01:00Z','outside'),event('not-a-time','invalid'),null]}}});});
 const slate=await buildDailySlate(new Date('2099-02-03T18:00:00Z'),{guildId:'cdn-window-mixed',includeOdds:false,leagueKeys:['nba']});assert.equal(slate.games.length,1);assert.equal(slate.games[0].id,'wanted');const report=slate.scoreboardCoverage[0];assert.equal(report.reportedEvents,4);assert.equal(report.acceptedLocalDayGames,1);assert.equal(report.outsideLocalDayGames,1);assert.equal(report.invalidRows,2);assert.equal(report.windowStatus,'different_declared_day');assert.ok(slate.diagnostics.some(line=>line.includes('1 accepted local-day')&&line.includes('1 outside day')));
});
test('weekly events outside the requested local day never enter its slate',async t=>{
 t.mock.method(globalThis,'fetch',async input=>new URL(input).hostname==='site.api.espn.com'?new Response('Denied',{status:403}):Response.json({content:{dateParams:{date:'20990205',year:2099,week:7,seasontype:2},isWeekOriented:true,sbData:{events:[event('2099-02-04T20:00Z')]}}}));
 const slate=await buildDailySlate(new Date('2099-02-05T18:00:00Z'),{guildId:'cdn-window-week',includeOdds:false,leagueKeys:['nfl']});assert.equal(slate.games.length,0);assert.equal(slate.scoreboardCoverage[0].windowStatus,'declared_weekly_window');assert.equal(slate.scoreboardCoverage[0].outsideLocalDayGames,1);
});
