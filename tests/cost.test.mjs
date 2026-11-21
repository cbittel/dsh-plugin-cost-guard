import test from 'node:test'
import assert from 'node:assert/strict'
import {
  beijingParts,
  isPeak,
  nextTransition,
  estimateCache,
  costState,
} from '../lib/cost.js'

// Helper: create a Date at a specific Beijing time (UTC+8)
function beijingDate(year, month, day, hour, minute = 0) {
  // Beijing is UTC+8, so subtract 8 hours to get UTC
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0))
}

// Helper: day of week for a given date (1=Mon..7=Sun)
function dayOfWeek(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day))
  const weekday = d.getUTCDay() // 0=Sun..6=Sat
  return weekday === 0 ? 7 : weekday // 1=Mon..7=Sun
}

test('beijingParts extracts correct weekday/hour/minute', () => {
  // Monday 2026-11-23 09:30 Beijing = 2026-11-23 01:30 UTC
  const d = beijingDate(2026, 11, 23, 9, 30)
  const parts = beijingParts(d)
  assert.equal(parts.day, 1) // Monday
  assert.equal(parts.hour, 9)
  assert.equal(parts.minute, 30)
})

test('isPeak: peak window 09:00–12:00 Beijing, Monday', () => {
  const d = beijingDate(2026, 11, 23, 9, 0) // Mon 09:00
  assert.equal(isPeak(d), true)
  const d2 = beijingDate(2026, 11, 23, 11, 59) // Mon 11:59
  assert.equal(isPeak(d2), true)
  const d3 = beijingDate(2026, 11, 23, 12, 0) // Mon 12:00 - OFF
  assert.equal(isPeak(d3), false)
})

test('isPeak: peak window 14:00–18:00 Beijing, Monday', () => {
  const d = beijingDate(2026, 11, 23, 14, 0) // Mon 14:00
  assert.equal(isPeak(d), true)
  const d2 = beijingDate(2026, 11, 23, 17, 59) // Mon 17:59
  assert.equal(isPeak(d2), true)
  const d3 = beijingDate(2026, 11, 23, 18, 0) // Mon 18:00 - OFF
  assert.equal(isPeak(d3), false)
})

test('isPeak: off-peak between windows (12:00–14:00)', () => {
  const d = beijingDate(2026, 11, 23, 12, 30) // Mon 12:30
  assert.equal(isPeak(d), false)
  const d2 = beijingDate(2026, 11, 23, 13, 59) // Mon 13:59
  assert.equal(isPeak(d2), false)
})

test('isPeak: off-peak before 09:00', () => {
  const d = beijingDate(2026, 11, 23, 8, 59) // Mon 08:59
  assert.equal(isPeak(d), false)
})

test('isPeak: off-peak after 18:00', () => {
  const d = beijingDate(2026, 11, 23, 18, 1) // Mon 18:01
  assert.equal(isPeak(d), false)
  const d2 = beijingDate(2026, 11, 23, 23, 59) // Mon 23:59
  assert.equal(isPeak(d2), false)
})

test('isPeak: weekend (Saturday) is off-peak', () => {
  // 2026-11-28 is Saturday
  const d = beijingDate(2026, 11, 28, 10, 0) // Sat 10:00
  assert.equal(isPeak(d), false)
})

test('isPeak: weekend (Sunday) is off-peak', () => {
  // 2026-11-29 is Sunday
  const d = beijingDate(2026, 11, 29, 10, 0) // Sun 10:00
  assert.equal(isPeak(d), false)
})

test('isPeak: holiday overrides weekday peak', () => {
  // Monday 2026-11-23 is a holiday
  const d = beijingDate(2026, 11, 23, 10, 0) // Mon 10:00
  assert.equal(isPeak(d, { holidays: ['2026-11-23'] }), false)
})

test('isPeak: holiday on weekend still off-peak', () => {
  const d = beijingDate(2026, 11, 28, 10, 0) // Sat 10:00
  assert.equal(isPeak(d, { holidays: ['2026-11-28'] }), false)
})

test('isPeak: built-in Chinese National Day (Thursday) is off-peak', () => {
  // 2026-10-01 is Thursday, inside National Day holiday (Oct 1-7)
  const d = beijingDate(2026, 10, 1, 10, 0)
  assert.equal(isPeak(d), false)
})

test('isPeak: built-in Spring Festival weekday is off-peak', () => {
  // 2026-02-16 is Monday, inside Spring Festival (Feb 15-23)
  const d = beijingDate(2026, 2, 16, 10, 0)
  assert.equal(isPeak(d), false)
})

test('isPeak: ordinary non-holiday weekday is still peak', () => {
  // 2026-10-15 is Thursday, outside National Day (Oct 1-7)
  const d = beijingDate(2026, 10, 15, 10, 0)
  assert.equal(isPeak(d), true)
})

