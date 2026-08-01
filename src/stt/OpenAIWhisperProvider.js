import { SttProvider } from './SttProvider.js';

/**
 * 使用 OpenAI Audio Transcriptions API（Whisper）。
 * 相容 OpenAI API 格式的服務（如 Groq）只要改 OPENAI_BASE_URL 也能用。
 */
export class OpenAIWhisperProvider extends SttProvider {
  constructor({ apiKey, baseUrl, model }) {
    super();
    if (!apiKey) throw new Error('openai-whisper provider 需要 OPENAI_API_KEY');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
  }

  get name() {
    return `openai-whisper (${this.model})`;
  }

  async transcribe(wavBuffer, { language = null, prompt = null } = {}) {
    const form = new FormData();
    form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'segment.wav');
    form.append('model', this.model);
    form.append('response_format', 'json');
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', prompt);

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`STT API 錯誤 ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    return { text: (data.text || '').trim() };
  }
}
