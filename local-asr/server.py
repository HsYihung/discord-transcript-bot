"""本地 Qwen3-ASR OpenAI 相容伺服器。

mlx-qwen3-asr 內建的 serve 在多執行緒下有 MLX GPU stream bug，
這裡改用單一專屬執行緒載入與推理（所有請求排隊進同一條執行緒），
提供 POST /v1/audio/transcriptions（multipart: file, model, language）。
"""

import os
import tempfile
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
import uvicorn

MODEL = os.environ.get("ASR_MODEL", "Qwen/Qwen3-ASR-1.7B")
PORT = int(os.environ.get("ASR_PORT", "8765"))
API_KEY = os.environ.get("ASR_API_KEY", "local-qwen")

LANGUAGE_MAP = {"zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean"}

app = FastAPI()
# MLX 的模型與 GPU stream 綁定執行緒：載入與推理全部走這一條
worker = ThreadPoolExecutor(max_workers=1)
session = None


def _load():
    global session
    from mlx_qwen3_asr import Session

    session = Session(model=MODEL)
    print(f"[asr] 模型已載入: {MODEL}")


def _transcribe(path: str, language: str | None):
    result = session.transcribe(path, language=LANGUAGE_MAP.get(language, None))
    # MLX 快取會隨請求累積（實測 5.8GB → 8.3GB），每次辨識後釋放
    try:
        import mlx.core as mx

        mx.clear_cache()
    except Exception:
        pass
    return result.text


@app.on_event("startup")
def startup():
    worker.submit(_load).result()


@app.get("/v1/models")
def models():
    return {"data": [{"id": MODEL}]}


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: UploadFile = File(...),
    model: str = Form(None),
    language: str = Form(None),
    prompt: str = Form(None),
    response_format: str = Form(None),
    authorization: str = Header(None),
):
    if authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    data = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        text = worker.submit(_transcribe, path, language).result(timeout=300)
    finally:
        os.unlink(path)
    return {"text": text}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
