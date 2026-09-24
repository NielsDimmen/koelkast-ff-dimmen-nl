export type OsmElement = {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  geometry?: { lat: number; lon: number }[]
  tags?: Record<string, string>
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number }
}
