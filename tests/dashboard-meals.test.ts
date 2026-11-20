import test from 'node:test'
import assert from 'node:assert/strict'
import {createDatabase,migrate} from '../server/db.ts'
import {importExcel} from '../server/import-excel.ts'
import {dashboard,redeem,voidRedemption} from '../server/operations.ts'
test('dashboard separates meal eligibility, exclusions and remaining registered attendees',async()=>{
 const db=await createDatabase(':memory:')
 try{
  await migrate(db);await importExcel('imports/category-wise-tag.xlsx',db)
  let data=await dashboard(db)
  const meals=data.sessions.filter(s=>s.registration_total)
  assert.deepEqual(meals.map(s=>[s.name,s.expected,s.not_included,s.expected_remaining]),[
   ['2026-11-28 · Dinner',291,78,291],['2026-11-28 · Lunch',357,12,357],['2026-11-29 · Lunch',356,13,356]
  ])
  const lunch=meals.find(s=>s.name==='2026-11-28 · Lunch')!
  const attendee=(await db.query<{qr_token:string}>("SELECT p.qr_token FROM participants p JOIN participant_meal_eligibility e ON e.participant_id=p.id WHERE e.session_id=$1 AND e.eligible=1 LIMIT 1",[lunch.id])).rows[0]
  await db.query("UPDATE meal_sessions SET status='open' WHERE id=$1",[lunch.id])
  const result=await redeem(db,{requestId:crypto.randomUUID(),qrToken:attendee.qr_token,sessionId:lunch.id,deviceLabel:'Gate 1'})
  data=await dashboard(db);let session=data.sessions.find(s=>s.id===lunch.id)!
  assert.equal(session.expected,357);assert.equal(session.registered_served,1);assert.equal(session.expected_remaining,356)
  await voidRedemption(db,result.redemptionId!,'Correction','Gate 1')
  data=await dashboard(db);session=data.sessions.find(s=>s.id===lunch.id)!
  assert.equal(session.registered_served,0);assert.equal(session.expected_remaining,357)
 }finally{await db.end()}
})
