import { Notice } from 'obsidian';
import { Logger } from './Logger';

export class RecordingManager {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  constructor(private logger: Logger) {}

  async startRecording(): Promise<void> {
    if (this.recorder) {
      throw new Error('Already recording');
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: unknown) {
      const error = err as DOMException;
      if (error.name === 'NotAllowedError') {
        new Notice(
          'Microphone access denied. Grant permission in System Settings > Privacy & Security > Microphone.'
        );
      } else if (error.name === 'NotFoundError') {
        new Notice('No microphone found.');
      } else if (error.name === 'NotReadableError') {
        new Notice('Microphone is in use by another app.');
      } else {
        new Notice(`Microphone error: ${error.message}`);
      }
      throw error;
    }

    this.stream = stream;
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    this.recorder.start(100);
    this.logger.debug('Recording started');
  }

  async stopRecording(): Promise<Blob> {
    if (!this.recorder) {
      throw new Error('Not recording');
    }

    return new Promise<Blob>((resolve, reject) => {
      if (!this.recorder) {
        reject(new Error('Recorder gone'));
        return;
      }

      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        this.chunks = [];
        this.logger.debug(`Recording stopped, blob size: ${blob.size} bytes`);
        this._cleanup();
        resolve(blob);
      };

      this.recorder.onerror = (e: Event) => {
        this._cleanup();
        reject(new Error(`Recorder error: ${(e as ErrorEvent).message}`));
      };

      this.recorder.stop();
    });
  }

  isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  cancelRecording(): void {
    if (this.recorder) {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.chunks = [];
    this._cleanup();
    this.logger.debug('Recording cancelled');
  }

  private _cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.recorder = null;
  }
}
