import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { newQuickJSWASMModuleFromVariant, QuickJSContext } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import { isPathWithinRoot, isSensitivePattern } from '../security/path_jail.js';

export interface QuickJSRunOptions {
  handlerCode: string;
  params?: Record<string, any>;
  context?: Record<string, any>;
  timeoutMs?: number;
  maxMemoryMb?: number;
  worktreeRoot?: string;
  enableJailedFs?: boolean;
  enableCallTool?: boolean;
  onToolCall?: (name: string, args: Record<string, any>) => Promise<any>;
}

function validateJailedPathInSandbox(targetPath: string, worktreeRoot: string): string {
  const base = path.resolve(worktreeRoot);
  const resolved = path.resolve(base, String(targetPath || ''));
  if (!isPathWithinRoot(resolved, base)) {
    throw new Error('Path jail traversal blocked: ' + targetPath);
  }
  const relPosix = path.relative(base, resolved).replace(/\\/g, '/');
  const baseName = path.basename(resolved);
  if (isSensitivePattern(relPosix, baseName)) {
    throw new Error('Path jail access to sensitive file blocked: ' + targetPath);
  }
  const canonicalBase = fs.existsSync(base) ? fs.realpathSync(base) : base;
  let resolvedIsSymlink = false;
  let resolvedExists = false;
  try {
    const lst = fs.lstatSync(resolved);
    resolvedIsSymlink = lst.isSymbolicLink();
    resolvedExists = true;
  } catch {
    resolvedExists = false;
  }
  if (resolvedExists || resolvedIsSymlink) {
    let realTarget: string;
    try {
      realTarget = fs.realpathSync(resolved);
    } catch {
      throw new Error('Path jail dangling symlink blocked: ' + targetPath);
    }
    if (!isPathWithinRoot(realTarget, canonicalBase)) {
      throw new Error('Path jail symlink traversal blocked: ' + targetPath);
    }
    const realRelPosix = path.relative(canonicalBase, realTarget).replace(/\\/g, '/');
    const realBaseName = path.basename(realTarget);
    if (isSensitivePattern(realRelPosix, realBaseName)) {
      throw new Error('Path jail symlink access to sensitive file blocked: ' + targetPath);
    }
    return realTarget;
  }
  let current = path.dirname(resolved);
  while (current && !fs.existsSync(current) && current !== canonicalBase && current !== path.dirname(current)) {
    current = path.dirname(current);
  }
  if (fs.existsSync(current)) {
    const realAncestor = fs.realpathSync(current);
    if (!isPathWithinRoot(realAncestor, canonicalBase)) {
      throw new Error('Path jail ancestor symlink traversal blocked: ' + targetPath);
    }
  }
  return resolved;
}

export interface QuickJSRunResult {
  success: boolean;
  output?: any;
  logs?: string[];
  error?: string;
}

let cachedModulePromise: Promise<Awaited<ReturnType<typeof newQuickJSWASMModuleFromVariant>>> | null = null;

async function getQuickJSModule() {
  if (!cachedModulePromise) {
    cachedModulePromise = newQuickJSWASMModuleFromVariant((variant as any).default || (variant as any));
  }
  return cachedModulePromise;
}

function marshalToQuickJS(ctx: QuickJSContext, value: any) {
  const json = JSON.stringify(value ?? null);
  const res = ctx.evalCode(`(${json})`);
  return ctx.unwrapResult(res);
}

/**
 * Executes untrusted JS handler/PTC code inside an isolated QuickJS-WASM sandbox
 * with strict memory limits, interrupt timeout, and zero Node.js host globals.
 */
