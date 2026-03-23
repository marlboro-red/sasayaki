export type InsertMode = 'cursor' | 'newline' | 'blockquote';

export interface SasayakiSettings {
  serverBinaryPath: string;    // Absolute path to whisper-server binary
  modelPath: string;           // Absolute path to .bin model file
  host: string;                // Default: '127.0.0.1'
  port: number;                // Default: 8787
  language: string;            // Default: 'auto' (whisper auto-detects)
  autoStartServer: boolean;    // Default: true
  insertMode: InsertMode;      // How to insert transcription
  showStatusBar: boolean;      // Default: true
  debug: boolean;              // Default: false — verbose console logging
}

export const DEFAULT_SETTINGS: SasayakiSettings = {
  serverBinaryPath: '',
  modelPath: '',
  host: '127.0.0.1',
  port: 8787,
  language: 'auto',
  autoStartServer: true,
  insertMode: 'cursor',
  showStatusBar: true,
  debug: false,
};

export type PluginState =
  | 'ready'
  | 'recording'
  | 'transcribing'
  | 'offline'
  | 'starting';
