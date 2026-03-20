import { coreHistoricalCorpusIngestionResponseSchema } from "@finance-superbrain/schemas";
import type {
  CoreHistoricalCorpusIngestionRequest,
  CoreHistoricalCorpusIngestionResponse,
  HistoricalCaseLibraryDraft,
} from "@finance-superbrain/schemas";

import { CHINA_HISTORICAL_LOADER_CASES } from "../data/chinaHistoricalLoaderCases.js";
import { COMMODITIES_HISTORICAL_LOADER_CASES } from "../data/commoditiesHistoricalLoaderCases.js";
import { CREDIT_HISTORICAL_LOADER_CASES } from "../data/creditHistoricalLoaderCases.js";
import { CRYPTO_HISTORICAL_LOADER_CASES } from "../data/cryptoHistoricalLoaderCases.js";
import { EARNINGS_HISTORICAL_LOADER_CASES } from "../data/earningsHistoricalLoaderCases.js";
import { ENERGY_HISTORICAL_LOADER_CASES } from "../data/energyHistoricalLoaderCases.js";
import { GEOPOLITICAL_HISTORICAL_LOADER_CASES } from "../data/geopoliticalHistoricalLoaderCases.js";
import { REAL_ESTATE_HOUSING_HISTORICAL_LOADER_CASES } from "../data/realEstateHousingHistoricalLoaderCases.js";
import { SOVEREIGN_DEBT_HISTORICAL_LOADER_CASES } from "../data/sovereignDebtHistoricalLoaderCases.js";
import { VOLATILITY_HISTORICAL_LOADER_CASES } from "../data/volatilityHistoricalLoaderCases.js";
import { buildHistoricalLibraryDrafts } from "../data/historicalBackfillCases.js";
import { MACRO_HISTORICAL_LOADER_CASES } from "../data/macroHistoricalLoaderCases.js";
import { POLICY_HISTORICAL_LOADER_CASES } from "../data/policyHistoricalLoaderCases.js";

import { buildChinaHistoricalLibraryDrafts } from "./chinaHistoricalLoader.js";
import { buildCommoditiesHistoricalLibraryDrafts } from "./commoditiesHistoricalLoader.js";
import { buildCreditHistoricalLibraryDrafts } from "./creditHistoricalLoader.js";
import { buildCryptoHistoricalLibraryDrafts } from "./cryptoHistoricalLoader.js";
import { buildEarningsHistoricalLibraryDrafts } from "./earningsHistoricalLoader.js";
import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import { buildEnergyHistoricalLibraryDrafts } from "./energyHistoricalLoader.js";
import { buildGeopoliticalHistoricalLibraryDrafts } from "./geopoliticalHistoricalLoader.js";
import { buildRealEstateHousingHistoricalLibraryDrafts } from "./realEstateHousingHistoricalLoader.js";
import { buildSovereignDebtHistoricalLibraryDrafts } from "./sovereignDebtHistoricalLoader.js";
import { buildVolatilityHistoricalLibraryDrafts } from "./volatilityHistoricalLoader.js";
import { buildMacroHistoricalLibraryDrafts } from "./macroHistoricalLoader.js";
import { buildPolicyHistoricalLibraryDrafts } from "./policyHistoricalLoader.js";
import type { AppServices } from "./services.js";

type DomainBreakdown = CoreHistoricalCorpusIngestionResponse["domain_breakdown"][number];

export const DEFAULT_CORE_HISTORICAL_CASE_PACKS = [
  "macro_v1",
  "macro_plus_v1",
  "macro_calendar_v1",
  "earnings_v1",
  "policy_fx_v1",
  "energy_v1",
  "credit_v1",
  "crypto_v1",
  "china_macro_v1",
  "commodities_v1",
  "geopolitical_v1",
  "volatility_v1",
  "real_estate_housing_v1",
  "sovereign_debt_v1",
] as const;

const withCasePack = <T extends { case_pack: string }>(items: T[], casePack: string) =>
  items.filter((item) => item.case_pack === casePack);

const appendDomain = (
  drafts: HistoricalCaseLibraryDraft[],
  domainBreakdown: DomainBreakdown[],
  domain: DomainBreakdown["domain"],
  casePack: string,
  nextDrafts: HistoricalCaseLibraryDraft[],
) => {
  drafts.push(...nextDrafts);
  domainBreakdown.push({
    domain,
    case_pack: casePack,
    selected_cases: nextDrafts.length,
  });
};

