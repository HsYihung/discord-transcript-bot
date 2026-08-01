import { SttProvider } from './SttProvider.js';

/**
 * Typeless External Transcript API
 * 文件：https://docs.typelessapi.com/reference/transcribe
 *
 * - 端點：POST {baseUrl}/v1/transcribe（multipart/form-data）
 * - 認證：Authorization: Token <TYPELESS_API_KEY>（tls_sk_ 開頭）
 * - 模型：typeless-1.0-lite / typeless-1.0-pro / typeless-1.0-max
 * - 限制：單檔最大 50 MB、300 秒（本專案以發言段落為單位，遠低於此限制）
 */
export class TypelessProvider extends SttProvider {
  constructor({ apiKey, baseUrl, model }) {
    super();
    if (!apiKey) throw new Error('typeless provider 需要 TYPELESS_API_KEY');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
  }

  get name() {
    return `typeless (${this.model})`;
  }

  async transcribe(wavBuffer, { language = null } = {}) {
    const form = new FormData();
    form.append('audio', new Blob([wavBuffer], { type: 'audio/wav' }), 'segment.wav');
    form.append('model', this.model);
    if (language) form.append('language', language);

    const res = await fetch(`${this.baseUrl}/v1/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Typeless API 錯誤 ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    if (data.status !== 'success') {
      throw new Error(`Typeless 回應異常: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { text: (data.result?.transcript || '').trim() };
  }
}
