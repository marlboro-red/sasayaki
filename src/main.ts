import { Plugin } from 'obsidian';
import { SasayakiSettings, DEFAULT_SETTINGS } from './types';

export default class SasayakiPlugin extends Plugin {
  settings: SasayakiSettings;
  private ribbonIcon: HTMLElement | null = null;
  private isRecording = false;

  async onload() {
    await this.loadSettings();

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
