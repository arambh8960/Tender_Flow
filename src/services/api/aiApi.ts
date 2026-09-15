import { api } from './client';

export interface MarketData {
  insights: string[];
  commodities: { symbol: string; name: string; price: string; trend: string; up: boolean }[];
}

export const aiApi = {
  copilot: (query: string, context: unknown, history: unknown[]) =>
    api.post<{ reply: string }>('/api/copilot-chat', { query, context, history }),

  marketInsights: () =>
    api.get<{ success: boolean; stale?: boolean; data: MarketData }>('/api/market-insights'),
};
