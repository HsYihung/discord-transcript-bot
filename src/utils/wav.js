/**
 * 將原始 PCM（s16le）包成 WAV 檔案 Buffer。
 * @param {Buffer} pcmBuffer
 * @param {{ sampleRate?: number, channels?: number, bitDepth?: number }} options
 */
export function pcmToWav(pcmBuffer, { sampleRate = 48000, channels = 2, bitDepth = 16 } = {}) {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/** PCM 長度換算為毫秒 */
export function pcmDurationMs(pcmLength, { sampleRate = 48000, channels = 2, bitDepth = 16 } = {}) {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  return (pcmLength / byteRate) * 1000;
}
