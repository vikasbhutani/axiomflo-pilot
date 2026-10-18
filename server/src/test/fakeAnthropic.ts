/** A pretend Anthropic API on a local port, for tests only. Nothing reaches the real one. */
import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface SeenRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export type Responder = (req: SeenRequest, res: ServerResponse) => void;

export class FakeAnthropic {
  readonly seen: SeenRequest[] = [];
  respond: Responder = (_req, res) => FakeAnthropic.json(res, 200, FakeAnthropic.message());
  /** Set when the gateway closed a request before the answer finished. */
  clientClosed = false;
  private server: Server | null = null;
  url = '';

  async start() {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const seen = { path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
        this.seen.push(seen);
        res.on('close', () => {
          if (!res.writableFinished) this.clientClosed = true;
        });
        this.respond(seen, res);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop() {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  static json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json', 'request-id': 'req_upstream_1' });
    res.end(JSON.stringify(body));
  }

  static message(model = 'claude-sonnet-5-5', usage: Record<string, number> = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }) {
    return { id: 'msg_1', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'SECRET ANSWER TEXT' }], stop_reason: 'end_turn', usage };
  }

  /** Server-sent events in the order Anthropic sends them. */
  static streamEvents(model = 'claude-sonnet-5-5', input = 1200, output = 300): string[] {
    const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    return [
      ev('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: input, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
      ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      ev('ping', { type: 'ping' }),
      ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'SECRET ANSWER TEXT' } }),
      ev('content_block_stop', { type: 'content_block_stop', index: 0 }),
      ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: output } }),
      ev('message_stop', { type: 'message_stop' }),
    ];
  }
}
