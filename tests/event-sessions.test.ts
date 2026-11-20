import test from 'node:test'
import assert from 'node:assert/strict'
import {createDatabase,migrate} from '../server/db.ts'
import {listSessions} from '../server/operations.ts'
test('event starts with exactly the three actual dated meals and never recreates day 2 dinner',async()=>{
 const db=await createDatabase(':memory:');try{await migrate(db);await migrate(db);const sessions=await listSessions(db);assert.deepEqual(sessions.map(s=>s.name).sort(),['2026-11-28 · Dinner','2026-11-28 · Lunch','2026-11-29 · Lunch']);assert.equal(sessions.filter(s=>s.meal_type==='dinner').length,1)}finally{await db.end()}
})
