/**
 * STT（語音轉文字）Provider 基底類別。
 *
 * 要擴充新的 STT 服務：
 * 1. 建立新類別繼承 SttProvider，實作 transcribe()
 * 2. 到 src/stt/index.js 的 registry 註冊名稱
 * 3. 在 .env 設定 STT_PROVIDER=你的名稱
 */
export class SttProvider {
  /** provider 名稱，輸出逐字稿時會標註 */
  get name() {
    return 'base';
  }

  /**
   * 將一段 WAV 音訊轉為文字。
   * @param {Buffer} wavBuffer - WAV 格式音訊（48kHz / 16-bit / stereo）
   * @param {object} options
   * @param {string|null} options.language - ISO-639-1 語言代碼，null 表示自動偵測
   * @returns {Promise<{ text: string }>}
   */
  async transcribe(wavBuffer, options = {}) {
    throw new Error(`${this.constructor.name} 尚未實作 transcribe()`);
  }
}
