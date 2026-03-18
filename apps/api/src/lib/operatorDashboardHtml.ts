export const buildOperatorDashboardHtml = () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Finance Superbrain Ops</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f1eee7;
      --bg-soft: #e7dece;
      --paper: rgba(255, 250, 241, 0.9);
      --paper-strong: #fffaf1;
      --line: #d3c4ad;
      --line-strong: #aa8e67;
      --text: #18202b;
      --muted: #5b6572;
      --accent: #0c6a61;
      --accent-soft: rgba(12, 106, 97, 0.1);
      --warn: #bd6d2f;
      --bad: #b04034;
      --good: #21734e;
      --shadow: 0 24px 50px rgba(58, 38, 14, 0.12);
      --radius: 22px;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: "Manrope", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(12, 106, 97, 0.12), transparent 26%),
        radial-gradient(circle at top right, rgba(189, 109, 47, 0.14), transparent 24%),
        linear-gradient(180deg, var(--bg) 0%, var(--bg-soft) 100%);
    }

    .app {
      max-width: 1320px;
      margin: 0 auto;
      padding: 28px 18px 48px;
    }

    .hero, .panel, .metric-card, .chain-card, .search-result {
      background: var(--paper);
      border: 1px solid rgba(255, 255, 255, 0.6);
      box-shadow: var(--shadow);
      border-radius: var(--radius);
      backdrop-filter: blur(16px);
    }

    .hero {
      padding: 28px;
      margin-bottom: 18px;
    }

    .eyebrow, .metric-label, .meta, .chip, .search-input {
      font-family: "IBM Plex Mono", monospace;
    }

    .eyebrow {
      color: var(--accent);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      margin-bottom: 14px;
    }

    h1 {
      margin: 0;
      font-size: clamp(2.1rem, 4vw, 4rem);
      line-height: 0.95;
      letter-spacing: -0.05em;
      max-width: 860px;
    }

    .hero p {
      margin: 12px 0 0;
      max-width: 860px;
      color: var(--muted);
      line-height: 1.7;
    }

    .grid {
      display: grid;
      gap: 16px;
    }

    .stats-grid {
      grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
      margin-bottom: 18px;
    }

    .metric-card {
      padding: 18px;
    }

    .metric-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--muted);
      margin-bottom: 10px;
    }

    .metric-value {
      font-size: 2rem;
      font-weight: 800;
      letter-spacing: -0.05em;
    }

    .main-grid {
      grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
      align-items: start;
    }

    .panel {
      padding: 22px;
    }

    .panel-title {
      font-size: 1.12rem;
      font-weight: 800;
      margin-bottom: 6px;
    }

    .panel-sub {
      color: var(--muted);
      line-height: 1.6;
      margin-bottom: 18px;
    }

    .stack {
      display: grid;
      gap: 12px;
    }

    .chain-card {
      padding: 18px;
    }

    .chain-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 14px;
    }

    .chain-title {
      font-size: 1rem;
      font-weight: 800;
      line-height: 1.35;
      margin-bottom: 4px;
    }

    .meta {
      color: var(--muted);
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .chip-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--accent-soft);
      border: 1px solid rgba(12, 106, 97, 0.18);
      color: var(--accent);
      font-size: 11px;
    }

    .chip.good {
      color: var(--good);
      border-color: rgba(33, 115, 78, 0.18);
      background: rgba(33, 115, 78, 0.08);
    }

    .chip.bad {
      color: var(--bad);
      border-color: rgba(176, 64, 52, 0.18);
      background: rgba(176, 64, 52, 0.08);
    }

    .stage-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .stage {
      background: rgba(255, 255, 255, 0.55);
      border: 1px solid rgba(170, 142, 103, 0.16);
      border-radius: 18px;
      padding: 14px;
    }

    .stage-label {
      font: 500 11px/1.2 "IBM Plex Mono", monospace;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--muted);
      margin-bottom: 10px;
    }

    .stage-title {
      font-size: 0.98rem;
      font-weight: 800;
      line-height: 1.35;
      margin-bottom: 8px;
    }

    .stage-copy {
      font-size: 14px;
      line-height: 1.65;
      color: var(--muted);
      margin-bottom: 10px;
    }

    .list {
      display: grid;
      gap: 8px;
    }

    .list-item {
      font-size: 13px;
      line-height: 1.55;
      color: var(--muted);
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(170, 142, 103, 0.12);
    }

    .list-item:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .theme-list, .search-results {
      display: grid;
      gap: 12px;
    }

    .theme-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }

    .theme-row:last-child {
      border-bottom: 0;
    }

    .theme-name {
      text-transform: capitalize;
    }

    .theme-count {
      color: var(--accent);
      font-weight: 800;
    }

    .search-bar {
      display: flex;
      gap: 10px;
      margin-bottom: 14px;
    }

    .search-input {
      width: 100%;
      border: 1px solid var(--line-strong);
      border-radius: 16px;
      padding: 14px 16px;
      background: rgba(255, 255, 255, 0.72);
      color: var(--text);
      outline: none;
    }

    .btn {
      border: 0;
      border-radius: 16px;
      padding: 0 18px;
      background: var(--accent);
      color: white;
      font-weight: 700;
      cursor: pointer;
    }

    .btn.small {
      padding: 8px 10px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1;
    }

    .search-result {
      padding: 16px;
    }

    .search-result strong {
      display: block;
      margin-bottom: 8px;
    }

    .helper {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.6;
    }

    .loading {
      opacity: 0.6;
    }

    @media (max-width: 980px) {
      .main-grid, .stage-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <section class="hero">
      <div class="eyebrow">Operator console</div>
      <h1>Finance Superbrain Memory Desk</h1>
      <p>This view turns the backend into an actual operating system surface. Each case is shown as a full chain from source to calibration, so you can inspect what the engine saw, which analogs it trusted, what it predicted, what actually happened, and what lesson survived.</p>
    </section>

    <section class="grid stats-grid" id="statsGrid"></section>

    <section class="grid main-grid">
      <div class="panel">
        <div class="panel-title">Intelligence pipeline</div>
        <div class="panel-sub">Source -> event -> analogs -> prediction -> outcome -> lesson -> calibration, all on one screen.</div>
        <div class="stack" id="pipelineList"></div>
      </div>

      <div class="grid">
        <div class="panel">
          <div class="panel-title">Live streams</div>
          <div class="panel-sub">Webhook-bound transcript sessions that are actively feeding the live market-analysis loop.</div>
          <div class="theme-list" id="liveStreamList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Top themes</div>
          <div class="panel-sub">Where the memory cloud is building the most density.</div>
          <div class="theme-list" id="themeList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Historical memory</div>
          <div class="panel-sub">Coverage of the labeled finance-case library by pack, trust level, and review burden.</div>
          <div class="theme-list" id="historicalLibraryList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Memory gaps</div>
          <div class="panel-sub">Thin domains, review bottlenecks, and trust gaps that should shape the next ingestion push.</div>
          <div class="theme-list" id="historicalGapList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">High-confidence candidates</div>
          <div class="panel-sub">Reviewed cases that are closest to graduating into the strongest benchmark trust tier.</div>
          <div class="theme-list" id="highConfidenceCandidateList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Benchmark mission control</div>
          <div class="panel-sub">Latest core benchmark checkpoint, pack health, domain quota coverage, and recent replay history on the mixed finance exam.</div>
          <div class="theme-list" id="benchmarkMissionList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Benchmark families</div>
          <div class="panel-sub">Compare each active family against its last checkpoint and against its strongest prior mixed-benchmark baseline.</div>
          <div class="theme-list" id="benchmarkFamilyList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Benchmark alerts</div>
          <div class="panel-sub">Regressions and benchmark-driven growth pressure that should influence the next diagnostics or shell review.</div>
          <div class="theme-list" id="benchmarkAlertList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Benchmark trust warnings</div>
          <div class="panel-sub">Coverage-aware warnings that tell you when the mixed benchmark is running, but not yet trustworthy enough to lean on heavily.</div>
          <div class="theme-list" id="benchmarkWarningList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Benchmark trust refreshes</div>
          <div class="panel-sub">Memory-hardening runs that promoted stronger cases into high-confidence status and then re-tested the benchmark immediately afterward.</div>
          <div class="theme-list" id="benchmarkTrustRefreshList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">System operations</div>
          <div class="panel-sub">Execution telemetry for the major backend jobs, including recent failures, partial runs, and runtime trends.</div>
          <div class="theme-list" id="systemOperationList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">System queue</div>
          <div class="panel-sub">Queued long-running jobs, active execution leases, and whether the worker boundary is draining or backing up.</div>
          <div class="theme-list" id="systemQueueList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Queue alerts</div>
          <div class="panel-sub">Backlog pressure, retry buildup, and stale-running signals that should trigger worker or integration investigation.</div>
          <div class="theme-list" id="systemQueueAlertList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Operational incidents</div>
          <div class="panel-sub">Consolidated queue, worker, supervisor, and integration incidents so operators can see what needs attention without stitching multiple panels together.</div>
          <div class="theme-list" id="systemIncidentList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Queue workers</div>
          <div class="panel-sub">Registered worker loops, their latest heartbeat, and whether the background execution boundary is actively draining or quietly stalling.</div>
          <div class="theme-list" id="systemWorkerList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Worker services</div>
          <div class="panel-sub">Supervisor processes that own long-running worker deployment, restart backoff, and operational runtime responsibility beyond individual loop heartbeats.</div>
          <div class="theme-list" id="systemWorkerServiceList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Worker service trends</div>
          <div class="panel-sub">Durable supervisor-boundary history showing restart churn, loop exits, and service-level failures across the recent runtime window.</div>
          <div class="theme-list" id="systemWorkerServiceTrendList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Worker trends</div>
          <div class="panel-sub">Durable worker event history showing restart churn, error stops, stale-job recovery, and recent cycle throughput.</div>
          <div class="theme-list" id="systemWorkerTrendList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Integration health</div>
          <div class="panel-sub">External feed and transcript dependency pressure, including retry storms, permanent failures, and the latest operational incidents.</div>
          <div class="theme-list" id="systemIntegrationList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Integration probes</div>
          <div class="panel-sub">Active provider probes against configured feed and transcript URLs so readiness can spot upstream outages before queued pulls fail.</div>
          <div class="theme-list" id="systemIntegrationProbeList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Integration governance</div>
          <div class="panel-sub">Queue-control decisions derived from active probes and recent retry pressure, so degraded providers create deliberate backpressure instead of blind retry storms.</div>
          <div class="theme-list" id="systemIntegrationGovernanceList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Integration trends</div>
          <div class="panel-sub">Time-window trend lines for feed and transcript pressure, including retry buildup, permanent failures, and stale recoveries.</div>
          <div class="theme-list" id="systemIntegrationTrendList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Walk-forward promotion checks</div>
          <div class="panel-sub">Timed promotion exams that force candidate shells to survive time-ordered windows, not just a static mixed replay pack.</div>
          <div class="theme-list" id="benchmarkWalkForwardPromotionList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Walk-forward by regime</div>
          <div class="panel-sub">Timed family performance sliced by market regime, so you can see where a shell is durable or softening instead of relying on one aggregate timed score.</div>
          <div class="theme-list" id="benchmarkWalkForwardRegimeList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Benchmark stability</div>
          <div class="panel-sub">Weekly rollups and durability scores that show which families hold up steadily across time, not just on one checkpoint.</div>
          <div class="theme-list" id="benchmarkStabilityList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Calibration snapshot</div>
          <div class="panel-sub">Confidence compared to realized accuracy by horizon.</div>
          <div class="theme-list" id="calibrationList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Calibration history</div>
          <div class="panel-sub">Saved self-audit checkpoints so you can see whether the engine is actually improving over time.</div>
          <div class="theme-list" id="calibrationHistoryList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Model leaderboard</div>
          <div class="panel-sub">Compare engine versions by realized score, direction accuracy, and calibration alignment.</div>
          <div class="theme-list" id="modelLeaderboardList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Model lineage</div>
          <div class="panel-sub">Track which shell each family started from, what it molted into, and which shell is active now.</div>
          <div class="theme-list" id="lineageList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Evolution history</div>
          <div class="panel-sub">Saved lineage checkpoints showing how many shells and hardened descendants existed at each snapshot.</div>
          <div class="theme-list" id="lineageHistoryList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Evolution trends</div>
          <div class="panel-sub">Family-level movement in shell depth, hardening, score, and calibration across saved lineage checkpoints.</div>
          <div class="theme-list" id="evolutionTrendList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Growth pressure</div>
          <div class="panel-sub">Families currently showing signs that a stronger shell may be needed soon.</div>
          <div class="theme-list" id="growthAlertList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Alert timeline</div>
          <div class="panel-sub">Acknowledged, snoozed, handled, and resolved pressure episodes across recent cycles.</div>
          <div class="theme-list" id="growthAlertHistoryList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Pending actions</div>
          <div class="panel-sub">Governed response plans waiting for approval or recently executed by the evolution loop.</div>
          <div class="theme-list" id="growthActionList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Promotion history</div>
          <div class="panel-sub">Recent promotion-gate decisions so model upgrades are visible, auditable, and comparable over time.</div>
          <div class="theme-list" id="promotionHistoryList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Promotion families</div>
          <div class="panel-sub">Family-level pass rates, recent trend shifts, and which strategy families are actually earning promotion.</div>
          <div class="theme-list" id="promotionFamilyList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Tuning patterns</div>
          <div class="panel-sub">Which replay adjustments are actually showing up in successful promotions across the system.</div>
          <div class="theme-list" id="promotionPatternList"></div>
        </div>

        <div class="panel">
          <div class="panel-title">Semantic lesson search</div>
          <div class="panel-sub">Search prior mistakes and reinforcements using meaning, not only exact token overlap.</div>
          <form class="search-bar" id="searchForm">
            <input class="search-input" id="searchInput" placeholder="Search like china tariffs, overconfidence, semiconductors, inflation relief" value="china tariffs">
            <button class="btn" type="submit">Search</button>
          </form>
          <div class="search-results" id="searchResults"></div>
        </div>
      </div>
    </section>
  </div>

  <script>
    const statsGrid = document.getElementById("statsGrid");
    const pipelineList = document.getElementById("pipelineList");
    const liveStreamList = document.getElementById("liveStreamList");
    const themeList = document.getElementById("themeList");
    const historicalLibraryList = document.getElementById("historicalLibraryList");
    const historicalGapList = document.getElementById("historicalGapList");
    const highConfidenceCandidateList = document.getElementById("highConfidenceCandidateList");
    const benchmarkMissionList = document.getElementById("benchmarkMissionList");
    const benchmarkFamilyList = document.getElementById("benchmarkFamilyList");
    const benchmarkAlertList = document.getElementById("benchmarkAlertList");
    const benchmarkWarningList = document.getElementById("benchmarkWarningList");
      const benchmarkTrustRefreshList = document.getElementById("benchmarkTrustRefreshList");
      const systemOperationList = document.getElementById("systemOperationList");
      const systemQueueList = document.getElementById("systemQueueList");
      const systemQueueAlertList = document.getElementById("systemQueueAlertList");
      const systemIncidentList = document.getElementById("systemIncidentList");
      const systemWorkerList = document.getElementById("systemWorkerList");
      const systemWorkerServiceList = document.getElementById("systemWorkerServiceList");
      const systemWorkerServiceTrendList = document.getElementById("systemWorkerServiceTrendList");
      const systemWorkerTrendList = document.getElementById("systemWorkerTrendList");
    const systemIntegrationList = document.getElementById("systemIntegrationList");
    const systemIntegrationProbeList = document.getElementById("systemIntegrationProbeList");
    const systemIntegrationGovernanceList = document.getElementById("systemIntegrationGovernanceList");
    const systemIntegrationTrendList = document.getElementById("systemIntegrationTrendList");
    const benchmarkWalkForwardPromotionList = document.getElementById("benchmarkWalkForwardPromotionList");
    const benchmarkWalkForwardRegimeList = document.getElementById("benchmarkWalkForwardRegimeList");
    const benchmarkStabilityList = document.getElementById("benchmarkStabilityList");
    const calibrationList = document.getElementById("calibrationList");
    const calibrationHistoryList = document.getElementById("calibrationHistoryList");
    const modelLeaderboardList = document.getElementById("modelLeaderboardList");
    const lineageList = document.getElementById("lineageList");
    const lineageHistoryList = document.getElementById("lineageHistoryList");
    const evolutionTrendList = document.getElementById("evolutionTrendList");
    const growthAlertList = document.getElementById("growthAlertList");
    const growthAlertHistoryList = document.getElementById("growthAlertHistoryList");
    const growthActionList = document.getElementById("growthActionList");
    const promotionHistoryList = document.getElementById("promotionHistoryList");
    const promotionFamilyList = document.getElementById("promotionFamilyList");
    const promotionPatternList = document.getElementById("promotionPatternList");
    const searchForm = document.getElementById("searchForm");
    const searchInput = document.getElementById("searchInput");
    const searchResults = document.getElementById("searchResults");
    const benchmarkPackId = "core_benchmark_v1";

    const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const formatPercent = (value) => typeof value === "number" ? Math.round(value * 100) + "%" : "-";
    const formatSignedPercent = (value) => {
      if (typeof value !== "number") return "-";
      const scaled = Math.round(value * 100);
      return (scaled > 0 ? "+" : "") + scaled + "%";
    };
    const formatDate = (value) => value ? new Date(value).toLocaleString("en-SG", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "-";
    const formatDuration = (value) => {
      if (typeof value !== "number") return "-";
      if (value < 1000) return value + "ms";
      const seconds = Math.round(value / 100) / 10;
      if (seconds < 60) return seconds + "s";
      return Math.round((seconds / 60) * 10) / 10 + "m";
    };
    const verdictClass = (verdict) => verdict === "correct" ? "good" : verdict === "wrong" ? "bad" : "";
    const signalClass = (signal) => signal === "aligned" ? "good" : signal === "overconfident" ? "bad" : "";
    const postJson = async (url, body = {}) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      return response.json();
    };

    const renderStats = (summary, calibration, coverage, benchmark) => {
      statsGrid.innerHTML = [
        ["Predictions", summary.totals.predictions],
        ["Pending", summary.totals.pending],
        ["Reviewed", summary.totals.reviewed],
        ["Lessons", summary.totals.lessons],
        ["Library cases", coverage.total_cases],
        ["Needs review", coverage.needs_review_count],
        ["High confidence", coverage.high_confidence_cases],
        ["Benchmark cases", benchmark.latest_snapshot?.selected_case_count ?? benchmark.pack_health.selected_case_count],
        ["Benchmark alerts", benchmark.regressions.length + benchmark.growth_alerts.length],
        ["Benchmark warnings", benchmark.warnings.length],
        ["Live bindings", summary.live_streams.active_bindings],
        ["Avg score", formatPercent(calibration.average_total_score)],
        ["Calibration samples", calibration.sample_count]
      ].map(([label, value]) => \`
        <div class="metric-card">
          <div class="metric-label">\${escapeHtml(label)}</div>
          <div class="metric-value">\${escapeHtml(value)}</div>
        </div>\`).join("");
    };

    const renderThemes = (summary) => {
      themeList.innerHTML = summary.top_themes.length ? summary.top_themes.map((item) => \`
        <div class="theme-row">
          <div class="theme-name">\${escapeHtml(item.theme.replaceAll("_", " "))}</div>
          <div class="theme-count">\${item.count}</div>
        </div>\`).join("") : '<div class="helper">Themes appear after reviewed memory has accumulated.</div>';
    };

    const renderHistoricalLibraryCoverage = (coverage) => {
      historicalLibraryList.innerHTML = coverage.total_cases ? \`
        <div class="helper">total \${escapeHtml(coverage.total_cases)} | packs \${escapeHtml(coverage.unique_case_packs)} | families \${escapeHtml(coverage.unique_event_families)} | themes \${escapeHtml(coverage.unique_themes)}</div>
        <div class="helper">draft \${escapeHtml(coverage.needs_review_count)} | reviewed \${escapeHtml(coverage.reviewed_cases)} | high confidence \${escapeHtml(coverage.high_confidence_cases)}</div>
        <div class="helper">review queue assigned \${escapeHtml(coverage.review_queue.assigned_cases)} | unassigned \${escapeHtml(coverage.review_queue.unassigned_cases)} | adjudicated \${escapeHtml(coverage.review_queue.adjudicated_cases)}</div>
        \${coverage.by_case_pack.map((item) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(item.case_pack)}</div>
              <div class="helper">draft \${escapeHtml(item.draft_count)} | reviewed \${escapeHtml(item.reviewed_count)} | high confidence \${escapeHtml(item.high_confidence_count)}</div>
              <div class="helper">last update \${escapeHtml(formatDate(item.last_updated_at))}</div>
            </div>
            <div class="theme-count">\${escapeHtml(item.count)}</div>
          </div>\`).join("")}
        <div class="helper">top families: \${escapeHtml(coverage.by_event_family.map((item) => item.name + " (" + item.count + ")").join(", ") || "-")}</div>
        <div class="helper">top regimes: \${escapeHtml(coverage.by_regime.map((item) => item.name + " (" + item.count + ")").join(", ") || "-")}</div>
        <div class="helper">top regions: \${escapeHtml(coverage.by_region.map((item) => item.name + " (" + item.count + ")").join(", ") || "-")}</div>
      \` : '<div class="helper">No historical case library items stored yet.</div>';
    };

    const renderHistoricalLibraryGaps = (report) => {
      historicalGapList.innerHTML = report.alerts.length ? \`
        <div class="helper">high \${escapeHtml(report.counts.high)} | medium \${escapeHtml(report.counts.medium)} | low \${escapeHtml(report.counts.low)}</div>
        \${report.alerts.slice(0, 6).map((alert) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(alert.title)}</div>
              <div class="helper">\${escapeHtml(alert.category.replaceAll("_", " "))} | target \${escapeHtml(alert.target)} | severity \${escapeHtml(alert.severity)}</div>
              <div class="helper">\${escapeHtml(alert.rationale)}</div>
              <div class="helper">\${escapeHtml(alert.recommendation)}</div>
            </div>
            <div class="theme-count">\${escapeHtml(alert.severity)}</div>
          </div>\`).join("")}
        \` : '<div class="helper">No major library gaps are being flagged right now.</div>';
    };

    const renderHighConfidenceCandidates = (report) => {
      highConfidenceCandidateList.innerHTML = report.candidates.length ? \`
        <div class="helper">reviewed pool \${escapeHtml(report.total_reviewed_cases)} | promotable \${escapeHtml(report.promotable_count)} | shown \${escapeHtml(report.candidates.length)}</div>
        \${report.candidates.map((candidate) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(candidate.title)}</div>
              <div class="helper">\${escapeHtml(candidate.case_pack)} | score \${formatPercent(candidate.candidate_score)} | recommendation \${escapeHtml(candidate.recommendation)}</div>
              <div class="helper">reviewer \${escapeHtml(candidate.reviewer || "unassigned")} | reviewed \${escapeHtml(formatDate(candidate.reviewed_at))}</div>
              <div class="helper">regimes \${escapeHtml(candidate.regimes.join(", ") || "-")}</div>
              <div class="helper">themes \${escapeHtml(candidate.primary_themes.join(", ") || "-")} | assets \${escapeHtml(candidate.primary_assets.join(", ") || "-")}</div>
              \${candidate.strengths.length ? \`<div class="helper">strengths: \${escapeHtml(candidate.strengths.slice(0, 3).join(" | "))}</div>\` : ""}
              \${candidate.blockers.length ? \`<div class="helper">blockers: \${escapeHtml(candidate.blockers.slice(0, 2).join(" | "))}</div>\` : ""}
            </div>
            <div class="theme-count">\${escapeHtml(candidate.recommendation)}</div>
          </div>\`).join("")}
      \` : '<div class="helper">No reviewed cases are currently strong enough to surface as high-confidence candidates.</div>';
    };

    const renderBenchmarkMission = (benchmark) => {
      const latest = benchmark.latest_snapshot;
      const latestWalkForward = benchmark.latest_walk_forward_snapshot;
      benchmarkMissionList.innerHTML = \`
        <div class="helper">\${escapeHtml(benchmark.pack_health.label)} | selected \${escapeHtml(benchmark.pack_health.selected_case_count)} / target \${escapeHtml(benchmark.pack_health.target_case_count)} | quotas \${escapeHtml(benchmark.pack_health.quotas_met ? "met" : "open")}</div>
        <div class="helper">library reviewed \${escapeHtml(benchmark.coverage_summary.reviewed_cases)} | high confidence \${escapeHtml(benchmark.coverage_summary.high_confidence_cases)} | needs review \${escapeHtml(benchmark.coverage_summary.needs_review_count)}</div>
        \${benchmark.pack_health.domain_counts.map((item) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(item.domain.replaceAll("_", " "))}</div>
              <div class="helper">quota \${escapeHtml(item.selected_cases)} / \${escapeHtml(item.minimum_cases)}</div>
            </div>
            <div class="theme-count">\${item.selected_cases >= item.minimum_cases ? "ready" : "thin"}</div>
          </div>\`).join("")}
        \${latest ? \`
          <div class="theme-row">
            <div>
              <div class="theme-name">Latest checkpoint</div>
              <div class="helper">\${escapeHtml(formatDate(latest.as_of))} | cases \${escapeHtml(latest.selected_case_count)} | families \${escapeHtml(latest.family_count)}</div>
              <div class="helper">leaders: score \${escapeHtml(latest.leaders.by_average_total_score || "-")} | direction \${escapeHtml(latest.leaders.by_direction_accuracy || "-")} | calibration \${escapeHtml(latest.leaders.by_calibration_alignment || "-")}</div>
            </div>
            <div class="theme-count">\${escapeHtml(formatDate(latest.as_of))}</div>
          </div>
          \${latest.top_families.map((family) => \`
            <div class="theme-row">
              <div>
                <div class="theme-name">\${escapeHtml(family.family)}</div>
                <div class="helper">\${escapeHtml(family.model_version)} | score \${formatPercent(family.average_total_score)} | direction \${formatPercent(family.direction_accuracy)}</div>
                <div class="helper">wrong \${formatPercent(family.wrong_rate)} | calibration \${formatSignedPercent(family.calibration_gap)}</div>
              </div>
              <div class="theme-count">\${formatPercent(family.average_total_score)}</div>
            </div>\`).join("")}
        \` : '<div class="helper">No saved benchmark checkpoint yet for this pack.</div>'}
        \${latestWalkForward ? \`
          <div class="theme-row">
            <div>
              <div class="theme-name">Latest timed checkpoint</div>
              <div class="helper">\${escapeHtml(formatDate(latestWalkForward.as_of))} | eligible \${escapeHtml(latestWalkForward.eligible_case_count)} | windows \${escapeHtml(latestWalkForward.window_count)} | families \${escapeHtml(latestWalkForward.family_count)}</div>
              <div class="helper">leaders: score \${escapeHtml(latestWalkForward.report.leaders.by_average_total_score || "-")} | direction \${escapeHtml(latestWalkForward.report.leaders.by_direction_accuracy || "-")} | calibration \${escapeHtml(latestWalkForward.report.leaders.by_calibration_alignment || "-")}</div>
            </div>
            <div class="theme-count">\${escapeHtml(latestWalkForward.window_count)}</div>
          </div>
        \` : '<div class="helper">No saved walk-forward checkpoint yet for this pack.</div>'}
        \${benchmark.recent_snapshots.length > 1 ? \`<div class="helper">recent history: \${escapeHtml(benchmark.recent_snapshots.map((item) => new Date(item.as_of).toLocaleDateString("en-SG", { month: "short", day: "numeric" }) + " (" + item.selected_case_count + ")").join(" -> "))}</div>\` : ""}
        \${benchmark.recent_walk_forward_snapshots.length > 1 ? \`<div class="helper">timed history: \${escapeHtml(benchmark.recent_walk_forward_snapshots.map((item) => new Date(item.as_of).toLocaleDateString("en-SG", { month: "short", day: "numeric" }) + " (" + item.window_count + "w)").join(" -> "))}</div>\` : ""}
      \`;
    };

    const renderBenchmarkFamilies = (benchmark) => {
      benchmarkFamilyList.innerHTML = benchmark.family_comparisons.length ? benchmark.family_comparisons.map((family) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(family.family)}</div>
            <div class="helper">\${escapeHtml(family.latest_model_version || "no active shell")} | trend \${escapeHtml(family.trend_signal)}</div>
            <div class="helper">checkpoint score \${formatPercent(family.current_average_total_score)} (\${formatSignedPercent(family.score_delta)}) | direction \${formatPercent(family.current_direction_accuracy)} (\${formatSignedPercent(family.direction_accuracy_delta)})</div>
            <div class="helper">wrong \${formatPercent(family.current_wrong_rate)} (\${formatSignedPercent(family.wrong_rate_delta)}) | calibration \${formatSignedPercent(family.current_calibration_gap)} (\${formatSignedPercent(family.calibration_gap_delta)})</div>
            <div class="helper">baseline score \${formatSignedPercent(family.baseline_score_delta)} | baseline direction \${formatSignedPercent(family.baseline_direction_accuracy_delta)} | baseline wrong \${formatSignedPercent(family.baseline_wrong_rate_delta)} | baseline calibration \${formatSignedPercent(family.baseline_calibration_gap_delta)} | regression streak \${escapeHtml(family.regression_streak)}</div>
            \${family.alert_signals.length ? \`<div class="helper">\${escapeHtml(family.alert_signals.join(" | "))}</div>\` : ""}
          </div>
          <div class="theme-count">\${escapeHtml(family.regression_severity || family.growth_alert_severity || family.trend_signal)}</div>
        </div>\`).join("") : '<div class="helper">No benchmark family comparisons yet.</div>';
    };

    const renderBenchmarkAlerts = (benchmark) => {
      const regressionItems = benchmark.regressions.map((alert) => ({
        kind: "regression",
        title: alert.family,
        meta: \`severity \${alert.severity} | streak \${alert.regression_streak} | model \${alert.model_version || "none"}\`,
        detail: alert.signals.join(" | "),
        recommendation: alert.recommended_action,
        badge: alert.severity
      }));
      const walkForwardItems = benchmark.walk_forward_regressions.map((alert) => ({
        kind: "timed regression",
        title: alert.family,
        meta: \`severity \${alert.severity} | streak \${alert.regression_streak} | model \${alert.model_version || "none"}\`,
        detail: alert.signals.join(" | "),
        recommendation: alert.recommended_action,
        badge: alert.severity
      }));
      const walkForwardRegimeItems = benchmark.walk_forward_regime_regressions.map((alert) => ({
        kind: "timed regime regression",
        title: alert.family + " @ " + alert.regime,
        meta: \`severity \${alert.severity} | streak \${alert.regression_streak} | model \${alert.model_version || "none"}\`,
        detail: alert.signals.join(" | "),
        recommendation: alert.recommended_action,
        badge: alert.severity
      }));
      const growthItems = benchmark.growth_alerts.map((alert) => ({
        kind: "growth",
        title: alert.family,
        meta: \`severity \${alert.severity} | status \${alert.status} | shell \${alert.active_model_version || "none"}\`,
        detail: alert.signals.join(" | "),
        recommendation: alert.recommended_action,
        badge: alert.severity
      }));
      const items = [...regressionItems, ...walkForwardItems, ...walkForwardRegimeItems, ...growthItems].slice(0, 8);

      benchmarkAlertList.innerHTML = items.length ? \`
        <div class="helper">regressions \${escapeHtml(benchmark.regressions.length)} | timed regressions \${escapeHtml(benchmark.walk_forward_regressions.length)} | regime regressions \${escapeHtml(benchmark.walk_forward_regime_regressions.length)} | growth alerts \${escapeHtml(benchmark.growth_alerts.length)}</div>
        \${items.map((item) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(item.title)}</div>
              <div class="helper">\${escapeHtml(item.kind)} | \${escapeHtml(item.meta)}</div>
              <div class="helper">\${escapeHtml(item.detail)}</div>
              <div class="helper">\${escapeHtml(item.recommendation)}</div>
            </div>
            <div class="theme-count">\${escapeHtml(item.badge)}</div>
          </div>\`).join("")}
      \` : '<div class="helper">No benchmark-driven regressions or growth alerts are active right now.</div>';
    };

    const renderBenchmarkWarnings = (benchmark) => {
      benchmarkWarningList.innerHTML = benchmark.warnings.length ? benchmark.warnings.map((warning) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(warning.title)}</div>
            <div class="helper">\${escapeHtml(warning.detail)}</div>
            <div class="helper">\${escapeHtml(warning.recommendation)}</div>
          </div>
          <div class="theme-count">\${escapeHtml(warning.severity)}</div>
        </div>\`).join("") : '<div class="helper">No benchmark trust warnings are active right now.</div>';
    };

    const renderBenchmarkTrustRefreshes = (benchmark) => {
      const latest = benchmark.latest_trust_refresh;
      benchmarkTrustRefreshList.innerHTML = benchmark.recent_trust_refreshes.length ? \`
        <div class="helper">latest \${escapeHtml(formatDate(latest?.generated_at))} | reviewer \${escapeHtml(latest?.seed.reviewer || "-")} | promoted \${escapeHtml(latest?.seed.promoted_count ?? 0)} | warning delta \${escapeHtml(latest?.delta.warning_count ?? 0)} | high-confidence delta \${escapeHtml(latest?.delta.high_confidence_cases ?? 0)}</div>
        <div class="helper">priority regimes \${escapeHtml(latest?.seed.prioritized_regimes?.join(", ") || "-")}</div>
        \${benchmark.recent_trust_refreshes.map((refresh) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(formatDate(refresh.generated_at))}</div>
              <div class="helper">\${escapeHtml(refresh.seed.reviewer)} | promoted \${escapeHtml(refresh.seed.promoted_count)} / candidates \${escapeHtml(refresh.seed.candidate_count)} | scanned \${escapeHtml(refresh.seed.scanned_reviewed_cases)}</div>
              <div class="helper">priority regimes \${escapeHtml(refresh.seed.prioritized_regimes.join(", ") || "-")} | hardened \${escapeHtml(refresh.seed.promoted_regimes.map((item) => item.name + " (" + item.count + ")").join(", ") || "-")}</div>
              <div class="helper">high confidence \${escapeHtml(refresh.before.high_confidence_cases)} -> \${escapeHtml(refresh.after.high_confidence_cases)} | warnings \${escapeHtml(refresh.before.warning_count)} -> \${escapeHtml(refresh.after.warning_count)} | high warnings \${escapeHtml(refresh.before.high_warning_count)} -> \${escapeHtml(refresh.after.high_warning_count)}</div>
              <div class="helper">selected cases \${escapeHtml(refresh.before.selected_case_count)} -> \${escapeHtml(refresh.after.selected_case_count)} | quotas \${escapeHtml(refresh.after.quotas_met ? "met" : "open")} | snapshot families \${escapeHtml(refresh.benchmark_snapshot_family_count ?? "-")}</div>
            </div>
            <div class="theme-count">\${escapeHtml(refresh.delta.warning_count <= 0 ? "hardening" : "watch")}</div>
        </div>\`).join("")}
      \` : '<div class="helper">No benchmark trust refresh runs have been stored yet.</div>';
    };

    const renderSystemOperations = (report) => {
      const latestFailure = report.latest_failure;
      systemOperationList.innerHTML = report.operations.some((item) => item.total_runs > 0) ? \`
        <div class="helper">runs \${escapeHtml(report.counts.total)} | success \${escapeHtml(report.counts.success)} | partial \${escapeHtml(report.counts.partial)} | failed \${escapeHtml(report.counts.failed)}</div>
        <div class="helper">latest failure \${escapeHtml(latestFailure?.operation_name || "-")} | \${escapeHtml(formatDate(latestFailure?.finished_at || null))} | \${escapeHtml(latestFailure?.error_message || "none")}</div>
        \${report.operations.filter((item) => item.total_runs > 0).slice(0, 8).map((item) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(item.operation_name)}</div>
              <div class="helper">latest \${escapeHtml(item.latest_status || "-")} via \${escapeHtml(item.latest_triggered_by || "-")} | avg \${escapeHtml(item.average_duration_ms ?? 0)}ms | runs \${escapeHtml(item.total_runs)}</div>
              <div class="helper">success \${escapeHtml(item.success_count)} | partial \${escapeHtml(item.partial_count)} | failed \${escapeHtml(item.failed_count)}</div>
              \${item.latest_error_message ? \`<div class="helper">\${escapeHtml(item.latest_error_message)}</div>\` : ""}
            </div>
            <div class="theme-count">\${escapeHtml(item.latest_status || "-")}</div>
          </div>\`).join("")}
      \` : '<div class="helper">No operation telemetry recorded yet.</div>';
    };

    const renderSystemQueue = (report) => {
      systemQueueList.innerHTML = report.latest_jobs.length || report.active_leases ? \`
        <div class="helper">pending \${escapeHtml(report.counts.pending)} | running \${escapeHtml(report.counts.running)} | completed \${escapeHtml(report.counts.completed)} | failed \${escapeHtml(report.counts.failed)}</div>
        <div class="helper">retry scheduled \${escapeHtml(report.counts.retry_scheduled)} | stale running \${escapeHtml(report.counts.stale_running)} | active leases \${escapeHtml(report.active_leases)}</div>
        <div class="helper">oldest pending \${escapeHtml(formatDate(report.oldest_pending_at || null))} (\${escapeHtml(formatDuration(report.oldest_pending_age_ms))}) | longest running \${escapeHtml(formatDuration(report.longest_running_age_ms))}</div>
        \${report.latest_jobs.slice(0, 8).map((job) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(job.operation_name)}</div>
              <div class="helper">\${escapeHtml(job.status)} via \${escapeHtml(job.triggered_by)} | attempts \${escapeHtml(job.attempt_count)} / \${escapeHtml(job.max_attempts)} | available \${escapeHtml(formatDate(job.available_at))}</div>
              <div class="helper">job \${escapeHtml(job.id.slice(0, 8))} | lease \${escapeHtml(job.lease_owner || "-")} | idempotency \${escapeHtml(job.idempotency_key || "-")}</div>
              \${job.error_message ? \`<div class="helper">\${escapeHtml(job.error_message)}</div>\` : ""}
            </div>
            <div class="theme-count">\${escapeHtml(job.status)}</div>
          </div>\`).join("")}
        \${report.leases.length ? \`<div class="helper">active scopes \${escapeHtml(report.leases.slice(0, 6).map((lease) => lease.operation_name + ":" + lease.scope_key).join(" | "))}</div>\` : ""}
      \` : '<div class="helper">No queued jobs or active leases right now.</div>';
    };

    const renderSystemQueueAlerts = (report) => {
      systemQueueAlertList.innerHTML = report.alerts.length ? \`
        <div class="helper">high \${escapeHtml(report.counts.high)} | medium \${escapeHtml(report.counts.medium)} | low \${escapeHtml(report.counts.low)}</div>
        \${report.alerts.map((alert) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(alert.title)}</div>
              <div class="helper">\${escapeHtml(alert.signal)} | severity \${escapeHtml(alert.severity)}</div>
              <div class="helper">\${escapeHtml(alert.detail)}</div>
              <div class="helper">\${escapeHtml(alert.recommendation)}</div>
            </div>
            <div class="theme-count">\${escapeHtml(alert.severity)}</div>
          </div>\`).join("")}
      \` : '<div class="helper">No active queue-pressure alerts right now.</div>';
    };

    const renderSystemIncidents = (report) => {
      systemIncidentList.innerHTML = report.incidents.length ? \`
        <div class="helper">high \${escapeHtml(report.counts.high)} | medium \${escapeHtml(report.counts.medium)} | low \${escapeHtml(report.counts.low)}</div>
        \${report.incidents.map((incident) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(incident.title)}</div>
              <div class="helper">\${escapeHtml(incident.source)} | \${escapeHtml(incident.signal)} | severity \${escapeHtml(incident.severity)}</div>
              <div class="helper">\${escapeHtml(incident.detail)}</div>
              <div class="helper">\${escapeHtml(incident.recommendation)}</div>
            </div>
            <div class="theme-count">\${escapeHtml(incident.severity)}</div>
          </div>\`).join("")}
      \` : '<div class="helper">No consolidated operational incidents right now.</div>';
    };

    const renderSystemWorkers = (report) => {
      systemWorkerList.innerHTML = report.workers.length ? \`
        <div class="helper">active \${escapeHtml(report.counts.active)} | stale \${escapeHtml(report.counts.stale)} | stopped \${escapeHtml(report.counts.stopped)}</div>
        \${report.workers.slice(0, 8).map((worker) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(worker.worker_id)}</div>
              <div class="helper">\${escapeHtml(worker.status)} | lifecycle \${escapeHtml(worker.lifecycle_state)} | heartbeat age \${escapeHtml(formatDuration(worker.heartbeat_age_ms))}</div>
              <div class="helper">last heartbeat \${escapeHtml(formatDate(worker.last_heartbeat_at))} | stale after \${escapeHtml(formatDuration(worker.stale_after_ms))}</div>
              <div class="helper">cycles \${escapeHtml(worker.total_cycles)} | processed \${escapeHtml(worker.total_processed)} | completed \${escapeHtml(worker.total_completed)} | failed \${escapeHtml(worker.total_failed)} | retried \${escapeHtml(worker.total_retried)} | abandoned \${escapeHtml(worker.total_abandoned)}</div>
              <div class="helper">last cycle \${escapeHtml(formatDate(worker.last_cycle_finished_at || worker.last_cycle_started_at || null))} | ops \${escapeHtml(worker.supported_operations.length ? worker.supported_operations.join(", ") : "all")}</div>
              \${worker.last_error_message ? \`<div class="helper">\${escapeHtml(worker.last_error_message)}</div>\` : ""}
            </div>
            <div class="theme-count">\${escapeHtml(worker.status)}</div>
          </div>\`).join("")}
      \` : '<div class="helper">No worker heartbeat records yet. Start the worker loop to make the queue boundary observable.</div>';
    };

    const renderSystemWorkerServices = (report) => {
      systemWorkerServiceList.innerHTML = report.services.length ? \`
        <div class="helper">active \${escapeHtml(report.counts.active)} | backing off \${escapeHtml(report.counts.backing_off)} | stale \${escapeHtml(report.counts.stale)} | failed \${escapeHtml(report.counts.failed)} | stopped \${escapeHtml(report.counts.stopped)}</div>
        \${report.services.slice(0, 8).map((service) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(service.service_id)}</div>
              <div class="helper">\${escapeHtml(service.status)} | lifecycle \${escapeHtml(service.lifecycle_state)} | worker \${escapeHtml(service.worker_id)} | heartbeat age \${escapeHtml(formatDuration(service.heartbeat_age_ms))}</div>
              <div class="helper">owner \${escapeHtml(service.supervisor_host || "unknown-host")} / pid \${escapeHtml(service.supervisor_pid === null ? "-" : service.supervisor_pid)} | instance \${escapeHtml(service.supervisor_instance_id || "unknown-instance")} | invocation \${escapeHtml(service.invocation_mode || "unspecified")}</div>
              <div class="helper">restarts \${escapeHtml(service.restart_count)} | streak \${escapeHtml(service.restart_streak)} | max \${escapeHtml(service.max_restarts)} | base backoff \${escapeHtml(formatDuration(service.supervisor_backoff_ms))} | current backoff \${escapeHtml(service.current_restart_backoff_ms === null ? "-" : formatDuration(service.current_restart_backoff_ms))} | remaining \${escapeHtml(service.remaining_restart_backoff_ms === null ? "-" : formatDuration(service.remaining_restart_backoff_ms))}</div>
              <div class="helper">restart due \${escapeHtml(service.restart_due_at === null ? "-" : formatDate(service.restart_due_at))} | started \${escapeHtml(formatDate(service.started_at))} | last heartbeat \${escapeHtml(formatDate(service.last_heartbeat_at))}</div>
              <div class="helper">last loop \${escapeHtml(formatDate(service.last_loop_finished_at || service.last_loop_started_at || null))} | runtime \${escapeHtml(service.last_loop_runtime_ms === null ? "-" : formatDuration(service.last_loop_runtime_ms))} | exit \${escapeHtml(service.last_exit_code === null ? "-" : service.last_exit_code)}\${service.last_exit_signal ? \` / \${escapeHtml(service.last_exit_signal)}\` : ""}</div>
              <div class="helper">ops \${escapeHtml(service.supported_operations.length ? service.supported_operations.join(", ") : "all")} | success window \${escapeHtml(formatDuration(service.success_window_ms))} | heartbeat every \${escapeHtml(formatDuration(service.heartbeat_interval_ms))}</div>
              \${service.last_error_message ? \`<div class="helper">\${escapeHtml(service.last_error_message)}</div>\` : ""}
            </div>
            <div class="theme-count">\${escapeHtml(service.status)}</div>
          </div>\`).join("")}
        \` : '<div class="helper">No worker service has registered itself yet. Run the supervised worker service to make deployment ownership explicit.</div>';
    };

    const renderSystemWorkerServiceTrends = (report) => {
      systemWorkerServiceTrendList.innerHTML = \`
        <div class="helper">window \${escapeHtml(report.window_hours)}h | bucket \${escapeHtml(report.bucket_hours)}h | starts \${escapeHtml(report.counts.started)} | ownership conflicts \${escapeHtml(report.counts.ownership_conflicts)} | loop exits \${escapeHtml(report.counts.loop_exits)} | scheduled restarts \${escapeHtml(report.counts.scheduled_restarts)} | failed \${escapeHtml(report.counts.failed)}</div>
        <div class="helper">stopped \${escapeHtml(report.counts.stopped)} | recent events \${escapeHtml(report.recent_events.length)}</div>
        \${report.alerts.length ? report.alerts.map((alert) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(alert.title)}</div>
              <div class="helper">\${escapeHtml(alert.signal)} | severity \${escapeHtml(alert.severity)}</div>
              <div class="helper">\${escapeHtml(alert.detail)}</div>
              <div class="helper">\${escapeHtml(alert.recommendation)}</div>
            </div>
            <div class="theme-count">\${escapeHtml(alert.severity)}</div>
          </div>\`).join("") : '<div class="helper">No worker service trend alerts right now.</div>'}
        \${report.buckets.length ? report.buckets.slice(-6).reverse().map((bucket) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(formatDate(bucket.bucket_started_at))}</div>
              <div class="helper">starts \${escapeHtml(bucket.started)} | ownership conflicts \${escapeHtml(bucket.ownership_conflicts)} | loop exits \${escapeHtml(bucket.loop_exits)} | scheduled restarts \${escapeHtml(bucket.scheduled_restarts)}</div>
              <div class="helper">failed \${escapeHtml(bucket.failed)} | stopped \${escapeHtml(bucket.stopped)}</div>
            </div>
            <div class="theme-count">\${escapeHtml(bucket.ownership_conflicts + bucket.scheduled_restarts + bucket.failed)}</div>
          </div>\`).join("") : ""}
      \`;
    };

    const renderSystemWorkerTrends = (report) => {
      systemWorkerTrendList.innerHTML = \`
        <div class="helper">window \${escapeHtml(report.window_hours)}h | bucket \${escapeHtml(report.bucket_hours)}h | starts \${escapeHtml(report.counts.started)} | stops \${escapeHtml(report.counts.stopped)} | error stops \${escapeHtml(report.counts.error_stops)} | cycles \${escapeHtml(report.counts.cycles)}</div>
        <div class="helper">processed \${escapeHtml(report.counts.processed)} | completed \${escapeHtml(report.counts.completed)} | failed \${escapeHtml(report.counts.failed)} | retried \${escapeHtml(report.counts.retried)} | abandoned \${escapeHtml(report.counts.abandoned)}</div>
        \${report.alerts.length ? report.alerts.map((alert) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(alert.title)}</div>
              <div class="helper">\${escapeHtml(alert.signal)} | severity \${escapeHtml(alert.severity)}</div>
              <div class="helper">\${escapeHtml(alert.detail)}</div>
              <div class="helper">\${escapeHtml(alert.recommendation)}</div>
            </div>
            <div class="theme-count">\${escapeHtml(alert.severity)}</div>
          </div>\`).join("") : '<div class="helper">No worker trend alerts right now.</div>'}
        \${report.buckets.length ? report.buckets.slice(-6).reverse().map((bucket) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(formatDate(bucket.bucket_started_at))}</div>
              <div class="helper">starts \${escapeHtml(bucket.started)} | stops \${escapeHtml(bucket.stopped)} | error stops \${escapeHtml(bucket.error_stops)} | cycles \${escapeHtml(bucket.cycles)}</div>
              <div class="helper">processed \${escapeHtml(bucket.processed)} | failed \${escapeHtml(bucket.failed)} | retried \${escapeHtml(bucket.retried)} | abandoned \${escapeHtml(bucket.abandoned)}</div>
            </div>
            <div class="theme-count">\${escapeHtml(bucket.cycles)}</div>
          </div>\`).join("") : ""}
        \${report.recent_events.length ? \`
          <div class="helper">recent events</div>
          \${report.recent_events.slice(0, 6).map((event) => \`
            <div class="theme-row">
              <div>
                <div class="theme-name">\${escapeHtml(event.worker_id)}</div>
                <div class="helper">\${escapeHtml(event.event_type)} | \${escapeHtml(formatDate(event.occurred_at))} | lifecycle \${escapeHtml(event.lifecycle_state || "-")}</div>
                <div class="helper">processed \${escapeHtml(event.cycle_processed ?? "-")} | failed \${escapeHtml(event.cycle_failed ?? "-")} | retried \${escapeHtml(event.cycle_retried ?? "-")} | abandoned \${escapeHtml(event.cycle_abandoned ?? "-")}</div>
                \${event.error_message ? \`<div class="helper">\${escapeHtml(event.error_message)}</div>\` : ""}
              </div>
              <div class="theme-count">\${escapeHtml(event.event_type)}</div>
            </div>\`).join("")}
        \` : ""}
      \`;
    };

    const renderSystemIntegrations = (report) => {
      systemIntegrationList.innerHTML = report.integrations.length ? \`
        <div class="helper">healthy \${escapeHtml(report.counts.healthy)} | degraded \${escapeHtml(report.counts.degraded)} | critical \${escapeHtml(report.counts.critical)}</div>
        \${report.integrations.map((integration) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(integration.integration)}</div>
              <div class="helper">\${escapeHtml(integration.severity)} | pending \${escapeHtml(integration.pending_jobs)} | running \${escapeHtml(integration.running_jobs)} | retry scheduled \${escapeHtml(integration.retry_scheduled_jobs)}</div>
              <div class="helper">completed \${escapeHtml(integration.completed_jobs)} | failed \${escapeHtml(integration.failed_jobs)} | stale recovered \${escapeHtml(integration.stale_recovered_jobs)}</div>
              <div class="helper">non-retryable \${escapeHtml(integration.non_retryable_failures)} | retryable \${escapeHtml(integration.retryable_failures)} | latest \${escapeHtml(formatDate(integration.latest_job_at))}</div>
              \${integration.latest_error_message ? \`<div class="helper">\${escapeHtml(integration.latest_error_message)}</div>\` : ""}
            </div>
            <div class="theme-count">\${escapeHtml(integration.severity)}</div>
          </div>\`).join("")}
        \${report.alerts.length ? \`<div class="helper">alerts: \${escapeHtml(report.alerts.map((alert) => alert.integration + ":" + alert.signal).join(" | "))}</div>\` : ""}
        \${report.recent_incidents.length ? report.recent_incidents.slice(0, 6).map((incident) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(incident.integration)} incident</div>
              <div class="helper">\${escapeHtml(incident.status)} | attempts \${escapeHtml(incident.attempt_count)} | retryable \${escapeHtml(incident.retryable === null ? "-" : incident.retryable ? "yes" : "no")} | status code \${escapeHtml(incident.status_code ?? "-")}</div>
              <div class="helper">\${escapeHtml(formatDate(incident.updated_at))} | \${escapeHtml(incident.error_message || "retry scheduled")}</div>
            </div>
            <div class="theme-count">\${escapeHtml(incident.integration)}</div>
          </div>\`).join("") : ""}
        \` : '<div class="helper">No feed or transcript queue activity has been recorded yet.</div>';
    };

    const renderSystemIntegrationProbes = (report) => {
      const staleSnapshots = report.alerts.filter((alert) => alert.signal === "probe_snapshot_stale").length;
      const missingSnapshots = report.alerts.filter((alert) => alert.signal === "probe_snapshot_missing").length;
      systemIntegrationProbeList.innerHTML = \`
        <div class="helper">configured \${escapeHtml(report.configured_target_count)} | ready \${escapeHtml(report.ready_target_count)} | degraded \${escapeHtml(report.degraded_target_count)} | unknown \${escapeHtml(report.unknown_target_count)} | timeout \${escapeHtml(formatDuration(report.timeout_ms))}</div>
        <div class="helper">snapshot stale \${escapeHtml(staleSnapshots)} | snapshot missing \${escapeHtml(missingSnapshots)} | alerts \${escapeHtml(report.alerts.length)}</div>
        \${report.summaries.map((summary) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(summary.integration)}</div>
              <div class="helper">configured \${escapeHtml(summary.configured_targets)} | ready \${escapeHtml(summary.ready_targets)} | degraded \${escapeHtml(summary.degraded_targets)} | unknown \${escapeHtml(summary.unknown_targets)}</div>
            </div>
            <div class="theme-count">\${escapeHtml(summary.highest_status)}</div>
          </div>\`).join("")}
        \${report.targets.map((target) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(target.url)}</div>
              <div class="helper">\${escapeHtml(target.integration)} | \${escapeHtml(target.status)} | latency \${escapeHtml(target.latency_ms === null ? "-" : formatDuration(target.latency_ms))} | status code \${escapeHtml(target.status_code ?? "-")}</div>
              <div class="helper">checked \${escapeHtml(formatDate(target.checked_at))} | content type \${escapeHtml(target.content_type || "-")}</div>
              \${target.detail ? \`<div class="helper">\${escapeHtml(target.detail)}</div>\` : ""}
            </div>
            <div class="theme-count">\${escapeHtml(target.status)}</div>
          </div>\`).join("")}
        \${report.alerts.length ? \`<div class="helper">alerts: \${escapeHtml(report.alerts.map((alert) => alert.integration + ":" + alert.signal).join(" | "))}</div>\` : ""}
      \`;
    };

    const renderSystemIntegrationGovernance = (report) => {
      systemIntegrationGovernanceList.innerHTML = \`
        <div class="helper">freshness \${escapeHtml(formatDuration(report.freshness_ms))} | throttled \${escapeHtml(report.states.filter((state) => state.action === "throttle").length)} | suppressed \${escapeHtml(report.states.filter((state) => state.action === "suppress").length)} | alerts \${escapeHtml(report.alerts.length)}</div>
        \${report.states.map((state) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(state.integration)}</div>
              <div class="helper">action \${escapeHtml(state.action)} | reason \${escapeHtml(state.reason)} | checked \${escapeHtml(formatDate(state.checked_at))}</div>
              <div class="helper">probe \${escapeHtml(state.highest_probe_status)} | configured \${escapeHtml(state.configured_targets)} | ready \${escapeHtml(state.ready_targets)} | degraded \${escapeHtml(state.degraded_targets)}</div>
              <div class="helper">degraded since \${escapeHtml(formatDate(state.degraded_since))} | outage since \${escapeHtml(formatDate(state.outage_since))} | hold until \${escapeHtml(formatDate(state.hold_until))}</div>
              <div class="helper">retry scheduled \${escapeHtml(state.recent_retry_scheduled)} | non-retryable \${escapeHtml(state.recent_non_retryable_failures)} | stale recovered \${escapeHtml(state.recent_stale_recovered)} | trend \${escapeHtml(state.recent_trend_signal)}</div>
              <div class="helper">retry delay \${escapeHtml(state.retry_delay_seconds === null ? "-" : state.retry_delay_seconds + "s")}</div>
              <div class="helper">\${escapeHtml(state.detail)}</div>
            </div>
            <div class="theme-count">\${escapeHtml(state.action)}</div>
          </div>\`).join("")}
        \${report.alerts.length ? \`<div class="helper">alerts: \${escapeHtml(report.alerts.map((alert) => alert.integration + ":" + alert.signal).join(" | "))}</div>\` : '<div class="helper">No integration governance actions are active right now.</div>'}
      \`;
    };

    const renderSystemIntegrationTrends = (report) => {
      systemIntegrationTrendList.innerHTML = \`
        <div class="helper">window \${escapeHtml(report.window_hours)}h | bucket \${escapeHtml(report.bucket_hours)}h | alerts \${escapeHtml(report.alerts.length)}</div>
        \${report.slices.map((slice) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(slice.integration)}</div>
              <div class="helper">\${escapeHtml(slice.trend_signal)} | completed \${escapeHtml(slice.counts.completed)} | failed \${escapeHtml(slice.counts.failed)} | retry scheduled \${escapeHtml(slice.counts.retry_scheduled)}</div>
              <div class="helper">non-retryable \${escapeHtml(slice.counts.non_retryable_failures)} | stale recovered \${escapeHtml(slice.counts.stale_recovered)} | latest incident \${escapeHtml(formatDate(slice.latest_incident_at))}</div>
              <div class="helper">\${slice.buckets.slice(-3).map((bucket) => \`\${formatDate(bucket.bucket_started_at)}: retry \${bucket.retry_scheduled}, failed \${bucket.failed}, stale \${bucket.stale_recovered}\`).join(" | ")}</div>
            </div>
            <div class="theme-count">\${escapeHtml(slice.trend_signal)}</div>
          </div>\`).join("")}
        \${report.alerts.length ? \`<div class="helper">alerts: \${escapeHtml(report.alerts.map((alert) => alert.integration + ":" + alert.signal).join(" | "))}</div>\` : '<div class="helper">No integration trend alerts right now.</div>'}
      \`;
    };

    const renderWalkForwardPromotions = (benchmark) => {
      benchmarkWalkForwardPromotionList.innerHTML = benchmark.recent_walk_forward_promotions.length ? benchmark.recent_walk_forward_promotions.map((item) => \`
        <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(item.candidate_model_version)}</div>
              <div class="helper">vs \${escapeHtml(item.baseline_model_version)} | \${escapeHtml(formatDate(item.created_at))}</div>
            <div class="helper">walk-forward \${item.walk_forward_passed ? "passed" : "failed"} | promotion \${item.promotion_passed ? "passed" : "failed"} | windows \${escapeHtml(item.window_count)} | eligible \${escapeHtml(item.eligible_case_count)}</div>
            <div class="helper">regimes \${escapeHtml(item.eligible_regime_count)} | high confidence \${escapeHtml(item.eligible_high_confidence_case_count)} | depth \${item.depth_requirements_met ? "met" : "thin"}</div>
            <div class="helper">score \${formatSignedPercent(item.deltas.average_total_score)} | direction \${formatSignedPercent(item.deltas.direction_accuracy)} | wrong \${formatSignedPercent(item.deltas.wrong_rate)} | calibration \${formatSignedPercent(item.deltas.calibration_alignment)}</div>
            <div class="helper">\${escapeHtml((item.reasons.length ? item.reasons : ["No walk-forward issues were recorded."]).join(" | "))}</div>
          </div>
          <div class="theme-count">\${item.walk_forward_passed ? "timed pass" : "timed fail"}</div>
        </div>\`).join("") : '<div class="helper">No walk-forward promotion checks recorded for this benchmark pack yet.</div>';
    };

    const renderWalkForwardRegimes = (benchmark) => {
      benchmarkWalkForwardRegimeList.innerHTML = benchmark.walk_forward_regime_slices.length ? \`
        <div class="helper">showing the strongest recent timed regime slices from saved walk-forward checkpoints. Active timed regime regressions: \${escapeHtml(benchmark.walk_forward_regime_regressions.length)}</div>
        \${benchmark.walk_forward_regime_slices.slice(0, 8).map((item) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(item.regime)} | \${escapeHtml(item.family)}</div>
              <div class="helper">\${escapeHtml(item.latest_model_version || "no active shell")} | signal \${escapeHtml(item.trend_signal)} | checkpoints \${escapeHtml(item.sample_count)}</div>
              <div class="helper">score \${formatPercent(item.current_average_total_score)} (\${formatSignedPercent(item.score_delta)}) | direction \${formatPercent(item.current_direction_accuracy)} (\${formatSignedPercent(item.direction_accuracy_delta)})</div>
              <div class="helper">wrong \${formatPercent(item.current_wrong_rate)} (\${formatSignedPercent(item.wrong_rate_delta)}) | calibration \${formatSignedPercent(item.current_calibration_gap)} (\${formatSignedPercent(item.calibration_gap_delta)})</div>
              <div class="helper">timed path: \${escapeHtml(item.snapshots.map((point) => new Date(point.as_of).toLocaleDateString("en-SG", { month: "short", day: "numeric" }) + " " + Math.round(point.average_total_score * 100) + "%").join(" -> "))}</div>
            </div>
            <div class="theme-count">\${escapeHtml(item.trend_signal)}</div>
          </div>\`).join("")}
      \` : '<div class="helper">No regime-level walk-forward slices have been saved yet.</div>';
    };

    const renderBenchmarkStability = (report) => {
      benchmarkStabilityList.innerHTML = report.families.length ? \`
        <div class="helper">weeks \${escapeHtml(report.week_count)} | snapshots \${escapeHtml(report.sample_count)} | stability leader \${escapeHtml(report.leaders.by_stability_score || "-")} | resilience leader \${escapeHtml(report.leaders.by_resilience || "-")}</div>
        \${report.families.slice(0, 6).map((family) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(family.family)}</div>
              <div class="helper">\${escapeHtml(family.latest_model_version || "no active shell")} | signal \${escapeHtml(family.current_signal)} | weeks \${escapeHtml(family.week_count)}</div>
              <div class="helper">stability \${formatPercent(family.stability_score)} | resilience \${formatPercent(family.resilience_score)} | avg weekly score \${formatPercent(family.average_weekly_total_score)} | avg direction \${formatPercent(family.average_weekly_direction_accuracy)}</div>
              <div class="helper">avg wrong \${formatPercent(family.average_weekly_wrong_rate)} | avg abs calibration gap \${formatPercent(family.average_abs_calibration_gap)} | regression weeks \${escapeHtml(family.regression_weeks)}</div>
              <div class="helper">volatility score \${formatPercent(family.score_volatility)} | direction \${formatPercent(family.direction_volatility)} | wrong \${formatPercent(family.wrong_rate_volatility)} | calibration \${formatPercent(family.calibration_volatility)}</div>
              <div class="helper">weekly path: \${escapeHtml(family.weekly_rollups.map((week) => week.week_key + " " + Math.round(week.average_total_score * 100) + "% " + week.week_signal).join(" -> "))}</div>
            </div>
            <div class="theme-count">\${escapeHtml(family.current_signal)}</div>
          </div>\`).join("")}
      \` : '<div class="helper">Not enough benchmark history exists yet for weekly stability rollups.</div>';
    };

    const renderLiveStreams = (summary) => {
      liveStreamList.innerHTML = summary.live_streams.recent_bindings.length ? summary.live_streams.recent_bindings.map((item) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(item.title)}</div>
            <div class="helper">\${escapeHtml(item.provider)} | \${escapeHtml(item.session_status)} | chunks \${escapeHtml(item.chunk_count)}</div>
            <div class="helper">\${escapeHtml(item.external_stream_key)}\${item.last_theme ? " | theme " + escapeHtml(item.last_theme) : ""}</div>
            <div class="helper">buffer \${escapeHtml(item.buffered_fragments)} fragment(s) | \${escapeHtml(item.buffered_chars)} chars pending</div>
          </div>
          <div class="theme-count">\${escapeHtml(formatDate(item.updated_at))}</div>
        </div>\`).join("") : '<div class="helper">No active webhook-bound live streams yet.</div>';
    };

    const renderCalibration = (calibration) => {
      calibrationList.innerHTML = calibration.horizons.map((item) => {
        const activeBucket = item.buckets.find((bucket) => bucket.count > 0);
        return \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(item.horizon)}</div>
              <div class="helper">\${activeBucket ? "bucket " + activeBucket.bucket + ", gap " + formatSignedPercent(activeBucket.calibration_gap) : "not enough scored samples yet"}</div>
            </div>
            <div class="theme-count">\${item.sample_count}</div>
          </div>\`;
      }).join("");
    };

    const renderCalibrationHistory = (history) => {
      calibrationHistoryList.innerHTML = history.snapshots.length ? history.snapshots.map((item) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(formatDate(item.as_of))}</div>
            <div class="helper">samples \${escapeHtml(item.sample_count)} | avg score \${formatPercent(item.average_total_score)}</div>
          </div>
          <div class="theme-count">\${formatPercent(item.report.average_total_score)}</div>
        </div>\`).join("") : '<div class="helper">No saved calibration checkpoints yet.</div>';
    };

    const renderModelLeaderboard = (report) => {
      modelLeaderboardList.innerHTML = report.versions.length ? report.versions.map((item) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(item.registry?.label || item.model_version)}</div>
            <div class="helper">\${escapeHtml(item.registry?.family || "unregistered model")} | version \${escapeHtml(item.model_version)}</div>
            <div class="helper">score \${formatPercent(item.average_total_score)} | direction \${formatPercent(item.direction_accuracy)} | gap \${formatSignedPercent(item.calibration_gap)} | samples \${escapeHtml(item.sample_count)}</div>
          </div>
          <div class="theme-count">\${item.model_version === report.leaders.by_average_total_score ? "leader" : formatPercent(item.correct_rate)}</div>
        </div>\`).join("") : '<div class="helper">No model comparison data yet.</div>';
    };

    const renderLineage = (report) => {
      lineageList.innerHTML = report.families.length ? report.families.slice(0, 6).map((family) => {
        const chain = family.lineage.map((node) => node.model_version).join(" -> ");
        const latestMolt = report.recent_molts.find((node) => node.family === family.family) || null;
        return \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(family.family)}</div>
              <div class="helper">root \${escapeHtml(family.root_model_version || "none")} | active \${escapeHtml(family.active_model_version || "none")} | depth \${escapeHtml(family.generation_depth)} | shells \${escapeHtml(family.total_shells)}</div>
              <div class="helper">\${escapeHtml(chain)}</div>
              \${latestMolt ? \`<div class="helper">latest molt \${escapeHtml(latestMolt.model_version)} from \${escapeHtml(latestMolt.parent_model_version || "root")} | \${escapeHtml(latestMolt.shell_state)} | \${escapeHtml(formatDate(latestMolt.created_at))}</div>\` : ""}
            </div>
            <div class="theme-count">\${family.hardened_shells}/\${family.total_shells}</div>
          </div>\`;
      }).join("") : '<div class="helper">No lineage history yet.</div>';
    };

    const renderLineageHistory = (history) => {
      lineageHistoryList.innerHTML = history.snapshots.length ? history.snapshots.map((item) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(formatDate(item.as_of))}</div>
            <div class="helper">families \${escapeHtml(item.family_count)} | shells \${escapeHtml(item.total_shells)} | hardened \${escapeHtml(item.hardened_shells)}</div>
          </div>
          <div class="theme-count">\${item.family_count ? Math.round((item.hardened_shells / item.total_shells) * 100 || 0) + "%" : "-"}</div>
        </div>\`).join("") : '<div class="helper">No saved evolution checkpoints yet.</div>';
    };

    const renderEvolutionTrends = (report) => {
      evolutionTrendList.innerHTML = report.families.length ? report.families.slice(0, 6).map((family) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(family.family)}</div>
            <div class="helper">depth \${escapeHtml(family.generation_depth)} (\${family.generation_depth_delta >= 0 ? "+" : ""}\${escapeHtml(family.generation_depth_delta)}) | shells \${escapeHtml(family.total_shells)} (\${family.shell_delta >= 0 ? "+" : ""}\${escapeHtml(family.shell_delta)}) | hardened \${escapeHtml(family.hardened_shells)} (\${family.hardened_delta >= 0 ? "+" : ""}\${escapeHtml(family.hardened_delta)})</div>
            <div class="helper">score \${formatPercent(family.current_average_total_score)} | delta \${formatSignedPercent(family.score_delta)} | calibration \${formatSignedPercent(family.current_calibration_gap)} | trend \${escapeHtml(family.trend_signal)}</div>
          </div>
          <div class="theme-count">\${report.leaders.by_generation_growth === family.family ? "leader" : escapeHtml(family.active_model_version || "-")}</div>
        </div>\`).join("") : '<div class="helper">Not enough lineage snapshots yet for family trend analytics.</div>';
    };

    const renderGrowthAlerts = (report) => {
      growthAlertList.innerHTML = report.alerts.length ? report.alerts.slice(0, 6).map((alert) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(alert.family)}</div>
            <div class="helper">\${escapeHtml(alert.active_model_version || "no active shell")} | severity \${escapeHtml(alert.severity)} | status \${escapeHtml(alert.status)} | persistence \${escapeHtml(alert.persistence_count)}</div>
            <div class="helper">\${escapeHtml(alert.signals.join(" | "))}</div>
            <div class="helper">\${escapeHtml(alert.recommended_action)}</div>
            \${alert.id ? \`
              <div class="chip-row" style="margin-top:10px;">
                <button class="btn small" type="button" onclick="window.financeOps.acknowledgeAlert('\${escapeHtml(alert.id)}')">Acknowledge</button>
                <button class="btn small" type="button" onclick="window.financeOps.snoozeAlert('\${escapeHtml(alert.id)}')">Snooze 24h</button>
                <button class="btn small" type="button" onclick="window.financeOps.handleAlert('\${escapeHtml(alert.id)}')">Mark handled</button>
              </div>
            \` : ""}
          </div>
          <div class="theme-count">\${escapeHtml(alert.severity)}</div>
        </div>\`).join("") : '<div class="helper">No active growth-pressure alerts right now.</div>';
    };

    const renderGrowthAlertHistory = (history) => {
      const counts = history.alerts.reduce((acc, alert) => {
        acc[alert.status] = (acc[alert.status] || 0) + 1;
        return acc;
      }, {});
      growthAlertHistoryList.innerHTML = history.alerts.length ? \`
        <div class="helper">open \${counts.open || 0} | acknowledged \${counts.acknowledged || 0} | snoozed \${counts.snoozed || 0} | handled \${counts.handled || 0} | resolved \${counts.resolved || 0}</div>
        \${history.alerts.slice(0, 8).map((alert) => \`
          <div class="theme-row">
            <div>
              <div class="theme-name">\${escapeHtml(alert.family)}</div>
              <div class="helper">\${escapeHtml(alert.status)} | \${escapeHtml(alert.severity)} | first \${escapeHtml(formatDate(alert.first_triggered_at))}</div>
              <div class="helper">last \${escapeHtml(formatDate(alert.last_triggered_at))} | persistence \${escapeHtml(alert.persistence_count)} | plan \${escapeHtml(alert.planned_action || "none")} / \${escapeHtml(alert.plan_status || "-")}</div>
            </div>
            <div class="theme-count">\${escapeHtml(alert.status)}</div>
          </div>\`).join("")}
      \` : '<div class="helper">No stored alert episodes yet.</div>';
    };

    const renderGrowthActions = (actions) => {
      growthActionList.innerHTML = actions.actions.length ? actions.actions.slice(0, 8).map((action) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(action.family)}</div>
            <div class="helper">\${escapeHtml(action.action_type)} | \${escapeHtml(action.status)} | model \${escapeHtml(action.active_model_version || "none")}</div>
            <div class="helper">\${escapeHtml(action.rationale)}</div>
            \${action.status === "pending" ? \`
              <div class="chip-row" style="margin-top:10px;">
                <button class="btn small" type="button" onclick="window.financeOps.approveAction('\${escapeHtml(action.id)}')">Approve</button>
                <button class="btn small" type="button" onclick="window.financeOps.blockAction('\${escapeHtml(action.id)}')">Block</button>
              </div>
            \` : ""}
            \${action.candidate_model_version ? \`<div class="helper">candidate \${escapeHtml(action.candidate_model_version)}</div>\` : ""}
          </div>
          <div class="theme-count">\${escapeHtml(action.status)}</div>
        </div>\`).join("") : '<div class="helper">No governed response plans yet.</div>';
    };

    const renderPromotionHistory = (history) => {
      promotionHistoryList.innerHTML = history.evaluations.length ? history.evaluations.map((item) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(item.candidate_model_version)}</div>
            <div class="helper">vs \${escapeHtml(item.baseline_model_version)} | \${escapeHtml(item.case_pack)} | \${escapeHtml(formatDate(item.created_at))}</div>
            <div class="helper">score \${formatSignedPercent(item.deltas.average_total_score)} | direction \${formatSignedPercent(item.deltas.direction_accuracy)} | wrong \${formatSignedPercent(item.deltas.wrong_rate)} | calibration \${formatSignedPercent(item.deltas.calibration_alignment)}</div>
            \${item.walk_forward ? \`<div class="helper">walk-forward \${item.walk_forward.passed ? "passed" : "failed"} | pack \${escapeHtml(item.walk_forward.benchmark_pack_id)} | windows \${escapeHtml(item.walk_forward.window_count)} | eligible \${escapeHtml(item.walk_forward.eligible_case_count)}</div>\` : ""}
          </div>
          <div class="theme-count">\${item.passed ? "passed" : "failed"}</div>
        </div>\`).join("") : '<div class="helper">No promotion-gate history yet.</div>';
    };

    const renderPromotionFamilies = (report) => {
      promotionFamilyList.innerHTML = report.families.length ? report.families.map((item) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(item.family)}</div>
            <div class="helper">pass rate \${formatPercent(item.pass_rate)} | recent \${formatPercent(item.recent_pass_rate)} | prior \${item.prior_pass_rate === null ? "-" : formatPercent(item.prior_pass_rate)} | trend \${escapeHtml(item.trend_signal)}</div>
            <div class="helper">score \${formatSignedPercent(item.average_total_score_delta)} | direction \${formatSignedPercent(item.average_direction_accuracy_delta)} | wrong \${formatSignedPercent(item.average_wrong_rate_delta)} | calibration \${formatSignedPercent(item.average_calibration_alignment_delta)}</div>
            <div class="helper">active \${escapeHtml(item.active_model_version || "none")} | latest \${escapeHtml(item.latest_candidate_model_version || "none")}</div>
          </div>
          <div class="theme-count">\${report.leaders.by_pass_rate === item.family ? "leader" : item.passed_count + "/" + item.evaluated_count}</div>
        </div>\`).join("") : '<div class="helper">No family-level promotion analytics yet.</div>';
    };

    const renderPromotionPatterns = (report) => {
      promotionPatternList.innerHTML = report.patterns.length ? report.patterns.slice(0, 8).map((item) => \`
        <div class="theme-row">
          <div>
            <div class="theme-name">\${escapeHtml(item.label)}</div>
            <div class="helper">\${escapeHtml(item.category)} | pass rate \${formatPercent(item.pass_rate)} | trend \${escapeHtml(item.trend_signal)} | families \${escapeHtml(item.families.join(", "))}</div>
            <div class="helper">score \${formatSignedPercent(item.average_total_score_delta)} | direction \${formatSignedPercent(item.average_direction_accuracy_delta)} | wrong \${formatSignedPercent(item.average_wrong_rate_delta)} | calibration \${formatSignedPercent(item.average_calibration_alignment_delta)}</div>
          </div>
          <div class="theme-count">\${report.leaders.by_pass_rate === item.pattern_key ? "leader" : item.passed_count + "/" + item.sample_count}</div>
        </div>\`).join("") : '<div class="helper">No tuning-pattern analytics yet.</div>';
    };

    const renderPipeline = (pipeline) => {
      pipelineList.innerHTML = pipeline.items.length ? pipeline.items.map((item) => \`
        <div class="chain-card">
          <div class="chain-head">
            <div>
              <div class="chain-title">\${escapeHtml(item.source.title)}</div>
              <div class="meta">\${escapeHtml(item.source.source_type)} | \${escapeHtml(item.prediction.horizon)} | created \${escapeHtml(formatDate(item.prediction.created_at))}</div>
            </div>
            <div class="chip \${verdictClass(item.lesson?.verdict || null)}">\${escapeHtml(item.lesson?.verdict || item.prediction.status)}</div>
          </div>

          <div class="stage-grid">
            <div class="stage">
              <div class="stage-label">Source</div>
              <div class="stage-title">\${escapeHtml(item.source.title)}</div>
              <div class="stage-copy">\${escapeHtml(item.source.raw_text_excerpt)}</div>
              <div class="meta">\${escapeHtml(item.source.speaker || "no speaker")} | \${escapeHtml(formatDate(item.source.occurred_at))}</div>
            </div>

            <div class="stage">
              <div class="stage-label">Event</div>
              <div class="stage-title">\${escapeHtml(item.event.summary)}</div>
              <div class="chip-row">\${item.event.themes.map((theme) => \`<div class="chip">\${escapeHtml(theme)}</div>\`).join("")}</div>
              <div class="meta" style="margin-top:10px;">sentiment \${escapeHtml(item.event.sentiment)} | urgency \${formatPercent(item.event.urgency_score)} | novelty \${formatPercent(item.event.novelty_score)}</div>
            </div>

            <div class="stage">
              <div class="stage-label">Analogs</div>
              \${item.analogs.length ? \`<div class="list">\${item.analogs.map((analog) => \`
                <div class="list-item">
                  <strong>\${escapeHtml(analog.event_summary)}</strong><br>
                  similarity \${formatPercent(analog.similarity)} | \${escapeHtml(analog.horizon)} | \${escapeHtml(analog.verdict || "unreviewed")}
                  \${analog.lesson_summary ? \`<br>\${escapeHtml(analog.lesson_summary)}\` : ""}
                </div>\`).join("")}</div>\` : '<div class="helper">No reviewed analogs available for this case yet.</div>'}
            </div>

            <div class="stage">
              <div class="stage-label">Prediction</div>
              <div class="stage-title">\${escapeHtml(item.prediction.thesis)}</div>
              <div class="meta">confidence \${formatPercent(item.prediction.confidence)} | status \${escapeHtml(item.prediction.status)}</div>
              <div class="chip-row" style="margin-top:10px;">\${item.prediction.assets.map((asset) => \`<div class="chip">\${escapeHtml(asset.ticker)} \${escapeHtml(asset.expected_direction)} \${asset.expected_magnitude_bp}bp</div>\`).join("")}</div>
              <div class="list" style="margin-top:10px;">\${item.prediction.evidence.slice(0, 3).map((line) => \`<div class="list-item">\${escapeHtml(line)}</div>\`).join("")}</div>
            </div>

            <div class="stage">
              <div class="stage-label">Outcome</div>
              \${item.outcome ? \`
                <div class="stage-title">score \${formatPercent(item.outcome.total_score)}</div>
                <div class="meta">direction \${formatPercent(item.outcome.direction_score)} | magnitude \${formatPercent(item.outcome.magnitude_score)} | timing \${formatPercent(item.outcome.timing_score)}</div>
                <div class="meta" style="margin-top:10px;">measured \${escapeHtml(formatDate(item.outcome.measured_at))}</div>
              \` : '<div class="helper">Outcome not measured yet.</div>'}
            </div>

            <div class="stage">
              <div class="stage-label">Lesson</div>
              \${item.lesson ? \`
                <div class="chip \${item.lesson.lesson_type === "reinforcement" ? "good" : "bad"}">\${escapeHtml(item.lesson.lesson_type)}</div>
                <div class="stage-copy" style="margin-top:10px;">\${escapeHtml(item.lesson.lesson_summary)}</div>
                \${item.lesson.critique ? \`<div class="list-item">\${escapeHtml(item.lesson.critique)}</div>\` : ""}
              \` : '<div class="helper">No lesson stored yet.</div>'}
            </div>

            <div class="stage">
              <div class="stage-label">Calibration</div>
              <div class="stage-title">\${escapeHtml(item.calibration.confidence_bucket)}</div>
              <div class="chip \${signalClass(item.calibration.signal)}">\${escapeHtml(item.calibration.signal)}</div>
              <div class="meta" style="margin-top:10px;">confidence \${formatPercent(item.calibration.confidence)} | realized \${formatPercent(item.calibration.realized_accuracy)}</div>
              <div class="meta">gap \${formatSignedPercent(item.calibration.calibration_gap)}</div>
            </div>
          </div>
        </div>\`).join("") : '<div class="helper">No pipeline activity yet. Seed or create reviewed cases to populate the desk.</div>';
    };

    window.financeOps = {
      acknowledgeAlert: async (alertId) => {
        await postJson("/v1/operations/evolution/alerts/" + encodeURIComponent(alertId) + "/acknowledge");
        await loadDashboard();
      },
      snoozeAlert: async (alertId) => {
        await postJson("/v1/operations/evolution/alerts/" + encodeURIComponent(alertId) + "/snooze", {
          duration_hours: 24
        });
        await loadDashboard();
      },
      handleAlert: async (alertId) => {
        await postJson("/v1/operations/evolution/alerts/" + encodeURIComponent(alertId) + "/handle");
        await loadDashboard();
      },
      approveAction: async (actionId) => {
        await postJson("/v1/operations/evolution/actions/" + encodeURIComponent(actionId) + "/approve");
        await loadDashboard();
      },
      blockAction: async (actionId) => {
        await postJson("/v1/operations/evolution/actions/" + encodeURIComponent(actionId) + "/block");
        await loadDashboard();
      }
    };

    async function runSearch(query) {
      searchResults.classList.add("loading");
      try {
        const payload = await fetch("/v1/lessons/search?q=" + encodeURIComponent(query)).then((response) => response.json());
        searchResults.innerHTML = payload.results.length ? payload.results.map((item) => \`
          <div class="search-result">
            <strong>\${escapeHtml(item.lesson_summary)}</strong>
            <div class="meta">semantic score \${formatPercent(item.score)} | \${escapeHtml(item.horizon)} | \${escapeHtml(item.lesson_type)}</div>
            <div class="helper" style="margin-top:8px;">\${escapeHtml(item.event_summary)}</div>
            <div class="chip-row" style="margin-top:10px;">\${item.themes.map((theme) => \`<div class="chip">\${escapeHtml(theme)}</div>\`).join("")}</div>
          </div>\`).join("") : '<div class="helper">No matching lessons found.</div>';
      } finally {
        searchResults.classList.remove("loading");
      }
    }

    async function loadDashboard() {
      const [summary, benchmark, operationalDashboard, calibration, calibrationHistory, historicalLibraryCoverage, historicalLibraryGaps, highConfidenceCandidates, modelComparison, lineage, lineageHistory, evolutionTrends, growthAlerts, growthAlertHistory, growthActions, promotionHistory, promotionAnalytics, promotionPatterns, pipeline] = await Promise.all([
        fetch("/v1/dashboard/summary").then((response) => response.json()),
        fetch("/v1/dashboard/benchmarks?benchmark_pack_id=" + encodeURIComponent(benchmarkPackId)).then((response) => response.json()),
        fetch("/v1/dashboard/operations").then((response) => response.json()),
        fetch("/v1/metrics/calibration").then((response) => response.json()),
        fetch("/v1/metrics/calibration/history?limit=6").then((response) => response.json()),
        fetch("/v1/metrics/historical-library?top=6").then((response) => response.json()),
        fetch("/v1/metrics/historical-library/gaps").then((response) => response.json()),
        fetch("/v1/metrics/historical-library/high-confidence-candidates?limit=6").then((response) => response.json()),
        fetch("/v1/metrics/models").then((response) => response.json()),
        fetch("/v1/metrics/lineage").then((response) => response.json()),
        fetch("/v1/metrics/lineage/history?limit=6").then((response) => response.json()),
        fetch("/v1/metrics/evolution/trends").then((response) => response.json()),
        fetch("/v1/metrics/evolution/alerts").then((response) => response.json()),
        fetch("/v1/metrics/evolution/alerts/history?limit=12").then((response) => response.json()),
        fetch("/v1/metrics/evolution/actions?limit=12").then((response) => response.json()),
        fetch("/v1/metrics/promotions?limit=6").then((response) => response.json()),
        fetch("/v1/metrics/promotions/analytics").then((response) => response.json()),
        fetch("/v1/metrics/promotions/patterns").then((response) => response.json()),
        fetch("/v1/dashboard/pipeline").then((response) => response.json())
      ]);

      renderStats(summary, calibration, historicalLibraryCoverage, benchmark);
      renderLiveStreams(summary);
      renderThemes(summary);
      renderHistoricalLibraryCoverage(historicalLibraryCoverage);
      renderHistoricalLibraryGaps(historicalLibraryGaps);
      renderHighConfidenceCandidates(highConfidenceCandidates);
      renderBenchmarkMission(benchmark);
        renderBenchmarkFamilies(benchmark);
        renderBenchmarkAlerts(benchmark);
        renderBenchmarkWarnings(benchmark);
        renderBenchmarkTrustRefreshes(benchmark);
        renderSystemOperations(operationalDashboard.operations);
        renderSystemQueue(operationalDashboard.queue);
        renderSystemQueueAlerts(operationalDashboard.queue_alerts);
        renderSystemIncidents(operationalDashboard.incidents);
        renderSystemWorkers(operationalDashboard.workers);
        renderSystemWorkerServices(operationalDashboard.worker_services);
        renderSystemWorkerServiceTrends(operationalDashboard.worker_service_trends);
        renderSystemWorkerTrends(operationalDashboard.worker_trends);
        renderSystemIntegrations(operationalDashboard.integrations);
        renderSystemIntegrationProbes(operationalDashboard.integration_probes);
        renderSystemIntegrationGovernance(operationalDashboard.integration_governance);
        renderSystemIntegrationTrends(operationalDashboard.integration_trends);
        renderWalkForwardPromotions(benchmark);
        renderWalkForwardRegimes(benchmark);
        renderBenchmarkStability(benchmark.benchmark_stability);
      renderCalibration(calibration);
      renderCalibrationHistory(calibrationHistory);
      renderModelLeaderboard(modelComparison);
      renderLineage(lineage);
      renderLineageHistory(lineageHistory);
      renderEvolutionTrends(evolutionTrends);
      renderGrowthAlerts(growthAlerts);
      renderGrowthAlertHistory(growthAlertHistory);
      renderGrowthActions(growthActions);
      renderPromotionHistory(promotionHistory);
      renderPromotionFamilies(promotionAnalytics);
      renderPromotionPatterns(promotionPatterns);
      renderPipeline(pipeline);
    }

    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = searchInput.value.trim();
      if (!query) return;
      runSearch(query);
    });

    loadDashboard();
    runSearch(searchInput.value);
  </script>
</body>
</html>`;
