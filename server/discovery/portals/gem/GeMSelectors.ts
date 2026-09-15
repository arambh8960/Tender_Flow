/**
 * Every GeM DOM selector, in one place.
 *
 * Portal markup changes; when it does this is the only file that needs
 * editing. Nothing outside the gem/ folder references these.
 */
export const GEM_URLS = {
  allBids: 'https://bidplus.gem.gov.in/all-bids',
  advancedSearch: 'https://bidplus.gem.gov.in/advance-search',
  bidDocument: (id: string) => `https://bidplus.gem.gov.in/showbidDocument/${id}`,
  origin: 'https://bidplus.gem.gov.in',
};

export const GEM_SELECTORS = {
  searchInput: '#searchBid',
  searchButton: '#searchBidRA',
  resultsContainer: '#bidCard',
  card: '.card',
  cardLink: 'a.bid_no_hover',
  endDate: '.end_date',
  orgName: '.org_name',
  consigneeLocation: '.consignee_location',

  select2Field: '.select2-search__field',

  tabs: {
    BID_DETAILS: '#bid-tab',
    MINISTRY: '#ministry-tab',
    LOCATION: '#location-tab',
    BOQ: '#boq-tab',
  } as Record<string, string>,

  tabSubmit: {
    BID_DETAILS: '#tab0 .btn-primary',
    MINISTRY: '#tab1 .btn-primary',
    LOCATION: '#tab2 .btn-primary',
    BOQ: '#tab3 .btn-primary',
  } as Record<string, string>,

  fields: {
    bidNo: '#bno',
    boqTitle: '#boqtitle',
    ministry: '#select2-ministry-container',
    organization: '#select2-organization-container',
    state: '#select2-state_name_con-container',
    city: '#select2-city_name_con-container',
  },
};

export const GEM_TIMEOUTS = {
  navigation: 60000,
  selector: 60000,
  results: 30000,
  settle: 1000,
};
