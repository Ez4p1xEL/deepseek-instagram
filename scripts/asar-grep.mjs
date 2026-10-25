// 在 app.asar 的原始字节里搜字符串，并把命中位置映射回包内文件路径。
// 用法: node scripts/asar-grep.mjs tool_addition [更多关键词...]
import { readFileSync } from 'node:fs'

const ASAR = 'D:/Space/Tools/Deepseek/resources/app.asar'
const buf = readFileSync(ASAR)
const headerPickleSize = buf.readUInt32LE(4)
const header = JSON.parse(buf.subarray(16, 8 + headerPickleSize).toString('utf8'))
const base = 8 + headerPickleSize

const entries = [] // {path, start, end}
function walk(node, prefix) {
  for (const [name, info] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name
    if (info.files) walk(info, p)
    else if (info.size !== undefined) {
      const start = base + Number(info.offset)
      entries.push({ path: p, start, end: start + Number(info.size) })
    }
  }
}
walk(header, '')
entries.sort((a, b) => a.start - b.start)

const owner = (pos) => {
  let lo = 0
  let hi = entries.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const e = entries[mid]
    if (pos < e.start) hi = mid - 1
    else if (pos >= e.end) lo = mid + 1
    else return e
  }
  return null
}

for (const needle of process.argv.slice(2)) {
  const bytes = Buffer.from(needle, 'utf8')
  let pos = 0
  let hits = 0
  while ((pos = buf.indexOf(bytes, pos)) !== -1) {
    const e = owner(pos)
    if (e && /\.(mjs|js|cjs)$/.test(e.path)) {
      const from = Math.max(e.start, pos - 160)
      const to = Math.min(e.end, pos + 200)
      const ctx = buf.subarray(from, to).toString('utf8').replace(/\s+/g, ' ')
      console.log(`\n[${needle}] ${e.path} @${pos - e.start}\n  …${ctx}…`)
      hits += 1
    }
    pos += bytes.length
  }
  console.log(`\n[${needle}] 命中 ${hits} 处（仅 js/mjs）`)
}
