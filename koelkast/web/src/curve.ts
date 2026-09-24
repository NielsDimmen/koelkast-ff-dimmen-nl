import { bearingDegrees, distanceMeters, normalizeAngle, type LatLon } from './geometry'

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

/**
 * New bend is shown only after it has stayed the same for `holdMs`.
 * Stops the screen flickering when the detector chatters around the threshold.
 */
export class BendHysteresis {
  private shown: Bend = 'straight'
  private pending: Bend | null = null
  private since = 0

  constructor(private readonly holdMs = 1000) {}

  update(next: Bend, now: number): Bend {
    if (next === this.shown) {
      this.pending = null
      return this.shown
    }
    if (this.pending !== next) {
      this.pending = next
      this.since = now
      return this.shown
    }
    if (now - this.since >= this.holdMs) {
      this.shown = next
      this.pending = null
    }
    return this.shown
  }

  reset(bend: Bend = 'straight'): void {
    this.shown = bend
    this.pending = null
    this.since = 0
  }
}
