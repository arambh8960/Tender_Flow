/* =========================
   AGENT & LOGGING TYPES
========================= */

export type AgentName =
  | 'MASTER_AGENT'
  | 'PARSING_ENGINE'
  | 'TECHNICAL_AGENT'
  | 'PRICING_AGENT'
  | 'SALES_AGENT'      // Add this
  | 'DISCOVERY_AGENT'
  | 'FINALIZING_AGENT'
  | 'SYSTEM';

export type SystemAgent = 'SYSTEM';

/**
 * A compliance document as the UI sees it.
 *
 * `id` is the database uuid, not a row number, and there is no file path:
 * the file lives in private storage and is reached through a signed URL the
 * server issues per request.
 */
export interface VaultItem {
  id: string;
  cert_name: string;
  category?: 'FINANCIAL' | 'TECHNICAL' | 'LEGAL' | string | null;
  is_valid: boolean;
  expiry_date?: string | null;
  /** Derived from the expiry date server-side, never from a stale flag. */
  validityStatus?: 'valid' | 'expiring_soon' | 'expired' | 'unknown';
  hasFile?: boolean;
}

export interface LogEntry {
  timestamp: Date;
  agent: AgentName | SystemAgent;
  message: string;
  data?: any;
}

/* =========================
   INVENTORY / SKU TYPES
========================= */

export type TruckType =
  | 'MINI_TRUCK'
  | 'LCV'
  | 'MEDIUM_TRUCK'
  | 'HEAVY_TRUCK';

export interface ExtractedDocument {
  name: string;
  url: string;
}
export interface BlankDoc {
  id: string;
  name: string;
  url: string;
  status: 'DETECTED' | 'CONVERTING' | 'CONVERTED_TO_DOCX';
  type: string;
  docxUrl?: string;
}
export interface AddItemModalProps {
  onClose: () => void;
  onSave: (item: SKU) => void;
  existingItem?: SKU; // <--- ADD THIS LINE
}
export interface SKU {
  skuId: string;
  productName: string;
  productCategory: string;
  productSubCategory: string;
  oemBrand: string;

  /**
   * Key-value specs like:
   * { "Diameter": "20mm", "Grade": "SS304" }
   */
  specification: Record<string, string>;

  availableQuantity: number;

  warehouseLocation: string; // "City, State"
  warehouseCode: string;
  warehouseLat: number;
  warehouseLon: number;

  truckType: TruckType;
  leadTime: number; // days

  costPrice: number;
  unitSalesPrice: number;
  bulkSalesPrice: number;
  gstRate: number; // %

  brokerage?: number;
  minMarginPercent: number;

  isActive: boolean;
  isCustomMadePossible: boolean;
  isComplianceReady: boolean;

  /**
   * Used by TECHNICAL_AGENT for ranking
   */
  matchPercentage?: number;
}

/* =========================
   RFP PARSING TYPES
========================= */

export interface RfpProductLineItem {
  name: string;
  quantity: number;
  technicalSpecs: string[];

  requiredStandards?: string[];
  certifications?: CertificationCheck[];
}

export interface CertificationCheck {
  name: string;                      // ISO 9001, BIS, CE etc
  source: 'Technical Specs' | 'Buyer ATC' | 'Seller Docs' | 'Unknown';
  verified: boolean;                 // human verification
}

export interface UserData {
  email: string;
  is_setup_complete: boolean;
  has_pin: boolean;
}

export type OnboardingStep = 'NONE' | 'PIN_SETUP' | 'TWO_FA_BIND';

export interface ParsedRfpData {
  metadata: {
    bidNumber: string;
    issuingOrganization: string;
    bidType: string;
    bidEndDate: string; // ISO string
    offerValidity: number; // days
    deliveryDays?: number;
    itemCategory?: string;
    totalQuantity?: number;
    officeName?: string;
    isBidClosed?: boolean;
    epbgPercent?: number;
    emdAmount?: number;
    epbgAmount?: number;
  };

  products: RfpProductLineItem[];
buyer_added_terms?: string[];
  mandatoryDocuments: string[];
  extractedLinks?: ExtractedDocument[];

financialConditions: FinancialConditions;

  eligibilityCriteria?: {
    localSupplierClass?: string;
    turnoverRequirement?: string;
    qualityCertifications?: string[];
    sampleApprovalClause?: string;
    optionClause?: string;
  };

  consignee: string;
}

/* =========================
   TECHNICAL ANALYSIS TYPES
========================= */

/**
 * Outcome of checking one tender requirement against one SKU attribute.
 *
 * `status` records what the evidence actually shows. There is deliberately
 * no `verified: boolean`: the old shape set it to true for every requirement
 * whenever the aggregate score was high enough, which told the user a
 * standard had been confirmed when nothing had checked it.
 */
export type ComplianceCheckStatus =
  | 'MATCHED'
  | 'PARTIAL'
  | 'MISMATCH'
  | 'NOT_FOUND'
  | 'REQUIRES_REVIEW';

export interface ComplianceCheck {
  requirement: string;
  /** The SKU value that was compared, or null when nothing addressed it. */
  detectedValue: string | null;
  /** Which SKU attribute supplied the evidence. */
  source: string | null;
  status: ComplianceCheckStatus;
  evidence: string;
  confidence: number;
}

