import { Plugin } from 'obsidian';
import { SasayakiSettings, DEFAULT_SETTINGS } from './types';
import { StatusBarManager } from './StatusBarManager';
import { SettingsTab } from './SettingsTab';

export default class SasayakiPlugin extends Plugin {
  settings: SasayakiSettings;
  statusBar: StatusBarManager;
  private ribbonIcon: HTMLElement | null = null;
  private isRecording = false;

  async onload() {
    await this.loadSettings();

    this.statusBar = new StatusBarManager(this, this.settings.showStatusBar);

    this.ribbonIcon = this.addRibbonIcon('microphone', 'Sasayaki: Toggle recording', () => {
      this.toggleRecording();
    });

    this.addCommand({
      id: 'toggle-recording',
      name: 'Toggle recording',
      callback: () => {
        this.toggleRecording();
      },
    });

    this.addSettingTab(new SettingsTab(this.app, this));

    console.log('[Sasayaki] Plugin loaded');
  }

  onunload() {
    console.log('[Sasayaki] Plugin unloaded');
  }

  private toggleRecording() {
    this.isRecording = !this.isRecording;
    if (this.ribbonIcon) {
      if (this.isRecording) {
        this.ribbonIcon.addClass('sasayaki-recording');
      } else {
        this.ribbonIcon.removeClass('sasayaki-recording');
      }
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
