import test from 'node:test'
import assert from 'node:assert/strict'
import { ScanGate, validateResult } from '../src/lib/scanning.ts'

test('held QR and an unresolved scan cannot create another request', () => {
  const gate = new ScanGate()
  assert.equal(gate.accept('token', 10000), true)
  assert.equal(gate.accept('other', 10001), false)
  gate.resolve()
  assert.equal(gate.accept('token', 11000), false)
  assert.equal(gate.accept('other', 11001), true)
})
test('only a structured confirmed server result can approve', () => {
  assert.throws(() => validateResult({ approved: true }))
  assert.throws(() => validateResult({ approved: 'true', reason: 'OK', requestId: 'abc' }))
  assert.throws(() => validateResult({ approved: true, reason: 'Approved', requestId: 'abc', redemptionId: 'xyz', participant: null }))
})

test('keyboard scanner still works after a gate button or sound checkbox has focus', async () => {
 const {scannerOwnsKeyboard}=await import('../src/lib/scanning.ts')
 assert.equal(scannerOwnsKeyboard({tagName:'BUTTON'}),true)
 assert.equal(scannerOwnsKeyboard({tagName:'INPUT',type:'checkbox'}),true)
 assert.equal(scannerOwnsKeyboard({tagName:'INPUT',type:'text'}),false)
 assert.equal(scannerOwnsKeyboard({tagName:'TEXTAREA'}),false)
 assert.equal(scannerOwnsKeyboard({tagName:'DIV',isContentEditable:true}),false)
})

test('saved placeholder dinner selection resolves to the actual dinner eligibility session',async()=>{
 const {resolveScanSession,SCAN_RESULT_DURATION_MS}=await import('../src/lib/scanning.ts')
 const actual={id:'actual-dinner',name:'2026-11-28 · Dinner',meal_type:'dinner',status:'closed'}
 assert.equal(resolveScanSession([actual],'22222222-2222-4222-8222-222222222222')?.id,actual.id)
 assert.equal(resolveScanSession([actual],'44444444-4444-4444-8444-444444444444'),undefined)
 assert.equal(SCAN_RESULT_DURATION_MS,1000)
})
