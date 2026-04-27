type DemoAccessAccount = {
  id: string
  label: string
  role: string
  email: string
  password: string
}

const DEFAULT_ADMIN_EMAIL = "lead.operator@finance-superbrain.local"
const DEFAULT_ADMIN_PASSWORD = "workspace-admin-password"
const DEFAULT_ANALYST_EMAIL = "macro.analyst@finance-superbrain.local"
const DEFAULT_ANALYST_PASSWORD = "workspace-analyst-password"

export function isDemoModeEnabled() {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true"
}

export function getDemoAccessAccounts(): DemoAccessAccount[] {
  if (!isDemoModeEnabled()) {
    return []
  }

  return [
    {
      id: "lead-operator",
      label: "Lead operator",
      role: "Admin walkthrough account",
      email: process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL,
      password: process.env.NEXT_PUBLIC_DEMO_ADMIN_PASSWORD?.trim() || DEFAULT_ADMIN_PASSWORD,
    },
    {
      id: "macro-analyst",
      label: "Macro analyst",
      role: "Teammate handoff account",
      email: process.env.NEXT_PUBLIC_DEMO_ANALYST_EMAIL?.trim() || DEFAULT_ANALYST_EMAIL,
      password: process.env.NEXT_PUBLIC_DEMO_ANALYST_PASSWORD?.trim() || DEFAULT_ANALYST_PASSWORD,
    },
  ]
}

export function getDemoContactHref() {
  const contactHref = process.env.NEXT_PUBLIC_DEMO_CONTACT_URL?.trim()

  return contactHref || null
}
