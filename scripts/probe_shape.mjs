// Dev probe: exact DSH session-event shapes we depend on (header, message events, usage).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const HOME = 'C:/Users/Ez4p1/.dsh/sessions';

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (p.endsWith('.jsonl.zstd') || p.endsWith('.jsonl')) out.push({ p, size: fs.statSync(p).size });
  }
  return out;
}

function rows(p) {
  const buf = fs.readFileSync(p);
  const text = p.endsWith('.zstd') ? zlib.zstdDecompressSync(buf).toString('utf8') : buf.toString('utf8');
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { bad: true }; } });
}

const all = files(HOME).sort((a, b) => b.size - a.size);
console.log('files', all.length);
const target = all[0];
const rs = rows(target.p);
console.log('file', path.relative(HOME, target.p), 'lines', rs.length);
console.log('HEADER', JSON.stringify(rs[0]));
console.log('LINE2', JSON.stringify(rs[1]).slice(0, 1500));

const types = new Map();
for (const r of rs) types.set(r.type, (types.get(r.type) || 0) + 1);
console.log('TYPES', JSON.stringify([...types.entries()].sort((a, b) => b[1] - a[1])));

const wanted = ['user/message', 'assistant/message', 'assistant/usage', 'turn/start', 'turn/end', 'session/created'];
for (const w of wanted) {
  const r = rs.find((x) => x.type === w);
  console.log('\nROW', w, ':', r ? JSON.stringify(r).slice(0, 1400) : '(absent)');
}
