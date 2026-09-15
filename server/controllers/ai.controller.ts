import { Request, Response } from 'express';
import { getHelperBotResponse } from '../chatbot.js';
import { getMarketInsights } from '../services/market/marketInsights';
import { fail } from '../middleware/errorHandler';

export async function copilotChat(req: Request, res: Response) {
  const { query, context, history } = req.body;

  if (!query || typeof query !== 'string') {
    return fail(res, 400, 'INVALID_REQUEST', 'A query is required.');
  }

  try {
    const reply = await getHelperBotResponse(query, context ?? null, Array.isArray(history) ? history : []);
    return res.json({ reply });
  } catch (err: any) {
    console.error('Copilot Error:', err.message);
    return res.status(502).json({ reply: 'I encountered a processing error. Please try again.' });
  }
}

export async function marketInsights(_req: Request, res: Response) {
  const { data, stale } = await getMarketInsights();
  // Always 200 with data; `stale` tells the client the figures are a fallback.
  return res.json({ success: !stale, stale, data });
}
