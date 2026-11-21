/**
 * dsh-plugin-cost-guard — browser half.
 *
 * Adds a persistent badge (always visible) and a sidebar tab showing
 * DeepSeek token cost state: peak/off-peak, cache estimation, next transition.
 *
 * Badge: fixed position, top-right, high z-index, vanilla DOM (not React)
 * so it survives shell reloads and isn't tied to any seat.
 *
 * Sidebar tab: uses the same three seats as pomodoro (guide.entry, pane.tab, pane.tab.title).
 *
 * Activity tracking: visibilitychange + pointerdown/keydown (throttled) → localStorage.
 *
 * Format: lazy-CJS factory served from exports["./client"].
 * No build step, no npm deps; only shell-seeded `react` and `react/jsx-runtime`.
 */
;(() => {
  const definition = {
    id: 'dsh-plugin-cost-guard',
    factory: (require) => {
      const module = { exports: {} }
      const exports = module.exports
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

      const react = require('react')
      const jsxRuntime = require('react/jsx-runtime')
      const jsx = jsxRuntime.jsx
      const jsxs = jsxRuntime.jsxs

      /** Tab type id: the package name, unique per sidebar registration. */
      const ID = 'dsh-plugin-cost-guard'
      /** Tab kind used by `tab.actions.openTab(kind, ...)`. */
      const KIND = 'cost-guard'
      /** localStorage key for last activity timestamp. */
      const ACTIVITY_KEY = 'dsh-plugin-cost-guard/activity/v1'
      /** localStorage key for config (holidays, cacheTtlMinutes). */
      const CONFIG_KEY = 'dsh-plugin-cost-guard/config/v1'

      /** Client services this half consumes; static, as the manifest rule wants. */
      const inject = ['slots', 'sidebarRightTabs']

      // ──────────────────────────────────────────────────────────────────────
      // Pure logic (mirrored from lib/cost.js for client-side computation)
      // ──────────────────────────────────────────────────────────────────────

      const PEAK_WINDOWS = [
        { start: 9, end: 12 },
        { start: 14, end: 18 },
      ]
      const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

      // Official Chinese national holidays (days off), 2025–2027. Same data as
      // lib/cost.js (mirrored here because the browser bundle cannot import it).
      const HOLIDAY_RANGES = [
        ['2025-01-01', '2025-01-01'],
        ['2025-01-28', '2025-02-04'],
        ['2025-04-04', '2025-04-06'],
        ['2025-05-01', '2025-05-05'],
        ['2025-05-31', '2025-06-02'],
        ['2025-10-01', '2025-10-08'],
        ['2026-01-01', '2026-01-03'],
        ['2026-02-15', '2026-02-23'],
        ['2026-04-04', '2026-04-06'],
        ['2026-05-01', '2026-05-05'],
        ['2026-06-19', '2026-06-21'],
        ['2026-09-25', '2026-09-27'],
        ['2026-10-01', '2026-10-07'],
        ['2027-01-01', '2027-01-03'],
        ['2027-02-05', '2027-02-13'],
        ['2027-04-03', '2027-04-05'],
        ['2027-05-01', '2027-05-05'],
        ['2027-06-09', '2027-06-09'],
        ['2027-09-15', '2027-09-15'],
        ['2027-10-01', '2027-10-07'],
      ]
      const HOLIDAY_MIN_YEAR = 2025
      const HOLIDAY_MAX_YEAR = 2027

      function isKnownHoliday(dateStr) {
        return HOLIDAY_RANGES.some(([from, to]) => dateStr >= from && dateStr <= to)
      }

      function isHolidayDate(dateStr, extraHolidays = []) {
        return isKnownHoliday(dateStr) || extraHolidays.includes(dateStr)
      }

      function beijingParts(now) {
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
        const day = WEEKDAY_NAMES.indexOf(weekday) + 1
        return { year, month, date, day, hour, minute, weekday }
      }

      function beijingDateStr(parts) {
        return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.date).padStart(2, '0')}`
      }

      function isPeak(now, holidays = []) {
        const parts = beijingParts(now)
        if (isHolidayDate(beijingDateStr(parts), holidays)) return false
        if (parts.day >= 6) return false
        const mins = parts.hour * 60 + parts.minute
        for (const w of PEAK_WINDOWS) {
          const start = w.start * 60
          const end = w.end * 60
          if (mins >= start && mins < end) return true
        }
        return false
      }

      function nextTransition(now, holidays = []) {
        const parts = beijingParts(now)
        const currentMins = parts.hour * 60 + parts.minute
        const currentPeak = isPeak(now, holidays)

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

      function estimateCache(lastActivityAt, now, ttlMs) {
        if (lastActivityAt == null) return 'unknown'
        const delta = now - lastActivityAt
        if (delta < 0) return 'unknown'
        return delta < ttlMs ? 'hit' : 'miss'
      }

      function pad2(n) { return String(n).padStart(2, '0') }

      function formatBeijingTime(beijing) {
        return `${pad2(beijing.hour)}:${pad2(beijing.minute)}`
      }

      function costState(now, lastActivityAt, opts = {}) {
        const { cacheTtlMinutes = 60, holidays = [] } = opts
        const peak = isPeak(now, holidays)
        const cache = estimateCache(lastActivityAt, now.getTime(), cacheTtlMinutes * 60 * 1000)
        const next = nextTransition(now, holidays)
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

      // ──────────────────────────────────────────────────────────────────────
      // Activity tracking (localStorage)
      // ──────────────────────────────────────────────────────────────────────

      let activityThrottleTimer = null
      const ACTIVITY_THROTTLE_MS = 5000

      function recordActivity() {
        const now = Date.now()
        try {
          localStorage.setItem(ACTIVITY_KEY, String(now))
        } catch (_) { /* ignore quota/private mode */ }
      }

      function throttledRecordActivity() {
        if (activityThrottleTimer) return
        activityThrottleTimer = setTimeout(() => {
          activityThrottleTimer = null
        }, ACTIVITY_THROTTLE_MS)
        recordActivity()
      }

      function getLastActivity() {
        try {
          const v = localStorage.getItem(ACTIVITY_KEY)
          return v ? parseInt(v, 10) : null
        } catch (_) {
          return null
        }
      }

      function getConfig() {
        try {
          const v = localStorage.getItem(CONFIG_KEY)
          return v ? JSON.parse(v) : {}
        } catch (_) {
          return {}
        }
      }

      function saveConfig(cfg) {
        try {
          localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
        } catch (_) { /* ignore */ }
      }

      // ──────────────────────────────────────────────────────────────────────
      // Persistent badge (vanilla DOM, fixed position)
      // ──────────────────────────────────────────────────────────────────────

      let badgeEl = null
      let badgeUpdateTimer = null

      // The badge must clear TWO stacked top bars:
      //   1. the native window controls overlay (desktop only, Windows), and
      //   2. DSH's own top bar (sidebar toggle / ⋯ menu / apps) in the top-right.
      // `badgeTopOffset` is the clearance below the DSH top bar (configurable in
      // the Cost Guard tab); the WCO title-bar height is added automatically.
      function badgeTop() {
        let base = 0
        try {
          const wco = navigator.windowControlsOverlay
          if (wco && typeof wco.getTitlebarAreaRect === 'function' && wco.visible) {
            const rect = wco.getTitlebarAreaRect()
            base = rect.y + rect.height
          }
        } catch (_) {
          /* browser: no overlay */
        }
        const config = getConfig()
        const offset = typeof config.badgeTopOffset === 'number' ? config.badgeTopOffset : 56
        return (base + offset) + 'px'
      }

      function createBadge() {
        if (badgeEl) return badgeEl
        if (!document.body) return null
        const el = document.createElement('div')
        el.id = 'dsh-cost-guard-badge'
        el.style.cssText = `
          position: fixed;
          right: 12px;
          z-index: 2147483647;
          padding: 6px 10px;
          border-radius: 6px;
          font: 12px/1.4 var(--dsw-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
          color: var(--dsw-color-text, #1a1a2e);
          background: var(--dsw-color-surface, #ffffff);
          border: 1px solid var(--dsw-color-border, #e0e0e0);
          box-shadow: var(--dsw-shadow-lg, 0 4px 12px rgba(0,0,0,0.15));
          white-space: nowrap;
          cursor: pointer;
          user-select: none;
          transition: background-color 0.2s, color 0.2s, border-color 0.2s;
        `
        el.style.top = badgeTop()
        // Double-click toggles the badge off (collapsed to a tiny dot) so it no
        // longer covers DSH's own top-right controls; double-click again to restore.
        el.addEventListener('dblclick', () => {
          const config = getConfig()
          config.badgeEnabled = !(config.badgeEnabled ?? true)
          saveConfig(config)
          updateBadge()
        })
        document.body.appendChild(el)
        badgeEl = el
        return el
      }

      function removeBadge() {
        if (badgeEl) {
          badgeEl.remove()
          badgeEl = null
        }
      }

      function updateBadge() {
        if (!document.body) return
        const el = createBadge()
        if (!el) return
        const now = new Date()
        const lastActivity = getLastActivity()
        const config = getConfig()
        const state = costState(now, lastActivity, {
          cacheTtlMinutes: config.cacheTtlMinutes ?? 60,
          holidays: config.holidays ?? [],
        })
        const enabled = config.badgeEnabled ?? true

        if (!enabled) {
          // Collapsed: a tiny dot that keeps the live state color so it still
          // reads as "active" while no longer covering DSH's controls.
          el.textContent = ''
          el.style.cssText = `
            position: fixed;
            right: 12px;
            z-index: 2147483647;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: ${state.color};
            border: 1px solid rgba(0,0,0,0.25);
            box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            cursor: pointer;
            user-select: none;
          `
          el.style.top = badgeTop()
          el.title = `${state.label} — double-click to expand`
          return
        }

        // Enabled: full pill.
        el.style.cssText = `
          position: fixed;
          right: 12px;
          z-index: 2147483647;
          padding: 6px 10px;
          border-radius: 6px;
          font: 12px/1.4 var(--dsw-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
          color: var(--dsw-color-text, #1a1a2e);
          border: 1px solid var(--dsw-color-border, #e0e0e0);
          box-shadow: var(--dsw-shadow-lg, 0 4px 12px rgba(0,0,0,0.15));
          white-space: nowrap;
          cursor: pointer;
          user-select: none;
          transition: background-color 0.2s, color 0.2s, border-color 0.2s;
        `
        el.style.top = badgeTop()

        // Determine text color for contrast
        const isDark = state.color === '#e5484d' || state.color === '#30a46c'
        const textColor = isDark ? '#ffffff' : '#1a1a2e'

        let shortLabel = state.label
        if (state.peak && state.windowEndLocal) {
          shortLabel += ` until ${state.windowEndLocal}`
        }

        el.style.backgroundColor = state.color
        el.style.color = textColor
        el.style.borderColor = state.color
        el.textContent = `💰 ${shortLabel}`

        // Tooltip with full message
        el.title = state.message + ' — double-click to turn off'
      }

      function startBadgeUpdates() {
        if (badgeUpdateTimer) return
        updateBadge()
        badgeUpdateTimer = setInterval(updateBadge, 15000)
      }

      function stopBadgeUpdates() {
        if (badgeUpdateTimer) {
          clearInterval(badgeUpdateTimer)
          badgeUpdateTimer = null
        }
      }

      // ──────────────────────────────────────────────────────────────────────
      // Sidebar tab components (React)
      // ──────────────────────────────────────────────────────────────────────

      const { useState, useEffect, useMemo } = react

      function CostGuardPane() {
        const [now, setNow] = useState(new Date())
        const [lastActivity, setLastActivity] = useState(getLastActivity())
        const [config, setConfig] = useState(getConfig())

        useEffect(() => {
          // Update clock every second
          const timer = setInterval(() => setNow(new Date()), 1000)
          // Poll activity/config from localStorage
          const poll = setInterval(() => {
            setLastActivity(getLastActivity())
            setConfig(getConfig())
          }, 2000)
          // Listen for storage changes (other tabs)
          const onStorage = (e) => {
            if (e.key === ACTIVITY_KEY) setLastActivity(getLastActivity())
            if (e.key === CONFIG_KEY) setConfig(getConfig())
          }
          window.addEventListener('storage', onStorage)
          return () => {
            clearInterval(timer)
            clearInterval(poll)
            window.removeEventListener('storage', onStorage)
          }
        }, [])

        const state = useMemo(() => costState(now, lastActivity, {
          cacheTtlMinutes: config.cacheTtlMinutes ?? 60,
          holidays: config.holidays ?? [],
        }), [now, lastActivity, config.cacheTtlMinutes, config.holidays?.join(',')])

        const cacheLabel = state.cache === 'hit' ? '🟢 Cache HIT (est.)' :
          state.cache === 'miss' ? '🔴 Cache MISS (est.)' : '⚪ Cache unknown'

        const peakLabel = state.peak ? '🔴 PEAK (2× tokens)' : '🟢 Off-peak (½ tokens)'

        const nextTrans = state.nextTransition
        const nextTransStr = nextTrans.at.toLocaleString()
        const nextTransType = nextTrans.becomesPeak ? '→ PEAK' : '→ Off-peak'

        return jsxs('div', {
          style: {
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontFamily: 'var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
            color: 'var(--dsw-color-text, #1a1a2e)',
          },
        }, [
          // Current state card
          jsxs('div', {
            style: {
              padding: '16px',
              borderRadius: '8px',
              background: state.color,
              color: '#fff',
              boxShadow: 'var(--dsw-shadow-md, 0 2px 8px rgba(0,0,0,0.1))',
            },
          }, [
            jsx('div', { style: { fontSize: '18px', fontWeight: 600, marginBottom: '4px' }, children: state.label }),
            jsx('div', { style: { fontSize: '13px', opacity: 0.9 }, children: state.message }),
          ]),

          // Details grid
          jsxs('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, [
            detailCard('Beijing Time', `${formatBeijingTime(state.beijing)} ${state.beijing.weekday}`),
            detailCard('Peak Status', peakLabel),
            detailCard('Cache Estimation', cacheLabel),
            detailCard('Next Transition', `${nextTransStr} (${nextTransType})`),
          ]),

          // Config section
          jsxs('div', {
            style: {
              padding: '12px',
              borderRadius: '8px',
              background: 'var(--dsw-color-surface-variant, #f5f5f5)',
              border: '1px solid var(--dsw-color-border, #e0e0e0)',
            },
          }, [
            jsx('div', { style: { fontWeight: 600, marginBottom: '8px' }, children: 'Configuration' }),
            jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' } }, [
              jsxs('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                jsx('input', {
                  type: 'number',
                  min: '5',
                  max: '480',
                  value: config.cacheTtlMinutes ?? 60,
                  onChange: (e) => {
                    const newConfig = { ...config, cacheTtlMinutes: parseInt(e.target.value, 10) }
                    saveConfig(newConfig)
                    setConfig(newConfig)
                  },
                  style: { width: '80px', padding: '4px 8px', fontSize: '13px' },
                }),
                'Cache TTL (minutes): activity within this window = estimated cache hit',
              ]),
              jsxs('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                jsx('input', {
                  type: 'number',
                  min: '0',
                  max: '200',
                  value: config.badgeTopOffset ?? 56,
                  onChange: (e) => {
                    const newConfig = { ...config, badgeTopOffset: parseInt(e.target.value, 10) || 0 }
                    saveConfig(newConfig)
                    setConfig(newConfig)
                  },
                  style: { width: '80px', padding: '4px 8px', fontSize: '13px' },
                }),
                'Badge top offset (px): clearance below the DSH top bar',
              ]),
              jsxs('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                jsx('textarea', {
                  value: (config.holidays ?? []).join('\n'),
                  onChange: (e) => {
                    const holidays = e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                    const newConfig = { ...config, holidays }
                    saveConfig(newConfig)
                    setConfig(newConfig)
                  },
                  placeholder: 'YYYY-MM-DD (one per line, Beijing dates)',
                  rows: 3,
                  style: { width: '100%', padding: '6px 8px', fontSize: '12px', fontFamily: 'monospace' },
                }),
                'Extra holidays (off-peak even on weekdays)',
              ]),
              jsx('div', { style: { fontSize: '11px', color: 'var(--dsw-color-text-muted, #888)' }, children:
                'Chinese national holidays 2025–2027 are built in. Add extra dates above (YYYY-MM-DD, one per line) if needed.'
              }),
              jsx('div', { style: { fontSize: '11px', color: 'var(--dsw-color-text-muted, #888)' }, children:
                'Double-click the badge to turn it off (collapses to a tiny dot) and back on.'
              }),
            ]),
          ]),

          // Legend
          jsx('div', { style: { fontSize: '11px', color: 'var(--dsw-color-text-muted, #888)', lineHeight: 1.6 }, children: [
            jsx('div', { children: '🔴 Red = Peak hours (Mon–Fri 09–12, 14–18 Beijing, 2× token cost)' }),
            jsx('div', { children: '🟢 Green = Estimated cache hit (recent activity, off-peak)' }),
            jsx('div', { children: '🟡 Yellow-green = Off-peak, no cache data or cache miss' }),
            jsx('div', { children: 'Priority: Peak > Cache hit > Off-peak' }),
          ]}),
        ])
      }

      function detailCard(title, value) {
        return jsxs('div', {
          style: {
            padding: '10px',
            borderRadius: '6px',
            background: 'var(--dsw-color-surface, #fff)',
            border: '1px solid var(--dsw-color-border, #e0e0e0)',
          },
        }, [
          jsx('div', { style: { fontSize: '11px', color: 'var(--dsw-color-text-muted, #888)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }, children: title }),
          jsx('div', { style: { fontSize: '14px', fontWeight: 500 }, children: value }),
        ])
      }

      function CostGuardTitle() {
        const [now, setNow] = useState(new Date())
        useEffect(() => {
          const timer = setInterval(() => setNow(new Date()), 1000)
          return () => clearInterval(timer)
        }, [])
        const lastActivity = getLastActivity()
        const config = getConfig()
        const state = costState(now, lastActivity, {
          cacheTtlMinutes: config.cacheTtlMinutes ?? 60,
          holidays: config.holidays ?? [],
        })
        const emoji = state.peak ? '🔴' : (state.cache === 'hit' ? '🟢' : '🟡')
        return jsx('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
          jsx('span', { children: '💰' }),
          jsx('span', { children: state.label }),
        ])
      }

      function CostGuardGuide(props) {
        const useTabInfo = props === null || props === undefined ? undefined : props.useTabInfo
        let info
        if (typeof useTabInfo === 'function') info = useTabInfo()

        const open = () => {
          const actions = info === null || info === undefined || info.tab === null || info.tab === undefined
            ? undefined
            : info.tab.actions
          if (actions === null || actions === undefined || typeof actions.openTab !== 'function') return
          actions.openTab(KIND, { replaceTab: true })
        }

        const title = (props !== null && props !== undefined && props.title) || 'Cost Guard'
        const description = props === null || props === undefined ? undefined : props.description

        return jsxs('button', {
          type: 'button',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            padding: '8px 10px',
            borderRadius: '7px',
            border: '1px solid var(--dsw-border-subtle, #d0d4d9)',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          },
          onClick: open,
          title: description === undefined ? title : title + ' — ' + description,
          children: [
            jsx('span', { key: 'art', style: { fontSize: '16px' }, children: '💰' }),
            jsxs('span', {
              key: 'text',
              style: { display: 'flex', flexDirection: 'column', gap: '1px' },
              children: [
                jsx('span', { key: 't', style: { fontWeight: 600 }, children: title }),
                description === undefined
                  ? null
                  : jsx('span', { key: 'd', style: { fontSize: '11px', opacity: 0.7 }, children: description }),
              ],
            }),
          ],
        })
      }

      // ──────────────────────────────────────────────────────────────────────
      // Apply: register tab type + seats
      // ──────────────────────────────────────────────────────────────────────

      function guard(label, run) {
        try {
          return run()
        } catch (error) {
          console.warn('[' + ID + '] ' + label + ' failed:', error)
          return undefined
        }
      }

      function apply(ctx) {
        if (ctx === null || ctx === undefined) return

        // Always-visible badge + activity tracking: independent of any seat, so it
        // shows even if the sidebar package is not mounted.
        let disposed = false
        function onVisibilityChange() {
          if (!disposed && document.visibilityState === 'visible') throttledRecordActivity()
        }
        function onUserActivity() {
          if (!disposed) throttledRecordActivity()
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        document.addEventListener('pointerdown', onUserActivity, { passive: true })
        document.addEventListener('keydown', onUserActivity, { passive: true })
        startBadgeUpdates()

        ctx.effect(() => () => {
          disposed = true
          document.removeEventListener('visibilitychange', onVisibilityChange)
          document.removeEventListener('pointerdown', onUserActivity)
          document.removeEventListener('keydown', onUserActivity)
          stopBadgeUpdates()
          removeBadge()
        })

        // Sidebar tab: same proven shape as dsh-plugin-pomodoro (guide is an array
        // of entries, seats are injected via slots.inject inside ctx.effect).
        guard('tab type', () => {
          const tabs = ctx.sidebarRightTabs
          if (tabs === null || tabs === undefined || typeof tabs.register !== 'function') return
          ctx.effect(
            () => tabs.register({
              id: ID,
              kind: KIND,
              multiple: false,
              title: () => 'Cost Guard',
              guide: [
                {
                  id: 'open',
                  order: 90,
                  title: () => 'Cost Guard',
                  description: () => 'DeepSeek token cost: peak/off-peak + cache',
                },
              ],
            }),
            ID + ': tab type'
          )
        })

        const register = (seat, Component, label) => {
          guard(label, () => {
            const slots = ctx.slots
            if (slots === null || slots === undefined) return
            if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
            ctx.effect(
              () => slots.inject(seat, () => slots.register({ name: seat, key: ID }, Component)),
              ID + ': ' + label
            )
          })
        }

        register('sidebar.right.tab.guide.entry', CostGuardGuide, 'guide')
        register('sidebar.right.pane.tab', CostGuardPane, 'body')
        register('sidebar.right.pane.tab.title', CostGuardTitle, 'title')
      }

      // ──────────────────────────────────────────────────────────────────────
      // Exports
      // ──────────────────────────────────────────────────────────────────────

      module.exports = {
        // Pure logic (for tests)
        beijingParts,
        isPeak,
        nextTransition,
        estimateCache,
        costState,
        pad2,
        formatBeijingTime,
        // Config
        ACTIVITY_KEY,
        CONFIG_KEY,
        getLastActivity,
        getConfig,
        saveConfig,
        recordActivity,
        // UI
        createBadge,
        removeBadge,
        updateBadge,
        startBadgeUpdates,
        stopBadgeUpdates,
        CostGuardPane,
        CostGuardTitle,
        CostGuardGuide,
        apply,
        inject,
        // Constants
        ID,
        KIND,
        PEAK_WINDOWS,
        WEEKDAY_NAMES,
      }
      return module.exports
    },
  }

  // The shell's module loader registers the factory; in Node the definition is
  // parked so the module can be exercised without a browser.
  if (typeof window !== 'undefined' && window !== null && window.__ModuleLoader__ !== undefined && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load(definition)
  }
  if (typeof globalThis !== 'undefined') globalThis.__DSH_COST_GUARD_CLIENT__ = definition
})()