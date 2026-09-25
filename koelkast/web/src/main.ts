import { classifyTurn, colorName, RoadCurveLatch, YawCurveLatch, type Bend } from './curve'
import { slicePolyline, type LatLon } from './geometry'
import { GpsTracker, startWakeLock, stopWakeLock, wakeLockHeld, type SmoothedFix } from './gps'
import { mountInstall } from './install'
import { registerSW } from 'virtual:pwa-register'
import { buildGraph, buildPath, matchRoad, waysFromElements, type Graph, type Way } from './matcher'
import {
  loadRoads,
  loadStops,
  roadBBox,
  RefStopsCache,
  TileCache,
  type StopsPayload,
} from './overpass'
import { parseGpx, playTrack, type TrackPoint } from './simulator'
import { averageSpeedMps, evaluateStops, formatStopLine, stopsFromElements } from './stops'
import {
  formatRemainingKm,
  nightlinerDestination,
  PlannedTravelTracker,
  remainingAlongTrack,
  remainingForNightliner,
  type AgendaEvent,
} from './agenda'
import { mountUi, type DriveModel, type LocalSettings } from './ui'
import type { OsmElement } from './types'
import './style.css'

registerSW({ immediate: true })

const FALLBACK = { bocht_drempel_graden: 15, lookahead_seconden: 8 }

const tracker = new GpsTracker()
const roadLatch = new RoadCurveLatch()
const yawLatch = new YawCurveLatch()
const roads = new TileCache(roadBBox, 1000, (box) => track(loadRoads(box)))
// Refetch when ~35 km from the box edge so ~80 km of stop data stays available ahead.
const stops = new RefStopsCache(35_000, (box, refs) => track(loadStops(box, refs)))

let settings: LocalSettings = { drempel: null, lookahead: null, debug: false, rate: 5 }
let serverConfig = FALLBACK
let serverOnline = false
let wakeOk = false
let demoRate: number | null = null
let playback: { stop: () => void } | null = null
let roadWays: Way[] | null = null
let roadGraph: Graph | null = null
let stopWays: Way[] | null = null
let stopGraph: Graph | null = null
let lastStopAt = 0
let fuelLine = '⛽ …'
let restLine = '🅿 …'
let remainingText = '– km resterend'
let driveLabel: string | null = null
let debugStops: DriveModel['stops'] = []
let nextStops: DriveModel['nextStops'] = []
let running = false
let driveSession = 0
let demoTrack: LatLon[] | null = null
let demoCorridor: StopsPayload | null = null
/** True only for the Demo A2 button path (not live Start, not arbitrary GPX). */
let demoA2 = false
let nightliner: AgendaEvent | null = null
/** Short Dutch agenda note for the status line; null when ok / quiet. */
let agendaNote: string | null = null
let lastFix: SmoothedFix | null = null
/** Counts down DESCRIPTION planned-km using GPS travel (no destination GEO). */
const plannedTravel = new PlannedTravelTracker()

const ui = mountUi(document.querySelector<HTMLElement>('#app')!, {
  onStart: () => startGps(),
  onStop: stopAll,
  onDemo: (rate) => void startDemo(rate),
  onGpx: (file, rate) => void startFile(file, rate),
  onSettings: (next) => {
    settings = next
  },
  onInstallHelp: () => install.openHelp(),
  onDebug: (enabled) => {
    settings = { ...settings, debug: enabled }
  },
}, { drempel: FALLBACK.bocht_drempel_graden, lookahead: FALLBACK.lookahead_seconden })

const install = mountInstall(document.querySelector<HTMLElement>('#install')!)
settings = ui.settings()

void loadServerConfig()
void loadAgenda()

async function track<T>(work: Promise<T>): Promise<T> {
  try {
    const value = await work
    serverOnline = true
    return value
  } catch (error) {
    serverOnline = false
    throw error
  }
}

async function loadServerConfig(): Promise<void> {
  try {
    const response = await fetch('/api/config')
    if (!response.ok) throw new Error('config')
    const body = (await response.json()) as { bocht_drempel_graden?: number; lookahead_seconden?: number }
    serverConfig = {
      bocht_drempel_graden: body.bocht_drempel_graden ?? FALLBACK.bocht_drempel_graden,
      lookahead_seconden: body.lookahead_seconden ?? FALLBACK.lookahead_seconden,
    }
    serverOnline = true
  } catch {
    serverOnline = false
  }
}

