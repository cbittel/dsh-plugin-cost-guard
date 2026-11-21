/**
 * Core cost guard logic — pure ESM, zero runtime dependencies.
 *
 * DeepSeek peak hours are defined in Beijing time (UTC+8, no DST), Monday–Friday:
 * - 09:00–12:00
 * - 14:00–18:00
 * Everything else is off-peak. Chinese national holidays count as off-peak.
 *
 * Cache estimation is heuristic: recent activity in the tab/session suggests
 * the context cache is likely warm. No public TTL from DeepSeek; default 60 min.
 */

const PEAK_WINDOWS = [
  { start: 9, end: 12 },   // 09:00–12:00
  { start: 14, end: 18 },  // 14:00–18:00
]

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Extract Beijing time parts from a Date using Intl.DateTimeFormat.
 * @param {Date} now
 * @returns {{ year: number, month: number, date: number, day: number, hour: number, minute: number, weekday: string }}
 *   day: 1=Mon..7=Sun; year/month/date are the Beijing calendar date.
 */
export function beijingParts(now) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (type) => parts.find((p) => p.type === type)?.value
  const weekday = get('weekday') ?? 'Mon'
  const year = parseInt(get('year') ?? '0', 10)
  const month = parseInt(get('month') ?? '1', 10)
  const date = parseInt(get('day') ?? '1', 10)
  const hour = parseInt(get('hour') ?? '0', 10)
  const minute = parseInt(get('minute') ?? '0', 10)
  const day = WEEKDAY_NAMES.indexOf(weekday) + 1 // 1=Mon..7=Sun
  return { year, month, date, day, hour, minute, weekday }
}

