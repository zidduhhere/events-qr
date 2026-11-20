import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRedemption, parseParticipant, parsePass, parseSession, csvCell } from '../server/validation.ts'

test('invalid redemption requests cannot reach the database', () => {
  assert.throws(() => parseRedemption({ qrToken: 'a', sessionId: 'no', requestId: 'no' }))
  assert.throws(() => parseRedemption({ qrToken: 'a'.repeat(400), sessionId: crypto.randomUUID(), requestId: crypto.randomUUID() }))
})
test('valid request preserves retry identity and unverified device metadata', () => {
  const input = { qrToken: 'evt_' + crypto.randomUUID(), sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(), deviceLabel: 'Dining Gate 1' }
  assert.deepEqual(parseRedemption(input), input)
})
test('participant input rejects invalid pass and allowance overrides', () => {
  assert.throws(() => parseParticipant({ name: ' ', phone: '123', passId: 'silver' }))
  assert.throws(() => parseParticipant({ name: 'Anu', phone: '9876543210', passId: 'admin' }))
  assert.throws(() => parseParticipant({ name: 'Anu', phone: '9876543210', passId: 'silver', lunchOverride: -1 }))
  assert.equal(parseParticipant({ name: '  Anu  ', phone: '+91 98765 43210', passId: 'silver' }).name, 'Anu')
})
test('limits must be nonnegative integers and session requires a real meal type', () => {
  assert.throws(() => parsePass({ lunchLimit: -1, dinnerLimit: 2, totalLimit: 4 }))
  assert.throws(() => parsePass({ lunchLimit: 1.5, dinnerLimit: 2, totalLimit: 4 }))
  assert.throws(() => parseSession({ name: 'Lunch', mealType: 'breakfast', status: 'open', perPersonLimit: 1 }))
})
test('CSV exports neutralize formulas and escape quotes', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"')
  assert.equal(csvCell('  +SUM(1)'), '"\'  +SUM(1)"')
  assert.equal(csvCell('A "name"'), '"A ""name"""')
})
