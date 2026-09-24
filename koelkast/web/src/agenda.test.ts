import { describe, expect, it } from 'vitest'
import {
  formatRemainingKm,
  nightlinerDestination,
  parseLatLonText,
  placeFromDriveTo,
  plannedKmFromDriveTo,
  remainingAlongTrack,
  remainingForNightliner,
} from './agenda'

describe('resterende kilometers', () => {
  it('berekent de afstand langs een demo-track', () => {
    const track = [
      { lat: 51, lon: 5.7 },
      { lat: 51.01, lon: 5.7 },
      { lat: 51.02, lon: 5.7 },
    ]
    const remaining = remainingAlongTrack(track, { lat: 51.005, lon: 5.7 })
    expect(remaining).not.toBeNull()
    expect(remaining!).toBeGreaterThan(1000)
    expect(remaining!).toBeLessThan(2000)
  })

  it('gebruikt GEO van een nightliner-event', () => {
    const result = remainingForNightliner(
      {
        uid: '1',
        summary: 'Nightliner Maastricht → Eindhoven',
        location: null,
        description: null,
        start: '2026-09-24T20:00:00.000Z',
        end: null,
        lat: 51.44,
        lon: 5.48,
        nightliner: true,
      },
      { lat: 50.85, lon: 5.69 },
    )
    expect(result?.source).toBe('nightliner-geo')
    expect(result!.km).toBeGreaterThan(50)
    expect(formatRemainingKm(result!.km)).toMatch(/km resterend/)
  })

  it('leest coördinaten uit een LOCATION-tekst', () => {
    expect(parseLatLonText('51.44, 5.48')).toEqual({ lat: 51.44, lon: 5.48 })
  })

  it('haalt de bestemming uit een nightliner-description', () => {
    expect(placeFromDriveTo('Nightliner drive to Amsterdam 203km')).toBe('Amsterdam')
    expect(placeFromDriveTo('Nightliners drive to Maastricht 121km')).toBe('Maastricht')
    expect(placeFromDriveTo('Nightliner drive to Den Haag 80 km')).toBe('Den Haag')
    expect(placeFromDriveTo('Nightliners to München 217km')).toBe('München')
    expect(placeFromDriveTo('Nightliners to Maastricht Solotech: later')).toBe('Maastricht')
    expect(placeFromDriveTo('Gewone show zonder rit')).toBeNull()
  })

  it('leest geplande km uit een nightliner-description zonder GEO', () => {
    expect(plannedKmFromDriveTo('Nightliner drive to Amsterdam 203km')).toBe(203)
    expect(plannedKmFromDriveTo('Nightliners drive to Maastricht 121km')).toBe(121)
    expect(plannedKmFromDriveTo('Nightliner drive to Den Haag 80 km')).toBe(80)
    expect(plannedKmFromDriveTo('25 September 00:30: Nightliners drive to Zürich 414km')).toBe(414)
    expect(plannedKmFromDriveTo('Gewone show zonder rit')).toBeNull()

    const result = remainingForNightliner(
      {
        uid: '1',
        summary: 'Nightliner',
        location: 'Ziggo Dome',
        description: 'Nightliner drive to Amsterdam 203km',
        start: '2026-09-24T20:00:00.000Z',
        end: null,
        lat: null,
        lon: null,
        nightliner: true,
      },
      { lat: 50.85, lon: 5.69 },
    )
    expect(result?.source).toBe('nightliner-planned')
    expect(result!.km).toBe(203)
    expect(formatRemainingKm(result!.km, 'Amsterdam')).toBe('203 km resterend · Amsterdam')
  })

  it('kiest GEO boven geplande km uit DESCRIPTION', () => {
    const result = remainingForNightliner(
      {
        uid: '1',
        summary: 'Nightliner',
        location: null,
        description: 'Nightliner drive to Amsterdam 203km',
        start: '2026-09-24T20:00:00.000Z',
        end: null,
        lat: 51.44,
        lon: 5.48,
        nightliner: true,
      },
      { lat: 50.85, lon: 5.69 },
    )
    expect(result?.source).toBe('nightliner-geo')
    expect(result!.km).toBeGreaterThan(50)
    expect(result!.km).toBeLessThan(200)
  })

  it('kiest DESCRIPTION-plaats boven LOCATION, anders korte LOCATION', () => {
    expect(
      nightlinerDestination({
        uid: '1',
        summary: 'Nightliner',
        location: 'Ziggo Dome',
        description: 'Nightliner drive to Amsterdam 203km',
        start: '2026-09-24T20:00:00.000Z',
        end: null,
        lat: null,
        lon: null,
        nightliner: true,
      }),
    ).toBe('Amsterdam')
    expect(
      nightlinerDestination({
        uid: '2',
        summary: 'Nightliner',
        location: 'Eindhoven',
        description: 'Vertrek na de show',
        start: '2026-09-24T20:00:00.000Z',
        end: null,
        lat: null,
        lon: null,
        nightliner: true,
      }),
    ).toBe('Eindhoven')
    expect(
      nightlinerDestination({
        uid: '3',
        summary: 'Nightliner',
        location: '51.44, 5.48',
        description: null,
        start: '2026-09-24T20:00:00.000Z',
        end: null,
        lat: null,
        lon: null,
        nightliner: true,
      }),
    ).toBeNull()
    expect(
      nightlinerDestination({
        uid: '4',
        summary: '19:00 Frankfurt',
        location: 'Festhalle Frankfurt, Ludwig-Erhard-Anlage 1, 60327, Frankfurt , Germany',
        description: '25 September 00:30: Nightliners drive to Zürich 414km',
        start: '2026-09-24T00:00:00.000Z',
        end: null,
        lat: null,
        lon: null,
        nightliner: true,
      }),
    ).toBe('Zürich')
  })

  it('zet bestemming in de resterend-regel', () => {
    expect(formatRemainingKm(142, 'Amsterdam')).toBe('142 km resterend · Amsterdam')
    expect(formatRemainingKm(null, null)).toBe('– km resterend · bestemming onbekend')
    expect(formatRemainingKm(null)).toBe('– km resterend')
  })
})
