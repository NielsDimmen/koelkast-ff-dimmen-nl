import {
  bearingDegrees,
  cumulativeDistances,
  distanceMeters,
  normalizeAngle,
  projectPointOnSegment,
  type LatLon,
} from './geometry'
import type { OsmElement } from './types'

export type Way = {
  id: number
  nodeIds: number[]
  geometry: LatLon[]
  highway: string
  refs: string[]
  oneway: -1 | 0 | 1
  tags: Record<string, string>
}

export type Travel = {
  key: string
  way: Way
  dir: 1 | -1
  nodeIds: number[]
  geometry: LatLon[]
}

export type Graph = {
  travels: Travel[]
  byNode: Map<number, { travel: Travel; index: number }[]>
}

export type Match = {
  travel: Travel
  segmentIndex: number
  point: LatLon
  bearing: number
  distance: number
  alongSegment: number
}

export type BuiltPath = {
  points: LatLon[]
  cumulative: number[]
  ourAlong: number
  nodes: { id: number; along: number }[]
  refs: string[]
  highway: string
}

export type PathOpts = {
  behindM: number
  aheadM: number
  allowLinks: boolean
  motorwayOnly: boolean
  maxAngle?: number
  gapM?: number
  /** When several refs match, prefer this road number. Used by the A2 demo. */
  preferRef?: string
  untilNear?: { at: LatLon; radiusM: number }
}

export const MATCH_MAX_DISTANCE_M = 30
export const MATCH_MAX_ANGLE_DEG = 45

const DRIVING = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/

export function isDrivableHighway(highway: string): boolean {
  return DRIVING.test(highway)
}

export function isLink(highway: string): boolean {
  return highway.endsWith('_link')
}

