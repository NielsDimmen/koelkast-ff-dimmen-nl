import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cumulativeDistances,
  destination,
  distanceMeters,
  normalizeAngle,
  pointAlong,
  type LatLon,
} from '../koelkast/web/src/geometry.ts'
import { buildGraph, buildPath, matchRoad, pathLength, waysFromElements } from '../koelkast/web/src/matcher.ts'
import type { OsmElement } from '../koelkast/web/src/types.ts'

const START: LatLon = { lat: 50.875, lon: 5.715 }
const END: LatLon = { lat: 51.415, lon: 5.535 }
const ROERMOND: LatLon = { lat: 51.1942, lon: 5.9872 }
// De gevraagde bbox eindigt op lon 5.80, maar de A2 gaat bij Born even
// oostelijker (rond 5.90) voor hij terugbuigt naar Eindhoven.
const QUERY = `[out:json][timeout:180];
(
  way["highway"="motorway"]["ref"~"(^|;)A2($|;)"](50.83,5.40,51.46,5.95);
  way["highway"="motorway_link"]["ref"~"(^|;)A2($|;)"](50.83,5.40,51.46,5.95);
);
out geom;`
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../koelkast/web/public/demo/a2-maastricht-eindhoven.gpx',
)

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function overpass(): Promise<OsmElement[]> {
  let last = 'geen antwoord'
  for (const url of ENDPOINTS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': 'koelkast-demo/1.0 (https://koelkast.ff-dimmen.nl)',
        },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(180_000),
      })
      const text = await response.text()
      if (!response.ok || !text.trim().startsWith('{')) {
        last = `${url} ${response.status} ${text.slice(0, 160)}`
        continue
      }
      const body = JSON.parse(text) as { elements?: OsmElement[] }
      return body.elements ?? []
    } catch (error) {
      last = `${url} ${error instanceof Error ? error.message : String(error)}`
    }
  }
  throw new Error(last)
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ?? char)
}

async function main(): Promise<void> {
  const elements = await overpass()
  const ways = waysFromElements(
    elements,
    (way) => way.refs.includes('A2') && (way.highway === 'motorway' || way.highway === 'motorway_link'),
  )
  console.log(`ways ${ways.length}`)
  const graph = buildGraph(ways)
  const match = matchRoad(graph, START, 0, {
    maxDistance: 1500,
    maxAngle: 80,
    filter: (way) => way.highway === 'motorway' && way.refs.includes('A2'),
  })
  if (!match) throw new Error('geen noordelijke A2 bij Maastricht-Noord')
  const built = buildPath(graph, match, {
    behindM: 0,
    aheadM: 220_000,
    allowLinks: false,
    motorwayOnly: true,
    maxAngle: 120,
    gapM: 40,
    preferRef: 'A2',
    untilNear: { at: END, radiusM: 1500 },
  })
  const km = pathLength(built) / 1000
  const last = built.points[built.points.length - 1]
  const toEnd = last ? distanceMeters(last, END) : Number.POSITIVE_INFINITY
  console.log(
    `lengte ${km.toFixed(1)} km, einde ${last?.lat.toFixed(4)}, ${last?.lon.toFixed(4)}, tot Leenderheide ${(toEnd / 1000).toFixed(1)} km`,
  )
  if (km < 70 || toEnd > 4000) throw new Error(`route te kort of te ver van Leenderheide: ${km.toFixed(1)} km`)

  const cumulative = built.cumulative
  let switchAt = 0
  let nearest = Number.POSITIVE_INFINITY
  for (let i = 0; i < built.points.length; i++) {
    const distance = distanceMeters(built.points[i], ROERMOND)
    if (distance < nearest) {
      nearest = distance
      switchAt = cumulative[i]
    }
  }
  console.log(`Roermond-kruising op ${(switchAt / 1000).toFixed(1)} km (hemelsbreed ${(nearest / 1000).toFixed(1)} km)`)

  const random = mulberry32(0xa2a2)
  const total = cumulative[cumulative.length - 1]
  const started = Date.now()
  const rows: string[] = []
  let dist = 0
  let index = 0
  while (dist < total - 5 && index < 20_000) {
    const here = pointAlong(built.points, dist)
    const ahead = pointAlong(built.points, Math.min(total - 1, dist + 80))
    const back = pointAlong(built.points, Math.max(0, dist - 40))
    if (!here) break
    const turn = Math.abs(normalizeAngle((ahead?.bearing ?? here.bearing) - (back?.bearing ?? here.bearing)))
    let kmh = dist < switchAt ? 100 : 120
    kmh *= 1 - Math.min(0.18, turn / 160)
    const noisy = destination(here.point, random() * 360, random() * 3)
    const time = new Date(started + index * 1000).toISOString()
    rows.push(
      `      <trkpt lat="${noisy.lat.toFixed(6)}" lon="${noisy.lon.toFixed(6)}"><time>${time}</time><extensions><course>${here.bearing.toFixed(1)}</course><speed>${(kmh / 3.6).toFixed(2)}</speed></extensions></trkpt>`,
    )
    dist += kmh / 3.6
    index += 1
  }

  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="koelkast" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${xml('A2 Maastricht → Eindhoven')}</name>
    <trkseg>
${rows.join('\n')}
    </trkseg>
  </trk>
</gpx>
`
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, gpx)
  console.log(`${rows.length} punten → ${OUT}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
