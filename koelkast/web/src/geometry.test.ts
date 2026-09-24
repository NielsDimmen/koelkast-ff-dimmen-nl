import { describe, expect, it } from 'vitest'
import {
  bearingDegrees,
  destination,
  distanceMeters,
  distanceToBBoxEdge,
  normalizeAngle,
  projectPointOnSegment,
  signedSideMeters,
  slicePolyline,
  snapBBox,
} from './geometry'

describe('geometrie', () => {
  it('meet ongeveer 1112 m per 0,01° breedte', () => {
    const distance = distanceMeters({ lat: 52, lon: 5 }, { lat: 52.01, lon: 5 })
    expect(distance).toBeGreaterThan(1100)
    expect(distance).toBeLessThan(1125)
  })

  it('bearing naar het noorden is 0 en naar het oosten 90', () => {
    expect(bearingDegrees({ lat: 52, lon: 5 }, { lat: 53, lon: 5 })).toBeCloseTo(0, 5)
    expect(bearingDegrees({ lat: 52, lon: 5 }, { lat: 52, lon: 6 })).toBeCloseTo(90, 0)
  })

  it('normaliseert hoeken naar -180..180', () => {
    expect(normalizeAngle(270)).toBeCloseTo(-90)
    expect(normalizeAngle(-270)).toBeCloseTo(90)
    expect(normalizeAngle(15)).toBeCloseTo(15)
  })

  it('projecteert een punt op het dichtstbijzijnde stuk van een segment', () => {
    const projected = projectPointOnSegment({ lat: 51, lon: 5.001 }, { lat: 51, lon: 5 }, { lat: 51.01, lon: 5 })
    expect(projected.t).toBeCloseTo(0, 5)
    expect(projected.distance).toBeGreaterThan(50)
    expect(projected.distance).toBeLessThan(120)
  })

  it('een punt ten oosten ligt rechts van een noordelijke rijrichting', () => {
    const origin = { lat: 51, lon: 5.7 }
    const east = destination(origin, 90, 20)
    const west = destination(origin, 270, 20)
    expect(signedSideMeters(origin, 0, east)).toBeGreaterThan(15)
    expect(signedSideMeters(origin, 0, west)).toBeLessThan(-15)
  })

  it('snijdt een polylijn tussen twee afstanden', () => {
    const origin = { lat: 51, lon: 5.7 }
    const points = [0, 100, 200, 300].map((meters) => destination(origin, 0, meters))
    const slice = slicePolyline(points, 50, 250)
    expect(distanceMeters(slice[0], origin)).toBeGreaterThan(40)
    expect(distanceMeters(slice[0], origin)).toBeLessThan(60)
    expect(distanceMeters(slice[slice.length - 1], origin)).toBeGreaterThan(240)
    expect(distanceMeters(slice[slice.length - 1], origin)).toBeLessThan(260)
  })

  it('rondt een bbox af op een grid', () => {
    const box = snapBBox(51.011, 5.711, 0.03, 0.03, 0.02)
    expect(Math.abs(box.south / 0.02 - Math.round(box.south / 0.02))).toBeLessThan(1e-6)
    expect(Math.abs(box.west / 0.02 - Math.round(box.west / 0.02))).toBeLessThan(1e-6)
    expect(box.south).toBeLessThanOrEqual(51.011 - 0.03)
    expect(box.north).toBeGreaterThanOrEqual(51.011 + 0.03)
  })

  it('afstand tot de rand is 0 buiten de bbox', () => {
    const box = { south: 51, west: 5, north: 52, east: 6 }
    expect(distanceToBBoxEdge(50, 5.5, box)).toBe(0)
    expect(distanceToBBoxEdge(51.5, 5.5, box)).toBeGreaterThan(1000)
  })
})
