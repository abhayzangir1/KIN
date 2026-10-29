import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CoreServer } from '../src/server/core_server.js';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('CORS Clobbering Fix & Project Creation Idempotency', () => {
  let server: CoreServer;
  let baseUrl: string;
  const testPort = 54399;
  const dbPath = ':memory:';

  beforeAll(async () => {
    server = new CoreServer({ port: testPort, dbPath, requireIpcAuth: true });
    await server.start();
    baseUrl = `http://127.0.0.1:${testPort}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  function makeRequest(
    method: string,
    urlPath: string,
    headers: Record<string, string> = {},
    body?: any
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: any }> {
    return new Promise((resolve, reject) => {
      const u = new URL(urlPath, baseUrl);
      const req = http.request(
        u,
        {
          method,
          headers: {
            ...headers,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
        },
        (res) => {
          let chunks = '';
          res.on('data', (c) => (chunks += c));
          res.on('end', () => {
            let data: any;
            try {
              data = chunks ? JSON.parse(chunks) : null;
            } catch {
              data = chunks;
            }
            resolve({ status: res.statusCode || 0, headers: res.headers, data });
          });
        }
      );
      req.on('error', reject);
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  it('1. Returns Access-Control-Allow-Origin: http://tauri.localhost and allows PUT method', async () => {
    const res = await makeRequest('OPTIONS', '/api/projects', {
      Origin: 'http://tauri.localhost',
      'Access-Control-Request-Method': 'PUT',
    });

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://tauri.localhost');
    expect(res.headers['access-control-allow-methods']).toContain('PUT');
    expect(res.headers['access-control-allow-methods']).toContain('GET, POST, PUT, PATCH, DELETE, OPTIONS');
  });

  it('2. Preserves Access-Control-Allow-Origin http://tauri.localhost on GET state and projects', async () => {
    const token = (server as any).ipcAuthToken;
    const res = await makeRequest('GET', '/api/state', {
      Origin: 'http://tauri.localhost',
      Authorization: `Bearer ${token}`,
    });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://tauri.localhost');
    expect(res.data).toHaveProperty('projects');
  });

  it('3. Supports origin === "null" from loopback or with valid IPC token', async () => {
    const token = (server as any).ipcAuthToken;
    const res = await makeRequest('GET', '/api/state', {
      Origin: 'null',
      Authorization: `Bearer ${token}`,
    });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('null');
  });

  it('4. Project creation idempotency: repeated POST with same name returns 200 and existing project', async () => {
    const token = (server as any).ipcAuthToken;
    const uniqueProjectName = `IdempotentTest-${Date.now()}`;
    const repoPath = path.resolve(process.cwd(), 'test_repo_idempotent');

    // First creation -> 201
    const res1 = await makeRequest(
      'POST',
      '/api/projects',
      {
        Origin: 'http://tauri.localhost',
        Authorization: `Bearer ${token}`,
      },
      { name: uniqueProjectName, repoPath }
    );

    expect(res1.status).toBe(201);
    expect(res1.headers['access-control-allow-origin']).toBe('http://tauri.localhost');
    expect(res1.data.project.name).toBe(uniqueProjectName);
    const createdId = res1.data.project.id;

    // Second creation with exact same name -> 200 (idempotent, no duplicates)
    const res2 = await makeRequest(
      'POST',
      '/api/projects',
      {
        Origin: 'http://tauri.localhost',
        Authorization: `Bearer ${token}`,
      },
      { name: uniqueProjectName, repoPath }
    );

    expect(res2.status).toBe(200);
    expect(res2.headers['access-control-allow-origin']).toBe('http://tauri.localhost');
    expect(res2.data.project.id).toBe(createdId);
    expect(res2.data.project.name).toBe(uniqueProjectName);

    // Clean up temporary folder if created
    if (fs.existsSync(repoPath)) {
      try { fs.rmdirSync(repoPath); } catch {}
    }
  });
});
