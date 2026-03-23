# whisper.cpp Server Setup

This directory documents how to build and run `whisper-server` for use with the Sasayaki Obsidian plugin.

## Prerequisites

| Dependency | Purpose | Install |
|------------|---------|---------|
| Xcode Command Line Tools | C++ compiler (clang) | `xcode-select --install` |
| cmake | Build system | `brew install cmake` |
| ffmpeg | WebM → WAV transcoding at runtime | `brew install ffmpeg` |

> **Why ffmpeg?** Obsidian's `MediaRecorder` outputs WebM/Opus audio. whisper-server only accepts WAV natively. The `--convert` flag tells the server to shell out to ffmpeg at runtime to transcode incoming audio. ffmpeg must be on your `$PATH` — it is not a compile-time dependency.

---

## Build whisper.cpp

```bash
# Clone the repository
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp

# Configure and build
cmake -B build
cmake --build build --config Release
```

> **Metal acceleration:** On macOS / Apple Silicon, Metal GPU acceleration is enabled by default. You do **not** need to pass any cmake flags like `-DWHISPER_METAL=ON` — that flag is deprecated and Metal is the default on Apple platforms.

After a successful build, the server binary is at:

```
whisper.cpp/build/bin/whisper-server
```

---

## Download a Model

```bash
# From inside the whisper.cpp directory
./models/download-ggml-model.sh small
```

This downloads `ggml-small.bin` into `whisper.cpp/models/`. The `small` model gives a good accuracy/speed balance and runs well on Apple Silicon with Metal.

Available models (largest to smallest): `large-v3`, `medium`, `small`, `base`, `tiny`

> **Note:** For the large model, use `large-v3` explicitly — there is no `ggml-large.bin` on HuggingFace:
> ```bash
> ./models/download-ggml-model.sh large-v3   # produces ggml-large-v3.bin (~2.9 GB)
> ```

---

## Start the Server

```bash
./build/bin/whisper-server \
  -m models/ggml-small.bin \
  --host 127.0.0.1 \
  --port 8787 \
  --convert
```

| Flag | Purpose |
|------|---------|
| `-m models/ggml-small.bin` | Path to the GGML model file |
| `--host 127.0.0.1` | Bind to localhost only |
| `--port 8787` | Listen on port 8787 (Sasayaki default) |
| `--convert` | Enable ffmpeg-based audio transcoding (required for WebM) |

The server is ready when you see output like:

```
whisper_init_from_file_with_params_no_state: loading model from 'models/ggml-small.bin'
...
system_info: ...
http server listening at http://127.0.0.1:8787
```

---

## API Contract

### Health Check

```
GET /health
```

| Status | Body | Meaning |
|--------|------|---------|
| 200 | `{"status":"ok"}` | Server ready to accept requests |
| 503 | `{"status":"loading model"}` | Model is still loading (keep polling) |

### Transcription

```
POST /inference  (multipart/form-data)
```

Fields:

| Field | Value | Required |
|-------|-------|----------|
| `file` | Audio binary (WAV or WebM) | Yes |
| `response_format` | `json` | Yes |
| `language` | `auto` or ISO code (e.g. `en`, `ja`) | No (defaults to auto) |

Response (200):

```json
{ "text": " Hello, this is a test transcription." }
```

> Note: whisper often prepends a space to the text — callers should `.trim()` the result.

---

## Manual Verification

Run these commands to verify the server is working correctly:

```bash
# 1. Health check (expect 200 {"status":"ok"})
curl -s http://127.0.0.1:8787/health

# 2. WAV transcription (expect {"text":"..."})
curl -s \
  -F "file=@/path/to/test.wav" \
  -F "response_format=json" \
  http://127.0.0.1:8787/inference

# 3. WebM transcription (requires --convert + ffmpeg on PATH)
curl -s \
  -F "file=@/path/to/test.webm" \
  -F "response_format=json" \
  http://127.0.0.1:8787/inference

# 4. Language auto-detection
curl -s \
  -F "file=@/path/to/test.wav" \
  -F "response_format=json" \
  -F "language=auto" \
  http://127.0.0.1:8787/inference
```

All four commands should return valid JSON responses with transcribed text.

---

## Verified API Responses

All 5 acceptance criteria verified against whisper-server built from whisper.cpp (tiny model, Metal backend, macOS Apple Silicon):

### 1. Health check — ready state
```
GET /health → 200 {"status":"ok"}
```

### 2. Health check — loading state
```
GET /health → 503 {"status":"loading model"}   (during model initialization)
```

### 3. WAV transcription
```
POST /inference (file=jfk.wav, response_format=json)
→ 200 {"text":" And so my fellow Americans ask not what your country can do\n for you, ask what you can do for your country.\n"}
```

### 4. WebM transcription (--convert + ffmpeg)
```
POST /inference (file=jfk.webm, response_format=json)
→ 200 {"text":" And so my fellow Americans ask not what your country can do\n for you, ask what you can do for your country.\n"}
```
Identical transcription to WAV — ffmpeg transcoding is transparent.

### 5. language=auto
```
POST /inference (file=jfk.wav, response_format=json, language=auto)
→ 200 {"text":" And so my fellow Americans ask not what your country can do\n for you, ask what you can do for your country.\n"}
```
English auto-detected correctly.

### Response shape
`response_format=json` always returns `{"text": "..."}`. Note the leading space — callers must `.trim()` the text field.

---

## Troubleshooting

### `ffmpeg: command not found`

The server will fail to transcode WebM audio if ffmpeg is not on `$PATH`.

```bash
brew install ffmpeg
# Verify:
ffmpeg -version
```

### Port already in use

If port 8787 is taken, change the `--port` flag and update the Sasayaki plugin settings to match.

### Server crashes on startup

Check that:
- The model file path is correct and the file is complete (not a partial download)
- You have sufficient RAM (the `small` model needs ~500MB)

### Slow first transcription

The first request after startup may be slower while Metal shaders are compiled and cached. Subsequent requests will be faster.

### Model download fails

If `download-ggml-model.sh` fails, you can download models manually from:
`https://huggingface.co/ggerganov/whisper.cpp`

Place the downloaded `.bin` file in `whisper.cpp/models/`.
