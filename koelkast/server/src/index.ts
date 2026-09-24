import { access } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import compress from '@fastify/compress'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { cacheStats, readCache, writeCache } from './cache.js'
import { createLimiter } from './limit.js'
import { readOptions } from './options.js'

const PORT = Number(process.env.PORT ?? 8099)
const INGRESS_PORT = Number(process.env.INGRESS_PORT ?? 8098)
const DATA_DIR = process.env.DATA_DIR ?? '/data'
const CACHE_DIR = path.join(DATA_DIR, 'cache')
const WEB_DIST =
  process.env.WEB_DIST ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')

const startedAt = Date.now()
const allow = createLimiter(40, 60_000)
const inflight = new Map<string, Promise<{ body: string; fallback: boolean; stale: boolean }>>()

type OverpassLog = {
  at: string
  ip: string
  cache: 'HIT' | 'MISS' | 'STALE'
  ok: boolean
  ms: number
  bytes: number
  fallback: boolean
  error?: string
}

const recent: OverpassLog[] = []

function logLine(entry: OverpassLog): void {
  recent.unshift(entry)
  if (recent.length > 40) recent.pop()
  console.log(JSON.stringify({ msg: 'overpass', ...entry }))
}

function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return request.ip
}

async function fetchUpstream(url: string, query: string): Promise<{ ok: boolean; body: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      accept: 'application/json',
      'user-agent': 'koelkast/1.0 (https://koelkast.ff-dimmen.nl)',
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(40_000),
  })
  const body = await response.text()
  return { ok: response.ok && body.trim().startsWith('{'), body }
}

async function resolveQuery(query: string): Promise<{ body: string; cache: OverpassLog['cache']; fallback: boolean }> {
  const options = readOptions()
  const maxAge = options.cache_hours * 60 * 60 * 1000
  const cached = await readCache(CACHE_DIR, query, maxAge)
  if (cached?.fresh) return { body: cached.body, cache: 'HIT', fallback: false }

  const pending = inflight.get(query)
  if (pending) {
    const result = await pending
    return { body: result.body, cache: result.stale ? 'STALE' : 'HIT', fallback: result.fallback }
  }

  const work = (async () => {
    try {
      const primary = await fetchUpstream(options.overpass_url, query)
      if (!primary.ok) throw new Error(primary.body.slice(0, 180) || 'upstream')
      await writeCache(CACHE_DIR, query, primary.body)
      return { body: primary.body, fallback: false, stale: false }
    } catch (primaryError) {
      if (options.overpass_fallback_url) {
        try {
          const second = await fetchUpstream(options.overpass_fallback_url, query)
          if (second.ok) {
            await writeCache(CACHE_DIR, query, second.body)
            return { body: second.body, fallback: true, stale: false }
          }
        } catch (fallbackError) {
          console.log(JSON.stringify({ msg: 'overpass-fallback-fout', error: String(fallbackError) }))
        }
      }
      if (cached) return { body: cached.body, fallback: false, stale: true }
      throw primaryError instanceof Error ? primaryError : new Error('overpass mislukt')
    }
  })()

  inflight.set(query, work)
  try {
    const result = await work
    return { body: result.body, cache: result.stale ? 'STALE' : 'MISS', fallback: result.fallback }
  } finally {
    inflight.delete(query)
  }
}

function sendJson(reply: FastifyReply, body: string, cache: string): FastifyReply {
  return reply.header('x-cache', cache).type('application/json').send(body)
}

async function statusPayload() {
  const options = readOptions()
  const cache = await cacheStats(CACHE_DIR)
  return {
    ok: true,
    uptime: Math.round((Date.now() - startedAt) / 1000),
    cacheFiles: cache.files,
    cacheBytes: cache.bytes,
    cacheHours: options.cache_hours,
    overpassUrl: options.overpass_url,
    recent,
  }
}

