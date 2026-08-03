import { EndBehaviorType } from '@discordjs/voice';
import OpusScript from 'opusscript';
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
    /** 已完成（成功或失敗）的辨識數 */
    this.doneCount = 0;
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

    // 逐封包解碼：壞封包只丟一個音框（20ms），不會毀掉整個段落。
    // ≤3 bytes 是 Discord 的靜音/控制封包，直接跳過。
    const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    const chunks = [];
    let badPackets = 0;
    opusStream.on('error', (err) => console.error(`[recorder] opus stream error (${userId}):`, err.message));
    opusStream.on('data', (packet) => {
      if (packet.length <= 3) return;
      try {
        chunks.push(Buffer.from(decoder.decode(packet)));
      } catch {
        badPackets++;
      }
    });

    const job = new Promise((resolve) => {
      opusStream.once('end', () => resolve());
      opusStream.once('close', () => resolve());
    }).then(async () => {
      decoder.delete();
      if (badPackets > 0) {
        console.warn(`[recorder] 使用者 ${userId} 的段落跳過 ${badPackets} 個無效封包`);
      }
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
        console.error(`[stt] 辨識失敗 (${segment.displayName}):`, err.message);
      } finally {
        this.doneCount++;
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

  /** 尚未完成辨識的段落數 */
  get pendingCount() {
    return this.pending.length - this.doneCount;
  }

  /** 立即停止擷取並離開語音頻道（不等待辨識） */
  stopCapture() {
    this.stopped = true;
    this.endedAt = new Date();
    this.receiver.speaking.off('start', this._onSpeakingStart);
    this.connection.destroy();
  }

  /** 等錄音期間排入的辨識全部完成，回傳排序好的 segments */
  async finalize() {
    await Promise.allSettled(this.pending);
    this.segments.sort((a, b) => a.startMs - b.startMs);
    return this.segments;
  }
}
