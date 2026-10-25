// 从 app.asar 里按文件名搜包，把命中的文件写到 .tmp/asar/（只用于排查工具 schema 生成逻辑）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ASAR = 'D:/Space/Tools/Deepseek/resources/app.asar'
const OUT = '.tmp/asar'
const buf = readFileSync(ASAR)
// asar 头：偏移 0 = 4（pickle 长度），偏移 4 = 头 pickle 的字节数 N，
// 偏移 8..8+N = [uint32 jsonLen][json]；文件数据从 8+N 开始（4 字节对齐）。
const headerPickleSize = buf.readUInt32LE(4)
const header = JSON.parse(buf.subarray(16, 8 + headerPickleSize).toString('utf8'))
const base = 8 + headerPickleSize

const files = new Map() // path -> {offset, size}
function walk(node, prefix) {
  for (const [name, info] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name
    if (info.files) walk(info, p)
    else if (info.size !== undefined) files.set(p, info)
  }
}
walk(header, '')

const want = process.argv.slice(2)
let n = 0
for (const [path, info] of files) {
  if (!want.some((w) => path.includes(w))) continue
  if (!/\.(mjs|js|cjs|json)$/.test(path)) continue
  const dest = join(OUT, path.replace(/[:<>|"]/g, '_'))
  mkdirSync(dirname(dest), { recursive: true })
  const data = buf.subarray(base + Number(info.offset), base + Number(info.offset) + Number(info.size))
  writeFileSync(dest, data)
  console.log(`${path}  ${data.length}B  -> ${dest}`)
  n++
}
console.log(`total entries=${files.size}, dumped=${n}`)
