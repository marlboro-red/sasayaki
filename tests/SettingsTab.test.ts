import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Capture callbacks from Setting controls ────────────────────────────────
// Each Setting records its text/toggle/dropdown/button callbacks so tests
// can invoke onChange handlers directly.

interface CapturedControl {
  type: 'text' | 'toggle' | 'dropdown' | 'button';
  onChange?: (value: any) => Promise<void> | void;
  onClick?: () => Promise<void> | void;
  setValue?: (v: any) => any;
  setPlaceholder?: (v: string) => any;
  addOption?: (value: string, label: string) => any;
  setButtonText?: (v: string) => any;
}

const capturedSettings: { name: string; controls: CapturedControl[] }[] = [];

vi.mock('obsidian', () => {
  class Notice {
    message: string;
    constructor(message: string) { this.message = message; }
  }

  class PluginSettingTab {
    app: any;
    plugin: any;
    containerEl = { empty: vi.fn(), createEl: vi.fn() };
    constructor(app: any, plugin: any) {
      this.app = app;
      this.plugin = plugin;
    }
  }

  class Setting {
    _name = '';
    _controls: CapturedControl[] = [];

    constructor(_el: any) {}

    setName(n: string) {
      this._name = n;
      capturedSettings.push({ name: n, controls: this._controls });
      return this;
    }

    setDesc(_d: string) { return this; }

    addText(cb: (text: any) => any) {
      const ctrl: CapturedControl = { type: 'text' };
      const textInput = {
        setPlaceholder: (v: string) => { ctrl.setPlaceholder = () => v; return textInput; },
        setValue: (v: any) => { return textInput; },
        onChange: (fn: (value: string) => Promise<void>) => { ctrl.onChange = fn; return textInput; },
      };
      cb(textInput);
      this._controls.push(ctrl);
      return this;
    }

    addToggle(cb: (toggle: any) => any) {
      const ctrl: CapturedControl = { type: 'toggle' };
      const toggle = {
        setValue: (v: any) => toggle,
        onChange: (fn: (value: boolean) => Promise<void>) => { ctrl.onChange = fn; return toggle; },
      };
      cb(toggle);
      this._controls.push(ctrl);
      return this;
    }

    addDropdown(cb: (drop: any) => any) {
      const ctrl: CapturedControl = { type: 'dropdown' };
      const drop = {
        addOption: (_v: string, _l: string) => drop,
        setValue: (v: any) => drop,
        onChange: (fn: (value: string) => Promise<void>) => { ctrl.onChange = fn; return drop; },
      };
      cb(drop);
      this._controls.push(ctrl);
      return this;
    }

    addButton(cb: (btn: any) => any) {
      const ctrl: CapturedControl = { type: 'button' };
      const btn = {
        setButtonText: (_t: string) => btn,
        onClick: (fn: () => Promise<void>) => { ctrl.onClick = fn; return btn; },
      };
      cb(btn);
      this._controls.push(ctrl);
      return this;
    }
  }

  class App {
    workspace = { activeEditor: null };
  }

  return { Notice, PluginSettingTab, Setting, App };
});

import { SettingsTab } from '../src/SettingsTab';
import { DEFAULT_SETTINGS, SasayakiSettings } from '../src/types';

function makePlugin(overrides: Partial<SasayakiSettings> = {}) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    updateStatusBar: vi.fn(),
    logger: { setDebug: vi.fn() },
    whisperClient: { healthCheck: vi.fn().mockResolvedValue(true) },
  };
}

function findSetting(name: string) {
  return capturedSettings.find((s) => s.name === name);
}

