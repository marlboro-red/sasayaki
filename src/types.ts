export type InsertMode = 'cursor' | 'newline' | 'blockquote';

export interface SasayakiSettings {
  serverBinaryPath: string;
  modelPath: string;
  host: string;
  port: number;
  language: string;
  autoStartServer: boolean;
  insertMode: InsertMode;
  showStatusBar: boolean;
  debug: boolean;
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
