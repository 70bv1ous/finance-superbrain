# Claude Review Workflow

This workflow keeps Codex and Claude complementary instead of chaotic.

## Role split

- Codex: primary builder, integrator, and system-memory keeper
- Claude: independent reviewer, challenger, and alternative-strategy critic

Do not let both agents make uncontrolled overlapping edits at the same time.

## When to use Claude

Use Claude after a meaningful milestone, not after every tiny change.

Best review moments:

- a new benchmark or evolution feature lands
- a new historical-memory loader is added
- promotion, molting, or growth-pressure logic changes
- the operator workflow becomes more complex
- we are about to trust a new model family more heavily

## Standard handoff

1. Finish a milestone in Codex.
2. Generate a fresh review packet:
   - `npm run ops:claude-review-packet`
3. Open the generated file:
   - [CLAUDE_REVIEW_PACKET.md](C:\Users\rayan\OneDrive\Documents\Playground\trade-journal-site\CLAUDE_REVIEW_PACKET.md)
4. Paste the packet into Claude along with the prompt block included at the bottom.
5. Ask Claude to return:
   - findings first
   - architectural risks
   - hidden regressions
   - weak assumptions
   - highest-value next move
6. Bring Claude's feedback back to Codex for implementation, rejection, or synthesis.

## Recommended Claude ask

Ask Claude for:

- bugs or logic flaws
- benchmark leakage or false-confidence risks
- evaluation mistakes
- over-heuristic architecture
- missing test coverage
- safer alternatives

Avoid asking Claude to rewrite the whole system from scratch unless we are intentionally redesigning it.

## Packet generator

Command:

- `npm run ops:claude-review-packet`

Default output:

- [CLAUDE_REVIEW_PACKET.md](C:\Users\rayan\OneDrive\Documents\Playground\trade-journal-site\CLAUDE_REVIEW_PACKET.md)

Supported environment variables:

- `CLAUDE_REVIEW_BENCHMARK_PACK_ID`
- `CLAUDE_REVIEW_FOCUS`
- `CLAUDE_REVIEW_QUESTIONS`
- `CLAUDE_REVIEW_BASE_URL`
- `CLAUDE_REVIEW_SOURCE`
- `CLAUDE_REVIEW_OUTPUT`

Format notes:

- `CLAUDE_REVIEW_FOCUS` uses `|` separators
- `CLAUDE_REVIEW_QUESTIONS` uses `|` separators
- `CLAUDE_REVIEW_BASE_URL` lets the packet generator fall back to the live API if direct local-store reads are unavailable
- `CLAUDE_REVIEW_SOURCE=api` forces packet generation from the live API instead of the local repository
- `CLAUDE_REVIEW_OUTPUT` is relative to the repo root unless you provide an absolute path

Example:

```powershell
$env:CLAUDE_REVIEW_BENCHMARK_PACK_ID='core_benchmark_v1'
$env:CLAUDE_REVIEW_FOCUS='molt logic|benchmark safety|historical corpus quality'
$env:CLAUDE_REVIEW_QUESTIONS='Where are we overfitting?|What is the next highest-value move?'
npm run ops:claude-review-packet
```

## Operating rule

If Codex is the current builder, Claude should review the packet and challenge it.

If Claude proposes changes:

- do not apply them blindly
- bring them back into Codex
- let Codex integrate them into the existing architecture cleanly

That keeps the project coherent while still benefiting from a second strong model.
