import type { IncomingMessage, ServerResponse } from 'node:http';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  parsedUrl: URL;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

export interface TrieNode {
  part: string;
  isParam: boolean;
  paramName?: string;
  handlers: Map<HttpMethod, RouteHandler>;
  children: Map<string, TrieNode>;
  paramChild?: TrieNode;
  wildcardChild?: TrieNode;
}

export class RadixRouter {
  private root: TrieNode = this.createNode('');
  private readonly aliasMap = new Map<string, string>();

  public register(method: HttpMethod, path: string, handler: RouteHandler): void {
    const segments = path.split('/').filter(Boolean);
    let current = this.root;

    for (const segment of segments) {
      if (segment.startsWith(':')) {
        const paramName = segment.slice(1);
        if (!current.paramChild) {
          current.paramChild = this.createNode(segment, true, paramName);
        }
        current = current.paramChild;
      } else if (segment === '*') {
        if (!current.wildcardChild) {
          current.wildcardChild = this.createNode(segment);
        }
        current = current.wildcardChild;
      } else {
        let child = current.children.get(segment);
        if (!child) {
          child = this.createNode(segment);
          current.children.set(segment, child);
        }
        current = child;
      }
    }
    current.handlers.set(method, handler);
  }

  public registerAlias(method: HttpMethod, aliasPath: string, canonicalPath: string, handler: RouteHandler): void {
    this.aliasMap.set(`${method} ${aliasPath}`, `${method} ${canonicalPath}`);
    this.register(method, aliasPath, handler);
  }

  public registerAllLegacyAliases(handlers: Map<string, RouteHandler>): void {
    const aliases: [HttpMethod, string, string][] = [
      ['GET', '/health', '/api/health'],
      ['GET', '/api/models', '/api/system/models'],
      ['GET', '/api/system/models/readiness', '/api/models/readiness'],
      ['POST', '/api/terminal/exec', '/api/system/terminal'],
      ['GET', '/api/learning/experiences', '/api/skills/experiences'],
      ['POST', '/api/schedules', '/api/automations'],
      ['POST', '/api/mcp/test', '/api/mcp/connectors/test'],
      ['GET', '/api/teamwork-preview', '/api/projects/:id/teamwork-preview'],
      ['GET', '/api/credentials/scan-host', '/api/settings/credentials/scan-host'],
      ['POST', '/api/credentials/import-discovered', '/api/settings/credentials/import-discovered'],
    ];

    for (const [method, aliasPath, canonicalPath] of aliases) {
      const canonicalHandler = handlers.get(`${method} ${canonicalPath}`);
      if (canonicalHandler) {
        this.registerAlias(method, aliasPath, canonicalPath, canonicalHandler);
      }
    }
  }

  public match(method: HttpMethod, pathname: string): { handler: RouteHandler; params: Record<string, string> } | null {
    const segments = pathname.split('/').filter(Boolean);
    const params: Record<string, string> = {};
    let current = this.root;

    for (const segment of segments) {
      if (current.children.has(segment)) {
        current = current.children.get(segment)!;
      } else if (current.paramChild) {
        current = current.paramChild;
        params[current.paramName!] = segment;
      } else if (current.wildcardChild) {
        current = current.wildcardChild;
        break;
      } else {
        return null;
      }
    }

    const handler = current.handlers.get(method);
    if (!handler) return null;
    return { handler, params };
  }

  public async dispatch(req: IncomingMessage, res: ServerResponse, pathname: string, parsedUrl: URL): Promise<boolean> {
    const method = req.method as HttpMethod;
    const matchResult = this.match(method, pathname);
    if (!matchResult) return false;

    await matchResult.handler({
      req,
      res,
      pathname,
      parsedUrl,
      params: matchResult.params,
      query: parsedUrl.searchParams,
    });
    return true;
  }

  private createNode(part: string, isParam = false, paramName?: string): TrieNode {
    return { part, isParam, paramName, handlers: new Map(), children: new Map() };
  }
}
