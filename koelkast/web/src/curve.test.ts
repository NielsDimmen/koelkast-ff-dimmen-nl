import { describe, expect, it } from 'vitest'
import {
  classifyTurn,
  colorForTurn,
  colorName,
  findDangerousCurves,
  latchCurveStep,
  totalTurnDegrees,
} from './curve'
import { destination, type LatLon } from './geometry'

function arc(startBearing: number, turn: number, steps: number): LatLon[] {
  const points: LatLon[] = [{ lat: 51, lon: 5.7 }]
  let bearing = startBearing
  const step = turn / steps
  for (let i = 0; i < steps; i++) {
    bearing += step
    points.push(destination(points[points.length - 1], bearing, 40))
  }
  return points
}

/** Straight approach, then a left bend, then straight again. */
function leftBendRoad(): LatLon[] {
  const points: LatLon[] = [{ lat: 51, lon: 5.7 }]
  for (let i = 0; i < 8; i++) {
    points.push(destination(points[points.length - 1], 0, 40))
  }
  let bearing = 0
  for (let i = 0; i < 5; i++) {
    bearing -= 8
    points.push(destination(points[points.length - 1], bearing, 40))
  }
  for (let i = 0; i < 8; i++) {
    points.push(destination(points[points.length - 1], bearing, 40))
  }
  return points
}

function rightBendRoad(): LatLon[] {
  const points: LatLon[] = [{ lat: 51, lon: 5.7 }]
  for (let i = 0; i < 8; i++) {
    points.push(destination(points[points.length - 1], 0, 40))
  }
  let bearing = 0
  for (let i = 0; i < 5; i++) {
    bearing += 8
    points.push(destination(points[points.length - 1], bearing, 40))
  }
  for (let i = 0; i < 8; i++) {
    points.push(destination(points[points.length - 1], bearing, 40))
  }
  return points
}

describe('bochtdetectie', () => {
  it('bocht naar links → GROEN', () => {
    const turn = totalTurnDegrees(arc(0, -40, 4))
    expect(turn).toBeLessThan(-15)
    expect(classifyTurn(turn, 15)).toBe('left')
    expect(colorName('left')).toBe('green')
    expect(colorForTurn(turn, 15)).toBe('green')
  })

  it('bocht naar rechts → ROOD', () => {
    const turn = totalTurnDegrees(arc(0, 40, 4))
    expect(turn).toBeGreaterThan(15)
    expect(classifyTurn(turn, 15)).toBe('right')
    expect(colorName('right')).toBe('red')
    expect(colorForTurn(turn, 15)).toBe('red')
  })

  it('rechtdoor blijft oranje, ook op de drempel', () => {
    const straight = [0, 80, 160, 240].map((meters) => destination({ lat: 51, lon: 5.7 }, 0, meters))
    expect(Math.abs(totalTurnDegrees(straight))).toBeLessThan(1)
    expect(colorForTurn(0, 15)).toBe('orange')
    expect(colorForTurn(15, 15)).toBe('orange')
    expect(colorForTurn(-15, 15)).toBe('orange')
  })

  it('houdt groen vast tot de bocht achter ons ligt', () => {
    const road = leftBendRoad()
    const curves = findDangerousCurves(road, 15)
    expect(curves.length).toBeGreaterThanOrEqual(1)
    const curve = curves[0]
    expect(curve.bend).toBe('left')

    // Ver vóór de bocht, buiten de lookahead: oranje
    const far = latchCurveStep(curves, 0, 100, null)
    expect(far.bend).toBe('straight')
    expect(far.latched).toBeNull()

    // Bocht komt in de lookahead: groen, latch
    const enter = latchCurveStep(curves, curve.startAlong - 120, 150, null)
    expect(enter.bend).toBe('left')
    expect(enter.latched?.bend).toBe('left')

    // Midden in de bocht: nog steeds groen, ook als we “voorbij” startAlong zijn
    const mid = latchCurveStep(curves, (curve.startAlong + curve.endAlong) / 2, 150, enter.latched)
    expect(mid.bend).toBe('left')

    // Pas na endAlong: weer oranje
    const after = latchCurveStep(curves, curve.endAlong + 20, 150, mid.latched)
    expect(after.bend).toBe('straight')
    expect(after.latched).toBeNull()
  })

  it('houdt rood vast tot de bocht achter ons ligt', () => {
    const road = rightBendRoad()
    const curves = findDangerousCurves(road, 15)
    const curve = curves[0]
    expect(curve.bend).toBe('right')
    const enter = latchCurveStep(curves, curve.startAlong - 80, 150, null)
    expect(enter.bend).toBe('right')
    const mid = latchCurveStep(curves, curve.endAlong - 10, 150, enter.latched)
    expect(mid.bend).toBe('right')
    const after = latchCurveStep(curves, curve.endAlong + 25, 150, mid.latched)
    expect(after.bend).toBe('straight')
  })
})
