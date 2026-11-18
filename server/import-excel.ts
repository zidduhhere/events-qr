import { spawnSync } from 'node:child_process'
import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { createDatabase, migrate, transaction } from './db.ts'
import { audit } from './operations.ts'
interface Row {registration:string;name:string;hospital:string;phone:string;category:string;foodRequirement:string;meals:number[];sheet:string;row:number}
export async function importExcel(path:string, db:Awaited<ReturnType<typeof createDatabase>>) {
 const parser=spawnSync('python3',[resolve('scripts/read-registration-xlsx.py'),path],{encoding:'utf8',maxBuffer:8*1024*1024})
 if(parser.error||parser.status!==0)throw new Error(parser.error?.message??parser.stderr)
 const data=JSON.parse(parser.stdout) as {sha256:string;records:Row[];summary:unknown}
 if(data.sha256!==createHash('sha256').update(readFileSync(path)).digest('hex'))throw new Error('Workbook changed while reading.')
 return transaction(db,async c=>{
  if((await c.query('SELECT id FROM registration_imports WHERE id=$1',[data.sha256])).rows.length)return {imported:0,alreadyImported:true}
  for(const r of data.records)if((await c.query('SELECT id FROM participants WHERE registration_number=$1',[r.registration])).rows.length)throw new Error('Registration already exists: '+r.registration+'. Existing records were not overwritten.')
  await c.query("INSERT INTO passes VALUES('registered','Unassigned',0,0,0) ON CONFLICT DO NOTHING")
  const sessions=[['2026-11-28 · Lunch','lunch'],['2026-11-28 · Dinner','dinner'],['2026-11-29 · Lunch','lunch']]
  const sessionIds:string[]=[]
  for(const [name,type] of sessions){const found=(await c.query<{id:string}>('SELECT id FROM meal_sessions WHERE name=$1 AND meal_type=$2',[name,type])).rows;if(found.length>1)throw new Error('Ambiguous event meal session: '+name);const id=found[0]?.id??randomUUID();if(!found.length)await c.query("INSERT INTO meal_sessions(id,name,meal_type,status,per_person_limit) VALUES($1,$2,$3,'closed',1)",[id,name,type]);sessionIds.push(id)}
  const ids=new Map(data.records.map(r=>[r.registration,randomUUID()]));let linked=0;const unresolved:string[]=[]
  await c.query('PRAGMA defer_foreign_keys=ON')
  for(const r of data.records){let parentId:string|null=null
   if(r.category==='Accompany'){
    const parentName=r.name.match(/\((?:Accompanying )?(.*?)\)/)?.[1]?.trim()
    const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'')
    let matches=data.records.filter(p=>p.category!=='Accompany'&&normalize(p.name)===normalize(parentName??''))
    // A place suffix in the guest label may disambiguate repeated parent names.
    if(!matches.length&&parentName?.includes(' - ')){const [name,place]=parentName.split(' - ');matches=data.records.filter(p=>p.category!=='Accompany'&&normalize(p.name)===normalize(name)&&normalize(p.hospital).includes(normalize(place)))}
    if(matches.length===1){parentId=ids.get(matches[0].registration)!;linked++}else unresolved.push(r.registration)
   }
   const phone=['—','-',''].includes(r.phone.trim())?'':r.phone.trim()
   const lunch=r.meals[0]+r.meals[2],dinner=r.meals[1]
   await c.query('INSERT INTO participants(id,name,phone,pass_id,parent_id,qr_token,lunch_override,dinner_override,total_override,registration_number,category,hospital,food_requirement,source_import) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[ids.get(r.registration),r.name,phone,'registered',parentId,'evt_'+randomBytes(24).toString('base64url'),lunch,dinner,lunch+dinner,r.registration,r.category,r.hospital,r.foodRequirement,data.sha256])
   for(let i=0;i<3;i++)await c.query('INSERT INTO participant_meal_eligibility VALUES($1,$2,$3)',[ids.get(r.registration),sessionIds[i],r.meals[i]])
   await audit(c,'participant.imported',ids.get(r.registration)!,'',{registration:r.registration,category:r.category,sourceSheet:r.sheet,sourceRow:r.row,sourceHash:data.sha256,parentId,meals:r.meals})
  }
  await c.query('INSERT INTO registration_imports(id,filename,summary) VALUES($1,$2,$3)',[data.sha256,basename(path),JSON.stringify(data.summary)])
  await audit(c,'workbook.imported',data.sha256,'',{count:data.records.length,linkedGuests:linked,unresolvedGuests:unresolved,summary:data.summary})
  return {imported:data.records.length,linkedGuests:linked,unresolvedGuests:unresolved,summary:data.summary}
 })
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 const path=process.argv[2]??'imports/category-wise-tag.xlsx';const db=await createDatabase()
 try{await migrate(db);console.log(JSON.stringify(await importExcel(path,db),null,2))}finally{await db.end()}
}
