import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type CacheEntry = { storedAt: number; body: string }

export function cacheKey(query: string): string {
  return createHash('sha256').update(query).digest('hex')
}

export async function readCache(dir: string, query: string, maxAgeMs: number, now = Date.now()): Promise<{ body: string; fresh: boolean } | null> {
  try {
    const file = path.join(dir, `${cacheKey(query)}.json`)
    const parsed = JSON.parse(await readFile(file, 'utf8')) as CacheEntry
    if (typeof parsed.body !== 'string' || typeof parsed.storedAt !== 'number') return null
    return { body: parsed.body, fresh: now - parsed.storedAt <= maxAgeMs }
  } catch {
    return null
  }
}

export async function writeCache(dir: string, query: string, body: string, now = Date.now()): Promise<void> {
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${cacheKey(query)}.json`)
  const entry: CacheEntry = { storedAt: now, body }
  await writeFile(file, JSON.stringify(entry))
}

export async function cacheStats(dir: string): Promise<{ files: number; bytes: number }> {
  try {
    const names = await readdir(dir)
    let bytes = 0
    let files = 0
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const info = await stat(path.join(dir, name))
      bytes += info.size
      files += 1
    }
    return { files, bytes }
  } catch {
    return { files: 0, bytes: 0 }
  }
}
