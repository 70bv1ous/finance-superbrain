import { createRequire } from "node:module"
import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"

const require = createRequire(import.meta.url)
const NEXT_DIR = join(process.cwd(), ".next")
const NEXT_CLI = require.resolve("next/dist/bin/next")
const RETRYABLE_CODES = new Set(["EPERM", "EBUSY", "ENOTEMPTY"])

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function removeNextDirWithRetry() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(NEXT_DIR, { recursive: true, force: true })
      return
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null

      if (!RETRYABLE_CODES.has(String(code)) || attempt === 5) {
        throw error
      }

      await delay(250 * (attempt + 1))
    }
  }
}

async function run() {
  await removeNextDirWithRetry()

  const child = spawn(process.execPath, [NEXT_CLI, "build", "--webpack"], {
    stdio: "inherit",
    shell: false,
  })

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 1)
  })
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
