// apply() 的端到端形状测试：用假 ctx 跑一遍插件，把注册的工具/路由全部捞出来检查。
//
// 这条测试就是 2026-10-25 那次事故的兜底：用户在开启插件后每条消息都报
//   Invalid schema for function 'ig_config': schema must be a JSON Schema of
//   'type: "object"', got 'type: null'
// 因为 ctx.tools.register() 不归一化 parameters，而 provider 会拒绝类型为 null 的 schema。
// 只要这里全绿，工具列表在真实 DSH 里就是合法的。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

function fakeCtx() {
  const tools = []
  const routes = []
  const disposers = []
  const ctx = {
    effect(fn) { const d = fn(); disposers.push(typeof d === 'function' ? d : () => {}); return () => {} },
    get: () => null,
    interval: () => () => {},
    tools: { register: (def) => { tools.push(def); return () => {} } },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
  }
  return { ctx, tools, routes, disposers }
}

test('apply() registers every tool with an object-rooted parameters schema', () => {
  const { ctx, tools, routes } = fakeCtx()
  apply(ctx, { enabled: true })

  assert.ok(tools.length >= 7, `expected at least 7 tools, got ${tools.length}`)
  assert.ok(routes.length >= 1, 'web routes registered')

  for (const def of tools) {
    assert.equal(typeof def.name, 'string')
    assert.ok(def.name.startsWith('ig_'), `unexpected tool ${def.name}`)
    assert.equal(def.parameters?.type, 'object', `${def.name}: parameters.type must be "object" (provider rejects null)`)
    assert.equal(typeof def.parameters.properties, 'object', `${def.name}: parameters.properties must be an object`)
    assert.equal(def.output?.schema?.type, 'object', `${def.name}: output.schema.type must be "object"`)
    assert.equal(typeof def.output.render, 'function', `${def.name}: output.render must be a function`)
    assert.equal(typeof def.execute, 'function', `${def.name}: execute must be a function`)
  }

  const names = tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['ig_config', 'ig_draft', 'ig_login', 'ig_persona', 'ig_plan', 'ig_publish', 'ig_run', 'ig_stats', 'ig_status'])
})

test('apply() tolerates a missing config object', () => {
  const { ctx, tools } = fakeCtx()
  apply(ctx, undefined)
  for (const def of tools) assert.equal(def.parameters.type, 'object')
})
