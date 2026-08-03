import { EndBehaviorType } from '@discordjs/voice';
import OpusScript from 'opusscript';
import { config } from '../config.js';
import { pcmToWav, pcmDurationMs } from '../utils/wav.js';

// 合併段落之間插入的靜音（讓 STT 知道是不同句子）
const JOIN_SILENCE = Buffer.alloc(48000 * 2 * 2 * 0.3); // 0.3 秒

/**
 * 一場錄音 session（對應一個伺服器的一次錄音）。
 *
 * 流程：
 * 1. start() 後監聽語音頻道中誰開始說話
 * 2. 每個人每次發言擷取為一小段：Opus 逐封包解碼成 PCM
 * 3. 同一發言者短時間內（mergeGapMs）的連續小段合併成一個 batch，
 *    攢夠了（間隔過久或達到長度上限）才送 STT——大幅減少 API 請求數
 * 4. stopCapture() 立即離開頻道；finalize() 沖洗所有 batch 並等辨識完成
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
    /** @type {Promise<void>[]} 音訊擷取／解碼工作 */
    this.captureJobs = [];
    /** @type {Promise<void>[]} STT 辨識工作 */
    this.sttJobs = [];
    /** 已完成（成功或失敗）的辨識數 */
    this.doneCount = 0;
    /** @type {Map<string, {displayName: string, startMs: number, endMs: number, pcms: Buffer[], bytes: number, timer: NodeJS.Timeout|null}>} 各發言者待合併的音訊 */
    this.buffers = new Map();
    /** 正在錄音中的使用者，避免重複訂閱 */
    this.activeUsers = new Set();
    this.stopped = false;

    this._onSpeakingStart = (userId) => this.captureSegment(userId);
  }

  start() {
    this.startedAt = new Date();
    this.receiver.speaking.on('start', this._onSpeakingStart);
  }

  /** 尚未完成辨識的 batch 數 */
  get pendingCount() {
    return this.sttJobs.length - this.doneCount;
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

      const displayName = await this.resolveDisplayName(userId);
      this.enqueuePcm(userId, displayName, startMs, startMs + Math.round(durationMs), pcm);
    });

    this.captureJobs.push(job);
  }

  /** 把一小段 PCM 併入該發言者的 batch；間隔過久或長度達上限就先沖洗 */
  enqueuePcm(userId, displayName, startMs, endMs, pcm) {
    let buf = this.buffers.get(userId);

    const tooFar = buf && startMs - buf.endMs > config.mergeGapMs;
    const tooBig = buf && buf.bytes + pcm.length > config.maxMergedDurationMs * 192; // 192 bytes/ms
    if (tooFar || tooBig) {
      this.flushBuffer(userId);
      buf = null;
    }

    if (!buf) {
      buf = { displayName, startMs, endMs, pcms: [pcm], bytes: pcm.length, timer: null };
      this.buffers.set(userId, buf);
    } else {
      buf.pcms.push(JOIN_SILENCE, pcm);
      buf.bytes += JOIN_SILENCE.length + pcm.length;
      buf.endMs = endMs;
    }

    // 這位發言者沉默超過 mergeGapMs 就沖洗（錄音中即時辨識，只是攢批送）
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(() => this.flushBuffer(userId), config.mergeGapMs);
  }

  /** 把某位發言者攢的 batch 送去辨識 */
  flushBuffer(userId) {
    const buf = this.buffers.get(userId);
    if (!buf) return;
    this.buffers.delete(userId);
    if (buf.timer) clearTimeout(buf.timer);

    const segment = {
      userId,
      displayName: buf.displayName,
      startMs: buf.startMs,
      endMs: buf.endMs,
      text: null,
      error: null,
    };
    this.segments.push(segment);

    const wav = pcmToWav(Buffer.concat(buf.pcms));
    const job = this.sttProvider
      .transcribe(wav, { language: config.stt.language, prompt: config.stt.prompt })
      .then(({ text }) => {
        segment.text = text;
      })
      .catch((err) => {
        segment.error = err.message;
        console.error(`[stt] 辨識失敗 (${segment.displayName}):`, err.message);
      })
      .finally(() => {
        this.doneCount++;
      });
    this.sttJobs.push(job);
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

  /** 立即停止擷取並離開語音頻道（不等待辨識） */
  stopCapture() {
    this.stopped = true;
    this.endedAt = new Date();
    this.receiver.speaking.off('start', this._onSpeakingStart);
    this.connection.destroy();
  }

  /** 等擷取收尾、沖洗所有 batch、辨識全部完成後回傳排序好的 segments */
  async finalize() {
    await Promise.allSettled(this.captureJobs);
    for (const userId of [...this.buffers.keys()]) this.flushBuffer(userId);
    await Promise.allSettled(this.sttJobs);
    this.segments.sort((a, b) => a.startMs - b.startMs);
    return this.segments;
  }
}
