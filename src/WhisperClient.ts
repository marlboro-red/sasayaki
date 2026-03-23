import * as http from 'http';

// ---------------------------------------------------------------------------
// Multipart/form-data encoder
// (Node's http module has no built-in FormData; we encode manually per RFC 2046)
// ---------------------------------------------------------------------------

interface StringField {
  kind: 'string';
  name: string;
  value: string;
}

interface FileField {
  kind: 'file';
  name: string;
  filename: string;
  contentType: string;
  data: ArrayBuffer;
}

type MultipartField = StringField | FileField;

function buildMultipartBody(fields: MultipartField[]): { body: Buffer; contentType: string } {
  const boundary = `----WhisperBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];

  for (const field of fields) {
    const header =
      field.kind === 'file'
        ? `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\nContent-Type: ${field.contentType}\r\n\r\n`
        : `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n`;

    parts.push(Buffer.from(header, 'utf8'));

    if (field.kind === 'file') {
      parts.push(Buffer.from(field.data));
    } else {
      parts.push(Buffer.from(field.value, 'utf8'));
    }

    parts.push(Buffer.from('\r\n', 'utf8'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ---------------------------------------------------------------------------
// WhisperClient
// ---------------------------------------------------------------------------

export class WhisperClient {
  constructor(
    private host: string,
    private port: number,
    private language: string,
  ) {}

  /**
   * POST audio to /inference, return trimmed transcription text.
   * Uses Node http (not fetch) to bypass Chromium CORS enforcement on app://obsidian.md.
   */
  async transcribe(audioBuffer: ArrayBuffer, filename = 'audio.webm'): Promise<string> {
    const { body, contentType } = buildMultipartBody([
      { kind: 'file', name: 'file', filename, contentType: 'audio/webm', data: audioBuffer },
      { kind: 'string', name: 'response_format', value: 'json' },
      { kind: 'string', name: 'language', value: this.language },
    ]);

    // Scale timeout with audio size: minimum 10s, ~3s per MB
    const timeoutMs = Math.max(10_000, (audioBuffer.byteLength / 1_000_000) * 3_000);

    const responseText = await this.request({
      method: 'POST',
      path: '/inference',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
      },
      body,
      timeoutMs,
    });

    const json = JSON.parse(responseText) as { text?: string };
    return (json.text ?? '').trim();
  }

  /**
   * GET /health. Returns true if the server responds 200, false otherwise.
   * Enforces a 2-second timeout.
   */
  async healthCheck(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const req = http.get(
        {
          hostname: this.host,
          port: this.port,
          path: '/health',
          timeout: 2_000,
        },
        (res) => {
          // Drain the body so the socket can be reused
          res.resume();
          resolve(res.statusCode === 200);
        },
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.on('error', () => resolve(false));
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private request(opts: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: Buffer;
    timeoutMs: number;
  }): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          hostname: this.host,
          port: this.port,
          path: opts.path,
          method: opts.method,
          headers: opts.headers,
          timeout: opts.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode !== 200) {
              reject(new Error(`Whisper server returned ${res.statusCode}: ${body}`));
            } else {
              resolve(body);
            }
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error('Transcription timed out — try a shorter recording'));
      });

      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
          reject(new Error('Whisper server not reachable'));
        } else {
          reject(err);
        }
      });

      req.write(opts.body);
      req.end();
    });
  }
}
