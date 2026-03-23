import { ChildProcess, spawn } from 'child_process';
import * as http from 'http';
import { Logger } from './Logger';

export class ServerManager {
  private process: ChildProcess | null = null;
  private externallyManaged = false;
  private _stoppedIntentionally = false;
  onUnexpectedExit?: (code: number | null) => void;

  constructor(private logger: Logger) {}

  async start(
    binaryPath: string,
    modelPath: string,
    host: string,
    port: number
  ): Promise<void> {
    // Check if server is already running externally
    const alreadyRunning = await this._isResponding(host, port);
    if (alreadyRunning) {
      this.logger.info('Detected externally-running whisper-server, reusing');
      this.externallyManaged = true;
      return;
    }

    this._stoppedIntentionally = false;
    this.process = spawn(
      binaryPath,
      ['-m', modelPath, '--host', host, '--port', String(port), '--convert'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    if (this.process.stdout) {
      this.process.stdout.on('data', (data: Buffer) => {
        this.logger.debug(`[server stdout] ${data.toString().trim()}`);
      });
    }
    if (this.process.stderr) {
      this.process.stderr.on('data', (data: Buffer) => {
        this.logger.debug(`[server stderr] ${data.toString().trim()}`);
      });
    }

    this.process.on('exit', (code) => {
      if (!this._stoppedIntentionally) {
        this.logger.error(`whisper-server exited unexpectedly (code ${code})`);
        this.process = null;
        this.onUnexpectedExit?.(code);
      }
    });

    this.logger.info(`whisper-server spawned (pid ${this.process.pid})`);
  }

  async stop(): Promise<void> {
    if (this.externallyManaged) {
      this.logger.debug('Skipping stop — server is externally managed');
      this.externallyManaged = false;
      return;
    }
    if (!this.process) return;

    this._stoppedIntentionally = true;
    const proc = this.process;
    this.process = null;

    await new Promise<void>((resolve) => {
      const killTimeout = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 3000);

      proc.on('exit', () => {
        clearTimeout(killTimeout);
        resolve();
      });

      proc.kill('SIGTERM');
    });

    this.logger.info('whisper-server stopped');
  }

  isRunning(): boolean {
    return this.process !== null || this.externallyManaged;
  }

  async waitForReady(host: string, port: number, timeoutMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this._isResponding(host, port);
      if (ok) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  private _isResponding(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get({ host, port, path: '/health' }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve(res.statusCode === 200 && body.includes('"ok"'));
        });
        res.on('error', () => resolve(false));
      });
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    });
  }
}
