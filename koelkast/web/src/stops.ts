import {
  bearingDegrees,
  distanceMeters,
  distanceToPolyline,
  normalizeAngle,
  projectOntoPolyline,
  signedSideMeters,
  type LatLon,
} from './geometry'
import { buildGraph, isLink, type BuiltPath, type Graph, type Travel, type Way } from './matcher'
import type { OsmElement } from './types'

export type StopFeature = {
  id: string
  lat: number
  lon: number
  geometry: LatLon[]
  fuel: boolean
  rest: boolean
  name: string | null
}

export type DecisionReason = 'goedgekeurd' | 'afrit' | 'verkeerde kant' | 'te ver weg' | 'achter ons'

export type Decision = {
  id: string
  name: string
  kinds: string
  lat: number
  lon: number
  ok: boolean
  reason: DecisionReason
  distanceM?: number
  relevant: boolean
}

export type StopHit = {
  id: string
  name: string | null
  lat: number
  lon: number
  distanceM: number
  kind: 'fuel' | 'rest'
}

const NEAR_M = 200
const MERGE_AHEAD_M = 80
const MAX_LOOP_M = 6000
const BRIDGE_M = 40

/**
 * How far along the motorway to search for the next fuel/rest stop.
 * Independent of curve `lookahead_seconden` (that setting only colors bends).
 */
export const STOPS_AHEAD_M = 80_000

function placeName(tags: Record<string, string>): string | null {
  const name = tags.name?.trim()
  if (name) return name
  const brand = tags.brand?.trim()
  if (brand) return brand
  const operator = tags.operator?.trim()
  if (operator) return operator
  return null
}

function centroid(points: LatLon[]): LatLon {
  let lat = 0
  let lon = 0
  for (const point of points) {
    lat += point.lat
    lon += point.lon
  }
  return { lat: lat / points.length, lon: lon / points.length }
}

function isFuel(tags: Record<string, string>): boolean {
  return tags.amenity === 'fuel' || tags.fuel === 'yes'
}

function isRest(tags: Record<string, string>): boolean {
  return tags.highway === 'rest_area' || tags.highway === 'services'
}

function rejectedPlace(tags: Record<string, string>): boolean {
  return tags.highway === 'park_ride' || tags.amenity === 'park_ride' || tags.parking === 'park_ride'
}

export function stopsFromElements(elements: OsmElement[]): StopFeature[] {
  const stops: StopFeature[] = []
  for (const element of elements) {
    const tags = element.tags ?? {}
    if (rejectedPlace(tags)) continue
    const fuel = isFuel(tags)
    const rest = isRest(tags)
    if (!fuel && !rest) continue
    if (element.type === 'node' && element.lat != null && element.lon != null) {
      const point = { lat: element.lat, lon: element.lon }
      stops.push({
        id: `node/${element.id}`,
        lat: point.lat,
        lon: point.lon,
        geometry: [point],
        fuel,
        rest,
        name: placeName(tags),
      })
      continue
    }
    if (element.type === 'way' && element.geometry && element.geometry.length > 0) {
      const geometry = element.geometry.map((point) => ({ lat: point.lat, lon: point.lon }))
      const center = centroid(geometry)
      stops.push({
        id: `way/${element.id}`,
        lat: center.lat,
        lon: center.lon,
        geometry,
        fuel,
        rest,
        name: placeName(tags),
      })
    }
  }
  return stops
}

type Loop = { divergeAlong: number; mergeAlong: number; points: LatLon[] }
type ExitPath = { divergeAlong: number; points: LatLon[] }

function allowedSpur(way: Way): boolean {
  return way.highway === 'motorway_link' || way.highway === 'service'
}

