import { bearingDegrees, cumulativeDistances, distanceMeters, normalizeAngle, type LatLon } from './geometry'

export type Bend = 'left' | 'right' | 'straight'
export type ColorName = 'green' | 'red' | 'orange'

export const SCREEN_HEX: Record<Bend, string> = {
  left: '#19a34a',
  right: '#e10600',
  straight: '#ff7a00',
}

/** Sum of signed bearing changes. Negative is a left turn. */
export function totalTurnDegrees(points: LatLon[], minSegmentM = 12): number {
  const bearings: number[] = []
  for (let i = 1; i < points.length; i++) {
    if (distanceMeters(points[i - 1], points[i]) < minSegmentM) continue
    bearings.push(bearingDegrees(points[i - 1], points[i]))
  }
  let sum = 0
  for (let i = 1; i < bearings.length; i++) {
    sum += normalizeAngle(bearings[i] - bearings[i - 1])
  }
  return sum
}

/** `< -threshold` is left, `> threshold` is right. */
export function classifyTurn(totalDegrees: number, thresholdDegrees: number): Bend {
  if (totalDegrees < -thresholdDegrees) return 'left'
  if (totalDegrees > thresholdDegrees) return 'right'
  return 'straight'
}

export function colorName(bend: Bend): ColorName {
  if (bend === 'left') return 'green'
  if (bend === 'right') return 'red'
  return 'orange'
}

export function colorForTurn(totalDegrees: number, thresholdDegrees: number): ColorName {
  return colorName(classifyTurn(totalDegrees, thresholdDegrees))
}

export type DangerousCurve = {
  bend: 'left' | 'right'
  /** Meters along the polyline where the turn starts. */
  startAlong: number
  /** Meters along the polyline where the turn finishes. */
  endAlong: number
  turnDegrees: number
}

type Segment = { fromAlong: number; toAlong: number; bearing: number }

/**
 * Find contiguous same-sign bearing runs whose absolute turn exceeds the
 * threshold. Each run is one dangerous curve with a start and end along the
 * road.
 */
export function findDangerousCurves(
  points: LatLon[],
  thresholdDegrees: number,
  minSegmentM = 12,
): DangerousCurve[] {
  if (points.length < 3 || thresholdDegrees <= 0) return []
  const cumulative = cumulativeDistances(points)
  const segments: Segment[] = []
  for (let i = 1; i < points.length; i++) {
    const length = cumulative[i] - cumulative[i - 1]
    if (length < minSegmentM) continue
    segments.push({
      fromAlong: cumulative[i - 1],
      toAlong: cumulative[i],
      bearing: bearingDegrees(points[i - 1], points[i]),
    })
  }
  if (segments.length < 2) return []

  const curves: DangerousCurve[] = []
  let runSign = 0
  let runSum = 0
  let runStart = 0
  let runEnd = 0
  let armed = false

  const flush = () => {
    if (armed && Math.abs(runSum) > thresholdDegrees) {
      curves.push({
        bend: runSum < 0 ? 'left' : 'right',
        startAlong: runStart,
        endAlong: runEnd,
        turnDegrees: runSum,
      })
    }
    runSign = 0
    runSum = 0
    armed = false
  }

  for (let i = 1; i < segments.length; i++) {
    const delta = normalizeAngle(segments[i].bearing - segments[i - 1].bearing)
    if (Math.abs(delta) < 0.5) {
      if (armed && Math.abs(runSum) > thresholdDegrees) {
        // Straightish segment after a real curve: close the curve at the previous end.
        flush()
      }
      continue
    }
    const sign = Math.sign(delta)
    if (runSign !== 0 && sign !== runSign) {
      flush()
    }
    if (runSign === 0) {
      runSign = sign
      runSum = delta
      runStart = segments[i - 1].fromAlong
      runEnd = segments[i].toAlong
      armed = true
    } else {
      runSum += delta
      runEnd = segments[i].toAlong
      armed = true
    }
  }
  flush()
  return curves
}

/**
 * Pure step: given our place on the road, the lookahead and an optional latched
 * curve, return the bend to show and the latch to keep.
 *
 * A latched curve stays until `ourAlong` has passed `endAlong`. Only then may
 * the next curve (already inside the lookahead) take over.
 */
export function latchCurveStep(
  curves: DangerousCurve[],
  ourAlong: number,
  lookaheadM: number,
  latched: DangerousCurve | null,
  passMarginM = 15,
): { bend: Bend; latched: DangerousCurve | null } {
  if (latched && ourAlong < latched.endAlong + passMarginM) {
    return { bend: latched.bend, latched }
  }

  const horizon = ourAlong + lookaheadM
  let next: DangerousCurve | null = null
  for (const curve of curves) {
    if (curve.endAlong + passMarginM <= ourAlong) continue
    if (curve.startAlong > horizon) continue
    if (!next || curve.startAlong < next.startAlong) next = curve
  }
  if (next) return { bend: next.bend, latched: next }
  return { bend: 'straight', latched: null }
}

export class RoadCurveLatch {
  private latched: DangerousCurve | null = null

  update(points: LatLon[], ourAlong: number, lookaheadM: number, thresholdDegrees: number): Bend {
    const curves = findDangerousCurves(points, thresholdDegrees)
    const step = latchCurveStep(curves, ourAlong, lookaheadM, this.latched)
    this.latched = step.latched
    return step.bend
  }

  reset(): void {
    this.latched = null
  }
}

/**
 * GPS fallback without a matched road: once a turn is detected from heading
 * change, hold it until the turn rate settles near zero.
 */
export class YawCurveLatch {
  private shown: Bend = 'straight'
  private calmMs = 0
  private lastT = 0

  update(next: Bend, now: number, settleMs = 800): Bend {
    if (this.shown === 'straight') {
      if (next !== 'straight') {
        this.shown = next
        this.calmMs = 0
        this.lastT = now
      }
      return this.shown
    }
    if (next === this.shown || next === 'straight') {
      if (next === 'straight') {
        if (this.lastT === 0) this.lastT = now
        this.calmMs += Math.max(0, now - this.lastT)
        this.lastT = now
        if (this.calmMs >= settleMs) {
          this.shown = 'straight'
          this.calmMs = 0
        }
      } else {
        this.calmMs = 0
        this.lastT = now
      }
      return this.shown
    }
    // Opposite color while still turning: keep the current latch until calm.
    this.calmMs = 0
    this.lastT = now
    return this.shown
  }

  reset(bend: Bend = 'straight'): void {
    this.shown = bend
    this.calmMs = 0
    this.lastT = 0
  }
}

/** @deprecated Prefer RoadCurveLatch. Kept for older tests of the name. */
export class BendHysteresis {
  private readonly yaw = new YawCurveLatch()
  update(next: Bend, now: number): Bend {
    return this.yaw.update(next, now, 1000)
  }
  reset(bend: Bend = 'straight'): void {
    this.yaw.reset(bend)
  }
}
