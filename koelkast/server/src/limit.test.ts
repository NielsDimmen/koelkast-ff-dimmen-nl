import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLimiter } from './limit.ts'
import { optionsFromUnknown } from './options.ts'

describe('rate limit', () => {
  it('blokkeert een IP na de limiet', () => {
    const allow = createLimiter(2, 1000)
    assert.equal(allow('1.2.3.4', 0), true)
    assert.equal(allow('1.2.3.4', 10), true)
    assert.equal(allow('1.2.3.4', 20), false)
    assert.equal(allow('5.6.7.8', 20), true)
    assert.equal(allow('1.2.3.4', 2000), true)
  })
})

describe('opties', () => {
  it('vult ontbrekende waarden aan en leest getallen uit strings', () => {
    const options = optionsFromUnknown({ cache_hours: '12', bocht_drempel_graden: 20 })
    assert.equal(options.cache_hours, 12)
    assert.equal(options.bocht_drempel_graden, 20)
    assert.equal(options.lookahead_seconden, 8)
    assert.equal(options.overpass_url, 'https://overpass-api.de/api/interpreter')
  })
})
