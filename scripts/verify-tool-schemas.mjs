// 用 DSH 宿主真实的 schema 校验器（从 app.asar 抽出来的 dsh-tools）检查本插件注册的工具定义。
// 不是单测的一部分（.tmp 不进版本库），只是"上线前拿真尺子量一下"。
import { assertObjectJsonSchema, assertSupportedJsonSchema } from '../.tmp/asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'

const { apply } = await import('./index.js')

const tools = []
const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  get: () => null,
  interval: () => () => {},
  tools: { register: (def) => { tools.push(def); return () => {} } },
  webServer: { register: () => () => {} },
}
apply(ctx, { enabled: true })

let bad = 0
for (const def of tools) {
  try {
    assertObjectJsonSchema(def.parameters, 'parameters')
    assertSupportedJsonSchema(def.output.schema)
    const props = Object.keys(def.parameters.properties || {})
    console.log(`ok   ${def.name.padEnd(12)} properties=[${props.join(',')}]`)
  } catch (e) {
    bad++
    console.log(`FAIL ${def.name}: ${e.message}`)
  }
}
console.log(`\n${tools.length} tools, ${bad} invalid`)
process.exitCode = bad ? 1 : 0
