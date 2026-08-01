# Discord 語音逐字稿 Bot

讓 bot 加入語音頻道錄音，擷取每位發言者的音訊、時間與身分，送到語音轉文字（STT）服務辨識，停止錄音時輸出固定格式的 Markdown 逐字稿。

## 流程

```
/record start
  → bot 加入你所在的語音頻道
  → 偵測誰開始說話，擷取該使用者的 Opus 音訊
  → 靜音超過門檻（預設 0.8 秒）視為一個段落結束
  → 段落解碼成 WAV，立即非同步送 STT 辨識
/record stop
  → 等所有辨識完成
  → 依發言時間排序，輸出逐字稿（存到 transcripts/ 並附檔回覆）
```

## 逐字稿格式

```markdown
# 語音逐字稿

- 頻道：會議室
- 開始時間：2026-08-01 14:00:00
- 結束時間：2026-08-01 14:30:00
- 參與者：Alice、Bob
- 辨識引擎：openai-whisper (whisper-1)

---

[00:00:05] Alice：大家好，今天開始開會
[00:00:12] Bob：好的，先看上週進度
```

## 安裝

需要 Node.js 18+。

```bash
npm install
cp .env.example .env   # 填入 DISCORD_TOKEN、CLIENT_ID、OPENAI_API_KEY
npm run register       # 註冊 slash commands（設 GUILD_ID 可立即生效）
npm start
```

### Discord Developer Portal 設定

1. <https://discord.com/developers/applications> 建立 Application → Bot，取得 Token
2. 邀請連結 scope 勾選 `bot` + `applications.commands`
3. Bot 權限：Connect、Speak、View Channels、Send Messages、Attach Files

## 指令

| 指令 | 說明 |
|---|---|
| `/record start` | 加入你所在的語音頻道並開始錄音 |
| `/record stop` | 停止錄音、等待辨識完成並產生逐字稿 |
| `/record status` | 查看錄音時長與已收到的段落數 |

## STT 引擎擴充

STT 是以 provider 介面設計的，內建：

- `typeless` — [Typeless External Transcript API](https://docs.typelessapi.com)（預設）。API key 到 [platform.typelessapi.com](https://platform.typelessapi.com) 申請（`tls_sk_` 開頭），模型可選 `typeless-1.0-lite` / `pro` / `max`。注意：Typeless 桌面 App 的帳號與 API 是分開的，裝了 App 仍需另外申請 API key。
- `openai-whisper` — OpenAI Audio Transcriptions API（改 `OPENAI_BASE_URL` 也可接 Groq 等相容服務）
- `dummy` — 不呼叫 API，只回報音訊長度，用來測試錄音流程

### 新增自己的 provider

1. 在 `src/stt/` 建立類別，繼承 `SttProvider` 並實作 `transcribe(wavBuffer, { language })`，回傳 `{ text }`：

```js
// src/stt/MyProvider.js
import { SttProvider } from './SttProvider.js';

export class MyProvider extends SttProvider {
  get name() { return 'my-stt'; }

  async transcribe(wavBuffer, { language }) {
    // wavBuffer 是 48kHz / 16-bit / stereo 的 WAV
    const text = await callYourApi(wavBuffer, language);
    return { text };
  }
}
```

2. 在 `src/stt/index.js` 的 `registry` 註冊：

```js
'my-stt': () => new MyProvider(),
```

3. `.env` 設定 `STT_PROVIDER=my-stt`

## 可調參數（.env）

| 變數 | 預設 | 說明 |
|---|---|---|
| `STT_PROVIDER` | `openai-whisper` | 使用的 STT 引擎 |
| `STT_LANGUAGE` | （自動偵測） | 辨識語言，例如 `zh` |
| `SILENCE_DURATION_MS` | `800` | 靜音多久視為段落結束 |
| `MIN_SEGMENT_MS` | `300` | 短於此長度的段落當雜音丟棄 |
| `TRANSCRIPT_DIR` | `transcripts` | 逐字稿輸出目錄 |

## 專案結構

```
src/
  index.js                  # 進入點：Discord client 與指令處理
  register-commands.js      # 註冊 slash commands
  config.js                 # 環境變數設定
  recorder/
    SessionManager.js       # 管理各伺服器的錄音 session
    RecordingSession.js     # 音訊擷取：Opus → PCM → WAV → 送 STT
  stt/
    SttProvider.js          # provider 基底類別（擴充點）
    OpenAIWhisperProvider.js
    DummyProvider.js
    index.js                # provider 註冊表
  transcript/
    formatter.js            # 逐字稿格式
  utils/
    wav.js                  # PCM → WAV
    time.js                 # 時間格式化
```

## 注意事項

- 錄音涉及隱私，請先取得頻道成員同意。
- Bot 的 `selfDeaf` 必須為 `false` 才收得到音訊（程式已設定）。
- 每位使用者的音訊是分開擷取的，多人同時說話會各自產生段落，逐字稿依開始時間排序。
