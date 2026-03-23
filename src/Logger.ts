export class Logger {
  constructor(private debugMode: boolean) {}

  info(msg: string): void {
    console.log(`[Sasayaki] ${msg}`);
  }

  debug(msg: string): void {
    if (this.debugMode) console.log(`[Sasayaki:debug] ${msg}`);
  }

  error(msg: string, err?: unknown): void {
    console.error(`[Sasayaki] ${msg}`, err);
  }

  setDebug(value: boolean): void {
    this.debugMode = value;
  }
}
