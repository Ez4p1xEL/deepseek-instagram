/**
 * deepseek-instagram —— 浏览器半端（设置页）
 *
 * client bundle 不是 ESM，是自注册脚本：window.__ModuleLoader__.load({id, factory})。
 * factory 里只 require('react')，不碰任何 @deepseek-ai/* 包。
 * 所有 Host 交互走 /api/deepseek-instagram/*（同源 fetch，必须检查 res.ok）。
 */
window.__ModuleLoader__.load({
  id: 'deepseek-instagram',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const API = '/api/deepseek-instagram';

    const asJson = async (res) => {
      if (res.ok) return res.json();
      let detail = '';
      try { detail = (await res.json())?.error || ''; } catch { /* noop */ }
      const why = res.status === 401 ? '（未登录）' : res.status === 403 ? '（宿主拦了）' : '';
      throw new Error(`HTTP ${res.status}${why}${detail ? `：${detail}` : ''}`);
    };
    // 注意：asJson 收到的是 Response，不是 Promise —— fetch 必须先 await。
    // 少写这个 await 会让 res.ok/res.status 全是 undefined，设置页一律报「读取失败：HTTP undefined」。
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }));
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }));

    const CSS = `
[data-ig-page]{display:flex;flex-direction:column;gap:18px;max-width:680px;padding:2px 2px 24px}
[data-ig-card]{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.08))}
[data-ig-h]{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--dsw-alias-label-tertiary,#9aa0a6)}
[data-ig-row]{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
[data-ig-label]{font-size:13px;color:inherit}
[data-ig-note]{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#9aa0a6);white-space:pre-wrap}
[data-ig-input],[data-ig-textarea]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:inherit;font-family:inherit}
[data-ig-textarea]{min-height:58px;resize:vertical}
[data-ig-btn]{padding:7px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:inherit}
[data-ig-btn]:disabled{opacity:.5;cursor:default}
[data-ig-btn][data-primary]{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff}
[data-ig-badge]{font-size:10px;padding:2px 8px;border-radius:999px;border:1px solid currentColor;opacity:.9}
[data-ig-ok]{color:var(--dsw-alias-state-success,#3fb950)}
[data-ig-err]{color:var(--dsw-alias-state-error,#f85149)}
[data-ig-warn]{color:var(--dsw-alias-state-warning,#d29922)}
[data-ig-pre]{white-space:pre-wrap;font-size:11px;line-height:16px;max-height:200px;overflow:auto;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.10));border-radius:8px;padding:10px;margin:0}
[data-ig-img]{width:100%;border-radius:12px;display:block;background:rgba(0,0,0,.2)}
[data-ig-grid]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
[data-ig-stat]{display:flex;flex-direction:column;gap:2px}
[data-ig-big]{font-size:20px;font-weight:600}
[data-ig-slot]{display:flex;align-items:center;gap:10px;font-size:12px}
[data-ig-dot]{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#9aa0a6);flex:none}
[data-ig-dot][data-published]{background:var(--dsw-alias-state-success,#3fb950)}
[data-ig-dot][data-due]{background:var(--dsw-alias-state-warning,#d29922)}
[data-ig-dot][data-failed]{background:var(--dsw-alias-state-error,#f85149)}
[data-ig-details] summary{cursor:pointer;font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6)}
`;

    const Field = ({ label, children }) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
      h('div', { 'data-ig-label': '' }, label),
      children);

    const Switch = ({ checked, onChange, label }) => h('div', { 'data-ig-row': '' },
      h('div', { 'data-ig-label': '' }, label),
      h('input', { type: 'checkbox', checked: !!checked, onChange: (e) => onChange(e.target.checked) }));

    const Stat = ({ label, value }) => h('div', { 'data-ig-stat': '' },
      h('div', { 'data-ig-note': '' }, label),
      h('div', { 'data-ig-big': '' }, value));

    const SlotRow = ({ slot }) => h('div', { 'data-ig-slot': '' },
      h('span', { 'data-ig-dot': '', [`data-${slot.status}`]: '' }),
      h('span', {}, slot.clock),
      h('span', { 'data-ig-note': '' }, slot.kindLabel),
      h('span', { 'data-ig-note': '', style: { marginLeft: 'auto' } },
        slot.status === 'published' ? '已发' : slot.status === 'due' ? '到点' : slot.status === 'missed' ? '错过' : slot.status === 'failed' ? '失败' : ''));

    function minutesText(minutes) {
      const m = Math.max(0, Math.round(Number(minutes) || 0));
      if (m < 60) return `${m} 分钟`;
      const hh = Math.floor(m / 60);
      const rest = m % 60;
      return rest ? `${hh} 小时 ${rest} 分` : `${hh} 小时`;
    }

    function fmtTokens(n) {
      const v = Math.max(0, Number(n) || 0);
      if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
      if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
      return v.toLocaleString();
    }

    // 用量卡片里各类调用的中文名（Host 侧 recordSpend 的 kind）
    const SPEND_KINDS = { story: 'Story', note: 'Note', dm: '私信', group: '群聊', stranger: '陌生人', intent: '指令识别', share: '分享', other: '其他' };

    function Panel() {
      const [st, setSt] = React.useState(null);
      const [err, setErr] = React.useState('');
      const [msg, setMsg] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [form, setForm] = React.useState(null);
      const [sessionid, setSessionid] = React.useState('');
      const [personaMd, setPersonaMd] = React.useState('');
      const [personaMdPath, setPersonaMdPath] = React.useState('');
      const [groups, setGroups] = React.useState(null);

      const applyState = (next) => {
        setSt(next);
        setForm((prev) => prev || {
          mode: next.cfg.mode,
          tone: next.cfg.tone,
          handle: next.cfg.handle,
          lifeNote: next.cfg.lifeNote,
          noteTime: next.cfg.noteTime,
          useLlm: next.cfg.useLlm,
          enabled: next.cfg.enabled,
          paused: next.cfg.safety.paused,
          storyCap: next.cfg.safety.storyCap,
          minIntervalMinutes: next.cfg.safety.minIntervalMinutes,
          quietStart: next.cfg.safety.quietStart,
          quietEnd: next.cfg.safety.quietEnd,
          storiesPerDay: next.cfg.storiesPerDay,
          dayStart: next.cfg.dayStart,
          dayEnd: next.cfg.dayEnd,
          owner: next.cfg.owner,
          dmEnabled: next.cfg.dm.enabled,
          dmReply: next.cfg.dm.dailyReplies,
          autoReply: next.cfg.dm?.autoReply || 'off',
          notifyOwner: next.cfg.dm?.notifyOwner !== false,
          remoteControl: next.cfg.dm?.intents !== false,
          readShares: next.cfg.dm?.readShares !== false,
          shareOpinion: next.cfg.dm?.shareOpinion !== false,
          dmCooldownS: next.cfg.dm?.cooldownSeconds ?? 30,
          fullAccess: next.cfg.dm?.fullAccess === true,
          publishStory: next.cfg.publish?.story !== false,
          publishNote: next.cfg.publish?.note !== false,
          personaName: next.persona?.name || '',
          personaMood: next.persona?.mood?.label || '',
          personaIdentity: next.persona?.identity || '',
          groupEnabled: next.cfg.group?.enabled !== false,
          groupMode: next.cfg.group?.mode || 'mention',
          groupCooldown: next.cfg.group?.cooldownSeconds ?? 90,
          groupHourly: next.cfg.group?.hourlyCap ?? 8,
          mentionEnabled: next.cfg.storyMention?.enabled !== false,
          mentionX: next.cfg.storyMention?.x ?? 0.5,
          mentionY: next.cfg.storyMention?.y ?? 0.86,
          mentionWidth: next.cfg.storyMention?.width ?? 0.5,
          mentionHeight: next.cfg.storyMention?.height ?? 0.09,
        });
      };

      const reload = React.useCallback(async () => {
        try {
          const next = await jget('/state');
          applyState(next);
          setErr('');
        } catch (e) { setErr(String(e.message || e)); }
      }, []);

      React.useEffect(() => { reload(); }, [reload]);

      // persona.md 不走 /state（可能很长），单独取一次
      React.useEffect(() => {
        jget('/persona-md')
          .then((out) => { setPersonaMd(out.md || ''); setPersonaMdPath(out.path || ''); })
          .catch((e) => setErr(String(e.message || e)));
      }, []);

      // 安装中 / 发布中：2 秒轮询一次
      React.useEffect(() => {
        if (!st?.installing) return undefined;
        const timer = setInterval(() => { reload(); }, 2000);
        return () => clearInterval(timer);
      }, [st?.installing, reload]);

      const act = async (key, fn) => {
        setBusy(key); setMsg(''); setErr('');
        try {
          const out = await fn();
          if (out && out.results) {
            // 发布是「逐类」的：先把每一类的结果摊开，别再用一句「操作失败」糊过去。
            const parts = Object.entries(out.results).map(([k, v]) => `${k}:${v.ok
              ? (v.skipped ? `跳过（${v.skipped}）` : '成功')
              : (v.error || v.code || '失败')}`);
            if (out.ok) setMsg(parts.join(' · '));
            else setErr(parts.join(' · '));
          } else if (out && out.ok === false) {
            setErr(out.error || out.code || '操作失败');
          } else if (out && out.piece) {
            setMsg(`预览已生成：${out.target?.clock || ''} ${out.piece.text.slice(0, 24)}…`);
          } else {
            setMsg('完成');
          }
          await reload();
        } catch (e) {
          setErr(String(e.message || e));
        } finally { setBusy(''); }
      };

      if (!st) {
        return h('div', { 'data-ig-page': '' },
          h('div', { 'data-ig-note': '' }, err ? `读取失败：${err}` : '读取中…'));
      }
      if (!form) return h('div', { 'data-ig-page': '' }, h('div', { 'data-ig-note': '' }, '初始化…'));

      // 用函数式更新：连续快速输入时不要用渲染时的旧 form 覆盖别的字段
      const flip = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));
      const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target ? e.target.value : e }));

      // ── 分区保存：每个卡片只提交自己那部分（/config 深合并，不会动别的字段） ──
      const cooldownSeconds = () => (Number.isFinite(Number(form.dmCooldownS))
        ? Math.min(3600, Math.max(0, Math.round(Number(form.dmCooldownS)))) : 30);

      const patchFeatures = () => ({
        publish: { story: form.publishStory, note: form.publishNote },
        dm: {
          autoReply: form.autoReply, notifyOwner: form.notifyOwner, intents: form.remoteControl,
          readShares: form.readShares, shareOpinion: form.shareOpinion,
        },
        group: { enabled: form.groupEnabled },
      });
      const patchDm = () => ({
        owner: form.owner,
        dm: {
          enabled: form.dmEnabled,
          dailyReplies: Number(form.dmReply) || 30,
          cooldownSeconds: cooldownSeconds(),
          fullAccess: form.fullAccess === true,
        },
      });
      const patchGroup = () => ({
        group: {
          enabled: form.groupEnabled, mode: form.groupMode,
          cooldownSeconds: Number(form.groupCooldown) || 90, hourlyCap: Number(form.groupHourly) || 8,
        },
      });
      const patchMention = () => ({
        storyMention: {
          enabled: form.mentionEnabled,
          x: Number(form.mentionX), y: Number(form.mentionY),
          width: Number(form.mentionWidth), height: Number(form.mentionHeight),
        },
      });
      const patchContent = () => ({
        mode: form.mode, tone: form.tone, handle: form.handle, lifeNote: form.lifeNote,
        noteTime: form.noteTime, useLlm: form.useLlm, enabled: form.enabled,
        storiesPerDay: Number(form.storiesPerDay) || 10,
        dayStart: form.dayStart, dayEnd: form.dayEnd,
      });
      const patchSafety = () => ({
        safety: {
          paused: form.paused, storyCap: Number(form.storyCap) || 14,
          minIntervalMinutes: Number(form.minIntervalMinutes) || 0,
          quietStart: form.quietStart, quietEnd: form.quietEnd,
        },
      });
      const saveSection = (key, patch) => act(key, () => jpost('/config', patch));

      // 人格卡这一区同时保存 persona.md 与「名字 / 心情」；
      // 以前「保存人格卡」只提交 md，名字改了却没提交 —— 现在合成一个按钮。
      const savePersonaCard = () => act('persona', async () => {
        const md = await jpost('/persona-md', { md: personaMd });
        if (md.ok) setPersonaMd(md.md || '');
        const who = await jpost('/persona', { name: form.personaName, mood: form.personaMood, identity: form.personaIdentity });
        return { ok: !!(md.ok && who.ok), error: md.error || who.error, persona: who.persona };
      });

      const SaveBar = ({ k, label, onSave, note }) => h('div', { 'data-ig-row': '' },
        h('button', { 'data-ig-btn': '', 'data-primary': '', 'data-ig-save': k, disabled: busy === k, onClick: onSave },
          busy === k ? '保存中…' : (label || '保存本区')),
        note ? h('span', { 'data-ig-note': '' }, note) : null);

      const accountLabel = st.loggedIn
        ? `@${st.account?.username || st.cfg.username || '已登录'}`
        : '未登录';
      const preview = st.preview;
      const story = preview?.story;
      const plan = st.plan;
      const stats = st.stats;
      const spend = st.assistant || {};
      const today = st.today || { published: [], failed: [] };

      return h('div', { 'data-ig-page': '' },

        // ── 状态 ───────────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-row': '' },
            h('div', { 'data-ig-h': '' }, 'Instagram 助理'),
            h('span', { 'data-ig-badge': '', 'data-ig-ok': st.cfg.enabled ? '' : undefined }, st.cfg.enabled ? '运行中' : '已关闭')),
          h('div', { 'data-ig-row': '' },
            h('span', { 'data-ig-label': '' }, `账号：${accountLabel}`),
            h('span', { 'data-ig-label': '', 'data-ig-note': '' }, st.cfg.mode === 'auto' ? '全自动' : '草稿确认（只出预览）')),
          h('div', { 'data-ig-note': '' },
            `今天已发 ${plan.published}/${plan.count} 条 Story · 主人：${st.dm.owner ? `@${st.dm.owner}${st.dm.ownerPk ? '（已绑定）' : '（待绑定）'}` : '未设置'}`),
          h('div', { 'data-ig-note': '' }, `运行环境：${st.python.installed ? '已安装' : '未安装（请点下方「安装依赖」）'} · 家目录：${st.home}`),
          err ? h('div', { 'data-ig-note': '', 'data-ig-err': '' }, `⚠️ ${err}`) : null,
          msg ? h('div', { 'data-ig-note': '', 'data-ig-ok': '' }, `✅ ${msg}`) : null),

        // ── 今天的计划 ─────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-row': '' },
            h('div', { 'data-ig-h': '' }, `今天的 ${plan.count} 条`),
            h('span', { 'data-ig-note': '' }, `${plan.window.start}–${plan.window.end} · 剩 ${plan.remaining} 条`)),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            plan.slots.map((slot) => h(SlotRow, { key: slot.slot, slot }))),
          story ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 } },
            h('img', { 'data-ig-img': '', alt: 'story card', src: `${API}/card?day=${story.day || plan.day}&index=${story.index ?? 0}&ts=${preview.updatedAt || Date.now()}` }),
            h('div', { 'data-ig-note': '' }, `预览：${story.clock} ${story.kindLabel}${story.published ? '（已发布）' : ''}`),
            h(Field, { label: '这条的文案' }, h('div', { 'data-ig-note': '' }, story.text || '')),
            preview.note ? h(Field, { label: '配一条 Note（≤60 字符）' }, h('div', { 'data-ig-note': '' }, preview.note.text || '')) : null)
            : h('div', { 'data-ig-note': '' }, '还没有预览。点「生成预览」（草稿模式不会发布）。'),
          h('div', { 'data-ig-row': '' },
            h('button', { 'data-ig-btn': '', 'data-primary': '', disabled: busy === 'draft', onClick: () => act('draft', () => jpost('/draft', {})) },
              busy === 'draft' ? '生成中…' : '生成预览'),
            h('button', { 'data-ig-btn': '', disabled: busy === 'publish', onClick: () => act('publish', () => jpost('/publish', { kind: 'all' })) },
              busy === 'publish' ? '发布中…' : '发布这条'),
            h('button', { 'data-ig-btn': '', disabled: busy === 'run', onClick: () => act('run', () => jpost('/run', {})) },
              busy === 'run' ? '执行中…' : '立刻跑一轮')),
          h('div', { 'data-ig-note': '' }, `今天已发：${today.published.map((p) => `${p.detail?.clock || ''}${p.kind}`).join(' / ') || '无'}${today.failed.length ? ` · 失败 ${today.failed.length} 条` : ''}`)),

        // ── 人格卡 persona.md ─────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-row': '' },
            h('div', { 'data-ig-h': '' }, '人格卡 persona.md'),
            h('span', { 'data-ig-note': '' }, `${personaMd.length} 字`)),
          h('div', { 'data-ig-note': '' }, '她是「小 p」：一个住在 DSH 里的助理。这张卡决定她怎么说话、怎么写故事、什么不做；写作时优先于下面的旧字段。'),
          h('textarea', {
            'data-ig-textarea': '', style: { minHeight: 220, fontFamily: 'ui-monospace, monospace', lineHeight: 1.6 },
            value: personaMd, onChange: (e) => setPersonaMd(e.target.value),
          }),
          h('div', { 'data-ig-note': '' }, personaMdPath ? `文件：${personaMdPath}` : ''),
          h('div', { 'data-ig-grid': '' },
            h(Field, { label: '名字' },
              h('input', { 'data-ig-input': '', value: form.personaName, onChange: set('personaName') })),
            h(Field, { label: '现在的心情（会自己变）' },
              h('input', { 'data-ig-input': '', value: form.personaMood, onChange: set('personaMood') }))),
          h('div', { 'data-ig-note': '' },
            `最近的记忆：${(st.persona.memories || []).map((m) => m.text).join('；') || '还没有'} · 进行中的事：${(st.persona.threads || []).map((t) => t.text).join('；') || '无'}`),
          h(SaveBar, { k: 'persona', label: '保存人格卡（含名字 / 心情）', onSave: savePersonaCard,
            note: '名字、心情与人格卡一起提交' })),

        // ── 功能开关 ───────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-h': '' }, '功能开关'),
          h('div', { 'data-ig-note': '' }, '这些开关只拦自动执行；手动点「发布/预览」、私信里的短指令（状态/暂停/发一条/帮助）不受影响。'),
          h(Field, { label: '别人的私信：要自动回复吗' },
            h('select', { 'data-ig-input': '', value: form.autoReply, onChange: set('autoReply') },
              h('option', { value: 'off' }, '不回复'),
              h('option', { value: 'all' }, '所有人都回复'),
              h('option', { value: 'mutual' }, '仅互关回复'),
              h('option', { value: 'follower' }, '未被关注不回复（对方关注我就回）'))),
          h(Switch, { label: '收到别人的私信时，私信提醒主人', checked: form.notifyOwner, onChange: flip('notifyOwner') }),
          h(Switch, { label: '在群聊中回复别人的消息', checked: form.groupEnabled, onChange: flip('groupEnabled') }),
          h(Switch, { label: '自动发布 Story', checked: form.publishStory, onChange: flip('publishStory') }),
          h(Switch, { label: '自动发布 Note', checked: form.publishNote, onChange: flip('publishNote') }),
          h(Switch, { label: '私信远程控制（允许主人用自然语言让本机干活）', checked: form.remoteControl, onChange: flip('remoteControl') }),
          h(Switch, { label: '读取主人分享的 Post / Reels（读懂内容再回）', checked: form.readShares, onChange: flip('readShares') }),
          h(Switch, { label: '读懂分享后，说一句自己的感想', checked: form.shareOpinion, onChange: flip('shareOpinion') }),
          h('div', { 'data-ig-note': '' },
            '关掉 Story/Note 只是不再自动排期，手动「发布/预览」仍可用；关掉远程控制后，私信里的自然语言指令（回未读私信、让本机跑任务）不再执行。'),
          h(SaveBar, { k: 'features', onSave: () => saveSection('features', patchFeatures()) })),

        // ── 主人 & 私信 ────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-h': '' }, '主人与私信'),
          h('div', { 'data-ig-note': '' }, '只有主人账号的私信会被当成指令执行；别人的消息永远不会执行指令，是否自动回复见上面「功能开关」。'),
          h(Field, { label: '主人的 IG 用户名（不带 @）' },
            h('input', { 'data-ig-input': '', value: form.owner, placeholder: 'ez4p1xel', onChange: set('owner') })),
          h(Switch, { label: '接受主人的私信指令', checked: form.dmEnabled, onChange: flip('dmEnabled') }),
          h(Field, { label: '每天最多回几条' },
            h('input', { 'data-ig-input': '', type: 'number', min: 1, value: form.dmReply, onChange: set('dmReply') })),
          h(Field, { label: '同一个私信会话的回复冷却（秒，默认 30）' },
            h('input', { 'data-ig-input': '', type: 'number', min: 0, max: 3600, value: form.dmCooldownS, onChange: set('dmCooldownS') })),
          h('div', { 'data-ig-note': '' }, '冷却按会话算：同一会话里两次回复至少隔这么久，别的会话不受影响；填 0 表示不冷却。短指令（状态/暂停/发一条/帮助）不受影响。'),
          h(Switch, { label: '完全权限：让电脑干活时不再询问', checked: form.fullAccess, onChange: flip('fullAccess') }),
          h('div', { 'data-ig-note': '' },
            '打开后，主人私信里「在本机跑命令 / 让本机 DSH 跑任务」这两类会直接开始执行，不再先给草稿等「发」；每次仍会回一条「已开始 + 命令」，跑完把结果发你。对外发消息（回未读私信）仍然要确认。'),
          h('div', { 'data-ig-row': '' },
            h('button', { 'data-ig-btn': '', 'data-primary': '', disabled: busy === 'owner', onClick: () => act('owner', () => jpost('/owner', { owner: form.owner })) },
              busy === 'owner' ? '绑定中…' : '绑定主人'),
            h('button', { 'data-ig-btn': '', disabled: busy === 'dm', onClick: () => act('dm', () => jpost('/dm', {})) },
              busy === 'dm' ? '检查中…' : '现在检查私信')),
          h('div', { 'data-ig-note': '' },
            `私信：${st.dm.enabled ? '开启' : '关闭'} · 绑定 ${st.dm.ownerPk || '未绑定'} · 今天回过 ${st.dm.repliesToday} 条` +
            (st.dm.lastPollAt ? ` · 上次检查 ${new Date(st.dm.lastPollAt).toLocaleTimeString()}` : '') +
            (st.dm.lastError ? ` · 错误：${st.dm.lastError}` : '')),
          h('details', { 'data-ig-details': '' },
            h('summary', {}, '主人在私信里能发什么'),
            h('div', { 'data-ig-note': '' },
              '发「发布」或「send」：立刻发下一条到点的 Story；发「预览」或「preview」：只生成预览。\n' +
              '其它话会被当成聊天：小 p 会回一句，并把它当成主人今天的心情/生活素材记下来。\n' +
              '全部走同一套安全阀（暂停/上限/间隔/安静时段）。')),
          h(SaveBar, { k: 'dm', onSave: () => saveSection('dm', patchDm()),
            note: '用户名、私信开关、每日上限、会话冷却' })),

        // ── 群聊 ───────────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-row': '' },
            h('div', { 'data-ig-h': '' }, '群聊'),
            h('span', { 'data-ig-badge': '', 'data-ig-ok': form.groupEnabled ? '' : undefined }, form.groupEnabled ? '会聊天' : '不参与')),
          h('div', { 'data-ig-note': '' }, '只处理主人在的群；默认被 @ 或叫名字才回一句，群里的消息不会被当成指令执行。'),
          h(Switch, { label: '允许在群里聊天', checked: form.groupEnabled, onChange: flip('groupEnabled') }),
          h('div', { 'data-ig-grid': '' },
            h(Field, { label: '什么时候回' },
              h('select', { 'data-ig-input': '', value: form.groupMode, onChange: set('groupMode') },
                h('option', { value: 'mention' }, '@ 或叫名字才回'),
                h('option', { value: 'always' }, '群里每句都接'))),
            h(Field, { label: '同一群冷却（秒）' },
              h('input', { 'data-ig-input': '', type: 'number', min: 10, value: form.groupCooldown, onChange: set('groupCooldown') }))),
          h(Field, { label: '每小时最多回几条' },
            h('input', { 'data-ig-input': '', type: 'number', min: 1, value: form.groupHourly, onChange: set('groupHourly') })),
          h('div', { 'data-ig-row': '' },
            h('button', { 'data-ig-btn': '', disabled: busy === 'groups', onClick: () => act('groups', async () => {
              const out = await jget('/dm/threads');
              setGroups(out.items || []);
              return out;
            }) }, busy === 'groups' ? '读取中…' : '查看我的群')),
          groups ? h('div', { 'data-ig-note': '' },
            groups.length ? groups.map((g) => `${g.isGroup ? '👥' : '💬'} ${g.title || g.memberUsernames.join(', ')}${g.isGroup ? `（${g.memberUsernames.length} 人）` : ''}`).join('　') : '没有可显示的会话') : null,
          h(SaveBar, { k: 'group', onSave: () => saveSection('group', patchGroup()) })),

        // ── 每条 Story @ 主人 ──────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-row': '' },
            h('div', { 'data-ig-h': '' }, '每条 Story 都 @ 主人'),
            h('span', { 'data-ig-note': '' }, st.storyMention?.owner ? `@${st.storyMention.owner}` : '未设置主人')),
          h('div', { 'data-ig-note': '' }, '发布时会在图上加一个 @ 贴纸（instagrapi StoryMention），文案里也会带上 @。'),
          h(Switch, { label: '开启（推荐）', checked: form.mentionEnabled, onChange: flip('mentionEnabled') }),
          h('div', { 'data-ig-grid': '' },
            h(Field, { label: '位置 X（0-1）' }, h('input', { 'data-ig-input': '', type: 'number', step: '0.01', min: 0, max: 1, value: form.mentionX, onChange: set('mentionX') })),
            h(Field, { label: '位置 Y（0-1，越大越靠下）' }, h('input', { 'data-ig-input': '', type: 'number', step: '0.01', min: 0, max: 1, value: form.mentionY, onChange: set('mentionY') }))),
          h('div', { 'data-ig-grid': '' },
            h(Field, { label: '宽度（0-1）' }, h('input', { 'data-ig-input': '', type: 'number', step: '0.01', min: 0.05, max: 1, value: form.mentionWidth, onChange: set('mentionWidth') })),
            h(Field, { label: '高度（0-1）' }, h('input', { 'data-ig-input': '', type: 'number', step: '0.01', min: 0.03, max: 1, value: form.mentionHeight, onChange: set('mentionHeight') }))),
          h(SaveBar, { k: 'mention', onSave: () => saveSection('mention', patchMention()) })),

        // ── 登录 ───────────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-h': '' }, '登录'),
          h(Field, { label: '浏览器导出的 sessionid' },
            h('input', { 'data-ig-input': '', type: 'password', value: sessionid, placeholder: '粘贴 cookie 里的 sessionid',
              onChange: (e) => setSessionid(e.target.value) })),
          h('div', { 'data-ig-row': '' },
            h('button', { 'data-ig-btn': '', 'data-primary': '', disabled: busy === 'login' || !sessionid,
              onClick: () => act('login', () => jpost('/login', { sessionid })) },
              busy === 'login' ? '登录中…' : '登录'),
            h('button', { 'data-ig-btn': '', disabled: busy === 'whoami',
              onClick: () => act('whoami', () => jpost('/whoami', {})) }, '检查会话')),
          h('details', { 'data-ig-details': '' },
            h('summary', {}, '怎么拿到 sessionid？'),
            h('div', { 'data-ig-note': '' },
              '电脑浏览器登录 instagram.com → F12 → Application → Cookies → https://www.instagram.com → 复制 sessionid 的值。\n' +
              '只保存在本机插件家目录（session.json / credential.json），不会上传。用同一个 sessionid 登录后请勿在别处反复登出，否则会失效。'))),

        // ── 使用数据 ───────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-h': '' }, '今日 DSH 使用'),
          h('div', { 'data-ig-grid': '' },
            h(Stat, { label: '今日时长', value: minutesText(stats.todayMinutes) }),
            h(Stat, { label: '连续天数', value: `${stats.streakDays} 天` }),
            h(Stat, { label: '本周累计', value: minutesText(stats.weekMinutes) }),
            h(Stat, { label: '今日花费', value: `¥${Number(stats.todayCost || 0).toFixed(2)}` })),
          h('div', { 'data-ig-note': '' },
            `活跃时段：${(stats.peakHours || []).map((p) => `${p.hour}:00`).join(' / ') || '暂无'} · 今日 token ${Number(stats.todayTokens || 0).toLocaleString()} · 下次窗口：${st.nextWindow ? `${st.nextWindow.kind} ${st.nextWindow.time}（约 ${st.nextWindow.inMinutes} 分钟后）` : '未设置'}`)),

        // ── AI 助理用量 ────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-row': '' },
            h('div', { 'data-ig-h': '' }, 'AI 助理用量'),
            h('span', { 'data-ig-note': '' }, '官方价目表 + 峰谷价估算')),
          h('div', { 'data-ig-grid': '' },
            h(Stat, { label: '今日 token', value: fmtTokens(spend.today?.tokens) }),
            h(Stat, { label: '今日花费', value: `¥${Number(spend.today?.cost || 0).toFixed(3)}` }),
            h(Stat, { label: '近 7 天 token', value: fmtTokens(spend.week?.tokens) }),
            h(Stat, { label: '近 7 天花费', value: `¥${Number(spend.week?.cost || 0).toFixed(3)}` })),
          h('div', { 'data-ig-note': '' },
            spend.today?.calls
              ? `今日 ${spend.today.calls} 次调用 · 输入 ${fmtTokens(spend.today.input)} / 缓存读 ${fmtTokens(spend.today.cache)} / 输出 ${fmtTokens(spend.today.output)}`
              : '还没有记录'),
          h('div', { 'data-ig-note': '' }, '只统计助理自己发起的模型调用（Story、Note、私信、群聊、陌生人回复、指令识别）。'),
          spend.recent?.length
            ? h('details', { 'data-ig-details': '' },
              h('summary', {}, `最近 ${spend.recent.length} 次调用`),
              h('div', { 'data-ig-pre': '' }, spend.recent.map((c) => `${new Date(c.ts).toLocaleString()}  ${SPEND_KINDS[c.kind] || c.kind}  ${fmtTokens(c.tokens)} tok  ¥${Number(c.cost || 0).toFixed(4)}`).join('\n')))
            : null),

        // ── 内容与节奏 ─────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-h': '' }, '内容与节奏'),
          h(Switch, { label: '插件启用', checked: form.enabled, onChange: flip('enabled') }),
          h(Field, { label: '发布模式' },
            h('select', { 'data-ig-input': '', value: form.mode, onChange: set('mode') },
              h('option', { value: 'auto' }, '全自动发布（按计划发）'),
              h('option', { value: 'draft' }, '草稿确认（只生成预览）'))),
          h('div', { 'data-ig-grid': '' },
            h(Field, { label: '每天几条 Story' },
              h('input', { 'data-ig-input': '', type: 'number', min: 1, max: 14, value: form.storiesPerDay, onChange: set('storiesPerDay') })),
            h(Field, { label: 'Note 时间（HH:MM）' },
              h('input', { 'data-ig-input': '', value: form.noteTime, onChange: set('noteTime') }))),
          h('div', { 'data-ig-grid': '' },
            h(Field, { label: '活动时间从' },
              h('input', { 'data-ig-input': '', value: form.dayStart, onChange: set('dayStart') })),
            h(Field, { label: '活动时间到' },
              h('input', { 'data-ig-input': '', value: form.dayEnd, onChange: set('dayEnd') }))),
          h(Field, { label: '你的 @handle（显示在卡片页脚）' },
            h('input', { 'data-ig-input': '', value: form.handle, placeholder: '例如 your_name', onChange: set('handle') })),
          h(Field, { label: '文案语气' },
            h('input', { 'data-ig-input': '', value: form.tone, onChange: set('tone') })),
          h(Field, { label: '今天的生活素材（会写进 Story 和 Note）' },
            h('textarea', { 'data-ig-textarea': '', value: form.lifeNote, placeholder: '例如：下午去海边走了走，风很大', onChange: set('lifeNote') })),
          h(Switch, { label: '用模型润色文案（关掉则用固定模板）', checked: form.useLlm, onChange: flip('useLlm') }),
          h(SaveBar, { k: 'content', onSave: () => saveSection('content', patchContent()) })),

        // ── 安全 ───────────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-h': '' }, '安全阀'),
          h(Switch, { label: '暂停发布（立即生效）', checked: form.paused, onChange: flip('paused') }),
          h('div', { 'data-ig-grid': '' },
            h(Field, { label: '每天 Story 上限（含手动）' },
              h('input', { 'data-ig-input': '', type: 'number', min: 1, max: 14, value: form.storyCap, onChange: set('storyCap') })),
            h(Field, { label: '最小间隔（分钟）' },
              h('input', { 'data-ig-input': '', type: 'number', min: 0, value: form.minIntervalMinutes, onChange: set('minIntervalMinutes') }))),
          h('div', { 'data-ig-grid': '' },
            h(Field, { label: '安静时段开始' },
              h('input', { 'data-ig-input': '', value: form.quietStart, onChange: set('quietStart') })),
            h(Field, { label: '安静时段结束' },
              h('input', { 'data-ig-input': '', value: form.quietEnd, onChange: set('quietEnd') }))),
          h(SaveBar, { k: 'safety', onSave: () => saveSection('safety', patchSafety()) })),

        // ── 环境安装 ───────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-h': '' }, '运行环境'),
          h('div', { 'data-ig-note': '' }, st.python.installed ? `Python：${st.python.path}` : '需要 Python 3.11+（第一次点「安装依赖」会在插件家目录建独立 venv，装 instagrapi 与 pillow）。'),
          h('div', { 'data-ig-row': '' },
            h('button', { 'data-ig-btn': '', 'data-primary': '', disabled: busy === 'install' || st.installing,
              onClick: () => act('install', () => jpost('/install', {})) },
              st.installing ? '安装中…' : '安装依赖'),
            h('button', { 'data-ig-btn': '', disabled: busy === 'doctor', onClick: () => act('doctor', () => jpost('/doctor', {})) }, '检查环境')),
          st.install && st.install.message ? h('div', { 'data-ig-note': '' }, `状态：${st.install.message}`) : null,
          st.installTail ? h('pre', { 'data-ig-pre': '' }, st.installTail) : null),

        // ── 日志 ───────────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-h': '' }, '最近日志'),
          h('pre', { 'data-ig-pre': '' }, st.logTail || '（暂无）')),

        // ── 发布历史 ───────────────────────────────────────────────────────
        h('div', { 'data-ig-card': '' },
          h('div', { 'data-ig-h': '' }, '最近发布'),
          (st.history || []).length === 0
            ? h('div', { 'data-ig-note': '' }, '还没有发布记录')
            : h('div', { 'data-ig-note': '' }, st.history.map((item) => `${new Date(item.at).toLocaleString()} · ${item.kind}${item.slot != null ? `#${item.slot}` : ''} · ${item.status}${item.error ? ` · ${item.error}` : ''}`).join('\n'))));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style');
        style.setAttribute('data-plugin-css', 'deepseek-instagram');
        style.textContent = CSS;
        document.head.appendChild(style);
        ctx.effect(() => () => style.remove(), 'deepseek-instagram: 设置页样式');

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots;
        if (!slots) return;
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'deepseek-instagram', order: 40, label: 'Instagram' },
          () => h(Panel),
        ));
      },
    };
  },
});
