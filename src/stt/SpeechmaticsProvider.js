import * as OpenCC from 'opencc-js';
import { SttProvider } from './SttProvider.js';
import { createRateLimiter, sleep } from '../utils/throttle.js';

// 簡體 → 台灣繁體（含慣用語），cmn_en 雙語 pack 只輸出簡體時用
const toTraditional = OpenCC.Converter({ from: 'cn', to: 'twp' });

/** 移除 CJK 字元之間的空白（Speechmatics 會逐詞插空格） */
function tidyCjkSpacing(text) {
  return text.replace(/(?<=[一-鿿　-〿，。、！？])\s+(?=[一-鿿，。、！？])/g, '');
}

/**
 * Speechmatics Batch API
 * 文件：https://docs.speechmatics.com/api-ref/batch/speechmatics-asr-rest-api
 *
 * - 提交：POST https://{region}.asr.api.speechmatics.com/v2/jobs（multipart：data_file + config JSON）
 * - 輪詢：GET /jobs/{id} 直到 status=done
 * - 取稿：GET /jobs/{id}/transcript?format=txt
 * - 語言 cmn_en = 中英雙語 pack（原生 code-switching）；output_locale cmn-Hant = 繁體輸出
 */
export class SpeechmaticsProvider extends SttProvider {
  constructor({ apiKey, region, language, outputLocale, operatingPoint }) {
    super();
    if (!apiKey) throw new Error('speechmatics provider 需要 SPEECHMATICS_API_KEY');
    this.apiKey = apiKey;
    this.baseUrl = `https://${region}.asr.api.speechmatics.com/v2`;
    this.language = language;
    this.outputLocale = outputLocale;
    this.operatingPoint = operatingPoint;
    // 免費層有並行任務數限制，序列化送件並稍作間隔
    this.schedule = createRateLimiter(1000);
  }

  get name() {
    return `speechmatics (${this.language}/${this.operatingPoint})`;
  }

  get headers() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  transcribe(wavBuffer, options = {}) {
    return this.schedule(() => this.#run(wavBuffer, options));
  }

  async #run(wavBuffer) {
    // 1. 提交任務
    const config = {
      type: 'transcription',
      transcription_config: {
        language: this.language,
        operating_point: this.operatingPoint,
        // cmn_en 雙語 pack 不支援 output_locale（會 400），只有純 cmn 支援
        ...(this.outputLocale && this.language !== 'cmn_en'
          ? { output_locale: this.outputLocale }
          : {}),
      },
    };
    const form = new FormData();
    form.append('data_file', new Blob([wavBuffer], { type: 'audio/wav' }), 'segment.wav');
    form.append('config', JSON.stringify(config));

    const createRes = await fetch(`${this.baseUrl}/jobs`, {
      method: 'POST',
      headers: this.headers,
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => '');
      throw new Error(`Speechmatics 建立任務失敗 ${createRes.status}: ${body.slice(0, 300)}`);
    }
    const { id } = await createRes.json();

    // 2. 輪詢任務狀態（短音訊通常數秒～數十秒完成）
    const deadline = Date.now() + 5 * 60 * 1000;
    for (;;) {
      await sleep(2000);
      if (Date.now() > deadline) throw new Error(`Speechmatics 任務 ${id} 逾時（5 分鐘）`);

      const statusRes = await fetch(`${this.baseUrl}/jobs/${id}`, {
        headers: this.headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!statusRes.ok) continue; // 暫時性錯誤，下一輪再查
      const { job } = await statusRes.json();
      if (job.status === 'done') break;
      if (job.status === 'rejected' || job.status === 'deleted') {
        const reason = job.errors?.map((e) => e.message).join('; ') || job.status;
        throw new Error(`Speechmatics 任務失敗: ${reason}`);
      }
    }

    // 3. 取回純文字逐字稿
    const txtRes = await fetch(`${this.baseUrl}/jobs/${id}/transcript?format=txt`, {
      headers: this.headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!txtRes.ok) {
      const body = await txtRes.text().catch(() => '');
      throw new Error(`Speechmatics 取稿失敗 ${txtRes.status}: ${body.slice(0, 300)}`);
    }
    let text = (await txtRes.text()).trim();
    // cmn_en 輸出簡體，統一轉台灣繁體並整理詞間空白
    if (this.language.startsWith('cmn')) {
      text = tidyCjkSpacing(toTraditional(text));
    }
    return { text };
  }
}
