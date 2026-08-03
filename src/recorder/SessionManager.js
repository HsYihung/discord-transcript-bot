import { joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import { RecordingSession } from './RecordingSession.js';

/** 管理各伺服器的錄音 session（一個 guild 同時最多一場） */
export class SessionManager {
  constructor(sttProvider) {
    this.sttProvider = sttProvider;
    /** @type {Map<string, RecordingSession>} guildId -> session */
    this.sessions = new Map();
  }

  get(guildId) {
    return this.sessions.get(guildId) ?? null;
  }

  /**
   * 加入語音頻道並開始錄音。
   * @param {import('discord.js').VoiceBasedChannel} voiceChannel
   */
  async start(voiceChannel) {
    const guildId = voiceChannel.guild.id;
    if (this.sessions.has(guildId)) {
      throw new Error('這個伺服器已經在錄音中，請先用 /record stop 停止');
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false, // 必須為 false 才收得到音訊
      selfMute: true,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (err) {
      connection.destroy();
      throw new Error(`無法連上語音頻道: ${err.message}`);
    }

    const session = new RecordingSession(connection, voiceChannel, this.sttProvider);
    session.start();
    this.sessions.set(guildId, session);
    return session;
  }

  /** 停止擷取並回傳 session；剩餘辨識由呼叫端 await session.finalize() 等待 */
  stop(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) throw new Error('目前沒有進行中的錄音');
    this.sessions.delete(guildId);
    session.stopCapture();
    return session;
  }
}
