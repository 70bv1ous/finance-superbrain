# Claude Review Packet

Generated at: 2026-03-13T13:20:39.455Z
Benchmark pack: core_benchmark_v1

## Mission
This packet is meant to hand the current Finance Superbrain state to Claude for independent review.
Codex remains the primary builder and integrator. Claude is being used as the second-brain reviewer and architectural challenger.

## Current System State
- Historical library: 47 cases (47 reviewed, 0 high confidence, 0 draft)
- Model leaderboard leaders: score core-corpus-loader-v1, direction core-corpus-loader-v1, calibration core-corpus-loader-v1
- Lineage: 1 family/families, 1 active family/families, 0 recent molt node(s)
- Latest benchmark snapshot: 2026-03-13T09:55:17.332Z, 1 family/families, 20 selected case(s)
- Evolution schedule: enabled true, benchmark pack core_benchmark_v1, next molt 2026-03-13T13:20:39.441Z

## Current Intelligence Loop
- Source intake accepts manual notes, historical library imports, feeds, transcripts, and live webhook/session chunks.
- The parser converts raw finance text into a structured event with themes, regions, candidate assets, and source classification.
- Prediction generation applies the current model family/profile, analog retrieval, and confidence shaping to produce market-impact theses.
- Realized outcomes are scored later, then post-mortems and lessons are written back into memory with calibration signals.
- Stored lessons, analogs, benchmark history, and calibration summaries are reused when future predictions and reviews are generated.

## Current Evolution Loop
- Mixed benchmark snapshots run against core_benchmark_v1 so each family is graded on the same cross-domain finance pack.
- Weekly stability and regression reports turn repeated benchmark weakness into measurable growth pressure instead of one-off noise.
- Growth-pressure policies can trigger diagnostics automatically and prepare candidate shells, but shell generation remains governed.
- Replay tuning, promotion gates, and stability-aware hardening decide whether a soft shell survives into an active shell.
- Lineage snapshots and the evolution schedule preserve ancestry, cadence, and whether each family is actually compounding edge over time.

## Benchmark Stability
- No benchmark stability families yet.

## Regressions
- core-brain: high regression, streak undefined, score delta -0.03, wrong-rate delta 0.15

## Growth Pressure
- core-brain: high pressure, persistence 1, planned action none

## Library Gaps
- No high-confidence cases exist yet: The library has reviewed cases, but none are marked high confidence, which weakens the strongest benchmark path.

## Top Models
- core-corpus-loader-v1: avg score 0.61, direction 0.52, calibration gap 0.15

## Known Heuristics / Known Weaknesses
- Event parsing and prediction shaping are still partly heuristic and profile-biased rather than fully learned from a large supervised corpus.
- Benchmark trust still depends on corpus depth and review quality. Current top gap: No high-confidence cases exist yet (The library has reviewed cases, but none are marked high confidence, which weakens the strongest benchmark path.).
- Benchmark history exists, but long-horizon validation is still shallow: the latest checkpoint used 20 selected cases.
- Walk-forward validation and live production-grade performance checks are not implemented yet, so replay success is not the same as live robustness.
- Local repository access can be flaky in pglite mode, so the Claude packet generator may rely on live API fallback and a fresh running server.
- The current UI is still an operator console. The polished user-facing finance assistant, personalization layer, and full voice product are not built yet.

## Git Context
- Branch: unknown
- ?? ../get-shit-done/
- ?? ../skills/
- ?? ./

## Changed Files To Inspect First
- ../get-shit-done/
- ../skills/
- ./

## Review Questions
- Where is the current architecture still too heuristic or brittle?
- Which failure modes in benchmarking, molting, or promotion are most dangerous right now?
- What design changes would most improve robustness before we scale the corpus further?

## Prompt To Paste Into Claude

```text
You are acting as the independent reviewer for a finance AI system called Finance Superbrain. Review the packet below with focus on: architecture risks in the finance superbrain core; benchmark and evolution logic that could create false confidence; highest-value next move to improve edge safely. Return findings first, ordered by severity. Prioritize bugs, architecture risks, unsafe evaluation logic, hidden regressions, weak assumptions, and missing tests. After findings, answer the explicit review questions briefly.

Use the packet below as the primary review context.
```
