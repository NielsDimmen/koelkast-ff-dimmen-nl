import { bearingDegrees, distanceMeters, normalizeAngle, type LatLon } from './geometry'

export type RawFix = {
  lat: number
  lon: number
  accuracy: number
  heading: number | null
  speed: number | null
  timestamp: number
}

export type SmoothedFix = RawFix & {
  heading: number | null
  speed: number | null
}

const HEADING_ALPHA = 0.35
const SPEED_ALPHA = 0.3
const MIN_MOVE_M = 4

function smoothAngle(previous: number | null, next: number, alpha: number): number {
  if (previous == null || !Number.isFinite(previous)) return next
  return (previous + alpha * normalizeAngle(next - previous) + 360) % 360
}

export class GpsTracker {
  private watchId: number | null = null
  private lastRaw: RawFix | null = null
  private smoothedHeading: number | null = null
  private smoothedSpeed: number | null = null
  private readonly headings: { t: number; heading: number }[] = []
  private readonly speeds: { t: number; speed: number }[] = []
  private onFix: ((fix: SmoothedFix) => void) | null = null

  listen(onFix: (fix: SmoothedFix) => void): void {
    this.onFix = onFix
  }

  start(onFix: (fix: SmoothedFix) => void, onError: (message: string) => void): void {
    this.onFix = onFix
    if (!navigator.geolocation) {
      onError('Deze browser heeft geen GPS')
      return
    }
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.push({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
          speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
          timestamp: Date.now(),
        })
      },
      (error) => onError(gpsMessage(error)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    )
  }

  stop(): void {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId)
    this.watchId = null
    this.onFix = null
  }

  push(raw: RawFix): SmoothedFix {
    const derived = this.derive(raw)
    const heading = derived.heading == null ? this.smoothedHeading : smoothAngle(this.smoothedHeading, derived.heading, HEADING_ALPHA)
    const speed =
      derived.speed == null
        ? this.smoothedSpeed
        : this.smoothedSpeed == null
          ? derived.speed
          : this.smoothedSpeed + SPEED_ALPHA * (derived.speed - this.smoothedSpeed)
    this.smoothedHeading = heading
    this.smoothedSpeed = speed
    this.lastRaw = raw
    if (heading != null) {
      this.headings.push({ t: raw.timestamp, heading })
      while (this.headings.length && raw.timestamp - this.headings[0].t > 5000) this.headings.shift()
    }
    if (speed != null) {
      this.speeds.push({ t: raw.timestamp, speed })
      while (this.speeds.length && raw.timestamp - this.speeds[0].t > 130_000) this.speeds.shift()
    }
    const fix: SmoothedFix = { ...raw, heading, speed }
    this.onFix?.(fix)
    return fix
  }

  headingChange(now: number): number | null {
    const recent = this.headings.filter((sample) => now - sample.t <= 3000)
    if (recent.length < 2) return null
    if (recent[recent.length - 1].t - recent[0].t < 2000) return null
    return normalizeAngle(recent[recent.length - 1].heading - recent[0].heading)
  }

  speedSamples(): { t: number; speed: number }[] {
    return this.speeds
  }

  private derive(raw: RawFix): { heading: number | null; speed: number | null } {
    let heading = raw.heading
    let speed = raw.speed
    if ((heading == null || speed == null) && this.lastRaw) {
      const moved = distanceMeters(this.lastRaw, raw)
      const seconds = Math.max(0.2, (raw.timestamp - this.lastRaw.timestamp) / 1000)
      if (heading == null && moved >= MIN_MOVE_M) heading = bearingDegrees(this.lastRaw, raw)
      if (speed == null) speed = moved / seconds
    }
    if (speed != null && speed < 0) speed = 0
    return { heading, speed }
  }
}

function gpsMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return 'Locatie geweigerd'
  if (error.code === error.TIMEOUT) return 'GPS-timeout'
  return 'GPS niet beschikbaar'
}

let wakeLock: WakeLockSentinel | null = null
let wakeWanted = false
let wakeActive = false

async function requestWakeLock(): Promise<void> {
  if (!wakeWanted || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeActive = true
    wakeLock.addEventListener('release', () => {
      wakeActive = false
    })
  } catch {
    wakeLock = null
    wakeActive = false
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') void requestWakeLock()
}

export function startWakeLock(): void {
  wakeWanted = true
  document.addEventListener('visibilitychange', onVisibility)
  void requestWakeLock()
}

export function stopWakeLock(): void {
  wakeWanted = false
  wakeActive = false
  document.removeEventListener('visibilitychange', onVisibility)
  void wakeLock?.release()
  wakeLock = null
}

export function wakeLockHeld(): boolean {
  return wakeActive
}

export function movedEnough(a: LatLon, b: LatLon): boolean {
  return distanceMeters(a, b) >= MIN_MOVE_M
}
