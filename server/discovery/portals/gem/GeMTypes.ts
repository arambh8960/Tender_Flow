/** GeM-specific shapes. Must not leak past GeMNormalizer. */
export interface GeMRawCard {
  bidNumber: string;
  /** Item text as read from the card. Empty when unreadable. */
  itemsText: string;
  orgName: string;
  endDateText: string;
  consigneeLocation: string;
  detailUrl: string;
  emdText: string;
  parseWarnings: string[];
}

export interface GeMAdvancedParams {
  activeTab: 'BID_DETAILS' | 'MINISTRY' | 'LOCATION' | 'BOQ';
  bidNo?: string;
  ministry?: string;
  organization?: string;
  state?: string;
  city?: string;
  boqTitle?: string;
  bidValue?: string;
}