function polylineLength(points: LatLon[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += distanceMeters(points[i - 1], points[i])
  return length
}

function minDistance(stop: StopFeature, line: LatLon[]): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY
  if (line.length === 1) {
    return Math.min(...stop.geometry.map((vertex) => distanceMeters(vertex, line[0])))
  }
  let best = Number.POSITIVE_INFINITY
  for (const vertex of stop.geometry) {
    best = Math.min(best, distanceToPolyline(line, vertex))
  }
  return best
}

function coarseDistance(stop: StopFeature, points: LatLon[]): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i += 6) {
    const distance = distanceMeters(stop, points[i])
    if (distance < best) best = distance
  }
  const last = points[points.length - 1]
  if (last) best = Math.min(best, distanceMeters(stop, last))
  return best
}

function exploreSpurs(graph: Graph, path: BuiltPath): { loops: Loop[]; exits: ExitPath[] } {
  const carriage = new Map<number, number>()
  for (const node of path.nodes) {
    const existing = carriage.get(node.id)
    if (existing == null || node.along < existing) carriage.set(node.id, node.along)
  }
  const loops: Loop[] = []
  const exits: ExitPath[] = []
  const seenDeparture = new Set<string>()

  // Only explore spurs ahead (and slightly behind) — not the whole 80 km behind us.
  const fromAlong = path.ourAlong - 40
  const toAlong = path.ourAlong + STOPS_AHEAD_M
  const carriageNodes = [...carriage.entries()]
    .filter(([, along]) => along >= fromAlong && along <= toAlong)
    .sort((a, b) => a[1] - b[1])
  for (const [nodeId, divergeAlong] of carriageNodes) {
    for (const occurrence of graph.byNode.get(nodeId) ?? []) {
      const travel = occurrence.travel
      if (!isLink(travel.way.highway)) continue
      if (occurrence.index >= travel.nodeIds.length - 1) continue
      const nextId = travel.nodeIds[occurrence.index + 1]
      if (carriage.has(nextId)) continue
      const key = `${divergeAlong}:${travel.key}:${occurrence.index}`
      if (seenDeparture.has(key)) continue
      seenDeparture.add(key)
      const found = walkSpur(graph, travel, occurrence.index, divergeAlong, carriage)
      if (found.loop) loops.push(found.loop)
      else if (found.exit) exits.push(found.exit)
    }
  }
  return { loops, exits }
}

function walkSpur(
  graph: Graph,
  start: Travel,
  startIndex: number,
  divergeAlong: number,
  carriage: Map<number, number>,
): { loop: Loop | null; exit: ExitPath | null } {
  const visited = new Set<string>()
  let bestLoop: Loop | null = null
  let longestExit: ExitPath | null = null
  let budget = 700

  const visit = (
    travel: Travel,
    index: number,
    points: LatLon[],
    length: number,
    bridges: number,
    depth: number,
  ) => {
    if (visited.has(travel.key) || depth > 40 || budget-- <= 0) return
    visited.add(travel.key)
    const local = points.slice()
    let walked = length
    let merged = false
    for (let i = index + 1; i < travel.geometry.length; i++) {
      const previous = local[local.length - 1]
      walked += distanceMeters(previous, travel.geometry[i])
      local.push(travel.geometry[i])
      if (walked > MAX_LOOP_M) {
        visited.delete(travel.key)
        return
      }
      const along = carriage.get(travel.nodeIds[i])
      if (along != null && along >= divergeAlong + MERGE_AHEAD_M) {
        const loop = { divergeAlong, mergeAlong: along, points: local.slice() }
        if (!bestLoop || walked < polylineLength(bestLoop.points)) bestLoop = loop
        merged = true
        break
      }
    }
    if (!merged) {
      const endNode = travel.nodeIds[travel.nodeIds.length - 1]
      const endPoint = travel.geometry[travel.geometry.length - 1]
      const incoming = bearingDegrees(travel.geometry[Math.max(0, travel.geometry.length - 2)], endPoint)
      const nexts: { travel: Travel; index: number; bridged: boolean }[] = []
      for (const occurrence of graph.byNode.get(endNode) ?? []) {
        if (occurrence.index >= occurrence.travel.nodeIds.length - 1) continue
        if (visited.has(occurrence.travel.key)) continue
        if (!allowedSpur(occurrence.travel.way)) continue
        nexts.push({ travel: occurrence.travel, index: occurrence.index, bridged: false })
      }
      if (nexts.length === 0 && bridges < 2) {
        const bridged = bridgeFrom(graph, endPoint, incoming, visited)
        if (bridged) nexts.push({ ...bridged, bridged: true })
      }
      if (nexts.length === 0) {
        const exit = { divergeAlong, points: local }
        if (!longestExit || polylineLength(local) > polylineLength(longestExit.points)) longestExit = exit
      } else {
        nexts.sort((a, b) => {
          const bearingA = bearingDegrees(a.travel.geometry[a.index], a.travel.geometry[a.index + 1])
          const bearingB = bearingDegrees(b.travel.geometry[b.index], b.travel.geometry[b.index + 1])
          return Math.abs(normalizeAngle(bearingA - incoming)) - Math.abs(normalizeAngle(bearingB - incoming))
        })
        for (const next of nexts.slice(0, 3)) {
          visit(next.travel, next.index, local, walked, bridges + (next.bridged ? 1 : 0), depth + 1)
        }
      }
    }
    visited.delete(travel.key)
  }

  visit(start, startIndex, [start.geometry[startIndex]], 0, 0, 0)
  return { loop: bestLoop, exit: bestLoop ? null : longestExit }
}

