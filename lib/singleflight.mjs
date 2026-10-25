/**
 * 单飞闸：同一条异步任务同时只允许跑一轮，后来的直接拿 `{skipped:'busy'}`。
 *
 * 为什么要这个：dmPoll 会被三处同时调用（tick 定时器、POST /api/deepseek-instagram/dm、
 * 登录回调）。它「每条消息只处理一次」靠的是 dm-state.json 里的 lastHandledTs，
 * 而这个水位只有在整轮轮询（含调用模型、发私信）跑完才落盘 ——
 * 两轮并发时它们读到同一个起点，于是同一条消息被回两遍：
 * 一遍模型生成的，一遍兜底句（2026-10-25 的日志里 22:14:14 和 22:14:20 就是这么来的）。
 *
 * 注意：只管同一个进程内的并发；Host 重启后状态自然清零。
 * 异常必须释放闸（finally），否则之后每一轮都会被跳过 —— 那比重复回复更糟。
 *
 * @returns {<T>(fn: () => Promise<T>) => Promise<T | {ok:true, skipped:'busy'}>}
 */
export function singleFlight() {
  let busy = false;
  return async function run(fn) {
    if (busy) return { ok: true, skipped: 'busy' };
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };
}