export const buildCoreHistoricalCorpusDrafts = (
  request: CoreHistoricalCorpusIngestionRequest,
) => {
  const drafts: HistoricalCaseLibraryDraft[] = [];
  const domainBreakdown: DomainBreakdown[] = [];

  if (request.include_backfill) {
    const backfillDrafts = buildHistoricalLibraryDrafts(request.backfill_case_pack);
    appendDomain(drafts, domainBreakdown, "backfill", request.backfill_case_pack, backfillDrafts);
  }

  if (request.include_macro) {
    const macroDrafts = buildMacroHistoricalLibraryDrafts({
      items: withCasePack(MACRO_HISTORICAL_LOADER_CASES, request.macro_case_pack),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "macro-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(drafts, domainBreakdown, "macro", request.macro_case_pack, macroDrafts);
  }

  if (request.include_earnings) {
    const earningsDrafts = buildEarningsHistoricalLibraryDrafts({
      items: withCasePack(EARNINGS_HISTORICAL_LOADER_CASES, request.earnings_case_pack),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "earnings-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(
      drafts,
      domainBreakdown,
      "earnings",
      request.earnings_case_pack,
      earningsDrafts,
    );
  }

  if (request.include_policy_fx) {
    const policyDrafts = buildPolicyHistoricalLibraryDrafts({
      items: withCasePack(POLICY_HISTORICAL_LOADER_CASES, request.policy_case_pack),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "policy-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(
      drafts,
      domainBreakdown,
      "policy_fx",
      request.policy_case_pack,
      policyDrafts,
    );
  }

  if (request.include_energy) {
    const energyDrafts = buildEnergyHistoricalLibraryDrafts({
      items: withCasePack(ENERGY_HISTORICAL_LOADER_CASES, request.energy_case_pack),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "energy-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(drafts, domainBreakdown, "energy", request.energy_case_pack, energyDrafts);
  }

  if (request.include_credit_banking) {
    const creditDrafts = buildCreditHistoricalLibraryDrafts({
      items: withCasePack(CREDIT_HISTORICAL_LOADER_CASES, request.credit_case_pack),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "credit-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(
      drafts,
      domainBreakdown,
      "credit_banking",
      request.credit_case_pack,
      creditDrafts,
    );
  }

  if (request.include_crypto) {
    const cryptoDrafts = buildCryptoHistoricalLibraryDrafts({
      items: withCasePack(CRYPTO_HISTORICAL_LOADER_CASES, request.crypto_case_pack),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "crypto-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(drafts, domainBreakdown, "crypto", request.crypto_case_pack, cryptoDrafts);
  }

  if (request.include_china_macro) {
    const chinaDrafts = buildChinaHistoricalLibraryDrafts({
      items: withCasePack(CHINA_HISTORICAL_LOADER_CASES, request.china_macro_case_pack),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "china-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(
      drafts,
      domainBreakdown,
      "china_macro",
      request.china_macro_case_pack,
      chinaDrafts,
    );
  }

  if (request.include_commodities) {
    const commoditiesDrafts = buildCommoditiesHistoricalLibraryDrafts({
      items: withCasePack(COMMODITIES_HISTORICAL_LOADER_CASES, request.commodities_case_pack),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "commodities-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(
      drafts,
      domainBreakdown,
      "commodities",
      request.commodities_case_pack,
      commoditiesDrafts,
    );
  }

  if (request.include_geopolitical) {
    const geopoliticalDrafts = buildGeopoliticalHistoricalLibraryDrafts({
      items: withCasePack(GEOPOLITICAL_HISTORICAL_LOADER_CASES, request.geopolitical_case_pack),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "geopolitical-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(
      drafts,
      domainBreakdown,
      "geopolitical",
      request.geopolitical_case_pack,
      geopoliticalDrafts,
    );
  }

  if (request.include_volatility) {
    const volatilityDrafts = buildVolatilityHistoricalLibraryDrafts({
      items: withCasePack(VOLATILITY_HISTORICAL_LOADER_CASES, request.volatility_case_pack),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "volatility-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(
      drafts,
      domainBreakdown,
      "volatility",
      request.volatility_case_pack,
      volatilityDrafts,
    );
  }

  if (request.include_real_estate_housing) {
    const realEstateDrafts = buildRealEstateHousingHistoricalLibraryDrafts({
      items: withCasePack(
        REAL_ESTATE_HOUSING_HISTORICAL_LOADER_CASES,
        request.real_estate_housing_case_pack,
      ),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "real-estate-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(
      drafts,
      domainBreakdown,
      "real_estate_housing",
      request.real_estate_housing_case_pack,
      realEstateDrafts,
    );
  }

  if (request.include_sovereign_debt) {
    const sovereignDebtDrafts = buildSovereignDebtHistoricalLibraryDrafts({
      items: withCasePack(
        SOVEREIGN_DEBT_HISTORICAL_LOADER_CASES,
        request.sovereign_debt_case_pack,
      ),
      store_library: true,
      ingest_reviewed_memory: false,
      fallback_model_version: "sovereign-debt-loader-v1",
      labeling_mode: request.labeling_mode,
    });
    appendDomain(
      drafts,
      domainBreakdown,
      "sovereign_debt",
      request.sovereign_debt_case_pack,
      sovereignDebtDrafts,
    );
  }

  return {
    drafts,
    domain_breakdown: domainBreakdown,
  };
};

export const ingestCoreHistoricalCorpus = async (
  services: AppServices,
  request: CoreHistoricalCorpusIngestionRequest,
): Promise<CoreHistoricalCorpusIngestionResponse> => {
  const { drafts, domain_breakdown } = buildCoreHistoricalCorpusDrafts(request);

  const result = await ingestHistoricalCaseLibrary(services, {
    items: drafts,
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });

  return coreHistoricalCorpusIngestionResponseSchema.parse({
    ...result,
    domain_breakdown,
  });
};
