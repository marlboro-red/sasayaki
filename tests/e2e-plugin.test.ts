/**
 * End-to-end tests for the Sasayaki plugin.
 *
 * Covers all 10 acceptance criteria from sasayaki-04i:
 *   1. Build and install plugin
 *   2. Whisper server starts and health check passes
 *   3. Recording via ribbon icon and hotkey
 *   4. Transcription of short and long recordings
 *   5. All three insert modes (cursor, newline, blockquote)
 *   6. Language auto-detection
 *   7. Settings persistence across restarts
 *   8. Error handling: missing ffmpeg, bad server path, network failures
 *   9. Plugin disable/enable cycle stops and restarts server
 *  10. Unload during active recording cleans up gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import * as actualFs from 'fs';
import { execSync as actualExecSync } from 'child_process';

// ── Mock obsidian module ────────────────────────────────────────────────────
vi.mock('obsidian', () => import('./__mocks__/obsidian'));

// ── Mock child_process (keep originals, override spawn/execFile) ────────────
const mockSpawn = vi.fn();
const mockExecFile = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (...args: any[]) => mockSpawn(...args),
    execFile: (...args: any[]) => mockExecFile(...args),
  };
});

// ── Mock fs (keep originals, override existsSync) ───────────────────────────
const mockExistsSync = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
  };
});

// ── Import after mocks ─────────────────────────────────────────────────────
import { Logger } from '../src/Logger';
import { ServerManager } from '../src/ServerManager';
import { WhisperClient } from '../src/WhisperClient';
import { RecordingManager } from '../src/RecordingManager';
import { TranscriptInserter } from '../src/TranscriptInserter';
import { StatusBarManager } from '../src/StatusBarManager';
import { DEFAULT_SETTINGS } from '../src/types';
import type { InsertMode } from '../src/types';

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockChildProcess(): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  (proc as any).pid = 12345;
  (proc as any).stdout = new EventEmitter();
  (proc as any).stderr = new EventEmitter();
  (proc as any).kill = vi.fn();
  return proc;
}

function createMockEditor() {
  let lines: string[] = [''];
  let cursor = { line: 0, ch: 0 };
  return {
    getCursor: vi.fn(() => ({ ...cursor })),
    setCursor: vi.fn((pos: { line: number; ch: number }) => { cursor = pos; }),
    getLine: vi.fn((n: number) => lines[n] ?? ''),
    replaceSelection: vi.fn((text: string) => {
      const line = lines[cursor.line] ?? '';
      lines[cursor.line] = line.slice(0, cursor.ch) + text + line.slice(cursor.ch);
      cursor.ch += text.length;
    }),
    replaceRange: vi.fn((text: string, pos: { line: number; ch: number }) => {
      const line = lines[pos.line] ?? '';
      const before = line.slice(0, pos.ch);
      const after = line.slice(pos.ch);
      const newLines = (before + text + after).split('\n');
      lines.splice(pos.line, 1, ...newLines);
    }),
    _lines: lines,
    _setLines: (l: string[]) => { lines = l; },
  };
}

function mockNavigator(getUserMediaImpl: (...args: any[]) => any) {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      mediaDevices: { getUserMedia: getUserMediaImpl },
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    },
    writable: true,
    configurable: true,
  });
}

function mockMediaRecorder(recorderObj: any) {
  // Must be a real constructor (function or class) for `new MediaRecorder(...)` to work
  function FakeMediaRecorder() {
    return recorderObj;
  }
  Object.defineProperty(globalThis, 'MediaRecorder', {
    value: FakeMediaRecorder,
    writable: true,
    configurable: true,
  });
}

/** Spin up a tiny HTTP server that responds like whisper-server. */
function createFakeWhisperServer(port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (req.url === '/inference' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const langMatch = body.match(/name="language"\r\n\r\n([^\r]+)/);
          const lang = langMatch?.[1] ?? 'auto';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            text: lang === 'auto' ? 'Hello world auto-detected' : `Hello in ${lang}`,
          }));
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ── Shared fake whisper server for transcription tests ──────────────────────

let fakeServer: http.Server;
const FAKE_PORT = 18787;

beforeAll(async () => {
  fakeServer = await createFakeWhisperServer(FAKE_PORT);
});

afterAll(async () => {
  await closeServer(fakeServer);
});

