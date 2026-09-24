import { bearingDegrees, distanceMeters } from './geometry'
import type { RawFix } from './gps'

export type TrackPoint = {
  lat: number
  lon: number
  time: number
  heading: number | null
  speed: number | null
}

export function parseGpx(xml: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Ongeldig GPX-bestand')
  const points = [...doc.getElementsByTagName('trkpt')]
  const parsed: TrackPoint[] = []
  for (const point of points) {
    const lat = Number(point.getAttribute('lat'))
    const lon = Number(point.getAttribute('lon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const timeText = point.getElementsByTagName('time')[0]?.textContent ?? ''
    const time = Date.parse(timeText)
    const heading = numberTag(point, 'course')
    const speed = numberTag(point, 'speed')
    parsed.push({
      lat,
      lon,
      time: Number.isFinite(time) ? time : Number.NaN,
      heading,
      speed,
    })
  }
  if (parsed.length < 2) throw new Error('GPX bevat te weinig punten')
  if (!Number.isFinite(parsed[0].time)) {
    parsed.forEach((point, index) => {
      point.time = index * 1000
    })
  }
  for (let i = 1; i < parsed.length; i++) {
    if (!Number.isFinite(parsed[i].time) || parsed[i].time <= parsed[i - 1].time) {
      parsed[i].time = parsed[i - 1].time + 1000
    }
    if (parsed[i].heading == null) parsed[i].heading = bearingDegrees(parsed[i - 1], parsed[i])
    if (parsed[i].speed == null) {
      const seconds = (parsed[i].time - parsed[i - 1].time) / 1000
      parsed[i].speed = distanceMeters(parsed[i - 1], parsed[i]) / Math.max(0.2, seconds)
    }
  }
  if (parsed[0].heading == null) parsed[0].heading = parsed[1].heading
  if (parsed[0].speed == null) parsed[0].speed = parsed[1].speed
  return parsed
}

function numberTag(point: Element, name: string): number | null {
  const node = point.getElementsByTagName(name)[0]
  if (!node?.textContent) return null
  const value = Number(node.textContent)
  return Number.isFinite(value) ? value : null
}

export function sampleTrack(points: TrackPoint[], time: number): RawFix {
  if (time <= points[0].time) return toFix(points[0], points[1])
  const last = points[points.length - 1]
  if (time >= last.time) return toFix(last, points[points.length - 2])
  let index = 1
  while (index < points.length && points[index].time < time) index++
  const b = points[index]
  const a = points[index - 1]
  const span = Math.max(1, b.time - a.time)
  const t = (time - a.time) / span
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    accuracy: 5,
    heading: b.heading,
    speed: b.speed,
    timestamp: Date.now(),
  }
}

function toFix(point: TrackPoint, other: TrackPoint): RawFix {
  return {
    lat: point.lat,
    lon: point.lon,
    accuracy: 5,
    heading: point.heading ?? bearingDegrees(other, point),
    speed: point.speed,
    timestamp: Date.now(),
  }
}

export function playTrack(
  points: TrackPoint[],
  rate: number,
  onFix: (fix: RawFix) => void,
  onDone: () => void,
): { stop: () => void } {
  let stopped = false
  const startWall = performance.now()
  const startTrack = points[0].time
  const endTrack = points[points.length - 1].time
  const timer = window.setInterval(() => {
    if (stopped) return
    const elapsed = (performance.now() - startWall) * rate
    const time = startTrack + elapsed
    onFix(sampleTrack(points, time))
    if (time >= endTrack) {
      stopped = true
      window.clearInterval(timer)
      onDone()
    }
  }, 200)
  onFix(sampleTrack(points, startTrack))
  return {
    stop() {
      stopped = true
      window.clearInterval(timer)
    },
  }
}