async function loadAgenda(): Promise<void> {
  try {
    const response = await fetch('/api/agenda')
    const body = (await response.json().catch(() => ({}))) as {
      nightliner?: AgendaEvent | null
      error?: string
      warning?: string
    }
    if (!response.ok) {
      nightliner = null
      agendaNote =
        body.error === 'geen agenda_url'
          ? 'geen agenda'
          : body.error === 'geen iCalendar'
            ? 'agenda ongeldig'
            : 'agenda weg'
      return
    }
    nightliner = body.nightliner ?? null
    agendaNote = typeof body.warning === 'string' && body.warning ? body.warning : null
  } catch {
    nightliner = null
    agendaNote = 'agenda weg'
  }
  if (running) {
    if (lastFix) updateRemaining(lastFix)
    else remainingText = formatRemainingKm(null, resolveDestination())
  }
}

function threshold(): number {
  return settings.drempel ?? serverConfig.bocht_drempel_graden
}

function lookaheadSeconds(): number {
  return settings.lookahead ?? serverConfig.lookahead_seconden
}

function resetDriveLines(): void {
  lastStopAt = 0
  fuelLine = '⛽ …'
  restLine = '🅿 …'
  plannedTravel.reset()
  remainingText = formatRemainingKm(null, resolveDestination())
  driveLabel = demoA2 ? 'Demo A2 Maastricht → Eindhoven' : nightliner?.summary ?? null
  nextStops = []
  debugStops = []
}

function beginGps(): void {
  driveSession += 1
  tracker.stop()
  stopPlayback()
  demoRate = null
  demoTrack = null
  demoCorridor = null
  demoA2 = false
  running = true
  roadLatch.reset()
  yawLatch.reset()
  resetDriveLines()
  startWakeLock()
  ui.showDrive(null, { remaining: remainingText })
  tracker.start(
    (fix) => {
      wakeOk = wakeLockHeld()
      onFix(fix)
    },
    (message) => {
      running = false
      stopWakeLock()
      ui.showStart(message)
    },
  )
}

function startGps(): void {
  const iOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (iOS) ui.confirmLocation(() => beginGps())
  else beginGps()
}

async function startDemo(rate: number): Promise<void> {
  const session = ++driveSession
  startWakeLock()
  const [gpxResponse, corridorResponse] = await Promise.all([
    fetch('/demo/a2-maastricht-eindhoven.gpx'),
    fetch('/demo/a2-corridor.json'),
  ])
  if (session !== driveSession) return
  if (!gpxResponse.ok) {
    ui.showStart('Demorit ontbreekt')
    return
  }
  const points = parseGpx(await gpxResponse.text())
  if (session !== driveSession) return
  if (corridorResponse.ok) {
    try {
      const body = (await corridorResponse.json()) as { elements?: OsmElement[] }
      const elements = body.elements ?? []
      demoCorridor = {
        ways: waysFromElements(
          elements,
          (way) => way.highway === 'motorway' || way.highway === 'motorway_link' || way.highway === 'service',
        ),
        stops: stopsFromElements(elements),
      }
    } catch {
      demoCorridor = null
    }
  } else {
    demoCorridor = null
  }
  if (session !== driveSession) return
  beginPlayback(points, rate, session, true)
}

async function startFile(file: File, rate: number): Promise<void> {
  const session = ++driveSession
  startWakeLock()
  try {
    demoCorridor = null
    beginPlayback(parseGpx(await file.text()), rate, session, false)
  } catch (error) {
    if (session !== driveSession) return
    ui.showStart(error instanceof Error ? error.message : 'GPX niet leesbaar')
  }
}

function beginPlayback(points: TrackPoint[], rate: number, session = driveSession, asDemoA2 = false): void {
  if (session !== driveSession) return
  tracker.stop()
  stopPlayback()
  demoRate = rate
  demoA2 = asDemoA2
  demoTrack = points.map((point) => ({ lat: point.lat, lon: point.lon }))
  running = true
  roadLatch.reset()
  yawLatch.reset()
  resetDriveLines()
  ui.showDrive(rate, { remaining: remainingText })
  tracker.listen((fix) => {
    wakeOk = wakeLockHeld()
    onFix(fix)
  })
  playback = playTrack(
    points,
    rate,
    (fix) => tracker.push(fix),
    () => {
      demoRate = rate
    },
  )
}

function stopPlayback(): void {
  playback?.stop()
  playback = null
}

