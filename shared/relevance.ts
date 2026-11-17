const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "that", "the", "this", "to", "with", "all",
]);

/**
 * Explicit, reviewable synonym groups. The commerce group intentionally connects
 * payment/card interests to offer language (e.g. "5% off"), while unrelated
 * domains remain disjoint. Additions should be driven by measured feedback.
 */
export const SYNONYM_GROUPS = [
  {
    id: "commerce-offer",
    label: "payments and offers",
    terms: [
      "upi", "payment", "payments", "card", "cards", "wallet", "cashback",
      "discount", "offer", "offers", "promotion", "promotional", "promo",
      "deal", "deals", "coupon", "coupons", "rebate", "reward", "rewards", "off",
    ],
  },
  {
    id: "food-delivery",
    label: "food and delivery",
    terms: ["food", "meal", "meals", "restaurant", "restaurants", "delivery", "deliveries", "takeaway"],
  },
  {
    id: "processor",
    label: "processors",
    terms: ["cpu", "processor", "processors", "central", "processing"],
  },
  {
    id: "memory",
    label: "memory",
    terms: ["ram", "memory", "dram"],
  },
  {
    id: "graphics",
    label: "graphics hardware",
    terms: ["gpu", "graphics", "graphic", "video-card", "videocard"],
  },
  {
    id: "solid-state-storage",
    label: "solid-state storage",
    terms: ["ssd", "nvme", "m2", "solid-state", "solidstate"],
  },
] as const;

const termToGroup = new Map<string, (typeof SYNONYM_GROUPS)[number]>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group.terms) termToGroup.set(term, group);
}

export const SYNONYM_MAP_VERSION = "1";

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function extractTerms(values: string | readonly string[]): string[] {
  const source = typeof values === "string" ? [values] : values;
  const terms = new Set<string>();
  for (const value of source) {
    for (const token of normalizeText(value).split(/\s+/)) {
      if (token.length < 2 || STOP_WORDS.has(token)) continue;
      terms.add(token);
    }
  }
  return [...terms].sort();
}

export function canonicalGroup(term: string): string {
  return termToGroup.get(term)?.id ?? term;
}

export function expandTerm(term: string): string[] {
  const group = termToGroup.get(term);
  return group ? [...group.terms] : [term];
}

export function expandTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.flatMap(expandTerm))].sort();
}

export type RelevanceInput = {
  postTerms: readonly string[];
  positiveTerms: readonly string[];
  negativeTerms: readonly string[];
  threshold: number;
};

export type RelevanceResult = {
  relevant: boolean;
  score: number;
  matchedTopics: string[];
  excludedBy: string[];
  reason: string;
};

/** Score is an integer from 0–1000; threshold uses the same basis. */
export function scoreRelevance(input: RelevanceInput): RelevanceResult {
  const postGroups = new Set(input.postTerms.map(canonicalGroup));
  const positiveGroups = new Set(input.positiveTerms.map(canonicalGroup));
  const negativeGroups = new Set(input.negativeTerms.map(canonicalGroup));
  const excludedBy = [...negativeGroups].filter((group) => postGroups.has(group)).sort();

  if (excludedBy.length > 0) {
    const labels = excludedBy.map((group) => topicLabel(group, input.negativeTerms));
    return {
      relevant: false,
      score: 0,
      matchedTopics: [],
      excludedBy: labels,
      reason: `Excluded by negative interests: ${labels.join(", ")}`,
    };
  }

  if (positiveGroups.size === 0 || postGroups.size === 0) {
    return {
      relevant: false,
      score: 0,
      matchedTopics: [],
      excludedBy: [],
      reason: "No positive indexed interests matched this post.",
    };
  }

  const matched = [...positiveGroups].filter((group) => postGroups.has(group)).sort();
  if (matched.length === 0) {
    return {
      relevant: false,
      score: 0,
      matchedTopics: [],
      excludedBy: [],
      reason: "No positive indexed interests matched this post.",
    };
  }

  const coverage = matched.length / positiveGroups.size;
  const density = matched.length / postGroups.size;
  const score = Math.min(1000, Math.round((coverage * 0.75 + density * 0.25) * 1000));
  const matchedTopics = matched.map((group) => topicLabel(group, input.positiveTerms));
  const reason = `Matched interests: ${matchedTopics.join(", ")} (${score}/1000; threshold ${input.threshold}/1000).`;

  return {
    relevant: score >= input.threshold,
    score,
    matchedTopics,
    excludedBy: [],
    reason,
  };
}

function topicLabel(groupId: string, sourceTerms: readonly string[]): string {
  const group = SYNONYM_GROUPS.find((candidate) => candidate.id === groupId);
  if (!group) return sourceTerms.find((term) => canonicalGroup(term) === groupId) ?? groupId;
  if (groupId === "commerce-offer") {
    const preferred = ["payments", "payment", "cards", "card", "upi", "cashback", "offer", "discount"];
    return preferred.find((term) => sourceTerms.includes(term)) ?? group.label;
  }
  return group.label;
}