test('nextTransition: from off-peak morning to 09:00 peak', () => {
  const d = beijingDate(2026, 11, 23, 8, 0) // Mon 08:00
  const next = nextTransition(d)
  assert.equal(next.becomesPeak, true)
  // Should be 09:00 Beijing = 01:00 UTC
  assert.equal(next.at.getUTCHours(), 1)
  assert.equal(next.at.getUTCMinutes(), 0)
})

test('nextTransition: from 09:00 peak to 12:00 off-peak', () => {
  const d = beijingDate(2026, 11, 23, 9, 30) // Mon 09:30
  const next = nextTransition(d)
  assert.equal(next.becomesPeak, false)
  assert.equal(next.at.getUTCHours(), 4) // 12:00 Beijing = 04:00 UTC
  assert.equal(next.at.getUTCMinutes(), 0)
})

test('nextTransition: from 12:00 off-peak to 14:00 peak', () => {
  const d = beijingDate(2026, 11, 23, 12, 30) // Mon 12:30
  const next = nextTransition(d)
  assert.equal(next.becomesPeak, true)
  assert.equal(next.at.getUTCHours(), 6) // 14:00 Beijing = 06:00 UTC
  assert.equal(next.at.getUTCMinutes(), 0)
})

test('nextTransition: from 14:00 peak to 18:00 off-peak', () => {
  const d = beijingDate(2026, 11, 23, 15, 0) // Mon 15:00
  const next = nextTransition(d)
  assert.equal(next.becomesPeak, false)
  assert.equal(next.at.getUTCHours(), 10) // 18:00 Beijing = 10:00 UTC
  assert.equal(next.at.getUTCMinutes(), 0)
})

test('nextTransition: from 18:00 off-peak to next day 09:00 peak', () => {
  const d = beijingDate(2026, 11, 23, 19, 0) // Mon 19:00
  const next = nextTransition(d)
  assert.equal(next.becomesPeak, true)
  // Next day (Tue) 09:00 Beijing = 01:00 UTC
  assert.equal(next.at.getUTCDate(), 24) // 24th
  assert.equal(next.at.getUTCHours(), 1)
  assert.equal(next.at.getUTCMinutes(), 0)
})

test('nextTransition: Friday 18:00 → Monday 09:00 (skips weekend)', () => {
  // Friday 2026-11-27 19:00 Beijing
  const d = beijingDate(2026, 11, 27, 19, 0)
  const next = nextTransition(d)
  assert.equal(next.becomesPeak, true)
  // Monday 2026-11-30 09:00 Beijing = 01:00 UTC
  assert.equal(next.at.getUTCDate(), 30)
  assert.equal(next.at.getUTCHours(), 1)
})

test('nextTransition: holiday treated as off-peak, next transition after holiday', () => {
  // Monday 2026-11-23 is holiday, Tuesday 2026-11-24 is normal
  const d = beijingDate(2026, 11, 23, 10, 0) // Mon holiday 10:00
  const next = nextTransition(d, { holidays: ['2026-11-23'] })
  // Should go to Tuesday 09:00 (since Monday is holiday = off-peak all day)
  // Actually on holiday, there are no peak windows, so next is Tue 09:00
  assert.equal(next.at.getUTCDate(), 24)
  assert.equal(next.at.getUTCHours(), 1) // 09:00 Beijing = 01:00 UTC
})

test('nextTransition: skips a built-in holiday then weekend', () => {
  // 2026-09-24 (Thu) 19:00 Beijing. 2026-09-25 (Fri) is Mid-Autumn holiday
  // (Sep 25-27), so the next transition is Mon 2026-09-28 09:00 Beijing.
  const d = beijingDate(2026, 9, 24, 19, 0)
  const next = nextTransition(d)
  assert.equal(next.becomesPeak, true)
  assert.equal(next.at.toISOString(), '2026-09-28T01:00:00.000Z')
})

test('nextTransition: Beijing midnight rollover (Beijing date ahead of UTC date)', () => {
  // Beijing Sunday 2026-11-22 00:04 = UTC Saturday 2026-11-21 16:04.
  // Must skip Sunday entirely and land on Monday 2026-11-23 09:00 Beijing.
  const d = beijingDate(2026, 11, 22, 0, 4)
  const next = nextTransition(d)
  assert.equal(next.becomesPeak, true)
  assert.equal(next.at.toISOString(), '2026-11-23T01:00:00.000Z')
})

test('estimateCache: hit within TTL', () => {
  const now = 1000000
  const lastActivity = now - 30 * 60 * 1000 // 30 min ago
  assert.equal(estimateCache(lastActivity, now, 60 * 60 * 1000), 'hit')
})

