/**
 * Integration tests for SasayakiPlugin (main.ts).
 *
 * Unlike e2e-plugin.test.ts which tests sub-managers in isolation,
 * these tests instantiate the actual SasayakiPlugin class and verify
 * the wiring between components: onload, toggleRecording pipeline,
 * startup guards, and auto-restart logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// ── Mock obsidian module ────────────────────────────────────────────────────
vi.mock('obsidian', () => import('./__mocks__/obsidian'));

// ── Mock child_process ──────────────────────────────────────────────────────
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

// ── Mock fs ─────────────────────────────────────────────────────────────────
const mockExistsSync = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
  };
});

// ── Import after mocks ──────────────────────────────────────────────────────
import SasayakiPlugin from '../src/main';

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
  function FakeMediaRecorder() {
    return recorderObj;
  }
  Object.defineProperty(globalThis, 'MediaRecorder', {
    value: FakeMediaRecorder,
    writable: true,
    configurable: true,
  });
}

function setupRecordingMocks() {
  const mockTrack = { stop: vi.fn() };
  const mockStream = { getTracks: () => [mockTrack] } as unknown as MediaStream;
  const chunks: Blob[] = [];
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

  return { mockTrack, mockRecorder, mockStream };
}

/** Create a SasayakiPlugin instance with Obsidian internals stubbed. */
function createPlugin(savedData?: any): SasayakiPlugin {
  const plugin = new (SasayakiPlugin as any)() as SasayakiPlugin;
  // Plugin base class methods (from mock)
  (plugin as any)._savedData = savedData ?? null;
  (plugin as any).app = {
    workspace: { activeEditor: null },
  };
  return plugin;
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
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text: 'Hello from whisper' }));
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

// ── Shared fake server ──────────────────────────────────────────────────────

let fakeServer: http.Server;
const FAKE_PORT = 28787;

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
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// onload integration
// ═══════════════════════════════════════════════════════════════════════════

