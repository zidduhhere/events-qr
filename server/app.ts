import type { IncomingMessage, ServerResponse, RequestListener } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { ensureQrImage, exportQrZip, qrFilename } from './qr.ts'
import type { Database } from './db.ts'
import * as ops from './operations.ts'
import { HttpError, parseParticipant, parsePass, parseSession, parseRedemption, uuid, object, text, limit, device, csvCell } from './validation.ts'
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Send application/json.')
  let value = ''; for await (const chunk of req) { value += chunk; if (Buffer.byteLength(value) > 32768) throw new HttpError(413, 'Request too large.') }
  try { return JSON.parse(value) } catch { throw new HttpError(400, 'Invalid JSON.') }
}
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
export function createApp(db: Database): RequestListener {
  return (req, res) => { void handle(req, res).catch(error => {
    if (res.headersSent) { res.end(); return }
    if (error instanceof HttpError) json(res, error.status, { error: error.message })
    else { console.error('Request failed:', error instanceof Error ? error.name : 'Database error'); json(res, 503, { error: 'Backend or database unavailable. Check the server connection and retry.' }) }
  }) }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY')
    const url = new URL(req.url ?? '/', 'http://localhost'); const path = url.pathname; const method = req.method ?? 'GET'
    if (path.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        const origin = req.headers.origin
        const allowed = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:3001').split(',').map(s => s.trim())
        if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !allowed.includes(origin))) throw new HttpError(403, 'Origin is not allowed. Configure ALLOWED_ORIGINS for the event network.')
      }
      if(path==='/api/qr-export' && method==='POST'){
        const input=object(await body(req));const {zip,count}=await exportQrZip(db,device(input.deviceLabel))
        res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="tablepass-id-card-qr-codes.zip"','Cache-Control':'no-store','X-Participant-Count':String(count)});return res.end(zip)
      }
      const qrImage=path.match(/^\/api\/participants\/([^/]+)\/qr.png$/)
      if(qrImage && method==='GET'){
        const id=uuid(qrImage[1]);const p=await ops.getParticipant(db,id);const png=await ensureQrImage(db,id)
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','Content-Disposition':`${url.searchParams.has('download')?'attachment':'inline'}; filename="${qrFilename(p)}"`});return res.end(png)
      }
      if (path === '/api/health' && method === 'GET') { await db.query('SELECT 1'); return json(res, 200, { connected: true }) }
      if (path === '/api/dashboard' && method === 'GET') return json(res, 200, await ops.dashboard(db))
      if (path === '/api/participants' && method === 'GET') return json(res, 200, await ops.listParticipants(db, text(url.searchParams.get('search') ?? '', 'Search', 120, true)))
      if (path === '/api/participants' && method === 'POST') return json(res, 201, await ops.createParticipant(db, parseParticipant(await body(req))))
      const family = path.match(/^\/api\/participants\/([^/]+)\/family$/)
      if (family && method === 'GET') return json(res, 200, await ops.getFamily(db, uuid(family[1])))
      const participant = path.match(/^\/api\/participants\/([^/]+)$/)
      if (participant) { const id = uuid(participant[1]); if (method === 'GET') return json(res, 200, await ops.getParticipant(db, id)); if (method === 'DELETE') { const input=object(await body(req)); return json(res,200,await ops.removeParticipant(db,id,text(input.reason,'Removal reason',500),device(input.deviceLabel))) } if (method === 'PUT') return json(res, 200, await ops.updateParticipant(db, id, parseParticipant(await body(req)))) }
      const print = path.match(/^\/api\/participants\/([^/]+)\/print$/)
      if (print && method === 'POST') {
        const id = uuid(print[1]); const input = object(await body(req)); const p = await ops.getParticipant(db, id)
        await ops.audit(db, 'print.requested', id, device(input.deviceLabel), { participantName: p.name, note: 'Print attempt; physical output is unverified.' })
        const moduleName = 'qrcode'; const qr = await import(moduleName)
        const svg = await (qr.default ?? qr).toString(p.qr_token, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 })
        const settings = await ops.getPrintSettings(db)
        
        return json(res, 200, { svg, settings, name: p.name, pass: p.pass_name })
      }
      if (path === '/api/passes' && method === 'GET') return json(res, 200, await ops.listPasses(db))
      const pass = path.match(/^\/api\/passes\/(platinum|silver)$/)
      if (pass && method === 'PUT') return json(res, 200, await ops.updatePass(db, pass[1], parsePass(await body(req))))
      if (path === '/api/sessions' && method === 'GET') return json(res, 200, await ops.listSessions(db))
      if (path === '/api/sessions' && method === 'POST') return json(res, 201, await ops.saveSession(db, null, parseSession(await body(req))))
      const session = path.match(/^\/api\/sessions\/([^/]+)$/)
      if (session && method === 'PUT') return json(res, 200, await ops.saveSession(db, uuid(session[1]), parseSession(await body(req))))
      if(path==='/api/dinner-check-in' && method==='POST'){
        const input=object(await body(req));return json(res,200,await ops.manualDinnerCheckIn(db,{participantId:uuid(input.participantId,'Participant ID'),sessionId:uuid(input.sessionId,'Session ID'),requestId:uuid(input.requestId,'Request ID'),deviceLabel:device(input.deviceLabel)}))
      }
      if (path === '/api/redemptions' && method === 'POST') return json(res, 200, await ops.redeem(db, parseRedemption(await body(req))))
      if (path === '/api/redemptions' && method === 'GET') return json(res, 200, await ops.listRedemptions(db))
      const voided = path.match(/^\/api\/redemptions\/([^/]+)\/void$/)
      if (voided && method === 'POST') { const input = object(await body(req)); return json(res, 200, await ops.voidRedemption(db, uuid(voided[1]), text(input.reason, 'Void reason', 500), device(input.deviceLabel))) }
      if (path === '/api/audit' && method === 'GET') return json(res, 200, await ops.listAudit(db))
      if (path === '/api/printing' && method === 'GET') return json(res, 200, await ops.getPrintSettings(db))
      if (path === '/api/printing' && method === 'PUT') { const o = object(await body(req)); return json(res, 200, await ops.updatePrintSettings(db, limit(o.width, 'Width', 30, 150), limit(o.height, 'Height', 25, 200), device(o.deviceLabel))) }
      if (path === '/api/export' && method === 'GET') {
        const rows = await ops.listRedemptions(db, 100000)
        const csv = [['Name', 'Pass', 'Session', 'Meal', 'Device (unverified)', 'Server timestamp', 'Voided at', 'Void reason'], ...rows.map(r => [r.participant_name, r.pass_name, r.session_name, r.meal_type, r.device_label, r.created_at, r.voided_at, r.void_reason])].map(row => row.map(csvCell).join(',')).join('\r\n')
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="dining-attendance.csv"', 'Cache-Control': 'no-store' }); return res.end('\uFEFF' + csv)
      }
      throw new HttpError(404, 'API route not found.')
    }
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed.')
    if (path === '/vendor/zxing-browser.min.js') {
      try { const bytes = await readFile(resolve('node_modules/@zxing/browser/umd/zxing-browser.min.js')); res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bytes) }
      catch { throw new HttpError(503, 'Camera decoder is unavailable. Install @zxing/browser on the server.') }
    }
    const root = resolve('dist'); let file = resolve(root, '.' + decodeURIComponent(path)); if (file !== root && !file.startsWith(root + '/')) throw new HttpError(404, 'Not found.')
    const isPage = path === '/' || path === '/scan' || path === '/participants' || /^\/participants\/[^/]+$/.test(path) || path === '/settings' || path === '/reports'
    if (isPage) file = resolve(root, 'index.html')
    try { const bytes = await readFile(file); const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }; res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': isPage ? 'no-cache' : 'public, max-age=3600' }); res.end(method === 'HEAD' ? undefined : bytes) }
    catch { throw new HttpError(404, 'Page unavailable. Run npm run build before npm start.') }
  }
}
