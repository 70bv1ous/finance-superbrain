import { z } from "zod";

export const guidedDemoPromptCategorySchema = z.enum([
  "macro_rates",
  "policy_geopolitics",
  "earnings_company",
  "portfolio_follow_through",
]);

export const guidedDemoExpectedAssetSchema = z.object({
  ticker: z.string().min(1),
  direction: z.enum(["up", "down", "mixed"]).optional(),
});

export const guidedDemoPromptExpectationSchema = z.object({
  required_themes: z.array(z.string().min(1)).default([]),
  expected_assets: z.array(guidedDemoExpectedAssetSchema).default([]),
  min_evidence_points: z.number().int().min(0).default(2),
  requires_limits: z.boolean().default(true),
  requires_risks: z.boolean().default(true),
});

export const guidedDemoPromptSchema = z.object({
  id: z.string().min(1),
  category: guidedDemoPromptCategorySchema,
  label: z.string().min(1),
  prompt: z.string().min(1),
  proof_goal: z.string().min(1),
  expectation: guidedDemoPromptExpectationSchema,
});

export const guidedDemoRouteTargetSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

export const guidedDemoManifestStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["route", "prompt"]),
  title: z.string().min(1),
  description: z.string().min(1),
  proof_purpose: z.string().min(1),
  route: guidedDemoRouteTargetSchema,
  prompt_id: z.string().min(1).nullable().optional(),
  handoff: guidedDemoRouteTargetSchema.nullable().optional(),
  proof_signals: z.array(z.string().min(1)).default([]),
});

export const chatAffectedAssetSchema = z.object({
  ticker: z.string().min(1),
  direction: z.enum(["up", "down", "mixed"]),
  rationale: z.string().min(1),
});

export const chatProofResponseSchema = z.object({
  answer: z.string().min(1),
  event_type: z.enum(["cpi", "fomc", "nfp", "earnings", "energy", "credit", "policy_fx", "general"]),
  confidence_level: z.enum(["high", "medium", "low"]),
  evidence: z.array(z.string().min(1)),
  limits: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)),
  affected_assets: z.array(chatAffectedAssetSchema).default([]),
  analogue_support_summary: z.string().nullable().optional(),
  memory_support_summary: z.string().nullable().optional(),
  analogues_referenced: z.number().int().min(0),
  session_id: z.string().min(1),
  cached: z.boolean().optional(),
});

