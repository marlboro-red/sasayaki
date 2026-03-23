# Sasayaki (囁き)

A local, private speech-to-text plugin for [Obsidian](https://obsidian.md). Sasayaki records from your microphone, sends audio to a [whisper.cpp](https://github.com/ggerganov/whisper.cpp) server running on your own machine, and inserts the transcription at the cursor — no cloud, no API keys, no data leaving your device.

**Platform:** macOS (Apple Silicon recommended for Metal acceleration)

---

## Prerequisites

You need three things before the plugin will work:

### 1. ffmpeg

ffmpeg converts the audio captured by Obsidian (WebM/Opus) into the WAV format that whisper.cpp expects. It must be on your `$PATH`.

```bash
brew install ffmpeg
```

Verify: `ffmpeg -version`

### 2. whisper.cpp (build from source)

```bash
# Clone whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp

# Build (Metal acceleration is enabled by default on Apple Silicon)
cmake -B build
cmake --build build --config Release

# Download the small model (good accuracy/speed balance)
./models/download-ggml-model.sh small
```

This produces:
- Binary: `whisper.cpp/build/bin/whisper-server`
- Model: `whisper.cpp/models/ggml-small.bin`

Note the absolute paths to both — you'll enter them in the plugin settings.

### 3. Obsidian (desktop)

The plugin requires the Obsidian desktop app (not mobile). It should already be installed.

---

## Installation

### Option A — Developer symlink (recommended for self-builds)

```bash
# From the sasayaki repo root:
ln -s "$(pwd)" "/path/to/your/vault/.obsidian/plugins/sasayaki"
```

Replace `/path/to/your/vault` with the actual path to your Obsidian vault.

### Option B — Manual copy

Copy the following files into `<vault>/.obsidian/plugins/sasayaki/`:
- `main.js`
- `manifest.json`
- `styles.css`

Then in Obsidian: **Settings → Community Plugins → Installed Plugins** → enable **Sasayaki**.

---

## First-Time Setup

1. In Obsidian, go to **Settings → Sasayaki**
2. Set **Server binary path** — the absolute path to your `whisper-server` binary
3. Set **Model path** — the absolute path to your `.bin` model file
4. Click **Test connection** to confirm the server is reachable (or let it auto-start)

---

## Settings Reference

| Setting | Default | Description |
|---------|---------|-------------|
| Server binary path | _(empty)_ | Absolute path to the `whisper-server` binary |
| Model path | _(empty)_ | Absolute path to the `ggml-*.bin` model file |
| Host | `127.0.0.1` | Hostname/IP where whisper-server listens |
| Port | `8787` | Port where whisper-server listens |
| Language | `auto` | Transcription language; `auto` lets Whisper detect it |
| Auto-start server | `on` | Start whisper-server automatically when the plugin loads |
| Insert mode | `cursor` | Where to insert transcribed text (see below) |
| Show status bar | `on` | Show server/recording state in the Obsidian status bar |
| Debug mode | `off` | Log verbose output to the developer console |

### Insert modes

- **At cursor** — replaces any active selection, or inserts at the cursor position
- **New line** — moves to the end of the current line and inserts on a new line
- **Blockquote** — inserts a `> [!quote] Transcription` callout block on a new line

---

## Usage

### Ribbon button

Click the microphone icon in the left ribbon to start recording. Click again to stop and transcribe. The icon pulses red while recording.

### Keyboard shortcut

Sasayaki does not set a default hotkey (to avoid conflicts). To bind one:

1. Go to **Settings → Hotkeys**
2. Search for `Sasayaki: Toggle recording`
3. Assign your preferred key — `Cmd+Shift+R` is a good choice

### Status bar

The status bar item (bottom of the window) shows:

| Text | Meaning |
|------|---------|
| `Whisper ready` | Server running, idle |
| `Recording...` | Microphone active |
| `Transcribing...` | Waiting for whisper-server response |
| `Server starting...` | whisper-server is loading the model |
| `Server offline` | Server not reachable |

---

## Troubleshooting

### "Server not reachable" / Server won't start

1. Check that **Server binary path** in settings points to the actual `whisper-server` binary
2. Check that **Model path** points to the `.bin` file
3. Try starting the server manually to see error output:
   ```bash
   /path/to/whisper-server \
     -m /path/to/ggml-small.bin \
     --host 127.0.0.1 \
     --port 8787 \
     --convert
   ```
4. Verify the health endpoint responds: `curl http://127.0.0.1:8787/health`

### Port conflict

If another process is using port 8787, either:
- Change the **Port** setting to a free port (e.g. `8788`), or
- Stop the other process

If a whisper-server is already running on the configured port, Sasayaki will detect it and reuse it without spawning a new process.

### ffmpeg not found

The `--convert` flag that Sasayaki passes to whisper-server requires ffmpeg on your `$PATH`. Verify:

```bash
which ffmpeg   # should print a path
ffmpeg -version
```

If missing: `brew install ffmpeg`

### Microphone permission denied

macOS requires explicit microphone permission for each application. If you see "Microphone access denied":

1. Open **System Settings → Privacy & Security → Microphone**
2. Enable access for **Obsidian**
3. Restart Obsidian

### "Nothing transcribed"

- Speak clearly and closer to the microphone
- Try a longer recording (at least 2–3 seconds)
- Check that you're using the correct language or `auto`

### Why no `fetch()` for the whisper server?

Obsidian runs in Electron with the origin `app://obsidian.md`. Chromium enforces CORS on all `fetch()` calls — including to localhost — and whisper-server does not set `Access-Control-Allow-Origin` headers. Sasayaki uses Node's `http` module (via `require('http')`) which bypasses the browser network stack entirely and is not subject to CORS restrictions. This is an intentional design decision.

### Debug mode

Enable **Debug mode** in settings to log detailed output to the developer console:

**View → Toggle Developer Tools → Console**

Look for lines prefixed with `[Sasayaki]` and `[Sasayaki:debug]`.

---

## Architecture

```
Obsidian (Electron renderer)
  └── SasayakiPlugin
        ├── ServerManager     — spawns/stops whisper-server child process
        ├── RecordingManager  — MediaRecorder, mic access, Blob assembly
        ├── WhisperClient     — Node http → whisper-server (no CORS)
        ├── TranscriptInserter — editor cursor/selection manipulation
        └── SettingsTab       — Obsidian settings UI
```

Audio never leaves the machine. The whisper-server child process is killed when the plugin is disabled or Obsidian quits.

---

## Model Recommendations

| Model | Size | Speed (Apple M-series) | Accuracy |
|-------|------|------------------------|----------|
| `tiny` | ~75 MB | Very fast (~0.3s) | Basic |
| `small` | ~466 MB | Fast (~0.5–1.5s) | Good |
| `medium` | ~1.5 GB | Moderate (~2–4s) | Better |
| `large` | ~3 GB | Slow (~5–10s) | Best |

The `small` model is recommended for real-time voice notes.

Download models with:
```bash
cd whisper.cpp
./models/download-ggml-model.sh small   # or tiny, medium, large
```
