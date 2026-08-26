import 'dotenv/config';

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,

  stt: {
    provider: process.env.STT_PROVIDER || 'openai-whisper',
    language: process.env.STT_LANGUAGE || null,
    // 提示詞：引導辨識輸出風格（例如繁體中文、專有名詞拼法）
    prompt: process.env.STT_PROMPT || null,
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_STT_MODEL || 'whisper-1',
    },
    speechmatics: {
      apiKey: process.env.SPEECHMATICS_API_KEY,
      region: process.env.SPEECHMATICS_REGION || 'eu1',
      // cmn_en = 中英雙語 pack（原生 code-switching）
      language: process.env.SPEECHMATICS_LANGUAGE || 'cmn_en',
      // 繁體中文輸出
      outputLocale: process.env.SPEECHMATICS_OUTPUT_LOCALE || 'cmn-Hant',
      // standard（快）或 enhanced（準）
      operatingPoint: process.env.SPEECHMATICS_OPERATING_POINT || 'enhanced',
    },
  },

  // STT 請求最小間隔（毫秒），避開免費層 RPM 限制（Groq 免費層 20 RPM ≈ 3000ms）
  sttMinIntervalMs: Number(process.env.STT_MIN_INTERVAL_MS || 3200),
  // 使用者停止說話後多久視為一個段落結束（毫秒）
  silenceDurationMs: Number(process.env.SILENCE_DURATION_MS || 1500),
  // 同一發言者兩段發言間隔在此範圍內就合併成一個 batch 送辨識（毫秒）
  mergeGapMs: Number(process.env.MERGE_GAP_MS || 8000),
  // 單一 batch 音訊長度上限（毫秒），達到就先送出（Groq 單檔上限 300 秒）
  maxMergedDurationMs: Number(process.env.MAX_MERGED_DURATION_MS || 120_000),
  // 短於此長度的音訊段落直接丟棄（毫秒），過濾雜音
  minSegmentMs: Number(process.env.MIN_SEGMENT_MS || 300),
  // 最大視窗 RMS 低於此值的段落視為雜音丟棄（int16 音量刻度，人聲通常 >1000）
  minSegmentRms: Number(process.env.MIN_SEGMENT_RMS || 300),

  transcriptDir: process.env.TRANSCRIPT_DIR || 'transcripts',
  // 除錯：把每批送辨識的音訊存到 recordings/（DEBUG_SAVE_AUDIO=1 開啟）
  debugSaveAudio: process.env.DEBUG_SAVE_AUDIO === '1',
};

export function assertConfig() {
  if (!config.discordToken) throw new Error('缺少 DISCORD_TOKEN，請參考 .env.example 建立 .env');
  if (!config.clientId) throw new Error('缺少 CLIENT_ID，請參考 .env.example 建立 .env');
}
