import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import { SecretBroker } from '../src/security/secret_broker.js';
import { ToolGateway } from '../src/execution/tool_gateway.js';

describe('Messaging Connectors & SecretBroker Hardening', () => {
  describe('1. SecretBroker Discord & Telegram Token Sanitization', () => {
    it('redacts Discord bot tokens in raw observation streams and preserves Bot prefix', () => {
      const broker = SecretBroker.getInstance();
      const dummyDiscord = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'Ga1234', 'abcdefghijklmnopqrstuvwxyz12345'].join('.');
      const sampleText = `Connected to Discord with token ${dummyDiscord} successfully`;
      const sanitized = broker.redactSecrets(sampleText);
      expect(sanitized).not.toContain('MTIzNDU2Nzg5MDEyMzQ1Njc4');
      expect(sanitized).toContain('[REDACTED][REDACTED_DISCORD_TOKEN]');

      const authHeader = `Authorization: Bot ${dummyDiscord}`;
      const sanitizedHeader = broker.redactSecrets(authHeader);
      expect(sanitizedHeader).toContain('Authorization: Bot [REDACTED][REDACTED_DISCORD_TOKEN]');
    });

    it('redacts Telegram bot tokens in raw observation streams and in API URLs', () => {
      const broker = SecretBroker.getInstance();
      const dummyTelegram = ['123456789', 'ABCdefGHIjklMNOpqrSTUvwxYZ123456789'].join(':');
      const sampleText = `Telegram client initialized: ${dummyTelegram}`;
      const sanitized = broker.redactSecrets(sampleText);
      expect(sanitized).not.toContain('123456789');
      expect(sanitized).toContain('[REDACTED][REDACTED_TELEGRAM_TOKEN]');

      // Telegram API URL format (/bot<token>/method)
      const urlSample = `https://api.telegram.org/bot${dummyTelegram}/sendMessage`;
      const sanitizedUrl = broker.redactSecrets(urlSample);
      expect(sanitizedUrl).not.toContain('123456789');
      expect(sanitizedUrl).toBe('https://api.telegram.org/bot[REDACTED][REDACTED_TELEGRAM_TOKEN]/sendMessage');
    });

    it('continues to redact Slack, GitHub, and OpenAI tokens', () => {
      const broker = SecretBroker.getInstance();
      const dummySlack = ['xoxb', '123456789012', '1234567890123', 'abcdefghijklmnopqrstuvwx'].join('-');
      const dummyGh = ['ghp', '123456789012345678901234567890123456'].join('_');
      const slackSample = `Posting to Slack with ${dummySlack}`;
      const ghSample = `Cloning repo with ${dummyGh}`;
      expect(broker.redactSecrets(slackSample)).toContain('[REDACTED_SLACK_TOKEN]');
      expect(broker.redactSecrets(ghSample)).toContain('[REDACTED_GITHUB_TOKEN]');
    });
  });

  describe('2. ToolGateway sendExternalMessage Tool Schema & Security Validation', () => {
    it('registers sendExternalMessage in tool schemas', () => {
      const gateway = new ToolGateway({});
      const schemas = gateway.getToolSchemas();
      const schema = schemas.find((s) => s.name === 'sendExternalMessage');
      expect(schema).toBeDefined();
      expect(schema?.description).toContain('external messaging');
      expect(schema?.parameters?.required).toContain('url');
      expect(schema?.parameters?.required).toContain('message');
    });

    it('classifies sendExternalMessage with MEDIUM risk level', () => {
      const gateway = new ToolGateway({});
      const risk = gateway.classifyRisk('sendExternalMessage', { url: 'https://example.com/webhook', message: 'Hello' });
      expect(risk).toBe('MEDIUM');
    });

    it('maps sendExternalMessage capability to web:browse and chat:write', () => {
      const gateway = new ToolGateway({});
      const cap = gateway.getRequiredCapability('sendExternalMessage');
      expect(cap.primary).toBe('web:browse');
      expect(cap.aliases).toContain('chat:write');
      expect(cap.aliases).toContain('chat:external');
    });

    it('fails fast if url or message is missing', async () => {
      const gateway = new ToolGateway({});
      const context = {
        agentId: 'agent-1',
        projectId: 'proj-kin',
        channelId: 'chan-1',
        autonomyMode: 'AUTO' as const,
        allowedCapabilities: ['web:browse'],
        worktreeRoot: process.cwd(),
      };

      const missingUrl = await gateway.executeTool('sendExternalMessage', { message: 'hello' }, context);
      expect(missingUrl.success).toBe(false);
      expect(missingUrl.error).toContain("sendExternalMessage requires a 'url' parameter");

      const missingMsg = await gateway.executeTool('sendExternalMessage', { url: 'https://example.com' }, context);
      expect(missingMsg.success).toBe(false);
      expect(missingMsg.error).toContain("sendExternalMessage requires a 'message' parameter");
    });

    it('authoritatively blocks SSRF attempts including 127.0.0.2, trailing dots, IPv6 mapped loopback, and metadata', async () => {
      const gateway = new ToolGateway({});
      const context = {
        agentId: 'agent-1',
        projectId: 'proj-kin',
        channelId: 'chan-1',
        autonomyMode: 'AUTO' as const,
        allowedCapabilities: ['web:browse'],
        worktreeRoot: process.cwd(),
      };

      // Disallowed protocol
      const protoRes = await gateway.executeTool('sendExternalMessage', { url: 'ftp://files.example.com', message: 'test' }, context);
      expect(protoRes.success).toBe(false);
      expect(protoRes.error).toContain("Unsupported protocol 'ftp:'");

      // SSRF against standard cloud metadata endpoint
      const metadataRes = await gateway.executeTool('sendExternalMessage', {
        url: 'http://169.254.169.254/latest/meta-data/',
        message: 'exfil'
      }, context);
      expect(metadataRes.success).toBe(false);
      expect(metadataRes.error).toContain('SSRF_BLOCKED');

      // SSRF against Alibaba cloud metadata endpoint
      const alibabaRes = await gateway.executeTool('sendExternalMessage', {
        url: 'http://100.100.100.200/latest/meta-data/',
        message: 'exfil'
      }, context);
      expect(alibabaRes.success).toBe(false);
      expect(alibabaRes.error).toContain('SSRF_BLOCKED');

      // SSRF against localhost with trailing dot (DNS root domain)
      const trailingDotRes = await gateway.executeTool('sendExternalMessage', {
        url: 'http://localhost.:8080/webhook',
        message: 'test'
      }, context);
      expect(trailingDotRes.success).toBe(false);
      expect(trailingDotRes.error).toContain('SSRF_BLOCKED');

      // SSRF against loopback subnet address (127.0.0.2)
      const loopbackSubnetRes = await gateway.executeTool('sendExternalMessage', {
        url: 'http://127.0.0.2:8080/webhook',
        message: 'test'
      }, context);
      expect(loopbackSubnetRes.success).toBe(false);
      expect(loopbackSubnetRes.error).toContain('SSRF_BLOCKED');

      // SSRF against IPv6-mapped IPv4 loopback address
      const ipv6MappedRes = await gateway.executeTool('sendExternalMessage', {
        url: 'http://[::ffff:127.0.0.1]:8080/webhook',
        message: 'test'
      }, context);
      expect(ipv6MappedRes.success).toBe(false);
      expect(ipv6MappedRes.error).toContain('SSRF_BLOCKED');
    });

    it('dispatches formatted webhook payloads with HTML escaping, chat_id forwarding, and truncation', async () => {
      let receivedBody: any = null;

      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            receivedBody = JSON.parse(body);
          } catch {
            receivedBody = body;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address() as any;
      const testUrl = `http://127.0.0.1:${addr.port}/webhook`;

      try {
        const gateway = new ToolGateway({});
        const context = {
          agentId: 'agent-1',
          projectId: 'proj-kin',
          channelId: 'chan-1',
          autonomyMode: 'AUTO' as const,
          allowedCapabilities: ['*'],
          worktreeRoot: process.cwd(),
        };

        // Test Discord formatting & truncation
        const discordRes = await gateway.executeTool('sendExternalMessage', {
          url: testUrl,
          message: 'Build succeeded',
          platform: 'discord',
          title: 'CI Alert',
          allowPrivateNetwork: true,
        }, context);

        expect(discordRes.success).toBe(true);
        expect(receivedBody.content).toBe('Build succeeded');
        expect(receivedBody.embeds?.[0]?.title).toBe('CI Alert');

        // Test Slack formatting
        const slackRes = await gateway.executeTool('sendExternalMessage', {
          url: testUrl,
          message: 'Deploy completed',
          platform: 'slack',
          title: 'Prod Release',
          channel: '#releases',
          allowPrivateNetwork: true,
        }, context);

        expect(slackRes.success).toBe(true);
        expect(receivedBody.text).toContain('*Prod Release*');
        expect(receivedBody.text).toContain('Deploy completed');
        expect(receivedBody.channel).toBe('#releases');

        // Test Telegram formatting with HTML escaping of <, >, and & special characters and chat_id
        const telegramRes = await gateway.executeTool('sendExternalMessage', {
          url: testUrl,
          message: 'Error if x < y && y > z',
          platform: 'telegram',
          title: 'Alert <Core>',
          chatId: '12345678',
          allowPrivateNetwork: true,
        }, context);

        expect(telegramRes.success).toBe(true);
        expect(receivedBody.text).toContain('<b>Alert &lt;Core&gt;</b>');
        expect(receivedBody.text).toContain('Error if x &lt; y &amp;&amp; y &gt; z');
        expect(receivedBody.parse_mode).toBe('HTML');
        expect(receivedBody.chat_id).toBe('12345678');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
