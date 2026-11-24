import {spawnSync} from 'node:child_process'
import {randomBytes,randomUUID} from 'node:crypto'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {DatabaseSync,backup} from 'node:sqlite'
import {createDatabase,migrate,transaction} from './db.ts'
import type {Database,Connection} from './db.ts'
import {audit} from './operations.ts'
import {ensureQrImage} from './qr.ts'
export interface FinalRow{registration:string;name:string;phone:string;hospital:string;category:string;foodRequirement:string;meals:number[];sheet:string;row:number}
export interface FinalData{sha256:string;records:FinalRow[];summary:unknown;sources?:unknown}
interface Existing{id:string;registration_number:string|null;name:string;phone:string;hospital:string|null;category:string|null;food_requirement:string|null;source_import:string|null;removed_at:string|null;parent_id:string|null;lunch_override:number|null;dinner_override:number|null;total_override:number|null}
const sessionNames=['2026-11-28 · Lunch','2026-11-28 · Dinner','2026-11-29 · Lunch']
const normalize=(value:string|null)=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')
function assertInput(data:FinalData){
 if(!data.sha256||!data.records.length)throw new Error('Empty final list or missing source hash.')
 const seen=new Set<string>()
 for(const r of data.records){if(!r.registration||!r.name||r.name.length>120||seen.has(r.registration)||r.meals.length!==3||r.meals.some(n=>n!==0&&n!==1))throw new Error('Invalid or duplicate final registration: '+r.registration);seen.add(r.registration)}
}
export async function planFinal(db:Pick<Connection,'query'>,data:FinalData){
 assertInput(data)
 const existing=(await db.query<Existing>('SELECT id,registration_number,name,phone,hospital,category,food_requirement,source_import,removed_at,parent_id,lunch_override,dinner_override,total_override FROM participants')).rows
 const previous=(await db.query<{participant_id:string;name:string;eligible:number}>('SELECT e.participant_id,s.name,e.eligible FROM participant_meal_eligibility e JOIN meal_sessions s ON s.id=e.session_id')).rows
 const used=new Set<string>();const conflicts:string[]=[]
 const matches=data.records.map(row=>{
  const name=normalize(row.name)
  // A registration number is not an identity: the final directory renumbered people.
  let candidates=existing.filter(p=>normalize(p.name)===name)
  if(candidates.length>1){const contextual=candidates.filter(p=>normalize(p.hospital)===normalize(row.hospital)||(normalize(row.phone).length>6&&normalize(p.phone)===normalize(row.phone)));if(contextual.length===1)candidates=contextual}
  if(!candidates.length)candidates=existing.filter(p=>normalize(row.phone).length>6&&normalize(p.phone)===normalize(row.phone)&&normalize(p.hospital)===normalize(row.hospital)&&(normalize(p.name).startsWith(name)||name.startsWith(normalize(p.name))))
  if(candidates.length>1)conflicts.push('Ambiguous identity: '+row.registration+' / '+row.name)
  const before=candidates.length===1?candidates[0]:undefined
  if(before&&used.has(before.id))conflicts.push('Multiple final entries match one existing person: '+row.registration)
  if(before)used.add(before.id)
  const beforeMeals=before?sessionNames.map(name=>previous.find(e=>e.participant_id===before.id&&e.name===name)?.eligible??null):null
  const foodChanged=!!before&&(beforeMeals!.some((n,i)=>n!==row.meals[i])||before.lunch_override!==row.meals[0]+row.meals[2]||before.dinner_override!==row.meals[1]||before.total_override!==row.meals.reduce((a,b)=>a+b,0))
  const changed=!!before&&(foodChanged||before.registration_number!==row.registration||before.name!==row.name||before.phone!==row.phone||before.hospital!==row.hospital||before.category!==row.category||before.food_requirement!==row.foodRequirement||!!before.removed_at)
  return {row,before,beforeMeals,foodChanged,changed,matchMethod:!before?'new':normalize(before.name)===name?'name':'name-phone-hospital',id:before?.id??randomUUID()}
 })
 const absent=existing.filter(p=>p.source_import&&!used.has(p.id)&&!p.removed_at)
 // Never silently overwrite a manually added person's registration number.
 const releasing=new Set([...matches.filter(m=>m.before).map(m=>m.id),...absent.map(p=>p.id)])
 for(const m of matches){const owner=existing.find(p=>p.registration_number===m.row.registration);if(owner&&owner.id!==m.id&&!releasing.has(owner.id))conflicts.push('Registration belongs to an unmatched existing record: '+m.row.registration)}
 if(conflicts.length)throw new Error(conflicts.join('\n'))
 const totals=[0,1,2].map(i=>data.records.reduce((n,r)=>n+r.meals[i],0))
 return {matches,absent,summary:{finalRegistrations:data.records.length,matched:matches.filter(m=>m.before).length,added:matches.filter(m=>!m.before).length,updated:matches.filter(m=>m.changed).length,foodChanged:matches.filter(m=>m.foodChanged).length,renumbered:matches.filter(m=>m.before&&m.before.registration_number!==m.row.registration).length,removedFromFinal:absent.length,manualRegistrationsPreserved:existing.filter(p=>!p.source_import&&!used.has(p.id)&&!p.removed_at).length,mealTotals:totals}}
}
export async function reconcileFinal(db:Database,data:FinalData){
 return transaction(db,async c=>{
  const plan=await planFinal(c,data)
  const existingBatch=(await c.query('SELECT id FROM registration_imports WHERE id=$1',[data.sha256])).rows.length>0
  if(existingBatch&&!plan.summary.added&&!plan.summary.updated&&!plan.summary.removedFromFinal)return {...plan.summary,alreadyApplied:true,unresolvedGuests:[] as string[]}
  const sessions=(await c.query<{id:string;name:string;meal_type:string}>('SELECT id,name,meal_type FROM meal_sessions WHERE archived=0')).rows
  const ids=sessionNames.map((name,i)=>{const found=sessions.filter(s=>s.name===name&&s.meal_type===(i===1?'dinner':'lunch'));if(found.length!==1)throw new Error('Expected exactly one event session: '+name);return found[0].id})
  await c.query("INSERT INTO passes VALUES('registered','Unassigned',0,0,0) ON CONFLICT DO NOTHING")
  // Release old numbers in one transaction so permutations cannot violate uniqueness.
  for(const m of plan.matches)if(m.before)await c.query('UPDATE participants SET registration_number=NULL WHERE id=$1',[m.id])
  for(const p of plan.absent){
   const guests=(await c.query<{id:string}>('SELECT id FROM participants WHERE parent_id=$1',[p.id])).rows
   for(const g of guests){await c.query('UPDATE participants SET parent_id=NULL WHERE id=$1',[g.id]);await audit(c,'participant.updated',g.id,'',{reason:'Parent absent from final list',before:{parentId:p.id},after:{parentId:null}})}
   await c.query("UPDATE participants SET registration_number=NULL,removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=$1",[p.id])
   await audit(c,'participant.removed',p.id,'',{reason:'Absent from final CSV directory',sourceHash:data.sha256,before:p})
  }
  await c.query('PRAGMA defer_foreign_keys=ON')
  const unresolvedGuests:string[]=[]
  for(const m of plan.matches){const r=m.row;const lunch=r.meals[0]+r.meals[2],dinner=r.meals[1];let parentId=m.before?.parent_id??null
   if(r.category==='Accompany'){
    const parentName=r.name.match(/\((?:Accompanying )?(.*?)\)/)?.[1]
    let candidates=parentName?plan.matches.filter(p=>p.row.category!=='Accompany'&&normalize(p.row.name)===normalize(parentName)):[]
    if(candidates.length>1){const contextual=candidates.filter(p=>normalize(p.row.hospital)===normalize(r.hospital)||(normalize(r.phone).length>6&&normalize(p.row.phone)===normalize(r.phone)));if(contextual.length===1)candidates=contextual}
    if(!candidates.length&&parentName?.includes(' - ')){const [name,place]=parentName.split(' - ');candidates=plan.matches.filter(p=>p.row.category!=='Accompany'&&normalize(p.row.name)===normalize(name)&&normalize(p.row.hospital).includes(normalize(place)))}
    if(candidates.length===1)parentId=candidates[0].id
    else{unresolvedGuests.push(r.registration);if(!parentId||!plan.matches.some(p=>p.id===parentId&&p.row.category!=='Accompany'))parentId=null}
   }else if(parentId&&plan.absent.some(p=>p.id===parentId))parentId=null
   if(!m.before)await c.query('INSERT INTO participants(id,name,phone,pass_id,parent_id,qr_token,lunch_override,dinner_override,total_override,registration_number,category,hospital,food_requirement,source_import) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[m.id,r.name,r.phone,'registered',parentId,'evt_'+randomBytes(24).toString('base64url'),lunch,dinner,lunch+dinner,r.registration,r.category,r.hospital,r.foodRequirement,data.sha256])
   else await c.query('UPDATE participants SET name=$2,phone=$3,parent_id=$4,lunch_override=$5,dinner_override=$6,total_override=$7,registration_number=$8,category=$9,hospital=$10,food_requirement=$11,source_import=$12,removed_at=NULL WHERE id=$1',[m.id,r.name,r.phone,parentId,lunch,dinner,lunch+dinner,r.registration,r.category,r.hospital,r.foodRequirement,data.sha256])
   for(let i=0;i<3;i++)await c.query('INSERT INTO participant_meal_eligibility(participant_id,session_id,eligible) VALUES($1,$2,$3) ON CONFLICT(participant_id,session_id) DO UPDATE SET eligible=excluded.eligible',[m.id,ids[i],r.meals[i]])
   if(!m.before)await ensureQrImage(c,m.id)
   const parentChanged=!!m.before&&m.before.parent_id!==parentId
   if(m.changed||!m.before||parentChanged)await audit(c,m.before?'participant.updated':'participant.imported',m.id,'',{sourceHash:data.sha256,matchMethod:m.matchMethod,before:m.before?{...m.before,meals:m.beforeMeals}:null,after:{...r,parentId},qrPreserved:!!m.before})
   if(m.foodChanged)await audit(c,'allowance.changed',m.id,'',{sourceHash:data.sha256,before:{meals:m.beforeMeals,lunch:m.before?.lunch_override,dinner:m.before?.dinner_override,total:m.before?.total_override},after:{meals:r.meals,lunch,dinner,total:lunch+dinner}})
   await c.query('INSERT INTO final_registration_stage(batch_id,registration_number,participant_id,match_method,previous_json,desired_json) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(batch_id,registration_number) DO UPDATE SET participant_id=excluded.participant_id,match_method=excluded.match_method,previous_json=excluded.previous_json,desired_json=excluded.desired_json',[data.sha256,r.registration,m.id,m.matchMethod,JSON.stringify(m.before?{...m.before,meals:m.beforeMeals}:null),JSON.stringify(r)])
  }
  if((await c.query('PRAGMA foreign_key_check')).rows.length)throw new Error('Foreign key check failed; final-list update rolled back.')
  await c.query('INSERT INTO registration_imports(id,filename,summary) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary',[data.sha256,'final-csv',JSON.stringify({summary:data.summary,sources:data.sources})])
  const result={...plan.summary,unresolvedGuests}
  await audit(c,'directory.reconciled',data.sha256,'',result)
  return result
 })
}
export function readFinalCsv(folder:string):FinalData{
 const r=spawnSync('python3',[resolve('scripts/read-final-csv.py'),folder],{encoding:'utf8',maxBuffer:8*1024*1024});if(r.error||r.status!==0)throw new Error(r.error?.message??r.stderr);return JSON.parse(r.stdout)
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const folder=process.argv.find(a=>a.startsWith('--folder='))?.slice(9)??'imports/final';const apply=process.argv.includes('--apply');const data=readFinalCsv(folder);const db=await createDatabase()
 try{
  await migrate(db);const plan=await planFinal(db,data);await mkdir(folder,{recursive:true});await writeFile(resolve(folder,'comparison.json'),JSON.stringify(plan,null,2));console.log(JSON.stringify(plan.summary,null,2))
  if(apply){
   const sourcePath=resolve(process.env.SQLITE_PATH??'data/events.db');const backupPath=resolve(dirname(sourcePath),'backups','before-final-'+new Date().toISOString().replace(/[:.]/g,'-')+'.db');await mkdir(dirname(backupPath),{recursive:true});const source=new DatabaseSync(sourcePath,{readOnly:true});try{await backup(source,backupPath)}finally{source.close()}
   console.log('Backup saved: '+backupPath);const result=await reconcileFinal(db,data);await writeFile(resolve(folder,'applied-summary.json'),JSON.stringify(result,null,2));console.log('Applied: '+JSON.stringify(result))
   const query=await readFile(new URL('./sql/final-list-cross-check.sql',import.meta.url),'utf8');const check=(await db.query(query)).rows;await writeFile(resolve(folder,'verification.json'),JSON.stringify(check,null,2));console.log('Cross-check: '+JSON.stringify(check))
  }else console.log('Comparison only. Run with --apply to update SQLite. Full comparison: '+resolve(folder,'comparison.json'))
 }finally{await db.end()}
}
