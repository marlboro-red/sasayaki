import { Plugin, addIcon } from 'obsidian';
import { SasayakiSettings, DEFAULT_SETTINGS } from './types';

export default class SasayakiPlugin extends Plugin {
  settings: SasayakiSettings;
  private ribbonIcon: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    this.ribbonIcon = this.addRibbonIcon('microphone', 'Sasayaki: Toggle recording', () => {
      // Recording toggle will be implemented in Phase 8
    });

    this.addCommand({
      id: 'toggle-recording',
      name: 'Toggle recording',
      callback: () => {
        // Recording toggle will be implemented in Phase 8
      },
    });

    console.log('[Sasayaki] Plugin loaded');
  }

  onunload() {
    console.log('[Sasayaki] Plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
