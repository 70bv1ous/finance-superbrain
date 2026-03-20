import type {
  CreateSourceRequest,
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryDraft,
  VolatilityHistoricalCaseInput,
  VolatilityHistoricalIngestionRequest,
} from "@finance-superbrain/schemas";

import { ingestHistoricalCaseLibrary } from "./historicalCaseLibrary.js";
import type { AppServices } from "./services.js";

type VolatilityPreset = {
  event_family: string;
  default_title: (item: VolatilityHistoricalCaseInput) => string;
  default_dominant_catalyst: string;
  primary_themes: string[];
  primary_assets: string[];
  tags: string[];
  regimes: string[];
  sectors: string[];
  buildLead: (item: VolatilityHistoricalCaseInput) => string;
  buildReviewHints: (item: VolatilityHistoricalCaseInput) => string[];
};

const unique = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

const defaultReviewHints = (hints: string[], manualHints?: string[]) =>
  unique([...(manualHints ?? []), ...hints]).slice(0, 12);

const defaultVolRegime = (item: VolatilityHistoricalCaseInput) =>
  item.vol_regime?.trim() || "elevated";

const mapSignalToSurprise = (signal: VolatilityHistoricalCaseInput["signal_bias"]) =>
  signal === "bullish"
    ? "positive"
    : signal === "bearish"
      ? "negative"
      : signal === "mixed"
        ? "mixed"
        : "none";

