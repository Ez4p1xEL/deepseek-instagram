// 工具 schema 的回归测试。
//
// 背景：2026-10-25 用户启用插件后**每条消息**都报
//   Invalid schema for function 'ig_config': schema must be a JSON Schema of
//   'type: "object"', got 'type: null'
// 原因是 ctx.tools.register() 不会替你归一化 parameters（宿主的 defineTool 才会）。
// 这个测试把「归一化后的 schema 一定是 object 根」钉死。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { __tools } from '../index.js'

const { objectParams, textTool } = __tools

test('objectParams wraps a property table into an object-rooted schema', () => {
  const schema = objectParams({
    word: { type: 'string', description: '关键词' },
    num: { type: 'number' },
  })
  assert.equal(schema.type, 'object')
  assert.deepEqual(Object.keys(schema.properties), ['word', 'num'])
  assert.equal(schema.properties.word.type, 'string')
})

test('objectParams keeps an already-normalized schema untouched', () => {
  const full = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }
  assert.equal(objectParams(full), full)
})

test('objectParams handles the no-argument case', () => {
  assert.deepEqual(objectParams(), { type: 'object', properties: {} })
  assert.deepEqual(objectParams({}), { type: 'object', properties: {} })
})

test('textTool always emits parameters with type "object"', () => {
  const specs = [
    { name: 'a', description: 'no args', parameters: {}, execute: async () => ({}) },
    { name: 'b', description: 'one arg', parameters: { x: { type: 'string' } }, execute: async () => ({}) },
    { name: 'c', description: 'already full', parameters: { type: 'object', properties: {} }, execute: async () => ({}) },
  ]
  for (const spec of specs) {
    const def = textTool(spec)
    assert.equal(def.parameters.type, 'object', `${spec.name} parameters.type`)
    assert.equal(typeof def.parameters.properties, 'object', `${spec.name} parameters.properties`)
    assert.equal(typeof def.output.render, 'function')
    assert.equal(def.output.schema.type, 'object')
  }
})

test('textTool execute stays JSON-safe', async () => {
  const def = textTool({ name: 'd', parameters: {}, execute: async () => ({ at: new Date(0), bytes: new Uint8Array([1]) }) })
  const out = await def.execute({}, {})
  assert.equal(typeof out.at, 'string')
  assert.deepEqual(out.bytes, { '0': 1 })
})

test('mentionPayload always points a story mention at the owner', async () => {
  const { __mention } = await import('../index.js')
  const on = __mention.mentionPayload({ owner: '@ez4p1xel', storyMention: { enabled: true, x: 0.5, y: 0.86, width: 0.5, height: 0.09 } })
  assert.equal(on.mentionHandle, 'ez4p1xel')
  assert.equal(on.mentionY, 0.86)
  const off = __mention.mentionPayload({ owner: 'ez4p1xel', storyMention: { enabled: false } })
  assert.deepEqual(off, {})
  const wild = __mention.mentionPayload({ owner: 'ez4p1xel', storyMention: { enabled: true, x: 5, y: -1 } })
  assert.equal(wild.mentionX, 0.5)
  assert.equal(wild.mentionY, 0.86)
})

test('mentionPayload without an owner emits nothing (caption must not fake an @)', async () => {
  const { __mention } = await import('../index.js')
  assert.deepEqual(__mention.mentionPayload({ owner: '', handle: '', storyMention: { enabled: true } }), {})
})
