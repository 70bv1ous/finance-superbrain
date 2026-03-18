import { describe, expect, it } from "vitest";

import { resolveOperationWorkerLoopInvocation } from "./operationWorkerLoopInvocation.js";

describe("operation worker loop invocation", () => {
  it("prefers the current runtime when execArgv is available", () => {
    const invocation = resolveOperationWorkerLoopInvocation({
      cwd: "C:\\repo\\apps\\api",
      exec_path: "node",
      exec_argv: ["--import", "tsx"],
      exists: () => false,
    });

    expect(invocation.mode).toBe("current_runtime");
    expect(invocation.command).toBe("node");
    expect(invocation.args.slice(0, 2)).toEqual(["--import", "tsx"]);
    expect(invocation.script_path).toContain("runOperationWorkerLoop.ts");
  });

  it("falls back to the local tsx binary before npm scripts", () => {
    const invocation = resolveOperationWorkerLoopInvocation({
      cwd: "C:\\repo\\apps\\api",
      platform: "win32",
      exec_argv: [],
      exists: (path) => path.endsWith("node_modules\\.bin\\tsx.cmd"),
    });

    expect(invocation.mode).toBe("tsx_binary");
    expect(invocation.command.endsWith("node_modules\\.bin\\tsx.cmd")).toBe(true);
    expect(invocation.args).toHaveLength(1);
  });

  it("prefers compiled sibling scripts before npm fallback in plain node runtime", () => {
    const invocation = resolveOperationWorkerLoopInvocation({
      cwd: "C:\\repo\\apps\\api",
      exec_path: "node",
      exec_argv: [],
      runtime_script_extension: ".js",
      exists: (path) => path.endsWith("runOperationWorkerLoop.js"),
    });

    expect(invocation.mode).toBe("compiled_runtime");
    expect(invocation.command).toBe("node");
    expect(invocation.script_path.endsWith("runOperationWorkerLoop.js")).toBe(true);
    expect(invocation.args).toEqual([invocation.script_path]);
  });
});
