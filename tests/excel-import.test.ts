import test from 'node:test'
import assert from 'node:assert/strict'
import { createDatabase, migrate } from '../server/db.ts'
import { importExcel } from '../server/import-excel.ts'
import { redeem, getParticipant } from '../server/operations.ts'
test('workbook import preserves counts, QR identities, guest links and per-session exclusions',async()=>{
 const db=await createDatabase(':memory:')
 try{
  await migrate(db);const result=await importExcel('imports/category-wise-tag.xlsx',db);assert.equal(result.imported,369)
  assert.equal((await db.query<{n:number}>('SELECT count(*) AS n FROM participants WHERE phone=$1',[''])).rows[0].n,124)
  const sessions=(await db.query<{id:string;name:string}>('SELECT * FROM meal_sessions WHERE name LIKE $1',['2026-%'])).rows
  assert.equal(sessions.length,3)
  const totals=(await db.query<{n:number}>('SELECT sum(eligible) AS n FROM participant_meal_eligibility GROUP BY session_id ORDER BY n')).rows.map(r=>r.n);assert.deepEqual(totals,[291,356,357])
  const p=(await db.query<{id:string;qr_token:string}>("SELECT * FROM participants WHERE registration_number='ISGP080'")).rows[0]
  const dinner=sessions.find(s=>s.name.includes('Dinner'))!
  await db.query("UPDATE meal_sessions SET status='open' WHERE id=$1",[dinner.id]);const denied=await redeem(db,{requestId:crypto.randomUUID(),qrToken:p.qr_token,sessionId:dinner.id,deviceLabel:'Gate 1'});assert.equal(denied.approved,false);assert.match(denied.reason,/not included/)
  const eligible=(await db.query<{qr_token:string}>("SELECT p.qr_token FROM participants p JOIN participant_meal_eligibility e ON p.id=e.participant_id WHERE e.session_id=$1 AND e.eligible=1 LIMIT 1",[dinner.id])).rows[0];assert.equal((await redeem(db,{requestId:crypto.randomUUID(),qrToken:eligible.qr_token,sessionId:dinner.id,deviceLabel:'Gate 1'})).approved,true)
  const qr=p.qr_token;assert.equal((await importExcel('imports/category-wise-tag.xlsx',db)).imported,0);assert.equal((await getParticipant(db,p.id)).qr_token,qr)
  const guest=(await db.query<{parent_id:string}>("SELECT * FROM participants WHERE registration_number='ISGK0204'")).rows[0];assert.ok(guest.parent_id)
 }finally{await db.end()}
})
