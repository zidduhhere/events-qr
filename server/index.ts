import { createServer } from 'node:http'
import { createDatabase, migrate } from './db.ts'
import { createApp } from './app.ts'
const db = await createDatabase()
await migrate(db)
const server = createServer(createApp(db))
server.requestTimeout = 15000
server.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '0.0.0.0', () => console.log(`Dining API listening on port ${process.env.PORT ?? 3001}. Trusted event network only.`))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => { void db.end().then(() => process.exit(0)) }) })