export interface TechnicalScoreComponents {
  categoryScore: number;
  nameScore: number;
  specificationScore: number;
  availabilityScore: number;
  total: number;
}

export interface LineItemTechnicalAnalysis {
  rfpLineItem: RfpProductLineItem;
  top3Recommendations: SKU[];
  /** Null when no candidate cleared the match threshold. */
  selectedSku: SKU | null;
  status: 'COMPLETE' | 'PARTIAL' | 'NONE';
  matchPercentage: number;
  technicalReasoning: string;
  scoreComponents?: TechnicalScoreComponents | null;
  complianceChecks: ComplianceCheck[];
}
export interface DiscoveryFilters {
  manualAvgKms: number;
  manualRatePerKm: number;
  deliveryType?: 'Pan India' | 'Intra State' | 'Zonal';
  allowEMD: boolean;
  categories?: string[];
  minMatchThreshold: number; // The 20% rule implementation

  /** Skip qualification gates entirely (used by background auto-discovery). */
  bypassFilters?: boolean;
}

/** Parameters for GeM's own advanced-search form. */
export interface AdvancedSearchParams {
  searchMode: 'ADVANCED';
  activeTab: 'BID_DETAILS' | 'MINISTRY' | 'LOCATION' | 'BOQ';
  bidNo?: string;
  ministry?: string;
  organization?: string;
  state?: string;
  city?: string;
  boqTitle?: string;
  bidValue?: string;
}

export type DiscoveryRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface DiscoveryRunSummary {
  status: DiscoveryRunStatus;
  portal: string;
  startedAt: string;
  completedAt: string;
  totalFound: number;
  totalQualified: number;
  /** Per-scope failures. A non-empty list with results means a partial run. */
  errors: { scope: string; message: string }[];
}

export interface DiscoveryResult {
  tenders: Tender[];
  summary: DiscoveryRunSummary;
}

/**
 * Whether `distance` was measured or assumed.
 * 'assumed'  — the operator's average-haul slider value.
 * 'computed' — a real warehouse -> consignee distance from the maps provider.
 */
export type DistanceSource = 'assumed' | 'computed';

export interface Tender {
  id: string;
  title: string;
  org: string;
  endDate: string;
  category: string;
  url: string;
  emdRequired: boolean;
  consigneeLocation: string;
  distance?: number;
  distanceSource?: DistanceSource;
  estimatedLogisticsCost?: number;
  matchScore?: number;
  inStock?: boolean;
  isQualified?: boolean;
  risk: 'Low' | 'Medium' | 'High';
}
/* =========================
   CORE RFP ENTITY
========================= */
export interface TechnicalAgentOutput {
  itemAnalyses: LineItemTechnicalAnalysis[];
}
export interface FinancialAgentResult {
  pricing: Record<string, number>;
  summary: {
    matchStatus: 'COMPLETE' | 'PARTIAL' | 'NONE';
    confidenceScore: number;
    requiresManualInput: boolean;
    recommendation: string;
    finalBidValue: number;
  };
  riskEntries: {
    category: "Financial" | "Logistics";
    statement: string;
    riskLevel: "Low" | "Medium" | "High";
  }[];
}
export type RfpStatus =
  | 'Pending'
  | 'Extracting'
  | 'Parsing'
  | 'Processing'
  | 'Complete'
  | 'Error';

export interface Rfp {
  id: string;

  // Tender-specific fields (often populated by Discovery Agent)
  organisation: string;
  bidType: string;
  closingDate: Date;
  
  // High-level metadata
  status: RfpStatus;
  rawDocument: string; // Original text or URL content

  // Source tracking
  source: 'URL' | 'File';
  fileName?: string; // Original filename or Tender ID
  
  // AGENTIC UPDATES: State tracking for processing
  activeAgent?: AgentName; 
  processingDuration?: number; // In seconds
  
  // Storage for the structured data returned by agents
  agentOutputs?: {
    parsedData?: any;      // Results from Parsing Engine
    technicalAnalysis?: TechnicalAgentOutput | null; 
    // CHANGE 'pricingAnalysis' to 'pricing'
    pricing?: FinancialAgentResult | null;
  };

  ingestionStatus?: {
    detected: boolean;
    encodingWarning: boolean;
    ocrFallback: boolean;
    extracted: boolean;
  };
}
/* =========================
   APP CONFIGURATION
========================= */

export interface CompanyConfig {
  companyName: string;
  companyAddress: string;
  gstin: string;
  pan: string;
  domain: string;
  turnover: string;          
  turnoverYear: string;          
  oemStatus:string;

}
export interface FinancialConditions {
  epbg: string;
  emd: string;
  paymentTerms: string;
}

export interface SigningAuthority {
  id: string;
  name: string;
  designation: string;
  din: string;
}

export interface AppConfig {
  companyDetails: CompanyConfig;
  signingAuthorities: SigningAuthority[];
  discoveryFilters: {
    allowEMD: boolean;
    minMatchThreshold: number;
    categories: [string];
    manualAvgKms: number;
    manualRatePerKm: number;
  };
}

/* =========================
   UI STATE
========================= */

export type View =
  | 'frontpage'
  | 'rfps'
  | 'organization'
  | 'store'
  | 'config'
  | 'logs'
  | 'processing'
  | 'discovery'
  | 'advanced_search'
  | 'vault'
  | 'final_recommendation'
  | 'analysis';