const VOLATILITY_PRESETS: Record<VolatilityHistoricalCaseInput["event_type"], VolatilityPreset> = {
  vix_spike: {
    event_family: "vix_spike",
    default_title: () => "VIX spike — fear gauge surges, risk-off correlation spike",
    default_dominant_catalyst: "vix-spike-risk-off",
    primary_themes: ["vix_spike", "risk_off", "correlation_spike"],
    primary_assets: ["VIX", "SPY", "TLT", "GLD"],
    tags: ["volatility_loader", "vix_spike", "risk_off"],
    regimes: ["vol_stress"],
    sectors: ["volatility", "equities", "bonds"],
    buildLead: (item) =>
      `A VIX spike${item.vix_level_at_event ? ` to ${item.vix_level_at_event}` : ""} triggered a regime shift in the ${defaultVolRegime(item)} volatility environment, forcing correlations toward 1.0 and initiating a risk-off deleveraging sequence across asset classes.`,
    buildReviewHints: () => [
      "VIX above 30 changes the equity reaction function — correlations spike to 1.0 and all risk assets sell together in the first 48h as margin calls force indiscriminate liquidation, overriding fundamental valuation.",
      "The VIX spike duration (how long it stays above 30) determines whether it is a 'panic and recover' event (2-4 weeks) or a 'sustained bear market' event (3-6 months) — the policy response speed is the primary differentiator.",
      "GLD's safe-haven correlation breaks down in the acute phase (first 2 weeks) of VIX spikes above 40 due to margin call liquidation — it only reasserts its safe-haven role after the acute selling pressure exhausts.",
    ],
  },
  short_vol_blowup: {
    event_family: "short_vol_blowup",
    default_title: () => "Short volatility blowup — inverse VIX products terminated or severely impaired",
    default_dominant_catalyst: "short-vol-blowup",
    primary_themes: ["short_vol_blowup", "etp_risk", "feedback_loop"],
    primary_assets: ["VIX", "SPY", "SVXY"],
    tags: ["volatility_loader", "short_vol", "blowup", "etp"],
    regimes: ["short_vol_unwind", "vol_stress"],
    sectors: ["volatility", "financials"],
    buildLead: (item) =>
      `A short volatility blowup in the ${defaultVolRegime(item)} regime destroyed leveraged inverse VIX products through a pro-cyclical rebalancing feedback loop — forced buying of VIX futures by inverse products amplified the initial spike beyond fundamentally warranted levels.`,
    buildReviewHints: () => [
      "Inverse VIX ETPs (XIV, SVXY) contain a structural 'convexity trap': their end-of-day rebalancing requires them to buy VIX futures as prices rise, creating a pro-cyclical feedback loop that amplifies vol spikes and makes single-day losses catastrophic if the VIX doubles.",
      "Short-vol strategies have a unique risk asymmetry: years of slow premium collection can be wiped out in a single session — the Kelly criterion for short-vol sizing is extremely conservative, as the loss function is exponential, not linear.",
      "Short-vol blowup events often coincide with low pre-event realized volatility (VIX sub-15) — the accumulation of speculative short-vol positioning during calm periods creates the fuel for the blowup when any volatility catalyst emerges.",
    ],
  },
  gamma_squeeze: {
    event_family: "gamma_squeeze",
    default_title: () => "Gamma squeeze — options delta hedging creates self-reinforcing price acceleration",
    default_dominant_catalyst: "gamma-squeeze-options",
    primary_themes: ["gamma_squeeze", "options_mechanics", "market_maker_hedging"],
    primary_assets: ["VIX", "SPY", "QQQ"],
    tags: ["volatility_loader", "gamma_squeeze", "options", "delta_hedge"],
    regimes: ["gamma_squeeze", "short_squeeze"],
    sectors: ["volatility", "equities"],
    buildLead: (item) =>
      `A gamma squeeze event${item.vix_level_at_event ? ` with VIX at ${item.vix_level_at_event}` : ""} forced market makers to aggressively delta hedge their options exposure, creating a self-reinforcing price acceleration as hedging flows amplified the directional move.`,
    buildReviewHints: () => [
      "Gamma squeeze mechanics: market makers who sold call options must buy the underlying as price rises (delta hedging), which pushes price further up, requiring more buying — the feedback loop is most powerful when open interest in OTM calls exceeds 10x average daily volume.",
      "Gamma squeezes end abruptly when the options catalyst (retail buying, institutional squeeze play) exhausts — the post-squeeze collapse is typically as fast as the squeeze itself, making the exit timing extremely difficult.",
      "The second-order contagion from gamma squeezes is hedge fund de-grossing: funds whose short book bleeds sell unrelated long positions to reduce gross exposure, creating mechanical selling in quality names that is unrelated to fundamentals.",
    ],
  },
  vol_crush: {
    event_family: "vol_crush",
    default_title: () => "Volatility crush — implied vol collapses post-event, premium evaporates",
    default_dominant_catalyst: "vol-crush-post-event",
    primary_themes: ["vol_crush", "iv_crush", "risk_on"],
    primary_assets: ["VIX", "SPY", "QQQ", "TLT"],
    tags: ["volatility_loader", "vol_crush", "iv_crush", "options"],
    regimes: ["low_vol", "risk_on"],
    sectors: ["volatility", "equities", "bonds"],
    buildLead: (item) =>
      `A vol crush event collapsed implied volatility${item.vix_level_at_event ? ` (VIX to ${item.vix_level_at_event})` : ""} as the scheduled event resolved, evaporating the event-risk premium that had been embedded in options pricing and creating a powerful tailwind for risk assets.`,
    buildReviewHints: () => [
      "IV crush is mechanical and predictable: implied vol is systematically elevated before scheduled high-impact events (FOMC, earnings). When the event resolves without surprise, the vol premium collapses regardless of directional outcome — short straddles/strangles expiring at or just after the event capture this premium.",
      "A dovish FOMC surprise creates dual vol crush: equity implied vol (VIX) collapses AND rate implied vol (MOVE index) collapses simultaneously — this dual crush is the maximum positive environment for risk assets because both the discount rate and uncertainty premium fall together.",
      "VIX below 12 following a vol crush event represents an unstable compressed risk premium — historically, the VIX reverts toward 16-20 within 60-90 days as markets reassess whether the catalyst for the crush (Fed pivot, earnings beat) was warranted by underlying fundamentals.",
    ],
  },
  vol_regime_shift: {
    event_family: "vol_regime_shift",
    default_title: () => "Volatility regime shift — transition between low-vol and high-vol regimes",
    default_dominant_catalyst: "vol-regime-shift",
    primary_themes: ["vol_regime_shift", "regime_change", "risk_repricing"],
    primary_assets: ["VIX", "SPY", "TLT", "GLD"],
    tags: ["volatility_loader", "regime_shift", "vol_regime"],
    regimes: ["vol_transition"],
    sectors: ["volatility", "equities"],
    buildLead: (item) =>
      `A volatility regime shift transitioned the market from a ${defaultVolRegime(item)} environment, repricing the fundamental risk premium across asset classes as the structural vol backdrop changed.`,
    buildReviewHints: () => [
      "Vol regime shifts (low-to-high) are accompanied by a fundamental change in the options market structure: realized vol exceeds implied vol, forcing dealers to short gamma and amplifying directional moves in both directions during the transition.",
      "The transition from a low-vol regime (VIX sub-15) to a high-vol regime (VIX above 25) typically occurs within 5 trading days — once the regime shift is confirmed, mean-reverting long-vol strategies outperform trend-following strategies for 30-60 days.",
      "Equity risk premiums systematically underprice vol regime shifts during low-vol periods: in VIX sub-12 environments, equity valuations embed future vol of approximately 12-15%, but actual realized vol during the subsequent 90 days is typically 20-25% — a persistent mispricing that creates systematic short-equity or long-vol opportunities.",
    ],
  },
  vix_term_inversion: {
    event_family: "vix_term_inversion",
    default_title: () => "VIX term structure inversion — backwardation signals acute crisis pricing",
    default_dominant_catalyst: "vix-term-inversion-backwardation",
    primary_themes: ["vix_term_inversion", "backwardation", "acute_crisis"],
    primary_assets: ["VIX", "SPY", "TLT"],
    tags: ["volatility_loader", "vix_backwardation", "term_inversion", "crisis"],
    regimes: ["vix_backwardation", "vol_stress"],
    sectors: ["volatility", "equities", "bonds"],
    buildLead: (item) =>
      `A VIX term structure inversion (front-month premium over back-month) with VIX${item.vix_level_at_event ? ` at ${item.vix_level_at_event}` : ""} signaled acute near-term crisis pricing — the inverted term structure represents a market-implied probability of sustained fear that is highest in the next 30 days.`,
    buildReviewHints: () => [
      "VIX term structure inversion (front > back, backwardation) is self-limiting: it prices an acute crisis that either resolves or worsens — it cannot persist indefinitely. VVIX (VIX of VIX) normalization below 100 is the most reliable leading indicator that the acute panic phase is ending.",
      "Front-month VIX futures in backwardation create a structural profit opportunity for calendar spread strategies (long front-month, short back-month) that capture the roll yield — but the window is narrow (2-4 weeks of peak inversion) and requires precise timing.",
      "The depth of the inversion (front-minus-back spread) correlates with the severity of the subsequent recovery rally: deeper inversions (8+ points) historically produce stronger 30-day recoveries in SPY once the VIX begins to normalize, as the fear unwind is proportional to the fear premium that was built in.",
    ],
  },
  options_expiry_pin: {
    event_family: "options_expiry_pin",
    default_title: () => "Options expiry pinning — max pain price magnetism at expiration",
    default_dominant_catalyst: "options-expiry-max-pain",
    primary_themes: ["options_expiry", "max_pain", "gamma_pinning"],
    primary_assets: ["SPY", "QQQ", "VIX"],
    tags: ["volatility_loader", "options_expiry", "max_pain", "gamma_pin"],
    regimes: ["options_expiry"],
    sectors: ["volatility", "equities"],
    buildLead: () =>
      "Options expiration mechanics created a gravitational pull toward the maximum pain price (the strike at which the greatest number of outstanding options expire worthless), as market makers unwound delta hedges and the underlying price was magnetically attracted to the strike concentration.",
    buildReviewHints: () => [
      "Max pain price magnetism is strongest in the 24-48 hours before expiration when market makers' delta hedges converge: as the underlying approaches the max pain strike, gamma becomes near-zero and market maker hedging activity actively dampens directional moves.",
      "Monthly options expiration (third Friday) creates the strongest pinning effect; weekly expirations create smaller but more frequent pins. The effect is strongest when open interest is concentrated at a single strike (not dispersed) and when market maker positioning is predominantly short gamma.",
      "Post-expiration releases from pinning (the 'uncorking' effect) can create sharp directional moves in the first 1-3 days of the new options cycle as dealers establish fresh gamma positions — the direction of the post-expiry move often depends on whether expiration net dealer gamma was long or short.",
    ],
  },
  realized_vol_surge: {
    event_family: "realized_vol_surge",
    default_title: () => "Realized volatility surge — actual price movement exceeds implied volatility expectations",
    default_dominant_catalyst: "realized-vol-surge",
    primary_themes: ["realized_vol_surge", "vol_of_vol", "event_driven"],
    primary_assets: ["VIX", "SPY", "QQQ"],
    tags: ["volatility_loader", "realized_vol", "vol_surge"],
    regimes: ["vol_stress", "event_driven"],
    sectors: ["volatility", "equities"],
    buildLead: (item) =>
      `A realized volatility surge${item.vix_level_at_event ? ` with VIX reaching ${item.vix_level_at_event}` : ""} drove actual price movements far above the implied volatility priced into options — creating losses for premium sellers while rewarding long-vol strategies and directional traders who sized positions for elevated moves.`,
    buildReviewHints: () => [
      "Realized vol surges in individual sectors (e.g., regional banks 400%+ in March 2023) create gamma squeeze feedback loops where market maker delta hedging amplifies the underlying move — the realized vol often overshoots the fundamental risk, creating mean-reversion opportunities once the forced selling exhausts.",
      "The ratio of realized vol to implied vol (vol-of-vol premium) is the most actionable signal: when realized vol exceeds implied by 2x+ for 5+ consecutive days, short-vol strategies should be avoided even if IV appears elevated, as the premium underestimates the actual tail risk.",
      "Realized vol surges are sector-specific and contagion-limited in most cases: a 400% realized vol surge in regional banks does not automatically imply 400% vol in technology — the key contagion channel is hedge fund gross exposure reduction, which creates mechanical selling in high-quality long positions unrelated to the vol event.",
    ],
  },
};

