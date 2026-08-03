import { EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';
import { config } from '../config.js';
import { pcmToWav, pcmDurationMs } from '../utils/wav.js';

/**
 * 一場錄音 session（對應一個伺服器的一次錄音）。
 *
 * 流程：
 * 1. start() 後監聽語音頻道中誰開始說話
 * 2. 每個人每次發言 = 一個 segment：擷取 Opus → 解碼成 PCM → 包成 WAV
 * 3. segment 結束（靜音超過門檻）後立即非同步送 STT 辨識
 * 4. stop() 時等所有辨識完成，回傳依時間排序的 segments
 */
export class RecordingSession {
  /**
   * @param {import('@discordjs/voice').VoiceConnection} connection
   * @param {import('discord.js').VoiceBasedChannel} voiceChannel
   * @param {import('../stt/SttProvider.js').SttProvider} sttProvider
   */
  constructor(connection, voiceChannel, sttProvider) {
    this.connection = connection;
    this.voiceChannel = voiceChannel;
    this.sttProvider = sttProvider;

    this.receiver = connection.receiver;
    this.startedAt = null;
    this.endedAt = null;

    /** @type {Array<{userId: string, displayName: string, startMs: number, endMs: number, text: string|null, error: string|null}>} */
    this.segments = [];
    /** @type {Promise<void>[]} 進行中的辨識 */
    this.pending = [];
    /** 正在錄音中的使用者，避免重複訂閱 */
    this.activeUsers = new Set();
    this.stopped = false;

    this._onSpeakingStart = (userId) => this.captureSegment(userId);
  }

  start() {
    this.startedAt = new Date();
    this.receiver.speaking.on('start', this._onSpeakingStart);
  }

  /** 擷取某位使用者的一段發言 */
  captureSegment(userId) {
    if (this.stopped || this.activeUsers.has(userId)) return;

    const member = this.voiceChannel.guild.members.cache.get(userId);
    if (member?.user.bot) return;

    this.activeUsers.add(userId);
    const startMs = Date.now() - this.startedAt.getTime();

    const opusStream = this.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: config.silenceDurationMs },
    });
    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });

    const chunks = [];
    decoder.on('data', (chunk) => chunks.push(chunk));
    opusStream.on('error', (err) => console.error(`[recorder] opus stream error (${userId}):`, err.message));
    decoder.on('error', (err) => console.error(`[recorder] decoder error (${userId}):`, err.message));
    // 不用 pipe：Discord 會夾雜 ≤3 bytes 的靜音/控制封包，直接餵給解碼器會炸掉整個段落
    opusStream.on('data', (packet) => {
      if (packet.length > 3 && !decoder.destroyed) decoder.write(packet);
    });
    opusStream.once('end', () => {
      if (!decoder.destroyed) decoder.end();
    });

    const job = new Promise((resolve) => {
      decoder.once('end', () => resolve());
      decoder.once('close', () => resolve());
    }).then(async () => {
      this.activeUsers.delete(userId);

      const pcm = Buffer.concat(chunks);
      const durationMs = pcmDurationMs(pcm.length);
      if (durationMs < config.minSegmentMs) return; // 太短，當雜音丟掉

      const segment = {
        userId,
        displayName: await this.resolveDisplayName(userId),
        startMs,
        endMs: startMs + Math.round(durationMs),
        text: null,
        error: null,
      };
      this.segments.push(segment);

      try {
        const { text } = await this.sttProvider.transcribe(pcmToWav(pcm), {
          language: config.stt.language,
          prompt: config.stt.prompt,
        });
        segment.text = text;
      } catch (err) {
        segment.error = err.message;
        console.error(`[stt] 辨識失敗 (${segment.displayName}):`, err);
      }
    });

    this.pending.push(job);
  }

  async resolveDisplayName(userId) {
    try {
      const member =
        this.voiceChannel.guild.members.cache.get(userId) ??
        (await this.voiceChannel.guild.members.fetch(userId));
      return member.displayName;
    } catch {
      return `未知使用者(${userId})`;
    }
  }

  /** 停止錄音，等所有辨識完成後回傳排序好的 segments */
  async stop() {
    this.stopped = true;
    this.endedAt = new Date();
    this.receiver.speaking.off('start', this._onSpeakingStart);
    this.connection.destroy();

    await Promise.allSettled(this.pending);
    this.segments.sort((a, b) => a.startMs - b.startMs);
    return this.segments;
  }
}
