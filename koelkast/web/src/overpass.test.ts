import { describe, expect, it } from 'vitest'
import { escapeRef, refPattern, stopsQuery } from './overpass'

describe('ref-scoped stops query', () => {
  it('bouwt een regex voor A2 en A67', () => {
    expect(escapeRef('A2')).toBe('A2')
    expect(refPattern(['A2'])).toBe('(^|;)A2($|;)')
    expect(refPattern(['A2', 'A67'])).toContain('A2')
    expect(refPattern(['A2', 'A67'])).toContain('A67')
  })

  it('vraagt alleen motorways met die ref en stops eromheen', () => {
    const query = stopsQuery(
      { south: 50.8, west: 5.4, north: 51.2, east: 5.9 },
      ['A2'],
    )
    expect(query).toContain('["ref"~"(^|;)A2($|;)"]')
    expect(query).toContain('around.mw:400')
    expect(query).toContain('amenity"="fuel"')
    expect(query).toContain('highway"="services"')
    expect(query).not.toMatch(/way\["highway"="motorway"\]\(50/)
  })
})
