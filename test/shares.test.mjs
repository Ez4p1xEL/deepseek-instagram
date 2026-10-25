// 主人分享的 Post / Reels：把 ig_cli 透传的 share 字段整理成能塞进提示词的一句话。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shareFromMessage, shareCode, describeMedia, shareBrief, shareOpinionHint, isVideoInfo, shareWatchHint } from '../lib/shares.mjs';

test('shareFromMessage：Post 分享能拿到短码、配文和原链接', () => {
  const share = shareFromMessage({
    itemType: 'xma_media_share',
    share: {
      kind: 'post',
      url: 'https://www.instagram.com/p/DeviFyLhpht/?is_sponsored=false',
      title: 'Sony H9 抽獎',
      previewUrl: 'https://cdn/a.jpg',
    },
  });
  assert.equal(share.kind, 'post');
  assert.equal(share.code, 'DeviFyLhpht');
  assert.equal(share.title, 'Sony H9 抽獎');
  assert.equal(share.url, 'https://www.instagram.com/p/DeviFyLhpht/?is_sponsored=false');
  assert.equal(share.previewUrl, 'https://cdn/a.jpg');
});

test('shareFromMessage：Reels 分享从 /reel/ 链接里取短码', () => {
  const share = shareFromMessage({
    itemType: 'xma_clip',
    share: { kind: 'reel', url: 'https://www.instagram.com/reel/DeeLjm3gEre/?id=4007691543832971998' },
  });
  assert.equal(share.kind, 'reel');
  assert.equal(share.code, 'DeeLjm3gEre');
  assert.equal(share.title, '');
});

test('shareFromMessage：直接发在私信里的图/视频按 mediaPk 认', () => {
  const share = shareFromMessage({
    itemType: 'media',
    share: { kind: 'media', mediaPk: '807949145557000', previewUrl: 'https://cdn/b.jpg' },
  });
  assert.equal(share.kind, 'media');
  assert.equal(share.mediaPk, '807949145557000');
  assert.equal(share.code, '');
});

test('shareFromMessage：普通文本、缺 share 字段的老 CLI 一律返回 null', () => {
  assert.equal(shareFromMessage({ itemType: 'text', text: '在吗' }), null);
  assert.equal(shareFromMessage({ itemType: 'xma_media_share' }), null);
  assert.equal(shareFromMessage(null), null);
});

test('shareCode：/p/ 与 /reel/ 都能取，取不到返回空串', () => {
  assert.equal(shareCode('https://www.instagram.com/p/AbC-1_x/'), 'AbC-1_x');
  assert.equal(shareCode('https://www.instagram.com/reel/XyZ9/?x=1'), 'XyZ9');
  assert.equal(shareCode('https://example.com/whatever'), '');
  assert.equal(shareCode(''), '');
});

test('describeMedia：作者、正文、点赞/评论/播放与时长都写进去', () => {
  const text = describeMedia({
    pk: '1', code: 'abc', mediaType: 2, productType: 'clips', caption: '今天在海边拍的',
    username: 'ez4p1xel', takenAt: 1792936772000,
    likeCount: 120, playCount: 3400, commentCount: 8, videoDuration: 12.4,
  });
  assert.match(text, /Reels/);
  assert.match(text, /@ez4p1xel/);
  assert.match(text, /今天在海边拍的/);
  assert.match(text, /点赞 120/);
  assert.match(text, /评论 8/);
  assert.match(text, /播放 3400/);
  assert.match(text, /12\.4 秒/);
});

test('describeMedia：空数据返回空串，没有正文时退回 title', () => {
  assert.equal(describeMedia(null), '');
  assert.equal(describeMedia({}), '');
  const text = describeMedia({ mediaType: 1, title: '只有标题', username: 'a' });
  assert.match(text, /图片/);
  assert.match(text, /只有标题/);
});

test('shareBrief：有 media-info 时带正文，没有时退回配文/链接，不编造', () => {
  const share = { kind: 'post', code: 'DeviFyLhpht', url: 'https://www.instagram.com/p/DeviFyLhpht/', title: 'Sony H9 抽獎' };
  const withInfo = shareBrief(share, { caption: '抽獎詳情在留言', username: 'braindeadboy.z', mediaType: 1, likeCount: 12 });
  assert.match(withInfo, /Post/);
  assert.match(withInfo, /抽獎詳情在留言/);
  assert.match(withInfo, /@braindeadboy\.z/);

  const noInfo = shareBrief(share, null);
  assert.match(noInfo, /Sony H9 抽獎/);
  assert.match(noInfo, /DeviFyLhpht/);
  assert.doesNotMatch(noInfo, /点赞/);
});

test('shareOpinionHint：开=要求说自己的感想，关=只确认、不评价', () => {  const on = shareOpinionHint(true);
  assert.match(on, /感想/);
  assert.match(on, /具体/);
  assert.equal(shareOpinionHint(undefined), on, '缺省应当按开启处理');

  const off = shareOpinionHint(false);
  assert.match(off, /不要评价/);
  assert.doesNotMatch(off, /真实感想/);
});

// 视频帖（Reels / 视频 Post）：在文案之外，把时长写成 mm:ss、播放量、话题标签、@提及都读出来。
test('describeMedia：视频帖读出时长 mm:ss、播放量、话题标签与提及', () => {
  const text = describeMedia({
    mediaType: 2, productType: 'clips', username: 'hiltihongkong',
    caption: '👀 牆後面有咩？ #HiltiHongKong #PS1000 想了解 @hilti.to 的 Demo',
    likeCount: 1527, commentCount: 60, playCount: 108731, videoDuration: 88.832,
    takenAt: 1791974140000,
  });
  assert.match(text, /视频|Reels/);
  assert.match(text, /1:29/);
  assert.match(text, /108,731|108731/);
  assert.match(text, /#HiltiHongKong/);
  assert.match(text, /@hilti\.to/);
  assert.match(text, /2026-10-14/);
});

test('describeMedia：短于 1 分钟的视频仍写「X.X 秒」，长文案截断到 400 字', () => {
  assert.match(describeMedia({ mediaType: 2, videoDuration: 12.4 }), /12\.4 秒/);
  const long = describeMedia({ mediaType: 2, videoDuration: 30, caption: '字'.repeat(500) });
  assert.ok(!long.includes('字'.repeat(401)));
  assert.match(long, /…/);
});

test('isVideoInfo / shareWatchHint：只有视频才提示「看不到画面、听不到声音」', () => {
  assert.equal(isVideoInfo({ mediaType: 2 }), true);
  assert.equal(isVideoInfo({ productType: 'clips' }), true);
  assert.equal(isVideoInfo({ mediaType: 1 }), false);
  assert.equal(isVideoInfo(null), false);
  assert.match(shareWatchHint({ mediaType: 2 }), /看不到画面/);
  assert.match(shareWatchHint({ mediaType: 2 }), /听不到声音/);
  assert.equal(shareWatchHint({ mediaType: 1 }), '');
});

test('shareBrief：直接发在私信里的视频按「视频」描述', () => {
  const brief = shareBrief({ kind: 'media', mediaPk: '807949145557000' }, { mediaType: 2, videoDuration: 8 });
  assert.match(brief, /视频/);
});
