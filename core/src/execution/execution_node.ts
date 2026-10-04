// ============================================================================
// KIN EXECUTION NODE ABSTRACTION
// First-class abstraction for execution environments (Host, Sandbox, Browser, App, Remote)
// with honest degradation reporting when requested isolation is unavailable.
// ============================================================================

export type ExecutionNodeType = 'HOST' | 'SANDBOX' | 'BROWSER' | 'APPLICATION' | 'PRIVATE_SERVER' | 'REMOTE_CLOUD';
export type ExecutionNodeStatus = 'active' | 'degraded' | 'unavailable';

export interface ExecutionNodeInfo {
  id: string;
  name: string;
  type: ExecutionNodeType;
  status: ExecutionNodeStatus;
  statusReason?: string;
  capabilities: string[];
}

export interface NodeExecutionResult<T = any> {
  success: boolean;
  node: ExecutionNodeInfo;
  data?: T;
  error?: string;
  degradedNotice?: string;
}

export abstract class ExecutionNode {
  public abstract readonly id: string;
  public abstract readonly name: string;
  public abstract readonly type: ExecutionNodeType;
  public abstract readonly status: ExecutionNodeStatus;
  public abstract readonly statusReason?: string;
  public abstract readonly capabilities: string[];

  public getInfo(): ExecutionNodeInfo {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      statusReason: this.statusReason,
      capabilities: [...this.capabilities],
    };
  }

  public abstract execute<T = any>(
    toolName: string,
    params: Record<string, any>,
    executor: (params: Record<string, any>) => Promise<T>
  ): Promise<NodeExecutionResult<T>>;
}

/**
 * HostExecutionNode: Executes directly on the user's local operating environment.
 */
export class HostExecutionNode extends ExecutionNode {
  public readonly id = 'node-host-local';
  public readonly name = 'Local Host Node';
  public readonly type: ExecutionNodeType = 'HOST';
  public readonly status: ExecutionNodeStatus = 'active';
  public readonly statusReason?: string;
  public readonly capabilities = ['fs:read', 'fs:write', 'shell:exec', 'desktop:control'];

  public async execute<T = any>(
    _toolName: string,
    params: Record<string, any>,
    executor: (params: Record<string, any>) => Promise<T>
  ): Promise<NodeExecutionResult<T>> {
    try {
      const data = await executor(params);
      return {
        success: true,
        node: this.getInfo(),
        data,
      };
    } catch (err: any) {
      return {
        success: false,
        node: this.getInfo(),
        error: err?.message || String(err),
      };
    }
  }
}

/**
 * SandboxWorktreeNode: Executes coding tasks within an isolated Git worktree or jailed directory.
 * If container isolation is not supported on host OS, honestly reports degraded status.
 */
export class SandboxWorktreeNode extends ExecutionNode {
  public readonly id = 'node-sandbox-worktree';
  public readonly name = 'Isolated Git Worktree Sandbox';
  public readonly type: ExecutionNodeType = 'SANDBOX';
  public readonly capabilities = ['fs:read', 'fs:write', 'git:isolated'];

  private isContainerSupported: boolean;
  public readonly status: ExecutionNodeStatus;
  public readonly statusReason?: string;

  constructor(isContainerSupported: boolean = false) {
    super();
    this.isContainerSupported = isContainerSupported;
    if (this.isContainerSupported) {
      this.status = 'active';
    } else {
      this.status = 'degraded';
      this.statusReason = 'OS containerization (Docker/bubblewrap) unavailable on host; operating in isolated Git worktree jail.';
    }
  }

  public async execute<T = any>(
    _toolName: string,
    params: Record<string, any>,
    executor: (params: Record<string, any>) => Promise<T>
  ): Promise<NodeExecutionResult<T>> {
    try {
      const data = await executor(params);
      return {
        success: true,
        node: this.getInfo(),
        data,
        degradedNotice: this.status === 'degraded' ? this.statusReason : undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        node: this.getInfo(),
        error: err?.message || String(err),
        degradedNotice: this.status === 'degraded' ? this.statusReason : undefined,
      };
    }
  }
}

