import test from 'node:test';
import assert from 'node:assert/strict';
import {createDailyPostScheduler} from '../src/dailyPostScheduler.js';

const acknowledged={messageId:'message',channelId:'channel'};
function fixture(at,publish){
 let now=Date.parse(at);let calls=0;
 const scheduler=createDailyPostScheduler({timezone:'America/Chicago',clock:()=>now,publish:async guild=>{calls++;return publish?publish(guild,calls):acknowledged;}});
 return {scheduler,calls:()=>calls,at:value=>{now=Date.parse(value);},tick:()=>scheduler.tick('guild',{hour:8,minute:0})};
}
test('daily scheduler waits for local 08:00 and catches up after a missed exact minute',async()=>{
 const f=fixture('2026-10-26T12:59:59Z');assert.equal((await f.tick()).status,'not_due');assert.equal(f.calls(),0);
 f.at('2026-10-26T13:02:00Z');assert.equal((await f.tick()).status,'delivered');assert.equal(f.calls(),1);
 f.at('2026-10-26T20:00:00Z');assert.equal((await f.tick()).status,'already_delivered');assert.equal(f.calls(),1);
});
test('failed scheduled delivery retries outside the scheduled minute after backoff',async()=>{
 const f=fixture('2026-10-26T13:00:00Z',(_,calls)=>{if(calls===1)throw Object.assign(Error('history unavailable'),{code:'DAILY_HISTORY_UNAVAILABLE'});return acknowledged;});
 assert.equal((await f.tick()).status,'retry_scheduled');
 assert.equal(f.scheduler.snapshot('guild').nextRetryAt,'2026-10-26T13:01:00.000Z');
 f.at('2026-10-26T13:00:30Z');assert.equal((await f.tick()).status,'backoff');assert.equal(f.calls(),1);
 f.at('2026-10-26T13:01:00Z');assert.equal((await f.tick()).status,'delivered');assert.equal(f.calls(),2);
 assert.equal(f.scheduler.snapshot('guild').lastErrorCode,null);
});
test('null or incomplete delivery responses cannot mark the day delivered',async()=>{
 for(const response of [null,{}, {messageId:'only-message'}, {channelId:'only-channel'}]){
  const f=fixture('2026-10-26T13:00:00Z',()=>response);
  assert.equal((await f.tick()).status,'retry_scheduled');
  assert.equal(f.scheduler.snapshot('guild').lastErrorCode,'DAILY_POST_NOT_ACKNOWLEDGED');
 }
});
test('concurrent timer ticks cannot overlap an unfinished publication',async()=>{
 let finish;const f=fixture('2026-10-26T13:00:00Z',()=>new Promise(resolve=>{finish=resolve;}));
 const first=f.tick();assert.equal((await f.tick()).status,'in_progress');assert.equal(f.calls(),1);
 finish(acknowledged);assert.equal((await first).status,'delivered');
});
test('repeated failures back off to at most one attempt per hour without retaining raw errors',async()=>{
 const f=fixture('2026-10-26T13:00:00Z',()=>{throw Error('private credential must not enter scheduler state');});
 for(const [attempt,time,next] of [[1,'13:00','13:01'],[2,'13:01','13:06'],[3,'13:06','13:21'],[4,'13:21','13:51'],[5,'13:51','14:51'],[6,'14:51','15:51']]){
  f.at(`2026-10-26T${time}:00Z`);assert.equal((await f.tick()).status,'retry_scheduled');
  const state=f.scheduler.snapshot('guild');assert.equal(state.attempts,attempt);assert.equal(state.nextRetryAt,`2026-10-26T${next}:00.000Z`);
  assert.equal(state.lastErrorCode,'DAILY_POST_FAILED');assert.ok(!JSON.stringify(state).includes('private credential'));
 }
});
test('a later local day has a new schedule and cannot reuse the previous success',async()=>{
 const f=fixture('2026-10-26T23:00:00Z');await f.tick();
 f.at('2026-10-27T12:30:00Z');assert.equal((await f.tick()).status,'not_due');
 f.at('2026-10-27T13:00:00Z');assert.equal((await f.tick()).status,'delivered');
 assert.equal(f.scheduler.snapshot('guild').dateKey,'2026-10-27');assert.equal(f.calls(),2);
});
test('local schedule follows daylight-saving changes rather than a fixed UTC hour',async()=>{
 const f=fixture('2026-11-01T13:59:00Z');assert.equal((await f.tick()).status,'not_due');
 f.at('2026-11-01T14:00:00Z');assert.equal((await f.tick()).status,'delivered');
});
test('scheduler state is copied and guild failures do not suppress another guild',async()=>{
 let now=Date.parse('2026-10-26T13:00:00Z');
 const s=createDailyPostScheduler({timezone:'America/Chicago',clock:()=>now,publish:async guild=>guild==='bad'?null:acknowledged});
 await s.tick('bad',{hour:8,minute:0});await s.tick('good',{hour:8,minute:0});
 const copy=s.snapshot('bad');copy.status='delivered';assert.equal(s.snapshot('bad').status,'retry_scheduled');
 assert.equal(s.snapshot('good').status,'delivered');assert.equal(s.snapshot('missing'),null);
});
