# Finance Superbrain Claude Code Notes

This repository uses Codex GPT-5.5 as the primary implementation agent.

Claude Code is welcome as a reviewer, planner, and second-opinion agent, but should not edit files unless the user explicitly asks for Claude to take over implementation.

Default role for Claude Code:

- Review architecture, product flow, UI clarity, and risk.
- Identify bugs, deployment risks, missing tests, and confusing demo states.
- Prefer read-only analysis and concrete recommendations.
- Do not run destructive git commands.
- Do not delete Railway, Vercel, database, or Obsidian resources.
- Do not expose secrets, tokens, database URLs, cookies, or env values.
- Keep one coding agent actively editing at a time.

Recommended workflow:

1. Codex GPT-5.5 implements changes.
2. Tests and smoke checks run.
3. Claude Code reviews the diff or asks clarifying questions.
4. Codex applies selected fixes.
5. Important lessons are captured in README or Obsidian memory.

High-risk areas:

- auth and session cookies
- database migrations
- Railway/Vercel deployment
- Obsidian import/export safety
- investor-demo public surfaces
- portfolio/decision lifecycle state

