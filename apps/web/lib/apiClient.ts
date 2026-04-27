function getRuntimeApiUrlFromMeta() {
  if (typeof document === "undefined") {
    return null
  }

  const content = document
    .querySelector('meta[name="finance-superbrain-api-url"]')
    ?.getAttribute("content")
    ?.trim()

  return content || null
}

export function resolveApiBaseUrl(options?: {
  browserOrigin?: string | null
  env?: Record<string, string | undefined>
  runtimeApiUrl?: string | null
}) {
  const env = options?.env ?? process.env
  const browserOrigin = options?.browserOrigin ?? (typeof window !== "undefined" ? window.location.origin : null)

  if (browserOrigin) {
    const url = new URL(browserOrigin)
    const runtimeApiUrl = options?.runtimeApiUrl ?? getRuntimeApiUrlFromMeta()

    if (runtimeApiUrl) {
      return runtimeApiUrl
    }

    return `${url.protocol}//${url.hostname}:3001`
  }

  return env.API_URL ?? env.INTERNAL_API_URL ?? env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
}

type ApiIssue = {
  path?: string
  message?: string
}

type ApiError = {
  message?: string
  issues?: ApiIssue[]
}

async function getErrorMessage(response: Response) {
  const payload = (await response.json().catch(() => null)) as ApiError | null

  if (payload?.issues?.length) {
    return payload.issues
      .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
      .filter(Boolean)
      .join(" | ")
  }

  return payload?.message ?? "Request failed"
}

export async function getJson<TResponse>(path: string): Promise<TResponse | null> {
  try {
    const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
      credentials: "include",
    })

    if (!response.ok) {
      return null
    }

    return response.json() as Promise<TResponse>
  } catch {
    return null
  }
}

export async function getJsonOrThrow<TResponse>(path: string): Promise<TResponse> {
  const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
    credentials: "include",
  })

  if (!response.ok) {
    throw new Error(await getErrorMessage(response))
  }

  return response.json() as Promise<TResponse>
}

export async function postJsonOrThrow<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await getErrorMessage(response))
  }

  return response.json() as Promise<TResponse>
}
