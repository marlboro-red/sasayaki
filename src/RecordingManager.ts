import { Notice } from 'obsidian';

interface Logger {
	debug(msg: string): void;
	info(msg: string): void;
	error(msg: string, err?: unknown): void;
}

export class RecordingManager {
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private stream: MediaStream | null = null;
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	async startRecording(): Promise<void> {
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (err) {
			this.handleMicError(err);
			throw err;
		}

		this.chunks = [];
		this.recorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });

		this.recorder.ondataavailable = (event: BlobEvent) => {
			if (event.data.size > 0) {
				this.chunks.push(event.data);
			}
		};

		this.recorder.start();
		this.logger.info('Recording started');
	}

	stopRecording(): Promise<Blob> {
		return new Promise<Blob>((resolve, reject) => {
			if (!this.recorder || this.recorder.state === 'inactive') {
				reject(new Error('No active recording'));
				return;
			}

			const chunks = this.chunks;

			this.recorder.onstop = () => {
				const blob = new Blob(chunks, { type: 'audio/webm' });
				this.cleanup();
				this.logger.info(`Recording stopped — blob size: ${blob.size} bytes`);
				resolve(blob);
			};

			this.recorder.stop();
		});
	}

	isRecording(): boolean {
		return this.recorder !== null && this.recorder.state !== 'inactive';
	}

	cancelRecording(): void {
		if (!this.recorder || this.recorder.state === 'inactive') {
			// No active recorder; release stream if one was opened
			this.cleanup();
			return;
		}

		this.recorder.onstop = () => {
			this.cleanup();
			this.logger.info('Recording cancelled — blob discarded');
		};

		this.recorder.stop();
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private cleanup(): void {
		if (this.stream) {
			this.stream.getTracks().forEach(t => t.stop());
			this.stream = null;
		}
		this.recorder = null;
		this.chunks = [];
	}

	private handleMicError(err: unknown): void {
		if (!(err instanceof DOMException)) return;

		if (err.name === 'NotAllowedError') {
			new Notice('Microphone access denied. Grant permission in System Settings > Privacy & Security > Microphone.');
		} else if (err.name === 'NotFoundError') {
			new Notice('No microphone found.');
		} else if (err.name === 'NotReadableError') {
			new Notice('Microphone is in use by another app.');
		}

		this.logger.error(`Microphone error: ${err.name}`, err);
	}
}