test('estimateCache: miss outside TTL', () => {
  const now = 1000000
  const lastActivity = now - 90 * 60 * 1000 // 90 min ago
  assert.equal(estimateCache(lastActivity, now, 60 * 60 * 1000), 'miss')
})

test('estimateCache: unknown when no activity data', () => {
  const now = 1000000
  assert.equal(estimateCache(null, now, 60 * 60 * 1000), 'unknown')
  assert.equal(estimateCache(undefined, now, 60 * 60 * 1000), 'unknown')
})

test('estimateCache: unknown on future timestamp (clock skew)', () => {
  const now = 1000000
  const lastActivity = now + 1000 // future
  assert.equal(estimateCache(lastActivity, now, 60 * 60 * 1000), 'unknown')
})

test('costState: peak (red) beats cache', () => {
  const now = beijingDate(2026, 11, 23, 10, 0) // Mon 10:00 peak
  const lastActivity = now.getTime() - 10 * 60 * 1000 // recent activity
  const state = costState(now, lastActivity, { cacheTtlMinutes: 60, holidays: [] })
  assert.equal(state.peak, true)
  assert.equal(state.cache, 'hit')
  assert.equal(state.color, '#e5484d') // red
  assert.equal(state.label, 'PEAK')
})

test('costState: cache hit (green) when off-peak with recent activity', () => {
  const now = beijingDate(2026, 11, 23, 12, 30) // Mon 12:30 off-peak
  const lastActivity = now.getTime() - 10 * 60 * 1000
  const state = costState(now, lastActivity, { cacheTtlMinutes: 60, holidays: [] })
  assert.equal(state.peak, false)
  assert.equal(state.cache, 'hit')
  assert.equal(state.color, '#30a46c') // green
  assert.ok(state.label.includes('CACHE HIT'))
})

test('costState: off-peak no cache data (yellowgreen)', () => {
  const now = beijingDate(2026, 11, 23, 12, 30) // Mon 12:30 off-peak
  const state = costState(now, null, { cacheTtlMinutes: 60, holidays: [] })
  assert.equal(state.peak, false)
  assert.equal(state.cache, 'unknown')
  assert.equal(state.color, '#9acd32') // yellowgreen
  assert.ok(state.label.includes('OFF-PEAK'))
})

test('costState: off-peak cache miss (yellowgreen)', () => {
  const now = beijingDate(2026, 11, 23, 12, 30) // Mon 12:30 off-peak
  const lastActivity = now.getTime() - 90 * 60 * 1000 // 90 min ago
  const state = costState(now, lastActivity, { cacheTtlMinutes: 60, holidays: [] })
  assert.equal(state.peak, false)
  assert.equal(state.cache, 'miss')
  assert.equal(state.color, '#9acd32') // yellowgreen
  assert.ok(state.label.includes('OFF-PEAK'))
})

test('costState: includes beijing time and weekday', () => {
  const now = beijingDate(2026, 11, 23, 9, 30) // Mon 09:30
  const state = costState(now, null, { cacheTtlMinutes: 60, holidays: [] })
  assert.equal(state.beijing.hour, 9)
  assert.equal(state.beijing.minute, 30)
  assert.equal(state.beijing.weekday, 'Mon')
})

test('costState: holidayData is cn-2025-2027 for covered years', () => {
  const now = beijingDate(2026, 11, 23, 9, 30)
  const state = costState(now, null, { cacheTtlMinutes: 60, holidays: [] })
  assert.equal(state.holidayData, 'cn-2025-2027')
})

test('costState: holidayData is none outside covered years', () => {
  const now = beijingDate(2030, 10, 1, 10, 0)
  const state = costState(now, null, { cacheTtlMinutes: 60, holidays: [] })
  assert.equal(state.holidayData, 'none')
})

test('costState: windowEndLocal set when in peak', () => {
  const now = beijingDate(2026, 11, 23, 10, 0) // Mon 10:00 (in 09-12 window)
  const state = costState(now, null, { cacheTtlMinutes: 60, holidays: [] })
  assert.ok(state.windowEndLocal !== null)
  // Should be 12:00 in local time
})

test('costState: windowEndLocal null when off-peak', () => {
  const now = beijingDate(2026, 11, 23, 12, 30) // Mon 12:30 off-peak
  const state = costState(now, null, { cacheTtlMinutes: 60, holidays: [] })
  assert.equal(state.windowEndLocal, null)
})

test('costState: nextTransition included', () => {
  const now = beijingDate(2026, 11, 23, 10, 0) // Mon 10:00 peak
  const state = costState(now, null, { cacheTtlMinutes: 60, holidays: [] })
  assert.ok(state.nextTransition.at instanceof Date)
  assert.equal(typeof state.nextTransition.becomesPeak, 'boolean')
  assert.equal(state.nextTransition.becomesPeak, false) // 10:00 peak -> next is 12:00 off-peak
})