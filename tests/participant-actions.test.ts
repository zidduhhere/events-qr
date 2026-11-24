import test from 'node:test'
import assert from 'node:assert/strict'
import {createDatabase,migrate} from '../server/db.ts'
import {createParticipant,removeParticipant,manualDinnerCheckIn,listParticipants,listSessions,redeem,dashboard,listRedemptions,listAudit,getParticipant} from '../server/operations.ts'
const input={name:'Action Test',phone:'',passId:'silver' as const,parentId:null,lunchOverride:null,dinnerOverride:null,totalOverride:null,deviceLabel:'Dashboard'}
test('manual dinner uses redemption protections, retries and an explicit audit source',async()=>{
 const db=await createDatabase(':memory:');try{await migrate(db);const p=await createParticipant(db,input);const sessions=await listSessions(db);const dinner=sessions.find(s=>s.meal_type==='dinner')!;const lunch=sessions.find(s=>s.meal_type==='lunch')!
 const request={participantId:p.id,sessionId:dinner.id,requestId:crypto.randomUUID(),deviceLabel:'Desk'}
 assert.equal((await manualDinnerCheckIn(db,request)).approved,false)
 await db.query("UPDATE meal_sessions SET status='open' WHERE id=$1",[dinner.id])
 const fresh={...request,requestId:crypto.randomUUID()};const [a,b]=await Promise.all([manualDinnerCheckIn(db,fresh),manualDinnerCheckIn(db,fresh)]);assert.equal(a.approved,true);assert.deepEqual(a,b)
 assert.equal((await manualDinnerCheckIn(db,{...fresh,requestId:crypto.randomUUID()})).approved,false)
 await assert.rejects(manualDinnerCheckIn(db,{...fresh,sessionId:lunch.id,requestId:crypto.randomUUID()}),/dinner/)
 assert.equal((await dashboard(db)).dinner,1);assert.equal((await listAudit(db)).find(a=>a.action==='meal.redeemed')?.details.entryMethod,'manual')
 }finally{await db.end()}
})
test('removal disables QR and excludes the participant while retaining guests, attendance and audit',async()=>{
 const db=await createDatabase(':memory:');try{await migrate(db);const p=await createParticipant(db,input);const guest=await createParticipant(db,{...input,name:'Guest',parentId:p.id});const dinner=(await listSessions(db)).find(s=>s.meal_type==='dinner')!;await db.query("UPDATE meal_sessions SET status='open' WHERE id=$1",[dinner.id]);await manualDinnerCheckIn(db,{requestId:crypto.randomUUID(),participantId:p.id,sessionId:dinner.id,deviceLabel:''})
 assert.equal((await removeParticipant(db,p.id,'Duplicate registration','Desk')).removed,true)
 assert.equal((await listParticipants(db)).length,1);assert.equal((await getParticipant(db,guest.id)).parent_id,null)
 await assert.rejects(getParticipant(db,p.id),/not found/)
 assert.equal((await redeem(db,{requestId:crypto.randomUUID(),qrToken:p.qr_token,sessionId:dinner.id,deviceLabel:''})).approved,false)
 assert.equal((await listRedemptions(db)).length,1);assert.equal((await dashboard(db)).participants,1);assert.ok((await listAudit(db)).some(a=>a.action==='participant.removed'&&a.details.reason==='Duplicate registration'))
 assert.equal((await db.query('PRAGMA foreign_key_check')).rows.length,0)
 }finally{await db.end()}
})
