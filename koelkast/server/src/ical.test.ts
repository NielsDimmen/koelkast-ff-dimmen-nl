import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isNightlinerText, parseIcalendar, pickNightliner } from './ical.js'

describe('ical', () => {
  it('herkent nightliner in de titel', () => {
    assert.equal(isNightlinerText('Nightliner Tour NL'), true)
    assert.equal(isNightlinerText('Gewone rit'), false)
  })

  it('parst VEVENT met GEO en kiest de huidige nightliner', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:1
SUMMARY:Nightliner Band
LOCATION:Eindhoven
GEO:51.44;5.48
DTSTART:20260924T180000Z
DTEND:20260925T060000Z
END:VEVENT
BEGIN:VEVENT
UID:2
SUMMARY:Dagrit
DTSTART:20260925T100000Z
END:VEVENT
END:VCALENDAR`
    const events = parseIcalendar(ics)
    assert.equal(events.length, 2)
    assert.equal(events[0].nightliner, true)
    assert.equal(events[0].lat, 51.44)
    assert.equal(events[0].lon, 5.48)
    const picked = pickNightliner(events, new Date('2026-09-24T20:00:00Z'))
    assert.equal(picked?.uid, '1')
  })

  it('houdt date-only show-dagen open tot de overnight-rit', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:frankfurt
SUMMARY:19:00 Frankfurt, Germany (Confirmed)
DESCRIPTION:Timesheet:\\n25 September 00:30 - 00:30: Nightliners drive to Zürich 414km
DTSTART:20260924
END:VEVENT
BEGIN:VEVENT
UID:zurich
SUMMARY:19:30 Zürich, Switzerland (Confirmed)
DESCRIPTION:Timesheet:\\n26 September 01:00 - 01:00: Nightliners drive to Lausanne 228km
DTSTART:20260925
END:VEVENT
END:VCALENDAR`
    const events = parseIcalendar(ics)
    // Evening of the Frankfurt show (Europe/Amsterdam): still that event, not Zürich.
    const evening = pickNightliner(events, new Date('2026-09-24T19:10:00Z'))
    assert.equal(evening?.uid, 'frankfurt')
    // During overnight departure toward Zürich.
    const overnight = pickNightliner(events, new Date('2026-09-25T00:30:00Z'))
    assert.equal(overnight?.uid, 'frankfurt')
  })
})
