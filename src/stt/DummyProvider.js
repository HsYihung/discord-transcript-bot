import { SttProvider } from './SttProvider.js';

/**
 * 測試用 provider：不呼叫任何 API，只回傳音訊長度資訊。
 * 用來在沒有 API key 的情況下驗證錄音流程是否正常。
 */
export class DummyProvider extends SttProvider {
  get name() {
    return 'dummy';
  }

  async transcribe(wavBuffer) {
    // WAV header 44 bytes，48kHz 16-bit stereo = 192000 bytes/sec
    const seconds = ((wavBuffer.length - 44) / 192000).toFixed(1);
    return { text: `(測試模式：收到 ${seconds} 秒音訊)` };
  }
}
