# Discord 語音逐字稿 Bot

讓 bot 加入語音頻道錄音，擷取每位發言者的音訊、時間與身分，送到語音轉文字（STT）引擎辨識，停止錄音時輸出固定格式的 Markdown 逐字稿。預設使用**本地 Qwen3-ASR**（Apple Silicon / MLX，免費、無限量、語音不出機器），也可一鍵切換雲端引擎。

## 流程

```
/record start
  → bot 加入你所在的語音頻道
  → 偵測誰開始說話，逐封包解碼該使用者的 Opus 音訊（壞封包只丟 20ms，不毀整段）
  → 靜音超過門檻視為段落結束；封包間的真實停頓會補回靜音，保留語句節奏
  → 音量閘門過濾雜音段落（鍵盤聲、呼吸聲不送辨識）
  → 段落立即送 STT，辨識結果逐筆寫入 jsonl 流水帳（程序中斷也不丟資料）
  → 幻覺過濾：命中字幕套語（按讚訂閱、謝謝收看…）的結果自動剔除
/record stop
  → 立即離開頻道並回報辨識進度（每 5 秒更新）
  → 全部完成後依發言時間排序，輸出逐字稿（存到 transcripts/ 並附檔回覆）
```

中文輸出一律經 OpenCC 轉為台灣繁體（含慣用語），不受引擎原生輸出簡繁影響。

## 逐字稿格式

```markdown
# 語音逐字稿

- 頻道：會議室
- 開始時間：2026-08-01 14:00:00
- 結束時間：2026-08-01 14:30:00
- 參與者：Alice、Bob
- 辨識引擎：openai-whisper (Qwen/Qwen3-ASR-1.7B)

---

[00:00:05] Alice：大家好，今天開始開會
[00:00:12] Bob：好的，先看上週進度
```

另有 `transcripts/session-*.jsonl` 流水帳：每段辨識完成即逐筆落盤，可用於中斷復原或後處理。

## 安裝

需要 Node.js 18+；本地辨識另需 Python 3.10–3.13 與 ffmpeg（僅 Apple Silicon）。

```bash
npm install
cp .env.example .env   # 填入 DISCORD_TOKEN、CLIENT_ID 等
npm run register       # 註冊 slash commands（設 GUILD_ID 可立即生效）

# 本地 Qwen3-ASR（預設引擎）
brew install ffmpeg
python3.13 -m venv local-asr/venv
local-asr/venv/bin/pip install "mlx-qwen3-asr[serve]" fastapi uvicorn python-multipart
```

### 啟動（兩個終端）

```bash
npm run asr-server   # 終端 1：本地辨識引擎（首次會下載模型 ~3.4GB）
npm start            # 終端 2：Discord bot
```

asr-server 常駐約 4GB RAM；改用 0.6B 模型（`ASR_MODEL=Qwen/Qwen3-ASR-0.6B npm run asr-server`）可降到約 2GB、速度快近 3 倍。

### Discord Developer Portal 設定

1. <https://discord.com/developers/applications> 建立 Application → Bot，取得 Token
2. 邀請連結 scope 勾選 `bot` + `applications.commands`
3. Bot 權限：Connect、Speak、View Channels、Send Messages、Attach Files
4. 若伺服器的語音頻道有身分組限制，記得也給 bot 對應的「檢視頻道 + 連接」權限

## 指令

| 指令 | 說明 |
|---|---|
| `/record start` | 加入你所在的語音頻道並開始錄音 |
| `/record stop` | 停止錄音、顯示辨識進度、完成後附上逐字稿 |
| `/record status` | 查看錄音時長與已收到的段落數 |

## STT 引擎

以 provider 介面設計，`.env` 的 `STT_PROVIDER` 切換：

