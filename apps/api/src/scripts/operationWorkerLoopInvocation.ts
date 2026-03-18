import { existsSync } from "node:fs";
import { dirname, extname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type OperationWorkerLoopInvocation = {
  command: string;
  args: string[];
  mode: "current_runtime" | "compiled_runtime" | "tsx_binary" | "npm_script";
  script_path: string;
};

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const invocationModulePath = fileURLToPath(import.meta.url);
const defaultRuntimeScriptExtension = extname(invocationModulePath) === ".js" ? ".js" : ".ts";

const findNearestBinary = (
  cwd: string,
  binaryName: string,
  exists: (path: string) => boolean,
) => {
  let current = resolve(cwd);

  while (true) {
    const candidate = join(current, "node_modules", ".bin", binaryName);

    if (exists(candidate)) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current || parent === parse(current).root) {
      const rootCandidate = join(parent, "node_modules", ".bin", binaryName);
      return exists(rootCandidate) ? rootCandidate : null;
    }

    current = parent;
  }
};

export const resolveOperationWorkerLoopInvocation = (options: {
  cwd?: string;
  platform?: NodeJS.Platform;
  exec_path?: string;
  exec_argv?: string[];
  runtime_script_extension?: ".ts" | ".js";
  exists?: (path: string) => boolean;
} = {}): OperationWorkerLoopInvocation => {
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const execPath = options.exec_path ?? process.execPath;
  const execArgv = options.exec_argv ?? process.execArgv;
  const runtimeScriptExtension =
    options.runtime_script_extension ?? defaultRuntimeScriptExtension;
  const exists = options.exists ?? existsSync;
  const workerLoopScriptPath = fileURLToPath(
    new URL(`./runOperationWorkerLoop${runtimeScriptExtension}`, import.meta.url),
  );

  if (execArgv.length > 0) {
    return {
      command: execPath,
      args: [...execArgv, workerLoopScriptPath],
      mode: "current_runtime",
      script_path: workerLoopScriptPath,
    };
  }

  if (runtimeScriptExtension === ".js" && exists(workerLoopScriptPath)) {
    return {
      command: execPath,
      args: [workerLoopScriptPath],
      mode: "compiled_runtime",
      script_path: workerLoopScriptPath,
    };
  }

  const binaryName = platform === "win32" ? "tsx.cmd" : "tsx";
  const tsxBinary = findNearestBinary(cwd, binaryName, exists);

  if (tsxBinary) {
    return {
      command: tsxBinary,
      args: [workerLoopScriptPath],
      mode: "tsx_binary",
      script_path: workerLoopScriptPath,
    };
  }

  return {
    command: platform === "win32" ? "npm.cmd" : npmCommand,
    args: ["run", "ops:worker-loop"],
    mode: "npm_script",
    script_path: workerLoopScriptPath,
  };
};
