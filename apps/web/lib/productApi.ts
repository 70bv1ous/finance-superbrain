import type {
  DashboardBenchmarkResponse,
  DashboardOperationalResponse,
  DashboardPipelineResponse,
  DashboardSummary,
} from "@finance-superbrain/schemas"

import { getJson } from "@/lib/apiClient"

export const getDashboardSummary = () =>
  getJson<DashboardSummary>("/v1/dashboard/summary")

export const getDashboardOperational = () =>
  getJson<DashboardOperationalResponse>("/v1/dashboard/operations")

export const getDashboardBenchmark = () =>
  getJson<DashboardBenchmarkResponse>("/v1/dashboard/benchmarks")

export const getDashboardPipeline = () =>
  getJson<DashboardPipelineResponse>("/v1/dashboard/pipeline")
