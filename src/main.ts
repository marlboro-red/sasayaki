import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, SasayakiSettings } from './types';
import { Logger } from './Logger';
import { RecordingManager } from './RecordingManager';
import { WhisperClient } from './WhisperClient';
import { ServerManager } from './ServerManager';
import { TranscriptInserter } from './TranscriptInserter';
import { SettingsTab } from './SettingsTab';
import { StatusBarManager } from './StatusBarManager';

export default class SasayakiPlugin extends Plugin {
  settings!: SasayakiSettings;
  logger!: Logger;
  statusBar!: StatusBarManager;

  private recording!: RecordingManager;
  private server!: ServerManager;
  private whisperClient!: WhisperClient;
  private inserter!: TranscriptInserter;
  private ribbonIcon: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.logger = new Logger(this.settings.debug);
    this.recording = new RecordingManager(this.logger);
    this.server = new ServerManager(this.logger);
    this.inserter = new TranscriptInserter();
    this._rebuildWhisperClient();

    // ── Phase 8.2: Status bar state machine ────────────────────────────────
    this.statusBar = new StatusBarManager(this, this.settings.showStatusBar);
    this.statusBar.setState('offline');

    // ── Phase 8.1: Ribbon icon ─────────────────────────────────────────────
    this.ribbonIcon = this.addRibbonIcon(
      'microphone',
      'Sasayaki: Toggle recording',
      () => this.toggleRecording()
    );

    // ── Phase 8.1: Command palette command (no default hotkey) ────────────
    this.addCommand({
      id: 'toggle-recording',
      name: 'Toggle recording',
      callback: () => this.toggleRecording(),
    });

    // Settings tab
    this.addSettingTab(new SettingsTab(this.app, this));

    // Auto-start or health-check
    if (this.settings.autoStartServer) {
      this.statusBar.setState('starting');
      await this._startServer();
    } else {
      const ok = await this.whisperClient.healthCheck();
      this.statusBar.setState(ok ? 'idle' : 'offline');
    }

    this.logger.info('Plugin loaded');
  }

  async onunload(): Promise<void> {
    if (this.recording.isRecording()) {
      this.recording.cancelRecording();
    }
    await this.server.stop();
    this.logger.info('Plugin unloaded');
  }

  // ── Phase 8.3: Main recording flow ─────────────────────────────────────────

  async toggleRecording(): Promise<void> {
    if (this.recording.isRecording()) {
      await this._stopAndTranscribe();
    } else {
      await this._startRecording();
    }
  }

  private async _startRecording(): Promise<void> {
    // Guard: active editor required
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) {
      new Notice('Open a note first');
      return;
    }

    // Guard: server health check
    const serverOk = await this.whisperClient.healthCheck();
    if (!serverOk) {
      if (this.settings.autoStartServer) {
        this.statusBar.setState('starting');
        const started = await this._startServer();
        if (!started) {
          new Notice(
            'Whisper server is offline. Start it manually or enable auto-start in settings.'
          );
          return;
        }
      } else {
        new Notice(
          'Whisper server is offline. Start it manually or enable auto-start in settings.'
        );
        return;
      }
    }

    try {
      await this.recording.startRecording();
      this.statusBar.setState('recording');
      if (this.ribbonIcon) {
        this.ribbonIcon.addClass('sasayaki-recording');
      }
    } catch {
      // Error Notices already shown by RecordingManager
      this.statusBar.setState('idle');
    }
  }

  private async _stopAndTranscribe(): Promise<void> {
    const editor = this.app.workspace.activeEditor?.editor;

    let blob: Blob;
    try {
      blob = await this.recording.stopRecording();
    } catch (err: unknown) {
      this.logger.error('Failed to stop recording', err);
      this.statusBar.setState('idle');
      if (this.ribbonIcon) {
        this.ribbonIcon.removeClass('sasayaki-recording');
      }
      return;
    }

    if (this.ribbonIcon) {
      this.ribbonIcon.removeClass('sasayaki-recording');
    }
    this.statusBar.setState('transcribing');

    let text: string;
    try {
      const buffer = await blob.arrayBuffer();
      text = await this.whisperClient.transcribe(buffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Transcription failed: ${msg}`);
      this.logger.error('Transcription error', err);
      this.statusBar.setState('idle');
      return;
    }

    this.statusBar.setState('idle');

    if (editor) {
      this.inserter.insert(editor, text, this.settings.insertMode);
    } else {
      // Editor closed between start and stop — copy to clipboard as fallback
      if (text) {
        await navigator.clipboard.writeText(text);
        new Notice('No active editor — transcription copied to clipboard');
      }
    }

    if (text) {
      this.logger.info(`Transcribed: "${text.slice(0, 60)}..."`);
    }
  }

  // ── Server helpers ──────────────────────────────────────────────────────────

  private async _startServer(): Promise<boolean> {
    const { serverBinaryPath, modelPath, host, port } = this.settings;

    if (!serverBinaryPath) {
      new Notice('Whisper server binary not configured. Configure in Settings.');
      this.statusBar.setState('offline');
      return false;
    }
    if (!modelPath) {
      new Notice('Model path not configured. Configure in Settings.');
      this.statusBar.setState('offline');
      return false;
    }

    const { existsSync } = require('fs') as typeof import('fs');
    if (!existsSync(serverBinaryPath)) {
      new Notice(`whisper-server not found at ${serverBinaryPath}`);
      this.statusBar.setState('offline');
      return false;
    }
    if (!existsSync(modelPath)) {
      new Notice(`Model file not found at ${modelPath}`);
      this.statusBar.setState('offline');
      return false;
    }

    try {
      // start() handles: probe health, spawn, waitForReady, and shows notices
      await this.server.start(serverBinaryPath, modelPath, host, port);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Failed to start whisper server: ${msg}`);
      this.statusBar.setState('offline');
      return false;
    }

    // Verify health after start() completes
    const ready = await this.whisperClient.healthCheck();
    this.statusBar.setState(ready ? 'idle' : 'offline');
    return ready;
  }

  private _rebuildWhisperClient(): void {
    this.whisperClient = new WhisperClient(
      this.settings.host,
      this.settings.port,
      this.settings.language,
    );
  }

  // ── Settings ────────────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this._rebuildWhisperClient();
    this.logger?.setDebug(this.settings.debug);
  }
}
