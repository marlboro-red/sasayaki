import { ChildProcess, spawn } from 'child_process';
import * as http from 'http';
import { Notice } from 'obsidian';

interface Logger {
	debug(msg: string): void;
	info(msg: string): void;
	error(msg: string, err?: unknown): void;
}

export class ServerManager {
	private process: ChildProcess | null = null;
	private externallyManaged = false;
	private host = '127.0.0.1';
	private port = 8787;
	private logger: Logger;

	constructor(logger: Logger) {
		this.logger = logger;
	}

	async start(binaryPath: string, modelPath: string, host: string, port: number): Promise<void> {
		this.host = host;
		this.port = port;

		// Check if an external server is already running
		const alreadyHealthy = await this.probeHealth();
		if (alreadyHealthy) {
			this.logger.info('External whisper-server detected — reusing without spawning');
			this.externallyManaged = true;
			new Notice('Whisper ready (external server)');
			return;
		}

		new Notice('Starting Whisper server...');
		this.logger.info(`Spawning whisper-server: ${binaryPath}`);

		this.process = spawn(binaryPath, [
			'-m', modelPath,
			'--host', host,
			'--port', String(port),
			'--convert',
		], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		this.process.stdout?.on('data', (chunk: Buffer) => {
			this.logger.debug(`[whisper-server stdout] ${chunk.toString().trim()}`);
		});

		this.process.stderr?.on('data', (chunk: Buffer) => {
			this.logger.debug(`[whisper-server stderr] ${chunk.toString().trim()}`);
		});

		this.process.on('error', (err) => {
			this.logger.error('Failed to spawn whisper-server', err);
			new Notice(`whisper-server not found at: ${binaryPath}`);
			this.process = null;
		});

		this.process.on('exit', (code, signal) => {
			if (this.process !== null) {
				// Unexpected exit (not triggered by stop())
				this.logger.error(`whisper-server exited unexpectedly (code=${code}, signal=${signal})`);
				this.process = null;
			}
		});

		this.externallyManaged = false;

		const ready = await this.waitForReady();
		if (ready) {
			new Notice('Whisper ready');
			this.logger.info('whisper-server is ready');
		} else {
			new Notice('Whisper server failed to start within 15s');
			this.logger.error('whisper-server did not become healthy within timeout');
		}
	}

	async stop(): Promise<void> {
		if (this.externallyManaged) {
			this.logger.info('Skipping stop — server is externally managed');
			return;
		}

		const proc = this.process;
		if (!proc) return;

		// Null out this.process first so the 'exit' handler knows the exit is intentional
		this.process = null;

		return new Promise<void>((resolve) => {
			const killTimeout = setTimeout(() => {
				this.logger.info('SIGTERM timed out — sending SIGKILL');
				proc.kill('SIGKILL');
				resolve();
			}, 3000);

			proc.once('exit', () => {
				clearTimeout(killTimeout);
				this.logger.info('whisper-server stopped');
				resolve();
			});

			this.logger.info('Sending SIGTERM to whisper-server');
			proc.kill('SIGTERM');
		});
	}

	isRunning(): boolean {
		if (this.externallyManaged) return true;
		return this.process !== null;
	}

	/** Poll /health every 500ms until ready or timeout (default 15s). */
	async waitForReady(timeoutMs = 15_000): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const healthy = await this.probeHealth();
			if (healthy) return true;
			await sleep(500);
		}

		return false;
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	/** Returns true if GET /health responds with status 200 and body contains "ok". */
	private probeHealth(): Promise<boolean> {
		return new Promise((resolve) => {
			const req = http.get(
				{ host: this.host, port: this.port, path: '/health', timeout: 1000 },
				(res) => {
					let body = '';
					res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
					res.on('end', () => {
						if (res.statusCode === 200 && body.includes('ok')) {
							resolve(true);
						} else {
							// 503 "loading model" or any other status → not ready yet
							resolve(false);
						}
					});
				},
			);

			req.on('error', () => resolve(false));
			req.on('timeout', () => { req.destroy(); resolve(false); });
		});
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
