import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ModelGateway } from '../src/execution/model_gateway.js';
import { CoreServer } from '../src/server/core_server.js';
import { SecretVault } from '../src/security/secret_vault.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';

describe('KIN Multi-Key & Multi-Provider Architecture Test Suite', { timeout: 30000 }, () => {
  let tempDir: string;
  let tempDbPath: string;
  let server: CoreServer;
  let port: number;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-multi-provider-test-'));
    tempDbPath = path.join(tempDir, 'kin_multi_key_test.sqlite');
    server = new CoreServer({ port: 0, dbPath: tempDbPath });
    port = await server.start();
  });

  afterAll(async () => {
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. ModelGateway Custom BaseURL & Multi-Key Isolation', () => {
    it('parses model IDs for standard providers, OpenAI-compatible providers, and custom prefixes', () => {
      const gateway = new ModelGateway();
      gateway.registerCustomProvider('my-vllm', 'http://127.0.0.1:8000/v1');

      expect(gateway.parseModelId('openai:gpt-4o')).toEqual(['openai', 'gpt-4o']);
      expect(gateway.parseModelId('anthropic:claude-3-7-sonnet')).toEqual(['anthropic', 'claude-3-7-sonnet']);
      expect(gateway.parseModelId('together:meta-llama/llama-3.3-70b')).toEqual(['together', 'meta-llama/llama-3.3-70b']);
      expect(gateway.parseModelId('deepinfra:deepseek-ai/deepseek-v3')).toEqual(['deepinfra', 'deepseek-ai/deepseek-v3']);
      expect(gateway.parseModelId('vllm:mistralai/mistral-7b')).toEqual(['vllm', 'mistralai/mistral-7b']);
      expect(gateway.parseModelId('openai_compatible:qwen/qwen-2.5-coder')).toEqual(['openai_compatible', 'qwen/qwen-2.5-coder']);
      expect(gateway.parseModelId('my-vllm:custom-model-id')).toEqual(['my-vllm', 'custom-model-id']);
      expect(gateway.parseModelId('openai/gpt-4o-mini')).toEqual(['openai', 'gpt-4o-mini']);
      expect(gateway.parseModelId('ollama/llama3')).toEqual(['ollama', 'llama3']);
      expect(gateway.parseModelId('llama3')).toEqual(['ollama', 'llama3']);
    });

    it('routes requests to custom baseURL instead of default cloud URL', async () => {
      let receivedUrl = '';
      let receivedAuth = '';
      let receivedBody: any = null;

      const mockTarget = http.createServer((req, res) => {
        receivedUrl = req.url || '';
        receivedAuth = req.headers['authorization'] || '';
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            receivedBody = JSON.parse(body);
          } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: 'Response from mock custom endpoint' } }],
              usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
            })
          );
        });
      });

      await new Promise<void>((resolve) => mockTarget.listen(0, '127.0.0.1', () => resolve()));
      const targetAddress = mockTarget.address() as any;
      const targetBaseUrl = `http://127.0.0.1:${targetAddress.port}/v1`;

      try {
        const gateway = new ModelGateway();
        gateway.registerCustomProvider('together', targetBaseUrl, 'test-together-key-123');

        const result = await gateway.invoke({
          modelId: 'together:meta-llama/llama-3.3-70b-instruct',
          messages: [{ role: 'user', content: 'Hello custom provider' }],
        });

        expect(result.content).toBe('Response from mock custom endpoint');
        expect(result.provider).toBe('together');
        expect(receivedUrl).toBe('/v1/chat/completions');
        expect(receivedAuth).toBe('Bearer test-together-key-123');
        expect(receivedBody?.model).toBe('meta-llama/llama-3.3-70b-instruct');
      } finally {
        mockTarget.close();
      }
    });

    it('seamlessly rotates to secondary key on 429 rate limit', async () => {
      const keysUsed: string[] = [];
      const mockServer = http.createServer((req, res) => {
        const auth = req.headers['authorization'] || '';
        keysUsed.push(auth);
        if (auth.includes('key-primary-429')) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' });
          res.end(JSON.stringify({ error: { message: 'Rate limit exceeded on key 1' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: 'Success from backup key 2' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          })
        );
      });

      await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
      const srvAddress = mockServer.address() as any;
      const customUrl = `http://127.0.0.1:${srvAddress.port}/v1`;

      try {
        const gateway = new ModelGateway();
        gateway.registerCustomProvider('openai', customUrl);

        let primaryResolved = false;
        gateway.setApiKeyResolver((p) => {
          if (p === 'openai') {
            return primaryResolved ? 'key-backup-success' : 'key-primary-429';
          }
          return undefined;
        });

        gateway.setAllKeysResolver((p) => {
          if (p === 'openai') {
            return [
              { id: 'cred-1', key: 'key-primary-429', keyAlias: 'Primary Key' },
              { id: 'cred-2', key: 'key-backup-success', keyAlias: 'Secondary Backup Key' },
            ];
          }
          return [];
        });

        const result = await gateway.invoke({
          modelId: 'openai:gpt-4o',
          messages: [{ role: 'user', content: 'Test rate limit failover' }],
        });

        expect(result.content).toBe('Success from backup key 2');
        expect(keysUsed).toContain('Bearer key-primary-429');
        expect(keysUsed).toContain('Bearer key-backup-success');
      } finally {
        mockServer.close();
      }
    });

    it('seamlessly rotates across 3 distinct keys with independent endpoints on 429', async () => {
      const calls: Array<{ port: number; auth: string }> = [];

      const server1 = http.createServer((req, res) => {
        calls.push({ port: 1, auth: req.headers['authorization'] || '' });
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Rate limit on endpoint 1' } }));
      });
      const server2 = http.createServer((req, res) => {
        calls.push({ port: 2, auth: req.headers['authorization'] || '' });
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Rate limit on endpoint 2' } }));
      });
      const server3 = http.createServer((req, res) => {
        calls.push({ port: 3, auth: req.headers['authorization'] || '' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: 'Success from tertiary endpoint 3' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
      });

      await Promise.all([
        new Promise<void>((r) => server1.listen(0, '127.0.0.1', () => r())),
        new Promise<void>((r) => server2.listen(0, '127.0.0.1', () => r())),
        new Promise<void>((r) => server3.listen(0, '127.0.0.1', () => r())),
      ]);

      const port1 = (server1.address() as any).port;
      const port2 = (server2.address() as any).port;
      const port3 = (server3.address() as any).port;

      try {
        const gateway = new ModelGateway();
        gateway.registerCustomProvider('together', `http://127.0.0.1:${port1}/v1`);

        gateway.setApiKeyResolver((p) => (p === 'together' ? 'key-ep1' : undefined));
        gateway.setAllKeysResolver((p) => {
          if (p === 'together') {
            return [
              { id: 'c1', key: 'key-ep1', baseUrl: `http://127.0.0.1:${port1}/v1` },
              { id: 'c2', key: 'key-ep2', baseUrl: `http://127.0.0.1:${port2}/v1` },
              { id: 'c3', key: 'key-ep3', baseUrl: `http://127.0.0.1:${port3}/v1` },
            ];
          }
          return [];
        });

        const result = await gateway.invoke({
          modelId: 'together:meta-llama/llama-3.3-70b',
          messages: [{ role: 'user', content: 'Testing 3-hop failover' }],
        });

        expect(result.content).toBe('Success from tertiary endpoint 3');
        expect(calls.length).toBe(3);
        expect(calls[0]).toEqual({ port: 1, auth: 'Bearer key-ep1' });
        expect(calls[1]).toEqual({ port: 2, auth: 'Bearer key-ep2' });
        expect(calls[2]).toEqual({ port: 3, auth: 'Bearer key-ep3' });
      } finally {
        server1.close();
        server2.close();
        server3.close();
      }
    });

    it('terminates cleanly when all available keys are rate limited without infinite ping-pong', async () => {
      let attemptCount = 0;
      const mockServer = http.createServer((req, res) => {
        attemptCount++;
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'All keys exhausted rate limit' } }));
      });
      await new Promise<void>((r) => mockServer.listen(0, '127.0.0.1', () => r()));
      const srvPort = (mockServer.address() as any).port;

      try {
        const gateway = new ModelGateway();
        gateway.registerCustomProvider('vllm', `http://127.0.0.1:${srvPort}/v1`);
        gateway.setApiKeyResolver(() => 'key-1');
        gateway.setAllKeysResolver(() => [
          { id: 'k1', key: 'key-1' },
          { id: 'k2', key: 'key-2' },
        ]);

        const result = await gateway.invoke({
          modelId: 'vllm:mistralai/mistral-7b',
          messages: [{ role: 'user', content: 'Testing all 429 exhaust' }],
        });

        expect(result.isError).toBe(true);
        expect(result.content).toMatch(/Rate Limit/i);
        expect(attemptCount).toBe(4);
      } finally {
        mockServer.close();
      }
    });

    it('verifyProviderConnection verifies Together, vLLM, and DeepInfra with mock OpenAI-compatible models endpoints', async () => {
      const mockApi = http.createServer((req, res) => {
        if (req.url === '/v1/models' || req.url === '/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            data: [
              { id: 'mock-model-1', object: 'model' },
              { id: 'mock-model-2', object: 'model' },
            ],
          }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      await new Promise<void>((r) => mockApi.listen(0, '127.0.0.1', () => r()));
      const apiPort = (mockApi.address() as any).port;
      const endpoint = `http://127.0.0.1:${apiPort}/v1`;

      try {
        const gateway = new ModelGateway();

        const vllmRes = await gateway.verifyProviderConnection('vllm', undefined, endpoint);
        expect(vllmRes.working).toBe(true);
        expect(vllmRes.models.length).toBeGreaterThan(0);

        const togetherRes = await gateway.verifyProviderConnection('together', 'sk-mock-together', endpoint);
        expect(togetherRes.working).toBe(true);
        expect(togetherRes.models.length).toBeGreaterThan(0);

        const deepinfraRes = await gateway.verifyProviderConnection('deepinfra', 'sk-mock-deepinfra', endpoint);
        expect(deepinfraRes.working).toBe(true);
        expect(deepinfraRes.models.length).toBeGreaterThan(0);
      } finally {
        mockApi.close();
      }
    });
  });

  describe('2. CoreServer Multi-Key BYOK End-to-End API Integration', () => {
    let cred1Id: string;
    let cred2Id: string;
    let togetherCredId: string;

    it('POST /api/settings/credentials saves multiple keys for same provider with custom aliases and baseUrls', async () => {
      // 1. Add primary OpenAI key
      const res1 = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          keyName: 'Production Work Key',
          apiKey: 'sk-proj-prod-primary-key-12345678',
          monthlyQuotaTokens: 10000000,
        }),
      });
      expect(res1.status).toBe(201);
      const data1: any = await res1.json();
      expect(data1.credential.id).toBeDefined();
      expect(data1.credential.keyAlias).toBe('Production Work Key');
      expect(data1.credential.maskedKey).toContain('sk-p');
      cred1Id = data1.credential.id;

      // 2. Add secondary OpenAI key with distinct alias
      const res2 = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          keyName: 'Experimental Research Key',
          apiKey: 'sk-proj-exp-secondary-key-87654321',
          monthlyQuotaTokens: 2000000,
        }),
      });
      expect(res2.status).toBe(201);
      const data2: any = await res2.json();
      expect(data2.credential.id).toBeDefined();
      expect(data2.credential.keyAlias).toBe('Experimental Research Key');
      cred2Id = data2.credential.id;

      // 3. Add Together AI key with custom baseUrl
      const res3 = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'together',
          keyName: 'Together AI High-Speed Key',
          apiKey: 'sk-together-prod-token-99887766',
          baseUrl: 'https://api.together.xyz/v1',
          monthlyQuotaTokens: 50000000,
        }),
      });
      expect(res3.status).toBe(201);
      const data3: any = await res3.json();
      expect(data3.credential.baseUrl).toBe('https://api.together.xyz/v1');
      togetherCredId = data3.credential.id;
    });

    it('GET /api/settings/credentials lists all keys with masked keys, aliases, and baseUrls', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(Array.isArray(data.credentials)).toBe(true);
      expect(data.credentials.length).toBeGreaterThanOrEqual(3);

      const openAiCreds = data.credentials.filter((c: any) => c.provider === 'openai');
      expect(openAiCreds.length).toBe(2);
      expect(openAiCreds.some((c: any) => c.keyAlias === 'Production Work Key')).toBe(true);
      expect(openAiCreds.some((c: any) => c.keyAlias === 'Experimental Research Key')).toBe(true);

      const togetherCred = data.credentials.find((c: any) => c.id === togetherCredId);
      expect(togetherCred).toBeDefined();
      expect(togetherCred.baseUrl).toBe('https://api.together.xyz/v1');
      expect(togetherCred.maskedKey).toContain('sk-t');
    });

    it('PUT /api/settings/credentials/:id updates baseUrl and monthly quota without overwriting secret when not provided', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/settings/credentials/${cred1Id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyName: 'Production Work Key (Updated)',
          baseUrl: 'https://custom-proxy.internal/v1',
          monthlyQuotaTokens: 25000000,
        }),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.credential.keyAlias).toBe('Production Work Key (Updated)');
      expect(data.credential.baseUrl).toBe('https://custom-proxy.internal/v1');
      expect(data.credential.monthlyQuotaTokens).toBe(25000000);
    });

    it('failure isolation: deleting one key preserves other keys for the same provider', async () => {
      // Delete cred2
      const delRes = await fetch(`http://127.0.0.1:${port}/api/settings/credentials/${cred2Id}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);

      // Verify cred1 still exists
      const listRes = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`);
      const data: any = await listRes.json();
      expect(data.credentials.some((c: any) => c.id === cred2Id)).toBe(false);
      expect(data.credentials.some((c: any) => c.id === cred1Id)).toBe(true);
      expect(data.credentials.some((c: any) => c.id === togetherCredId)).toBe(true);
    });

    it('rejects adding duplicate API key with HTTP 409 Conflict', async () => {
      // Attempt to add the exact same key as cred1Id ('sk-proj-prod-primary-key-12345678')
      const dupRes = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          keyName: 'Duplicate Key Attempt',
          apiKey: 'sk-proj-prod-primary-key-12345678',
        }),
      });
      expect(dupRes.status).toBe(409);
      const dupData: any = await dupRes.json();
      expect(dupData.duplicate).toBe(true);
      expect(dupData.error).toContain('already been added');

      // Attempt with leading/trailing whitespace
      const dupRes2 = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          keyName: 'Duplicate Key With Whitespace',
          apiKey: '   sk-proj-prod-primary-key-12345678  \n',
        }),
      });
      expect(dupRes2.status).toBe(409);
    });

    it('rejects PUT updating a credential with a key already in use by another credential', async () => {
      // Add a fresh credential first
      const freshRes = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic',
          keyName: 'Anthropic Fresh Key',
          apiKey: 'sk-ant-fresh-unique-token-99112233',
        }),
      });
      expect(freshRes.status).toBe(201);
      const freshData: any = await freshRes.json();
      const freshId = freshData.credential.id;

      // Try updating freshId to use cred1Id's key
      const putDupRes = await fetch(`http://127.0.0.1:${port}/api/settings/credentials/${freshId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'sk-proj-prod-primary-key-12345678',
        }),
      });
      expect(putDupRes.status).toBe(409);
      const putDupData: any = await putDupRes.json();
      expect(putDupData.duplicate).toBe(true);
      expect(putDupData.error).toContain('Duplicate keys cannot be saved');
    });

    it('POST /api/settings/credentials allows zero-auth local endpoints without API key', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'lmstudio',
          keyName: 'Local LM Studio 1234',
          baseUrl: 'http://localhost:1234/v1',
        }),
      });
      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.credential.id).toBeDefined();
      expect(data.credential.provider).toBe('lmstudio');
      expect(data.credential.keyAlias).toBe('Local LM Studio 1234');
      expect(data.credential.maskedKey).toBe('No Key (Local)');
      expect(data.credential.baseUrl).toBe('http://localhost:1234/v1');

      const getRes = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`);
      const getData: any = await getRes.json();
      const lmCred = getData.credentials.find((c: any) => c.id === data.credential.id);
      expect(lmCred).toBeDefined();
      expect(lmCred.maskedKey).toBe('No Key (Local)');

      await fetch(`http://127.0.0.1:${port}/api/settings/credentials/${data.credential.id}`, { method: 'DELETE' });
    });

    it('syncModelGatewayProviders cleans up customEndpoints and prevents synthetic cred-* pollution', async () => {
      const addRes = await fetch(`http://127.0.0.1:${port}/api/settings/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'my-custom-llm',
          keyName: 'Custom LLM Server',
          apiKey: 'custom-secret-key-4455',
          baseUrl: 'http://127.0.0.1:9099/v1',
        }),
      });
      expect(addRes.status).toBe(201);
      const addData: any = await addRes.json();
      const customCredId = addData.credential.id;

      const endpointsBefore = (server as any).modelGateway.getCustomEndpointNames();
      expect(endpointsBefore).toContain('my-custom-llm');
      expect(endpointsBefore.some((name: string) => name.startsWith('cred-'))).toBe(false);

      const delRes = await fetch(`http://127.0.0.1:${port}/api/settings/credentials/${customCredId}`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);

      const endpointsAfter = (server as any).modelGateway.getCustomEndpointNames();
      expect(endpointsAfter).not.toContain('my-custom-llm');
      expect(endpointsAfter.some((name: string) => name.startsWith('cred-'))).toBe(false);
    });
  });
});
