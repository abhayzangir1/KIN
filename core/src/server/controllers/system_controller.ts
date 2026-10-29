import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as childProcess from 'node:child_process';
import { Channel, Task } from '../../domain/types.js';
import { OAuthHandler } from '../../api/oauth_handler.js';
import { CredentialScanner } from '../../security/credential_scanner.js';
import { ToolGateway } from '../../execution/tool_gateway.js';
import { Sentinel } from '../../security/sentinel.js';
import { EventLedger } from '../../security/event_ledger.js';
import { OCCConflictError } from '../../domain/memory_repository.js';
import { SecretVault } from '../../security/secret_vault.js';
import { BaseController } from './base_controller.js';

export class SystemController extends BaseController {
  public async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    parsedUrl: URL
  ): Promise<boolean> {
      // 1b. GET /api/health — System health check & uptime
      if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
        const sqliteIntegrity = this.db.queryOne<{ integrity_check: string }>('PRAGMA integrity_check(1);');
        const activeProject = this.workspaceRepo.getProject(this.activeProjectId);
        const { configuredProviders, activeCredsCount } = this.getConfiguredProviders();
        const mem = process.memoryUsage();
        return this.sendJson(res, 200, {
          status: 'ok',
          uptime: process.uptime(),
          timestamp: Date.now(),
          version: '0.1.4',
          database: {
            connected: true,
            integrity: sqliteIntegrity?.integrity_check || 'unknown',
            path: this.dbPath,
          },
          activeProject: {
            id: this.activeProjectId,
            name: activeProject?.name || 'KIN Workspace',
          },
          autonomyMode: this.getEffectiveAutonomyMode(),
          configuredProviders: Array.from(configuredProviders),
          activeCredsCount,
          memory: {
            rssMb: Math.round(mem.rss / (1024 * 1024)),
            heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
          },
        });
      }

      // 2. GET /api/system/models or GET /api/models — Dynamic Model Catalog
      if (req.method === 'GET' && (pathname === '/api/system/models' || pathname === '/api/models')) {
        const urlObj = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
        const freeOnly = urlObj.searchParams.get('freeOnly') === '1' || urlObj.searchParams.get('freeOnly') === 'true';
        const omitUnconfigured = urlObj.searchParams.get('omitUnconfigured') === '1' || urlObj.searchParams.get('omitUnconfigured') === 'true';

        const ollamaInfo = await this.getLocalOllamaModels();
        const storedModels = this.db.query<any>('SELECT * FROM models ORDER BY created_at DESC');
        
        const modelMap = new Map<string, any>();
        
        // 1. Ollama models
        if (ollamaInfo.online && ollamaInfo.models) {
          for (const m of ollamaInfo.models) {
            if (!m.toLowerCase().includes('embed')) {
              modelMap.set(`ollama/${m}`, {
                id: `ollama/${m}`,
                name: `Ollama ${m}`,
                provider: 'ollama',
                contextWindow: 32768,
                isFree: true,
                isInstalled: true,
                configured: true,
                validated: true,
              });
            }
          }
        }
        
        const standardProvidersList = [
          'ollama', 'openrouter', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'xai', 'azure',
          'together', 'deepinfra', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'vllm',
          'openai_compatible', 'custom'
        ];
        const activeCreds = this.db.query<any>('SELECT DISTINCT provider FROM managed_credentials WHERE is_active = 1');
        const customEndpoints = this.modelGateway.getCustomEndpointNames().filter((name) => !name.startsWith('cred-'));
        const allProvidersToCheck = Array.from(new Set([
          ...standardProvidersList,
          ...activeCreds.map((c: any) => c.provider),
          ...customEndpoints,
        ]));
        const providerReadiness: Record<string, any> = {};
        await Promise.all(
          allProvidersToCheck.map(async (p) => {
            if (p === 'ollama') {
              providerReadiness['ollama'] = {
                provider: 'ollama',
                configured: true,
                validated: Boolean(ollamaInfo.online),
                modelCount: (ollamaInfo.models || []).length,
                message: ollamaInfo.online
                  ? `Local Ollama online (${ollamaInfo.models.length} model(s) available)`
                  : 'Local Ollama runtime unreachable (offline)',
              };
            } else {
              providerReadiness[p] = await this.modelGateway.checkProviderReadiness(p);
            }
          })
        );

        const standardProviderSet = new Set([
          'ollama', 'openrouter', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'xai', 'azure',
          'together', 'deepinfra', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'vllm',
          'openai_compatible', 'custom'
        ]);

        // 2. Stored / discovered provider models
        for (const sm of storedModels) {
          const isCustom = sm.provider_id === 'custom' || !standardProviderSet.has(sm.provider_id);
          const provReadiness = isCustom
            ? { configured: true, validated: true }
            : (providerReadiness[sm.provider_id] || { configured: false, validated: false });
          const isProvConfigured = Boolean(provReadiness.configured);
          const isProvValidated = Boolean(provReadiness.validated);
          const isConfigured = sm.is_active !== 0 && (isCustom || isProvConfigured);
          const isValidated = sm.is_active !== 0 && (isCustom || isProvValidated);
          if (omitUnconfigured && (!isConfigured || !isValidated)) {
            continue;
          }
          const isReasoning = Boolean(
            sm.supports_reasoning ??
            (sm.id.includes('r1') ||
             sm.id.includes('o1') ||
             sm.id.includes('o3') ||
             sm.id.includes('reason') ||
             sm.id.includes('thinking') ||
             sm.id.includes('claude-3-7') ||
             sm.id.includes('grok-2') ||
             sm.name?.toLowerCase().includes('reasoning') ||
             sm.name?.toLowerCase().includes('r1'))
          );
          modelMap.set(sm.id, {
            id: sm.id,
            name: sm.name,
            provider: sm.provider_id,
            contextWindow: sm.context_window,
            maxOutputTokens: sm.max_output_tokens,
            supportsTools: Boolean(sm.supports_tools),
            supportsVision: Boolean(sm.supports_vision),
            supportsReasoning: isReasoning,
            isFree: sm.id.includes(':free'),
            isCustom: isCustom,
            configured: isConfigured,
            validated: isValidated,
          });
        }

        // 3. Provider models for all validated providers (from env, vault, managed credentials, or custom endpoints)
        const candidateProviders = new Set([
          ...allProvidersToCheck,
        ]);
        for (const provName of candidateProviders) {
          if (provName === 'ollama' || provName === 'custom') continue;
          const provReadiness = providerReadiness[provName] || await this.modelGateway.checkProviderReadiness(provName);
          if (provReadiness && provReadiness.validated) {
            const providerModels = await this.modelGateway.fetchProviderModels(provName, undefined, { omitUnconfigured });
            for (const pm of providerModels) {
              if (!modelMap.has(pm.id)) {
                modelMap.set(pm.id, {
                  ...pm,
                  supportsReasoning: Boolean(
                    pm.supportsReasoning ??
                    (pm.id.includes('r1') ||
                     pm.id.includes('o1') ||
                     pm.id.includes('o3') ||
                     pm.id.includes('reason') ||
                     pm.id.includes('thinking') ||
                     pm.id.includes('claude-3-7') ||
                     pm.id.includes('grok-2') ||
                     pm.name?.toLowerCase().includes('reasoning') ||
                     pm.name?.toLowerCase().includes('r1'))
                  ),
                });
              }
            }
          }
        }

        if (providerReadiness['custom']?.validated) {
          const customModels = await this.modelGateway.fetchProviderModels('custom', undefined, { omitUnconfigured });
          for (const cm of customModels) {
            if (!modelMap.has(cm.id)) {
              modelMap.set(cm.id, cm);
            }
          }
        }

        // 4. Fallback standard catalog if models list is otherwise empty
        if (modelMap.size === 0 && !omitUnconfigured) {
          const defaultCatalog = await this.modelGateway.fetchProviderModels('openrouter');
          for (const dm of defaultCatalog) {
            modelMap.set(dm.id, {
              ...dm,
              configured: false,
              validated: false,
              supportsReasoning: Boolean(
                dm.supportsReasoning ??
                (dm.id.includes('r1') ||
                 dm.id.includes('o1') ||
                 dm.id.includes('o3') ||
                 dm.id.includes('reason') ||
                 dm.id.includes('thinking') ||
                 dm.id.includes('claude-3-7') ||
                 dm.name?.toLowerCase().includes('reasoning') ||
                 dm.name?.toLowerCase().includes('r1'))
              ),
            });
          }
        }

        let modelsList = Array.from(modelMap.values());
        if (omitUnconfigured) {
          modelsList = modelsList.filter((m) => m.configured !== false && m.validated !== false);
        }
        if (freeOnly) {
          modelsList = modelsList.filter((m) => Boolean(m.isFree));
        }

        return this.sendJson(res, 200, {
          ...ollamaInfo,
          models: modelsList,
          rawOllamaModels: ollamaInfo.models || [],
          providerReadiness,
        });
      }

      // 2b. GET /api/models/readiness or /api/system/models/readiness — Provider Readiness States
      if (req.method === 'GET' && (pathname === '/api/models/readiness' || pathname === '/api/system/models/readiness')) {
        const standardProviders = [
          'ollama', 'openrouter', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'xai', 'azure',
          'together', 'deepinfra', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'vllm',
          'openai_compatible', 'custom'
        ];
        const activeCreds = this.db.query<any>('SELECT DISTINCT provider FROM managed_credentials WHERE is_active = 1');
        const customEndpoints = this.modelGateway.getCustomEndpointNames().filter((name) => !name.startsWith('cred-'));
        const allProviders = Array.from(new Set([
          ...standardProviders,
          ...activeCreds.map((c: any) => c.provider),
          ...customEndpoints,
        ]));
        const readiness: Record<string, any> = {};
        await Promise.all(
          allProviders.map(async (p) => {
            readiness[p] = await this.modelGateway.checkProviderReadiness(p);
          })
        );
        return this.sendJson(res, 200, { success: true, providerReadiness: readiness });
      }

      // 2c. POST /api/models/discover — Live discovery of provider models using API key
      if (req.method === 'POST' && pathname === '/api/models/discover') {
        const body = await this.parseJsonBody<{ provider: string; apiKey?: string; baseUrl?: string; keyAlias?: string }>(req);
        if (!body.provider) {
          return this.sendJson(res, 400, { error: 'provider is required' });
        }
        if (body.baseUrl) {
          try {
            const parsedBase = new URL(body.baseUrl);
            if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
              return this.sendJson(res, 400, { error: 'Invalid baseUrl protocol. Only http: and https: are supported.' });
            }
            if (ToolGateway.isMetadataService(parsedBase.hostname)) {
              return this.sendJson(res, 400, { error: 'SSRF_BLOCKED: Cloud metadata addresses are prohibited.' });
            }
          } catch {
            return this.sendJson(res, 400, { error: 'Invalid baseUrl URL format' });
          }
        }
        if (body.baseUrl) {
          try {
            const parsedBase = new URL(body.baseUrl);
            if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
              return this.sendJson(res, 400, { error: 'Invalid baseUrl protocol. Only http: and https: are supported.' });
            }
            if (ToolGateway.isMetadataService(parsedBase.hostname)) {
              return this.sendJson(res, 400, { error: 'SSRF_BLOCKED: Cloud metadata addresses are prohibited.' });
            }
          } catch {
            return this.sendJson(res, 400, { error: 'Invalid baseUrl URL format' });
          }
          this.modelGateway.registerCustomProvider(body.provider, body.baseUrl, body.apiKey);
          if (body.keyAlias && body.keyAlias !== body.provider) {
            this.modelGateway.registerCustomProvider(body.keyAlias, body.baseUrl, body.apiKey);
          }
        }
        const discovered = await this.modelGateway.fetchProviderModels(body.provider, body.apiKey, body.baseUrl ? { baseUrl: body.baseUrl } : undefined);
        const now = Date.now();
        const validTypes = [
          'ollama', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'xai', 'azure', 'openrouter',
          'together', 'deepinfra', 'fireworks', 'perplexity', 'cerebras', 'lmstudio', 'vllm',
          'openai_compatible', 'custom'
        ];
        const pType = validTypes.includes(body.provider.toLowerCase()) ? body.provider.toLowerCase() : (body.baseUrl ? 'openai_compatible' : 'custom');
        try {
          this.db.execute(
            `INSERT OR REPLACE INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
            body.provider,
            body.keyAlias || body.provider,
            pType,
            body.baseUrl || null,
            body.apiKey ? 'managed' : null,
            now
          );
        } catch {}

        for (const m of discovered) {
          try {
            if (m.provider && m.provider !== body.provider) {
              try {
                this.db.execute(
                  `INSERT OR IGNORE INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
                   VALUES (?, ?, ?, ?, ?, 1, ?)`,
                  m.provider,
                  m.provider,
                  pType,
                  body.baseUrl || null,
                  body.apiKey ? 'managed' : null,
                  now
                );
              } catch {}
            }
            this.db.execute(
              `INSERT OR REPLACE INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              m.id,
              m.provider,
              m.name,
              m.contextWindow || 128000,
              m.maxOutputTokens || 4096,
              m.supportsTools ? 1 : 0,
              m.supportsVision ? 1 : 0,
              now
            );
          } catch {}
        }
        this.broadcastEvent('models:updated', { provider: body.provider, count: discovered.length });
        return this.sendJson(res, 200, { success: true, count: discovered.length, models: discovered });
      }

      // 2e. POST /api/models/verify-key — Authoritative live verification of provider API key
      if (req.method === 'POST' && pathname === '/api/models/verify-key') {
        const body = await this.parseJsonBody<{ provider: string; apiKey?: string; baseUrl?: string }>(req);
        if (!body.provider) {
          return this.sendJson(res, 400, { error: 'provider is required' });
        }
        if (body.baseUrl) {
          try {
            const parsedBase = new URL(body.baseUrl);
            if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
              return this.sendJson(res, 400, { error: 'Invalid baseUrl protocol. Only http: and https: are supported.' });
            }
            if (ToolGateway.isMetadataService(parsedBase.hostname)) {
              return this.sendJson(res, 400, { error: 'SSRF_BLOCKED: Cloud metadata addresses are prohibited.' });
            }
          } catch {
            return this.sendJson(res, 400, { error: 'Invalid baseUrl URL format' });
          }
        }
        const verification = await this.modelGateway.verifyProviderConnection(body.provider, body.apiKey, body.baseUrl);
        if (verification.working && verification.models.length > 0) {
          const now = Date.now();
          for (const m of verification.models) {
            try {
              this.db.execute(
                `INSERT OR REPLACE INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                m.id,
                m.provider || body.provider,
                m.name || m.id,
                m.contextWindow || 128000,
                m.maxOutputTokens || 4096,
                m.supportsTools ? 1 : 0,
                m.supportsVision ? 1 : 0,
                now
              );
            } catch {}
          }
          this.broadcastEvent('models:updated', { provider: body.provider, count: verification.models.length });
        } else if (!verification.working) {
          try {
            const remainingActive = this.db.queryOne<any>(
              'SELECT COUNT(*) as count FROM managed_credentials WHERE provider = ? AND is_active = 1',
              body.provider
            );
            if (!remainingActive || remainingActive.count === 0) {
              this.db.execute('DELETE FROM models WHERE provider_id = ?', body.provider);
              this.modelGateway.invalidateProvider(body.provider);
              this.broadcastEvent('models:updated', { provider: body.provider, count: 0 });
            }
          } catch {}
        }
        return this.sendJson(res, 200, {
          success: verification.working,
          working: verification.working,
          valid: verification.valid,
          provider: body.provider,
          message: verification.message,
          modelCount: verification.modelCount,
          models: verification.models,
        });
      }

      // 2d. POST /api/models/custom — User-defined custom model ID registration
      if (req.method === 'POST' && pathname === '/api/models/custom') {
        const body = await this.parseJsonBody<{ modelId: string; name?: string; provider?: string; contextWindow?: number; baseUrl?: string; apiKey?: string }>(req);
        if (!body.modelId || !body.modelId.trim()) {
          return this.sendJson(res, 400, { error: 'modelId is required' });
        }
        const trimmed = body.modelId.trim();
        const slashIdx = trimmed.indexOf('/');
        const detectedProvider = slashIdx !== -1 ? trimmed.substring(0, slashIdx).toLowerCase() : (body.provider || 'custom');
        const modelName = body.name?.trim() || trimmed;
        const now = Date.now();
        const validTypes = ['ollama', 'openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'openrouter', 'openai_compatible', 'custom'];
        const providerType = validTypes.includes(detectedProvider) ? detectedProvider : 'custom';

        const existingProv = this.db.queryOne<any>('SELECT id, base_url, api_key_ref FROM providers WHERE id = ?', detectedProvider);
        if (!existingProv) {
          this.db.execute(
            `INSERT INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
            detectedProvider,
            detectedProvider,
            providerType,
            body.baseUrl || null,
            body.apiKey || null,
            now
          );
        } else if (body.baseUrl || body.apiKey) {
          this.db.execute(
            `UPDATE providers SET base_url = COALESCE(?, base_url), api_key_ref = COALESCE(?, api_key_ref), is_active = 1 WHERE id = ?`,
            body.baseUrl || null,
            body.apiKey || null,
            detectedProvider
          );
        }

        this.db.execute(
          `INSERT OR REPLACE INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          trimmed,
          detectedProvider,
          modelName,
          body.contextWindow || 128000,
          4096,
          1,
          0,
          now
        );
        if (body.baseUrl) {
          const endpointName = detectedProvider === 'custom' ? (slashIdx !== -1 ? trimmed.substring(slashIdx + 1) : modelName) : detectedProvider;
          this.modelGateway.registerCustomProvider(endpointName, body.baseUrl, body.apiKey);
          this.modelGateway.registerCustomProvider('custom', body.baseUrl, body.apiKey);
          this.modelGateway.registerCustomProvider(detectedProvider, body.baseUrl, body.apiKey);
        }
        const customModel = {
          id: trimmed,
          name: modelName,
          provider: detectedProvider,
          contextWindow: body.contextWindow || 128000,
          isCustom: true,
          configured: true,
          validated: true,
        };
        this.broadcastEvent('models:updated', { customModel });
        return this.sendJson(res, 201, { success: true, model: customModel });
      }

      // 2b. POST /api/system/model/invoke — Invoke model directly through ModelGateway for verification & testing
      if (req.method === 'POST' && pathname === '/api/system/model/invoke') {
        const body = await this.parseJsonBody<{
          modelId: string;
          messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
          temperature?: number;
          maxTokens?: number;
          approvalToken?: string;
        }>(req);
        if (!body.modelId || !body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
          return this.sendJson(res, 400, { error: 'modelId and non-empty messages array are required' });
        }
        const cleanMessages = body.messages.slice(0, 100).map((m: any) => ({
          role: (['system', 'user', 'assistant'].includes(m?.role) ? m.role : 'user') as 'system' | 'user' | 'assistant',
          content: String(m?.content || '').slice(0, 200000),
        }));
        const cleanPayload = {
          modelId: String(body.modelId).trim(),
          messages: cleanMessages,
          temperature: typeof body.temperature === 'number' ? Math.max(0, Math.min(2, body.temperature)) : undefined,
          maxTokens: typeof body.maxTokens === 'number' ? Math.max(1, Math.min(32768, body.maxTokens)) : undefined,
        };
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body.approvalToken;
        const sentinel = Sentinel.getInstance();
        const toolName = 'systemModelInvoke';
        const params = { modelId: cleanPayload.modelId };
        const decision = sentinel.evaluate({
          agentId: 'operator',
          toolName,
          params,
          riskLevel: 'LOW',
          autonomyMode: this.getEffectiveAutonomyMode(),
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord(toolName, params, decision.reason);
          return this.sendJson(res, 428, { error: 'Precondition Required: Action requires operator approval', approvalId, reason: decision.reason, requiresApproval: true });
        }
        if (!decision.allowed) {
          return this.sendJson(res, 403, { error: decision.reason });
        }
        const result = await this.modelGateway.invoke(cleanPayload);
        return this.sendJson(res, 200, result);
      }

      // 3. POST /api/system/ollama/start — Start local Ollama daemon
      if (req.method === 'POST' && pathname === '/api/system/ollama/start') {
        const result = await this.startOllamaServer();
        this.broadcastEvent('ollama:status', result);
        return this.sendJson(res, result.success ? 200 : 500, result);
      }

      // 3b. POST /api/system/optimize — Perform SQLite WAL maintenance & query planner optimization
      if (req.method === 'POST' && pathname === '/api/system/optimize') {
        try {
          this.db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
          this.db.execute('PRAGMA optimize');
          let size = 0;
          try {
            const stat = fs.statSync(this.dbPath);
            size = stat.size;
          } catch {}
          return this.sendJson(res, 200, {
            success: true,
            checkpoint: 'TRUNCATE completed',
            databaseSizeBytes: size,
          });
        } catch (err: any) {
          return this.sendJson(res, 500, { success: false, error: err.message });
        }
      }

      // 4. POST /api/system/terminal or /api/terminal/exec — Execute shell command in project directory
      if (req.method === 'POST' && (pathname === '/api/system/terminal' || pathname === '/api/terminal/exec')) {
        const body = await this.parseJsonBody<{ command: string; cwd?: string; timeoutMs?: number; approvalToken?: string }>(req);
        if (!body.command) {
          return this.sendJson(res, 400, { error: 'Command is required' });
        }

        const project = this.workspaceRepo.getProject(this.activeProjectId);
        const jailRoot = project?.repoPath || process.cwd();
        if (body.cwd && !this.isWithinJail(jailRoot, body.cwd)) {
          return this.sendJson(res, 403, { error: 'Forbidden: cwd escapes project jail' });
        }
        const boundaryCheck = this.validateProjectBoundary(body.cwd || jailRoot);
        if (!boundaryCheck.valid) {
          return this.sendJson(res, 403, { error: boundaryCheck.error });
        }
        const workingDir = boundaryCheck.root;
        const timeoutMs = Math.min(Math.max(body.timeoutMs || 60000, 1000), 600000);

        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body.approvalToken;
        const sentinel = Sentinel.getInstance();
        const effectiveAutonomy = this.getEffectiveAutonomyMode();
        const destructive = sentinel.isDestructiveAction('executeShell', { command: body.command, cwd: workingDir });
        const riskLevel = destructive.isDestructive ? 'HIGH' : (effectiveAutonomy === 'ALWAYS_ASK' ? 'HIGH' : 'LOW');
        const decision = sentinel.evaluate({
          agentId: 'operator',
          toolName: 'executeShell',
          params: { command: body.command, cwd: workingDir },
          riskLevel,
          autonomyMode: effectiveAutonomy,
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });

        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord(
            'executeShell',
            { command: body.command, cwd: workingDir },
            decision.reason
          );
          return this.sendJson(res, 428, {
            error: 'Precondition Required: Action requires operator approval',
            approvalId,
            reason: decision.reason,
            requiresApproval: true,
          });
        }

        if (!decision.allowed) {
          return this.sendJson(res, 403, { error: decision.reason });
        }

        const result = await this.execCommand(body.command, workingDir, timeoutMs);
        EventLedger.getInstance().record({
          eventType: 'TOOL_COMPLETED',
          entityType: 'system',
          entityId: 'terminal',
          payload: { command: body.command, cwd: workingDir, exitCode: result.exitCode },
        });
        // Safe display truncation: maximum 500,000 characters to prevent browser freezes
        const maxDisplayChars = 500000;
        const stdout = result.stdout.length > maxDisplayChars
          ? result.stdout.slice(0, maxDisplayChars) + '\n... [output truncated for display]'
          : result.stdout;
        const stderr = result.stderr.length > maxDisplayChars
          ? result.stderr.slice(0, maxDisplayChars) + '\n... [output truncated for display]'
          : result.stderr;

        return this.sendJson(res, 200, {
          command: body.command,
          cwd: workingDir,
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: result.exitCode,
        });
      }

      // 29. Route 29 GET /api/projects/:id/schedules consolidated into Route 59
      const schedulesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/schedules$/);

      // 30. POST /api/projects/:id/schedules
      if (req.method === 'POST' && schedulesMatch) {
        const projectId = schedulesMatch[1];
        const proj = this.workspaceRepo.getProject(projectId);
        if (!proj) {
          return this.sendJson(res, 404, { error: `Project '${projectId}' not found` });
        }
        const body = await this.parseJsonBody<any>(req);
        const { type, cronExpression, durationSeconds, targetAgentId, channelId, prompt, timerCondition } = body;

        const validTypes = ['cron', 'timer', 'one_shot', 'oneshot'];
        if (type && !validTypes.includes(type)) {
          return this.sendJson(res, 400, { error: `Invalid schedule type '${type}'. Allowed types: 'cron', 'timer'.` });
        }

        if (targetAgentId && !this.agentRepo.getIdentity(targetAgentId)) {
          return this.sendJson(res, 404, { error: `Target agent '${targetAgentId}' not found` });
        }
        if (channelId && !this.workspaceRepo.getChannel(channelId)) {
          return this.sendJson(res, 404, { error: `Channel '${channelId}' not found` });
        }

        let schedule;
        try {
          if (type === 'cron') {
            schedule = this.scheduler.createCronSchedule({
              projectId,
              channelId: channelId || 'chan-general',
              targetAgentId,
              prompt: prompt || 'Periodic autonomous check',
              cronExpression: cronExpression || '*/5 * * * *',
              maxIterations: body.maxIterations,
            });
          } else {
            const dur = Number(durationSeconds) || 5;
            if (dur <= 0) {
              return this.sendJson(res, 400, { error: 'durationSeconds must be greater than 0' });
            }
            schedule = this.scheduler.createOneShotTimer({
              projectId,
              channelId: channelId || 'chan-general',
              targetAgentId,
              prompt: prompt || 'Scheduled wakeup check',
              durationSeconds: dur,
              timerCondition: timerCondition || 'never',
            });
          }
        } catch (schedErr: any) {
          return this.sendJson(res, 400, { error: schedErr.message });
        }
        this.broadcastEvent('schedule:created', schedule);
        return this.sendJson(res, 201, { schedule });
      }

      // 31. DELETE /api/schedules/:id
      const scheduleDeleteMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
      if (req.method === 'DELETE' && scheduleDeleteMatch) {
        const scheduleId = scheduleDeleteMatch[1];
        this.scheduler.cancelSchedule(scheduleId);
        this.broadcastEvent('schedule:cancelled', { scheduleId });
        return this.sendJson(res, 200, { ok: true, scheduleId });
      }

      // 31b. POST /api/schedules/:id/trigger — Immediately fire an automation/routine
      const scheduleTriggerMatch = pathname.match(/^\/api\/schedules\/([^/]+)\/trigger$/);
      if (req.method === 'POST' && scheduleTriggerMatch) {
        const scheduleId = scheduleTriggerMatch[1];
        try {
          const triggered = await this.scheduler.triggerScheduleNow(scheduleId);
          if (!triggered) {
            return this.sendJson(res, 404, { error: `Schedule '${scheduleId}' not found` });
          }
          this.broadcastEvent('schedule:fired', triggered);
          return this.sendJson(res, 200, { success: true, schedule: triggered });
        } catch (err: any) {
          return this.sendJson(res, 400, { error: err.message });
        }
      }

      // 31c. POST /api/schedules/:id/retry or /api/automations/:id/retry — Explicitly retry a failed schedule
      const scheduleRetryMatch = pathname.match(/^\/api\/(?:automations|schedules)\/([^/]+)\/retry$/);
      if (req.method === 'POST' && scheduleRetryMatch) {
        const scheduleId = scheduleRetryMatch[1];
        try {
          const retried = await this.scheduler.retrySchedule(scheduleId);
          if (!retried) {
            return this.sendJson(res, 404, { error: `Schedule '${scheduleId}' not found` });
          }
          this.broadcastEvent('schedule:fired', retried);
          return this.sendJson(res, 200, { success: true, schedule: retried });
        } catch (err: any) {
          return this.sendJson(res, 400, { error: err.message });
        }
      }

      // 31d. GET /api/schedules/:id/attempts or /api/automations/:id/attempts — Retrieve execution attempt history
      const scheduleAttemptsMatch = pathname.match(/^\/api\/(?:automations|schedules)\/([^/]+)\/attempts$/);
      if (req.method === 'GET' && scheduleAttemptsMatch) {
        const scheduleId = scheduleAttemptsMatch[1];
        const sched = this.scheduler.getSchedule(scheduleId);
        if (!sched) {
          return this.sendJson(res, 404, { error: `Schedule '${scheduleId}' not found` });
        }
        const attempts = this.scheduler.getScheduleAttempts(scheduleId);
        return this.sendJson(res, 200, { scheduleId, attempts });
      }

      // 32. GET /api/skills (supports ?status=all|active|candidate|deprecated)
      if (req.method === 'GET' && pathname === '/api/skills') {
        const statusParam = (parsedUrl.searchParams.get('status') as any) || 'active';
        const skills = this.skillEngine.listSkills(statusParam);
        return this.sendJson(res, 200, { skills });
      }

      // 32-c1. GET /api/learning/candidates — List unvalidated candidate lessons
      if (req.method === 'GET' && pathname === '/api/learning/candidates') {
        const candidates = this.skillEngine.listCandidates();
        return this.sendJson(res, 200, { candidates });
      }

      // 32-c2. POST /api/learning/harvest — Analyze recent experiences and synthesize candidate lessons
      if (req.method === 'POST' && pathname === '/api/learning/harvest') {
        const harvest = this.skillEngine.harvestCandidateLessons();
        this.broadcastEvent('learning:harvested', harvest);
        return this.sendJson(res, 200, { success: true, ...harvest });
      }

      // 32-c3. POST /api/learning/candidates/:id/validate — Validation gate: promote or reject candidate
      const candidateValidateMatch = pathname.match(/^\/api\/learning\/candidates\/([^/]+)\/validate$/);
      if (req.method === 'POST' && candidateValidateMatch) {
        const candidateId = candidateValidateMatch[1];
        const body = await this.parseJsonBody<any>(req);
        if (!body || (body.action !== 'promote' && body.action !== 'reject')) {
          return this.sendJson(res, 400, { error: "Validation decision must specify action 'promote' or 'reject'" });
        }
        try {
          const result = this.skillEngine.validateAndPromoteCandidate(candidateId, {
            action: body.action,
            reviewer: body.reviewer || 'human-operator',
            rationale: body.rationale,
            updatedInstructions: body.updatedInstructions,
          });
          this.broadcastEvent('skill:validated', result);
          return this.sendJson(res, 200, result);
        } catch (e: any) {
          return this.sendJson(res, 400, { error: e.message });
        }
      }

      // 32-c4. GET /api/learning/metrics — Tool reliability & recovery strategy metrics
      if (req.method === 'GET' && pathname === '/api/learning/metrics') {
        const metrics = this.skillEngine.getLearningMetrics();
        return this.sendJson(res, 200, { metrics });
      }

      // 32-c5. GET /api/skills/:id/versions — Version history for a skill
      const skillVersionsMatch = pathname.match(/^\/api\/skills\/([^/]+)\/versions$/);
      if (req.method === 'GET' && skillVersionsMatch) {
        const skillId = skillVersionsMatch[1];
        const versions = this.skillEngine.getSkillVersionHistory(skillId);
        return this.sendJson(res, 200, { skillId, versions });
      }

      // 32-c6. POST /api/skills/:id/rollback — Roll back skill to previous version snapshot
      const skillRollbackMatch = pathname.match(/^\/api\/skills\/([^/]+)\/rollback$/);
      if (req.method === 'POST' && skillRollbackMatch) {
        const skillId = skillRollbackMatch[1];
        const body = await this.parseJsonBody<any>(req);
        if (!body?.versionId) {
          return this.sendJson(res, 400, { error: 'versionId is required for rollback' });
        }
        try {
          const restored = this.skillEngine.rollbackSkill(skillId, body.versionId);
          this.broadcastEvent('skill:rolled_back', { skillId, version: restored.version });
          return this.sendJson(res, 200, { success: true, skill: restored });
        } catch (e: any) {
          return this.sendJson(res, 400, { error: e.message });
        }
      }

      // 32-c7. GET /api/memories — List scoped memories
      if (req.method === 'GET' && pathname === '/api/memories') {
        const scope = (parsedUrl.searchParams.get('scope') as any) || 'project';
        const scopeId = parsedUrl.searchParams.get('scopeId') || this.activeProjectId;
        const type = parsedUrl.searchParams.get('type') as any;

        if (scope === 'agent_private') {
          const callerAgentId = (req.headers['x-caller-agent-id'] || req.headers['x-agent-id']) as string;
          const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
          if (!callerAgentId || callerAgentId !== scopeId || (!isTest && !this.agentRepo.getIdentity(callerAgentId))) {
            return this.sendJson(res, 403, { error: 'Forbidden: Access to agent_private memories requires verified matching caller identity' });
          }
        }

        const memories = this.memoryRepo.listMemories(scope, scopeId, type);
        return this.sendJson(res, 200, { memories });
      }

      // 32-c8. POST /api/memories — Set or update scoped memory
      if (req.method === 'POST' && pathname === '/api/memories') {
        const body = await this.parseJsonBody<any>(req);
        if (!body?.key || body?.value === undefined) {
          return this.sendJson(res, 400, { error: 'key and value are required' });
        }
        if (typeof body.key === 'string' && body.key.startsWith('upload:')) {
          return this.sendJson(res, 400, { error: "Forbidden: 'upload:' is a reserved memory key prefix" });
        }
        const scope = body.scope || 'project';
        const scopeId = body.scopeId || this.activeProjectId;

        if (scope === 'agent_private') {
          const callerAgentId = (req.headers['x-caller-agent-id'] || req.headers['x-agent-id']) as string;
          const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
          if (!callerAgentId || callerAgentId !== scopeId || (!isTest && !this.agentRepo.getIdentity(callerAgentId))) {
            return this.sendJson(res, 403, { error: 'Forbidden: Access to agent_private memories requires verified matching caller identity' });
          }
        }

        try {
          const memory = this.memoryRepo.setMemory({
            scope,
            scopeId,
            type: body.type || 'procedural',
            key: body.key,
            value: body.value,
            expectedVersion: body.expectedVersion,
            evidenceRef: body.evidenceRef,
          });
          this.broadcastEvent('memory:updated', memory);
          return this.sendJson(res, 201, { memory });
        } catch (err: any) {
          if (err instanceof OCCConflictError || err?.code === 'OCC_CONFLICT' || err?.name === 'OCCConflictError') {
            return this.sendJson(res, 409, {
              error: err.message,
              code: 'OCC_CONFLICT',
              scope,
              scopeId,
              key: body.key,
              expectedVersion: body.expectedVersion,
            });
          }
          throw err;
        }
      }

      // 32-c9. DELETE /api/memories/:id — Delete memory
      const memoryDeleteMatch = pathname.match(/^\/api\/memories\/([^/]+)$/);
      if (req.method === 'DELETE' && memoryDeleteMatch) {
        const memId = memoryDeleteMatch[1];
        const mem = this.memoryRepo.getMemoryById(memId);
        if (!mem) return this.sendJson(res, 404, { error: 'Memory not found' });
        if (mem.scope === 'agent_private') {
          const callerAgentId = (req.headers['x-caller-agent-id'] || req.headers['x-agent-id']) as string;
          const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
          if (!callerAgentId || callerAgentId !== mem.scopeId || (!isTest && !this.agentRepo.getIdentity(callerAgentId))) {
            return this.sendJson(res, 403, { error: 'Forbidden: Access to agent_private memories requires verified matching caller identity' });
          }
        }
        const ok = this.memoryRepo.deleteMemory(mem.scope, mem.scopeId, mem.key);
        this.broadcastEvent('memory:deleted', { id: memId });
        return this.sendJson(res, 200, { success: ok, id: memId });
      }

      // 33. POST /api/skills/import
      if (req.method === 'POST' && pathname === '/api/skills/import') {
        try {
          const body = await this.parseJsonBody<any>(req);
          if (!body) return this.sendJson(res, 400, { error: 'Empty import body' });

          if (body.directoryPath || body.dirPath || body.path || body.directory || body.dir) {
            const rawDir = body.directoryPath || body.dirPath || body.path || body.directory || body.dir;
            let targetDir = path.isAbsolute(rawDir) ? rawDir : path.resolve(process.cwd(), rawDir);
            if (!fs.existsSync(targetDir)) {
              const parentResolved = path.resolve(process.cwd(), '..', rawDir);
              if (fs.existsSync(parentResolved)) {
                targetDir = parentResolved;
              }
            }
            const normDir = path.resolve(targetDir);
            const boundaryCheck = this.validateProjectBoundary(normDir);
            if (!boundaryCheck.valid) {
              return this.sendJson(res, 403, { error: `Forbidden: Skill import directory must reside within an authorized project boundary.` });
            }
            const dirResult = this.skillEngine.importSkillDirectory(targetDir);
            this.broadcastEvent('skill:imported', dirResult);
            return this.sendJson(res, 201, { success: true, imported: dirResult.imported, skills: dirResult.skills });
          }

          const hasSkillsArray = Array.isArray(body) || (body && Array.isArray(body.skills));
          if (hasSkillsArray) {
            const resBundle = this.skillEngine.importSkillBundle(body);
            this.broadcastEvent('skill:imported', resBundle);
            return this.sendJson(res, 201, { success: true, imported: resBundle.imported, skills: resBundle.skills });
          } else {
            const imported = this.skillEngine.importSkill(body);
            this.broadcastEvent('skill:imported', imported);
            return this.sendJson(res, 201, { success: true, skill: imported, imported: 1 });
          }
        } catch (err: any) {
          return this.sendJson(res, 400, { error: err.message || 'Failed to import skill' });
        }
      }

      // 33b. GET /api/skills/experiences — List recovery & execution experiences
      if (req.method === 'GET' && pathname === '/api/skills/experiences') {
        const experiences = this.skillEngine.listExperiences();
        return this.sendJson(res, 200, { experiences });
      }

      // 33c. POST /api/skills/experiences — Record execution or recovery experience
      if (req.method === 'POST' && (pathname === '/api/skills/experiences' || pathname === '/api/learning/experiences')) {
        const body = await this.parseJsonBody<any>(req);
        let runId = body?.runId;
        if (!runId) {
          const latestRun = this.db.queryOne<{ id: string }>(
            'SELECT id FROM agent_runs ORDER BY created_at DESC LIMIT 1'
          );
          if (latestRun) runId = latestRun.id;
        }
        if (!runId) {
          return this.sendJson(res, 400, { error: 'runId is required or a recent agent run must exist in the project.' });
        }
        const objective = body?.objective || body?.input || 'General task execution';
        const outcome = (body?.outcome === 'failure' || body?.outcome === 'success')
          ? body.outcome
          : (body?.success === false ? 'failure' : 'success');
        const expId = this.skillEngine.recordExperience({
          ...body,
          runId,
          objective,
          outcome,
        });
        this.broadcastEvent('learning:experience_recorded', { expId, runId, objective, outcome });
        return this.sendJson(res, 201, { success: true, experienceId: expId });
      }

      // 32b. POST /api/skills — Create custom skill
      if (req.method === 'POST' && pathname === '/api/skills') {
        const body = await this.parseJsonBody<any>(req);
        if (!body || !body.name || (!body.instructions && !body.handlerCode && !body.description)) {
          return this.sendJson(res, 400, { error: 'Name and instructions (or handlerCode) are required' });
        }
        try {
          const skill = this.skillEngine.createSkill(body);
          this.broadcastEvent('skill:created', skill);
          return this.sendJson(res, 201, { skill });
        } catch (e: any) {
          return this.sendJson(res, 400, { error: e.message });
        }
      }

      // 32c. DELETE /api/skills/:id — Delete skill
      const skillDeleteMatch = pathname.match(/^\/api\/skills\/([^/]+)$/);
      if (req.method === 'DELETE' && skillDeleteMatch) {
        const skillId = skillDeleteMatch[1];
        try {
          const ok = this.skillEngine.deleteSkill(skillId);
          if (!ok) return this.sendJson(res, 404, { error: 'Skill not found' });
          this.broadcastEvent('skill:deleted', { skillId });
          return this.sendJson(res, 200, { success: true, skillId });
        } catch (e: any) {
          return this.sendJson(res, 400, { error: e.message });
        }
      }

      // 32d. PATCH / PUT /api/skills/:id — Update skill
      if ((req.method === 'PATCH' || req.method === 'PUT') && skillDeleteMatch) {
        const skillId = skillDeleteMatch[1];
        try {
          const body = await this.parseJsonBody<any>(req);
          const updated = this.skillEngine.updateSkill(skillId, body);
          this.broadcastEvent('skill:updated', updated);
          return this.sendJson(res, 200, { success: true, skill: updated });
        } catch (e: any) {
          return this.sendJson(res, 400, { error: e.message });
        }
      }

      // 34. GET /api/skills/:id/export
      const skillExportMatch = pathname.match(/^\/api\/skills\/([^/]+)\/export$/);
      if (req.method === 'GET' && skillExportMatch) {
        const skillId = skillExportMatch[1];
        const bundle = this.skillEngine.exportSkill(skillId);
        if (!bundle) return this.sendJson(res, 404, { error: 'Skill not found' });
        return this.sendJson(res, 200, { bundle: JSON.parse(bundle) });
      }

      // 34b. GET /api/skills/export-all — Export all skills bundle
      if (req.method === 'GET' && pathname === '/api/skills/export-all') {
        const bundle = this.skillEngine.exportAllSkills();
        return this.sendJson(res, 200, { bundle: JSON.parse(bundle) });
      }

      // 34d. Dynamic Custom Tools REST API
      // GET /api/custom-tools (supports ?projectId=...&status=all|active|candidate|denied)
      if (req.method === 'GET' && pathname === '/api/custom-tools') {
        const statusParam = (parsedUrl.searchParams.get('status') as any) || 'active';
        const projParam = parsedUrl.searchParams.get('projectId') || undefined;
        const tools = this.toolEngine.listTools(statusParam, projParam);
        return this.sendJson(res, 200, { tools });
      }

      // POST /api/custom-tools - Propose or create custom tool
      if (req.method === 'POST' && pathname === '/api/custom-tools') {
        const body = await this.parseJsonBody<any>(req);
        if (!body || !body.name || !body.handlerCode) {
          return this.sendJson(res, 400, { error: 'Name and handlerCode are required' });
        }
        const builtInSchemas = this.toolGateway.getToolSchemas();
        const result = this.toolEngine.createTool(
          {
            name: body.name,
            description: body.description || '',
            parametersSchema: body.parametersSchema,
            handlerCode: body.handlerCode,
            forceCreation: Boolean(body.forceCreation),
            rationale: body.rationale,
            requireApproval: body.requireApproval,
            projectId: body.projectId || this.activeProjectId,
            agentId: body.agentId,
            runId: body.runId,
          },
          builtInSchemas
        );
        if (!result.success) {
          return this.sendJson(res, result.status === 'duplicate_advisory' ? 409 : 400, result);
        }
        this.broadcastEvent('custom_tool:created', result.tool);
        return this.sendJson(res, 201, result);
      }

      // POST /api/custom-tools/:id/test - Execute custom tool in sandboxed worker thread
      const toolTestMatch = pathname.match(/^\/api\/custom-tools\/([^/]+)\/test$/);
      if (req.method === 'POST' && toolTestMatch) {
        const toolId = toolTestMatch[1];
        const body = await this.parseJsonBody<any>(req).catch(() => ({}));
        const projId = body?.projectId || this.activeProjectId;
        const proj = this.workspaceRepo.getProject(projId);
        const worktreeRoot = proj?.repoPath || process.cwd();
        const execResult = await this.toolEngine.executeTool(
          toolId,
          body?.params || {},
          {
            runId: `test-${Date.now()}`,
            agentId: 'operator',
            worktreeRoot,
            projectId: projId,
            timeoutMs: body?.timeoutMs || 15000,
          }
        );
        return this.sendJson(res, 200, execResult);
      }

      // DELETE /api/custom-tools/:id - Delete custom tool
      const toolDeleteMatch = pathname.match(/^\/api\/custom-tools\/([^/]+)$/);
      if (req.method === 'DELETE' && toolDeleteMatch) {
        const toolId = toolDeleteMatch[1];
        const deleted = this.toolEngine.deleteTool(toolId);
        if (!deleted) {
          return this.sendJson(res, 404, { error: 'Custom tool not found' });
        }
        this.broadcastEvent('custom_tool:deleted', { id: toolId });
        return this.sendJson(res, 200, { success: true });
      }

      // 34e. Harness² Cross-Task Improvement Library REST API
      // GET /api/harness-improvements (supports ?projectId=...&domain=...&componentType=...)
      if (req.method === 'GET' && pathname === '/api/harness-improvements') {
        const projParam = parsedUrl.searchParams.get('projectId') || undefined;
        const domainParam = parsedUrl.searchParams.get('domain') || undefined;
        const compParam = parsedUrl.searchParams.get('componentType') || undefined;
        const improvements = this.toolEngine.findImprovements(projParam, domainParam, compParam);
        return this.sendJson(res, 200, { improvements });
      }

      // POST /api/harness-improvements - Record verified domain adaptation
      if (req.method === 'POST' && pathname === '/api/harness-improvements') {
        const body = await this.parseJsonBody<any>(req);
        if (!body || !body.domain || !body.componentType || !body.problemSignature || !body.verifiedAdaptation) {
          return this.sendJson(res, 400, { error: 'domain, componentType, problemSignature, and verifiedAdaptation are required' });
        }
        const recordId = this.toolEngine.recordImprovement({
          projectId: body.projectId || this.activeProjectId,
          domain: body.domain,
          componentType: body.componentType,
          problemSignature: body.problemSignature,
          verifiedAdaptation: body.verifiedAdaptation,
          evidenceMetrics: body.evidenceMetrics || {},
        });
        return this.sendJson(res, 201, { success: true, id: recordId });
      }

      // 34c. POST /api/supervisor/recover — Force supervisor self-healing scan
      if (req.method === 'POST' && pathname === '/api/supervisor/recover') {
        const body = await this.parseJsonBody<any>(req).catch(() => ({}));
        const threshold = typeof body?.staleThresholdMs === 'number' ? body.staleThresholdMs : 0;
        const recovered = this.runSupervisorSelfHealing(threshold);
        return this.sendJson(res, 200, { ok: true, recoveredCount: recovered.length, recovered });
      }

      // 36. GET /api/system/apps — Discover installed desktop applications
      if (req.method === 'GET' && pathname === '/api/system/apps') {
        const apps = await this.desktopController.discoverInstalledApps();
        return this.sendJson(res, 200, { apps });
      }

      // 37. POST /api/system/apps/launch — Launch installed desktop application
      if (req.method === 'POST' && pathname === '/api/system/apps/launch') {
        const body = await this.parseJsonBody<{ appNameOrPath?: string; name?: string; args?: string[]; approvalToken?: string }>(req);
        const target = body.appNameOrPath || body.name;
        if (!target) return this.sendJson(res, 400, { error: 'appNameOrPath is required' });
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body.approvalToken;
        const autonomyMode = this.getEffectiveAutonomyMode();
        const sentinel = Sentinel.getInstance();
        const decision = sentinel.evaluate({
          agentId: 'operator',
          toolName: 'desktopLaunchApp',
          params: { appNameOrPath: target, args: body.args || [] },
          riskLevel: 'HIGH',
          autonomyMode,
          agentCapabilities: ['desktopLaunchApp', 'desktopControl', '*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord('desktopLaunchApp', { appNameOrPath: target, args: body.args || [] }, decision.reason);
          return this.sendJson(res, 428, {
            error: 'Precondition Required: Action requires operator approval',
            approvalId,
            reason: decision.reason,
            requiresApproval: true,
          });
        }
        if (!decision.allowed) {
          return this.sendJson(res, 403, { error: decision.reason });
        }
        const result = await this.desktopController.launchApp(target, body.args || []);
        EventLedger.getInstance().record({
          eventType: 'TOOL_COMPLETED',
          entityType: 'system',
          entityId: 'app_launch',
          payload: { target, success: result.success },
        });
        this.broadcastEvent('system:app_launched', result);
        return this.sendJson(res, result.success ? 200 : 400, result);
      }

      // 38. GET /api/system/windows — List top-level GUI windows
      if (req.method === 'GET' && pathname === '/api/system/windows') {
        const windows = await this.desktopController.listWindows();
        return this.sendJson(res, 200, { windows });
      }

      // 39. POST /api/system/windows/focus — Focus GUI window
      if (req.method === 'POST' && pathname === '/api/system/windows/focus') {
        const body = await this.parseJsonBody<{ titleOrPid: string | number; approvalToken?: string }>(req);
        if (body.titleOrPid === undefined) return this.sendJson(res, 400, { error: 'titleOrPid is required' });
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body.approvalToken;
        const decision = Sentinel.getInstance().evaluate({
          agentId: 'operator',
          toolName: 'desktopFocusWindow',
          params: { titleOrPid: body.titleOrPid },
          riskLevel: 'LOW',
          autonomyMode: this.getEffectiveAutonomyMode(),
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord('desktopFocusWindow', { titleOrPid: body.titleOrPid }, decision.reason);
          return this.sendJson(res, 428, { error: 'Precondition Required: Action requires operator approval', approvalId, reason: decision.reason, requiresApproval: true });
        }
        if (!decision.allowed) return this.sendJson(res, 403, { error: decision.reason });
        const result = await this.desktopController.focusWindow(body.titleOrPid);
        return this.sendJson(res, result.success ? 200 : 400, result);
      }

      // 40. POST /api/system/windows/close — Close GUI window
      if (req.method === 'POST' && pathname === '/api/system/windows/close') {
        const body = await this.parseJsonBody<{ titleOrPid: string | number; approvalToken?: string }>(req);
        if (body.titleOrPid === undefined) return this.sendJson(res, 400, { error: 'titleOrPid is required' });
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body.approvalToken;
        const decision = Sentinel.getInstance().evaluate({
          agentId: 'operator',
          toolName: 'desktopCloseWindow',
          params: { titleOrPid: body.titleOrPid },
          riskLevel: 'MEDIUM',
          autonomyMode: this.getEffectiveAutonomyMode(),
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord('desktopCloseWindow', { titleOrPid: body.titleOrPid }, decision.reason);
          return this.sendJson(res, 428, { error: 'Precondition Required: Action requires operator approval', approvalId, reason: decision.reason, requiresApproval: true });
        }
        if (!decision.allowed) return this.sendJson(res, 403, { error: decision.reason });
        const result = await this.desktopController.closeWindow(body.titleOrPid);
        return this.sendJson(res, result.success ? 200 : 400, result);
      }

      // 41. POST /api/system/desktop/screenshot — Capture desktop display screenshot
      if (req.method === 'POST' && pathname === '/api/system/desktop/screenshot') {
        const body = await this.parseJsonBody<any>(req);
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body?.approvalToken;
        const decision = Sentinel.getInstance().evaluate({
          agentId: 'operator',
          toolName: 'desktopScreenshot',
          params: body || {},
          riskLevel: 'LOW',
          autonomyMode: this.getEffectiveAutonomyMode(),
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord('desktopScreenshot', body || {}, decision.reason);
          return this.sendJson(res, 428, { error: 'Precondition Required: Action requires operator approval', approvalId, reason: decision.reason, requiresApproval: true });
        }
        if (!decision.allowed) return this.sendJson(res, 403, { error: decision.reason });
        const result = await this.desktopController.captureScreen(body);
        return this.sendJson(res, 200, result);
      }

      // 42. POST /api/system/desktop/interact — Mouse and keyboard interaction
      if (req.method === 'POST' && pathname === '/api/system/desktop/interact') {
        const body = await this.parseJsonBody<any>(req);
        if (!body || !body.action) {
          return this.sendJson(res, 400, { error: 'action is required (click, move, type, or key)' });
        }
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body?.approvalToken;
        let toolName = 'desktopMouseMove';
        let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
        let params: Record<string, any> = {};

        if (body.action === 'click') {
          toolName = 'desktopMouseClick';
          riskLevel = 'MEDIUM';
          params = { x: body.x, y: body.y, button: body.button || 'left', doubleClick: !!body.doubleClick };
        } else if (body.action === 'move') {
          toolName = 'desktopMouseMove';
          riskLevel = 'LOW';
          params = { x: body.x, y: body.y };
        } else if (body.action === 'type') {
          toolName = 'desktopType';
          riskLevel = 'MEDIUM';
          params = { text: body.text || '' };
        } else if (body.action === 'key') {
          toolName = 'desktopSendKey';
          riskLevel = 'MEDIUM';
          params = { key: body.key, modifiers: body.modifiers || [] };
        } else {
          return this.sendJson(res, 400, { error: `Unsupported desktop interaction action: '${body.action}'. Valid: click, move, type, key` });
        }

        const decision = Sentinel.getInstance().evaluate({
          agentId: 'operator',
          toolName,
          params,
          riskLevel,
          autonomyMode: this.getEffectiveAutonomyMode(),
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord(toolName, params, decision.reason);
          return this.sendJson(res, 428, { error: 'Precondition Required: Action requires operator approval', approvalId, reason: decision.reason, requiresApproval: true });
        }
        if (!decision.allowed) return this.sendJson(res, 403, { error: decision.reason });
        let result: any = { success: false, error: 'Unknown action' };
        if (body.action === 'click') {
          result = await this.desktopController.mouseClick(body.x, body.y, { button: body.button, doubleClick: body.doubleClick });
        } else if (body.action === 'move') {
          result = await this.desktopController.mouseMove(body.x, body.y);
        } else if (body.action === 'type') {
          result = await this.desktopController.typeText(body.text || '');
        } else if (body.action === 'key') {
          result = await this.desktopController.sendKey(body.key, body.modifiers || []);
        }
        return this.sendJson(res, result.success ? 200 : 400, result);
      }

      // 43. GET /api/browser/status — Persistent browser session telemetry
      if (req.method === 'GET' && pathname === '/api/browser/status') {
        const status = this.browserController.getStatus();
        const history = this.browserController.getStepHistory();
        return this.sendJson(res, 200, { ...status, stepHistory: history });
      }

      // 44. POST /api/browser/navigate — Navigate browser
      if (req.method === 'POST' && pathname === '/api/browser/navigate') {
        const body = await this.parseJsonBody<{ url: string; approvalToken?: string }>(req);
        if (!body.url) return this.sendJson(res, 400, { error: 'URL is required' });
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body.approvalToken;
        const sentinel = Sentinel.getInstance();
        const toolName = 'browserNavigate';
        const params = { url: body.url };
        const decision = sentinel.evaluate({
          agentId: 'operator',
          toolName,
          params,
          riskLevel: 'LOW',
          autonomyMode: this.getEffectiveAutonomyMode(),
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord(toolName, params, decision.reason);
          return this.sendJson(res, 428, { error: 'Precondition Required: Action requires operator approval', approvalId, reason: decision.reason, requiresApproval: true });
        }
        if (!decision.allowed) {
          return this.sendJson(res, 403, { error: decision.reason });
        }
        const result = await this.browserController.navigate(body.url);
        EventLedger.getInstance().record({
          eventType: 'TOOL_COMPLETED',
          entityType: 'tool',
          entityId: 'navigate',
          payload: { url: body.url, status: result.status },
        });
        this.broadcastEvent('browser:navigated', result);
        return this.sendJson(res, 200, result);
      }

      // 45. POST /api/browser/act — Execute web step action
      if (req.method === 'POST' && pathname === '/api/browser/act') {
        const body = await this.parseJsonBody<any>(req);
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body?.approvalToken;
        const sentinel = Sentinel.getInstance();
        let toolName = 'browserStep';
        let params: Record<string, any> = body || {};
        if (body?.action === 'click' && body?.selector) {
          toolName = 'browserClick';
          params = { selector: body.selector };
        } else if (body?.action === 'type' && body?.selector) {
          toolName = 'browserType';
          params = { selector: body.selector, text: body.text || '' };
        }
        const decision = sentinel.evaluate({
          agentId: 'operator',
          toolName,
          params,
          riskLevel: 'LOW',
          autonomyMode: this.getEffectiveAutonomyMode(),
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord(toolName, params, decision.reason);
          return this.sendJson(res, 428, { error: 'Precondition Required: Action requires operator approval', approvalId, reason: decision.reason, requiresApproval: true });
        }
        if (!decision.allowed) {
          return this.sendJson(res, 403, { error: decision.reason });
        }
        const result = await this.browserController.executeStep(body);
        EventLedger.getInstance().record({
          eventType: 'TOOL_COMPLETED',
          entityType: 'tool',
          entityId: 'step',
          payload: { action: body?.action, success: result.success },
        });
        this.broadcastEvent('browser:step', result);
        return this.sendJson(res, result.success ? 200 : 400, result);
      }

      // 46. POST /api/browser/inspect — Inspect page DOM and interactive elements
      if (req.method === 'POST' && pathname === '/api/browser/inspect') {
        const body = await this.parseJsonBody<{ selector?: string; approvalToken?: string }>(req);
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body?.approvalToken;
        const sentinel = Sentinel.getInstance();
        const toolName = 'browserInspect';
        const params = { selector: body?.selector };
        const decision = sentinel.evaluate({
          agentId: 'operator',
          toolName,
          params,
          riskLevel: 'LOW',
          autonomyMode: this.getEffectiveAutonomyMode(),
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord(toolName, params, decision.reason);
          return this.sendJson(res, 428, { error: 'Precondition Required: Action requires operator approval', approvalId, reason: decision.reason, requiresApproval: true });
        }
        if (!decision.allowed) {
          return this.sendJson(res, 403, { error: decision.reason });
        }
        const result = await this.browserController.inspect(body?.selector);
        return this.sendJson(res, 200, result);
      }

      // 47. POST /api/browser/screenshot — Capture browser page screenshot
      if (req.method === 'POST' && pathname === '/api/browser/screenshot') {
        const body = await this.parseJsonBody<{ approvalToken?: string }>(req);
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body?.approvalToken;
        const sentinel = Sentinel.getInstance();
        const toolName = 'browserScreenshot';
        const params = {};
        const decision = sentinel.evaluate({
          agentId: 'operator',
          toolName,
          params,
          riskLevel: 'LOW',
          autonomyMode: this.getEffectiveAutonomyMode(),
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord(toolName, params, decision.reason);
          return this.sendJson(res, 428, { error: 'Precondition Required: Action requires operator approval', approvalId, reason: decision.reason, requiresApproval: true });
        }
        if (!decision.allowed) {
          return this.sendJson(res, 403, { error: decision.reason });
        }
        const result = await this.browserController.screenshot();
        return this.sendJson(res, 200, result);
      }

      // 48. POST /api/browser/close — Close browser session
      if (req.method === 'POST' && pathname === '/api/browser/close') {
        const body = await this.parseJsonBody<{ approvalToken?: string }>(req);
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body?.approvalToken;
        const sentinel = Sentinel.getInstance();
        const toolName = 'browserClose';
        const params = {};
        const decision = sentinel.evaluate({
          agentId: 'operator',
          toolName,
          params,
          riskLevel: 'LOW',
          autonomyMode: this.getEffectiveAutonomyMode(),
          agentCapabilities: ['*'],
          authorizationToken: approvalToken,
        });
        if (decision.requiresApproval) {
          const approvalId = this.createApprovalRecord(toolName, params, decision.reason);
          return this.sendJson(res, 428, { error: 'Precondition Required: Action requires operator approval', approvalId, reason: decision.reason, requiresApproval: true });
        }
        if (!decision.allowed) {
          return this.sendJson(res, 403, { error: decision.reason });
        }
        await this.browserController.close();
        this.broadcastEvent('browser:closed', { active: false });
        return this.sendJson(res, 200, { success: true });
      }



      // 53. GET /api/projects/:id/routines — Proactive Routines
      const routinesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/routines$/);
      if (req.method === 'GET' && routinesMatch) {
        const projectId = routinesMatch[1];
        const routines = this.scheduler.listSchedules(projectId);
        return this.sendJson(res, 200, { routines });
      }

      // 54. POST /api/projects/:id/routines — Create Proactive Routine
      if (req.method === 'POST' && routinesMatch) {
        const projectId = routinesMatch[1];
        const body = await this.parseJsonBody<any>(req);
        let routine;
        try {
          if (body.type === 'cron') {
            routine = this.scheduler.createCronSchedule({
              projectId,
              channelId: body.channelId || 'chan-general',
              targetAgentId: body.targetAgentId,
              prompt: body.prompt || 'Proactive routine check',
              cronExpression: body.cronExpression || '*/15 * * * *',
              maxIterations: body.maxIterations,
            });
          } else {
            routine = this.scheduler.createOneShotTimer({
              projectId,
              channelId: body.channelId || 'chan-general',
              targetAgentId: body.targetAgentId,
              prompt: body.prompt || 'Proactive routine check',
              durationSeconds: Number(body.durationSeconds) || 60,
            });
          }
        } catch (schedErr: any) {
          return this.sendJson(res, 400, { error: schedErr.message });
        }
        this.broadcastEvent('routine:created', routine);
        this.broadcastEvent('schedule:created', routine);
        return this.sendJson(res, 201, { routine });
      }

      // 55. DELETE /api/routines/:id — Cancel Proactive Routine
      const routineDeleteMatch = pathname.match(/^\/api\/routines\/([^/]+)$/);
      if (req.method === 'DELETE' && routineDeleteMatch) {
        const routineId = routineDeleteMatch[1];
        this.scheduler.cancelSchedule(routineId);
        this.broadcastEvent('routine:cancelled', { routineId });
        this.broadcastEvent('schedule:cancelled', { scheduleId: routineId });
        return this.sendJson(res, 200, { success: true, routineId });
      }

      // 56. GET /api/system/health — System Diagnostics (Ollama, Chromium, Git, SQLite, Concurrency)
      if (req.method === 'GET' && pathname === '/api/system/health') {
        const ollama = await this.getLocalOllamaModels();
        const chromePath = this.browserController.findBrowserExecutable();
        const gitRes = await this.execCommand('git --version', process.cwd(), 5000);
        const sqliteIntegrity = this.db.queryOne<{ integrity_check: string }>('PRAGMA integrity_check(5);');
        const dbStat = fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath) : null;
        const gov = this.computerSupervisor.getGovernorStatus();

        const components = {
          ollama: {
            status: ollama.online ? 'ok' : 'offline',
            online: ollama.online,
            models: ollama.models,
            message: ollama.online ? `${ollama.models.length} model(s) available` : 'Ollama daemon is not reachable on port 11434',
          },
          chromium: {
            status: chromePath ? 'ok' : 'missing',
            executablePath: chromePath || null,
            message: chromePath ? 'Chromium-based browser available' : 'Google Chrome or Microsoft Edge executable not found',
          },
          git: {
            status: gitRes.exitCode === 0 ? 'ok' : 'missing',
            version: gitRes.stdout.trim() || null,
            message: gitRes.exitCode === 0 ? gitRes.stdout.trim() : 'Git CLI executable not found',
          },
          sqlite: {
            status: sqliteIntegrity?.integrity_check === 'ok' ? 'ok' : 'corrupted',
            integrity: sqliteIntegrity?.integrity_check || 'unknown',
            databaseSizeBytes: dbStat?.size || 0,
            dbPath: this.dbPath,
          },
          memory: {
            status: gov.tier === 'low' ? 'throttled' : 'ok',
            totalMemBytes: gov.totalMemBytes,
            freeMemBytes: gov.freeMemBytes,
            freeMemGB: gov.freeMemGB,
            concurrencyTier: gov.tier,
            maxBrowserContexts: gov.maxBrowserContexts,
            maxShellProcesses: gov.maxShellProcesses,
            activeBrowserContexts: gov.activeBrowserContexts,
            activeShellProcesses: gov.activeShellProcesses,
          },
        };

        const isHealthy = components.ollama.status === 'ok' && components.chromium.status === 'ok' && components.git.status === 'ok' && components.sqlite.status === 'ok';

        const totalMb = Math.round(gov.totalMemBytes / (1024 * 1024));
        const freeMb = Math.round(gov.freeMemBytes / (1024 * 1024));
        const freeRatio = Number((gov.freeMemBytes / gov.totalMemBytes).toFixed(2));
        const limits = {
          maxConcurrentShell: gov.maxShellProcesses,
          maxConcurrentBrowser: gov.maxBrowserContexts,
        };
        const activeAlerts: string[] = [];
        if (!ollama.online) activeAlerts.push('Ollama offline');
        if (!chromePath) activeAlerts.push('Chromium browser not found');
        if (gitRes.exitCode !== 0) activeAlerts.push('Git missing');
        if (sqliteIntegrity?.integrity_check !== 'ok') activeAlerts.push('SQLite corruption');
        if (gov.tier === 'low') activeAlerts.push('Host memory throttled');

        return this.sendJson(res, 200, {
          status: isHealthy ? 'healthy' : 'degraded',
          timestamp: Date.now(),
          components,
          checks: {
            ollama: { status: components.ollama.status, message: components.ollama.message },
            chromium: { status: components.chromium.status, message: components.chromium.message },
            git: { status: components.git.status, message: components.git.message },
            sqlite: { status: components.sqlite.status, message: components.sqlite.integrity },
            memory: { status: components.memory.status, message: `Tier: ${gov.tier}` },
          },
          memory: {
            totalMb,
            freeMb,
            freeRatio,
            freeMemGB: gov.freeMemGB,
            concurrencyTier: gov.tier,
            maxBrowserContexts: gov.maxBrowserContexts,
            maxShellProcesses: gov.maxShellProcesses,
            activeBrowserContexts: gov.activeBrowserContexts,
            activeShellProcesses: gov.activeShellProcesses,
          },
          limits,
          activeAlerts,
        });
      }

      // 57. GET /api/system/governor — Dynamic RAM Concurrency Limiter
      if (req.method === 'GET' && pathname === '/api/system/governor') {
        const gov = this.computerSupervisor.getGovernorStatus();
        return this.sendJson(res, 200, gov);
      }

      // 58. GET /api/system/actions — Audited tool execution action records
      if (req.method === 'GET' && pathname === '/api/system/actions') {
        const limit = Math.min(200, Math.max(1, Number(parsedUrl.searchParams.get('limit')) || 50));
        const agentId = parsedUrl.searchParams.get('agentId');
        const runId = parsedUrl.searchParams.get('runId');
        let sql = 'SELECT * FROM action_records';
        const params: any[] = [];
        const conditions: string[] = [];
        if (agentId) { conditions.push('agent_id = ?'); params.push(agentId); }
        if (runId) { conditions.push('run_id = ?'); params.push(runId); }
        if (conditions.length > 0) { sql += ' WHERE ' + conditions.join(' AND '); }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        const records = this.db.query(sql, ...params);
        return this.sendJson(res, 200, { actions: records });
      }

      // 59. GET /api/automations & /api/schedules & /api/projects/:id/automations — Unified Automations & Schedules List
      if (req.method === 'GET' && (pathname === '/api/automations' || pathname === '/api/schedules' || pathname.endsWith('/automations') || pathname.endsWith('/schedules'))) {
        const projMatch = pathname.match(/^\/api\/projects\/([^/]+)\/(?:automations|schedules)$/);
        const targetProjId = projMatch ? projMatch[1] : undefined;
        const rawSchedules = targetProjId ? this.scheduler.listSchedules(targetProjId) : this.scheduler.listAllSchedules();
        const automations = rawSchedules.map((s) => {
          const proj = this.workspaceRepo.getProject(s.projectId);
          const chan = this.workspaceRepo.getChannel(s.channelId);
          const ag = s.targetAgentId ? this.agentRepo.getIdentity(s.targetAgentId) : null;
          return {
            ...s,
            projectName: proj?.name || s.projectId,
            repoPath: proj?.repoPath || '',
            channelName: chan?.name ? `#${chan.name}` : s.channelId,
            agentName: ag?.displayName || '@Boss',
          };
        });
        return this.sendJson(res, 200, { automations, schedules: rawSchedules });
      }

      // 59b. POST /api/automations or /api/schedules — Unified Create Automation Route
      if (req.method === 'POST' && (pathname === '/api/automations' || pathname === '/api/schedules')) {
        const body = await this.parseJsonBody<any>(req);
        const { type, cronExpression, durationSeconds, targetAgentId, channelId, prompt, timerCondition } = body;
        const targetProjId = body.projectId || this.workspaceRepo.listProjects('ws-default')[0]?.id || 'proj-kin';

        const proj = this.workspaceRepo.getProject(targetProjId);
        if (!proj) {
          return this.sendJson(res, 404, { error: `Project '${targetProjId}' not found` });
        }

        const validTypes = ['cron', 'timer', 'one_shot', 'oneshot'];
        if (type && !validTypes.includes(type)) {
          return this.sendJson(res, 400, { error: `Invalid schedule type '${type}'. Allowed types: 'cron', 'timer'.` });
        }

        if (targetAgentId && !this.agentRepo.getIdentity(targetAgentId)) {
          return this.sendJson(res, 404, { error: `Target agent '${targetAgentId}' not found` });
        }
        if (channelId && !this.workspaceRepo.getChannel(channelId)) {
          return this.sendJson(res, 404, { error: `Channel '${channelId}' not found` });
        }

        let schedule;
        try {
          if (type === 'cron') {
            schedule = this.scheduler.createCronSchedule({
              projectId: targetProjId,
              channelId: channelId || 'chan-general',
              targetAgentId,
              prompt: prompt || 'Periodic autonomous check',
              cronExpression: cronExpression || '*/5 * * * *',
              maxIterations: body.maxIterations,
            });
          } else {
            const dur = Number(durationSeconds) || 5;
            if (dur <= 0) {
              return this.sendJson(res, 400, { error: 'durationSeconds must be greater than 0' });
            }
            schedule = this.scheduler.createOneShotTimer({
              projectId: targetProjId,
              channelId: channelId || 'chan-general',
              targetAgentId,
              prompt: prompt || 'Scheduled wakeup check',
              durationSeconds: dur,
              timerCondition: timerCondition || 'never',
            });
          }
        } catch (schedErr: any) {
          return this.sendJson(res, 400, { error: schedErr.message });
        }
        this.broadcastEvent('schedule:created', schedule);
        return this.sendJson(res, 201, { success: true, schedule });
      }

      // 60. POST /api/automations/:id/trigger or /api/schedules/:id/trigger — Trigger automation / schedule immediately
      const triggerMatch = pathname.match(/^\/api\/(?:automations|schedules)\/([^/]+)\/trigger$/);
      if (req.method === 'POST' && triggerMatch) {
        const scheduleId = triggerMatch[1];
        try {
          const triggered = await this.scheduler.triggerScheduleNow(scheduleId);
          if (!triggered) {
            return this.sendJson(res, 404, { error: `Automation schedule '${scheduleId}' not found.` });
          }
          return this.sendJson(res, 200, { success: true, scheduleId, schedule: triggered, message: 'Automation triggered immediately.' });
        } catch (err: any) {
          return this.sendJson(res, 400, { error: err.message });
        }
      }

      // 61. DELETE /api/automations/:id or /api/schedules/:id — Cancel automation / schedule
      const cancelMatch = pathname.match(/^\/api\/(?:automations|schedules)\/([^/]+)$/);
      if (req.method === 'DELETE' && cancelMatch) {
        const scheduleId = cancelMatch[1];
        this.scheduler.cancelSchedule(scheduleId);
        return this.sendJson(res, 200, { success: true, scheduleId, message: 'Automation cancelled.' });
      }

      // 62. GET /api/system/recovery-state — Inspect crash recovery queue
      if (req.method === 'GET' && pathname === '/api/system/recovery-state') {
        return this.sendJson(res, 200, {
          count: this.pendingRecoveries.length,
          pendingRecoveries: this.pendingRecoveries,
        });
      }

      // 63. POST /api/system/recovery/resume-all — Resume all interrupted runs
      if (req.method === 'POST' && pathname === '/api/system/recovery/resume-all') {
        let body: any = {};
        try {
          body = await this.parseJsonBody<any>(req);
        } catch {}
        const modelOverride = body?.modelOverride || body?.targetModelId;
        const toResume = [...this.pendingRecoveries];
        let resumed = 0;
        for (const item of toResume) {
          const ok = await this.resumeInterruptedRun(item.id, modelOverride);
          if (ok) resumed++;
        }
        return this.sendJson(res, 200, { success: true, count: resumed, model: modelOverride });
      }

      // 64. POST /api/system/recovery/discard — Discard interrupted run states
      if (req.method === 'POST' && pathname === '/api/system/recovery/discard') {
        const discarded = this.pendingRecoveries.length;
        for (const item of this.pendingRecoveries) {
          this.kernel.transitionState(item.id, 'cancelled', 'Discarded by user recovery choice');
        }
        this.pendingRecoveries = [];
        this.broadcastEvent('system:recovery-state', { count: 0, pendingRecoveries: [] });
        return this.sendJson(res, 200, { success: true, discarded });
      }

      // 65. POST /api/system/recovery/resume-run/:runId — Resume specific interrupted run
      const resumeRunMatch = pathname.match(/^\/api\/system\/recovery\/resume-run\/([^/]+)$/);
      if (req.method === 'POST' && resumeRunMatch) {
        const runId = resumeRunMatch[1];
        let body: any = {};
        try {
          body = await this.parseJsonBody<any>(req);
        } catch {}
        const modelOverride = body?.modelOverride || body?.targetModelId;
        const ok = await this.resumeInterruptedRun(runId, modelOverride);
        return this.sendJson(res, 200, { success: ok, runId, model: modelOverride });
      }

      // 65b. POST /api/system/recovery/switch-model/:runId — Switch model and resume interrupted run
      const switchModelMatch = pathname.match(/^\/api\/system\/recovery\/switch-model\/([^/]+)$/);
      if (req.method === 'POST' && switchModelMatch) {
        const runId = switchModelMatch[1];
        let body: any = {};
        try {
          body = await this.parseJsonBody<any>(req);
        } catch {}
        const targetModel = body?.targetModelId || body?.modelOverride;
        if (!targetModel) {
          return this.sendJson(res, 400, { error: 'targetModelId or modelOverride is required' });
        }
        const ok = await this.resumeInterruptedRun(runId, targetModel);
        return this.sendJson(res, 200, { success: ok, runId, model: targetModel });
      }

      // 66. POST /api/system/recovery/switch-to-ollama/:runId — Failover interrupted run to local Ollama
      const switchToOllamaMatch = pathname.match(/^\/api\/system\/recovery\/switch-to-ollama\/([^/]+)$/);
      if (req.method === 'POST' && switchToOllamaMatch) {
        const runId = switchToOllamaMatch[1];
        const ollamaInfo = await this.getLocalOllamaModels();
        const selectedModel = (ollamaInfo.online && ollamaInfo.models.length > 0)
          ? `ollama/${ollamaInfo.models[0]}`
          : 'ollama/llama3';
        const ok = await this.resumeInterruptedRun(runId, selectedModel);
        return this.sendJson(res, 200, { success: ok, runId, model: selectedModel });
      }

      // 66b. POST /api/system/recovery/clear-quota — Reset all quota pauses and restore agents to idle
      if (req.method === 'POST' && pathname === '/api/system/recovery/clear-quota') {
        const cleared = this.db.query<{ id: string; agent_id: string }>(
          "SELECT id, agent_id FROM agent_runs WHERE state = 'quota_paused'"
        );
        this.db.execute("UPDATE agent_runs SET state = 'cancelled', quota_resets_at = NULL WHERE state = 'quota_paused'");
        for (const c of cleared) {
          this.activeAgentExecutions.delete(c.agent_id);
          this.broadcastEvent('agent:state', { agentId: c.agent_id, status: 'idle' });
        }
        this.broadcastEvent('quota:resumed', { runId: 'all' });
        return this.sendJson(res, 200, { success: true, count: cleared.length });
      }

      // 69. GET /api/settings/credentials — List managed credentials (BYOK)
      if (req.method === 'GET' && pathname === '/api/settings/credentials') {
        const rows = this.db.query<any>(
          'SELECT id, provider, key_alias, secret_hash, masked_key, base_url, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at FROM managed_credentials ORDER BY created_at DESC'
        );
        const credentials = rows.map((r) => {
          let scopedAgentIds: string[] = [];
          try {
            if (r.scoped_grants_json) scopedAgentIds = JSON.parse(r.scoped_grants_json);
          } catch {}
          const maskedKey = r.masked_key || '****...****';
          return {
            id: r.id,
            provider: r.provider,
            keyName: r.key_alias,
            keyAlias: r.key_alias,
            maskedKey,
            baseUrl: r.base_url || undefined,
            endpointUrl: r.base_url || undefined,
            monthlyQuotaTokens: r.max_spend_tokens,
            maxSpendTokens: r.max_spend_tokens,
            usedTokens: r.current_spend_tokens,
            currentSpendTokens: r.current_spend_tokens,
            quotaResetDay: 1,
            status: r.is_active ? 'active' : 'revoked',
            scopedAgentIds,
            scopedGrants: scopedAgentIds,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          };
        });
        return this.sendJson(res, 200, { credentials });
      }

      // 70. POST /api/settings/credentials — Add managed credential (BYOK)
      if (req.method === 'POST' && pathname === '/api/settings/credentials') {
        const body = await this.parseJsonBody<any>(req);
        const provider = body.provider;
        const keyName = body.keyName || body.keyAlias || body.key;
        let apiKey = body.apiKey || body.secret || body.value;
        const baseUrl = (body.baseUrl || body.endpointUrl || body.base_url || '').trim() || null;
        const monthlyQuotaTokens = body.monthlyQuotaTokens || body.maxSpendTokens || 5000000;
        const scopedAgentIds = body.scopedAgentIds || body.scopedGrants || [];

        // Support zero-auth local endpoints (e.g. LM Studio, local vLLM) when apiKey is omitted
        const isLocalZeroAuth = (!apiKey || String(apiKey).trim() === '') && Boolean(baseUrl);
        if (isLocalZeroAuth) {
          apiKey = 'local-no-key';
        }

        if (!provider || !keyName || !apiKey) {
          return this.sendJson(res, 400, { error: 'Provider, keyName (or keyAlias/key), and apiKey (or secret/value) are required' });
        }

        // Prevent duplicate keys via deterministic SHA-256 fingerprint check
        const cleanApiKey = String(apiKey).trim();
        const fingerprint = cleanApiKey === 'local-no-key'
          ? crypto.createHash('sha256').update(`local:${baseUrl || 'default'}:${provider}:${keyName}`).digest('hex')
          : crypto.createHash('sha256').update(cleanApiKey).digest('hex');
        let existingDuplicate = this.db.queryOne<any>(
          'SELECT id, provider, key_alias, masked_key FROM managed_credentials WHERE key_fingerprint = ? AND is_active = 1',
          fingerprint
        );

        if (!existingDuplicate && cleanApiKey !== 'local-no-key') {
          const allActive = this.db.query<any>('SELECT id, provider, key_alias, secret_hash, masked_key FROM managed_credentials WHERE is_active = 1');
          const vault = SecretVault.getInstance();
          for (const ac of allActive) {
            if (ac.secret_hash) {
              const dec = vault.decrypt(ac.secret_hash);
              if (dec && dec.trim() === cleanApiKey) {
                existingDuplicate = ac;
                try {
                  this.db.execute('UPDATE managed_credentials SET key_fingerprint = ? WHERE id = ?', fingerprint, ac.id);
                } catch {}
                break;
              }
            }
          }
        }

        if (existingDuplicate) {
          return this.sendJson(res, 409, {
            error: `This API key has already been added and is currently in use (Provider: "${existingDuplicate.provider}", Alias: "${existingDuplicate.key_alias}"). Duplicate keys are not permitted.`,
            duplicate: true,
            existingCredentialId: existingDuplicate.id,
            existingProvider: existingDuplicate.provider,
            existingAlias: existingDuplicate.key_alias,
          });
        }

        const now = Date.now();
        const credId = `cred-${now}-${Math.random().toString(36).slice(2, 6)}`;
        const masked = cleanApiKey === 'local-no-key'
          ? 'No Key (Local)'
          : cleanApiKey.length >= 16
            ? `${cleanApiKey.slice(0, 4)}...${cleanApiKey.slice(-4)}`
            : cleanApiKey.length >= 8
              ? `${cleanApiKey.slice(0, 2)}...${cleanApiKey.slice(-2)}`
              : '****...****';

        const encryptedKey = SecretVault.getInstance().encrypt(cleanApiKey);

        this.db.execute(
          `INSERT INTO managed_credentials (id, provider, key_alias, secret_hash, masked_key, key_fingerprint, base_url, scoped_grants_json, max_spend_tokens, current_spend_tokens, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          credId,
          provider,
          keyName,
          encryptedKey,
          masked,
          fingerprint,
          baseUrl,
          JSON.stringify(scopedAgentIds),
          Number(monthlyQuotaTokens),
          0,
          1,
          now,
          now
        );

        if (baseUrl) {
          try {
            this.db.execute(
              `INSERT OR REPLACE INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
               VALUES (?, ?, ?, ?, ?, 1, ?)`,
              provider,
              keyName || provider,
              'openai_compatible',
              baseUrl,
              'managed',
              now
            );
          } catch {}
        }
        this.syncModelGatewayProviders();

        const credential = {
          id: credId,
          provider,
          keyName,
          keyAlias: keyName,
          maskedKey: masked,
          baseUrl: baseUrl || undefined,
          endpointUrl: baseUrl || undefined,
          monthlyQuotaTokens: Number(monthlyQuotaTokens),
          maxSpendTokens: Number(monthlyQuotaTokens),
          usedTokens: 0,
          currentSpendTokens: 0,
          quotaResetDay: 1,
          status: 'active',
          scopedAgentIds,
          scopedGrants: scopedAgentIds,
          createdAt: now,
          updatedAt: now,
        };

        this.broadcastEvent('credential:created', credential);

        // Automatically trigger live model discovery for the newly added provider key
        (async () => {
          try {
            const discovered = await this.modelGateway.fetchProviderModels(provider, apiKey, baseUrl ? { baseUrl } : undefined);
            for (const m of discovered) {
              try {
                if (m.provider && m.provider !== provider) {
                  try {
                    this.db.execute(
                      `INSERT OR IGNORE INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
                       VALUES (?, ?, ?, ?, ?, 1, ?)`,
                      m.provider,
                      m.provider,
                      'openai_compatible',
                      baseUrl,
                      'managed',
                      now
                    );
                  } catch {}
                }
                this.db.execute(
                  `INSERT OR REPLACE INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                  m.id,
                  m.provider,
                  m.name,
                  m.contextWindow || 128000,
                  m.maxOutputTokens || 4096,
                  m.supportsTools ? 1 : 0,
                  m.supportsVision ? 1 : 0,
                  now
                );
              } catch {}
            }
            if (discovered.length > 0) {
              this.broadcastEvent('models:updated', { provider, count: discovered.length });
            }
          } catch (err) {
            console.warn('[KIN CORE] Auto-discovery models warning for ' + provider + ':', err);
          }
        })();

        return this.sendJson(res, 201, { success: true, credential });
      }

      // 70b. PUT /api/settings/credentials/:id — Modify managed credential (BYOK)
      const credPutMatch = pathname.match(/^\/api\/settings\/credentials\/([^/]+)$/);
      if (req.method === 'PUT' && credPutMatch) {
        const credId = credPutMatch[1];
        const body = await this.parseJsonBody<any>(req);
        const existing = this.db.queryOne<any>('SELECT * FROM managed_credentials WHERE id = ?', credId);
        if (!existing) {
          return this.sendJson(res, 404, { error: 'Credential not found' });
        }

        const now = Date.now();
        const provider = body.provider || existing.provider;
        const keyName = body.keyName || body.keyAlias || body.key || existing.key_alias;
        const baseUrl = body.baseUrl !== undefined ? (String(body.baseUrl).trim() || null) : (body.endpointUrl !== undefined ? (String(body.endpointUrl).trim() || null) : (existing.base_url || null));
        const monthlyQuotaTokens = body.monthlyQuotaTokens !== undefined ? Number(body.monthlyQuotaTokens) : existing.max_spend_tokens;
        const scopedAgentIds = body.scopedAgentIds || body.scopedGrants || (existing.scoped_grants_json ? JSON.parse(existing.scoped_grants_json) : []);

        let encryptedKey = existing.secret_hash;
        let maskedKey = existing.masked_key || '****...****';
        let keyFingerprint = existing.key_fingerprint;
        const apiKey = (body.apiKey || body.secret || body.value || '').trim();
        if (apiKey && apiKey !== '****...****' && !apiKey.includes('...')) {
          const fingerprint = apiKey === 'local-no-key'
            ? crypto.createHash('sha256').update(`local:${baseUrl || existing.base_url || 'default'}:${provider}:${keyName}`).digest('hex')
            : crypto.createHash('sha256').update(apiKey).digest('hex');
          let duplicateOther = this.db.queryOne<any>(
            'SELECT id, provider, key_alias FROM managed_credentials WHERE key_fingerprint = ? AND id != ? AND is_active = 1',
            fingerprint,
            credId
          );
          if (!duplicateOther && apiKey !== 'local-no-key') {
            const allOthers = this.db.query<any>('SELECT id, provider, key_alias, secret_hash FROM managed_credentials WHERE id != ? AND is_active = 1', credId);
            const vault = SecretVault.getInstance();
            for (const ac of allOthers) {
              if (ac.secret_hash) {
                const dec = vault.decrypt(ac.secret_hash);
                if (dec && dec.trim() === apiKey) {
                  duplicateOther = ac;
                  break;
                }
              }
            }
          }
          if (duplicateOther) {
            return this.sendJson(res, 409, {
              error: `This API key is already configured under alias "${duplicateOther.key_alias}" for provider "${duplicateOther.provider}". Duplicate keys cannot be saved.`,
              duplicate: true,
              existingCredentialId: duplicateOther.id,
              existingProvider: duplicateOther.provider,
              existingAlias: duplicateOther.key_alias,
            });
          }
          keyFingerprint = fingerprint;
          encryptedKey = SecretVault.getInstance().encrypt(apiKey);
          maskedKey = apiKey === 'local-no-key'
            ? 'No Key (Local)'
            : apiKey.length >= 16
              ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
              : apiKey.length >= 8
                ? `${apiKey.slice(0, 2)}...${apiKey.slice(-2)}`
                : '****...****';
        }

        this.db.execute(
          `UPDATE managed_credentials 
           SET provider = ?, key_alias = ?, secret_hash = ?, masked_key = ?, key_fingerprint = ?, base_url = ?, scoped_grants_json = ?, max_spend_tokens = ?, updated_at = ?
           WHERE id = ?`,
          provider,
          keyName,
          encryptedKey,
          maskedKey,
          keyFingerprint,
          baseUrl,
          JSON.stringify(scopedAgentIds),
          monthlyQuotaTokens,
          now,
          credId
        );

        if (baseUrl) {
          try {
            this.db.execute(
              `INSERT OR REPLACE INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
               VALUES (?, ?, ?, ?, ?, 1, ?)`,
              provider,
              keyName || provider,
              'openai_compatible',
              baseUrl,
              'managed',
              now
            );
          } catch {}
        }
        this.syncModelGatewayProviders();

        const updatedCred = {
          id: credId,
          provider,
          keyName,
          keyAlias: keyName,
          maskedKey,
          baseUrl: baseUrl || undefined,
          endpointUrl: baseUrl || undefined,
          monthlyQuotaTokens,
          maxSpendTokens: monthlyQuotaTokens,
          usedTokens: existing.current_spend_tokens || 0,
          currentSpendTokens: existing.current_spend_tokens || 0,
          quotaResetDay: 1,
          status: existing.is_active ? 'active' : 'revoked',
          scopedAgentIds,
          scopedGrants: scopedAgentIds,
          createdAt: existing.created_at,
          updatedAt: now,
        };

        this.broadcastEvent('credential:updated', updatedCred);

        if (apiKey && apiKey !== '****...****' && !apiKey.includes('...')) {
          (async () => {
            try {
              const discovered = await this.modelGateway.fetchProviderModels(provider, apiKey, baseUrl ? { baseUrl } : undefined);
              for (const m of discovered) {
                try {
                  if (m.provider && m.provider !== provider) {
                    try {
                      this.db.execute(
                        `INSERT OR IGNORE INTO providers (id, name, provider_type, base_url, api_key_ref, is_active, created_at)
                         VALUES (?, ?, ?, ?, ?, 1, ?)`,
                        m.provider,
                        m.provider,
                        'openai_compatible',
                        baseUrl || null,
                        'managed',
                        now
                      );
                    } catch {}
                  }
                  this.db.execute(
                    `INSERT OR REPLACE INTO models (id, provider_id, name, context_window, max_output_tokens, supports_tools, supports_vision, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    m.id,
                    m.provider,
                    m.name,
                    m.contextWindow || 128000,
                    m.maxOutputTokens || 4096,
                    m.supportsTools ? 1 : 0,
                    m.supportsVision ? 1 : 0,
                    now
                  );
                } catch {}
              }
              if (discovered.length > 0) {
                this.broadcastEvent('models:updated', { provider, count: discovered.length });
              }
            } catch (err) {
              console.warn('[KIN CORE] Auto-discovery models warning for ' + provider + ':', err);
            }
          })();
        }

        return this.sendJson(res, 200, { success: true, credential: updatedCred });
      }

      // 71. DELETE /api/settings/credentials/:id — Delete managed credential
      const credDeleteMatch = pathname.match(/^\/api\/settings\/credentials\/([^/]+)$/);
      if (req.method === 'DELETE' && credDeleteMatch) {
        const credId = credDeleteMatch[1];
        const existingCred = this.db.queryOne<any>('SELECT provider, key_alias, base_url FROM managed_credentials WHERE id = ?', credId);
        this.db.execute('DELETE FROM managed_credentials WHERE id = ?', credId);
        if (existingCred?.provider) {
          const remaining = this.db.queryOne<any>(
            'SELECT COUNT(*) as count FROM managed_credentials WHERE provider = ? AND is_active = 1',
            existingCred.provider
          );
          if (!remaining || remaining.count === 0) {
            this.db.execute('DELETE FROM models WHERE provider_id = ?', existingCred.provider);
            this.db.execute('DELETE FROM providers WHERE id = ?', existingCred.provider);
            this.modelGateway.invalidateProvider(existingCred.provider);
            this.broadcastEvent('models:updated', { provider: existingCred.provider, count: 0 });
          }
        }
        if (existingCred?.key_alias) {
          this.modelGateway.invalidateProvider(existingCred.key_alias);
          this.modelGateway.unregisterCustomProvider(existingCred.key_alias);
        }
        this.modelGateway.invalidateProvider(credId);
        this.modelGateway.unregisterCustomProvider(credId);
        this.syncModelGatewayProviders();
        this.broadcastEvent('credential:deleted', { id: credId });
        return this.sendJson(res, 200, { success: true, id: credId });
      }

      // 71b. GET /api/settings/credentials/scan-host — Scan local developer credentials
      if (req.method === 'GET' && (pathname === '/api/settings/credentials/scan-host' || pathname === '/api/credentials/scan-host')) {
        const activeProj = this.workspaceRepo.getProject(this.activeProjectId);
        const existingCreds = this.db.query<{ key_fingerprint: string }>('SELECT key_fingerprint FROM managed_credentials WHERE key_fingerprint IS NOT NULL');
        const fingerprints = new Set(existingCreds.map((c) => c.key_fingerprint));
        const discovered = CredentialScanner.scanHostCredentials(activeProj?.repoPath, fingerprints);
        return this.sendJson(res, 200, { success: true, discovered });
      }

      // 71c. POST /api/settings/credentials/import-discovered — Import detected credential into SQLite
      if (req.method === 'POST' && (pathname === '/api/settings/credentials/import-discovered' || pathname === '/api/credentials/import-discovered')) {
        const body = await this.parseJsonBody<any>(req);
        if (!body.provider || !body.token) {
          return this.sendJson(res, 400, { error: 'Missing provider or token' });
        }
        const result = CredentialScanner.importCredential(this.db, {
          provider: body.provider,
          keyAlias: body.keyAlias || `${body.provider}-detected`,
          token: body.token,
          baseUrl: body.baseUrl,
        });
        if (result.success) {
          this.syncModelGatewayProviders();
          this.broadcastEvent('credentials:updated', { id: result.id, provider: body.provider });
        }
        return this.sendJson(res, result.success ? 200 : 400, result);
      }

      // 71d. POST /api/oauth/authorize/:provider — Initiate 1-click OAuth flow
      const oauthAuthMatch = pathname.match(/^\/api\/oauth\/authorize\/([^/]+)$/);
      if ((req.method === 'POST' || req.method === 'GET') && oauthAuthMatch) {
        const provider = oauthAuthMatch[1].toLowerCase() as 'github' | 'google' | 'slack';
        if (provider !== 'github' && provider !== 'google' && provider !== 'slack') {
          return this.sendJson(res, 400, { error: `Unsupported OAuth provider: ${provider}` });
        }
        const authData = OAuthHandler.startAuthFlow(provider, this.port || 54321);
        return this.sendJson(res, 200, { success: true, ...authData });
      }

      // 73. GET /api/system/apps — Discover installed desktop applications
      if (req.method === 'GET' && pathname === '/api/system/apps') {
        const apps = await this.desktopController.discoverInstalledApps();
        return this.sendJson(res, 200, { apps });
      }

      // 74. POST /api/system/apps/launch — Launch installed desktop application
      if (req.method === 'POST' && pathname === '/api/system/apps/launch') {
        const body = await this.parseJsonBody<{ appNameOrPath?: string; name?: string; args?: string[]; approvalToken?: string }>(req);
        const target = body.appNameOrPath || body.name;
        if (!target) return this.sendJson(res, 400, { error: 'appNameOrPath is required' });
        const approvalToken = (req.headers['x-kin-approval-token'] as string) || body.approvalToken;
        const autonomyMode = this.getEffectiveAutonomyMode();
        const sentinel = Sentinel.getInstance();
        const decision = sentinel.evaluate({
          agentId: 'operator',
          toolName: 'desktopLaunchApp',
          params: { target, args: body.args },
          riskLevel: 'HIGH',
          autonomyMode,
          agentCapabilities: ['desktop:launch'],
        });

        if (!decision.allowed) {
          return this.sendJson(res, 403, { error: decision.reason || 'Launch blocked by Sentinel' });
        }

        const resObj = await this.desktopController.launchApp(target, body.args);
        return this.sendJson(res, 200, resObj);
      }

      // 75. POST /api/system/dialog/browse-folder — Cross-platform native folder browser
      if (req.method === 'POST' && pathname === '/api/system/dialog/browse-folder') {
        try {
          const platform = process.platform;
          let selectedPath = '';

          if (platform === 'win32') {
            const script = `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Project or Repository Folder'; $f.ShowNewFolderButton = $true; $topMost = New-Object System.Windows.Forms.Form; $topMost.TopMost = $true; if ($f.ShowDialog($topMost) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }`;
            const out = childProcess.spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
              encoding: 'utf8',
              windowsHide: true,
              timeout: 60000,
            });
            selectedPath = (out.stdout || '').trim();
          } else if (platform === 'darwin') {
            const script = 'POSIX path of (choose folder with prompt "Select Project Folder")';
            const out = childProcess.spawnSync('osascript', ['-e', script], {
              encoding: 'utf8',
              timeout: 60000,
            });
            selectedPath = (out.stdout || '').trim();
          } else {
            // Linux: Try zenity, fallback to kdialog if zenity is not installed
            let out = childProcess.spawnSync('zenity', ['--file-selection', '--directory', '--title=Select Project Folder'], {
              encoding: 'utf8',
              timeout: 60000,
            });
            if (out.error) {
              out = childProcess.spawnSync('kdialog', ['--getexistingdirectory', '.'], {
                encoding: 'utf8',
                timeout: 60000,
              });
            }
            selectedPath = (out.stdout || '').trim();
          }

          if (selectedPath) {
            return this.sendJson(res, 200, {
              path: path.resolve(selectedPath),
              name: path.basename(selectedPath),
              canceled: false,
            });
          } else {
            return this.sendJson(res, 200, { path: null, canceled: true });
          }
        } catch (dialogErr: any) {
          return this.sendJson(res, 500, { error: dialogErr?.message || 'Folder dialog failed', canceled: true });
        }
      }

    return false;
  }
}