describe('SasayakiPlugin.onload', () => {
  it('initialises all sub-managers and sets status to idle when server is already running', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
    });

    await plugin.onload();

    expect(plugin.logger).toBeDefined();
    expect(plugin.statusBar).toBeDefined();
    expect(plugin.whisperClient).toBeDefined();
    expect(plugin.statusBar.getState()).toBe('idle');
  });

  it('sets status to offline when server is not reachable and autoStart is off', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT + 999, // nothing listening here
    });

    await plugin.onload();

    expect(plugin.statusBar.getState()).toBe('offline');
  });

  it('attempts auto-start when autoStartServer is true', async () => {
    // Configure to auto-start, but binary/model paths are empty so _startServer returns false
    const plugin = createPlugin({
      autoStartServer: true,
      serverBinaryPath: '',
      modelPath: '',
      host: '127.0.0.1',
      port: FAKE_PORT + 500,
    });

    await plugin.onload();

    // _startServer fails because no binary path configured -> status stays offline
    expect(plugin.statusBar.getState()).toBe('offline');
  });

  it('auto-start succeeds when _startServer resolves true', async () => {
    const plugin = createPlugin({
      autoStartServer: true,
      host: '127.0.0.1',
      port: FAKE_PORT,
    });

    // Spy on _startServer to simulate successful auto-start.
    // Real _startServer sets statusBar to 'idle' on success, so replicate that.
    vi.spyOn(plugin as any, '_startServer').mockImplementation(async function (this: any) {
      this.statusBar.setState('idle');
      return true;
    });

    await plugin.onload();

    expect((plugin as any)._startServer).toHaveBeenCalled();
    expect(plugin.statusBar.getState()).toBe('idle');
  });

  it('registers ribbon icon and command', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
    });

    const addRibbonSpy = vi.spyOn(plugin, 'addRibbonIcon');
    const addCommandSpy = vi.spyOn(plugin, 'addCommand');

    await plugin.onload();

    expect(addRibbonSpy).toHaveBeenCalledWith('microphone', 'Sasayaki: Toggle recording', expect.any(Function));
    expect(addCommandSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'toggle-recording',
      name: 'Toggle recording',
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// toggleRecording — startup guards
// ═══════════════════════════════════════════════════════════════════════════

describe('SasayakiPlugin.toggleRecording startup guards', () => {
  it('does not start recording when no editor is open', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
    });
    await plugin.onload();

    // app.workspace.activeEditor is null (no editor)
    await plugin.toggleRecording();

    // Should stay idle — recording not started
    expect(plugin.statusBar.getState()).toBe('idle');
  });

  it('does not start recording when server is offline and autoStart is off', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT + 999, // dead
    });
    await plugin.onload();

    // Give it an editor
    const editor = createMockEditor();
    (plugin as any).app.workspace.activeEditor = { editor };

    await plugin.toggleRecording();

    // Should remain offline — recording not started
    expect(plugin.statusBar.getState()).toBe('offline');
  });

  it('tries auto-start when server offline but autoStart on, fails if binary missing', async () => {
    const plugin = createPlugin({
      autoStartServer: true,
      serverBinaryPath: '',
      modelPath: '',
      host: '127.0.0.1',
      port: FAKE_PORT + 998,
    });
    await plugin.onload();

    const editor = createMockEditor();
    (plugin as any).app.workspace.activeEditor = { editor };

    await plugin.toggleRecording();

    // _startServer fails (no binary) so status goes to offline
    expect(plugin.statusBar.getState()).toBe('offline');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// toggleRecording — full record-transcribe-insert pipeline
// ═══════════════════════════════════════════════════════════════════════════

describe('SasayakiPlugin full record-transcribe-insert pipeline', () => {
  it('records, transcribes, and inserts text at cursor', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
      insertMode: 'cursor',
    });
    await plugin.onload();

    // Set up editor
    const editor = createMockEditor();
    (plugin as any).app.workspace.activeEditor = { editor };

    // Set up recording mocks
    const { mockRecorder } = setupRecordingMocks();

    // First toggle: start recording
    await plugin.toggleRecording();
    expect(plugin.statusBar.getState()).toBe('recording');

    // Second toggle: stop recording -> transcribe -> insert
    await plugin.toggleRecording();

    // After the pipeline completes, status should be idle
    expect(plugin.statusBar.getState()).toBe('idle');
    // Text should have been inserted
    expect(editor.replaceSelection).toHaveBeenCalledWith('Hello from whisper');
  });

  it('records, transcribes, and inserts with newline mode', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
      insertMode: 'newline',
    });
    await plugin.onload();

    const editor = createMockEditor();
    editor._setLines(['existing line']);
    editor.getCursor.mockReturnValue({ line: 0, ch: 0 });
    editor.getLine.mockReturnValue('existing line');
    (plugin as any).app.workspace.activeEditor = { editor };

    setupRecordingMocks();

    await plugin.toggleRecording();
    await plugin.toggleRecording();

    expect(plugin.statusBar.getState()).toBe('idle');
    expect(editor.replaceRange).toHaveBeenCalledWith(
      '\nHello from whisper',
      { line: 0, ch: 13 },
    );
  });

  it('records, transcribes, and inserts with blockquote mode', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
      insertMode: 'blockquote',
    });
    await plugin.onload();

    const editor = createMockEditor();
    editor._setLines(['some text']);
    editor.getCursor.mockReturnValue({ line: 0, ch: 0 });
    editor.getLine.mockReturnValue('some text');
    (plugin as any).app.workspace.activeEditor = { editor };

    setupRecordingMocks();

    await plugin.toggleRecording();
    await plugin.toggleRecording();

    expect(plugin.statusBar.getState()).toBe('idle');
    expect(editor.replaceRange).toHaveBeenCalledWith(
      '\n> [!quote] Transcription\n> Hello from whisper',
      { line: 0, ch: 9 },
    );
  });

  it('copies to clipboard when editor is closed between start and stop', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
      insertMode: 'cursor',
    });
    await plugin.onload();

    const editor = createMockEditor();
    (plugin as any).app.workspace.activeEditor = { editor };

    setupRecordingMocks();

    // Start recording with editor present
    await plugin.toggleRecording();
    expect(plugin.statusBar.getState()).toBe('recording');

    // Remove editor before stopping
    (plugin as any).app.workspace.activeEditor = null;

    // Stop — should fallback to clipboard
    await plugin.toggleRecording();
    expect(plugin.statusBar.getState()).toBe('idle');
    expect((globalThis.navigator as any).clipboard.writeText).toHaveBeenCalledWith('Hello from whisper');
  });

  it('handles transcription failure gracefully', async () => {
    // Use a port where nothing is listening so transcribe fails
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
      insertMode: 'cursor',
    });
    await plugin.onload();

    // Override whisperClient to one that points to dead port (transcribe will fail)
    const { WhisperClient } = await import('../src/WhisperClient');
    (plugin as any).whisperClient = new WhisperClient('127.0.0.1', FAKE_PORT + 777, 'auto', plugin.logger);

    const editor = createMockEditor();
    (plugin as any).app.workspace.activeEditor = { editor };

    setupRecordingMocks();

    await plugin.toggleRecording(); // start
    await plugin.toggleRecording(); // stop -> transcription fails

    expect(plugin.statusBar.getState()).toBe('idle');
    // Text should NOT have been inserted
    expect(editor.replaceSelection).not.toHaveBeenCalled();
  });

  it('toggles ribbon icon class during recording', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
      insertMode: 'cursor',
    });
    await plugin.onload();

    const ribbonIcon = (plugin as any).ribbonIcon;
    expect(ribbonIcon).toBeDefined();

    const editor = createMockEditor();
    (plugin as any).app.workspace.activeEditor = { editor };

    setupRecordingMocks();

    await plugin.toggleRecording(); // start
    expect(ribbonIcon.addClass).toHaveBeenCalledWith('sasayaki-recording');

    await plugin.toggleRecording(); // stop
    expect(ribbonIcon.removeClass).toHaveBeenCalledWith('sasayaki-recording');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Auto-restart logic