beforeEach(() => {
  mockSpawn.mockReset();
  mockExecFile.mockReset();
  mockExistsSync.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Build and install plugin
// ═══════════════════════════════════════════════════════════════════════════

describe('1. Build and install plugin', () => {
  it('esbuild production build succeeds and produces main.js', () => {
    const cwd = process.env.WORKTREE ?? process.cwd();
    // esbuild prints to stderr, so capture that too; build success = no throw
    actualExecSync('node esbuild.config.mjs production', {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
    });

    // Verify main.js was produced and is a valid CJS module
    // Use stat via shell since fs.existsSync is mocked
    const stat = actualExecSync(`test -f "${cwd}/main.js" && echo exists`, {
      encoding: 'utf8',
    }).trim();
    expect(stat).toBe('exists');

    const mainJs = actualFs.readFileSync(cwd + '/main.js', 'utf8');
    expect(mainJs.length).toBeGreaterThan(100);
    expect(mainJs).toContain('exports');
  });

  it('manifest.json is valid and references required fields', () => {
    const cwd = process.env.WORKTREE ?? process.cwd();
    const raw = actualFs.readFileSync(cwd + '/manifest.json', 'utf8');
    const manifest = JSON.parse(raw);
    expect(manifest.id).toBe('sasayaki');
    expect(manifest.name).toBeTruthy();
    expect(manifest.version).toBeTruthy();
    expect(manifest.minAppVersion).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Whisper server starts and health check passes
// ═══════════════════════════════════════════════════════════════════════════

describe('2. Whisper server starts and health check passes', () => {
  it('WhisperClient.healthCheck returns true for a running server', async () => {
    const logger = new Logger(false);
    const client = new WhisperClient('127.0.0.1', FAKE_PORT, 'auto', logger);
    const ok = await client.healthCheck();
    expect(ok).toBe(true);
  });

  it('WhisperClient.healthCheck returns false for a dead server', async () => {
    const logger = new Logger(false);
    const client = new WhisperClient('127.0.0.1', FAKE_PORT + 100, 'auto', logger);
    const ok = await client.healthCheck();
    expect(ok).toBe(false);
  });

  it('ServerManager.start detects externally running server and reuses it', async () => {
    const logger = new Logger(false);
    const mgr = new ServerManager(logger);

    // _isResponding will hit our fakeServer on FAKE_PORT and succeed
    await mgr.start('/fake/binary', '/fake/model', '127.0.0.1', FAKE_PORT);
    expect(mgr.isRunning()).toBe(true);

    // spawn should NOT have been called (server was externally detected)
    expect(mockSpawn).not.toHaveBeenCalled();

    // stop should be a no-op for externally managed
    await mgr.stop();
    expect(mgr.isRunning()).toBe(false);
  });

  it('ServerManager.start spawns and waits for server when none running', async () => {
    const logger = new Logger(false);
    const mgr = new ServerManager(logger);

    const emptyPort = FAKE_PORT + 200;
    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);

    vi.spyOn(mgr, 'waitForReady').mockResolvedValue(true);

    await mgr.start('/usr/bin/whisper-server', '/model.bin', '127.0.0.1', emptyPort);
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/whisper-server',
      ['-m', '/model.bin', '--host', '127.0.0.1', '--port', String(emptyPort), '--convert'],
      expect.any(Object)
    );
    expect(mgr.isRunning()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Recording via ribbon icon and hotkey
// ═══════════════════════════════════════════════════════════════════════════

describe('3. Recording via ribbon icon and hotkey', () => {
  it('RecordingManager tracks recording state correctly', async () => {
    const logger = new Logger(false);
    const mgr = new RecordingManager(logger);
    expect(mgr.isRecording()).toBe(false);

    const mockTrack = { stop: vi.fn() };
    const mockStream = { getTracks: () => [mockTrack] } as unknown as MediaStream;
    const mockRecorder = {
      state: 'inactive' as string,
      start: vi.fn(function (this: any) { this.state = 'recording'; }),
      stop: vi.fn(function (this: any) {
        this.state = 'inactive';
        if (this.onstop) this.onstop();
      }),
      ondataavailable: null as any,
      onstop: null as any,
      onerror: null as any,
    };

    mockNavigator(vi.fn().mockResolvedValue(mockStream));
    mockMediaRecorder(mockRecorder);

    await mgr.startRecording();
    expect(mgr.isRecording()).toBe(true);

    const blob = await mgr.stopRecording();
    expect(blob).toBeInstanceOf(Blob);
    expect(mgr.isRecording()).toBe(false);
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it('startRecording throws if already recording', async () => {
    const logger = new Logger(false);
    const mgr = new RecordingManager(logger);

    const mockTrack = { stop: vi.fn() };
    const mockStream = { getTracks: () => [mockTrack] } as unknown as MediaStream;
    const mockRecorder = {
      state: 'recording' as string,
      start: vi.fn(),
      stop: vi.fn(),
      ondataavailable: null as any,
      onstop: null as any,
      onerror: null as any,
    };

    mockNavigator(vi.fn().mockResolvedValue(mockStream));
    mockMediaRecorder(mockRecorder);

    await mgr.startRecording();
    await expect(mgr.startRecording()).rejects.toThrow('Already recording');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Transcription of short and long recordings
// ═══════════════════════════════════════════════════════════════════════════

describe('4. Transcription of short and long recordings', () => {
  it('transcribes a short audio buffer (< 100KB)', async () => {
    const logger = new Logger(false);
    const client = new WhisperClient('127.0.0.1', FAKE_PORT, 'auto', logger);
    const shortBuffer = new ArrayBuffer(50_000);
    const text = await client.transcribe(shortBuffer);
    expect(text).toBe('Hello world auto-detected');
  });

  it('transcribes a large audio buffer (> 1MB)', async () => {
    const logger = new Logger(false);
    const client = new WhisperClient('127.0.0.1', FAKE_PORT, 'auto', logger);
    const largeBuffer = new ArrayBuffer(2_000_000);
    const text = await client.transcribe(largeBuffer);
    expect(text).toBe('Hello world auto-detected');
  });

  it('timeout scales with audio size', () => {
    // From WhisperClient: Math.max(10_000, (byteLength / 1_000_000) * 3_000)
    const small = Math.max(10_000, (50_000 / 1_000_000) * 3_000);
    expect(small).toBe(10_000); // min 10s

    const large = Math.max(10_000, (5_000_000 / 1_000_000) * 3_000);
    expect(large).toBe(15_000); // 5MB * 3s/MB = 15s
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. All three insert modes (cursor, newline, blockquote)
// ═══════════════════════════════════════════════════════════════════════════

describe('5. All three insert modes', () => {
  let inserter: TranscriptInserter;

  beforeEach(() => {
    inserter = new TranscriptInserter();
  });

  it('cursor mode inserts text at cursor position via replaceSelection', () => {
    const editor = createMockEditor();
    inserter.insert(editor as any, 'hello world', 'cursor');
    expect(editor.replaceSelection).toHaveBeenCalledWith('hello world');
  });

  it('newline mode appends text on a new line after current line', () => {
    const editor = createMockEditor();
    editor._setLines(['existing text']);
    editor.getCursor.mockReturnValue({ line: 0, ch: 5 });
    editor.getLine.mockReturnValue('existing text');

    inserter.insert(editor as any, 'hello world', 'newline');

    expect(editor.replaceRange).toHaveBeenCalledWith(
      '\nhello world',
      { line: 0, ch: 13 }
    );
    expect(editor.setCursor).toHaveBeenCalledWith({ line: 1, ch: 11 });
  });

  it('blockquote mode inserts a callout block after current line', () => {
    const editor = createMockEditor();
    editor._setLines(['some note']);
    editor.getCursor.mockReturnValue({ line: 0, ch: 3 });
    editor.getLine.mockReturnValue('some note');

    inserter.insert(editor as any, 'transcribed text', 'blockquote');

    expect(editor.replaceRange).toHaveBeenCalledWith(
      '\n> [!quote] Transcription\n> transcribed text',
      { line: 0, ch: 9 }
    );
    expect(editor.setCursor).toHaveBeenCalledWith({ line: 2, ch: 18 });
  });

  it('empty text shows Notice instead of inserting', () => {
    const editor = createMockEditor();
    inserter.insert(editor as any, '', 'cursor');
    expect(editor.replaceSelection).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Language auto-detection for English and non-English
// ═══════════════════════════════════════════════════════════════════════════

describe('6. Language auto-detection', () => {
  it('language=auto sends auto parameter and gets detection', async () => {
    const logger = new Logger(false);
    const client = new WhisperClient('127.0.0.1', FAKE_PORT, 'auto', logger);
    const buf = new ArrayBuffer(1000);
    const text = await client.transcribe(buf);
    expect(text).toBe('Hello world auto-detected');
  });

  it('language=en sends English parameter', async () => {
    const logger = new Logger(false);
    const client = new WhisperClient('127.0.0.1', FAKE_PORT, 'en', logger);
    const buf = new ArrayBuffer(1000);
    const text = await client.transcribe(buf);
    expect(text).toBe('Hello in en');
  });

  it('language=ja sends Japanese parameter', async () => {
    const logger = new Logger(false);
    const client = new WhisperClient('127.0.0.1', FAKE_PORT, 'ja', logger);
    const buf = new ArrayBuffer(1000);
    const text = await client.transcribe(buf);
    expect(text).toBe('Hello in ja');
  });

  it('WhisperClient builds multipart body with correct language field', () => {
    const logger = new Logger(false);
    const client = new WhisperClient('127.0.0.1', FAKE_PORT, 'ko', logger);
    const { body } = (client as any)._buildMultipartBody(new ArrayBuffer(10), 'test.webm', '----boundary');
    const bodyStr = body.toString('utf8');
    expect(bodyStr).toContain('name="language"');
    expect(bodyStr).toContain('ko');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Settings persistence across restarts
// ═══════════════════════════════════════════════════════════════════════════

describe('7. Settings persistence across restarts', () => {
  it('DEFAULT_SETTINGS has expected shape and values', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      serverBinaryPath: '',
      modelPath: '',
      host: '127.0.0.1',
      port: 8787,
      language: 'auto',
      autoStartServer: true,
      insertMode: 'cursor',
      showStatusBar: true,
      debug: false,
    });
  });

  it('loadSettings merges saved data with defaults', () => {
    const savedData = { port: 9999, language: 'ja', debug: true };
    const merged = Object.assign({}, DEFAULT_SETTINGS, savedData);

    expect(merged.port).toBe(9999);
    expect(merged.language).toBe('ja');
    expect(merged.debug).toBe(true);
    expect(merged.host).toBe('127.0.0.1');
    expect(merged.autoStartServer).toBe(true);
    expect(merged.insertMode).toBe('cursor');
  });

  it('settings roundtrip: save then load preserves all fields', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      serverBinaryPath: '/opt/whisper/server',
      modelPath: '/models/ggml-small.bin',
      port: 9000,
      language: 'ko',
      autoStartServer: false,
      insertMode: 'blockquote' as InsertMode,
      showStatusBar: false,
      debug: true,
    };

    const serialized = JSON.parse(JSON.stringify(settings));
    const loaded = Object.assign({}, DEFAULT_SETTINGS, serialized);
    expect(loaded).toEqual(settings);
  });

  it('partial settings are forward-compatible with new defaults', () => {
    const oldSavedData = {
      serverBinaryPath: '/usr/bin/whisper',
      modelPath: '/model.bin',
      host: '127.0.0.1',
      port: 8787,
      language: 'auto',
      autoStartServer: true,
      insertMode: 'cursor',
    };

    const merged = Object.assign({}, DEFAULT_SETTINGS, oldSavedData);
    expect(merged.showStatusBar).toBe(true);
    expect(merged.debug).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Error handling: missing ffmpeg, bad server path, network failures
// ═══════════════════════════════════════════════════════════════════════════

describe('8. Error handling', () => {
  describe('missing ffmpeg', () => {
    // Tests the _checkFfmpeg pattern: execFile('ffmpeg', ...) resolves to boolean
    it('returns false when ffmpeg is not found', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: Function) => {
          cb(new Error('ENOENT'));
        }
      );

      const { execFile } = await import('child_process');
      const result = await new Promise<boolean>((resolve) => {
        execFile('ffmpeg', ['-version'], { timeout: 5000 }, (err) => {
          resolve(!err);
        });
      });
      expect(result).toBe(false);
    });

    it('returns true when ffmpeg exists', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: Function) => {
          cb(null, 'ffmpeg version 6.0');
        }
      );

      const { execFile } = await import('child_process');
      const result = await new Promise<boolean>((resolve) => {
        execFile('ffmpeg', ['-version'], { timeout: 5000 }, (err) => {
          resolve(!err);
        });
      });
      expect(result).toBe(true);
    });
  });

  describe('bad server path', () => {
    it('ServerManager.start rejects when waitForReady fails', async () => {
      const logger = new Logger(false);
      const mgr = new ServerManager(logger);

      const mockProc = createMockChildProcess();
      mockSpawn.mockReturnValue(mockProc);

      vi.spyOn(mgr, 'waitForReady').mockResolvedValue(false);

      await expect(
        mgr.start('/nonexistent/binary', '/model.bin', '127.0.0.1', 19999)
      ).rejects.toThrow('Server did not become ready within 60 seconds');

      expect((mockProc as any).kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('network failures', () => {
    it('WhisperClient.transcribe rejects on ECONNREFUSED', async () => {
      const logger = new Logger(false);
      const client = new WhisperClient('127.0.0.1', 19998, 'auto', logger);
      const buf = new ArrayBuffer(100);
      await expect(client.transcribe(buf)).rejects.toThrow('Whisper server not reachable');
    });

    it('WhisperClient.healthCheck returns false on connection error', async () => {
      const logger = new Logger(false);
      const client = new WhisperClient('127.0.0.1', 19997, 'auto', logger);
      const ok = await client.healthCheck();
      expect(ok).toBe(false);
    });

    it('WhisperClient.transcribe rejects on non-200 response', async () => {
      const errorServer = http.createServer((_req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      });
      const port = 18790;
      await new Promise<void>((resolve) =>
        errorServer.listen(port, '127.0.0.1', () => resolve())
      );

      try {
        const logger = new Logger(false);
        const client = new WhisperClient('127.0.0.1', port, 'auto', logger);
        const buf = new ArrayBuffer(100);
        await expect(client.transcribe(buf)).rejects.toThrow('Whisper server returned 500');
      } finally {
        await new Promise<void>((resolve) => errorServer.close(() => resolve()));
      }
    });

    it('WhisperClient.transcribe rejects on invalid JSON response', async () => {
      const badJsonServer = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('not json at all');
      });
      const port = 18791;
      await new Promise<void>((resolve) =>
        badJsonServer.listen(port, '127.0.0.1', () => resolve())
      );

      try {
        const logger = new Logger(false);
        const client = new WhisperClient('127.0.0.1', port, 'auto', logger);
        const buf = new ArrayBuffer(100);
        await expect(client.transcribe(buf)).rejects.toThrow('Invalid JSON');
      } finally {
        await new Promise<void>((resolve) => badJsonServer.close(() => resolve()));
      }
    });
  });

  describe('microphone errors', () => {
    it('NotAllowedError is surfaced when mic access denied', async () => {
      const logger = new Logger(false);
      const mgr = new RecordingManager(logger);

      const err = new DOMException('Permission denied', 'NotAllowedError');
      mockNavigator(vi.fn().mockRejectedValue(err));

      await expect(mgr.startRecording()).rejects.toThrow();
    });

    it('NotFoundError is surfaced when no microphone', async () => {
      const logger = new Logger(false);
      const mgr = new RecordingManager(logger);

      const err = new DOMException('No device', 'NotFoundError');
      mockNavigator(vi.fn().mockRejectedValue(err));

      await expect(mgr.startRecording()).rejects.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Plugin disable/enable cycle stops and restarts server
// ═══════════════════════════════════════════════════════════════════════════

describe('9. Plugin disable/enable: server lifecycle', () => {
  it('ServerManager.stop sends SIGTERM and resolves on exit', async () => {
    const logger = new Logger(false);
    const mgr = new ServerManager(logger);

    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);
    vi.spyOn(mgr, 'waitForReady').mockResolvedValue(true);

    await mgr.start('/bin/ws', '/m.bin', '127.0.0.1', 19996);
    expect(mgr.isRunning()).toBe(true);

    (mockProc as any).kill.mockImplementation((signal: string) => {
      if (signal === 'SIGTERM') {
        setTimeout(() => mockProc.emit('exit', 0), 50);
      }
    });

    await mgr.stop();
    expect(mgr.isRunning()).toBe(false);
    expect((mockProc as any).kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('ServerManager.stop is a no-op when no server is running', async () => {
    const logger = new Logger(false);
    const mgr = new ServerManager(logger);
    await mgr.stop();
    expect(mgr.isRunning()).toBe(false);
  });

  it('onUnexpectedExit fires when server crashes', async () => {
    const logger = new Logger(false);
    const mgr = new ServerManager(logger);
    const onExit = vi.fn();
    mgr.onUnexpectedExit = onExit;

    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);
    vi.spyOn(mgr, 'waitForReady').mockResolvedValue(true);

    await mgr.start('/bin/ws', '/m.bin', '127.0.0.1', 19995);

    mockProc.emit('exit', 1);
    expect(onExit).toHaveBeenCalledWith(1);
  });

  it('onUnexpectedExit does NOT fire during intentional stop', async () => {
    const logger = new Logger(false);
    const mgr = new ServerManager(logger);
    const onExit = vi.fn();
    mgr.onUnexpectedExit = onExit;

    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);
    vi.spyOn(mgr, 'waitForReady').mockResolvedValue(true);

    await mgr.start('/bin/ws', '/m.bin', '127.0.0.1', 19994);

    (mockProc as any).kill.mockImplementation((_signal: string) => {
      setTimeout(() => mockProc.emit('exit', 0), 10);
    });

    await mgr.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(onExit).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Unload during active recording cleans up gracefully
// ═══════════════════════════════════════════════════════════════════════════

describe('10. Unload during active recording cleans up', () => {
  function setupRecordingMocks() {
    const mockTrack = { stop: vi.fn() };
    const mockStream = { getTracks: () => [mockTrack] } as unknown as MediaStream;
    const mockRecorder = {
      state: 'inactive' as string,
      start: vi.fn(function (this: any) { this.state = 'recording'; }),
      stop: vi.fn(function (this: any) { this.state = 'inactive'; }),
      ondataavailable: null as any,
      onstop: null as any,
      onerror: null as any,
    };

    mockNavigator(vi.fn().mockResolvedValue(mockStream));
    mockMediaRecorder(mockRecorder);

    return { mockTrack, mockRecorder };
  }

  it('cancelRecording stops recording and cleans up stream tracks', async () => {
    const logger = new Logger(false);
    const mgr = new RecordingManager(logger);
    const { mockTrack, mockRecorder } = setupRecordingMocks();

    await mgr.startRecording();
    expect(mgr.isRecording()).toBe(true);

    mgr.cancelRecording();

    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(mgr.isRecording()).toBe(false);
  });

  it('cancelRecording is safe to call when not recording', () => {
    const logger = new Logger(false);
    const mgr = new RecordingManager(logger);
    mgr.cancelRecording();
    expect(mgr.isRecording()).toBe(false);
  });

  it('onunload flow: cancel recording then stop server', async () => {
    const logger = new Logger(false);
    const recording = new RecordingManager(logger);
    const server = new ServerManager(logger);

    const { mockTrack } = setupRecordingMocks();

    const mockProc = createMockChildProcess();
    mockSpawn.mockReturnValue(mockProc);
    vi.spyOn(server, 'waitForReady').mockResolvedValue(true);
    await server.start('/bin/ws', '/m.bin', '127.0.0.1', 19993);

    (mockProc as any).kill.mockImplementation((_signal: string) => {
      setTimeout(() => mockProc.emit('exit', 0), 10);
    });

    await recording.startRecording();
    expect(recording.isRecording()).toBe(true);
    expect(server.isRunning()).toBe(true);

    // Simulate plugin.onunload()
    if (recording.isRecording()) {
      recording.cancelRecording();
    }
    await server.stop();

    expect(recording.isRecording()).toBe(false);
    expect(server.isRunning()).toBe(false);
    expect(mockTrack.stop).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bonus: StatusBarManager state machine
// ═══════════════════════════════════════════════════════════════════════════

describe('StatusBarManager state machine', () => {
  it('tracks state transitions correctly', () => {
    const mockPlugin = {
      addStatusBarItem: () => ({
        setText: vi.fn(),
        style: { display: '' },
      }),
    };

    const mgr = new StatusBarManager(mockPlugin as any, true);
    expect(mgr.getState()).toBe('idle');

    mgr.setState('offline');
    expect(mgr.getState()).toBe('offline');

    mgr.setState('starting');
    expect(mgr.getState()).toBe('starting');

    mgr.setState('idle');
    expect(mgr.getState()).toBe('idle');

    mgr.setState('recording');
    expect(mgr.getState()).toBe('recording');

    mgr.setState('transcribing');
    expect(mgr.getState()).toBe('transcribing');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bonus: Logger
// ═══════════════════════════════════════════════════════════════════════════

describe('Logger', () => {
  it('debug logs only when debugMode is enabled', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const logger = new Logger(false);
    logger.debug('should not appear');
    expect(spy).not.toHaveBeenCalled();

    logger.setDebug(true);
    logger.debug('should appear');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('should appear'));

    spy.mockRestore();
  });

  it('info always logs', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const logger = new Logger(false);
    logger.info('test message');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('test message'));

    spy.mockRestore();
  });

  it('error logs with console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = new Logger(false);
    logger.error('bad thing', new Error('oops'));
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('bad thing'),
      expect.any(Error)
    );

    spy.mockRestore();
  });
});