function stopAll(): void {
  driveSession += 1
  running = false
  demoRate = null
  demoTrack = null
  demoCorridor = null
  demoA2 = false
  lastFix = null
  resetDriveLines()
  tracker.stop()
  stopPlayback()
  stopWakeLock()
  ui.showStart()
}

function graphOf(ways: Way[] | null, current: Way[] | null, graph: Graph | null): { ways: Way[] | null; graph: Graph | null } {
  if (!ways) return { ways: null, graph: null }
  if (ways === current && graph) return { ways: current, graph }
  return { ways, graph: buildGraph(ways) }
}

function onFix(fix: SmoothedFix): void {
  if (!running) return
  lastFix = fix
  // Advance planned-km countdown on every fix so 2s UI throttle does not undercount.
  if (!demoA2 && nightliner) {
    const planned = plannedKmIfNeeded(nightliner, fix)
    if (planned != null) plannedTravel.tick(nightliner.uid, planned, fix)
  }
  roads.ensure(fix.lat, fix.lon)
  const roadState = graphOf(roads.data, roadWays, roadGraph)
  roadWays = roadState.ways
  roadGraph = roadState.graph

  const heading = fix.heading
  let bend: Bend = 'straight'
  let matched: LatLon[] | null = null
  let lookahead: LatLon[] | null = null
  let matchedRefs: string[] = []

  if (roadGraph && heading != null) {
    const match = matchRoad(roadGraph, fix, heading)
    if (match) {
      matchedRefs = match.travel.way.refs
      const ahead = Math.max(150, (fix.speed ?? 0) * lookaheadSeconds())
      const path = buildPath(roadGraph, match, {
        behindM: 80,
        aheadM: Math.max(ahead, 400),
        allowLinks: true,
        motorwayOnly: false,
      })
      matched = path.points
      const window = slicePolyline(path.points, path.ourAlong + 50, path.ourAlong + ahead)
      lookahead = window
      bend = roadLatch.update(path.points, path.ourAlong, ahead, threshold())
      yawLatch.reset()
    } else {
      bend = yawLatch.update(yawBend(fix.timestamp), fix.timestamp)
    }
  } else if (heading != null) {
    bend = yawLatch.update(yawBend(fix.timestamp), fix.timestamp)
  }

  if (matchedRefs.length > 0 && !demoCorridor) {
    stops.ensure(fix.lat, fix.lon, matchedRefs)
  }

  const stopPayload = demoCorridor ?? stops.data
  const stopState = graphOf(stopPayload?.ways ?? null, stopWays, stopGraph)
  stopWays = stopState.ways
  stopGraph = stopState.graph

  if (fix.timestamp - lastStopAt > 2000) {
    lastStopAt = fix.timestamp
    updateStops(fix, heading, stopPayload)
    updateRemaining(fix)
  }

  const model: DriveModel = {
    bend,
    speedKmh: fix.speed == null ? null : fix.speed * 3.6,
    fuel: fuelLine,
    rest: restLine,
    remaining: remainingText,
    driveLabel,
    gps: fix.accuracy ? `GPS ${Math.round(fix.accuracy)} m` : 'GPS ok',
    roads: dataLabel(),
    server: [serverOnline ? 'server ok' : 'server weg', agendaNote].filter(Boolean).join(' · '),
    demoRate,
    debug: settings.debug,
    position: fix,
    matched,
    lookahead,
    nextStops,
    stops: debugStops,
    wake: wakeOk,
  }
  ui.update(model)
  document.title = `De Koelkastbeveiligger · ${colorName(bend)}`
}

function yawBend(now: number): Bend {
  const delta = tracker.headingChange(now)
  if (delta == null) return 'straight'
  return classifyTurn(delta, threshold())
}

