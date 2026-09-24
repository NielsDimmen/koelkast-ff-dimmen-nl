import { describe, expect, it } from 'vitest'
import { destination, distanceMeters, type LatLon } from './geometry'
import { buildGraph, buildPath, matchRoad, type Way } from './matcher'
import { evaluateStops, formatStopLine, type StopFeature } from './stops'

const origin: LatLon = { lat: 51, lon: 5.7 }

function at(metersNorth: number, sideMeters = 0): LatLon {
  const north = destination(origin, 0, metersNorth)
  if (sideMeters === 0) return north
  return destination(north, sideMeters > 0 ? 90 : 270, Math.abs(sideMeters))
}

function line(id: number, highway: string, points: LatLon[], nodeIds: number[], refs: string[] = ['A2']): Way {
  return {
    id,
    nodeIds,
    geometry: points,
    highway,
    refs,
    oneway: 1,
    tags: {},
  }
}

function stop(id: string, point: LatLon, fuel: boolean, rest: boolean, name: string | null): StopFeature {
  return { id, lat: point.lat, lon: point.lon, geometry: [point], fuel, rest, name }
}

describe('stops aan de snelweg', () => {
  const carriage = line(1, 'motorway', [0, 400, 800, 1200, 1600, 2200, 3000].map((m) => at(m)), [1, 2, 3, 4, 5, 6, 7])
  const rightLoop = line(
    2,
    'motorway_link',
    [at(800), at(1000, 70), at(1300, 80), at(1600)],
    [3, 101, 102, 5],
  )
  const through = line(3, 'service', [at(1000, 70), at(1150, 90), at(1300, 80)], [101, 111, 102])
  const leftLoop = line(
    4,
    'motorway_link',
    [at(800), at(1000, -70), at(1300, -80), at(1600)],
    [3, 201, 202, 5],
  )
  const exit = line(5, 'motorway_link', [at(2200), at(2400, 120), at(2600, 250)], [6, 301, 302])
  const graph = buildGraph([carriage, rightLoop, through, leftLoop, exit])
  const match = matchRoad(graph, at(150), 0, { filter: (way) => way.highway === 'motorway' })
  const path = buildPath(graph, match!, {
    behindM: 200,
    aheadM: 4000,
    allowLinks: false,
    motorwayOnly: true,
  })

  const rightFuel = stop('fuel-right', at(1100, 100), true, false, 'Shell De Horst')
  const rightRest = stop('rest-right', at(1150, 95), false, true, 'Rustplaats De Kievit')
  const leftFuel = stop('fuel-left', at(1100, -100), true, false, 'Total Overkant')
  const exitFuel = stop('fuel-exit', at(2550, 260), true, false, 'Tango Afrit')
  const farFuel = stop('fuel-far', at(500, 2000), true, false, 'Ver Weg')

  const result = evaluateStops(graph, path, [rightFuel, rightRest, leftFuel, exitFuel, farFuel])
  const byId = new Map(result.decisions.map((decision) => [decision.id, decision]))

  it('keurt een tankstation en rustplaats rechts van onze lus goed', () => {
    expect(byId.get('fuel-right')?.reason).toBe('goedgekeurd')
    expect(byId.get('rest-right')?.reason).toBe('goedgekeurd')
    expect(result.fuel?.name).toBe('Shell De Horst')
    expect(result.rest?.name).toBe('Rustplaats De Kievit')
    expect(result.fuel && result.fuel.distanceM).toBeGreaterThan(500)
    expect(result.fuel && result.fuel.distanceM).toBeLessThan(800)
    expect(distanceMeters(at(150), at(800))).toBeGreaterThan(600)
  })

  it('keurt de overkant, een afrit en een verre stop af', () => {
    expect(byId.get('fuel-left')?.reason).toBe('verkeerde kant')
    expect(byId.get('fuel-exit')?.reason).toBe('afrit')
    expect(byId.get('fuel-far')?.reason).toBe('te ver weg')
    expect(result.fuel?.id).not.toBe('fuel-exit')
  })

  it('toont minuten en kilometers langs de weg', () => {
    const lineText = formatStopLine('fuel', result.fuel, 100 / 3.6)
    expect(lineText.startsWith('⛽ ')).toBe(true)
    expect(lineText).toContain('Shell De Horst')
    expect(lineText).toContain('min')
    expect(formatStopLine('rest', null, 10)).toBe('🅿 Geen rustplaats vooruit')
  })
})
