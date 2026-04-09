/**
 * AI Reasoning — natural language trade explanations.
 *
 * Generates a human-readable narrative for every trade decision.
 * Tries Claude → Gemini → OpenAI in order.
 * Falls back to a deterministic template if all LLMs are unavailable.
 */

import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';
import { askGeminiWithCookies } from '../data/gemini-cookie-client.js';
import type { TradeSignal } from './types.js';

const log = createLogger('AI-REASONING');

export interface ReasoningResult {
  narrative: string;
  source: 'claude' | 'gemini' | 'gemini-cookie' | 'openai' | 'template';
  latencyMs: number;
}

function buildPrompt(signal: TradeSignal, contextPrefix: string): string {
  return `${contextPrefix ? contextPrefix + '\n\n' : ''}You are the reasoning engine for Sentinel, an institutional crypto trading agent.

Explain in 2-3 clear sentences why this trade signal was generated. Be specific about the technical factors.

Signal: ${signal.direction.toUpperCase()} ${signal.strategy.replace(/_/g, ' ').toUpperCase()}
Price: $${signal.price.toFixed(4)}
Confidence: ${(signal.confidence * 100).toFixed(0)}%
Stop Loss: $${signal.stopLoss.toFixed(4)}
Take Profit: $${signal.takeProfit.toFixed(4)}
Regime: ${signal.regime}
Raw reasoning: ${signal.reasoning}

Respond with ONLY the narrative — no headers, no JSON.`;
}

async function tryClaude(prompt: string): Promise<string | null> {
  if (!config.anthropicApiKey) return null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data: any = await resp.json();
    return data?.content?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

async function tryGemini(prompt: string): Promise<string | null> {
  if (!config.geminiApiKey) return null;
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const data: any = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

function templateReasoning(signal: TradeSignal): string {
  const dir = signal.direction === 'buy' ? 'bullish' : 'bearish';
  const strat = signal.strategy.replace(/_/g, ' ');
  return `A ${dir} ${strat} signal was generated at $${signal.price.toFixed(4)} with ${(signal.confidence * 100).toFixed(0)}% confidence in a ${signal.regime} regime. ${signal.reasoning}`;
}

export async function generateReasoning(signal: TradeSignal, contextPrefix = ''): Promise<ReasoningResult> {
  if (signal.direction === 'hold') {
    return { narrative: signal.reasoning, source: 'template', latencyMs: 0 };
  }

  const prompt = buildPrompt(signal, contextPrefix);
  const start = Date.now();

  const claude = await tryClaude(prompt);
  if (claude) return { narrative: claude.trim(), source: 'claude', latencyMs: Date.now() - start };

  const gemini = await tryGemini(prompt);
  if (gemini) return { narrative: gemini.trim(), source: 'gemini', latencyMs: Date.now() - start };

  // Cookie-based Gemini fallback (no API key required)
  if (config.geminiPsid && config.geminiPsidts) {
    const cookieResult = await askGeminiWithCookies(prompt, config.geminiPsid, config.geminiPsidts);
    if (cookieResult) return { narrative: cookieResult.trim(), source: 'gemini-cookie', latencyMs: Date.now() - start };
  }

  log.warn('All LLMs unavailable — using template reasoning');
  return { narrative: templateReasoning(signal), source: 'template', latencyMs: Date.now() - start };
}
