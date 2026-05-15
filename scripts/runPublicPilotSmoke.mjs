import { spawn } from "node:child_process";

const projectRoot = process.cwd();
const npmCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
const forwardedArgs = process.argv.slice(2);

const DEFAULT_PUBLIC_PILOT_WEB_URL = "https://finance-superbrain-web.vercel.app";
const DEFAULT_PUBLIC_PILOT_API_URL = "https://sincere-smile-production-9c3f.up.railway.app";

function spawnNpm(args, env) {
  const spawnArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...args] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, spawnArgs, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`npm ${args.join(" ")} exited with code ${code ?? "null"} signal ${signal ?? "-"}`));
    });
  });
}

function withHostedDefaults() {
  return {
    ...process.env,
    PUBLIC_PILOT_WEB_URL: process.env.PUBLIC_PILOT_WEB_URL?.trim() || DEFAULT_PUBLIC_PILOT_WEB_URL,
    PUBLIC_PILOT_API_URL:
      process.env.PUBLIC_PILOT_API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim() || DEFAULT_PUBLIC_PILOT_API_URL,
  };
}

async function main() {
  const env = withHostedDefaults();

  console.log("Hosted public pilot smoke wrapper");
  console.log(`Web: ${env.PUBLIC_PILOT_WEB_URL}`);
  console.log(`API: ${env.PUBLIC_PILOT_API_URL}`);

  await spawnNpm(["run", "demo:public-pilot:smoke", "--", ...forwardedArgs], env);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