const ingressHtml = `<!doctype html>
<html lang="nl">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Koelkast</title>
<style>
  body { font: 16px/1.4 ui-sans-serif, system-ui, sans-serif; margin: 0; background: #101418; color: #f4f1ea; }
  main { max-width: 46rem; margin: 0 auto; padding: 1.5rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.4rem; }
  .muted { color: #b7c0c8; }
  dl { display: grid; grid-template-columns: 11rem 1fr; gap: 0.35rem 1rem; }
  dt { color: #b7c0c8; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.35rem 0.3rem; border-bottom: 1px solid #2a3340; }
  a { color: #ffb15a; }
</style>
<main>
  <h1>Koelkast</h1>
  <p class="muted">Status van de server. De rij-app zelf staat niet in dit venster: open <a href="https://koelkast.ff-dimmen.nl">koelkast.ff-dimmen.nl</a> op je telefoon.</p>
  <dl id="facts"></dl>
  <h2>Laatste Overpass-verzoeken</h2>
  <table><thead><tr><th>Tijd</th><th>Cache</th><th>ms</th><th>bytes</th><th></th></tr></thead><tbody id="rows"></tbody></table>
</main>
<script>
async function tick() {
  const base = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/'
  const res = await fetch(base + 'api/status')
  const data = await res.json()
  document.querySelector('#facts').innerHTML = [
    ['Status', data.ok ? 'draait' : 'fout'],
    ['Uptime', data.uptime + ' s'],
    ['Cache', data.cacheFiles + ' bestanden, ' + Math.round(data.cacheBytes / 1024) + ' kB'],
    ['Cache geldig', data.cacheHours + ' uur'],
  ].map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('')
  document.querySelector('#rows').innerHTML = (data.recent || []).map((row) =>
    '<tr><td>' + row.at.slice(11, 19) + '</td><td>' + row.cache + '</td><td>' + row.ms + '</td><td>' + row.bytes + '</td><td>' + (row.error || (row.ok ? 'ok' : '')) + '</td></tr>'
  ).join('')
}
tick()
setInterval(tick, 3000)
</script>`

async function buildApp() {
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 16_384 })
  await app.register(compress)

  app.get('/api/health', async () => ({ ok: true, uptime: Math.round((Date.now() - startedAt) / 1000) }))

  app.get('/api/config', async () => {
    const options = readOptions()
    return {
      bocht_drempel_graden: options.bocht_drempel_graden,
      lookahead_seconden: options.lookahead_seconden,
      cache_hours: options.cache_hours,
    }
  })

  app.get('/api/status', async () => statusPayload())

  app.post('/api/overpass', async (request, reply) => {
    const started = Date.now()
    const ip = clientIp(request)
    const query = (request.body as { query?: unknown } | null)?.query
    if (!allow(ip)) {
      logLine({ at: new Date().toISOString(), ip, cache: 'MISS', ok: false, ms: 0, bytes: 0, fallback: false, error: '429' })
      return reply.code(429).send({ error: 'te veel verzoeken' })
    }
    if (typeof query !== 'string' || query.length < 8 || query.length > 12_000) {
      return reply.code(400).send({ error: 'ongeldige query' })
    }
    try {
      const resolved = await resolveQuery(query)
      logLine({
        at: new Date().toISOString(),
        ip,
        cache: resolved.cache,
        ok: true,
        ms: Date.now() - started,
        bytes: resolved.body.length,
        fallback: resolved.fallback,
      })
      return sendJson(reply, resolved.body, resolved.cache)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'overpass mislukt'
      logLine({
        at: new Date().toISOString(),
        ip,
        cache: 'MISS',
        ok: false,
        ms: Date.now() - started,
        bytes: 0,
        fallback: true,
        error: message.slice(0, 180),
      })
      return reply.code(502).send({ error: 'overpass onbereikbaar' })
    }
  })

  let webReady = true
  try {
    await access(WEB_DIST)
  } catch {
    webReady = false
    console.log(JSON.stringify({ msg: 'geen web-build', web: WEB_DIST }))
  }

  if (webReady) await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: '/',
    cacheControl: false,
    setHeaders(res, filePath) {
      const base = path.basename(filePath)
      if (base === 'index.html' || base === 'sw.js' || base.startsWith('workbox-') || base.endsWith('.webmanifest')) {
        res.setHeader('cache-control', 'no-cache')
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable')
      }
      if (base.endsWith('.webmanifest')) res.setHeader('content-type', 'application/manifest+json')
      if (base === 'sw.js' || base.startsWith('workbox-')) res.setHeader('service-worker-allowed', '/')
    },
  })

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || !webReady) return reply.code(404).send({ error: 'niet gevonden' })
    return reply.sendFile('index.html')
  })

  return app
}

const app = await buildApp()
await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(JSON.stringify({ msg: 'luistert', port: PORT, ingress: INGRESS_PORT, web: WEB_DIST, data: DATA_DIR }))

const ingress = createServer(async (request, response) => {
  const url = request.url ?? '/'
  if (url.startsWith('/api/status')) {
    const body = JSON.stringify(await statusPayload())
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(body)
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(ingressHtml)
})
ingress.listen(INGRESS_PORT, '0.0.0.0')

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0))
  })
}