function updateStops(fix: SmoothedFix, heading: number | null, payload: StopsPayload | null): void {
  const speed = averageSpeedMps(tracker.speedSamples(), fix.timestamp)
  const stopsState = demoCorridor ? 'ok' : stops.state
  if (!stopGraph || !payload || heading == null) {
    fuelLine = '⛽ …'
    restLine = '🅿 …'
    nextStops = []
    debugStops =
      stopsState === 'fout'
        ? [{ lat: fix.lat, lon: fix.lon, name: 'Stops', reason: stops.error ?? 'fout', ok: false }]
        : []
    return
  }
  const match = matchRoad(stopGraph, fix, heading, {
    maxDistance: 45,
    filter: (way) => way.highway === 'motorway',
  })
  if (!match) {
    fuelLine = formatStopLine('fuel', null, speed)
    restLine = formatStopLine('rest', null, speed)
    nextStops = []
    debugStops = [{ lat: fix.lat, lon: fix.lon, name: 'Positie', reason: 'niet op een snelweg', ok: false }]
    return
  }
  const preferRef = match.travel.way.refs[0]
  const path = buildPath(stopGraph, match, {
    behindM: 2500,
    aheadM: 80_000,
    allowLinks: false,
    motorwayOnly: true,
    gapM: 12,
    preferRef,
  })
  const evaluated = evaluateStops(stopGraph, path, payload.stops)
  fuelLine = formatStopLine('fuel', evaluated.fuel, speed)
  restLine = formatStopLine('rest', evaluated.rest, speed)
  nextStops = [evaluated.fuel, evaluated.rest]
    .filter((hit): hit is NonNullable<typeof hit> => hit != null)
    .map((hit) => ({
      lat: hit.lat,
      lon: hit.lon,
      name: hit.name ?? (hit.kind === 'fuel' ? 'Tankstation' : 'Rustplaats'),
      reason: 'goedgekeurd',
      ok: true,
    }))
  debugStops = evaluated.decisions
    .map((decision) => ({
      lat: decision.lat,
      lon: decision.lon,
      name: decision.name,
      reason: decision.reason,
      ok: decision.ok,
    }))
    .sort((a, b) => Number(b.ok) - Number(a.ok))
  serverOnline = true
}

function resolveDestination(): string | null | undefined {
  // Demo A2 always ends in Eindhoven; live Start uses the agenda nightliner place.
  if (demoA2) return 'Eindhoven'
  if (nightliner) return nightlinerDestination(nightliner)
  return undefined
}

/** Planned DESCRIPTION km only when there is no GEO / lat,lon LOCATION to crow-fly. */
function plannedKmIfNeeded(event: AgendaEvent, here: SmoothedFix): number | null {
  const fromEvent = remainingForNightliner(event, here)
  if (fromEvent?.source !== 'nightliner-planned' || !Number.isFinite(fromEvent.km)) return null
  return fromEvent.km
}

function updateRemaining(fix: SmoothedFix): void {
  const destination = resolveDestination()
  // Demo A2 always measures along the GPX, even if a nightliner is on the agenda.
  if (demoTrack && demoA2) {
    plannedTravel.reset()
    const meters = remainingAlongTrack(demoTrack, fix)
    remainingText = formatRemainingKm(meters == null ? null : meters / 1000, destination)
    driveLabel = 'Demo A2 Maastricht → Eindhoven'
    return
  }
  if (nightliner) {
    const fromEvent = remainingForNightliner(nightliner, fix)
    if (fromEvent && fromEvent.source === 'nightliner-planned' && Number.isFinite(fromEvent.km)) {
      // Odometer already advanced in onFix; only seed if this is the first reading.
      const km = plannedTravel.remainingKm() ?? plannedTravel.tick(nightliner.uid, fromEvent.km, fix)
      remainingText = formatRemainingKm(km, destination)
      driveLabel = nightliner.summary
      return
    }
    plannedTravel.reset()
    if (fromEvent && fromEvent.source !== 'onbekend' && Number.isFinite(fromEvent.km)) {
      remainingText = formatRemainingKm(fromEvent.km, destination)
      driveLabel = nightliner.summary
      return
    }
    driveLabel = nightliner.summary
  } else {
    plannedTravel.reset()
    driveLabel = null
  }
  if (demoTrack) {
    const meters = remainingAlongTrack(demoTrack, fix)
    remainingText = formatRemainingKm(meters == null ? null : meters / 1000, destination)
    if (!driveLabel) driveLabel = null
    return
  }
  remainingText = formatRemainingKm(null, destination)
}

function dataLabel(): string {
  if (demoCorridor) return `${tileLabel('wegen', roads.state, roads.error)} · stops ok`
  return `${tileLabel('wegen', roads.state, roads.error)} · ${tileLabel('stops', stops.state, stops.error)}`
}

function tileLabel(name: string, state: string, error: string | null): string {
  if (state === 'laden') return `${name} laden`
  if (state === 'fout') return `${name}: ${(error ?? 'fout').slice(0, 48)}`
  if (state === 'ok') return `${name} ok`
  return `${name} …`
}
