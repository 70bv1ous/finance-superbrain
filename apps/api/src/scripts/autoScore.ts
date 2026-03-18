import { autoScorePredictions } from "../lib/autoScorePredictions.js";
import type { AutoScoreResponse } from "@finance-superbrain/schemas";
import { runTrackedScriptOperation } from "./runTrackedScriptOperation.js";

const result = await runTrackedScriptOperation<AutoScoreResponse>(
  {
    operation_name: "auto_score",
    metadata: {
      as_of: process.env.AUTO_SCORE_AS_OF ?? null,
      create_postmortems: process.env.AUTO_SCORE_CREATE_POSTMORTEMS !== "false",
    },
    summarize: (response) => ({
      processed: response.processed,
      errors: response.errors.length,
      lessons_created: response.items.filter((item) => item.lesson !== null).length,
    }),
    status_from_result: (response) => (response.errors.length ? "partial" : "success"),
  },
  (services) =>
    autoScorePredictions(services, {
      as_of: process.env.AUTO_SCORE_AS_OF,
      create_postmortems: process.env.AUTO_SCORE_CREATE_POSTMORTEMS !== "false",
    }),
);

console.log(
  JSON.stringify(
    {
      processed: result.processed,
      errors: result.errors.length,
    },
    null,
    2,
  ),
);
