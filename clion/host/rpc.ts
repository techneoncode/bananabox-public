import { createInterface } from 'node:readline';

export type Handler = (params: any) => unknown | Promise<unknown>;
const handlers = new Map<string, Handler>();
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
let sequence = 0;
export function send(message: unknown): void { process.stdout.write(JSON.stringify(message) + '\n'); }
export function notify(method: string, params: unknown = {}): void { send({ method, params }); }
export function handle(method: string, callback: Handler): void { handlers.set(method, callback); }
export function request<T = any>(method: string, params: unknown = {}): Promise<T> {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CLion request timed out: ${method}`)); }, 10 * 60_000);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}
export function listen(onClose: () => void): void {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', async line => {
    let message: any;
    try {
      message = JSON.parse(line);
      if (!message.method) {
        const call = pending.get(message.id);
        if (call) {
          pending.delete(message.id); clearTimeout(call.timer);
          if (message.error) call.reject(new Error(message.error)); else call.resolve(message.result);
        }
        return;
      }
      const callback = handlers.get(message.method);
      if (!callback) throw new Error(`Unknown host operation: ${message.method}`);
      const result = await callback(message.params ?? {});
      if (message.id !== undefined) send({ id: message.id, result: result ?? null });
    } catch (error) {
      if (message?.id !== undefined) send({ id: message.id, error: String(error) });
      else process.stderr.write(`${String(error)}\n`);
    }
  });
  input.on('close', onClose);
}