function bridgeFrom(
  graph: Graph,
  point: LatLon,
  incoming: number,
  visited: Set<string>,
): { travel: Travel; index: number } | null {
  let best: { travel: Travel; index: number; distance: number } | null = null
  for (const travel of graph.travels) {
    if (visited.has(travel.key)) continue
    if (!allowedSpur(travel.way)) continue
    const distance = distanceMeters(point, travel.geometry[0])
    if (distance > BRIDGE_M || distance < 0.4) continue
    const bearing = bearingDegrees(travel.geometry[0], travel.geometry[1])
    if (Math.abs(normalizeAngle(bearing - incoming)) > 70) continue
    if (!best || distance < best.distance) best = { travel, index: 0, distance }
  }
  return best
}

function carriageSection(path: BuiltPath, from: number, to: number): LatLon[] {
  const points: LatLon[] = []
  for (let i = 0; i < path.points.length; i++) {
    const along = path.cumulative[i]
    if (along < from - 30) continue
    if (along > to + 30) break
    points.push(path.points[i])
  }
  return points
}

export function evaluateStops(graph: Graph, path: BuiltPath, stops: StopFeature[]): {
  fuel: StopHit | null
  rest: StopHit | null
  decisions: Decision[]
} {
  if (path.points.length < 2 || path.highway !== 'motorway') {
    return { fuel: null, rest: null, decisions: [] }
  }
  const { loops, exits } = exploreSpurs(graph, path)
  const decisions: Decision[] = []
  const approved: { stop: StopFeature; distanceM: number; side: number }[] = []

  for (const stop of stops) {
    const rough = coarseDistance(stop, path.points)
    if (rough > 3000) continue
    const name = stop.name ?? (stop.fuel && stop.rest ? 'Tankstation' : stop.fuel ? 'Tankstation' : 'Rustplaats')
    const kinds = [stop.fuel ? 'tankstation' : null, stop.rest ? 'rustplaats' : null].filter(Boolean).join('+')
    const projection = projectOntoPolyline(path.points, stop)
    const side = projection ? signedSideMeters(projection.point, projection.bearing, stop) : 0

    let bestLoop: { loop: Loop; distance: number } | null = null
    for (const loop of loops) {
      const section = carriageSection(path, loop.divergeAlong, loop.mergeAlong)
      const distance = Math.min(minDistance(stop, loop.points), minDistance(stop, section))
      if (!bestLoop || distance < bestLoop.distance) bestLoop = { loop, distance }
    }

    let reason: DecisionReason = 'te ver weg'
    let ok = false
    let distanceM: number | undefined

    if (bestLoop && bestLoop.distance <= NEAR_M) {
      if (side <= 0) reason = 'verkeerde kant'
      else if (bestLoop.loop.divergeAlong < path.ourAlong - 40) reason = 'achter ons'
      else {
        ok = true
        reason = 'goedgekeurd'
        distanceM = Math.max(0, bestLoop.loop.divergeAlong - path.ourAlong)
      }
    } else if (rough < 180 && side < -8) {
      reason = 'verkeerde kant'
    } else if (exits.some((exit) => minDistance(stop, exit.points) <= NEAR_M)) {
      reason = side < -8 ? 'verkeerde kant' : 'afrit'
    }

    const relevant = rough < 2500
    decisions.push({
      id: stop.id,
      name,
      kinds,
      lat: stop.lat,
      lon: stop.lon,
      ok,
      reason,
      distanceM,
      relevant,
    })
    if (ok && distanceM != null) approved.push({ stop, distanceM, side })
  }

  return {
    fuel: firstOfKind(approved, 'fuel'),
    rest: firstOfKind(approved, 'rest'),
    decisions: decisions.filter((decision) => decision.relevant),
  }
}

