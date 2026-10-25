// 从 app.asar 里按路径子串导出任意文本文件（官方 skill / 内置插件源码等）。
// 用法: node scripts/asar-extract.mjs <路径子串> [更多子串...]
// 输出目录 .tmp/asar/（保留包内相对路径），每个命中文件单独打印。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ASAR = 'D:/Space/Tools/Deepseek/resources/app.asar'
const OUT = '.tmp/asar'
const buf = readFileSync(ASAR)
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

const TEXT = /\.(md|mjs|js|cjs|json|yml|yaml|txt|ts)$/i
const want = process.argv.slice(2)
let n = 0
for (const [path, info] of files) {
  if (!want.some((w) => path.includes(w))) continue
  if (!TEXT.test(path)) continue
  const dest = join(OUT, path.replace(/[:<>|"]/g, '_'))
  mkdirSync(dirname(dest), { recursive: true })
  const data = buf.subarray(base + Number(info.offset), base + Number(info.offset) + Number(info.size))
  writeFileSync(dest, data)
  console.log(`${path}  ${data.length}B  -> ${dest}`)
  n++
}
console.log(`total entries=${files.size}, dumped=${n}`)