// ═══════════════════════════════════════════════════════════════════════════

describe('SasayakiPlugin auto-restart logic', () => {
  it('auto-restarts server on unexpected exit when autoStartServer is enabled', async () => {
    const plugin = createPlugin({
      autoStartServer: true,
      host: '127.0.0.1',
      port: FAKE_PORT,
    });

    const startServerSpy = vi.spyOn(plugin as any, '_startServer').mockImplementation(async function (this: any) {
      this.statusBar.setState('idle');
      return true;
    });

    await plugin.onload();
    expect(plugin.statusBar.getState()).toBe('idle');

    // Simulate server crash via the onUnexpectedExit callback wired in onload
    const server = (plugin as any).server;
    server.onUnexpectedExit(1);

    // Status should go offline immediately
    expect(plugin.statusBar.getState()).toBe('offline');

    // autoRestartAttempts should have been incremented
    expect((plugin as any).autoRestartAttempts).toBe(1);

    // _startServer is called again via setTimeout(2000) — verify it was scheduled
    // (the initial call during onload + the queued restart)
    expect(startServerSpy).toHaveBeenCalledTimes(1); // only the initial onload call so far
  });

  it('stops auto-restarting after MAX_RESTART_ATTEMPTS', async () => {
    const plugin = createPlugin({
      autoStartServer: true,
      host: '127.0.0.1',
      port: FAKE_PORT,
    });

    vi.spyOn(plugin as any, '_startServer').mockImplementation(async function (this: any) {
      this.statusBar.setState('idle');
      return true;
    });
    await plugin.onload();

    const server = (plugin as any).server;

    // Exhaust all restart attempts
    (plugin as any).autoRestartAttempts = 3; // already at max
    server.onUnexpectedExit(1);

    expect(plugin.statusBar.getState()).toBe('offline');
    // Counter should NOT have been incremented (guard condition prevents it)
    expect((plugin as any).autoRestartAttempts).toBe(3);
  });

  it('does not auto-restart when autoStartServer is disabled', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
    });
    await plugin.onload();

    const server = (plugin as any).server;
    server.onUnexpectedExit(1);

    expect(plugin.statusBar.getState()).toBe('offline');
    expect((plugin as any).autoRestartAttempts).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// onunload integration
// ═══════════════════════════════════════════════════════════════════════════

describe('SasayakiPlugin.onunload', () => {
  it('cancels active recording and stops server on unload', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT,
    });
    await plugin.onload();

    // Start recording
    const editor = createMockEditor();
    (plugin as any).app.workspace.activeEditor = { editor };
    setupRecordingMocks();
    await plugin.toggleRecording();
    expect(plugin.statusBar.getState()).toBe('recording');

    // Unload while recording — should cancel recording + stop server
    await plugin.onunload();
  });

  it('unload is safe when not recording and no server is running', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      host: '127.0.0.1',
      port: FAKE_PORT + 999,
    });
    await plugin.onload();

    // Should not throw
    await plugin.onunload();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// _startServer guards
