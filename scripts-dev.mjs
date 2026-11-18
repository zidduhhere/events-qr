import { spawn, spawnSync } from 'node:child_process'
import { lanAddresses } from './scripts/network.mjs'
try{process.loadEnvFile('.env')}catch(e){if(e.code!=='ENOENT')throw e}
const https=process.argv.includes('--https')
if(https){const setup=spawnSync(process.execPath,['scripts/setup-https.mjs'],{stdio:'inherit'});if(setup.status!==0)process.exit(setup.status??1)}
const protocol=https?'https':'http'
const origins=[...(process.env.ALLOWED_ORIGINS??'http://localhost:5173,http://localhost:3001').split(','),...['localhost','127.0.0.1',...lanAddresses()].map(host=>`${protocol}://${host}:5173`)]
const children = [spawn(process.execPath, ['--env-file-if-exists=.env', '--watch', 'server/index.ts'], { stdio: 'inherit', env: { ...process.env, HOST: '127.0.0.1', ALLOWED_ORIGINS:[...new Set(origins)].join(',') } }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0','--port','5173','--strictPort'], { stdio: 'inherit',env:{...process.env,LOCAL_HTTPS:https?'1':'0'} })]
let stopping = false
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill(); process.exitCode = code }
for (const child of children){child.on('exit', code => stop(code ?? 0));child.on('error',error=>{console.error(error.message);stop(1)})}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop())
