import { describe, expect, it } from 'vitest'
import { detectPlatform, shouldAutoPrompt } from './install'

describe('installatie', () => {
  it('herkent standalone, in-app browsers en iOS', () => {
    expect(detectPlatform('Mozilla', { standalone: true })).toBe('standalone')
    expect(detectPlatform('WhatsApp/2.1')).toBe('inapp')
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit Safari/605')).toBe('ios-safari')
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) CriOS/126.0')).toBe('ios-other')
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14) Chrome/126')).toBe('android')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', { maxTouchPoints: 5 })).toBe('ios-safari')
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64) Chrome/126')).toBe('desktop')
  })

  it('slaat de overlay over op desktop en in de geïnstalleerde app', () => {
    expect(shouldAutoPrompt('desktop')).toBe(false)
    expect(shouldAutoPrompt('standalone')).toBe(false)
  })
})
