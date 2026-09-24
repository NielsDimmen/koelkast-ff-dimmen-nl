import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { cacheStats, readCache, writeCache } from './cache.ts'

describe('cache', () => {
  it('bewaart een query tot cache_hours en daarna als verlopen', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'koelkast-'))
    try {
      await writeCache(dir, '[out:json];', '{"elements":[]}', 1_000)
      const fresh = await readCache(dir, '[out:json];', 500, 1_200)
      assert.equal(fresh?.fresh, true)
      const stale = await readCache(dir, '[out:json];', 100, 2_000)
      assert.equal(stale?.fresh, false)
      assert.equal(stale?.body, '{"elements":[]}')
      const stats = await cacheStats(dir)
      assert.equal(stats.files, 1)
      assert.ok(stats.bytes > 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