describe('SettingsTab', () => {
  let plugin: ReturnType<typeof makePlugin>;
  let tab: SettingsTab;

  beforeEach(() => {
    capturedSettings.length = 0;
    plugin = makePlugin();
    tab = new SettingsTab({} as any, plugin as any);
    tab.display();
  });

  // ── Port validation ────────────────────────────────────────────────────

  describe('port onChange validation', () => {
    function getPortOnChange() {
      const setting = findSetting('Port');
      return setting?.controls[0]?.onChange;
    }

    it('accepts a valid port number', async () => {
      const onChange = getPortOnChange()!;
      await onChange('3000');
      expect(plugin.settings.port).toBe(3000);
      expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('rejects NaN input', async () => {
      const onChange = getPortOnChange()!;
      await onChange('abc');
      expect(plugin.settings.port).toBe(DEFAULT_SETTINGS.port);
      expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('rejects port 0', async () => {
      const onChange = getPortOnChange()!;
      await onChange('0');
      expect(plugin.settings.port).toBe(DEFAULT_SETTINGS.port);
      expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('rejects negative port', async () => {
      const onChange = getPortOnChange()!;
      await onChange('-1');
      expect(plugin.settings.port).toBe(DEFAULT_SETTINGS.port);
      expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('rejects port >= 65536', async () => {
      const onChange = getPortOnChange()!;
      await onChange('65536');
      expect(plugin.settings.port).toBe(DEFAULT_SETTINGS.port);
      expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it('accepts port 65535 (max valid)', async () => {
      const onChange = getPortOnChange()!;
      await onChange('65535');
      expect(plugin.settings.port).toBe(65535);
      expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('accepts port 1 (min valid)', async () => {
      const onChange = getPortOnChange()!;
      await onChange('1');
      expect(plugin.settings.port).toBe(1);
      expect(plugin.saveSettings).toHaveBeenCalled();
    });
  });

  // ── Settings persistence via onChange ──────────────────────────────────

  describe('settings persistence', () => {
    it('saves serverBinaryPath on change', async () => {
      const onChange = findSetting('Whisper server binary')?.controls[0]?.onChange;
      await onChange!('/usr/local/bin/whisper-server');
      expect(plugin.settings.serverBinaryPath).toBe('/usr/local/bin/whisper-server');
      expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('saves modelPath on change', async () => {
      const onChange = findSetting('Model file')?.controls[0]?.onChange;
      await onChange!('/models/ggml-small.bin');
      expect(plugin.settings.modelPath).toBe('/models/ggml-small.bin');
      expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('saves host on change', async () => {
      const onChange = findSetting('Host')?.controls[0]?.onChange;
      await onChange!('0.0.0.0');
      expect(plugin.settings.host).toBe('0.0.0.0');
      expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('saves language on change', async () => {
      const onChange = findSetting('Language')?.controls[0]?.onChange;
      await onChange!('ja');
      expect(plugin.settings.language).toBe('ja');
      expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('saves autoStartServer on change', async () => {
      const onChange = findSetting('Auto-start server')?.controls[0]?.onChange;
      await onChange!(false);
      expect(plugin.settings.autoStartServer).toBe(false);
      expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('saves insertMode on change', async () => {
      const onChange = findSetting('Insert mode')?.controls[0]?.onChange;
      await onChange!('blockquote');
      expect(plugin.settings.insertMode).toBe('blockquote');
      expect(plugin.saveSettings).toHaveBeenCalled();
    });
  });

  // ── onChange side-effects ──────────────────────────────────────────────

  describe('onChange side-effects', () => {
    it('calls updateStatusBar when showStatusBar changes', async () => {
      const onChange = findSetting('Show status bar')?.controls[0]?.onChange;
      await onChange!(false);
      expect(plugin.settings.showStatusBar).toBe(false);
      expect(plugin.saveSettings).toHaveBeenCalled();
      expect(plugin.updateStatusBar).toHaveBeenCalled();
    });

    it('calls logger.setDebug when debug changes', async () => {
      const onChange = findSetting('Debug mode')?.controls[0]?.onChange;
      await onChange!(true);
      expect(plugin.settings.debug).toBe(true);
      expect(plugin.saveSettings).toHaveBeenCalled();
      expect(plugin.logger.setDebug).toHaveBeenCalledWith(true);
    });
  });

  // ── Test connection button ────────────────────────────────────────────

  describe('test connection button', () => {
    it('calls whisperClient.healthCheck on click', async () => {
      const onClick = findSetting('Test connection')?.controls[0]?.onClick;
      await onClick!();
      expect(plugin.whisperClient.healthCheck).toHaveBeenCalled();
    });
  });
});