export async function runInQuickJS(options: QuickJSRunOptions): Promise<QuickJSRunResult> {
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 15000, 100), 60000);
  const maxMemoryBytes = Math.min(Math.max(Number(options.maxMemoryMb) || 64, 8), 512) * 1024 * 1024;
  const logs: string[] = [];

  const qjs = await getQuickJSModule();
  const runtime = qjs.newRuntime();
  runtime.setMemoryLimit(maxMemoryBytes);
  runtime.setMaxStackSize(1024 * 1024);

  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);

  const ctx = runtime.newContext();
  const pendingPromises: Array<Promise<void>> = [];
  const activeTimers = new Map<number, NodeJS.Timeout>();
  const timerCallbacks = new Map<number, any>();
  const timerResolvers = new Map<number, () => void>();
  const pendingDeferreds = new Set<() => void>();

  try {
    // Inject params and context cleanly via JSON serialization
    const paramsHandle = marshalToQuickJS(ctx, options.params || {});
    const contextHandle = marshalToQuickJS(ctx, options.context || {});
    ctx.setProp(ctx.global, '__kin_params', paramsHandle);
    ctx.setProp(ctx.global, '__kin_context', contextHandle);
    paramsHandle.dispose();
    contextHandle.dispose();

    // Safe setTimeout / clearTimeout backed by host timer & QuickJS pending job pump
    let nextTimerId = 1;

    const setTimeoutFn = ctx.newFunction('__kin_set_timeout', (fnHandle, msHandle) => {
      const id = nextTimerId++;
      const delay = Math.min(Math.max(Number(ctx.dump(msHandle)) || 0, 0), 60000);
      const dupFn = fnHandle.dup();
      timerCallbacks.set(id, dupFn);
      const deferred = ctx.newPromise();
      const cleanupDeferred = () => {
        pendingDeferreds.delete(cleanupDeferred);
        if (ctx.alive) {
          try {
            deferred.resolve(ctx.undefined);
            runtime.executePendingJobs();
          } catch {}
        }
      };
      pendingDeferreds.add(cleanupDeferred);
      const p = new Promise<void>((resolve) => {
        const settleTimer = () => {
          timerResolvers.delete(id);
          cleanupDeferred();
          resolve();
        };
        timerResolvers.set(id, settleTimer);
        const t = setTimeout(() => {
          activeTimers.delete(id);
          const cb = timerCallbacks.get(id);
          timerCallbacks.delete(id);
          if (cb && ctx.alive) {
            try {
              const callRes = ctx.callFunction(cb, ctx.undefined);
              if (callRes.error) callRes.error.dispose();
              else callRes.value.dispose();
            } catch {}
            try { cb.dispose(); } catch {}
            try { runtime.executePendingJobs(); } catch {}
          }
          settleTimer();
        }, delay);
        if (typeof t.unref === 'function') t.unref();
        activeTimers.set(id, t);
      });
      pendingPromises.push(p);
      deferred.handle.dispose();
      return ctx.newNumber(id);
    });
    const clearTimeoutFn = ctx.newFunction('__kin_clear_timeout', (idHandle) => {
      const id = Number(ctx.dump(idHandle));
      const t = activeTimers.get(id);
      if (t) {
        clearTimeout(t);
        activeTimers.delete(id);
      }
      const cb = timerCallbacks.get(id);
      if (cb) {
        timerCallbacks.delete(id);
        try { cb.dispose(); } catch {}
      }
      const settle = timerResolvers.get(id);
      if (settle) {
        settle();
      }
    });
    ctx.setProp(ctx.global, '__kin_set_timeout', setTimeoutFn);
    ctx.setProp(ctx.global, '__kin_clear_timeout', clearTimeoutFn);
    setTimeoutFn.dispose();
    clearTimeoutFn.dispose();

    // Safe console.log capture
    const logFn = ctx.newFunction('__kin_log', (...args) => {
      const line = args.map((a) => {
        const d = ctx.dump(a);
        return typeof d === 'string' ? d : JSON.stringify(d);
      }).join(' ');
      if (logs.length < 200) logs.push(line);
    });
    ctx.setProp(ctx.global, '__kin_log', logFn);
    logFn.dispose();

    // Optional jailed fs host bindings for ToolEngine custom tools
    if (options.enableJailedFs && options.worktreeRoot) {
      const jailRoot = options.worktreeRoot;
      const fsReadFn = ctx.newFunction('__kin_fs_read', (pHandle, encHandle) => {
        const p = String(ctx.dump(pHandle) || '');
        const enc = ctx.dump(encHandle);
        const valid = validateJailedPathInSandbox(p, jailRoot);
        const content = fs.readFileSync(valid, (typeof enc === 'string' ? enc : 'utf-8') as BufferEncoding);
        return ctx.newString(String(content));
      });
      const fsWriteFn = ctx.newFunction('__kin_fs_write', (pHandle, dataHandle) => {
        const p = String(ctx.dump(pHandle) || '');
        const data = String(ctx.dump(dataHandle) ?? '');
        const valid = validateJailedPathInSandbox(p, jailRoot);
        fs.writeFileSync(valid, data, 'utf-8');
      });
      const fsExistsFn = ctx.newFunction('__kin_fs_exists', (pHandle) => {
        const p = String(ctx.dump(pHandle) || '');
        try {
          const valid = validateJailedPathInSandbox(p, jailRoot);
          return fs.existsSync(valid) ? ctx.true : ctx.false;
        } catch {
          return ctx.false;
        }
      });
      ctx.setProp(ctx.global, '__kin_fs_read', fsReadFn);
      ctx.setProp(ctx.global, '__kin_fs_write', fsWriteFn);
      ctx.setProp(ctx.global, '__kin_fs_exists', fsExistsFn);
      fsReadFn.dispose();
      fsWriteFn.dispose();
      fsExistsFn.dispose();
    }

    // Optional Programmatic Tool Calling (PTC) host bridge
    if (options.enableCallTool && options.onToolCall) {
      const callToolFn = ctx.newFunction('__kin_call_tool', (nameHandle, argsHandle) => {
        const toolName = String(ctx.dump(nameHandle) || '');
        const toolArgs = (ctx.dump(argsHandle) as Record<string, any>) || {};
        const deferred = ctx.newPromise();
        const cleanupCallDeferred = () => {
          pendingDeferreds.delete(cleanupCallDeferred);
          if (ctx.alive) {
            try {
              deferred.resolve(ctx.undefined);
              runtime.executePendingJobs();
            } catch {}
          }
        };
        pendingDeferreds.add(cleanupCallDeferred);

        const p = options.onToolCall!(toolName, toolArgs)
          .then((result) => {
            pendingDeferreds.delete(cleanupCallDeferred);
            if (!ctx.alive) return;
            const resHandle = marshalToQuickJS(ctx, result);
            deferred.resolve(resHandle);
            resHandle.dispose();
            runtime.executePendingJobs();
          })
          .catch((err) => {
            pendingDeferreds.delete(cleanupCallDeferred);
            if (!ctx.alive) return;
            const errHandle = ctx.newError(err?.message || String(err));
            deferred.reject(errHandle);
            errHandle.dispose();
            runtime.executePendingJobs();
          });

        pendingPromises.push(p);
        return deferred.handle;
      });
      ctx.setProp(ctx.global, '__kin_call_tool', callToolFn);
      callToolFn.dispose();
    }

    const bootstrap = `
      var console = {
        log: function() { __kin_log.apply(null, arguments); },
        info: function() { __kin_log.apply(null, arguments); },
        warn: function() { __kin_log.apply(null, arguments); },
        error: function() { __kin_log.apply(null, arguments); }
      };
      var params = __kin_params;
      var input = __kin_params;
      var context = __kin_context;
      var executionContext = __kin_context;
      var setTimeout = function(fn, ms) { return __kin_set_timeout(fn, ms); };
      var clearTimeout = function(id) { return __kin_clear_timeout(id); };
      Object.setPrototypeOf(setTimeout, null);
      Object.defineProperty(setTimeout, 'constructor', { value: undefined, writable: false, configurable: false });
      Object.setPrototypeOf(clearTimeout, null);
      Object.defineProperty(clearTimeout, 'constructor', { value: undefined, writable: false, configurable: false });
      var Buffer = {
        from: function(data) { return typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data || 0); },
        alloc: function(size) { return new Uint8Array(typeof size === 'number' ? size : 0); },
        isBuffer: function(obj) { return obj instanceof Uint8Array; },
        byteLength: function(str) { return typeof str === 'string' ? new TextEncoder().encode(str).length : (str && str.length ? str.length : 0); },
        concat: function(list) {
          var total = 0;
          for (var i = 0; i < list.length; i++) total += (list[i] && list[i].length) || 0;
          var out = new Uint8Array(total);
          var off = 0;
          for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].length) { out.set(list[i], off); off += list[i].length; }
          }
          return out;
        }
      };
      var __kin_disallowed_fn = function() { throw new Error('Code generation from strings disallowed'); };
      globalThis.eval = __kin_disallowed_fn;
      globalThis.Function = __kin_disallowed_fn;
      Object.defineProperty(Function.prototype, 'constructor', { value: __kin_disallowed_fn, writable: false, configurable: false });
      try { Object.defineProperty(Object.getPrototypeOf(async function(){}), 'constructor', { value: __kin_disallowed_fn, writable: false, configurable: false }); } catch (e) {}
      try { Object.defineProperty(Object.getPrototypeOf(function*(){}), 'constructor', { value: __kin_disallowed_fn, writable: false, configurable: false }); } catch (e) {}
      try { Object.defineProperty(Object.getPrototypeOf(async function*(){}), 'constructor', { value: __kin_disallowed_fn, writable: false, configurable: false }); } catch (e) {}
      Object.defineProperty(Object, 'constructor', { value: __kin_disallowed_fn, writable: false, configurable: false });
      var callTool = typeof __kin_call_tool === 'function'
        ? function(name, args) { return __kin_call_tool(name, args || {}); }
        : function() { throw new Error('callTool is not enabled in this sandbox'); };
      var fs = typeof __kin_fs_read === 'function'
        ? {
            readFileSync: function(p, enc) { return __kin_fs_read(p, enc || 'utf-8'); },
            writeFileSync: function(p, data) { return __kin_fs_write(p, data); },
            existsSync: function(p) { return __kin_fs_exists(p); }
          }
        : undefined;
      var path = {
        join: function() { return Array.prototype.slice.call(arguments).join('/').replace(/\\/+/g, '/'); },
        resolve: function() { return Array.prototype.slice.call(arguments).join('/').replace(/\\/+/g, '/'); },
        basename: function(p) { var parts = String(p || '').split(/[\\\\/]/); return parts[parts.length - 1] || ''; },
        dirname: function(p) { var parts = String(p || '').split(/[\\\\/]/); parts.pop(); return parts.join('/') || '.'; },
        extname: function(p) { var b = String(p || '').split(/[\\\\/]/).pop() || ''; var i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; }
      };
      var module = { exports: {} };
      var exports = module.exports;
      var __kin_done = false;
      var __kin_ok = false;
      var __kin_result = undefined;
      var __kin_error = undefined;

      Object.freeze(Object.prototype);
      Object.freeze(Array.prototype);
      Object.freeze(Function.prototype);

      Promise.resolve().then(async function() {
        ${options.handlerCode}
        var runFn =
          (typeof module.exports === 'function' ? module.exports : null) ||
          (module.exports && (module.exports.default || module.exports.run || module.exports.execute || module.exports.main)) ||
          (exports && (exports.default || exports.run || exports.execute || exports.main)) ||
          (typeof run === 'function' ? run : null) ||
          (typeof handler === 'function' ? handler : null) ||
          (typeof execute === 'function' ? execute : null) ||
          (typeof main === 'function' ? main : null);
        if (typeof runFn === 'function') {
          return await runFn(params, context);
        }
        return typeof result !== 'undefined' ? result : module.exports;
      }).then(function(val) {
        __kin_ok = true;
        __kin_result = val;
        __kin_done = true;
      }).catch(function(err) {
        __kin_ok = false;
        __kin_error = err && err.message ? String(err.message) : String(err);
        __kin_done = true;
      });
    `;

    const evalRes = ctx.evalCode(bootstrap, 'kin-sandbox.js');
    if (evalRes.error) {
      const errObj = ctx.dump(evalRes.error);
      evalRes.error.dispose();
      return {
        success: false,
        logs,
        error: errObj?.message || String(errObj),
      };
    }
    evalRes.value.dispose();

    // Pump microtasks and pending host PTC tool calls until completion or deadline
    while (true) {
      const jobRes = runtime.executePendingJobs();
      if (jobRes.error) {
        const errObj = ctx.dump(jobRes.error);
        jobRes.error.dispose();
        return { success: false, logs, error: errObj?.message || String(errObj) };
      }

      const doneHandle = ctx.getProp(ctx.global, '__kin_done');
      const isDone = Boolean(ctx.dump(doneHandle));
      doneHandle.dispose();
      if (isDone) break;

      if (Date.now() > deadline) {
        return { success: false, logs, error: `Execution timed out after ${timeoutMs}ms in QuickJS sandbox` };
      }

      if (pendingPromises.length > 0) {
        const current = pendingPromises.splice(0, pendingPromises.length);
        await Promise.race([
          Promise.allSettled(current),
          new Promise((r) => setTimeout(r, 25)),
        ]);
      } else {
        await new Promise((r) => setTimeout(r, 5));
      }
    }

    const okHandle = ctx.getProp(ctx.global, '__kin_ok');
    const ok = Boolean(ctx.dump(okHandle));
    okHandle.dispose();

    if (!ok) {
      const errHandle = ctx.getProp(ctx.global, '__kin_error');
      const rawErrMsg = String(ctx.dump(errHandle) || 'Unknown sandbox error');
      errHandle.dispose();
      const errMsg = rawErrMsg === 'interrupted' || Date.now() >= deadline
        ? `Execution timed out after ${timeoutMs}ms`
        : rawErrMsg;
      return { success: false, logs, error: errMsg };
    }

    const resHandle = ctx.getProp(ctx.global, '__kin_result');
    const output = ctx.dump(resHandle);
    resHandle.dispose();

    return { success: true, output, logs };
  } catch (err: any) {
    return {
      success: false,
      logs,
      error: err?.message || String(err),
    };
  } finally {
    for (const t of activeTimers.values()) {
      clearTimeout(t);
    }
    activeTimers.clear();
    for (const cb of timerCallbacks.values()) {
      try { cb.dispose(); } catch {}
    }
    timerCallbacks.clear();
    timerResolvers.clear();
    for (const settle of Array.from(pendingDeferreds)) {
      try { settle(); } catch {}
    }
    pendingDeferreds.clear();
    try { ctx.dispose(); } catch {}
    try { runtime.dispose(); } catch {}
  }
}

