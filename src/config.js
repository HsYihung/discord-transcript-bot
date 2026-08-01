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
    typeless: {
      apiKey: process.env.TYPELESS_API_KEY,
      baseUrl: process.env.TYPELESS_BASE_URL || 'https://api.typelessapi.com',
      model: process.env.TYPELESS_MODEL || 'typeless-1.0-pro',
    },
  },

  // 使用者停止說話後多久視為一個段落結束（毫秒）
  silenceDurationMs: Number(process.env.SILENCE_DURATION_MS || 800),
  // 短於此長度的音訊段落直接丟棄（毫秒），過濾雜音
  minSegmentMs: Number(process.env.MIN_SEGMENT_MS || 300),

  transcriptDir: process.env.TRANSCRIPT_DIR || 'transcripts',
};

export function assertConfig() {
  if (!config.discordToken) throw new Error('缺少 DISCORD_TOKEN，請參考 .env.example 建立 .env');
  if (!config.clientId) throw new Error('缺少 CLIENT_ID，請參考 .env.example 建立 .env');
}
