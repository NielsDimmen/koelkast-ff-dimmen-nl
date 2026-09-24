export type InstallPlatform = 'standalone' | 'inapp' | 'ios-safari' | 'ios-other' | 'android' | 'desktop'

const STORAGE_KEY = 'koelkast-install-v1'
const DAY_MS = 24 * 60 * 60 * 1000

type Stored = { mode: 'never' } | { mode: 'later'; at: number }

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function detectPlatform(
  ua: string,
  opts?: { standalone?: boolean; maxTouchPoints?: number },
): InstallPlatform {
  if (opts?.standalone) return 'standalone'
  if (/WhatsApp|Instagram|FBAN|FBAV|FB_IAB|LinkedInApp|Line\/|TikTok|musical_ly|Snapchat|Twitter/i.test(ua)) {
    return 'inapp'
  }
  const iOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (opts?.maxTouchPoints ?? 0) > 1)
  if (iOS) {
    return /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua) ? 'ios-other' : 'ios-safari'
  }
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (parsed.mode === 'never') return parsed
    if (parsed.mode === 'later' && typeof parsed.at === 'number') return parsed
    return null
  } catch {
    return null
  }
}

function writeStored(value: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* private mode */
  }
}

export function shouldAutoPrompt(platform: InstallPlatform, now = Date.now()): boolean {
  if (platform === 'standalone' || platform === 'desktop') return false
  const stored = readStored()
  if (!stored) return true
  if (stored.mode === 'never') return false
  return now - stored.at >= DAY_MS
}

function shareIcon(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3.2 6.8 8.4h3.2V15h4V8.4h3.2L12 3.2zM5 18.2h14v2H5z"/></svg>`
}

function stepsFor(platform: InstallPlatform): string {
  if (platform === 'inapp') {
    return `<p>Open <strong>koelkast.ff-dimmen.nl</strong> in Safari of Chrome om de app te installeren. In deze ingebouwde browser kan dat niet.</p>
      <button type="button" class="primary" id="copy-url">Kopieer link</button>`
  }
  if (platform === 'ios-safari') {
    return `<ol class="install-steps">
      <li><span>Tik onderin op Deel</span> ${shareIcon()}</li>
      <li>Kies <strong>Zet op beginscherm</strong></li>
    </ol>
    <div class="install-pointer install-pointer-bottom" aria-hidden="true">↓</div>`
  }
  if (platform === 'ios-other') {
    return `<ol class="install-steps">
      <li><span>Tik rechtsboven in de adresbalk op Deel</span> ${shareIcon()}</li>
      <li>Kies <strong>Zet op beginscherm</strong></li>
    </ol>
    <div class="install-pointer install-pointer-top" aria-hidden="true">↗</div>`
  }
  if (platform === 'android') {
    return `<p>Tik op Installeren. Lukt dat niet, open het menu <strong>⋮</strong> en kies <strong>Installeren</strong> of <strong>Zet op beginscherm</strong>.</p>
      <button type="button" class="primary" id="native-install" hidden>Installeren</button>`
  }
  return `<p>Installeer De Koelkastbeveiligger via het installatie-icoon in de adresbalk, of het menu van je browser.</p>
    <button type="button" class="primary" id="native-install" hidden>Installeren</button>`
}

export function mountInstall(root: HTMLElement): { openHelp: () => void; platform: InstallPlatform } {
  const platform = detectPlatform(navigator.userAgent, {
    standalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    maxTouchPoints: navigator.maxTouchPoints,
  })
  let deferred: BeforeInstallPromptEvent | null = null
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    root.querySelectorAll<HTMLButtonElement>('#native-install').forEach((button) => {
      button.hidden = false
    })
    const desktopLink = document.querySelector<HTMLButtonElement>('#desktop-install')
    if (desktopLink) desktopLink.hidden = false
  })
  window.addEventListener('appinstalled', () => close())

  const overlay = document.createElement('div')
  overlay.className = 'install-overlay'
  overlay.hidden = true
  overlay.innerHTML = `<div class="install-card" role="dialog" aria-labelledby="install-title">
    <h1 id="install-title">Zet De Koelkastbeveiligger op je beginscherm</h1>
    <p class="why">Volledig scherm, het scherm blijft aan, en de app start sneller.</p>
    <div class="install-body"></div>
    <div class="install-actions">
      <button type="button" id="install-later">Later</button>
      <button type="button" id="install-never">Niet meer tonen</button>
    </div>
  </div>`
  root.append(overlay)

  const show = (forced: boolean) => {
    const body = overlay.querySelector('.install-body')
    if (!body) return
    body.innerHTML = stepsFor(forced && platform === 'standalone' ? 'ios-safari' : platform === 'standalone' ? 'ios-safari' : platform)
    if (forced && platform === 'desktop') body.innerHTML = stepsFor('desktop')
    if (forced && platform === 'standalone') {
      body.innerHTML = `<p>De Koelkastbeveiligger draait al als app. Op een andere telefoon installeer je hem via Deel → Zet op beginscherm, of via het menu van Chrome.</p>`
    }
    overlay.hidden = false
    const native = overlay.querySelector<HTMLButtonElement>('#native-install')
    if (native) native.hidden = !deferred
    native?.addEventListener('click', () => void promptInstall())
    overlay.querySelector('#copy-url')?.addEventListener('click', () => void copyUrl())
  }

  const close = () => {
    overlay.hidden = true
  }

  overlay.querySelector('#install-later')?.addEventListener('click', () => {
    writeStored({ mode: 'later', at: Date.now() })
    close()
  })
  overlay.querySelector('#install-never')?.addEventListener('click', () => {
    writeStored({ mode: 'never' })
    close()
  })

  async function promptInstall(): Promise<void> {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    deferred = null
    if (choice.outcome === 'accepted') close()
  }

  async function copyUrl(): Promise<void> {
    const url = 'https://koelkast.ff-dimmen.nl'
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* ignore */
    }
    const button = overlay.querySelector('#copy-url')
    if (button) button.textContent = 'Link gekopieerd'
  }

  document.querySelector('#desktop-install')?.addEventListener('click', () => void promptInstall())

  if (shouldAutoPrompt(platform)) show(false)

  return {
    platform,
    openHelp() {
      show(true)
    },
  }
}
