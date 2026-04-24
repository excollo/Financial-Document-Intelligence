import mongoose from "mongoose";

const domainSchema = new mongoose.Schema({
  domainId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  domainName: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ["active", "suspended", "deleted"],
    default: "active",
    index: true,
  },


  // ── Feature Toggles ──
  investor_match_only: { type: Boolean, default: false },
  valuation_matching: { type: Boolean, default: false },
  adverse_finding: { type: Boolean, default: false },
  news_monitor_enabled: { type: Boolean, default: false },
  monitored_companies: { type: [String], default: [] },
  target_investors: {
    type: [String],
    default: ["Adheesh Kabra", "Shilpa Kabra", "Rishi Agarwal", "Aarth AIF", "Aarth AIF Growth Fund", "Chintan Shah", "Sanjay Popatlal Jain", "Manoj Agrawal", "Rajasthan Global Securities Private Limited", "Finavenue Capital Trust", "SB Opportunities Fund", "Smart Horizon Opportunity Fund", "Nav Capital Vcc - Nav Capital Emerging", "Invicta Continuum Fund", "HOLANI VENTURE CAPITAL FUND - HOLANI 1. VENTURE CAPITAL FUND 1", "MERU INVESTMENT FUND PCC- CELL 1", "Finavenue Growth Fund", "Anant Aggarwal", "PACE COMMODITY BROKERS PRIVATE LIMITED", "Bharatbhai Prahaladbhai Patel", "ACCOR OPPORTUNITIES TRUST", "V2K Hospitality Private Limited", "Mihir Jain", "Rajesh Kumar Jain", "Vineet Saboo", "Prabhat Investment Services LLP", "Nikhil Shah", "Nevil Savjani", "Yogesh Jain", "Shivin Jain", "Pushpa Kabra", "KIFS Dealer", "Jitendra Agrawal", "Komalay Investrade Private Limited", "Viney Equity Market LLP", "Nitin Patel", "Pooja Kushal Patel", "Gitaben Patel", "Rishi Agarwal HUF", "Sunil Singhania", "Mukul mahavir Agrawal", "Ashish Kacholia", "Lalit Dua", "Utsav shrivastav"]
  },

  // ── SOP Storage (populated by Onboarding Agent) ──
  sop_text: { type: String, default: "" },

  // ── Onboarding Agent Outputs (Prompts & Subqueries per SOP) ──
  agent1_prompt: { type: String, default: "" },
  agent1_subqueries: { type: [String], default: [] },
  
  agent2_prompt: { type: String, default: "" },
  agent2_subqueries: { type: [String], default: [] },
  
  agent3_prompt: { type: String, default: "" },
  agent3_subqueries: { type: [String], default: [] },
  
  agent4_prompt: { type: String, default: "" },
  agent4_subqueries: { type: [String], default: [] },
  
  agent5_prompt: { type: String, default: "" },
  agent5_subqueries: { type: [String], default: [] },
  
  agent6_prompt: { type: String, default: "" },
  agent6_subqueries: { type: [String], default: [] },
  
  agent7_prompt: { type: String, default: "" },
  agent7_subqueries: { type: [String], default: [] },
  
  agent8_prompt: { type: String, default: "" },
  agent8_subqueries: { type: [String], default: [] },
  
  agent9_prompt: { type: String, default: "" },
  agent9_subqueries: { type: [String], default: [] },

  subquery_analysis: { type: mongoose.Schema.Types.Mixed, default: {} },
  subquery_changes_log: { type: [String], default: [] },

  matched_investors: { type: mongoose.Schema.Types.Mixed, default: [] },
  health_alert_recipients: { type: [String], default: [] },
  health_alert_updated_by: { type: String, default: null },
  health_check_toggles: {
    mongodb: { type: Boolean, default: true },
    brevo: { type: Boolean, default: true },
    azure_storage: { type: Boolean, default: true },
    ai_platform: { type: Boolean, default: true },
    external_ai: {
      openai: { type: Boolean, default: true },
      pinecone: { type: Boolean, default: true },
      cohere: { type: Boolean, default: true },
      perplexity: { type: Boolean, default: false },
      serper: { type: Boolean, default: true },
    },
  },

  // ── Onboarding Metadata ──
  onboarding_status: {
    type: String,
    enum: ["pending", "processing", "completed", "completed_no_sop", "failed"],
    default: "pending",
  },
  last_onboarded: { type: Date, default: null },
});

// Generate domainId before saving
domainSchema.pre("save", async function (next) {
  if (!this.domainId) {
    // Generate domainId from domainName (slug format)
    const slug = this.domainName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    this.domainId = `domain_${slug}_${Date.now()}`;
  }
  this.updatedAt = new Date();
  next();
});

// Index for efficient queries
domainSchema.index({ domainName: 1, status: 1 });
domainSchema.index({ domainId: 1, status: 1 });

export const Domain = mongoose.model("Domain", domainSchema);