function firstOfKind(
  approved: { stop: StopFeature; distanceM: number }[],
  kind: 'fuel' | 'rest',
): StopHit | null {
  const hits = approved
    .filter((item) => (kind === 'fuel' ? item.stop.fuel : item.stop.rest))
    .sort((a, b) => a.distanceM - b.distanceM || Number(Boolean(b.stop.name)) - Number(Boolean(a.stop.name)))
  let chosen: { stop: StopFeature; distanceM: number } | null = null
  for (const hit of hits) {
    if (chosen && Math.abs(hit.distanceM - chosen.distanceM) < 700) {
      if (!chosen.stop.name && hit.stop.name) chosen = hit
      continue
    }
    if (!chosen) chosen = hit
    else break
  }
  if (!chosen) return null
  return {
    id: chosen.stop.id,
    name: chosen.stop.name,
    lat: chosen.stop.lat,
    lon: chosen.stop.lon,
    distanceM: chosen.distanceM,
    kind,
  }
}

export function formatStopLine(kind: 'fuel' | 'rest', hit: StopHit | null, speedMps: number): string {
  const icon = kind === 'fuel' ? '⛽' : '🅿'
  if (!hit) {
    return `${icon} ${kind === 'fuel' ? 'Geen tankstation vooruit' : 'Geen rustplaats vooruit'}`
  }
  const safeSpeed = speedMps >= 20 / 3.6 ? speedMps : 100 / 3.6
  const minutes = hit.distanceM / safeSpeed / 60
  const minuteText = minutes < 0.5 ? '< 1' : String(Math.round(minutes))
  const km = hit.distanceM / 1000
  const kmText =
    km >= 10
      ? String(Math.round(km))
      : km.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const name = hit.name ?? (kind === 'fuel' ? 'Tankstation' : 'Rustplaats')
  return `${icon} ${minuteText} min · ${kmText} km · ${name}`
}

/** Mean vehicle speed over the last two minutes. Stopped or crawling counts as 100 km/h. */
export function averageSpeedMps(samples: { t: number; speed: number }[], now: number): number {
  const window = samples.filter((sample) => now - sample.t <= 120_000 && Number.isFinite(sample.speed))
  if (window.length === 0) return 100 / 3.6
  const mean = window.reduce((sum, sample) => sum + sample.speed, 0) / window.length
  if (mean < 20 / 3.6) return 100 / 3.6
  return mean
}

export function graphForStops(ways: Way[]): Graph {
  return buildGraph(ways)
}
