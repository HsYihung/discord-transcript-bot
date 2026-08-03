import { SttProvider } from './SttProvider.js';
import { createRateLimiter, sleep } from '../utils/throttle.js';

const MAX_RETRIES = 3;

/**
 * 使用 OpenAI Audio Transcriptions API（Whisper）。
 * 相容 OpenAI API 格式的服務（如 Groq）只要改 OPENAI_BASE_URL 也能用。
 *
 * 內建全域排隊 + 最小間隔（避開免費層 RPM 限制）與 429 自動重試。
 */
export class OpenAIWhisperProvider extends SttProvider {
  constructor({ apiKey, baseUrl, model, minIntervalMs = 0 }) {
    super();
    if (!apiKey) throw new Error('openai-whisper provider 需要 OPENAI_API_KEY');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.schedule = createRateLimiter(minIntervalMs);
  }

  get name() {
    return `openai-whisper (${this.model})`;
  }

  transcribe(wavBuffer, options = {}) {
    return this.schedule(() => this.#request(wavBuffer, options));
  }

  async #request(wavBuffer, { language = null, prompt = null } = {}) {
    for (let attempt = 0; ; attempt++) {
      const form = new FormData();
      form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'segment.wav');
      form.append('model', this.model);
      form.append('response_format', 'json');
      if (language) form.append('language', language);
      if (prompt) form.append('prompt', prompt);

      let res;
      try {
        res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(45_000),
        });
      } catch (err) {
        // 逾時或網路錯誤：重試，絕不讓單一請求卡死整條辨識佇列
        if (attempt < MAX_RETRIES) {
          console.warn(`[stt] 請求失敗（${err.name}），重試第 ${attempt + 1} 次`);
          await sleep(2000);
          continue;
        }
        throw new Error(`STT 請求失敗: ${err.message}`);
      }

      if (res.ok) {
        const data = await res.json();
        return { text: (data.text || '').trim() };
      }

      const body = await res.text().catch(() => '');
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfterHeader = Number(res.headers.get('retry-after'));
        const bodyMatch = body.match(/try again in ([\d.]+)s/i);
        const delayMs = retryAfterHeader
          ? retryAfterHeader * 1000
          : bodyMatch
            ? Math.ceil(parseFloat(bodyMatch[1]) * 1000)
            : 5000;
        console.warn(`[stt] 429 限速，${delayMs}ms 後重試（第 ${attempt + 1} 次）`);
        await sleep(delayMs + 300);
        continue;
      }
      throw new Error(`STT API 錯誤 ${res.status}: ${body.slice(0, 300)}`);
    }
  }
}
