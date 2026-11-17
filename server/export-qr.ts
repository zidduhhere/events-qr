import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createDatabase, migrate } from './db.ts'
import { exportQrZip } from './qr.ts'
const db=await createDatabase()
try{await migrate(db);const {zip,count}=await exportQrZip(db);const path=resolve(process.argv[2]??'exports/tablepass-id-card-qr-codes.zip');await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,zip);console.log(JSON.stringify({path,participants:count,bytes:zip.length}))}finally{await db.end()}