export const GUIDED_DEMO_PROMPTS = [
  {
    id: "macro-hot-cpi",
    category: "macro_rates",
    label: "Hot CPI cross-asset reaction",
    prompt: "CPI printed 0.4% month-on-month versus 0.3% expected. What is the clean cross-asset reaction path for equities, bonds, and the dollar?",
    proof_goal: "Shows cross-asset macro reasoning and explicit invalidation conditions.",
    expectation: {
      required_themes: ["inflation", "rates"],
      expected_assets: [
        { ticker: "TLT", direction: "down" },
        { ticker: "DXY", direction: "up" },
      ],
      min_evidence_points: 2,
      requires_limits: true,
      requires_risks: true,
    },
  },
  {
    id: "macro-dovish-fed",
    category: "macro_rates",
    label: "Dovish Fed with growth anxiety",
    prompt: "The Fed held rates but signaled two cuts next year while also acknowledging weaker growth. How should I frame the reaction across duration, growth equities, and gold?",
    proof_goal: "Shows nuanced macro reasoning instead of a one-line risk-on answer.",
    expectation: {
      required_themes: ["central_bank", "growth_slowdown"],
      expected_assets: [
        { ticker: "TLT", direction: "up" },
        { ticker: "GLD", direction: "up" },
      ],
      min_evidence_points: 2,
      requires_limits: true,
      requires_risks: true,
    },
  },
  {
    id: "policy-tariff-escalation",
    category: "policy_geopolitics",
    label: "Tariff escalation into China risk",
    prompt: "Tariff rhetoric on China just escalated again. What is the most defensible market read-through for China tech, FX, and broader risk sentiment?",
    proof_goal: "Shows policy-to-asset mapping and retrieval-backed caution.",
    expectation: {
      required_themes: ["trade_policy", "china_risk"],
      expected_assets: [
        { ticker: "KWEB", direction: "down" },
        { ticker: "USD/CNH", direction: "up" },
      ],
      min_evidence_points: 2,
      requires_limits: true,
      requires_risks: true,
    },
  },
  {
    id: "policy-energy-shock",
    category: "policy_geopolitics",
    label: "Geopolitical oil shock",
    prompt: "A Middle East supply disruption is pushing crude sharply higher. How should the desk think about the inflation spillover and first-order equity winners and losers?",
    proof_goal: "Shows second-order macro spillover rather than just naming oil up.",
    expectation: {
      required_themes: ["energy", "inflation"],
      expected_assets: [
        { ticker: "USO", direction: "up" },
        { ticker: "XLE", direction: "up" },
      ],
      min_evidence_points: 2,
      requires_limits: true,
      requires_risks: true,
    },
  },
  {
    id: "earnings-guidance-cut",
    category: "earnings_company",
    label: "Guidance cut with read-through risk",
    prompt: "A consumer company beat the quarter but cut forward guidance and cited weaker traffic. What is the right way to think about the stock reaction versus the broader sector read-through?",
    proof_goal: "Shows company-specific reasoning and avoids headline-only earnings takes.",
    expectation: {
      required_themes: ["guidance", "consumer_weakness"],
      expected_assets: [],
      min_evidence_points: 2,
      requires_limits: true,
      requires_risks: true,
    },
  },
  {
    id: "earnings-ai-capex",
    category: "earnings_company",
    label: "AI capex upside versus crowded positioning",
    prompt: "A mega-cap tech name guided AI capex higher and reinforced demand, but positioning is already crowded. What is the bullish case, and what keeps the answer from being too confident?",
    proof_goal: "Shows balanced bullish reasoning with explicit overconfidence control.",
    expectation: {
      required_themes: ["ai_capex", "positioning"],
      expected_assets: [],
      min_evidence_points: 2,
      requires_limits: true,
      requires_risks: true,
    },
  },
  {
    id: "portfolio-trim-or-watch",
    category: "portfolio_follow_through",
    label: "Trim versus move to watching",
    prompt: "We already have a cyclical reflation thesis active, but transport breadth is weakening while rates are easing. Should the desk keep it active, move it to watching, or trim the posture?",
    proof_goal: "Shows portfolio follow-through logic and explicit invalidation framing.",
    expectation: {
      required_themes: ["cyclical", "breadth"],
      expected_assets: [],
      min_evidence_points: 2,
      requires_limits: true,
      requires_risks: true,
    },
  },
  {
    id: "portfolio-close-discipline",
    category: "portfolio_follow_through",
    label: "When to close a thesis",
    prompt: "A watching thesis has gone stale, the confirming catalyst never arrived, and newer evidence is mixed. What would justify closing it instead of letting it linger?",
    proof_goal: "Shows disciplined closure logic instead of endless vague monitoring.",
    expectation: {
      required_themes: ["review_discipline"],
      expected_assets: [],
      min_evidence_points: 2,
      requires_limits: true,
      requires_risks: true,
    },
  },
] as const satisfies readonly z.infer<typeof guidedDemoPromptSchema>[];

export const GUIDED_DEMO_PROMPT_CATEGORIES = {
  macro_rates: {
    label: "Macro / Rates",
    description: "Cross-asset inflation, Fed, bond, and dollar reasoning.",
  },
  policy_geopolitics: {
    label: "Policy / Geopolitics",
    description: "Trade, sanctions, FX, and commodity shock mapping.",
  },
  earnings_company: {
    label: "Earnings / Company",
    description: "Company-specific read-through with sector and positioning nuance.",
  },
  portfolio_follow_through: {
    label: "Portfolio / Follow-through",
    description: "Active, watching, trim, and close discipline under uncertainty.",
  },
} as const;

export const GUIDED_DEMO_PROOF_IDS = {
  investigation_id: "demo-investigation-cpi-discipline",
  studio_run_id: "demo-studio-run-cpi-discipline",
  decision_brief_id: "demo-decision-cpi-discipline",
  portfolio_candidate_id: "demo-portfolio-cpi-discipline",
  portfolio_review_session_id: "demo-review-session-cpi-discipline",
} as const;

