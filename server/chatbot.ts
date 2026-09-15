import Groq from "groq-sdk";

/**
 * The Groq client is created on first use, not at import time.
 *
 * Constructing it eagerly threw when GROQ_API_KEY was absent, which took the
 * whole process down at startup — a missing optional provider key must
 * degrade one feature, not prevent the server from booting.
 */
let groqClient: Groq | null = null;

function groqOrThrow(): Groq {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured on this deployment.');
  }
  if (!groqClient) groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

export async function getHelperBotResponse(query: string, context: any, history: any[]) {
  // Define the system personality and context awareness
  const systemPrompt = {
    role: "system" as const,
    content: `You are the TenderFlow Copilot, an expert AI assistant for Government Tenders (GeM).
      
      ${context ? `
      CURRENT RFP CONTEXT:
      - Organization: ${context.org}
      - Bid ID: ${context.id}
      - Parsed Data: ${JSON.stringify(context.parsedData).slice(0, 3000)}...
      - Financials: ${JSON.stringify(context.financials)}
      ` : "User is on the dashboard. No specific RFP selected."}

      INSTRUCTIONS:
      1. Answer the user's query briefly and professionally.
      2. If they ask about the current RFP, use the provided context.
      3. If they ask a general question (e.g., "What is EMD?"), answer using your internal knowledge of GeM rules.
      4. Keep answers under 4 sentences unless detailed analysis is requested.
      5. Do not use markdown headers; use bolding for emphasis.`
  };

  try {
    const completion = await groqOrThrow().chat.completions.create({
      messages: [
        systemPrompt,
        ...history.map(m => ({
          role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
          content: m.content
        })),
        { role: "user", content: query }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.6,
    });

    return completion.choices[0]?.message?.content || "No response received.";
  } catch (error: any) {
    console.error("Groq Chatbot Error:", error);
    throw error;
  }
}