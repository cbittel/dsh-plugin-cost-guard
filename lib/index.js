import { costState } from './cost.js'

export const name = 'cost-guard'
/** The tool seam this plugin needs before it can be applied. */
export const inject = ['tools']

const STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    peak: { type: 'boolean', description: 'Whether DeepSeek is currently in peak pricing' },
    cache: { type: 'string', enum: ['hit', 'miss', 'unknown'], description: 'Estimated cache state' },
    color: { type: 'string', description: 'Hex color for the current state' },
    label: { type: 'string', description: 'Short label for the current state' },
    message: { type: 'string', description: 'Human-readable message with details' },
    nextTransitionAt: { type: 'string', description: 'ISO timestamp of next peak/off-peak transition' },
    nextTransitionBecomesPeak: { type: 'boolean', description: 'Whether the next transition enters peak' },
    beijingTime: { type: 'string', description: 'Current time in Beijing (HH:MM)' },
    beijingWeekday: { type: 'string', description: 'Current weekday in Beijing (Mon–Sun)' },
    holidayData: { type: 'string', description: 'Holiday data coverage: cn-2025-2027 (built-in Chinese holidays applied) or none (year out of range)' },
    windowEndLocal: { type: 'string', description: 'Local time when current peak window ends (empty string when off-peak)' },
  },
  required: [
    'peak', 'cache', 'color', 'label', 'message',
    'nextTransitionAt', 'nextTransitionBecomesPeak',
    'beijingTime', 'beijingWeekday', 'holidayData', 'windowEndLocal'
  ],
}

const NO_PARAMS = { type: 'object', properties: {}, additionalProperties: false }

function pad2(n) { return String(n).padStart(2, '0') }

function formatBeijingTime(beijing) {
  return `${pad2(beijing.hour)}:${pad2(beijing.minute)}`
}

function renderState(_params, state) {
  const parts = []
  const emoji = state.peak ? '🔴' : (state.cache === 'hit' ? '🟢' : '🟡')
  parts.push({ type: 'text', text: `${emoji} ${state.label}: ${state.message}` })
  parts.push({ type: 'text', text: `Beijing: ${state.beijingTime} ${state.beijingWeekday} | Next transition: ${new Date(state.nextTransitionAt).toLocaleString()} (${state.nextTransitionBecomesPeak ? '→ peak' : '→ off-peak'})` })
  if (state.windowEndLocal) {
    parts.push({ type: 'text', text: `Peak window ends at ${state.windowEndLocal} local time` })
  }
  parts.push({ type: 'text', text: `Holiday data: ${state.holidayData === 'none' ? 'none (verify Chinese holidays manually)' : 'Chinese national holidays 2025–2027 applied'}` })
  return parts
}

function stateTools() {
  return [
    {
      name: 'cost_status',
      description: 'Get current DeepSeek token cost state (peak/off-peak, cache estimation)',
      parameters: NO_PARAMS,
      output: {
        schema: STATE_SCHEMA,
        render: renderState,
      },
      execute: () => {
        const now = new Date()
        // Host-side: we don't have client activity data, so cache is always 'unknown'
        // The client-side badge will provide the cache estimation
        const lastActivityAt = null
        const opts = { cacheTtlMinutes: 60, holidays: [] }
        const state = costState(now, lastActivityAt, opts)
        return {
          peak: state.peak,
          cache: state.cache,
          color: state.color,
          label: state.label,
          message: state.message,
          nextTransitionAt: state.nextTransition.at.toISOString(),
          nextTransitionBecomesPeak: state.nextTransition.becomesPeak,
          beijingTime: formatBeijingTime(state.beijing),
          beijingWeekday: state.beijing.weekday,
          holidayData: state.holidayData,
          windowEndLocal: state.windowEndLocal ?? '',
        }
      },
    },
  ]
}

export function apply(ctx) {
  const tools = ctx.tools
  if (tools === undefined || typeof tools.register !== 'function') return
  for (const definition of stateTools()) {
    tools.register(definition)
  }
}

// The Loader builds the plugin from the module `default` export, so `inject`
// MUST live on this object: a module-level `export const inject` is invisible
// to it, and cordis then refuses `ctx.tools` with
// "cannot get property \"tools\" without inject".
const plugin = { name, inject, apply }
export default plugin