export const GUIDED_DEMO_MANIFEST = [
  {
    id: "public-shell",
    kind: "route",
    title: "Start on the public shell",
    description: "Frame the platform as an intelligence system, not as a generic chatbot or portfolio toy.",
    proof_purpose: "Shows the product thesis, the research-to-memory loop, and why the workspace exists.",
    route: {
      label: "Open public shell",
      href: "/",
    },
    handoff: {
      label: "Open workspace home",
      href: "/workspace",
    },
    proof_signals: [
      "Clear system loop from ingest to learning",
      "Honest internal-alpha trust framing",
      "Direct path into guided workspace proof",
    ],
  },
  {
    id: "workspace-home",
    kind: "route",
    title: "Open the command center",
    description: "Use the workspace home as the launch point for the guided proof, not as a passive dashboard screenshot.",
    proof_purpose: "Shows shared continuity, portfolio pressure, decision cadence, and the evidence desk entry point.",
    route: {
      label: "Open workspace home",
      href: "/workspace",
    },
    handoff: {
      label: "Jump to the evidence desk",
      href: "/workspace#intelligence-proof",
    },
    proof_signals: [
      "Shared operating objects are visible immediately",
      "The chat proof path is easy to launch",
      "Decision and portfolio follow-through are already linked into the home surface",
    ],
  },
  {
    id: "prompt-macro-hot-cpi",
    kind: "prompt",
    title: "Run the macro proof prompt",
    description: "Lead with the macro cross-asset question because it quickly proves whether the system can reason beyond one-line market takes.",
    proof_purpose: "Shows bottom line, cross-asset map, explicit limits, and a clean handoff into the seeded decision brief.",
    route: {
      label: "Run in evidence desk",
      href: "/workspace#intelligence-proof",
    },
    prompt_id: "macro-hot-cpi",
    handoff: {
      label: "Open seeded decision brief",
      href: `/decisions/${GUIDED_DEMO_PROOF_IDS.decision_brief_id}`,
    },
    proof_signals: [
      "Bottom line appears before prose sprawl",
      "Affected assets show a coherent rates, dollar, and equities transmission path",
      "Limits and risks stay visible instead of hidden in caveats",
    ],
  },
  {
    id: "prompt-policy-tariff-escalation",
    kind: "prompt",
    title: "Run the policy and retrieval proof",
    description: "Use the policy prompt to show the system can stay cautious while still mapping the event into assets and themes.",
    proof_purpose: "Shows retrieval-backed caution and a handoff into the memory desk, where prior lessons and completed investigations stay visible.",
    route: {
      label: "Run policy prompt",
      href: "/workspace#intelligence-proof",
    },
    prompt_id: "policy-tariff-escalation",
    handoff: {
      label: "Open seeded library memory",
      href: `/library?focus=${GUIDED_DEMO_PROOF_IDS.investigation_id}`,
    },
    proof_signals: [
      "Policy-to-asset mapping stays disciplined",
      "The system does not overclaim when the regime is noisy",
      "Memory and retrieval stay connected to the same operating trail",
    ],
  },
  {
    id: "prompt-portfolio-trim-or-watch",
    kind: "prompt",
    title: "Run the portfolio follow-through prompt",
    description: "Close the chat proof with portfolio discipline so the walkthrough lands in operational follow-through, not only analysis.",
    proof_purpose: "Shows that the answer format can support an explicit portfolio posture decision and then hand off into the seeded candidate.",
    route: {
      label: "Run portfolio prompt",
      href: "/workspace#intelligence-proof",
    },
    prompt_id: "portfolio-trim-or-watch",
    handoff: {
      label: "Open seeded portfolio candidate",
      href: `/portfolio/${GUIDED_DEMO_PROOF_IDS.portfolio_candidate_id}`,
    },
    proof_signals: [
      "The answer distinguishes active, watching, and trim logic",
      "Risks and invalidations stay visible",
      "The next operating surface is one click away",
    ],
  },
  {
    id: "decision-follow-through",
    kind: "route",
    title: "Open the seeded decision brief",
    description: "Show the thesis, ownership, cadence, and checkpoint history that turn research into an explicit operating object.",
    proof_purpose: "Demonstrates that research does not disappear after the answer. It becomes a durable decision object with review discipline.",
    route: {
      label: "Open seeded decision brief",
      href: `/decisions/${GUIDED_DEMO_PROOF_IDS.decision_brief_id}`,
    },
    handoff: {
      label: "Open seeded portfolio candidate",
      href: `/portfolio/${GUIDED_DEMO_PROOF_IDS.portfolio_candidate_id}`,
    },
    proof_signals: [
      "Ownership and cadence are durable",
      "Checkpoints keep the thesis legible over time",
      "Promotion into portfolio is linked, not reconstructed from memory",
    ],
  },
  {
    id: "portfolio-follow-through",
    kind: "route",
    title: "Open the seeded portfolio candidate",
    description: "Use the candidate operating page to show posture, checkpoint history, and review-session continuity.",
    proof_purpose: "Demonstrates manual-first portfolio follow-through with explicit posture, rebalance context, and review discipline.",
    route: {
      label: "Open seeded portfolio candidate",
      href: `/portfolio/${GUIDED_DEMO_PROOF_IDS.portfolio_candidate_id}`,
    },
    handoff: {
      label: "Open library memory",
      href: `/library?focus=${GUIDED_DEMO_PROOF_IDS.investigation_id}`,
    },
    proof_signals: [
      "Posture is editable without fake quantitative math",
      "Checkpoint history keeps the follow-through trail visible",
      "Portfolio review context ties back to the original thesis",
    ],
  },
  {
    id: "memory-and-audit",
    kind: "route",
    title: "Finish on memory and audit",
    description: "Close the walkthrough by proving the work survives as retrieval context and audit history, then export it to Obsidian.",
    proof_purpose: "Shows that the system keeps lessons, activity, and route-linked memory after the live walkthrough ends.",
    route: {
      label: "Open library memory",
      href: `/library?focus=${GUIDED_DEMO_PROOF_IDS.investigation_id}`,
    },
    handoff: {
      label: "Open settings and audit trail",
      href: "/settings",
    },
    proof_signals: [
      "Lessons stay connected to shared investigations and operating objects",
      "Audit activity remains readable and linkable",
      "The Obsidian export can turn the same state into a visible second brain",
    ],
  },
] as const satisfies readonly z.infer<typeof guidedDemoManifestStepSchema>[];

