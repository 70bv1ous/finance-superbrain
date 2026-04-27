/**
 * Quick unit test for the evaluation harness scorer.
 * Run: npx tsx src/scripts/testScorer.ts
 */
import { scorePrediction } from "../lib/evaluationHarness.js";

const base = {
  oracle_case_id: "x",
  domain: "geo",
  eval_split: "test" as const,
  confidence_level: "medium" as const,
  predicted_tickers: [],
  oracle_realized_moves: null,
  direction_accuracy: null,
  is_correct: null,
  is_scored: false,
};

const tests: Array<[string, "up"|"down"|"mixed"|"unknown", Array<{ticker:string;realized_direction:"up"|"down"|"mixed"|"unknown"}>, number, boolean]> = [
  ["up vs 2up+1down (Israel-Iran — oracle=up)",   "up",      [{ticker:"GLD",realized_direction:"up"},{ticker:"USO",realized_direction:"up"},{ticker:"SPY",realized_direction:"down"}], 1.0, true],
  ["mixed vs 50/50 oracle (mixed vs mixed)",       "mixed",   [{ticker:"TLT",realized_direction:"up"},{ticker:"SPY",realized_direction:"down"}],                                         1.0, true],
  ["up vs all-down oracle (clear miss)",           "up",      [{ticker:"TLT",realized_direction:"down"},{ticker:"SPY",realized_direction:"down"}],                                       0.0, false],
  ["mixed vs all-up oracle (partial credit)",      "mixed",   [{ticker:"QQQ",realized_direction:"up"},{ticker:"TLT",realized_direction:"up"}],                                           0.5, true],
  ["down vs all-down oracle (correct)",            "down",    [{ticker:"TLT",realized_direction:"down"},{ticker:"DXY",realized_direction:"down"}],                                       1.0, true],
  ["unknown — no signal should score 0",           "unknown", [{ticker:"GLD",realized_direction:"up"}],                                                                                 0.0, false],
  ["up vs all-up oracle (clean correct)",          "up",      [{ticker:"QQQ",realized_direction:"up"},{ticker:"SPY",realized_direction:"up"},{ticker:"TLT",realized_direction:"up"}],    1.0, true],
  ["down vs up oracle (directional conflict)",     "down",    [{ticker:"QQQ",realized_direction:"up"},{ticker:"SPY",realized_direction:"up"}],                                           0.0, false],
];

let passed = 0;
let failed = 0;

for (const [name, predDir, oracle, expAcc, expCorrect] of tests) {
  const pred = { ...base, id: name, predicted_direction: predDir };
  const scored = scorePrediction(pred as any, oracle as any);
  const ok = scored.direction_accuracy === expAcc && scored.is_correct === expCorrect;
  const marker = ok ? "PASS" : "FAIL";
  console.log(`${marker}  ${name}`);
  if (!ok) {
    console.log(`       got acc=${scored.direction_accuracy} correct=${scored.is_correct}  expected acc=${expAcc} correct=${expCorrect}`);
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n${passed}/${tests.length} passed${failed > 0 ? `  (${failed} FAILED)` : " ✓"}`);
process.exit(failed > 0 ? 1 : 0);
