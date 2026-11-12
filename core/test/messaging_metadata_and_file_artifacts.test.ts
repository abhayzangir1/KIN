import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CoreServer } from '../src/server/core_server.js';
import { KinDatabase } from '../src/storage/db.js';
import { MigrationRunner } from '../src/storage/migration_runner.js';
import { ChannelService } from '../src/communication/channel_service.js';

describe('Messaging Metadata & File Artifacts Deep Verification', () => {
  let server: CoreServer;
  let testPort: number;
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-metadata-test-'));
    dbPath = path.join(tempDir, 'kin_test.sqlite');

    // Create mock project files
    fs.writeFileSync(path.join(tempDir, 'test_sample.txt'), 'Sample text file content for preview');
    fs.writeFileSync(path.join(tempDir, 'test_image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    fs.writeFileSync(path.join(tempDir, '.env'), 'SECRET_KEY=super-secret');

    server = new CoreServer({
      port: 0,
      dbPath,
      enableTauriEventBridge: false,
    });
    testPort = await server.start();

    // Create a test project pointing to tempDir
    await fetch(`http://127.0.0.1:${testPort}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'MetadataTestProj', repoPath: tempDir }),
    });
  });

  afterEach(async () => {
    if (server) await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('persists message replyTo and attachments in SQLite metadata_json and returns in GET', async () => {
    const channelId = 'chan-general';
    const metadataPayload = {
      replyTo: {
        messageId: 'msg-parent-123',
        senderName: 'Boss',
        excerpt: 'Initial architectural proposal',
      },
      attachments: [
        {
          id: 'upl-1',
          filename: 'architecture_diagram.png',
          size: 10240,
          mimeType: 'image/png',
          url: '/api/projects/proj-1/uploads/upl-1/download',
        },
        {
          id: 'upl-2',
          filename: 'spec.pdf',
          size: 45000,
          mimeType: 'application/pdf',
          url: '/api/projects/proj-1/uploads/upl-2/download',
        },
      ],
    };

    const postRes = await fetch(`http://127.0.0.1:${testPort}/api/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Replying with requested architectural specs and diagram',
        metadata: metadataPayload,
      }),
    });

    expect(postRes.status).toBe(201);
    const postData = await postRes.json();
    expect(postData.message).toBeDefined();
    expect(postData.message.metadata).toBeDefined();
    expect(postData.message.metadata.replyTo.messageId).toBe('msg-parent-123');
    expect(postData.message.metadata.attachments.length).toBe(2);

    // Fetch messages from channel
    const getRes = await fetch(`http://127.0.0.1:${testPort}/api/channels/${channelId}/messages`);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    const retrievedMsg = getData.messages.find((m: any) => m.id === postData.message.id);

    expect(retrievedMsg).toBeDefined();
    expect(retrievedMsg.metadata).toBeDefined();
    expect(retrievedMsg.metadata.replyTo.senderName).toBe('Boss');
    expect(retrievedMsg.metadata.attachments[0].filename).toBe('architecture_diagram.png');
    expect(retrievedMsg.metadata.attachments[1].filename).toBe('spec.pdf');
  });

  it('ChannelService directly inserts and retrieves message metadata', () => {
    const db = new KinDatabase(dbPath);
    new MigrationRunner(db).runMigrations();
    const service = new ChannelService(db);

    const created = service.sendMessage({
      channelId: 'chan-general',
      senderId: 'user-operator',
      senderType: 'human',
      content: 'Direct ChannelService call with metadata',
      metadata: {
        tag: 'unit-test',
        count: 42,
      },
    });

    expect(created.metadata).toEqual({ tag: 'unit-test', count: 42 });

    const messages = service.getMessages('chan-general', 10);
    const found = messages.find((m) => m.id === created.id);
    expect(found).toBeDefined();
    expect(found?.metadata).toEqual({ tag: 'unit-test', count: 42 });
    db.close();
  });

  it('serves raw file stream via GET /api/projects/:id/artifacts?raw=true with proper Content-Type', async () => {
    // List projects to get created project ID
    const stateRes = await fetch(`http://127.0.0.1:${testPort}/api/state`);
    const stateData = await stateRes.json();
    const proj = stateData.projects.find((p: any) => p.name === 'MetadataTestProj');
    expect(proj).toBeDefined();

    // 1. Text file raw stream
    const textRes = await fetch(`http://127.0.0.1:${testPort}/api/projects/${proj.id}/artifacts?path=test_sample.txt&raw=true`);
    expect(textRes.status).toBe(200);
    expect(textRes.headers.get('content-type')).toContain('text/plain');
    const textBody = await textRes.text();
    expect(textBody).toBe('Sample text file content for preview');

    // 2. Image raw stream
    const imgRes = await fetch(`http://127.0.0.1:${testPort}/api/projects/${proj.id}/artifacts?path=test_image.png&raw=true`);
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get('content-type')).toBe('image/png');
    const imgBuffer = await imgRes.arrayBuffer();
    expect(imgBuffer.byteLength).toBe(8);

    // 3. Traversal protection: 403 Forbidden
    const traversalRes = await fetch(`http://127.0.0.1:${testPort}/api/projects/${proj.id}/artifacts?path=../../etc/passwd&raw=true`);
    expect(traversalRes.status).toBe(403);

    // 4. Sensitive file protection: 403 Forbidden
    const sensitiveRes = await fetch(`http://127.0.0.1:${testPort}/api/projects/${proj.id}/artifacts?path=.env&raw=true`);
    expect(sensitiveRes.status).toBe(403);

    // 5. Download Content-Disposition header verification
    const dlRes = await fetch(`http://127.0.0.1:${testPort}/api/projects/${proj.id}/artifacts?path=test_sample.txt&raw=true&download=true`);
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get('content-disposition')).toContain('attachment; filename="test_sample.txt"');
  });
});
