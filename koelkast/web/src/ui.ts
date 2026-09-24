import { SCREEN_HEX, type Bend } from './curve'
import type { LatLon } from './geometry'

export type LocalSettings = {
  drempel: number | null
  lookahead: number | null
  debug: boolean
  rate: number
}

export type DebugStop = {
  lat: number
  lon: number
  name: string
  reason: string
  ok: boolean
}

export type DriveModel = {
  bend: Bend
  speedKmh: number | null
  fuel: string
  rest: string
  remaining: string
  driveLabel: string | null
  gps: string
  roads: string
  server: string
  demoRate: number | null
  debug: boolean
  position: LatLon | null
  matched: LatLon[] | null
  lookahead: LatLon[] | null
  nextStops: DebugStop[]
  stops: DebugStop[]
  wake: boolean
}

export type UiHandlers = {
  onStart: () => void
  onStop: () => void
  onDemo: (rate: number) => void
  onGpx: (file: File, rate: number) => void
  onSettings: (settings: LocalSettings) => void
  onInstallHelp: () => void
  onDebug: (enabled: boolean) => void
}

const SETTINGS_KEY = 'koelkast-settings-v1'

export function loadSettings(): LocalSettings {
  const fallback: LocalSettings = { drempel: null, lookahead: null, debug: false, rate: 5 }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<LocalSettings>
    return {
      drempel: numberOrNull(parsed.drempel),
      lookahead: numberOrNull(parsed.lookahead),
      debug: Boolean(parsed.debug),
      rate: parsed.rate === 1 || parsed.rate === 5 || parsed.rate === 10 ? parsed.rate : 5,
    }
  } catch {
    return fallback
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function saveSettings(settings: LocalSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* private mode */
  }
}

