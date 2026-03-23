import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { SasayakiSettings } from './types';
import type SasayakiPlugin from './main';

export class SettingsTab extends PluginSettingTab {
  private plugin: SasayakiPlugin;

  constructor(app: App, plugin: SasayakiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Sasayaki — Speech to Text' });

    // Server binary path
    new Setting(containerEl)
      .setName('Whisper server binary')
      .setDesc('Absolute path to the whisper-server binary')
      .addText((text) =>
        text
          .setPlaceholder('/path/to/whisper-server')
          .setValue(this.plugin.settings.serverBinaryPath)
          .onChange(async (value) => {
            this.plugin.settings.serverBinaryPath = value;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setButtonText('Browse').onClick(async () => {
          try {
            const { remote } = require('electron') as {
              remote: {
                dialog: { showOpenDialog: (win: unknown, opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> };
                getCurrentWindow: () => unknown;
              };
            };
            const result = await remote.dialog.showOpenDialog(
              remote.getCurrentWindow(),
              { properties: ['openFile'] }
            );
            if (!result.canceled && result.filePaths.length > 0) {
              this.plugin.settings.serverBinaryPath = result.filePaths[0];
              await this.plugin.saveSettings();
              this.display();
            }
          } catch {
            new Notice('Could not open file browser');
          }
        })
      );

    // Model path
    new Setting(containerEl)
      .setName('Model file')
      .setDesc('Absolute path to the .bin model file (e.g. ggml-small.bin)')
      .addText((text) =>
        text
          .setPlaceholder('/path/to/ggml-small.bin')
          .setValue(this.plugin.settings.modelPath)
          .onChange(async (value) => {
            this.plugin.settings.modelPath = value;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setButtonText('Browse').onClick(async () => {
          try {
            const { remote } = require('electron') as {
              remote: {
                dialog: { showOpenDialog: (win: unknown, opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> };
                getCurrentWindow: () => unknown;
              };
            };
            const result = await remote.dialog.showOpenDialog(
              remote.getCurrentWindow(),
              { properties: ['openFile'] }
            );
            if (!result.canceled && result.filePaths.length > 0) {
              this.plugin.settings.modelPath = result.filePaths[0];
              await this.plugin.saveSettings();
              this.display();
            }
          } catch {
            new Notice('Could not open file browser');
          }
        })
      );

    // Host
    new Setting(containerEl)
      .setName('Host')
      .setDesc('Server host (default: 127.0.0.1)')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.host)
          .onChange(async (value) => {
            this.plugin.settings.host = value;
            await this.plugin.saveSettings();
          })
      );

    // Port
    new Setting(containerEl)
      .setName('Port')
      .setDesc('Server port (default: 8787)')
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.port))
          .onChange(async (value) => {
            const port = parseInt(value, 10);
            if (!isNaN(port) && port > 0 && port < 65536) {
              this.plugin.settings.port = port;
              await this.plugin.saveSettings();
            }
          })
      );

    // Language
    new Setting(containerEl)
      .setName('Language')
      .setDesc('Transcription language (auto = auto-detect)')
      .addDropdown((drop) => {
        const langs: Record<string, string> = {
          auto: 'Auto-detect',
          en: 'English',
          ja: 'Japanese',
          ko: 'Korean',
          zh: 'Chinese',
          fr: 'French',
          de: 'German',
          es: 'Spanish',
        };
        for (const [value, label] of Object.entries(langs)) {
          drop.addOption(value, label);
        }
        drop
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
          });
      });

    // Auto-start
    new Setting(containerEl)
      .setName('Auto-start server')
      .setDesc('Automatically start whisper-server when plugin loads')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoStartServer)
          .onChange(async (value) => {
            this.plugin.settings.autoStartServer = value;
            await this.plugin.saveSettings();
          })
      );

    // Insert mode
    new Setting(containerEl)
      .setName('Insert mode')
      .setDesc('How to insert transcribed text into the note')
      .addDropdown((drop) =>
        drop
          .addOption('cursor', 'At cursor')
          .addOption('newline', 'New line')
          .addOption('blockquote', 'Blockquote callout')
          .setValue(this.plugin.settings.insertMode)
          .onChange(async (value) => {
            this.plugin.settings.insertMode = value as 'cursor' | 'newline' | 'blockquote';
            await this.plugin.saveSettings();
          })
      );

    // Show status bar
    new Setting(containerEl)
      .setName('Show status bar')
      .setDesc('Show plugin state in the Obsidian status bar')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStatusBar)
          .onChange(async (value) => {
            this.plugin.settings.showStatusBar = value;
            await this.plugin.saveSettings();
            this.plugin.updateStatusBar();
          })
      );

    // Debug mode
    new Setting(containerEl)
      .setName('Debug mode')
      .setDesc('Verbose logging to developer console')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debug)
          .onChange(async (value) => {
            this.plugin.settings.debug = value;
            await this.plugin.saveSettings();
            this.plugin.logger.setDebug(value);
          })
      );

    // Test connection button
    new Setting(containerEl)
      .setName('Test connection')
      .setDesc('Check if whisper-server is reachable')
      .addButton((btn) =>
        btn.setButtonText('Test').onClick(async () => {
          const ok = await this.plugin.whisperClient.healthCheck();
          new Notice(ok ? 'Server ready' : 'Server not reachable');
        })
      );
  }
}