export function parseRefs(tags: Record<string, string>): string[] {
  return (tags.ref ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function refsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const set = new Set(a)
  return b.some((ref) => set.has(ref))
}

export function parseOneway(tags: Record<string, string>, highway: string): -1 | 0 | 1 {
  const value = (tags.oneway ?? '').toLowerCase()
  if (value === 'yes' || value === '1' || value === 'true') return 1
  if (value === '-1' || value === 'reverse') return -1
  if (value === 'no' || value === '0' || value === 'false') return 0
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1
  if (highway === 'motorway' || highway === 'motorway_link') return 1
  return 0
}

export function wayFromElement(element: OsmElement): Way | null {
  if (element.type !== 'way') return null
  const tags = element.tags ?? {}
  const highway = tags.highway ?? ''
  const geometry = element.geometry
  const nodeIds = element.nodes
  if (!geometry || geometry.length < 2 || !nodeIds || nodeIds.length !== geometry.length) return null
  if (!highway) return null
  return {
    id: element.id,
    nodeIds,
    geometry: geometry.map((point) => ({ lat: point.lat, lon: point.lon })),
    highway,
    refs: parseRefs(tags),
    oneway: parseOneway(tags, highway),
    tags,
  }
}

export function waysFromElements(elements: OsmElement[], filter?: (way: Way) => boolean): Way[] {
  const ways: Way[] = []
  for (const element of elements) {
    const way = wayFromElement(element)
    if (!way) continue
    if (filter && !filter(way)) continue
    ways.push(way)
  }
  return ways
}

export function travelsOf(way: Way): Travel[] {
  const forward: Travel = {
    key: `${way.id}:1`,
    way,
    dir: 1,
    nodeIds: way.nodeIds,
    geometry: way.geometry,
  }
  if (way.oneway === 1) return [forward]
  const backward: Travel = {
    key: `${way.id}:-1`,
    way,
    dir: -1,
    nodeIds: [...way.nodeIds].reverse(),
    geometry: [...way.geometry].reverse(),
  }
  if (way.oneway === -1) return [backward]
  return [forward, backward]
}

export function buildGraph(ways: Way[]): Graph {
  const travels = ways.flatMap(travelsOf)
  const byNode = new Map<number, { travel: Travel; index: number }[]>()
  for (const travel of travels) {
    travel.nodeIds.forEach((id, index) => {
      const list = byNode.get(id)
      const entry = { travel, index }
      if (list) list.push(entry)
      else byNode.set(id, [entry])
    })
  }
  return { travels, byNode }
}

export function matchRoad(
  graph: Graph,
  position: LatLon,
  heading: number,
  opts?: { maxDistance?: number; maxAngle?: number; filter?: (way: Way) => boolean },
): Match | null {
  const maxDistance = opts?.maxDistance ?? MATCH_MAX_DISTANCE_M
  const maxAngle = opts?.maxAngle ?? MATCH_MAX_ANGLE_DEG
  let best: Match | null = null
  for (const travel of graph.travels) {
    if (opts?.filter && !opts.filter(travel.way)) continue
    for (let i = 0; i < travel.geometry.length - 1; i++) {
      const a = travel.geometry[i]
      const b = travel.geometry[i + 1]
      const segLen = distanceMeters(a, b)
      if (segLen < 0.5) continue
      const projected = projectPointOnSegment(position, a, b)
      if (projected.distance > maxDistance) continue
      const bearing = bearingDegrees(a, b)
      const angle = Math.abs(normalizeAngle(bearing - heading))
      if (angle > maxAngle) continue
      if (
        !best ||
        projected.distance < best.distance - 0.5 ||
        (Math.abs(projected.distance - best.distance) <= 0.5 && angle < Math.abs(normalizeAngle(best.bearing - heading)))
      ) {
        best = {
          travel,
          segmentIndex: i,
          point: projected.point,
          bearing,
          distance: projected.distance,
          alongSegment: segLen * projected.t,
        }
      }
    }
  }
  return best
}

type Piece = { travel: Travel; from: number; to: number }

type Candidate = { travel: Travel; index: number; angle: number }

function pieceLength(piece: Piece): number {
  let length = 0
  for (let i = piece.from + 1; i <= piece.to; i++) {
    length += distanceMeters(piece.travel.geometry[i - 1], piece.travel.geometry[i])
  }
  return length
}

function highwayAllowed(candidate: Way, current: Way, opts: PathOpts): boolean {
  const preferredLink = Boolean(opts.preferRef && candidate.refs.includes(opts.preferRef) && isLink(candidate.highway))
  if (opts.motorwayOnly && candidate.highway !== 'motorway' && !preferredLink) return false
  if (!opts.allowLinks && isLink(candidate.highway) && !isLink(current.highway) && !preferredLink) return false
  return true
}

function refRank(way: Way, lockedRefs: string[], preferRef?: string): number {
  if (!preferRef) return lockedRefs.length === 0 || refsOverlap(lockedRefs, way.refs) ? 0 : 1
  if (way.refs.includes(preferRef) && !isLink(way.highway)) return 0
  if (way.refs.includes(preferRef)) return 1
  if (refsOverlap(lockedRefs, way.refs)) return 2
  return 3
}

function compareCandidates(a: Candidate, b: Candidate, lockedRefs: string[], lockedHighway: string, preferRef?: string): number {
  const refA = refRank(a.travel.way, lockedRefs, preferRef)
  const refB = refRank(b.travel.way, lockedRefs, preferRef)
  if (refA !== refB) return refA - refB
  const classOf = (highway: string) => highway.replace(/_link$/, '')
  const classA = classOf(a.travel.way.highway) === classOf(lockedHighway) ? 0 : 1
  const classB = classOf(b.travel.way.highway) === classOf(lockedHighway) ? 0 : 1
  if (classA !== classB) return classA - classB
  return Math.abs(a.angle) - Math.abs(b.angle)
}

function candidatesAt(
  graph: Graph,
  nodeId: number,
  current: Travel,
  incomingBearing: number,
  opts: PathOpts,
  lockedRefs: string[],
  lockedHighway: string,
  visited: Set<string>,
): Candidate[] {
  const maxAngle = opts.maxAngle ?? 80
  const found: Candidate[] = []
  for (const occurrence of graph.byNode.get(nodeId) ?? []) {
    if (occurrence.index >= occurrence.travel.nodeIds.length - 1) continue
    if (visited.has(occurrence.travel.key)) continue
    if (occurrence.travel.way.id === current.way.id) continue
    if (!highwayAllowed(occurrence.travel.way, current.way, opts)) continue
    const bearing = bearingDegrees(
      occurrence.travel.geometry[occurrence.index],
      occurrence.travel.geometry[occurrence.index + 1],
    )
    const angle = normalizeAngle(bearing - incomingBearing)
    if (Math.abs(angle) > maxAngle) continue
    found.push({ travel: occurrence.travel, index: occurrence.index, angle })
  }
  found.sort((a, b) => compareCandidates(a, b, lockedRefs, lockedHighway, opts.preferRef))
  return found
}

function bridgeCandidate(
  graph: Graph,
  endPoint: LatLon,
  incomingBearing: number,
  current: Travel,
  opts: PathOpts,
  lockedRefs: string[],
  lockedHighway: string,
  visited: Set<string>,
): Candidate | null {
  const gap = opts.gapM ?? 0
  if (gap <= 0) return null
  const maxAngle = opts.maxAngle ?? 80
  let best: Candidate | null = null
  for (const travel of graph.travels) {
    if (visited.has(travel.key) || travel.way.id === current.way.id) continue
    if (!highwayAllowed(travel.way, current.way, opts)) continue
    const gapDistance = distanceMeters(endPoint, travel.geometry[0])
    if (gapDistance > gap || gapDistance < 0.4) continue
    const bearing = bearingDegrees(travel.geometry[0], travel.geometry[1])
    const angle = normalizeAngle(bearing - incomingBearing)
    if (Math.abs(angle) > maxAngle) continue
    const candidate = { travel, index: 0, angle }
    if (!best || compareCandidates(candidate, best, lockedRefs, lockedHighway, opts.preferRef) < 0) best = candidate
  }
  return best
}

function pickPrev(
  graph: Graph,
  travel: Travel,
  opts: PathOpts,
  lockedRefs: string[],
  lockedHighway: string,
  visited: Set<string>,
): { travel: Travel; joinIndex: number; angle: number } | null {
  const nodeId = travel.nodeIds[0]
  if (travel.geometry.length < 2) return null
  const outgoing = bearingDegrees(travel.geometry[0], travel.geometry[1])
  const maxAngle = opts.maxAngle ?? 80
  const found: { travel: Travel; joinIndex: number; angle: number }[] = []
  for (const occurrence of graph.byNode.get(nodeId) ?? []) {
    if (occurrence.index === 0) continue
    if (visited.has(occurrence.travel.key)) continue
    if (occurrence.travel.way.id === travel.way.id) continue
    if (!highwayAllowed(occurrence.travel.way, travel.way, opts)) continue
    const arrive = bearingDegrees(
      occurrence.travel.geometry[occurrence.index - 1],
      occurrence.travel.geometry[occurrence.index],
    )
    const angle = normalizeAngle(outgoing - arrive)
    if (Math.abs(angle) > maxAngle) continue
    found.push({ travel: occurrence.travel, joinIndex: occurrence.index, angle })
  }
  found.sort((a, b) =>
    compareCandidates(
      { travel: a.travel, index: a.joinIndex, angle: a.angle },
      { travel: b.travel, index: b.joinIndex, angle: b.angle },
      lockedRefs,
      lockedHighway,
      opts.preferRef,
    ),
  )
  return found[0] ?? null
}

function extendBackward(
  graph: Graph,
  travel: Travel,
  behindM: number,
  opts: PathOpts,
  lockedRefs: string[],
  lockedHighway: string,
): Piece[] {
  const pieces: Piece[] = []
  let cursor = travel
  let remaining = behindM
  const visited = new Set<string>([travel.key])
  let guard = 0
  while (remaining > 0 && guard++ < 80) {
    const prev = pickPrev(graph, cursor, opts, lockedRefs, lockedHighway, visited)
    if (!prev) break
    visited.add(prev.travel.key)
    const piece = { travel: prev.travel, from: 0, to: prev.joinIndex }
    pieces.unshift(piece)
    remaining -= pieceLength(piece)
    cursor = prev.travel
  }
  return pieces
}

function extendForward(
  graph: Graph,
  travel: Travel,
  aheadM: number,
  opts: PathOpts,
  lockedRefs: string[],
  lockedHighway: string,
): Piece[] {
  const pieces: Piece[] = []
  let current = travel
  let remaining = aheadM
  const visited = new Set<string>([travel.key])
  let guard = 0
  while (remaining > 0 && guard++ < 500) {
    const endIndex = current.geometry.length - 1
    const endPoint = current.geometry[endIndex]
    const incoming = bearingDegrees(current.geometry[endIndex - 1], endPoint)
    let next = candidatesAt(
      graph,
      current.nodeIds[endIndex],
      current,
      incoming,
      opts,
      lockedRefs,
      lockedHighway,
      visited,
    )[0]
    if (!next) {
      const bridged = bridgeCandidate(
        graph,
        endPoint,
        incoming,
        current,
        opts,
        lockedRefs,
        lockedHighway,
        visited,
      )
      if (bridged) next = bridged
    }
    if (!next) break
    visited.add(next.travel.key)
    const piece = { travel: next.travel, from: next.index, to: next.travel.geometry.length - 1 }
    pieces.push(piece)
    remaining -= pieceLength(piece)
    current = next.travel
    if (opts.untilNear) {
      const end = piece.travel.geometry[piece.to]
      if (distanceMeters(end, opts.untilNear.at) <= opts.untilNear.radiusM) break
    }
  }
  return pieces
}

export function buildPath(graph: Graph, match: Match, opts: PathOpts): BuiltPath {
  const lockedRefs = match.travel.way.refs
  const lockedHighway = opts.motorwayOnly ? 'motorway' : match.travel.way.highway
  const backward = extendBackward(graph, match.travel, opts.behindM + 1000, opts, lockedRefs, lockedHighway)
  const forward = extendForward(graph, match.travel, opts.aheadM + 1000, opts, lockedRefs, lockedHighway)
  const pieces: Piece[] = [
    ...backward,
    { travel: match.travel, from: 0, to: match.travel.geometry.length - 1 },
    ...forward,
  ]

  const points: LatLon[] = []
  const nodeIds: number[] = []
  for (const piece of pieces) {
    for (let i = piece.from; i <= piece.to; i++) {
      const id = piece.travel.nodeIds[i]
      if (nodeIds.length > 0 && nodeIds[nodeIds.length - 1] === id) continue
      if (points.length > 0 && distanceMeters(points[points.length - 1], piece.travel.geometry[i]) < 0.2) {
        nodeIds[nodeIds.length - 1] = id
        continue
      }
      points.push(piece.travel.geometry[i])
      nodeIds.push(id)
    }
  }

  let cumulative = cumulativeDistances(points)
  const projected = projectOnto(points, cumulative, match.point)
  let ourAlong = projected?.along ?? 0

  if (opts.untilNear && points.length > 2) {
    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < points.length; i++) {
      if (cumulative[i] < ourAlong) continue
      const distance = distanceMeters(points[i], opts.untilNear.at)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }
    if (bestDistance < opts.untilNear.radiusM * 3) {
      points.splice(bestIndex + 1)
      nodeIds.splice(bestIndex + 1)
      cumulative = cumulativeDistances(points)
      ourAlong = projectOnto(points, cumulative, match.point)?.along ?? ourAlong
    }
  }

  const from = Math.max(0, ourAlong - opts.behindM)
  const to = ourAlong + opts.aheadM
  let keepFrom = 0
  for (let i = 0; i < cumulative.length; i++) {
    if (cumulative[i] <= from) keepFrom = i
  }
  let keepTo = cumulative.findIndex((value) => value >= to)
  if (keepTo === -1) keepTo = points.length
  else keepTo += 1
  const start = Math.max(0, keepFrom)
  const slicedPoints = points.slice(start, keepTo)
  const slicedIds = nodeIds.slice(start, keepTo)
  const slicedCumulative = cumulativeDistances(slicedPoints)
  const slicedOur = projectOnto(slicedPoints, slicedCumulative, match.point)?.along ?? Math.max(0, ourAlong - cumulative[start])
  const nodes: { id: number; along: number }[] = []
  for (let i = 0; i < slicedIds.length; i++) {
    nodes.push({ id: slicedIds[i], along: slicedCumulative[i] })
  }

  return {
    points: slicedPoints,
    cumulative: slicedCumulative,
    ourAlong: slicedOur,
    nodes,
    refs: lockedRefs,
    highway: match.travel.way.highway,
  }
}

function projectOnto(points: LatLon[], cumulative: number[], point: LatLon): { along: number } | null {
  if (points.length < 2) return null
  let best = Number.POSITIVE_INFINITY
  let along = 0
  for (let i = 0; i < points.length - 1; i++) {
    const projected = projectPointOnSegment(point, points[i], points[i + 1])
    if (projected.distance < best) {
      best = projected.distance
      const seg = distanceMeters(points[i], points[i + 1])
      along = cumulative[i] + seg * projected.t
    }
  }
  return { along }
}

export function pathLength(path: BuiltPath): number {
  return path.cumulative[path.cumulative.length - 1] ?? 0
}