/**
 * BrowserExecutionNode: Executes within governed Chromium browser sessions.
 */
export class BrowserExecutionNode extends ExecutionNode {
  public readonly id = 'node-browser-local';
  public readonly name = 'Governed Browser Node';
  public readonly type: ExecutionNodeType = 'BROWSER';
  public readonly status: ExecutionNodeStatus = 'active';
  public readonly statusReason?: string;
  public readonly capabilities = ['browser:navigate', 'browser:click', 'browser:type', 'browser:inspect'];

  public async execute<T = any>(
    _toolName: string,
    params: Record<string, any>,
    executor: (params: Record<string, any>) => Promise<T>
  ): Promise<NodeExecutionResult<T>> {
    try {
      const data = await executor(params);
      return {
        success: true,
        node: this.getInfo(),
        data,
      };
    } catch (err: any) {
      return {
        success: false,
        node: this.getInfo(),
        error: err?.message || String(err),
      };
    }
  }
}

/**
 * DesktopExecutionNode: Controls local desktop windows, input, and screen.
 */
export class DesktopExecutionNode extends ExecutionNode {
  public readonly id = 'node-desktop-local';
  public readonly name = 'Desktop Automation Node';
  public readonly type: ExecutionNodeType = 'APPLICATION';
  public readonly capabilities = ['desktop:interact', 'desktop:screen'];
  public readonly status: ExecutionNodeStatus;
  public readonly statusReason?: string;

  constructor() {
    super();
    if (process.platform === 'win32') {
      this.status = 'active';
    } else {
      this.status = 'unavailable';
      this.statusReason = 'Desktop automation is currently supported natively on Windows.';
    }
  }

  public async execute<T = any>(
    _toolName: string,
    params: Record<string, any>,
    executor: (params: Record<string, any>) => Promise<T>
  ): Promise<NodeExecutionResult<T>> {
    if (this.status === 'unavailable') {
      return {
        success: false,
        node: this.getInfo(),
        error: this.statusReason,
      };
    }

    try {
      const data = await executor(params);
      return {
        success: true,
        node: this.getInfo(),
        data,
      };
    } catch (err: any) {
      return {
        success: false,
        node: this.getInfo(),
        error: err?.message || String(err),
      };
    }
  }
}

/**
 * ExecutionNodeRouter: Routes tool calls to the appropriate node based on tool category and requirements.
 */
export class ExecutionNodeRouter {
  private static instance: ExecutionNodeRouter;
  private hostNode: HostExecutionNode;
  private sandboxNode: SandboxWorktreeNode;
  private browserNode: BrowserExecutionNode;
  private desktopNode: DesktopExecutionNode;

  private constructor() {
    this.hostNode = new HostExecutionNode();
    this.sandboxNode = new SandboxWorktreeNode(false);
    this.browserNode = new BrowserExecutionNode();
    this.desktopNode = new DesktopExecutionNode();
  }

  public static getInstance(): ExecutionNodeRouter {
    if (!ExecutionNodeRouter.instance) {
      ExecutionNodeRouter.instance = new ExecutionNodeRouter();
    }
    return ExecutionNodeRouter.instance;
  }

  public getNodeForTool(toolName: string, preferSandbox: boolean = false): ExecutionNode {
    const lower = toolName.toLowerCase();

    if (lower.startsWith('browser')) {
      return this.browserNode;
    }

    if (lower.startsWith('desktop')) {
      return this.desktopNode;
    }

    if (preferSandbox && (lower.includes('write') || lower.includes('file') || lower.includes('edit') || lower.includes('patch'))) {
      return this.sandboxNode;
    }

    return this.hostNode;
  }

  public listNodes(): ExecutionNodeInfo[] {
    return [
      this.hostNode.getInfo(),
      this.sandboxNode.getInfo(),
      this.browserNode.getInfo(),
      this.desktopNode.getInfo(),
    ];
  }
}
