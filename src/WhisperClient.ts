import * as http from 'http';
import { Logger } from './Logger';

/** Maximum response size (1 MB) — transcription JSON should never be this large. */
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024;

export class WhisperClient {
  constructor(
    private host: string,
    private port: number,
    private language: string,
    private logger: Logger
  ) {}

  /** Compute request timeout in ms — scales with audio size (min 10s, ~3s per MB). */
  static computeTimeoutMs(byteLength: number): number {
    return Math.max(10_000, (byteLength / 1_000_000) * 3_000);
  }

  async transcribe(audioBuffer: ArrayBuffer, filename = 'audio.webm'): Promise<string> {
    const boundary = `----FormBoundary${Math.random().toString(16).slice(2)}`;
    const { body, contentType } = this._buildMultipartBody(
      audioBuffer,
      filename,
      boundary
    );

    const timeoutMs = WhisperClient.computeTimeoutMs(audioBuffer.byteLength);

    return new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          host: this.host,
          port: this.port,
          path: '/inference',
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            'Content-Length': body.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let bytesReceived = 0;
          res.on('data', (chunk: Buffer) => {
            bytesReceived += chunk.length;
            if (bytesReceived > MAX_RESPONSE_BYTES) {
              res.destroy();
              reject(new Error(`Whisper server response exceeded ${MAX_RESPONSE_BYTES} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            this.logger.debug(`Transcription response (${res.statusCode}): ${raw}`);
            if (res.statusCode !== 200) {
              reject(new Error(`Whisper server returned ${res.statusCode}: ${raw}`));
              return;
            }
            try {
              const json = JSON.parse(raw) as { text?: string };
              resolve((json.text ?? '').trim());
            } catch {
              reject(new Error(`Invalid JSON from whisper server: ${raw}`));
            }
          });
          res.on('error', reject);
        }
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Transcription timed out — try a shorter recording'));
      });

      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
          reject(new Error('Whisper server not reachable'));
        } else {
          reject(err);
        }
      });

      req.write(body);
      req.end();
    });
  }

  async healthCheck(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const req = http.get(
        {
          host: this.host,
          port: this.port,
          path: '/health',
        },
        (res) => {
          const chunks: Buffer[] = [];
          let bytesReceived = 0;
          res.on('data', (chunk: Buffer) => {
            bytesReceived += chunk.length;
            if (bytesReceived > MAX_RESPONSE_BYTES) {
              res.destroy();
              resolve(false);
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            resolve(res.statusCode === 200 && body.includes('"ok"'));
          });
          res.on('error', () => resolve(false));
        }
      );

      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });

      req.on('error', () => resolve(false));
    });
  }

  private _buildMultipartBody(
    audioBuffer: ArrayBuffer,
    filename: string,
    boundary: string
  ): { body: Buffer; contentType: string } {
    const CRLF = '\r\n';
    const parts: Buffer[] = [];

    // Escape quotes and strip CRLF to prevent header injection
    const safeFilename = filename
      .replace(/\r?\n|\r/g, '')
      .replace(/"/g, '\\"');

    // Audio file part
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="file"; filename="${safeFilename}"${CRLF}` +
          `Content-Type: audio/webm${CRLF}${CRLF}`
      )
    );
    parts.push(Buffer.from(audioBuffer));
    parts.push(Buffer.from(CRLF));

    // response_format part
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="response_format"${CRLF}${CRLF}` +
          `json${CRLF}`
      )
    );

    // language part
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="language"${CRLF}${CRLF}` +
          `${this.language}${CRLF}`
      )
    );

    // Closing boundary
    parts.push(Buffer.from(`--${boundary}--${CRLF}`));

    const body = Buffer.concat(parts);
    const contentType = `multipart/form-data; boundary=${boundary}`;
    return { body, contentType };
  }
}