let cachedSeaWorkerPath: string | null = null;

function resolveWorkerScriptPath(): string | null {
  try {
    // Dynamically check node:sea without failing older bundlers
    const req = typeof require === 'function' ? require : undefined;
    if (req) {
      const sea = req('node:sea');
      if (sea && typeof sea.isSea === 'function' && sea.isSea()) {
        if (cachedSeaWorkerPath && fs.existsSync(cachedSeaWorkerPath)) {
          return cachedSeaWorkerPath;
        }
        const rawAsset = sea.getAsset('worker_quickjs.cjs');
        const outPath = path.join(os.tmpdir(), `kin-sea-worker-quickjs-${process.pid}.cjs`);
        fs.writeFileSync(outPath, Buffer.from(rawAsset));
        cachedSeaWorkerPath = outPath;
        return outPath;
      }
    }
  } catch {
    // Not running in SEA
  }

  // In Vitest (direct TS execution), avoid loading stale pre-built dist/ files
  if (process.env.VITEST === 'true') {
    return null;
  }

  const baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const candidates = [
    path.resolve(baseDir, 'worker_quickjs.js'),
    path.resolve(process.cwd(), 'core', 'dist', 'execution', 'worker_quickjs.js'),
    path.resolve(process.cwd(), 'core', 'dist', 'worker_quickjs.cjs'),
    path.resolve(process.cwd(), 'dist', 'execution', 'worker_quickjs.js'),
    path.resolve(process.cwd(), 'dist', 'worker_quickjs.cjs'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Runs handler code in a Worker Thread hosting QuickJS-WASM when a compiled/SEA
 * worker script is available, falling back to in-process QuickJS-WASM isolation
 * in direct TypeScript test runners.
 */
export async function runQuickJSWorker(options: QuickJSRunOptions): Promise<QuickJSRunResult> {
  const workerPath = resolveWorkerScriptPath();
  if (!workerPath) {
    return await runInQuickJS(options);
  }

  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 15000, 100), 60000);
  return await new Promise<QuickJSRunResult>((resolve) => {
    const worker = new Worker(workerPath, {
      workerData: {
        __kinQuickJsWorker: true,
        handlerCode: options.handlerCode,
        params: options.params || {},
        context: options.context || {},
        timeoutMs,
        maxMemoryMb: options.maxMemoryMb || 64,
        worktreeRoot: options.worktreeRoot,
        enableJailedFs: Boolean(options.enableJailedFs),
        enableCallTool: Boolean(options.enableCallTool),
      },
      resourceLimits: {
        maxOldGenerationSizeMb: Math.max(options.maxMemoryMb || 64, 64),
      },
    });

    let settled = false;
    const finish = (res: QuickJSRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    const timer = setTimeout(() => {
      try { worker.terminate(); } catch {}
      finish({ success: false, error: `QuickJS worker timed out after ${timeoutMs}ms` });
    }, timeoutMs + 1000);

    worker.on('message', async (msg: any) => {
      if (msg?.type === 'tool_call' && options.onToolCall) {
        try {
          const result = await options.onToolCall(msg.name, msg.args || {});
          worker.postMessage({ type: 'tool_result', id: msg.id, result });
        } catch (err: any) {
          worker.postMessage({ type: 'tool_result', id: msg.id, error: err?.message || String(err) });
        }
        return;
      }
      if (msg?.type === 'done') {
        finish(msg.result);
      }
    });

    worker.on('error', (err) => {
      finish({ success: false, error: err?.message || String(err) });
    });

    worker.on('exit', (code) => {
      if (!settled && code !== 0) {
        finish({ success: false, error: `QuickJS worker exited with code ${code}` });
      }
    });
  });
}

// Worker thread entrypoint (guard against non-KIN worker pools like Vitest tinypool)
if (!isMainThread && parentPort && workerData && workerData.__kinQuickJsWorker === true) {
  const pendingCalls = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();
  let nextCallId = 1;

  parentPort.on('message', (msg: any) => {
    if (msg?.type === 'tool_result' && pendingCalls.has(msg.id)) {
      const entry = pendingCalls.get(msg.id)!;
      pendingCalls.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(msg.result);
    }
  });

  const onToolCall = workerData.enableCallTool
    ? (name: string, args: Record<string, any>) =>
        new Promise<any>((resolve, reject) => {
          const id = nextCallId++;
          pendingCalls.set(id, { resolve, reject });
          parentPort!.postMessage({ type: 'tool_call', id, name, args });
        })
    : undefined;

  runInQuickJS({
    handlerCode: workerData.handlerCode,
    params: workerData.params,
    context: workerData.context,
    timeoutMs: workerData.timeoutMs,
    maxMemoryMb: workerData.maxMemoryMb,
    worktreeRoot: workerData.worktreeRoot,
    enableJailedFs: workerData.enableJailedFs,
    enableCallTool: workerData.enableCallTool,
    onToolCall,
  })
    .then((result) => {
      parentPort!.postMessage({ type: 'done', result });
    })
    .catch((err: any) => {
      parentPort!.postMessage({
        type: 'done',
        result: { success: false, error: err?.message || String(err) },
      });
    });
}
