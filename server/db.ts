import { readFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
export interface QueryResult<T = Record<string, unknown>> { rows: T[]; rowCount?: number | null }
export interface Connection { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>; release(): void }
export interface Database { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>; connect(): Promise<Connection>; exec(sql: string): Promise<void>; end(): Promise<void> }
export async function createDatabase(filename = process.env.SQLITE_PATH ?? 'data/events.db'): Promise<Database> {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true })
  const sqlite = new DatabaseSync(filename)
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;')
  let tail = Promise.resolve()
  let closed = false
  // Lease the single connection for an entire transaction. Other gate requests and
  // reads wait until commit/rollback, never joining another request's transaction.
  async function acquire() {
    const previous = tail
    let unlock!: () => void
    tail = new Promise<void>(r => { unlock = r })
    await previous
    return unlock
  }
  async function query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const values: SQLInputValue[] = []
    const statement = sqlite.prepare(sql.replace(/\$(\d+)/g, (_, n) => { values.push(params[Number(n)-1] as SQLInputValue); return '?' }))
    if (statement.columns().length) {
      const rows = statement.all(...values).map(row => {
        for (const key of ['result', 'details']) if (typeof row[key] === 'string') row[key] = JSON.parse(row[key] as string)
        return row as T
      })
      return { rows, rowCount: rows.length }
    }
    const result = statement.run(...values)
    return { rows: [], rowCount: Number(result.changes) }
  }
  const db: Database = {
    async connect() {
      const unlock = await acquire()
      if (closed) { unlock(); throw new Error('Database is closed.') }
      let released = false
      return { query: <T>(sql: string, params?: unknown[]) => { if (released) return Promise.reject(new Error('Connection released.')); return query<T>(sql, params) }, release() { if (!released) { released = true; unlock() } } }
    },
    async query<T>(sql: string, params?: unknown[]) { const c = await db.connect(); try { return await c.query<T>(sql, params) } finally { c.release() } },
    async exec(sql: string) { const unlock = await acquire(); try { if (closed) throw new Error('Database is closed.'); sqlite.exec(sql) } finally { unlock() } },
    async end() { const unlock = await acquire(); try { if (!closed) { sqlite.close(); closed = true } } finally { unlock() } },
  }
  return db
}
export async function transaction<T>(pool: Database, work: (client: Connection) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try { await client.query('BEGIN IMMEDIATE'); try { const result = await work(client); await client.query('COMMIT'); return result } catch (error) { await client.query('ROLLBACK'); throw error } }
  finally { client.release() }
}
export async function migrate(pool: Database) {
  // Expand the original two-pass constraint without modifying participant IDs or foreign keys.
  const old = (await pool.query<{sql:string}>("SELECT sql FROM sqlite_master WHERE type='table' AND name='passes'")).rows[0]
  if (old && !old.sql.includes("'registered'")) await pool.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
    CREATE TABLE passes_expanded (id text PRIMARY KEY CHECK(id IN ('platinum','silver','registered')),name text NOT NULL,lunch_limit integer NOT NULL CHECK(lunch_limit BETWEEN 0 AND 10000),dinner_limit integer NOT NULL CHECK(dinner_limit BETWEEN 0 AND 10000),total_limit integer NOT NULL CHECK(total_limit BETWEEN 0 AND 10000));
    INSERT INTO passes_expanded SELECT * FROM passes; DROP TABLE passes; ALTER TABLE passes_expanded RENAME TO passes; COMMIT; PRAGMA foreign_keys=ON;`)
  await pool.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
  const columns=(await pool.query<{name:string}>('PRAGMA table_info(participants)')).rows
  for (const name of ['registration_number','category','hospital','food_requirement','source_import']) if(!columns.some(c=>c.name===name)) await pool.exec(`ALTER TABLE participants ADD COLUMN ${name} text`)
  await pool.exec('CREATE UNIQUE INDEX IF NOT EXISTS participant_registration ON participants(registration_number) WHERE registration_number IS NOT NULL')
  if(!(await pool.query<{name:string}>('PRAGMA table_info(meal_sessions)')).rows.some(c=>c.name==='archived')) await pool.exec('ALTER TABLE meal_sessions ADD COLUMN archived integer NOT NULL DEFAULT 0 CHECK(archived IN (0,1))')
  await transaction(pool, async c => {
    const schedule = [
      ['11111111-1111-4111-8111-111111111111','Day 1 · Lunch','2026-11-28 · Lunch','lunch'],
      ['22222222-2222-4222-8222-222222222222','Day 1 · Dinner','2026-11-28 · Dinner','dinner'],
      ['33333333-3333-4333-8333-333333333333','Day 2 · Lunch','2026-11-29 · Lunch','lunch'],
    ]
    const unused = async (id:string) => !(await c.query<{n:number}>(`SELECT (SELECT count(*) FROM redemptions WHERE session_id=$1)+(SELECT count(*) FROM participant_meal_eligibility WHERE session_id=$1)+(SELECT count(*) FROM scan_requests WHERE session_id=$1) AS n`,[id])).rows[0].n
    for(const [id,oldName,name,type] of schedule){
      const old=(await c.query<{id:string}>('SELECT id FROM meal_sessions WHERE id=$1 AND name=$2',[id,oldName])).rows[0]
      const actual=(await c.query<{id:string}>('SELECT id FROM meal_sessions WHERE name=$1 AND meal_type=$2',[name,type])).rows[0]
      if(old && actual && actual.id!==old.id && await unused(old.id)) await c.query('DELETE FROM meal_sessions WHERE id=$1',[old.id])
      else if(old && actual && actual.id!==old.id) await c.query("UPDATE meal_sessions SET archived=1,status='closed' WHERE id=$1",[old.id])
      else if(old && !actual) await c.query('UPDATE meal_sessions SET name=$2 WHERE id=$1',[old.id,name])
      if(!actual && !old) await c.query("INSERT INTO meal_sessions(id,name,meal_type,status,per_person_limit) VALUES($1,$2,$3,'closed',1) ON CONFLICT DO NOTHING",[id,name,type])
    }
    const extra='44444444-4444-4444-8444-444444444444'
    if(await unused(extra)) await c.query("DELETE FROM meal_sessions WHERE id=$1 AND name='Day 2 · Dinner'",[extra])
    else await c.query("UPDATE meal_sessions SET archived=1,status='closed' WHERE id=$1 AND name='Day 2 · Dinner'",[extra])
  })

}
