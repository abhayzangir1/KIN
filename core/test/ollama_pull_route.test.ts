import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CoreServer } from '../src/server/core_server.js';

describe('POST /api/system/ollama/pull', () => {
  let tempDir: string;
  let dbPath: string;
  let server: CoreServer;
  let port: number;
  let origOllamaHost: string | undefined;
  let origOllamaBaseUrl: string | undefined;
  let mockServer: http.Server | null = null;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-ollama-pull-test-'));
    dbPath = path.join(tempDir, 'test.sqlite');
    server = new CoreServer({ port: 0, dbPath });
    port = await server.start();
  });

  afterAll(async () => {
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(() => {
    origOllamaHost = process.env.OLLAMA_HOST;
    origOllamaBaseUrl = process.env.OLLAMA_BASE_URL;
  });

  afterEach(async () => {
    if (origOllamaHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = origOllamaHost;

    if (origOllamaBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = origOllamaBaseUrl;

    if (mockServer) {
      await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
      mockServer = null;
    }
  });

  it('rejects invalid model names with HTTP 400', async () => {
    const invalidModels = ['', '   ', 'qwen; rm -rf /', 'model name with spaces', 'a'.repeat(129), 'model?query=1'];
    for (const model of invalidModels) {
      const res = await fetch(`http://127.0.0.1:${port}/api/system/ollama/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBeTruthy();
    }

    // Missing model field
    const missingRes = await fetch(`http://127.0.0.1:${port}/api/system/ollama/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missingRes.status).toBe(400);
  });

  it('pulls a model successfully from mocked Ollama and returns HTTP 200', async () => {
    let receivedBody: any = null;
    mockServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/pull') {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
          receivedBody = JSON.parse(raw);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success' }));
        });
        return;
      }
      if (req.method === 'GET' && req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => mockServer!.listen(0, '127.0.0.1', () => resolve()));
    const mockPort = (mockServer.address() as any).port;
    process.env.OLLAMA_HOST = `http://127.0.0.1:${mockPort}`;

    const res = await fetch(`http://127.0.0.1:${port}/api/system/ollama/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen2.5-coder:7b' }),
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data).toMatchObject({
      ok: true,
      model: 'qwen2.5-coder:7b',
      status: 'success',
    });
    expect(receivedBody).toEqual({ name: 'qwen2.5-coder:7b', stream: false });
  });

  it('returns HTTP 502 when upstream Ollama returns an error or is unreachable', async () => {
    mockServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/pull') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'manifest not found' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => mockServer!.listen(0, '127.0.0.1', () => resolve()));
    const mockPort = (mockServer.address() as any).port;
    process.env.OLLAMA_HOST = `http://127.0.0.1:${mockPort}`;

    const res = await fetch(`http://127.0.0.1:${port}/api/system/ollama/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nonexistent:latest' }),
    });

    expect(res.status).toBe(502);
    const data: any = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain('manifest not found');
  });
});
