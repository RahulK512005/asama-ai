import { describe, expect, it } from "vitest";
import { expandTerms, extractTerms, scoreRelevance } from "../../shared/relevance";

describe("relevance term normalization and scoring", () => {
  it("normalizes case, accents, punctuation, duplicate terms and stop words", () => {
    expect(extractTerms(" 5% OFF all deliveries on Diwali! Café offers "))
      .toEqual(["cafe", "deliveries", "diwali", "off", "offers"]);
  });

  it("expands the explicit payment/offer synonym group for inverted lookup", () => {
    expect(expandTerms(["payments"])).toContain("off");
    expect(expandTerms(["payments"])).toContain("cashback");
  });

  it("explains a relevant match and applies a configurable threshold", () => {
    const result = scoreRelevance({
      postTerms: ["off", "deliveries", "diwali"],
      positiveTerms: ["payments", "cards"],
      negativeTerms: [],
      threshold: 380,
    });
    expect(result.relevant).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(380);
    expect(result.reason).toContain("Matched interests");
    expect(result.matchedTopics).toEqual(["payments"]);
  });

  it("does not route unrelated interests", () => {
    const result = scoreRelevance({
      postTerms: ["off", "deliveries", "diwali"],
      positiveTerms: ["automotive", "electric-vehicle"],
      negativeTerms: [],
      threshold: 380,
    });
    expect(result.relevant).toBe(false);
    expect(result.score).toBe(0);
  });

  it("hard-excludes posts matching a negative interest", () => {
    const result = scoreRelevance({
      postTerms: ["cashback", "payments"],
      positiveTerms: ["upi"],
      negativeTerms: ["cashback"],
      threshold: 0,
    });
    expect(result.relevant).toBe(false);
    expect(result.excludedBy).toContain("cashback");
    expect(result.reason).toContain("Excluded by negative interests");
  });

  it("does not match anything when positive interests are empty", () => {
    expect(scoreRelevance({
      postTerms: ["payments"],
      positiveTerms: [],
      negativeTerms: [],
      threshold: 0,
    }).relevant).toBe(false);
  });
});
