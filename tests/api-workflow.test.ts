import test from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {createDatabase,migrate} from '../server/db.ts'
import {createApp} from '../server/app.ts'
import type {Participant,MealSession,RedemptionResult} from '../shared/types.ts'
test('real API handlers: registration, guest, editing, sessions, redemption, voids, settings, artwork and exports',async()=>{
 const db=await createDatabase(':memory:')
 try{
  await migrate(db);const app=createApp(db)
  async function request(path:string,method='GET',body?:unknown,headers:Record<string,string>={}){
   const req=Object.assign(Readable.from(body===undefined?[]:[JSON.stringify(body)]),{url:path,method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers}}) as unknown as IncomingMessage
   let status=0;const responseHeaders:Record<string,string>={}
   const bytes=await new Promise<Buffer>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('API handler timed out: '+path)),5000);const res={headersSent:false,setHeader(k:string,v:string){responseHeaders[k.toLowerCase()]=v},writeHead(code:number,h:Record<string,string>={}){status=code;for(const [k,v]of Object.entries(h))responseHeaders[k.toLowerCase()]=v;this.headersSent=true},end(value?:string|Buffer){clearTimeout(timer);resolve(Buffer.isBuffer(value)?value:Buffer.from(value??''))}};app(req,res as unknown as ServerResponse)})
   return {status,headers:responseHeaders,bytes,json:<T>()=>JSON.parse(bytes.toString()) as T}
  }
  assert.equal((await request('/api/health')).status,200)
  const input={name:'API test',phone:'',passId:'silver',deviceLabel:'Gate test'}
  const created=await request('/api/participants','POST',input);assert.equal(created.status,201);const p=created.json<Participant>()
  assert.ok(p.qr_token);assert.equal((await request('/api/participants/'+p.id)).status,200)
  assert.equal((await request('/api/participants/'+p.id,'PUT',{...input,name:'Edited API test',parentId:null})).status,200)
  const guest=await request('/api/participants','POST',{...input,name:'Guest',parentId:p.id});assert.equal(guest.status,201)
  assert.equal((await request('/api/participants/'+p.id+'/family')).json<Participant[]>().length,2)
  const sessionBody={name:'API lunch',mealType:'lunch',status:'closed',perPersonLimit:1}
  const sessionResponse=await request('/api/sessions','POST',sessionBody);assert.equal(sessionResponse.status,201);const session=sessionResponse.json<MealSession>()
  assert.equal((await request('/api/sessions/'+session.id,'PUT',{...sessionBody,status:'open'})).status,200)
  const scan={requestId:crypto.randomUUID(),qrToken:p.qr_token,sessionId:session.id,deviceLabel:'Gate test'}
  const first=await request('/api/redemptions','POST',scan);assert.equal(first.status,200);const result=first.json<RedemptionResult>();assert.equal(result.approved,true)
  assert.deepEqual((await request('/api/redemptions','POST',scan)).json(),result)
  assert.equal((await request('/api/redemptions','POST',{...scan,requestId:crypto.randomUUID()})).json<RedemptionResult>().approved,false)
  assert.equal((await request('/api/redemptions/'+result.redemptionId+'/void','POST',{reason:'Test cleanup'})).status,200)
  assert.equal((await request('/api/redemptions/'+result.redemptionId+'/void','POST',{reason:'Again'})).status,409)
  assert.equal((await request('/api/passes/silver','PUT',{lunchLimit:3,dinnerLimit:1,totalLimit:4})).status,200)
  assert.equal((await request('/api/printing','PUT',{width:60,height:40})).status,200)
  const png=await request('/api/participants/'+p.id+'/qr.png?download=1');assert.equal(png.status,200);assert.equal(png.headers['content-type'],'image/png');assert.equal(png.bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
  const print=await request('/api/participants/'+p.id+'/print','POST',{});assert.equal(print.status,200);assert.match(print.json<{svg:string}>().svg,/<svg/)
  const zip=await request('/api/qr-export','POST',{});assert.equal(zip.status,200);assert.equal(zip.headers['content-type'],'application/zip');assert.equal(zip.bytes.readUInt32LE(0),0x04034b50)
  assert.equal((await request('/api/export')).headers['content-type'],'text/csv; charset=utf-8')
  for(const path of ['/api/dashboard','/api/participants','/api/passes','/api/sessions','/api/redemptions','/api/audit','/api/printing'])assert.equal((await request(path)).status,200,path)
  for(const path of ['/','/participants','/participants/'+p.id,'/scan','/settings','/reports']){const r=await request(path);assert.equal(r.status,200,path);assert.match(r.bytes.toString(),/<div id="root">/)}
  assert.equal((await request('/api/redemptions','POST',{})).status,400)
  assert.equal((await request('/api/participants','POST',input,{'sec-fetch-site':'cross-site',origin:'https://outside.invalid'})).status,403)
  assert.equal((await request('/api/participants/'+crypto.randomUUID())).status,404)
 }finally{await db.end()}
})
