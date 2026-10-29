// Paywall is display-only for the MVP: limits are shown, nothing is blocked.
export const PLANS = [
  { id: "free", name: "Free", price: "₹0", per: "", profiles: 1, docs: 10, features: ["1 profile", "10 documents", "Adaptive dashboard", "Trends with medicine markers"] },
  { id: "pro", name: "Pro", price: "₹149", per: "/month", profiles: 1, docs: Infinity, features: ["Unlimited documents", "Doctor-visit summaries (PDF)", "Ask your records", "Priority MedGemma reading"] },
  { id: "family", name: "Family", price: "₹299", per: "/month", profiles: 5, docs: Infinity, features: ["Up to 5 profiles (parents, kids)", "Everything in Pro", "Caregiver view for elderly parents", "Simple large-text mode per person"] },
] as const;
export const FREE = PLANS[0];
