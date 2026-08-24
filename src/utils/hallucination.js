/**
 * Whisper 幻覺過濾：模型遇到聽不清的音訊時，會輸出訓練資料（影片字幕）
 * 中的高頻套語，例如「謝謝大家收看」「請按讚訂閱分享」。
 */

// 無論音訊多長都視為幻覺（正常會議不可能出現的字幕套語）
const HARD_PATTERNS = [
  /(按讚|點贊|点赞).*(訂閱|订阅)/,
  /(訂閱|订阅).*(分享|轉發|转发|小鈴鐺|小铃铛)/,
  /字幕(由|提供|製作|组|組)/,
  /留意下方的字幕/,
  /amara\.org/i,
  /優優獨播劇場|明鏡.*欄目/,
  /下期再(見|见)/,
];

// 注意：provider 已先做簡轉繁，以下比對以繁體為主；簡體樣式僅為保險

// 音訊夠短（聽不出內容）時才視為幻覺；較長的音訊可能是真的在道謝
const SHORT_AUDIO_PATTERNS = [
  /^謝謝(大家)?(收看|觀看|聆聽)?[。!！\s]*$/,
  /^感謝(大家)?(收看|觀看)[。!！\s]*$/,
];

const SHORT_AUDIO_MS = 2000;

/**
 * @param {string} text 辨識結果
 * @param {number} durationMs 該段音訊長度
 * @returns {boolean} 是否判定為幻覺、應該過濾
 */
export function isLikelyHallucination(text, durationMs) {
  const t = text.trim();
  if (!t) return false;
  if (HARD_PATTERNS.some((p) => p.test(t))) return true;
  if (durationMs < SHORT_AUDIO_MS && SHORT_AUDIO_PATTERNS.some((p) => p.test(t))) return true;
  return false;
}
