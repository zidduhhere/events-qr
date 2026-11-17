// Optional one-time import. Never modifies the source PostgreSQL database.
import { createDatabase, migrate, transaction } from './db.ts'
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL to the source PostgreSQL database for this import only.')
const moduleName='pg';const {Pool}=await import(moduleName)
const source=new Pool({connectionString:process.env.DATABASE_URL});const client=await source.connect();const target=await createDatabase()
const tables=['passes','participants','meal_sessions','redemptions','scan_requests','audit_events','print_settings'] as const
try{
 await migrate(target)
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
 const snapshot=new Map<string,Record<string,unknown>[]>()
 for(const table of tables){const result=await client.query(`SELECT * FROM ${table}`);snapshot.set(table,result.rows)}
 await transaction(target,async c=>{
  for(const table of ['participants','redemptions','scan_requests','audit_events'])if((await c.query<{n:number}>(`SELECT count(*) AS n FROM ${table}`)).rows[0].n)throw new Error('Import requires an empty SQLite target. Choose a new SQLITE_PATH; existing data was not changed.')
  await c.query('PRAGMA defer_foreign_keys=ON')
  for(const table of [...tables].reverse())await c.query(`DELETE FROM ${table}`)
  for(const table of tables)for(const row of snapshot.get(table)??[]){const keys=Object.keys(row);if(keys.some(k=>!/^[a-z_]+$/.test(k)))throw new Error('Unexpected source column.');const values=keys.map(k=>row[k] instanceof Date?(row[k] as Date).toISOString():row[k]!==null&&typeof row[k]==='object'?JSON.stringify(row[k]):row[k]);await c.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values)}
 })
 await client.query('COMMIT');console.log('Imported PostgreSQL data into SQLite, preserving IDs, QR tokens, balances and history. Source was not modified.')
}catch(error){await client.query('ROLLBACK');throw error}finally{client.release();await source.end();await target.end()}