export const GUIDED_DEMO_PROMPT_ORDER = GUIDED_DEMO_MANIFEST.reduce<string[]>((steps, step) => {
  if (step.kind === "prompt" && typeof step.prompt_id === "string" && step.prompt_id.length > 0) {
    steps.push(step.prompt_id);
  }

  return steps;
}, []);

export function getGuidedDemoPromptById(promptId: string | null | undefined) {
  if (!promptId) {
    return null;
  }

  return GUIDED_DEMO_PROMPTS.find((prompt) => prompt.id === promptId) ?? null;
}

export function getGuidedDemoPromptByText(query: string | null | undefined) {
  if (!query) {
    return null;
  }

  return GUIDED_DEMO_PROMPTS.find((prompt) => prompt.prompt === query) ?? null;
}

export function getGuidedDemoManifestStepByPromptId(promptId: string | null | undefined) {
  if (!promptId) {
    return null;
  }

  return GUIDED_DEMO_MANIFEST.find((step) => step.kind === "prompt" && step.prompt_id === promptId) ?? null;
}

export function getGuidedDemoManifestStepByPromptText(query: string | null | undefined) {
  const prompt = getGuidedDemoPromptByText(query);
  return getGuidedDemoManifestStepByPromptId(prompt?.id);
}

export type GuidedDemoPromptCategory = z.infer<typeof guidedDemoPromptCategorySchema>;
export type GuidedDemoExpectedAsset = z.infer<typeof guidedDemoExpectedAssetSchema>;
export type GuidedDemoPromptExpectation = z.infer<typeof guidedDemoPromptExpectationSchema>;
export type GuidedDemoPrompt = z.infer<typeof guidedDemoPromptSchema>;
export type GuidedDemoRouteTarget = z.infer<typeof guidedDemoRouteTargetSchema>;
export type GuidedDemoManifestStep = z.infer<typeof guidedDemoManifestStepSchema>;
export type ChatAffectedAsset = z.infer<typeof chatAffectedAssetSchema>;
export type ChatProofResponse = z.infer<typeof chatProofResponseSchema>;
