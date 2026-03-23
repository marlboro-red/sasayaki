/** Minimal Obsidian API mocks for testing. */

export class Notice {
  message: string;
  constructor(message: string, _timeout?: number) {
    this.message = message;
  }
}

export class Plugin {
  app: any;
  manifest: any;

  addStatusBarItem() {
    return {
      setText: vi.fn(),
      style: { display: '' },
    };
  }

  addRibbonIcon(_icon: string, _title: string, callback: () => void) {
    const el = {
      addClass: vi.fn(),
      removeClass: vi.fn(),
      _callback: callback,
    };
    return el;
  }

  addCommand(cmd: any) {
    return cmd;
  }

  addSettingTab(_tab: any) {}

  async loadData() {
    return this._savedData ?? null;
  }

  async saveData(data: any) {
    this._savedData = data;
  }

  _savedData: any = null;
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any = { empty: vi.fn(), createEl: vi.fn() };
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
  display() {}
}

export class Setting {
  constructor(_el: any) {}
  setName(_n: string) { return this; }
  setDesc(_d: string) { return this; }
  addText(_cb: any) { return this; }
  addToggle(_cb: any) { return this; }
  addDropdown(_cb: any) { return this; }
  addButton(_cb: any) { return this; }
}

export class App {
  workspace = {
    activeEditor: null as any,
  };
}
