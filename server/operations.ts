import { ensureQrImage } from './qr.ts'
import { randomUUID, randomBytes } from 'node:crypto'
import { transaction } from './db.ts'
import type { Database, Connection } from './db.ts'
import type { Allowance, Participant, ParticipantInput, RedemptionInput, RedemptionResult, MealSession, Pass, Redemption, AuditEvent, PrintSettings } from '../shared/types.ts'
import { HttpError } from './validation.ts'
export async function audit(c: Pick<Connection, 'query'>, action: string, id: string, label: string, details: unknown) {
  await c.query('INSERT INTO audit_events(id,action,entity_id,device_label,details) VALUES($1,$2,$3,$4,$5)', [randomUUID(), action, id, label, JSON.stringify(details)])
}
const participantSQL = `SELECT p.*, ps.name AS pass_name,
 COALESCE(p.lunch_override,ps.lunch_limit) AS lunch_limit, COALESCE(p.dinner_override,ps.dinner_limit) AS dinner_limit,
 COALESCE(p.total_override,ps.total_limit) AS total_limit,
 (SELECT count(*) FROM participants g WHERE g.parent_id=p.id AND g.removed_at IS NULL) AS guest_count,
 (SELECT count(*) FROM redemptions r WHERE r.participant_id=p.id AND r.voided_at IS NULL AND r.meal_type='lunch') AS used_lunch,
 (SELECT count(*) FROM redemptions r WHERE r.participant_id=p.id AND r.voided_at IS NULL AND r.meal_type='dinner') AS used_dinner
 FROM participants p JOIN passes ps ON ps.id=p.pass_id`
