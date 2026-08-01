import { formatOffset, formatDateTime } from '../utils/time.js';

/**
 * 將錄音結果整理成固定格式的 Markdown 逐字稿。
 * @param {import('../recorder/RecordingSession.js').RecordingSession} session
 * @param {string} providerName
 */
export function formatTranscript(session, providerName) {
  const participants = [...new Set(session.segments.map((s) => s.displayName))];

  const lines = [
    '# 語音逐字稿',
    '',
    `- 頻道：${session.voiceChannel.name}`,
    `- 開始時間：${formatDateTime(session.startedAt)}`,
    `- 結束時間：${formatDateTime(session.endedAt)}`,
    `- 參與者：${participants.length > 0 ? participants.join('、') : '（無人發言）'}`,
    `- 辨識引擎：${providerName}`,
    '',
    '---',
    '',
  ];

  if (session.segments.length === 0) {
    lines.push('（本次錄音沒有偵測到任何發言）');
  }

  for (const seg of session.segments) {
    const time = formatOffset(seg.startMs);
    if (seg.error) {
      lines.push(`[${time}] ${seg.displayName}：（辨識失敗：${seg.error}）`);
    } else if (seg.text) {
      lines.push(`[${time}] ${seg.displayName}：${seg.text}`);
    }
    // text 為空字串（無語音內容）的段落直接略過
  }

  return lines.join('\n') + '\n';
}
