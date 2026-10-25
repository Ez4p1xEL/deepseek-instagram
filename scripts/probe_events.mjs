// Dev probe 2: inspect session event payload shapes (tokens/cost/model) and timing.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SESS = 'C:/Users/Ez4p1/.dsh/sessions';

function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (p.endsWith('.jsonl.zstd')) out.push(p);
  }
  return out;
}

const files = listFiles(SESS).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
const target = files[0];
console.log('file:', target);
const rows = zlib.zstdDecompressSync(fs.readFileSync(target)).toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
console.log('rows:', rows.length);

const wanted = ['session', 'user/message', 'assistant/message', 'request/header', 'step/end', 'turn/end', 'tool/call', 'agent/inbox/spliced', 'session/title', 'model/selection'];
const shown = {};
for (const r of rows) {
  if (!wanted.includes(r.type)) continue;
  shown[r.type] = (shown[r.type] || 0) + 1;
  if (shown[r.type] <= 2) {
    const s = JSON.stringify(r);
    console.log('\n--- ' + r.type + ' keys=' + JSON.stringify(Object.keys(r.data || {})) + ' len=' + s.length);
    console.log(s.slice(0, 1400));
  }
}

// tokens anywhere?
const hits = rows.filter((r) => /token|usage|cost|price|cny|spend/i.test(JSON.stringify(r))).slice(0, 5);
console.log('\n=== rows mentioning token/usage/cost:', hits.length);
for (const h of hits) console.log(JSON.stringify(h).slice(0, 800));

// event time span and gaps analysis
const times = rows.map((r) => r.time).filter((t) => typeof t === 'number').sort((a, b) => a - b);
console.log('\ntime span:', new Date(times[0]).toISOString(), '->', new Date(times[times.length - 1]).toISOString(), 'events', times.length);
let gaps = [];
for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
gaps.sort((a, b) => b - a);
console.log('top gaps (min):', gaps.slice(0, 8).map((g) => Math.round(g / 60000)));