/** Beijing calendar date as YYYY-MM-DD, for holiday lookups. */
export function beijingDateStr(parts) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.date).padStart(2, '0')}`
}

// Official Chinese national holidays (days off), 2025–2027, per the State
// Council General Office notices (gov.cn, 国务院办公厅关于部分节假日安排的通知).
// These are the rest days. The make-up workdays (调休上班) fall on weekends and
// stay off-peak under the strict Mon–Fri peak rule.
const HOLIDAY_RANGES = [
  // 2025
  ['2025-01-01', '2025-01-01'], // New Year (1 day)
  ['2025-01-28', '2025-02-04'], // Spring Festival (8 days)
  ['2025-04-04', '2025-04-06'], // Qingming
  ['2025-05-01', '2025-05-05'], // Labor Day
  ['2025-05-31', '2025-06-02'], // Dragon Boat
  ['2025-10-01', '2025-10-08'], // National Day + Mid-Autumn
  // 2026
  ['2026-01-01', '2026-01-03'], // New Year
  ['2026-02-15', '2026-02-23'], // Spring Festival (9 days)
  ['2026-04-04', '2026-04-06'], // Qingming
  ['2026-05-01', '2026-05-05'], // Labor Day
  ['2026-06-19', '2026-06-21'], // Dragon Boat
  ['2026-09-25', '2026-09-27'], // Mid-Autumn
  ['2026-10-01', '2026-10-07'], // National Day
  // 2027
  ['2027-01-01', '2027-01-03'], // New Year
  ['2027-02-05', '2027-02-13'], // Spring Festival (9 days)
  ['2027-04-03', '2027-04-05'], // Qingming
  ['2027-05-01', '2027-05-05'], // Labor Day
  ['2027-06-09', '2027-06-09'], // Dragon Boat (1 day)
  ['2027-09-15', '2027-09-15'], // Mid-Autumn (1 day)
  ['2027-10-01', '2027-10-07'], // National Day
]

const HOLIDAY_MIN_YEAR = 2025
const HOLIDAY_MAX_YEAR = 2027

/** True when the Beijing date string falls inside a built-in holiday range. */
export function isKnownHoliday(dateStr) {
  return HOLIDAY_RANGES.some(([from, to]) => dateStr >= from && dateStr <= to)
}

function isHolidayDate(dateStr, extraHolidays = []) {
  return isKnownHoliday(dateStr) || extraHolidays.includes(dateStr)
}

/**
 * Check if a given moment is in DeepSeek peak hours (Beijing time, Mon–Fri).
 * @param {Date} now
 * @param {Object} opts
 * @param {string[]} [opts.holidays=[]] — ISO date strings (YYYY-MM-DD) in Beijing time
 * @returns {boolean}
 */
export function isPeak(now, opts = {}) {
  const { holidays = [] } = opts
  const parts = beijingParts(now)
  // Chinese national holidays (built-in + user extras) are off-peak even on weekdays
  if (isHolidayDate(beijingDateStr(parts), holidays)) return false
  // Weekend (Sat=6, Sun=7) is always off-peak
  if (parts.day >= 6) return false
  // Check peak windows
  const mins = parts.hour * 60 + parts.minute
  for (const w of PEAK_WINDOWS) {
    const start = w.start * 60
    const end = w.end * 60
    if (mins >= start && mins < end) return true
  }
  return false
}

/**
 * Compute the next transition (peak↔off-peak) from now, walking Beijing
 * calendar days so weekend/holiday skips and the UTC↔Beijing date rollover are
 * both handled correctly.
 * @param {Date} now
 * @param {Object} opts
 * @param {string[]} [opts.holidays=[]]
 * @returns {{ at: Date, becomesPeak: boolean }}
 */
export function nextTransition(now, opts = {}) {
  const { holidays = [] } = opts
  const parts = beijingParts(now)
  const currentMins = parts.hour * 60 + parts.minute
  const currentPeak = isPeak(now, opts)

  // The first boundary after `now` always flips the state, so becomesPeak is
  // simply the opposite of the current state.
  for (let i = 0; i < 14; i += 1) {
    const dayDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.date + i))
    const dp = beijingParts(dayDate)
    if (dp.day >= 6 || isHolidayDate(beijingDateStr(dp), holidays)) continue

    for (const mins of [9 * 60, 12 * 60, 14 * 60, 18 * 60]) {
      if (i === 0 && mins <= currentMins) continue
      const at = new Date(Date.UTC(parts.year, parts.month - 1, parts.date + i, Math.floor(mins / 60) - 8, mins % 60, 0, 0))
      return { at, becomesPeak: !currentPeak }
    }
  }
  return { at: new Date(now), becomesPeak: !currentPeak }
}

/**
 * Estimate cache hit based on recent activity.
 * @param {number|null|undefined} lastActivityAt — epoch ms of last activity
 * @param {number} now — current epoch ms
 * @param {number} ttlMs — cache TTL in milliseconds
 * @returns {'hit'|'miss'|'unknown'}
 */
export function estimateCache(lastActivityAt, now, ttlMs) {
  if (lastActivityAt == null) return 'unknown'
  const delta = now - lastActivityAt
  if (delta < 0) return 'unknown' // clock skew or future timestamp
  return delta < ttlMs ? 'hit' : 'miss'
}

/**
 * Compute the complete cost state for display.
 * @param {Date} now
 * @param {number|null|undefined} lastActivityAt
 * @param {Object} opts
 * @param {number} [opts.cacheTtlMinutes=60]
 * @param {string[]} [opts.holidays=[]]
 * @returns {{
 *   peak: boolean,
 *   cache: 'hit'|'miss'|'unknown',
 *   color: 'red'|'green'|'yellowgreen',
 *   label: string,
 *   message: string,
 *   nextTransition: { at: Date, becomesPeak: boolean },
 *   beijing: { day: number, hour: number, minute: number, weekday: string },
 *   holidayAssumption: 'none',
 *   windowEndLocal: string | null
 * }}
 */
export function costState(now, lastActivityAt, opts = {}) {
  const { cacheTtlMinutes = 60, holidays = [] } = opts
  const peak = isPeak(now, { holidays })
  const cache = estimateCache(lastActivityAt, now.getTime(), cacheTtlMinutes * 60 * 1000)
  const next = nextTransition(now, { holidays })
  const beijing = beijingParts(now)
  const weekday = WEEKDAY_NAMES[beijing.day - 1]

  const covered = beijing.year >= HOLIDAY_MIN_YEAR && beijing.year <= HOLIDAY_MAX_YEAR
  const holidayData = covered ? 'cn-2025-2027' : 'none'
  const holidayNote = covered
    ? 'Chinese national holidays 2025–2027 applied.'
    : `No holiday data for ${beijing.year}; assuming not a holiday (verify).`

  let color, label, message, windowEndLocal = null

  if (peak) {
    color = '#e5484d'
    label = 'PEAK'
    // Compute when the current peak window ends in local time
    const endHour = beijing.hour < 12 ? 12 : 18
    const endDate = new Date(now)
    endDate.setUTCHours(endHour - 8, 0, 0, 0)
    windowEndLocal = endDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    message = `DeepSeek peak pricing (2× tokens) until ${windowEndLocal} local. ${holidayNote}`
  } else if (cache === 'hit') {
    color = '#30a46c'
    label = 'CACHE HIT (est.)'
    message = `Estimated context cache hit (recent activity). Off-peak pricing. ${holidayNote}`
  } else {
    color = '#9acd32'
    label = cache === 'miss' ? 'OFF-PEAK' : 'OFF-PEAK (no cache data)'
    message = `Off-peak pricing (½ tokens). ${cache === 'miss' ? 'Cache likely cold (no recent activity).' : 'No activity data to estimate cache.'} ${holidayNote}`
  }

  return {
    peak,
    cache,
    color,
    label,
    message,
    nextTransition: next,
    beijing: { ...beijing, weekday },
    holidayData,
    windowEndLocal,
  }
}