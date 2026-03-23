# Sasayaki

Local speech-to-text for Obsidian via [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

囁き (*sasayaki*) means "whisper" in Japanese.

## Usage

Click the microphone ribbon icon or run **Sasayaki: Toggle recording** from the command palette to start/stop recording. Transcribed text is inserted at the cursor in the active note.

## Hotkey

No default hotkey is set to avoid conflicts. Bind one in **Settings → Hotkeys**. Suggested binding: `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows/Linux).

## Requirements

- Obsidian desktop (not mobile)
- whisper.cpp server running locally (see plugin settings for server URL)