export function mountUi(root: HTMLElement, handlers: UiHandlers, defaults: { drempel: number; lookahead: number }): {
  showDrive: (demoRate?: number | null, seed?: { remaining?: string }) => void
  showStart: (message?: string) => void
  update: (model: DriveModel) => void
  settings: () => LocalSettings
  confirmLocation: (onAllow: () => void) => void
} {
  let settings = loadSettings()
  root.innerHTML = `
    <section id="start">
      <div class="start-inner">
        <h1 class="brand">De Koelkastbeveiligger</h1>
        <ul class="legend">
          <li><i class="swatch left"></i> groen links</li>
          <li><i class="swatch straight"></i> oranje rechtdoor</li>
          <li><i class="swatch right"></i> rood rechts</li>
        </ul>
        <button type="button" id="go" class="go">Start</button>
        <p id="start-error" class="start-error" hidden></p>
        <div class="demo-row">
          <button type="button" id="demo" class="secondary">Demo A2</button>
          <label class="rate-label">Snelheid
            <select id="rate">
              <option value="1">1×</option>
              <option value="5">5×</option>
              <option value="10">10×</option>
            </select>
          </label>
        </div>
        <details class="settings">
          <summary>Instellingen</summary>
          <label>Bocht-drempel (graden)
            <input id="drempel" type="number" min="1" max="90" step="1" />
          </label>
          <label>Lookahead (seconden)
            <input id="lookahead" type="number" min="1" max="60" step="1" />
          </label>
          <label class="check"><input id="debug" type="checkbox" /> Debug-log stops</label>
          <label class="file">GPX afspelen
            <input id="gpx" type="file" accept=".gpx,application/gpx+xml" />
          </label>
          <button type="button" id="play-gpx" class="secondary">Speel GPX af</button>
          <button type="button" id="install-help" class="text-btn">Hoe installeer ik deze app?</button>
          <button type="button" id="desktop-install" class="text-btn" hidden>Installeren</button>
        </details>
      </div>
    </section>
    <section id="drive" hidden>
      <div id="demo-banner" hidden>DEMO</div>
      <div class="arrow-wrap">
        <svg class="arrow" id="arrow" viewBox="0 0 100 100" aria-hidden="true">
          <path d="M50 6 L92 86 H68 L50 52 L32 86 H8 Z" />
        </svg>
      </div>
      <p id="speed" class="speed">– km/u</p>
      <p id="remaining" class="remaining">– km resterend</p>
      <p id="drive-label" class="drive-label" hidden></p>
      <div class="bottom">
        <p id="fuel" class="stop-line"></p>
        <p id="rest" class="stop-line"></p>
        <p id="indicators" class="indicators"></p>
      </div>
      <div id="drive-map" aria-label="Kaart"></div>
      <div class="corner">
        <button type="button" id="stop" class="ghost">Stop</button>
        <button type="button" id="debug-toggle" class="ghost">Log</button>
      </div>
      <div id="debug-panel" hidden>
        <ul id="debug-log"></ul>
      </div>
    </section>
    <dialog id="loc-hint">
      <form method="dialog">
        <h2>Locatie tijdens het rijden</h2>
        <p>De Koelkastbeveiligger leest je GPS alleen op deze telefoon, om de kleur van de bocht en de afstand tot de volgende stop te bepalen. Na installatie vraagt iOS daar opnieuw toestemming voor.</p>
        <button type="button" id="loc-go" class="go">Locatie toestaan</button>
      </form>
    </dialog>
  `

  const start = root.querySelector<HTMLElement>('#start')!
  const drive = root.querySelector<HTMLElement>('#drive')!
  const rate = root.querySelector<HTMLSelectElement>('#rate')!
  const drempel = root.querySelector<HTMLInputElement>('#drempel')!
  const lookahead = root.querySelector<HTMLInputElement>('#lookahead')!
  const debug = root.querySelector<HTMLInputElement>('#debug')!
  const gpx = root.querySelector<HTMLInputElement>('#gpx')!
  rate.value = String(settings.rate)
  drempel.value = String(settings.drempel ?? defaults.drempel)
  lookahead.value = String(settings.lookahead ?? defaults.lookahead)
  debug.checked = settings.debug

  const emit = () => {
    settings = {
      drempel: drempel.value === '' ? null : clamp(Number(drempel.value), 1, 90),
      lookahead: lookahead.value === '' ? null : clamp(Number(lookahead.value), 1, 60),
      debug: debug.checked,
      rate: Number(rate.value) === 1 || Number(rate.value) === 10 ? Number(rate.value) : 5,
    }
    saveSettings(settings)
    handlers.onSettings(settings)
    handlers.onDebug(settings.debug)
  }
  rate.addEventListener('change', emit)
  drempel.addEventListener('change', emit)
  lookahead.addEventListener('change', emit)
  debug.addEventListener('change', emit)

  const chosenRate = () => {
    const value = Number(rate.value)
    return value === 1 || value === 10 ? value : 5
  }
  root.querySelector('#go')?.addEventListener('click', () => handlers.onStart())
  root.querySelector('#demo')?.addEventListener('click', () => handlers.onDemo(chosenRate()))
  root.querySelector('#play-gpx')?.addEventListener('click', () => {
    const file = gpx.files?.[0]
    if (file) handlers.onGpx(file, chosenRate())
  })
  root.querySelector('#install-help')?.addEventListener('click', () => handlers.onInstallHelp())
  root.querySelector('#stop')?.addEventListener('click', () => handlers.onStop())
  root.querySelector('#debug-toggle')?.addEventListener('click', () => {
    debug.checked = !debug.checked
    emit()
  })

  const dialog = root.querySelector<HTMLDialogElement>('#loc-hint')!
  let mapApi: {
    sync: (model: DriveModel) => void
  } | null = null

  return {
    settings: () => settings,
    showStart(message?: string) {
      start.hidden = false
      drive.hidden = true
      document.body.style.background = '#071018'
      document.title = 'De Koelkastbeveiligger'
      const error = root.querySelector<HTMLElement>('#start-error')!
      error.hidden = !message
      error.textContent = message ?? ''
      // Clear stale demo chrome so a later Start never flashes the previous DEMO run.
      const banner = root.querySelector<HTMLElement>('#demo-banner')!
      banner.hidden = true
      banner.textContent = ''
    },
    showDrive(demoRate: number | null = null, seed?: { remaining?: string }) {
      start.hidden = true
      drive.hidden = false
      const banner = root.querySelector<HTMLElement>('#demo-banner')!
      banner.hidden = demoRate == null
      banner.textContent = demoRate == null ? '' : `DEMO · ${demoRate}×`
      // Seed remaining so the destination is visible before the first GPS/demo fix.
      root.querySelector('#remaining')!.textContent = seed?.remaining ?? '– km resterend'
      if (demoRate == null) {
        const label = root.querySelector<HTMLElement>('#drive-label')!
        label.hidden = true
        label.textContent = ''
        root.querySelector('#fuel')!.textContent = '⛽ …'
        root.querySelector('#rest')!.textContent = '🅿 …'
        root.querySelector('#speed')!.textContent = '– km/u'
      }
    },
    confirmLocation(onAllow: () => void) {
      dialog.showModal()
      const button = dialog.querySelector('#loc-go')
      const allow = () => {
        button?.removeEventListener('click', allow)
        dialog.close()
        onAllow()
      }
      button?.addEventListener('click', allow)
    },
    update(model) {
      drive.style.background = SCREEN_HEX[model.bend]
      document.body.style.background = SCREEN_HEX[model.bend]
      const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      if (theme) theme.content = SCREEN_HEX[model.bend]
      const arrow = root.querySelector<SVGElement>('#arrow')!
      const rotation = model.bend === 'left' ? -90 : model.bend === 'right' ? 90 : 0
      arrow.style.transform = `rotate(${rotation}deg)`
      arrow.setAttribute('aria-label', model.bend === 'left' ? 'links' : model.bend === 'right' ? 'rechts' : 'rechtdoor')
      root.querySelector('#speed')!.textContent =
        model.speedKmh == null ? '– km/u' : `${Math.round(model.speedKmh)} km/u`
      root.querySelector('#remaining')!.textContent = model.remaining
      const label = root.querySelector<HTMLElement>('#drive-label')!
      label.hidden = !model.driveLabel
      label.textContent = model.driveLabel ?? ''
      root.querySelector('#fuel')!.textContent = model.fuel
      root.querySelector('#rest')!.textContent = model.rest
      const wake = model.wake ? '' : ' · scherm kan uitgaan'
      root.querySelector('#indicators')!.textContent = `${model.gps} · ${model.roads} · ${model.server}${wake}`
      const banner = root.querySelector<HTMLElement>('#demo-banner')!
      banner.hidden = model.demoRate == null
      banner.textContent = model.demoRate == null ? '' : `DEMO · ${model.demoRate}×`
      const panel = root.querySelector<HTMLElement>('#debug-panel')!
      panel.hidden = !model.debug
      root.querySelector('#debug-log')!.innerHTML = model.stops
        .slice(0, 40)
        .map(
          (stop) =>
            `<li class="${stop.ok ? 'ok' : 'bad'}">${escapeHtml(stop.name)} — ${escapeHtml(stop.reason)}</li>`,
        )
        .join('')
      mapApi ??= createMap(root.querySelector<HTMLElement>('#drive-map')!)
      mapApi.sync(model)
    },
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function createMap(mapEl: HTMLElement): { sync: (model: DriveModel) => void } {
  let map: import('leaflet').Map | null = null
  let layers: import('leaflet').Layer[] = []
  let leaflet: typeof import('leaflet') | null = null
  let centered = false

  return {
    sync(model) {
      void render()
      async function render() {
        if (!model.position) return
        if (!leaflet) {
          leaflet = await import('leaflet')
          await import('leaflet/dist/leaflet.css')
        }
        const L = leaflet
        if (!map) {
          map = L.map(mapEl, { zoomControl: false, attributionControl: false })
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
          }).addTo(map)
        }
        for (const layer of layers) layer.remove()
        layers = []
        const here: [number, number] = [model.position.lat, model.position.lon]
        if (model.matched && model.matched.length > 1) {
          layers.push(L.polyline(model.matched.map(pair), { color: '#111', weight: 5 }).addTo(map))
        }
        if (model.lookahead && model.lookahead.length > 1) {
          layers.push(L.polyline(model.lookahead.map(pair), { color: '#fff', weight: 4 }).addTo(map))
        }
        for (const stop of model.nextStops) {
          layers.push(
            L.circleMarker([stop.lat, stop.lon], {
              radius: 7,
              color: '#111',
              weight: 1,
              fillColor: '#19a34a',
              fillOpacity: 0.95,
            })
              .bindTooltip(stop.name)
              .addTo(map),
          )
        }
        layers.push(L.circleMarker(here, { radius: 7, color: '#111', fillColor: '#fff', fillOpacity: 1 }).addTo(map))
        map.invalidateSize()
        if (map.getSize().y > 0) {
          if (!centered) {
            map.setView(here, 13)
            centered = true
          } else if (!map.getBounds().contains(here)) {
            map.panTo(here)
          }
        }
      }
    },
  }
}

function pair(point: LatLon): [number, number] {
  return [point.lat, point.lon]
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}
