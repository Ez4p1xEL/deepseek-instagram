// Dev probe: inspect DSH session logs layout + event types + usage accounting file.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const HOME = 'C:/Users/Ez4p1/.dsh';
const SESS = path.join(HOME, 'sessions');

function walk(dir, depth = 0, out = []) {
  if (depth > 3) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { out.push({ p, dir: true }); walk(p, depth + 1, out); }
    else out.push({ p, dir: false, size: fs.statSync(p).size });
  }
  return out;
}

const all = walk(SESS);
const files = all.filter((x) => !x.dir);
console.log('session dirs:', all.filter((x) => x.dir).map((x) => path.relative(SESS, x.p)).slice(0, 20));
console.log('total files:', files.length, 'total bytes:', files.reduce((a, b) => a + b.size, 0));
const byExt = {};
for (const f of files) { const e = path.extname(f.p); byExt[e] = (byExt[e] || 0) + 1; }
console.log('by ext:', byExt);
console.log('sample files:', files.slice(0, 6).map((f) => [path.relative(SESS, f.p), f.size]));

function readJsonl(p) {
  const buf = fs.readFileSync(p);
  let text;
  if (p.endsWith('.zstd')) {
    const out = zlib.zstdDecompressSync(buf);
    text = out.toString('utf8');
  } else {
    text = buf.toString('utf8');
  }
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { bad: l.slice(0, 80) }; } });
}

// pick the 3 largest files
const big = [...files].sort((a, b) => b.size - a.size).slice(0, 3);
for (const f of big) {
  const rel = path.relative(SESS, f.p);
  try {
    const rows = readJsonl(f.p);
    const types = {};
    for (const r of rows) types[r.type || 'no-type'] = (types[r.type || 'no-type'] || 0) + 1;
    console.log('\n=== ', rel, 'size', f.size, 'lines', rows.length);
    console.log('first line:', JSON.stringify(rows[0]).slice(0, 600));
    console.log('types:', JSON.stringify(types, null, 0));
    console.log('last time:', new Date(rows[rows.length - 1]?.time || 0).toISOString());
    // sample one row per uncommon type
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.type) || ['message/user', 'message/assistant'].includes(r.type)) continue;
      seen.add(r.type);
      console.log('  sample', r.type, '=>', JSON.stringify(r.data).slice(0, 350));
      if (seen.size > 12) break;
    }
  } catch (e) {
    console.log('\n=== ', rel, 'ERROR', e.message);
  }
}

const usagePath = path.join(HOME, '.dshw-usage.json');
if (fs.existsSync(usagePath)) {
  const u = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
  console.log('\n=== usage file top keys:', Object.keys(u));
  const s = JSON.stringify(u);
  console.log('usage head:', s.slice(0, 1200));
}
