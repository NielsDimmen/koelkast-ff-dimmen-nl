import { classifyTurn, BendHysteresis, colorName, totalTurnDegrees, type Bend } from './curve'
import { slicePolyline, type LatLon } from './geometry'
import { GpsTracker, startWakeLock, stopWakeLock, wakeLockHeld, type SmoothedFix } from './gps'
import { mountInstall } from './install'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })
import { buildGraph, buildPath, matchRoad, type Graph, type Way } from './matcher'
import { loadRoads, loadStops, roadBBox, stopsBBox, TileCache } from './overpass'
import { parseGpx, playTrack } from './simulator'
import { averageSpeedMps, evaluateStops, formatStopLine } from './stops'
import { mountUi, type DriveModel, type LocalSettings } from './ui'
import './style.css'

const FALLBACK = { bocht_drempel_graden: 15, lookahead_seconden: 8 }

const tracker = new GpsTracker()
const hysteresis = new BendHysteresis(1000)
const roads = new TileCache(roadBBox, 1000, (box) => track(loadRoads(box)))
const stops = new TileCache(stopsBBox, 10_000, (box) => track(loadStops(box)))

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
let debugStops: DriveModel['stops'] = []
let running = false

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

function threshold(): number {
  return settings.drempel ?? serverConfig.bocht_drempel_graden
}

function lookaheadSeconds(): number {
  return settings.lookahead ?? serverConfig.lookahead_seconden
}

function beginGps(): void {
  stopPlayback()
  demoRate = null
  running = true
  hysteresis.reset('straight')
  startWakeLock()
  ui.showDrive()
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
  startWakeLock()
  const response = await fetch('/demo/a2-maastricht-eindhoven.gpx')
  if (!response.ok) {
    ui.showStart('Demorit ontbreekt')
    return
  }
  beginPlayback(parseGpx(await response.text()), rate)
}

async function startFile(file: File, rate: number): Promise<void> {
  startWakeLock()
  try {
    beginPlayback(parseGpx(await file.text()), rate)
  } catch (error) {
    ui.showStart(error instanceof Error ? error.message : 'GPX niet leesbaar')
  }
}

function beginPlayback(points: ReturnType<typeof parseGpx>, rate: number): void {
  tracker.stop()
  stopPlayback()
  demoRate = rate
  running = true
  hysteresis.reset('straight')
  lastStopAt = 0
  ui.showDrive()
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
  running = false
  demoRate = null
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
  roads.ensure(fix.lat, fix.lon)
  stops.ensure(fix.lat, fix.lon)
  const roadState = graphOf(roads.data, roadWays, roadGraph)
  roadWays = roadState.ways
  roadGraph = roadState.graph
  const stopState = graphOf(stops.data?.ways ?? null, stopWays, stopGraph)
  stopWays = stopState.ways
  stopGraph = stopState.graph

  const heading = fix.heading
  let bend: Bend = 'straight'
  let matched: LatLon[] | null = null
  let lookahead: LatLon[] | null = null

  if (roadGraph && heading != null) {
    const match = matchRoad(roadGraph, fix, heading)
    if (match) {
      const ahead = Math.max(150, (fix.speed ?? 0) * lookaheadSeconds())
      const path = buildPath(roadGraph, match, {
        behindM: 80,
        aheadM: ahead,
        allowLinks: true,
        motorwayOnly: false,
      })
      matched = path.points
      const window = slicePolyline(path.points, path.ourAlong + 50, path.ourAlong + ahead)
      lookahead = window
      bend = window.length >= 3 ? classifyTurn(totalTurnDegrees(window), threshold()) : yawBend(fix.timestamp)
    } else {
      bend = yawBend(fix.timestamp)
    }
  } else if (heading != null) {
    bend = yawBend(fix.timestamp)
  }

  const shown = hysteresis.update(bend, fix.timestamp)
  if (fix.timestamp - lastStopAt > 2000) {
    lastStopAt = fix.timestamp
    updateStops(fix, heading)
  }

  const model: DriveModel = {
    bend: shown,
    speedKmh: fix.speed == null ? null : fix.speed * 3.6,
    fuel: fuelLine,
    rest: restLine,
    gps: fix.accuracy ? `GPS ${Math.round(fix.accuracy)} m` : 'GPS ok',
    roads: dataLabel(),
    server: serverOnline ? 'server ok' : 'server weg',
    demoRate,
    debug: settings.debug,
    position: fix,
    matched,
    lookahead,
    stops: debugStops,
    wake: wakeOk,
  }
  ui.update(model)
  if (shown) document.title = `Koelkast · ${colorName(shown)}`
}

function yawBend(now: number): Bend {
  const delta = tracker.headingChange(now)
  if (delta == null) return 'straight'
  return classifyTurn(delta, threshold())
}

function updateStops(fix: SmoothedFix, heading: number | null): void {
  const speed = averageSpeedMps(tracker.speedSamples(), fix.timestamp)
  if (!stopGraph || !stops.data || heading == null) {
    fuelLine = '⛽ …'
    restLine = '🅿 …'
    debugStops = stops.state === 'fout'
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
    debugStops = [{ lat: fix.lat, lon: fix.lon, name: 'Positie', reason: 'niet op een snelweg', ok: false }]
    return
  }
  const path = buildPath(stopGraph, match, {
    behindM: 2500,
    aheadM: 70_000,
    allowLinks: false,
    motorwayOnly: true,
    gapM: 12,
  })
  const evaluated = evaluateStops(stopGraph, path, stops.data.stops)
  fuelLine = formatStopLine('fuel', evaluated.fuel, speed)
  restLine = formatStopLine('rest', evaluated.rest, speed)
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

function dataLabel(): string {
  return `${tileLabel('wegen', roads.state, roads.error)} · ${tileLabel('stops', stops.state, stops.error)}`
}

function tileLabel(name: string, state: string, error: string | null): string {
  if (state === 'laden') return `${name} laden`
  if (state === 'fout') return `${name}: ${(error ?? 'fout').slice(0, 48)}`
  if (state === 'ok') return `${name} ok`
  return `${name} …`
}
