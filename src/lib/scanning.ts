import type { RedemptionResult } from '../../shared/types.ts'
export class ScanGate {
  pending = false
  private last = new Map<string, number>()
  accept(token: string, now = Date.now()): boolean {
    const previous = this.last.get(token) ?? -Infinity
    if (this.last.has(token)) this.last.set(token, now)
    if (this.pending || now - previous < 5000) return false
    this.last.set(token, now); this.pending = true
    for (const [key, at] of this.last) if (now - at > 60000) this.last.delete(key)
    return true
  }
  resolve() { this.pending = false }
}
export function validateResult(value: unknown): RedemptionResult {
  if (!value || typeof value !== 'object') throw new Error('Invalid server response. Retry the pending scan.')
  const r = value as RedemptionResult
  const validRemaining = (r: unknown) => !!r && typeof r === 'object' && ['lunch', 'dinner', 'total'].every(k => Number.isSafeInteger((r as Record<string, unknown>)[k]) && Number((r as Record<string, unknown>)[k]) >= 0)
  if (typeof r.approved !== 'boolean' || typeof r.reason !== 'string' || typeof r.requestId !== 'string' || typeof r.timestamp !== 'string' || !Number.isFinite(Date.parse(r.timestamp)) || (r.approved && (!r.redemptionId || !r.participant || typeof r.participant.name !== 'string' || typeof r.participant.pass !== 'string' || !validRemaining(r.participant.remaining)))) throw new Error('Invalid server response. Retry the pending scan.')
  return r
}

export function requestUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128
  const h = Array.from(b, n => n.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

export function scannerOwnsKeyboard(target: {tagName: string; isContentEditable?: boolean; type?: string}): boolean {
 const inputIsText = target.tagName === 'INPUT' && !['checkbox','radio','button','submit','reset'].includes(target.type ?? 'text')
 return !(inputIsText || ['TEXTAREA','SELECT'].includes(target.tagName) || target.isContentEditable)
}

export function resolveScanSession<T extends {id:string;name:string;meal_type:string;status:string}>(sessions:T[],saved:string):T|undefined{
 const exact=sessions.find(s=>s.id===saved);if(exact)return exact
 const legacy:Record<string,string>={
  '11111111-1111-4111-8111-111111111111':'2026-11-28 · Lunch',
  '22222222-2222-4222-8222-222222222222':'2026-11-28 · Dinner',
  '33333333-3333-4333-8333-333333333333':'2026-11-29 · Lunch',
 }
 const replacement=sessions.find(s=>s.name===legacy[saved]);if(replacement)return replacement
 const open=sessions.filter(s=>s.status==='open');return open.length===1?open[0]:undefined
}
export const SCAN_RESULT_DURATION_MS=1000
