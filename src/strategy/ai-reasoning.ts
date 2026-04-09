/**
 * AI Reasoning — natural language trade explanations.
 *
 * Generates a human-readable narrative for every trade decision.
 * Chain: Claude → Groq → template fallback.
 */

import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';
import type { TradeSignal } from './types.js';

const log = createLogger('AI-REASONING');

export interface ReasoningResult {
  narrative: string;
  source: 'claude' | 'groq' | 'template';
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

async function tryGroq(prompt: string): Promise<string | null> {
  if (!config.groqApiKey) return null;
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.groqApiKey}`,
      },
      body: JSON.stringify({
        model: 'qwen/qwen3-32b',
        max_tokens: 200,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data: any = await resp.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      log.debug(`[GROQ] No content in response: ${JSON.stringify(data?.error ?? data)}`);
    }
    return text ?? null;
  } catch (e) {
    log.debug(`[GROQ] Request failed: ${e}`);
    return null;
  }
}

function templateReasoning(signal: TradeSignal): string {
  const dir  = signal.direction === 'buy' ? 'bullish' : 'bearish';
  const strat = signal.strategy.replace(/_/g, ' ');
  return `A ${dir} ${strat} signal was generated at $${signal.price.toFixed(4)} with ${(signal.confidence * 100).toFixed(0)}% confidence in a ${signal.regime} regime. ${signal.reasoning}`;
}

export async function generateReasoning(signal: TradeSignal, contextPrefix = ''): Promise<ReasoningResult> {
  if (signal.direction === 'hold') {
    return { narrative: signal.reasoning, source: 'template', latencyMs: 0 };
  }

  const prompt = buildPrompt(signal, contextPrefix);
  const start  = Date.now();

  const claude = await tryClaude(prompt);
  if (claude) return { narrative: claude.trim(), source: 'claude', latencyMs: Date.now() - start };

  const groq = await tryGroq(prompt);
  if (groq) return { narrative: groq.trim(), source: 'groq', latencyMs: Date.now() - start };

  log.warn('All LLMs unavailable — using template reasoning');
  return { narrative: templateReasoning(signal), source: 'template', latencyMs: Date.now() - start };
}
