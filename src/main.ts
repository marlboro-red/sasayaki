import { Plugin, addIcon } from 'obsidian';
import { SasayakiSettings, DEFAULT_SETTINGS } from './types';
import { StatusBarManager } from './StatusBarManager';

export default class SasayakiPlugin extends Plugin {
  settings: SasayakiSettings;
  statusBar: StatusBarManager;
  private ribbonIcon: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    this.statusBar = new StatusBarManager(this, this.settings.showStatusBar);

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
