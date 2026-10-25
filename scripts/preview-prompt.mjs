// 肉眼确认「要回的那条」真的进了提示词。
// 用法：node scripts/preview-prompt.mjs "[dm] 查看你最近的运行日志"
//       第一段 [dm]/[group] 选场景，后面的都是对方刚发的那条。
import { groupPrompt } from '../lib/persona.mjs';

const raw = process.argv.slice(2).join(' ') || '查看你最近的运行日志';
const m = raw.match(/^\[(dm|group)\]\s*([\s\S]*)$/i);
const scene = m ? m[1].toLowerCase() : 'dm';
const incoming = m ? m[2] : raw;

const cfg = { owner: 'ez4p1xel', username: 'imnotp1xel', assistantName: '小 p' };
const history = scene === 'dm'
  ? [{ from: 'ez4p1xel', text: '在吗' }, { from: '我', text: '在的，刚看到你这条。' }]
  : [{ from: 'ez4p1xel', text: '查看你最近的运行日志' }, { from: '我', text: '运行时间这个我不往外报。' }, { from: 'ez4p1xel', text: '抽耳機' }];

const { system, user } = groupPrompt({ cfg, persona: { memories: [] }, history, incoming, scene, sender: 'ez4p1xel', title: scene === 'dm' ? '私信（主人）' : 'Matthew Chan, …' });

console.log('── system ──');
console.log(system);
console.log('\n── user ──');
console.log(user);
console.log('\n[检查] 要回的那条出现在 user 里：', user.includes(incoming));