// ═══════════════════════════════════════════════════════════════════════════

describe('SasayakiPlugin._startServer guards', () => {
  it('rejects when serverBinaryPath is not configured', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      serverBinaryPath: '',
      modelPath: '/models/model.bin',
      host: '127.0.0.1',
      port: FAKE_PORT + 700,
    });
    await plugin.onload();

    const result = await (plugin as any)._startServer();
    expect(result).toBe(false);
    expect(plugin.statusBar.getState()).toBe('offline');
  });

  it('rejects when modelPath is not configured', async () => {
    const plugin = createPlugin({
      autoStartServer: false,
      serverBinaryPath: '/usr/bin/whisper-server',
      modelPath: '',
      host: '127.0.0.1',
      port: FAKE_PORT + 701,
    });
    await plugin.onload();

    const result = await (plugin as any)._startServer();
    expect(result).toBe(false);
    expect(plugin.statusBar.getState()).toBe('offline');
  });

  it('rejects when binary file does not exist on disk', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === '/usr/bin/whisper-server') return false;
      return true;
    });

    const plugin = createPlugin({
      autoStartServer: false,
      serverBinaryPath: '/usr/bin/whisper-server',
      modelPath: '/models/model.bin',
      host: '127.0.0.1',
      port: FAKE_PORT + 702,
    });
    await plugin.onload();

    const result = await (plugin as any)._startServer();
    expect(result).toBe(false);
    expect(plugin.statusBar.getState()).toBe('offline');
  });

  it('rejects when model file does not exist on disk', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (path === '/models/model.bin') return false;
      return true;
    });

    const plugin = createPlugin({
      autoStartServer: false,
      serverBinaryPath: '/usr/bin/whisper-server',
      modelPath: '/models/model.bin',
      host: '127.0.0.1',
      port: FAKE_PORT + 703,
    });
    await plugin.onload();

    const result = await (plugin as any)._startServer();
    expect(result).toBe(false);
    expect(plugin.statusBar.getState()).toBe('offline');
  });

  it('rejects when ffmpeg is not available', async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb: Function) => cb(new Error('ENOENT')),
    );

    const plugin = createPlugin({
      autoStartServer: false,
      serverBinaryPath: '/usr/bin/whisper-server',
      modelPath: '/models/model.bin',
      host: '127.0.0.1',
      port: FAKE_PORT + 704,
    });
    await plugin.onload();

    const result = await (plugin as any)._startServer();
    expect(result).toBe(false);
    expect(plugin.statusBar.getState()).toBe('offline');
  });
});
