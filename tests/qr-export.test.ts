import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createDatabase,migrate} from '../server/db.ts'
import {createParticipant,updateParticipant,getParticipant} from '../server/operations.ts'
import {ensureQrImage,exportQrZip,qrFilename} from '../server/qr.ts'
test('registration automatically stores a PNG; ZIP includes every person and exact mapping',async()=>{
 const db=await createDatabase(':memory:')
 try{await migrate(db);const input={name:'Same Name',phone:'',passId:'silver' as const,parentId:null,lunchOverride:null,dinnerOverride:null,totalOverride:null,deviceLabel:''};const a=await createParticipant(db,input);const b=await createParticipant(db,{...input,parentId:a.id});assert.notEqual(a.qr_token,b.qr_token);assert.notEqual(qrFilename(a),qrFilename(b));assert.equal((await db.query('SELECT participant_id FROM participant_qr_images')).rows.length,2)
  const png=await ensureQrImage(db,a.id);assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
  await updateParticipant(db,a.id,{...input,name:'Updated name'});assert.equal((await getParticipant(db,a.id)).qr_token,a.qr_token);assert.deepEqual(await ensureQrImage(db,a.id),png)
  const {zip,count}=await exportQrZip(db);assert.equal(count,2)
  const check=spawnSync('python3',['-c',`import sys,io,zipfile,csv\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nassert z.testzip() is None\nrows=list(csv.DictReader(io.StringIO(z.read('participants.csv').decode('utf-8-sig'))))\nassert len(rows)==2\nassert len([n for n in z.namelist() if n.endswith('.png')])==2\nassert len(set(r['QR image filename'] for r in rows))==2\nfor r in rows: assert z.read(r['QR image filename']).startswith(bytes.fromhex('89504e470d0a1a0a'))\nassert {r['Name'] for r in rows}=={'Updated name','Same Name'}\n`],{input:zip});assert.equal(check.status,0,check.stderr.toString())
  // Decode the actual generated PNG back to the original database token.
  const pngModule='pngjs';const zxModule='@zxing/library';const {PNG}=await import(pngModule);const zx=await import(zxModule);const image=PNG.sync.read(png);const pixels=new Int32Array(image.width*image.height);for(let i=0;i<pixels.length;i++){const j=i*4;pixels[i]=(image.data[j]<<16)|(image.data[j+1]<<8)|image.data[j+2]}const source=new zx.RGBLuminanceSource(pixels,image.width,image.height);const decoded=new zx.QRCodeReader().decode(new zx.BinaryBitmap(new zx.HybridBinarizer(source)));assert.equal(decoded.getText(),a.qr_token)
 }finally{await db.end()}
})