- `openai-whisper` — 任何 OpenAI 相容端點。預設指向**本地 Qwen3-ASR server**；改 `OPENAI_BASE_URL` 即可接 Groq（免費層跑 whisper-large-v3，設 `STT_MIN_INTERVAL_MS=3200` 避開 20 RPM 限速）或 OpenAI 官方
- `speechmatics` — Speechmatics Batch API（免費 480 分/月），`cmn_en` 中英雙語 pack，輸出自動轉繁
- `typeless` — Typeless External Transcript API（其開發者平台尚未公開，程式已就緒待其開放）
- `dummy` — 不呼叫 API，只回報音訊長度，測試錄音流程用

### 新增自己的 provider

1. 在 `src/stt/` 建立類別，繼承 `SttProvider` 並實作 `transcribe(wavBuffer, { language, prompt })`，回傳 `{ text }`
2. 在 `src/stt/index.js` 的 `registry` 註冊名稱
3. `.env` 設定 `STT_PROVIDER=你的名稱`

## 可調參數（.env）

| 變數 | 預設 | 說明 |
|---|---|---|
| `STT_PROVIDER` | `openai-whisper` | 使用的 STT provider |
| `STT_LANGUAGE` | （自動偵測） | 辨識語言，例如 `zh` |
| `STT_PROMPT` | （空） | Whisper 系引擎的引導詞。注意內容可能滲漏進辨識結果，繁體需求已由 OpenCC 處理，通常留空即可 |
| `STT_MIN_INTERVAL_MS` | `3200` | STT 請求最小間隔（雲端限速用；本地設 0） |
| `SILENCE_DURATION_MS` | `1500` | 靜音多久視為段落結束 |
| `MIN_SEGMENT_MS` | `300` | 短於此長度的段落當雜音丟棄 |
| `MIN_SEGMENT_RMS` | `300` | 最大視窗音量低於此值的段落當雜音丟棄 |
| `MERGE_GAP_MS` | `8000` | 同發言者間隔內的發言合併送辨識；設 `0` 停用（每段獨立成行） |
| `MAX_MERGED_DURATION_MS` | `120000` | 單一合併批次的音訊長度上限 |
| `TRANSCRIPT_DIR` | `transcripts` | 逐字稿與流水帳輸出目錄 |
| `DEBUG_SAVE_AUDIO` | （關） | 設 `1` 時每批送辨識的音訊存到 recordings/（除錯用，注意磁碟與隱私） |

## 專案結構

```
src/
  index.js                  # 進入點：Discord client 與指令處理
  register-commands.js      # 註冊 slash commands
  config.js                 # 環境變數設定
  recorder/
    SessionManager.js       # 管理各伺服器的錄音 session
    RecordingSession.js     # 音訊擷取、段落合併、jsonl 流水帳
  stt/
    SttProvider.js          # provider 基底類別（擴充點）
    OpenAIWhisperProvider.js  # OpenAI 相容端點（本地 Qwen3 / Groq / OpenAI）
    SpeechmaticsProvider.js
    TypelessProvider.js
    DummyProvider.js
    index.js                # provider 註冊表
  transcript/
    formatter.js            # 逐字稿格式
  utils/
    wav.js                  # PCM ↔ WAV、RMS 音量
    hallucination.js        # Whisper 幻覺（字幕套語）過濾
    throttle.js             # 速率限制與重試
    time.js                 # 時間格式化
local-asr/
  server.py                 # 本地 Qwen3-ASR 的 OpenAI 相容 server（MLX 單執行緒推理）
```

## 注意事項

- 錄音涉及隱私，請先取得頻道成員同意。
- Bot 的 `selfDeaf` 必須為 `false` 才收得到音訊（程式已設定）。
- 每位使用者的音訊是分開擷取的，多人同時說話會各自產生段落，逐字稿依開始時間排序。
- 一個 bot token 同一時間只能有一個程式使用——與其他 bot 共用 token 會導致 slash command 互動被隨機搶走。
- `@discordjs/voice` 需 0.18+（DAVE 語音加密協定），本專案鎖定 0.19。
