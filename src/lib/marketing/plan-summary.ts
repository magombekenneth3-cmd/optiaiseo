export const PUBLIC_PLAN_SUMMARIES = {
  FREE: {
    name: "Free",
    price: { monthly: "$0", annual: "$0" },
    monthlyCredits: 50,
    limits: { sites: 1, audits: 5, blogs: 3, aeoChecks: 3 },
  },
  STARTER: {
    name: "Starter",
    price: { monthly: "$19", annual: "$15" },
    monthlyCredits: 150,
    limits: { sites: 3, audits: 15, blogs: 30, aeoChecks: 10 },
  },
  PRO: {
    name: "Pro",
    price: { monthly: "$49", annual: "$39" },
    monthlyCredits: 500,
    limits: { sites: 10, audits: 50, blogs: 300, aeoChecks: 50 },
  },
  AGENCY: {
    name: "Agency",
    price: { monthly: "$149", annual: "$119" },
    monthlyCredits: 2000,
    limits: { sites: -1, audits: -1, blogs: -1, aeoChecks: -1 },
  },
} as const;
