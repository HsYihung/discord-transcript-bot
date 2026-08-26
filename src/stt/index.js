import { config } from '../config.js';
import { OpenAIWhisperProvider } from './OpenAIWhisperProvider.js';
import { SpeechmaticsProvider } from './SpeechmaticsProvider.js';
import { DummyProvider } from './DummyProvider.js';

/**
 * STT provider 註冊表。
 * 新增 provider 時在這裡加一行：'名稱': () => new 你的Provider(...)
 */
const registry = {
  'openai-whisper': () =>
    new OpenAIWhisperProvider({ ...config.stt.openai, minIntervalMs: config.sttMinIntervalMs }),
  speechmatics: () => new SpeechmaticsProvider(config.stt.speechmatics),
  dummy: () => new DummyProvider(),
};

export function createSttProvider(name = config.stt.provider) {
  const factory = registry[name];
  if (!factory) {
    const available = Object.keys(registry).join(', ');
    throw new Error(`未知的 STT provider: ${name}（可用: ${available}）`);
  }
  return factory();
}