type ParticipantRow = Omit<Participant, 'remaining' | 'allowance'> & { lunch_limit: number; dinner_limit: number; total_limit: number; used_lunch: number; used_dinner: number }
function shapeParticipant(p: ParticipantRow): Participant {
  const allowance: Allowance = { lunch: p.lunch_limit, dinner: p.dinner_limit, total: p.total_limit }
  return { ...p, allowance, remaining: { lunch: Math.max(0, allowance.lunch - p.used_lunch), dinner: Math.max(0, allowance.dinner - p.used_dinner), total: Math.max(0, allowance.total - p.used_lunch - p.used_dinner) } }
}
export async function listParticipants(db: Database, search = '') { const r = await db.query<ParticipantRow>(participantSQL + ' WHERE p.removed_at IS NULL AND (p.name LIKE $1 OR p.phone LIKE $1 OR p.registration_number LIKE $1 OR p.category LIKE $1) ORDER BY p.created_at DESC LIMIT 2000', ['%' + search + '%']); return r.rows.map(shapeParticipant) }
export async function getParticipant(db: Pick<Connection, 'query'>, id: string) { const r = await db.query<ParticipantRow>(participantSQL + ' WHERE p.id=$1 AND p.removed_at IS NULL', [id]); if (!r.rows[0]) throw new HttpError(404, 'Participant not found.'); return shapeParticipant(r.rows[0]) }
export async function createParticipant(db: Database, input: ParticipantInput) {
  return transaction(db, async c => {
    if (input.parentId && !(await c.query('SELECT id FROM participants WHERE id=$1 AND removed_at IS NULL', [input.parentId])).rows[0]) throw new HttpError(400, 'Parent participant does not exist.')
    const id = randomUUID()
    await c.query('INSERT INTO participants(id,name,phone,pass_id,parent_id,qr_token,lunch_override,dinner_override,total_override) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, input.name, input.phone, input.passId, input.parentId, 'evt_' + randomBytes(24).toString('base64url'), input.lunchOverride, input.dinnerOverride, input.totalOverride])
    await ensureQrImage(c, id)
    await audit(c, 'participant.created', id, input.deviceLabel, { name: input.name, phone: input.phone, passId: input.passId, parentId: input.parentId, overrides: { lunch: input.lunchOverride, dinner: input.dinnerOverride, total: input.totalOverride } })
    return getParticipant(c, id)
  })
}
export async function updateParticipant(db: Database, id: string, input: ParticipantInput) {
  return transaction(db, async c => {
    await c.query('SELECT id FROM participants WHERE id=$1', [id]); const before = await getParticipant(c, id)
    if (input.parentId !== before.parent_id) throw new HttpError(400, 'Parent links cannot be changed after registration.')
    await c.query('UPDATE participants SET name=$2,phone=$3,pass_id=$4,lunch_override=$5,dinner_override=$6,total_override=$7 WHERE id=$1', [id, input.name, input.phone, input.passId, input.lunchOverride, input.dinnerOverride, input.totalOverride])
    const after = await getParticipant(c, id)
    const safe = (p: Participant) => ({ name: p.name, phone: p.phone, passId: p.pass_id, lunchOverride: p.lunch_override, dinnerOverride: p.dinner_override, totalOverride: p.total_override })
    await audit(c, 'participant.updated', id, input.deviceLabel, { before: safe(before), after: safe(after) }); return after
  })
}
export async function listSessions(db: Pick<Connection, 'query'>) {
 const rows=(await db.query<MealSession>(`SELECT s.*,
  (SELECT count(*) FROM redemptions r WHERE r.session_id=s.id AND r.voided_at IS NULL) AS served,
  (SELECT count(*) FROM participant_meal_eligibility e WHERE e.session_id=s.id AND EXISTS(SELECT 1 FROM participants active WHERE active.id=e.participant_id AND active.removed_at IS NULL)) AS registration_total,
  (SELECT count(*) FROM participant_meal_eligibility e WHERE e.session_id=s.id AND EXISTS(SELECT 1 FROM participants active WHERE active.id=e.participant_id AND active.removed_at IS NULL) AND e.eligible=1) AS expected,
  (SELECT count(*) FROM participant_meal_eligibility e WHERE e.session_id=s.id AND EXISTS(SELECT 1 FROM participants active WHERE active.id=e.participant_id AND active.removed_at IS NULL) AND e.eligible=0) AS not_included,
  (SELECT count(*) FROM participant_meal_eligibility e WHERE e.session_id=s.id AND EXISTS(SELECT 1 FROM participants active WHERE active.id=e.participant_id AND active.removed_at IS NULL) AND e.eligible=1 AND EXISTS(SELECT 1 FROM redemptions r WHERE r.session_id=s.id AND r.participant_id=e.participant_id AND r.voided_at IS NULL)) AS registered_served
  FROM meal_sessions s WHERE s.archived=0 ORDER BY s.created_at,s.name`)).rows
 return rows.map(s=>({...s,expected_remaining:Math.max(0,(s.expected??0)-(s.registered_served??0))}))
}
export async function listPasses(db: Pick<Connection, 'query'>) { return (await db.query<Pass>("SELECT * FROM passes WHERE id IN ('platinum','silver') ORDER BY id")).rows }
export async function updatePass(db: Database, id: string, input: { lunch: number; dinner: number; total: number; deviceLabel: string }) {
  return transaction(db, async c => {
    const before = (await c.query<Pass>('SELECT * FROM passes WHERE id=$1', [id])).rows[0]
    if (!before) throw new HttpError(404, 'Pass not found.')
    const after = (await c.query<Pass>('UPDATE passes SET lunch_limit=$2,dinner_limit=$3,total_limit=$4 WHERE id=$1 RETURNING *', [id, input.lunch, input.dinner, input.total])).rows[0]
    await audit(c, 'allowance.changed', id, input.deviceLabel, { before, after }); return after
  })
}
export async function saveSession(db: Database, id: string | null, input: { name: string; mealType: string; status: string; perPersonLimit: number; deviceLabel: string }) {
  return transaction(db, async c => {
    let before: MealSession | null = null
    if (id) { before = (await c.query<MealSession>('SELECT * FROM meal_sessions WHERE id=$1', [id])).rows[0]; if (!before) throw new HttpError(404, 'Session not found.'); if (before.meal_type !== input.mealType && (await c.query('SELECT id FROM redemptions WHERE session_id=$1 LIMIT 1', [id])).rows.length) throw new HttpError(409, 'A used session cannot change meal type.') }
    const sessionId = id ?? randomUUID()
    const after = (await c.query<MealSession>(`INSERT INTO meal_sessions(id,name,meal_type,status,per_person_limit) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=$2,meal_type=$3,status=$4,per_person_limit=$5 RETURNING *`, [sessionId, input.name, input.mealType, input.status, input.perPersonLimit])).rows[0]
    await audit(c, before ? 'session.updated' : 'session.created', sessionId, input.deviceLabel, { before, after }); return after
  })
}
export async function redeem(db: Database, input: RedemptionInput, entryMethod: 'qr' | 'manual' = 'qr'): Promise<RedemptionResult> {
  return transaction(db, async c => {
    const previous = (await c.query<{ qr_token: string; session_id: string; result: RedemptionResult }>('SELECT * FROM scan_requests WHERE request_id=$1', [input.requestId])).rows[0]
    if (previous) { if (previous.qr_token !== input.qrToken || previous.session_id !== input.sessionId) throw new HttpError(409, 'This request ID belongs to another scan.'); return previous.result }
    const session = (await c.query<MealSession>('SELECT * FROM meal_sessions WHERE id=$1', [input.sessionId])).rows[0]
    const raw = (await c.query<{ id: string; pass_id: string }>('SELECT id,pass_id FROM participants WHERE qr_token=$1 AND removed_at IS NULL', [input.qrToken])).rows[0]
    let participant: Participant | null = null
    if (raw) { await c.query('SELECT id FROM passes WHERE id=$1', [raw.pass_id]); participant = await getParticipant(c, raw.id) }
    let reason = 'Entry approved'
    if (!session) reason = 'Meal session not found'
    else if (session.status !== 'open' || session.archived) reason = 'This meal session is closed'
    else if (!participant) reason = 'QR code not recognized'
    else if (participant.source_import && !(await c.query<{eligible:number}>('SELECT eligible FROM participant_meal_eligibility WHERE participant_id=$1 AND session_id=$2',[participant.id,session.id])).rows[0]?.eligible) reason = 'This meal is not included in the registration'
    else if ((await c.query<{ count: number }>('SELECT count(*) AS count FROM redemptions WHERE participant_id=$1 AND session_id=$2 AND voided_at IS NULL', [participant.id, session.id])).rows[0].count >= session.per_person_limit) reason = 'Already served in this session'
    else if (participant.remaining.total <= 0) reason = 'Total meal allowance exhausted'
    else if (participant.remaining[session.meal_type] <= 0) reason = `${session.meal_type === 'lunch' ? 'Lunch' : 'Dinner'} allowance exhausted`
    const approved = reason === 'Entry approved'
    const redemptionId = approved ? randomUUID() : null
    if (approved && participant && session) {
      await c.query('INSERT INTO redemptions(id,request_id,participant_id,session_id,meal_type,device_label) VALUES($1,$2,$3,$4,$5,$6)', [redemptionId, input.requestId, participant.id, session.id, session.meal_type, input.deviceLabel])
      participant = await getParticipant(c, participant.id)
      await audit(c, 'meal.redeemed', redemptionId!, input.deviceLabel, { participantId: participant.id, participantName: participant.name, sessionId: session.id, sessionName: session.name, mealType: session.meal_type, entryMethod })
    }
    const timestamp = (await c.query<{ now: Date }>("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now")).rows[0].now
    const result: RedemptionResult = { requestId: input.requestId, approved, reason, redemptionId, participant: participant ? { id: participant.id, name: participant.name, pass: participant.pass_name, remaining: participant.remaining } : null, timestamp: new Date(timestamp).toISOString() }
    await c.query('INSERT INTO scan_requests(request_id,qr_token,session_id,result) VALUES($1,$2,$3,$4)', [input.requestId, input.qrToken, input.sessionId, JSON.stringify(result)])
    return result
  })
}
export async function voidRedemption(db: Database, id: string, reason: string, deviceLabel: string) {
  return transaction(db, async c => {
    const found = (await c.query<{ participant_id: string }>('SELECT participant_id FROM redemptions WHERE id=$1', [id])).rows[0]
    if (!found) throw new HttpError(404, 'Redemption not found.')
    await c.query('SELECT id FROM participants WHERE id=$1', [found.participant_id])
    const row = (await c.query<Redemption>("UPDATE redemptions SET voided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),void_reason=$2 WHERE id=$1 AND voided_at IS NULL RETURNING *", [id, reason])).rows[0]
    if (!row) throw new HttpError(409, 'This redemption has already been voided.')
    await audit(c, 'redemption.voided', id, deviceLabel, { reason, participantId: found.participant_id }); return row
  })
}
export async function listRedemptions(db: Pick<Connection, 'query'>, max = 500) { return (await db.query<Redemption>(`SELECT r.*,p.name AS participant_name,ps.name AS pass_name,s.name AS session_name FROM redemptions r JOIN participants p ON p.id=r.participant_id JOIN passes ps ON ps.id=p.pass_id JOIN meal_sessions s ON s.id=r.session_id ORDER BY r.created_at DESC LIMIT $1`, [max])).rows }
export async function listAudit(db: Database) { return (await db.query<AuditEvent>('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 500')).rows }
export async function dashboard(db: Database) {
  const { rows: [people] } = await db.query<{ participants: number; guests: number; platinum: number; silver: number }>(`SELECT count(*) AS participants,count(*) FILTER(WHERE parent_id IS NOT NULL) AS guests,count(*) FILTER(WHERE pass_id='platinum') AS platinum,count(*) FILTER(WHERE pass_id='silver') AS silver FROM participants WHERE removed_at IS NULL`)
  const { rows: [meals] } = await db.query<{ served: number; lunch: number; dinner: number }>(`SELECT count(*) AS served,count(*) FILTER(WHERE meal_type='lunch') AS lunch,count(*) FILTER(WHERE meal_type='dinner') AS dinner FROM redemptions WHERE voided_at IS NULL`)
  return { ...people, ...meals, sessions: await listSessions(db), recent: await listRedemptions(db, 6) }
}
export async function getPrintSettings(db: Pick<Connection, 'query'>) { return (await db.query<PrintSettings>('SELECT width_mm,height_mm FROM print_settings WHERE id=1')).rows[0] }
export async function updatePrintSettings(db: Database, width: number, height: number, label: string) { return transaction(db, async c => { const before = (await c.query<PrintSettings>('SELECT * FROM print_settings WHERE id=1')).rows[0]; const after = (await c.query<PrintSettings>('UPDATE print_settings SET width_mm=$1,height_mm=$2 WHERE id=1 RETURNING width_mm,height_mm', [width, height])).rows[0]; await audit(c, 'printing.settings_changed', '1', label, { before, after }); return after }) }

export async function getFamily(db: Database, id: string) {
 const rows = await db.query<ParticipantRow>(participantSQL + ` WHERE p.removed_at IS NULL AND p.id IN (WITH RECURSIVE descendants AS (SELECT id FROM participants WHERE id=$1 UNION ALL SELECT child.id FROM participants child JOIN descendants d ON child.parent_id=d.id) SELECT id FROM descendants UNION SELECT parent_id FROM participants WHERE id=$1) ORDER BY p.created_at`, [id])
 return rows.rows.map(shapeParticipant)
}

export async function removeParticipant(db:Database,id:string,reason:string,deviceLabel:string){
 return transaction(db,async c=>{
  const existing=(await c.query<{removed_at:string|null}>('SELECT removed_at FROM participants WHERE id=$1',[id])).rows[0]
  if(!existing)throw new HttpError(404,'Participant not found.')
  if(existing.removed_at)return {removed:true,id,detachedGuests:0}
  const participant=await getParticipant(c,id)
  const guests=(await c.query<{id:string}>('SELECT id FROM participants WHERE parent_id=$1 AND removed_at IS NULL',[id])).rows
  for(const guest of guests){await c.query('UPDATE participants SET parent_id=NULL WHERE id=$1',[guest.id]);await audit(c,'participant.updated',guest.id,deviceLabel,{reason:'Parent participant removed',before:{parentId:id},after:{parentId:null}})}
  await c.query("UPDATE participants SET removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=$1",[id])
  await audit(c,'participant.removed',id,deviceLabel,{participantName:participant.name,registration:participant.registration_number,reason,detachedGuests:guests.map(g=>g.id)})
  return {removed:true,id,detachedGuests:guests.length}
 })
}
export async function manualDinnerCheckIn(db:Database,input:{participantId:string;sessionId:string;requestId:string;deviceLabel:string}){
 const participant=await getParticipant(db,input.participantId)
 const session=(await db.query<MealSession>('SELECT * FROM meal_sessions WHERE id=$1 AND archived=0',[input.sessionId])).rows[0]
 if(!session||session.meal_type!=='dinner')throw new HttpError(400,'Choose an active dinner session.')
 return redeem(db,{requestId:input.requestId,qrToken:participant.qr_token,sessionId:input.sessionId,deviceLabel:input.deviceLabel},'manual')
}
