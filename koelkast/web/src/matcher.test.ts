import { describe, expect, it } from 'vitest'
import { destination, distanceMeters, type LatLon } from './geometry'
import { buildGraph, buildPath, matchRoad, pathLength, type Way } from './matcher'

const origin: LatLon = { lat: 51, lon: 5.7 }

function way(partial: Pick<Way, 'id' | 'highway' | 'refs' | 'oneway'> & { meters: number[] }): Way {
  const geometry = partial.meters.map((meters) => destination(origin, 0, meters))
  return {
    id: partial.id,
    nodeIds: geometry.map((_, index) => partial.id * 100 + index),
    geometry,
    highway: partial.highway,
    refs: partial.refs,
    oneway: partial.oneway,
    tags: {},
  }
}

describe('map matching', () => {
  it('kiest de rijbaan die met de heading meeloopt en negeert de tegenrichting', () => {
    const north = way({ id: 1, highway: 'motorway', refs: ['A2'], oneway: 1, meters: [0, 400, 800] })
    const southGeom = [800, 400, 0].map((meters) => destination({ lat: 51, lon: 5.7004 }, 0, meters))
    const south: Way = {
      id: 2,
      nodeIds: [900, 901, 902],
      geometry: southGeom,
      highway: 'motorway',
      refs: ['A2'],
      oneway: 1,
      tags: {},
    }
    const graph = buildGraph([north, south])
    const position = destination(origin, 0, 200)
    const match = matchRoad(graph, position, 0)
    expect(match?.travel.way.id).toBe(1)
    expect(match && match.distance).toBeLessThan(5)
  })

  it('volgt de volgende way via een gedeelde node en slaat een afslag over', () => {
    const first = way({ id: 1, highway: 'motorway', refs: ['A2'], oneway: 1, meters: [0, 500, 1000] })
    const secondStart = first.geometry[2]
    const second: Way = {
      id: 2,
      nodeIds: [first.nodeIds[2], 201, 202],
      geometry: [secondStart, destination(secondStart, 0, 500), destination(secondStart, 0, 1000)],
      highway: 'motorway',
      refs: ['A2'],
      oneway: 1,
      tags: {},
    }
    const exit: Way = {
      id: 3,
      nodeIds: [first.nodeIds[2], 301, 302],
      geometry: [secondStart, destination(secondStart, 40, 200), destination(secondStart, 50, 400)],
      highway: 'motorway_link',
      refs: ['A2'],
      oneway: 1,
      tags: {},
    }
    const graph = buildGraph([first, second, exit])
    const match = matchRoad(graph, destination(origin, 0, 100), 0)
    expect(match).not.toBeNull()
    const path = buildPath(graph, match!, {
      behindM: 0,
      aheadM: 1600,
      allowLinks: false,
      motorwayOnly: true,
    })
    expect(pathLength(path)).toBeGreaterThan(1500)
    expect(path.points.some((point) => distanceMeters(point, second.geometry[2]) < 5)).toBe(true)
    expect(path.points.some((point) => distanceMeters(point, exit.geometry[2]) < 30)).toBe(false)
  })
})
