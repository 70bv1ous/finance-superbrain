import { describe, expect, it } from "vitest";

import { parseFinanceEvent } from "./parseFinanceEvent.js";

describe("parseFinanceEvent", () => {
  it("extracts China and tariff-driven market implications from live commentary", () => {
    const parsed = parseFinanceEvent({
      source_type: "transcript",
      title: "BBC live interview",
      speaker: "Donald Trump",
      raw_text:
        "Donald Trump said live on BBC that tariffs on China could rise and that the yuan has been weakening, which may pressure Chinese tech stocks.",
    });

    expect(parsed.event_class).toBe("policy_speech");
    expect(parsed.sentiment).toBe("risk_off");
    expect(parsed.themes).toEqual(expect.arrayContaining(["trade_policy", "china_risk"]));
    expect(parsed.candidate_assets).toEqual(expect.arrayContaining(["KWEB", "USD/CNH"]));
  });

  it("marks supportive easing language as risk-on", () => {
    const parsed = parseFinanceEvent({
      source_type: "headline",
      title: "Central bank hints at more support",
      raw_text:
        "The central bank signaled a rate cut and more stimulus support, boosting growth expectations across equities.",
    });

    expect(parsed.sentiment).toBe("risk_on");
    expect(parsed.themes).toEqual(expect.arrayContaining(["rates", "stimulus"]));
    expect(parsed.candidate_assets).toEqual(expect.arrayContaining(["SPY", "QQQ"]));
  });

  it("treats guidance cuts as earnings pressure instead of generic support", () => {
    const parsed = parseFinanceEvent({
      source_type: "earnings",
      title: "Retailer cuts guidance",
      raw_text:
        "The retailer cut guidance after soft demand and margin pressure, warning that consumer traffic remains weak.",
    });

    expect(parsed.event_class).toBe("earnings_commentary");
    expect(parsed.sentiment).toBe("risk_off");
    expect(parsed.themes).toEqual(
      expect.arrayContaining(["earnings_guidance", "consumer_demand", "margin_pressure"]),
    );
  });

  it("uses safer keyword matching so unrelated words do not trigger false themes", () => {
    const parsed = parseFinanceEvent({
      source_type: "headline",
      title: "Loyalty reward program expands",
      raw_text:
        "A retailer expanded its customer reward program and loyalty benefits for shoppers in a purely commercial update with no policy angle.",
    });

    expect(parsed.themes).not.toContain("defense");
    expect(parsed.candidate_assets).not.toEqual(expect.arrayContaining(["ITA", "LMT"]));
  });
});
