import { Plugin } from 'obsidian';

export type PluginState = 'idle' | 'recording' | 'transcribing' | 'offline' | 'starting';

const STATE_LABELS: Record<PluginState, string> = {
	idle: 'Whisper ready',
	recording: 'Recording...',
	transcribing: 'Transcribing...',
	offline: 'Server offline',
	starting: 'Server starting...',
};

export class StatusBarManager {
	private el: HTMLElement | null = null;
	private state: PluginState = 'idle';

	constructor(plugin: Plugin, show: boolean) {
		if (show) {
			this.el = plugin.addStatusBarItem();
			this.render();
		}
	}

	setState(state: PluginState): void {
		this.state = state;
		this.render();
	}

	getState(): PluginState {
		return this.state;
	}

	setVisible(show: boolean): void {
		if (!this.el) return;
		this.el.style.display = show ? '' : 'none';
	}

	private render(): void {
		if (!this.el) return;
		this.el.setText(STATE_LABELS[this.state]);
	}
}
