import test from 'node:test'
import assert from 'node:assert/strict'
import plugin, { apply, name, inject } from '../lib/index.js'

test('exports the cordis plugin shape (name + apply + inject on default)', () => {
  assert.equal(typeof apply, 'function')
  assert.equal(name, 'cost-guard')
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(plugin, plugin.default ?? plugin)
})

test('apply() registers the cost_status tool when tool seam present', () => {
  const registered = []
  const ctx = {
    provide: () => {},
    effect: () => {},
    tools: { register: (definition) => registered.push(definition) },
  }
  apply(ctx)

  assert.equal(registered.length, 1)
  const def = registered[0]
  assert.equal(def.name, 'cost_status')
  assert.equal(typeof def.description, 'string')
  assert.equal(def.parameters.type, 'object')
  assert.equal(typeof def.output.render, 'function')
  assert.equal(def.output.schema.type, 'object')
  assert.equal(def.output.schema.additionalProperties, false)
  assert.equal(typeof def.execute, 'function')
})

test('apply() tolerates a context without the tool seam', () => {
  const ctx = { provide: () => {}, effect: () => {} }
  assert.doesNotThrow(() => apply(ctx))
})

test('cost_status tool executes and returns valid state shape', async () => {
  const registered = []
  const ctx = {
    provide: () => {},
    effect: () => {},
    tools: { register: (definition) => registered.push(definition) },
  }
  apply(ctx)

  const def = registered[0]
  const result = await def.execute({}, {})

  // Check all required fields from STATE_SCHEMA
  assert.equal(typeof result.peak, 'boolean')
  assert.ok(['hit', 'miss', 'unknown'].includes(result.cache))
  assert.ok(typeof result.color === 'string' && result.color.startsWith('#'))
  assert.ok(typeof result.label === 'string' && result.label.length > 0)
  assert.ok(typeof result.message === 'string' && result.message.length > 0)
  assert.ok(typeof result.nextTransitionAt === 'string')
  assert.ok(new Date(result.nextTransitionAt).getTime() > 0)
  assert.equal(typeof result.nextTransitionBecomesPeak, 'boolean')
  assert.ok(typeof result.beijingTime === 'string' && /^\d{2}:\d{2}$/.test(result.beijingTime))
  assert.ok(typeof result.beijingWeekday === 'string' && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(result.beijingWeekday))
  assert.equal(typeof result.holidayData, 'string')
  assert.ok(['cn-2025-2027', 'none'].includes(result.holidayData))
  assert.ok(result.windowEndLocal === null || typeof result.windowEndLocal === 'string')
})

test('cost_status render function returns text parts', async () => {
  const registered = []
  const ctx = {
    provide: () => {},
    effect: () => {},
    tools: { register: (definition) => registered.push(definition) },
  }
  apply(ctx)

  const def = registered[0]
  const result = await def.execute({}, {})
  const parts = def.output.render({}, result)

  assert.ok(Array.isArray(parts))
  assert.ok(parts.length > 0)
  for (const part of parts) {
    assert.equal(part.type, 'text')
    assert.ok(typeof part.text === 'string' && part.text.length > 0)
  }
})

test('STATE_SCHEMA declares all returned fields with additionalProperties: false', () => {
  const registered = []
  const ctx = {
    provide: () => {},
    effect: () => {},
    tools: { register: (definition) => registered.push(definition) },
  }
  apply(ctx)

  const def = registered[0]
  const schema = def.output.schema
  assert.equal(schema.additionalProperties, false)

  // Verify all required fields are declared
  const required = [
    'peak', 'cache', 'color', 'label', 'message',
    'nextTransitionAt', 'nextTransitionBecomesPeak',
    'beijingTime', 'beijingWeekday', 'holidayData', 'windowEndLocal'
  ]
  for (const field of required) {
    assert.ok(field in schema.properties, `Missing property: ${field}`)
  }

  // Verify cache enum
  assert.deepEqual(schema.properties.cache.enum, ['hit', 'miss', 'unknown'])
})