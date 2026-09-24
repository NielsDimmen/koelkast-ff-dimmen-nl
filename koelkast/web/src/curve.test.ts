import { describe, expect, it } from 'vitest'
import { BendHysteresis, classifyTurn, colorForTurn, colorName, totalTurnDegrees } from './curve'
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

  it('toont een nieuwe status pas na ongeveer een seconde', () => {
    const hold = new BendHysteresis(1000)
    expect(hold.update('left', 0)).toBe('straight')
    expect(hold.update('left', 900)).toBe('straight')
    expect(hold.update('left', 1000)).toBe('left')
    expect(hold.update('right', 1100)).toBe('left')
    expect(hold.update('left', 1200)).toBe('left')
  })
})
