import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createDatabase,migrate} from '../server/db.ts'
import {createParticipant,redeem,listSessions,listRedemptions,listAudit,getParticipant,dashboard} from '../server/operations.ts'
import {planFinal,reconcileFinal} from '../server/reconcile-final.ts'
import type {FinalData,FinalRow} from '../server/reconcile-final.ts'
const participant=(name:string)=>({name,phone:'',passId:'silver' as const,parentId:null,lunchOverride:2,dinnerOverride:1,totalOverride:3,deviceLabel:''})
const row=(registration:string,name:string,meals:number[]):FinalRow=>({registration,name,phone:'',hospital:'Example Hospital',category:'Delegates',foodRequirement:'Final selection',meals,sheet:'Delegates',row:5})
test('final list safely swaps registration numbers, preserves QRs/history, adds and removes people, and changes food',async()=>{
 const db=await createDatabase(':memory:');try{
  await migrate(db)
  const alice=await createParticipant(db,participant('Alice'));const bob=await createParticipant(db,participant('Bob'));const gone=await createParticipant(db,participant('Absent'));const manual=await createParticipant(db,participant('Walk-in'))
  const old=[alice,bob,gone];const sessions=await listSessions(db);const lunch=sessions.find(s=>s.name==='2026-11-28 · Lunch')!;const dinner=sessions.find(s=>s.meal_type==='dinner')!
  for(let i=0;i<old.length;i++){
   await db.query('UPDATE participants SET registration_number=$2,source_import=$3,hospital=$4,category=$5 WHERE id=$1',[old[i].id,'OLD'+(i+1),'old-hash','Example Hospital','Delegates'])
   for(const s of sessions)await db.query('INSERT INTO participant_meal_eligibility VALUES($1,$2,$3)',[old[i].id,s.id,s.meal_type==='dinner'?0:1])
  }
  await db.query("UPDATE meal_sessions SET status='open' WHERE id=$1",[lunch.id])
  const used=await redeem(db,{requestId:crypto.randomUUID(),qrToken:alice.qr_token,sessionId:lunch.id,deviceLabel:'Gate test'});assert.equal(used.approved,true)
  const data:FinalData={sha256:'final-test',summary:[],records:[row('OLD2','Alice',[1,1,1]),row('OLD1','Bob',[0,0,1]),row('OLD3','New person',[1,0,1])]}
  const plan=await planFinal(db,data);assert.equal(plan.summary.added,1);assert.equal(plan.summary.renumbered,2);assert.equal(plan.summary.removedFromFinal,1);assert.equal(plan.summary.manualRegistrationsPreserved,1)
  const result=await reconcileFinal(db,data);assert.equal(result.added,1)
  const a=await getParticipant(db,alice.id);assert.equal(a.qr_token,alice.qr_token);assert.equal(a.registration_number,'OLD2');assert.equal(a.remaining.lunch,1);assert.equal(a.remaining.dinner,1)
  assert.equal((await getParticipant(db,bob.id)).qr_token,bob.qr_token)
  await assert.rejects(getParticipant(db,gone.id),/not found/)
  assert.equal((await getParticipant(db,manual.id)).source_import,null)
  assert.equal((await dashboard(db)).participants,4);assert.equal((await listRedemptions(db)).length,1)
  const query=await readFile(new URL('../server/sql/final-list-cross-check.sql',import.meta.url),'utf8');const verification=(await db.query<{mismatched_registrations:number;final_registrations:number}>(query)).rows[0];assert.equal(verification.final_registrations,3);assert.equal(verification.mismatched_registrations,0)
  await db.query("UPDATE meal_sessions SET status='open' WHERE id=$1",[dinner.id])
  assert.equal((await redeem(db,{requestId:crypto.randomUUID(),qrToken:alice.qr_token,sessionId:dinner.id,deviceLabel:''})).approved,true)
  assert.equal((await redeem(db,{requestId:crypto.randomUUID(),qrToken:bob.qr_token,sessionId:dinner.id,deviceLabel:''})).approved,false)
  const before=(await listAudit(db)).length;assert.equal((await reconcileFinal(db,data)).alreadyApplied,true);assert.equal((await listAudit(db)).length,before)
  assert.equal((await db.query('SELECT * FROM participant_qr_images')).rows.length,5)
  await db.query('UPDATE participants SET dinner_override=9 WHERE id=$1',[bob.id]);assert.equal((await db.query<{mismatched_registrations:number}>(query)).rows[0].mismatched_registrations,1)
 }finally{await db.end()}
})
test('ambiguous names, duplicate registration IDs and conflicting manual records block the update',async()=>{
 const db=await createDatabase(':memory:');try{await migrate(db);await createParticipant(db,participant('Same name'));await createParticipant(db,participant('Same name'))
  const data:FinalData={sha256:'bad',summary:[],records:[row('X','Same name',[1,1,1])]};await assert.rejects(reconcileFinal(db,data),/Ambiguous identity/)
  await assert.rejects(reconcileFinal(db,{...data,records:[row('X','Other',[1,1,1]),row('X','Another',[1,1,1])]}),/duplicate/)
  const manual=await createParticipant(db,participant('Manual owner'));await db.query('UPDATE participants SET registration_number=$2 WHERE id=$1',[manual.id,'X'])
  await assert.rejects(reconcileFinal(db,{...data,records:[row('X','Different person',[1,1,1])]}),/unmatched existing/)
  assert.equal((await db.query('SELECT * FROM registration_imports')).rows.length,0)
 }finally{await db.end()}
})