const buildSource = (
  item: VolatilityHistoricalCaseInput,
  preset: VolatilityPreset,
): CreateSourceRequest => ({
  source_type: "headline",
  title: item.title?.trim() || preset.default_title(item),
  publisher:
    item.publisher?.trim() ||
    `Volatility Markets / ${item.vol_regime ?? "stress"} regime event`,
  occurred_at: item.occurred_at,
  raw_text: `${preset.buildLead(item)} ${item.summary.trim()}`,
});

const buildLabels = (
  item: VolatilityHistoricalCaseInput,
  preset: VolatilityPreset,
): HistoricalCaseLabelInput => ({
  event_family: preset.event_family,
  tags: unique([
    ...preset.tags,
    item.event_type,
    item.signal_bias,
    item.vol_regime,
    ...(item.labels?.tags ?? []),
  ]),
  regimes: unique([...(item.labels?.regimes ?? []), ...preset.regimes]),
  regions: unique([...(item.labels?.regions ?? []), "global"]),
  sectors: unique([...(item.labels?.sectors ?? []), ...preset.sectors]),
  primary_themes: unique([
    ...(item.labels?.primary_themes ?? []),
    ...preset.primary_themes,
  ]),
  primary_assets: unique([
    ...preset.primary_assets,
    ...(item.labels?.primary_assets ?? []),
  ]).slice(0, 8),
  competing_catalysts: item.labels?.competing_catalysts,
  surprise_type: item.labels?.surprise_type ?? mapSignalToSurprise(item.signal_bias),
  case_quality: item.labels?.case_quality,
  notes:
    item.labels?.notes ??
    `Loaded via volatility historical preset: ${item.event_type}${item.vix_level_at_event ? ` (VIX: ${item.vix_level_at_event})` : ""}.`,
});

