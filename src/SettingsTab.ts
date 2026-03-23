import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { SasayakiSettings, InsertMode } from './types';

// Plugin interface — avoids circular dependency with main.ts
interface SasayakiPlugin {
  settings: SasayakiSettings;
  saveSettings(): Promise<void>;
}

export class SettingsTab extends PluginSettingTab {
  private plugin: SasayakiPlugin;

  constructor(app: App, plugin: SasayakiPlugin) {
    super(app, plugin as any);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Sasayaki Settings' });

    // --- Server binary path ---
    this.addPathSetting(
      containerEl,
      'Server binary path',
      'Absolute path to the whisper-server binary.',
      'serverBinaryPath',
      false,
    );

    // --- Model path ---
    this.addPathSetting(
      containerEl,
      'Model path',
      'Absolute path to the ggml model file (e.g. ggml-small.bin).',
      'modelPath',
      false,
    );

    // --- Host ---
    new Setting(containerEl)
      .setName('Host')
      .setDesc('Hostname or IP for the whisper-server.')
      .addText(text => text
        .setPlaceholder('127.0.0.1')
        .setValue(this.plugin.settings.host)
        .onChange(async (value) => {
          this.plugin.settings.host = value.trim();
          await this.plugin.saveSettings();
        }));

    // --- Port ---
    new Setting(containerEl)
      .setName('Port')
      .setDesc('Port for the whisper-server (default: 8787).')
      .addText(text => text
        .setPlaceholder('8787')
        .setValue(String(this.plugin.settings.port))
        .onChange(async (value) => {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
            this.plugin.settings.port = parsed;
            await this.plugin.saveSettings();
          }
        }));

    // --- Language ---
    new Setting(containerEl)
      .setName('Language')
      .setDesc('Language for transcription. "auto" lets Whisper detect the language.')
      .addDropdown(drop => drop
        .addOptions({
          auto: 'Auto-detect',
          en: 'English',
          ja: 'Japanese',
          ko: 'Korean',
          zh: 'Chinese',
          fr: 'French',
          de: 'German',
          es: 'Spanish',
        })
        .setValue(this.plugin.settings.language)
        .onChange(async (value) => {
          this.plugin.settings.language = value;
          await this.plugin.saveSettings();
        }));

    // --- Auto-start server ---
    new Setting(containerEl)
      .setName('Auto-start server')
      .setDesc('Automatically start whisper-server when the plugin loads.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoStartServer)
        .onChange(async (value) => {
          this.plugin.settings.autoStartServer = value;
          await this.plugin.saveSettings();
        }));

    // --- Insert mode ---
    new Setting(containerEl)
      .setName('Insert mode')
      .setDesc('How transcribed text is inserted into the note.')
      .addDropdown(drop => drop
        .addOptions({
          cursor: 'At cursor (replace selection)',
          newline: 'New line after current line',
          blockquote: 'Blockquote callout block',
        } as Record<InsertMode, string>)
        .setValue(this.plugin.settings.insertMode)
        .onChange(async (value) => {
          this.plugin.settings.insertMode = value as InsertMode;
          await this.plugin.saveSettings();
        }));

    // --- Show status bar ---
    new Setting(containerEl)
      .setName('Show status bar')
      .setDesc('Show server and recording state in the Obsidian status bar.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showStatusBar)
        .onChange(async (value) => {
          this.plugin.settings.showStatusBar = value;
          await this.plugin.saveSettings();
        }));

    // --- Debug mode ---
    new Setting(containerEl)
      .setName('Debug mode')
      .setDesc('Log verbose output to the developer console.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debug)
        .onChange(async (value) => {
          this.plugin.settings.debug = value;
          await this.plugin.saveSettings();
        }));

    // --- Test connection ---
    new Setting(containerEl)
      .setName('Test connection')
      .setDesc('Check if the whisper-server is reachable.')
      .addButton(btn => btn
        .setButtonText('Test connection')
        .onClick(() => this.testConnection()));
  }

  // Adds a text + Browse button setting for a file path field.
  private addPathSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    field: 'serverBinaryPath' | 'modelPath',
    _isDirectory: boolean,
  ): void {
    const fs = require('fs') as typeof import('fs');

    let textComponent: any;
    let errorEl: HTMLElement | null = null;

    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText(text => {
        textComponent = text;
        text
          .setPlaceholder('/path/to/binary')
          .setValue(this.plugin.settings[field])
          .onChange(async (value) => {
            const trimmed = value.trim();
            this.plugin.settings[field] = trimmed;
            await this.plugin.saveSettings();
            this.validatePath(trimmed, errorEl, fs);
          });
      })
      .addButton(btn => btn
        .setButtonText('Browse')
        .onClick(async () => {
          const newPath = await this.openFilePicker();
          if (newPath) {
            this.plugin.settings[field] = newPath;
            await this.plugin.saveSettings();
            if (textComponent) textComponent.setValue(newPath);
            this.validatePath(newPath, errorEl, fs);
          }
        }));

    // Inline error element below the setting
    errorEl = setting.settingEl.createEl('div', {
      cls: 'sasayaki-path-error',
      attr: { style: 'color: var(--text-error); font-size: 0.85em; margin-top: 4px;' },
    });

    // Validate current value on display
    const current = this.plugin.settings[field];
    if (current) this.validatePath(current, errorEl, fs);
  }

  private validatePath(
    pathValue: string,
    errorEl: HTMLElement | null,
    fs: typeof import('fs'),
  ): void {
    if (!errorEl) return;
    if (!pathValue) {
      errorEl.setText('');
      return;
    }
    if (!fs.existsSync(pathValue)) {
      errorEl.setText(`Path not found: ${pathValue}`);
    } else {
      errorEl.setText('');
    }
  }

  private async openFilePicker(): Promise<string | null> {
    try {
      const { remote } = require('electron') as any;
      const result = await remote.dialog.showOpenDialog(
        remote.getCurrentWindow(),
        { properties: ['openFile'] },
      );
      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
    } catch (e) {
      new Notice('Could not open file picker. Enter the path manually.');
    }
    return null;
  }

  private testConnection(): void {
    const { host, port } = this.plugin.settings;
    const http = require('http') as typeof import('http');

    const req = http.get(
      { hostname: host, port, path: '/health', timeout: 2000 },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode === 200) {
            new Notice('Whisper server ready');
          } else {
            new Notice(`Server not ready (status ${res.statusCode}): ${body.trim()}`);
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      new Notice('Server not reachable (timed out)');
    });

    req.on('error', () => {
      new Notice('Server not reachable');
    });
  }
}
