import test from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createDatabase, migrate } from '../server/db.ts'
import { createApp } from '../server/app.ts'
import { createParticipant, redeem, saveSession, updatePass, voidRedemption, listAudit } from '../server/operations.ts'

test('SQLite: validation, idempotency, concurrent limits, voids and audit', async t => {
 const pool=await createDatabase(':memory:')
 try{
  await migrate(pool)
  const p=await createParticipant(pool,{name:'Gate Test',phone:'9876543210',passId:'silver',parentId:null,lunchOverride:null,dinnerOverride:null,totalOverride:null,deviceLabel:'Test gate'})
  const session=await saveSession(pool,null,{name:'Test lunch',mealType:'lunch',status:'open',perPersonLimit:1,deviceLabel:'Test gate'})
  const input={requestId:crypto.randomUUID(),qrToken:p.qr_token,sessionId:session.id,deviceLabel:'Test gate'}
  let redemptionId=''
  await t.test('same UUID retries return the same single redemption',async()=>{const [a,b]=await Promise.all([redeem(pool,input),redeem(pool,input)]);assert.equal(a.approved,true);assert.deepEqual(a,b);redemptionId=a.redemptionId!;assert.equal((await pool.query('SELECT * FROM redemptions')).rows.length,1)})
  await t.test('changed payload cannot reuse UUID',async()=>{await assert.rejects(redeem(pool,{...input,qrToken:'another-token'}),/another scan/)})
  await t.test('distinct UUIDs cannot bypass session limit',async()=>{assert.equal((await redeem(pool,{...input,requestId:crypto.randomUUID()})).approved,false)})
  await t.test('void restores capacity and preserves its reason',async()=>{await voidRedemption(pool,redemptionId,'Wrong entry','Test gate');await assert.rejects(voidRedemption(pool,redemptionId,'Again','Test gate'),/already been voided/);assert((await listAudit(pool)).some(a=>a.action==='redemption.voided'&&a.details.reason==='Wrong entry'))})
  await t.test('two gates competing for final total allowance yield exactly one approval',async()=>{await updatePass(pool,'silver',{lunch:2,dinner:2,total:1,deviceLabel:'Test gate'});const results=await Promise.all([redeem(pool,{...input,requestId:crypto.randomUUID()}),redeem(pool,{...input,requestId:crypto.randomUUID()})]);assert.equal(results.filter(r=>r.approved).length,1)})
  await t.test('closed sessions and unknown tokens are denied',async()=>{const closed=await saveSession(pool,null,{name:'Closed dinner',mealType:'dinner',status:'closed',perPersonLimit:1,deviceLabel:''});assert.equal((await redeem(pool,{...input,requestId:crypto.randomUUID(),sessionId:closed.id})).approved,false);assert.equal((await redeem(pool,{...input,requestId:crypto.randomUUID(),qrToken:'unknown'})).approved,false)})
  await t.test('malformed HTTP requests fail before redemption without opening a port',async()=>{
    const request=Object.assign(Readable.from([JSON.stringify({requestId:'bad',qrToken:'x',sessionId:'bad'})]),{method:'POST',url:'/api/redemptions',headers:{'content-type':'application/json'}}) as unknown as IncomingMessage
    let status=0
    await new Promise<void>((resolve,reject)=>{const response={headersSent:false,setHeader(){},writeHead(code:number){status=code},end(value:string){try{assert.equal(status,400);assert.match(JSON.parse(value).error,/UUID/);resolve()}catch(e){reject(e)}}} as unknown as ServerResponse;createApp(pool)(request,response)})
  })
 }finally{await pool.end()}
})