const toHistoricalDraft = (item: VolatilityHistoricalCaseInput): HistoricalCaseLibraryDraft => {
  const preset = VOLATILITY_PRESETS[item.event_type];

  return {
    case_id: item.case_id,
    case_pack: item.case_pack,
    source: buildSource(item, preset),
    horizon: "1d",
    realized_moves: item.realized_moves,
    timing_alignment: item.timing_alignment,
    dominant_catalyst: item.dominant_catalyst?.trim() || preset.default_dominant_catalyst,
    labels: buildLabels(item, preset),
    review_hints: defaultReviewHints(preset.buildReviewHints(item), item.review_hints),
    model_version: item.model_version,
  };
};

export const buildVolatilityHistoricalLibraryDrafts = (
  request: VolatilityHistoricalIngestionRequest,
): HistoricalCaseLibraryDraft[] => request.items.map(toHistoricalDraft);

export const ingestVolatilityHistoricalCases = async (
  services: AppServices,
  request: VolatilityHistoricalIngestionRequest,
) =>
  ingestHistoricalCaseLibrary(services, {
    items: buildVolatilityHistoricalLibraryDrafts(request),
    store_library: request.store_library,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    fallback_model_version: request.fallback_model_version,
    labeling_mode: request.labeling_mode,
  });
