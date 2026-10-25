// 主人分享的 Post / Reels：把 ig_cli 透传的 share 与 media-info 结果整理成提示词里的一句话。
//
// ig_cli 的 dm-poll 会带上 share: {kind, url, title, previewUrl, mediaPk}
// （xma_media_share / xma_clip = 主人分享的 Post / Reels；media = 直接发在私信里的图/视频）。
// media-info 返回 Media 的摘要。这里全是纯函数，方便单测；不联网、不读配置。

const KIND_LABELS = { post: 'Post', reel: 'Reels', media: '私信里的图片/视频' };

// 短码在 /p/<code>/、/reel/<code>/、/tv/<code>/ 里；取不到就返回空串
const CODE_PATTERNS = [
  /\/p\/([A-Za-z0-9_-]+)/,
  /\/reel\/([A-Za-z0-9_-]+)/,
  /\/tv\/([A-Za-z0-9_-]+)/,
];

const MAX_TEXT = 400;

function trim(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
}

function mediaTypeLabel(info) {
  const product = String(info.productType || '').toLowerCase();
  if (product === 'clips' || product === 'reels') return 'Reels';
  const type = Number(info.mediaType);
  if (type === 2) return '视频';
  if (type === 8) return '相册';
  if (type === 1) return '图片';
  return '';
}

/** 这条分享是不是视频（Reels、视频 Post、私信里直接发的视频）。 */
export function isVideoInfo(info) {
  if (!info || typeof info !== 'object') return false;
  const product = String(info.productType || '').toLowerCase();
  if (product === 'clips' || product === 'reels') return true;
  if (Number(info.mediaType) === 2) return true;
  return Number(info.videoDuration) > 0;
}

/** 视频时长：不到 1 分钟写「12.4 秒」，超过写「1:29」。 */
function formatDuration(sec) {
  const total = Number(sec);
  if (!(total > 0)) return '';
  if (total < 60) return `${total.toFixed(1)} 秒`;
  const minutes = Math.floor(total / 60);
  const seconds = Math.round(total % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 从文案里抽话题标签 / @提及；只用来补充描述，不改变原文。 */
function tagsOf(text, pattern) {
  const hits = String(text || '').match(pattern) || [];
  return [...new Set(hits)].slice(0, 6);
}

/** 从分享链接里取短码（/p/、/reel/、/tv/）；取不到返回空串。 */
export function shareCode(url) {
  const text = String(url || '');
  if (!text) return '';
  for (const pattern of CODE_PATTERNS) {
    const hit = text.match(pattern);
    if (hit) return hit[1];
  }
  return '';
}

/**
 * 从 dm-poll 一条消息里取出分享信息；不是分享、或老版本 CLI 没带 share 时返回 null。
 * 老版本 CLI 只有 itemType 没有 share —— 拿不到具体内容，宁可返回 null 也不猜。
 */
export function shareFromMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const raw = message.share && typeof message.share === 'object' ? message.share : null;
  if (!raw) return null;
  const itemType = String(message.itemType || '').toLowerCase();
  const kind = KIND_LABELS[raw.kind]
    ? raw.kind
    : itemType === 'xma_media_share'
      ? 'post'
      : itemType === 'xma_clip'
        ? 'reel'
        : '';
  if (!kind) return null;
  const url = String(raw.url || '');
  const title = String(raw.title || '');
  const mediaPk = String(raw.mediaPk || '');
  const previewUrl = String(raw.previewUrl || '');
  const code = String(raw.code || '') || shareCode(url);
  if (!code && !url && !title && !mediaPk) return null;
  return { kind, code, url, title, mediaPk, previewUrl };
}

/** 把 media-info 的返回拼成一段短描述；空数据返回空串。 */
export function describeMedia(info, { skipLabel = false } = {}) {
  if (!info || typeof info !== 'object') return '';
  const parts = [];
  const label = mediaTypeLabel(info);
  const duration = formatDuration(info.videoDuration);
  if (label && !skipLabel) parts.push(duration ? `${label}（${duration}）` : label);
  else if (duration) parts.push(duration);
  const username = String(info.username || '').trim();
  if (username) parts.push(`作者 @${username}`);
  const source = info.caption || info.title || info.accessibilityCaption || '';
  const body = trim(source);
  if (body) parts.push(`正文：${body}`);
  const stats = [];
  if (Number(info.likeCount) > 0) stats.push(`点赞 ${Math.round(Number(info.likeCount))}`);
  if (Number(info.commentCount) > 0) stats.push(`评论 ${Math.round(Number(info.commentCount))}`);
  const plays = Number(info.playCount) || Number(info.viewCount) || 0;
  if (plays > 0) stats.push(`播放 ${Math.round(plays)}`);
  if (stats.length) parts.push(stats.join(' · '));
  const tags = tagsOf(source, /#[\p{L}\p{N}_]+/gu);
  if (tags.length) parts.push(`话题 ${tags.join(' ')}`);
  const mentions = tagsOf(source, /@[A-Za-z0-9._]{2,}/g);
  if (mentions.length) parts.push(`提及 ${mentions.join(' ')}`);
  const taken = Number(info.takenAt);
  if (taken > 0) {
    const day = new Date(taken).toISOString().slice(0, 10);
    if (day) parts.push(`发布 ${day}`);
  }
  return parts.join('；');
}

/**
 * 视频类的诚实提示：这条能力只读文案和数据，不看画面、不听声音。
 * 非视频返回空串；由 Host 拼进提示词，避免模型假装「看过/听过」。
 */
export function shareWatchHint(info) {
  if (!isVideoInfo(info)) return '';
  return '\n\n（你只读到了它的文案和数据，看不到画面、听不到声音；不要假装看过或听过。）';
}

/** 提示词里用的「主人分享了什么」的一句话；没有 media-info 时退回配文/链接，不编造。 */
export function shareBrief(share, info) {
  if (!share || typeof share !== 'object') return '';
  const label = isVideoInfo(info) && share.kind === 'media' ? '视频' : (KIND_LABELS[share.kind] || '内容');
  const head = `主人分享了一条 Instagram ${label}`;
  const code = String(share.code || '');
  const detail = describeMedia(info, { skipLabel: true });
  if (detail) return `${head}（短码 ${code || '未知'}）：${detail}`;
  const title = trim(share.title);
  if (title) return `${head}（短码 ${code || '未知'}），配文：${title}`;
  const url = String(share.url || '').trim();
  if (url) return `${head}（短码 ${code || '未知'}）：${url}`;
  return `${head}，但没读到具体内容。`;
}

/**
 * 分享回复的附加指令：开 = 读完后讲一句自己的感想；关 = 只确认看到了、不评价内容。
 * 缺省按开启处理（和设置页默认一致）。
 */
export function shareOpinionHint(enabled) {
  if (enabled === false) return '\n\n只回一句「看到了」这类确认，不要评价、不要发表对内容的感想。';
  return '\n\n读完之后，用一两句话说说你对这条内容的真实感想（具体到某个点，别空泛地夸）。';
}
