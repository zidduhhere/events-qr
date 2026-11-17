import { createDatabase, migrate } from './db.ts'
const db = await createDatabase()
try { await migrate(db); console.log('Database schema ready. No participant or attendance data was seeded.') }
finally { await db.end() }
