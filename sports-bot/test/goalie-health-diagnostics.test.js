import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlayerProfilesAndLineups} from '../src/advancedMetrics.js';
const game=()=>({id:'fixture',leagueKey:'nhl',league:'NHL',sportGroup:'Hockey',away:{name:'Away'},home:{name:'Home'},autoPlayers:[],autoLineups:[]});
const goalie=patch=>({athleteId:'1',name:'Goalie',team:'Away',role:'Goalie',starter:true,confirmedStarter:true,...patch});

test('unknown availability is not counted as a learned injury',()=>{
 const g=game();g.autoPlayers=[goalie({availability:null})];
 const profile={athleteId:'1',name:'Goalie',team:'Away',leagueKey:'nhl',impact:4,form:50,sampleSize:2};
 assert.equal(applyPlayerProfilesAndLineups([g],{one:profile}).learnedInjuries,0);
 g.autoPlayers[0].availability=0;assert.equal(applyPlayerProfilesAndLineups([g],{one:profile}).learnedInjuries,1);
});

test('roster-only confirmed goalie role is distinct from unknown health and usable model inputs',()=>{
 const g=game();g.autoLineups=[goalie({})];applyPlayerProfilesAndLineups([g]);
 assert.equal(g.autoLineup.away.criticalRoleEvidence.confirmed,1);
 assert.equal(g.autoLineup.away.criticalRoleEvidence.healthUnknown,1);
 assert.equal(g.autoLineup.away.criticalStarterCount,0);assert.equal(g.autoPlayers.length,0);
});

test('projected and explicitly unavailable goalies cannot become confirmed healthy evidence',()=>{
 const g=game();g.autoPlayers=[goalie({confirmedStarter:false,confirmationStatus:'projected',availability:null})];
 applyPlayerProfilesAndLineups([g]);assert.equal(g.autoLineup.away.criticalRoleEvidence.confirmed,0);assert.equal(g.autoLineup.away.criticalRoleEvidence.projected,1);
 g.autoPlayers=[goalie({availability:0,status:'Out'})];g.autoLineups=[goalie({})];applyPlayerProfilesAndLineups([g]);
 assert.equal(g.autoLineup.away.criticalRoleEvidence.confirmed,0);assert.equal(g.autoLineup.away.criticalStarterCount,0);
});
