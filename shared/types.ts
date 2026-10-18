// Source of truth for the Conjure API contract.
// Mirrored in api/schemas.py — change both together.

export type AttrValue = string | number | boolean;

export type Product = {
  id: string;
  title: string;
  brand: string;
  price: number;
  image: string;
  subcategory: string; // "moisturizer" | "cleanser" | "sunscreen" | "serum" ...
  attributes: Record<string, AttrValue>; // fragrance_free, skin_type, spf, size_ml
  rating_listed: number;
  review_count: number;
  summary: string;
  merchant_id: string;
};

export type FitTerms = {
  semantic: number;
  attribute_match: number;
  trust: number;
  feedback: number;
};

/** Search result: a Product plus why it ranked where it did. */
export type RankedProduct = Product & {
  fit_percent: number;
  reasons: string[]; // top two, human readable
  fit_terms: FitTerms; // for "Why am I seeing this?"
};

export type SignalKey =
  | "velocity"
  | "duplicates"
  | "distribution"
  | "verified"
  | "consistency";

export type TrustSignal = {
  key: SignalKey;
  value: number;
  subscore: number;
  detail: string;
};

export type SecurityFlag = {
  review_id: string;
  kind: "prompt_injection";
  excerpt: string;
};

export type TrustTier = "trusted" | "mixed" | "caution" | "insufficient";

export type TrustReport = {
  product_id: string;
  score: number | null; // 0-100, null when evidence is too thin
  tier: TrustTier;
  rating_listed: number;
  rating_adjusted: number;
  signals: TrustSignal[];
  top_reasons: string[]; // computed in Python, never written by the LLM
  evidence_review_ids: string[];
  security_flags: SecurityFlag[];
  seeded_for_demo: boolean;
};

export type Provenance = "said" | "gesture" | "edited";

export type PreferenceProfile = {
  needs: string[];
  avoid: string[];
  budget_max?: number;
  skin_type?: string;
  liked_ids: string[];
  dismissed: { id: string; reason?: string }[];
  provenance: Record<string, Provenance>;
};

export type CartItem = {
  product_id: string;
  title: string;
  merchant_id: string;
  unit_price: number;
  quantity: number;
};

export type Cart = {
  items: CartItem[];
  total: number;
  currency: "usd";
  cart_hash: string;
};

export type PolicyCheck = { rule: string; passed: boolean; reason: string };
export type PolicyResult = { allowed: boolean; checks: PolicyCheck[] };

export type Tradeoff = {
  dimension: string;
  a: string;
  b: string;
  better?: "a" | "b";
};

export type UIAction =
  | { action: "show_results"; product_ids: string[]; reason: string }
  | { action: "rerank"; product_ids: string[]; changed_because: string }
  | { action: "open_detail"; product_id: string }
  | {
      action: "open_compare";
      product_ids: [string, string];
      tradeoffs: Tradeoff[];
    }
  | { action: "highlight_trust"; product_id: string }
  | { action: "update_profile"; profile: PreferenceProfile }
  | {
      action: "stage_checkout";
      product_id: string;
      cart: Cart;
      cart_payload: string;
      policy: PolicyResult;
    }
  | { action: "policy_refusal"; policy: PolicyResult }
  | { action: "say"; text: string };

export type UIContext = { visible_ids: string[]; focused_id?: string | null };

export type ChatRequest = { session_id: string; text: string; ui_context: UIContext };

export type DoneEvent = { grounded: boolean; source: "llm" | "fallback" };

/** Fields the browser signs for an intent mandate (sent as the exact JSON string). */
export type IntentMandatePayload = {
  session_id: string;
  budget_max: number;
  categories: string[];
  verified_only: boolean;
  max_quantity: number;
  autonomy: "stage";
  issued_at: string; // ISO 8601
  nonce: string;
};

export type AuditEntry = {
  ts: string;
  kind: string;
  data: Record<string, unknown>;
  prev_hash: string;
  hash: string;
};

export type AuditLog = { session_id: string; entries: AuditEntry[]; valid: boolean };
