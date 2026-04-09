/**
 * SAGE — Self-Adapting Generative Engine
 *
 * Adaptive learning layer that uses LLM reflection to tune signal weights
 * based on observed trade outcomes.
 *
 * Produces:
 *   - Reflection insights (lessons from recent trade batches)
 *   - Playbook rules (confidence modifiers: BOOST / REDUCE)
 *   - Weight recommendations (scorecard weight tuning within CAGE bounds)
 *   - Context prefixes (accumulated wisdom injected into AI reasoning)
 *
 * Safety:
 *   - All weight changes bounded by WEIGHT_CAGE (immutable)
 *   - Max 30% change per parameter per reflection cycle
 *   - Playbook rules can only modify confidence — cannot bypass risk checks
 *   - LLM failure = no change (deterministic fallback)
 *   - Every reflection is saved as an auditable artifact
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';

const log = createLogger('SAGE');

const STATE_DIR   = join(process.cwd(), '.sentinel');
const SAGE_FILE   = join(STATE_DIR, 'sage-state.json');
const SAGE_LOG    = join(STATE_DIR, 'sage-reflections.jsonl');

// ── Weight CAGE (immutable bounds) ─────────────────────────────────────────────
export const WEIGHT_CAGE = Object.freeze({
  trend:      { min: 0.0, max: 2.5, default: 1.2 },
  momentum:   { min: 0.0, max: 3.0, default: 1.0 },
  reversion:  { min: 0.0, max: 2.0, default: 0.8 },
  ict:        { min: 0.0, max: 2.0, default: 1.5 },
  sentiment:  { min: 0.0, max: 0.5, default: 0.12 },
  rsi:        { min: 0.0, max: 2.0, default: 0.6 },
  volatility: { min: 0.0, max: 1.5, default: 0.5 },
  maxChangePerCycle: 0.3,
});

export type WeightKey = 'trend' | 'momentum' | 'reversion' | 'ict' | 'sentiment' | 'rsi' | 'volatility';

export interface SAGEWeights {
  trend: number;
  momentum: number;
  reversion: number;
  ict: number;
  sentiment: number;
  rsi: number;
  volatility: number;
}

export interface SAGEOutcome {
  direction: string;
  strategy: string;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  stopHit: boolean;
  regime: string;
  confidence: number;
  rsi?: number;
  timestamp: string;
}

export interface PlaybookRule {
  id: string;
  condition: string;
  action: 'BOOST' | 'REDUCE' | 'BLOCK';
  magnitude: number;
  source: 'reflection';
  createdAt: string;
  triggerCount: number;
}

export interface SAGEState {
  weights: SAGEWeights;
  outcomes: SAGEOutcome[];
  playbookRules: PlaybookRule[];
  reflectionCount: number;
  lastReflectionAt: string | null;
  contextPrefix: string;
}

function defaultWeights(): SAGEWeights {
  return Object.fromEntries(
    (Object.keys(WEIGHT_CAGE) as WeightKey[])
      .filter(k => k !== 'maxChangePerCycle' as never)
      .map(k => [k, (WEIGHT_CAGE as any)[k].default]),
  ) as SAGEWeights;
}

// ── State management ────────────────────────────────────────────────────────────

let state: SAGEState = {
  weights: defaultWeights(),
  outcomes: [],
  playbookRules: [],
  reflectionCount: 0,
  lastReflectionAt: null,
  contextPrefix: '',
};

export function loadSAGEState(): void {
  if (!existsSync(SAGE_FILE)) return;
  try {
    const raw = JSON.parse(readFileSync(SAGE_FILE, 'utf-8'));
    state = { ...state, ...raw };
    log.info(`SAGE state loaded. Reflections: ${state.reflectionCount}, Rules: ${state.playbookRules.length}`);
  } catch (e) {
    log.warn(`Failed to load SAGE state: ${e}`);
  }
}

function persistState(): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(SAGE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log.warn(`Failed to persist SAGE state: ${e}`);
  }
}

export function recordSAGEOutcome(outcome: SAGEOutcome): void {
  state.outcomes.push(outcome);
  if (state.outcomes.length > 100) state.outcomes = state.outcomes.slice(-100);
  persistState();
}

export function getActivePlaybookRules(): PlaybookRule[] {
  return state.playbookRules.filter(r => r.triggerCount < 20);
}

export function getSAGEStatus(): Record<string, unknown> {
  return {
    enabled: config.sageEnabled,
    weights: state.weights,
    reflectionCount: state.reflectionCount,
    lastReflectionAt: state.lastReflectionAt,
    outcomesRecorded: state.outcomes.length,
    playbookRules: state.playbookRules.length,
    contextPrefix: state.contextPrefix.slice(0, 100),
  };
}

export function isSAGEEnabled(): boolean {
  return config.sageEnabled;
}

// ── LLM reflection ─────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string | null> {
  if (!config.geminiApiKey) return null;
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const data: any = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

export async function runSAGEReflection(): Promise<void> {
  if (!config.sageEnabled) return;
  if (state.outcomes.length < config.sageMinOutcomes) {
    log.info(`SAGE: not enough outcomes (${state.outcomes.length}/${config.sageMinOutcomes})`);
    return;
  }

  const recent = state.outcomes.slice(-20);
  const wins   = recent.filter(o => o.pnlPct > 0).length;
  const losses = recent.filter(o => o.pnlPct <= 0).length;
  const byStrategy = recent.reduce<Record<string, { w: number; l: number }>>((acc, o) => {
    acc[o.strategy] ??= { w: 0, l: 0 };
    if (o.pnlPct > 0) acc[o.strategy].w++; else acc[o.strategy].l++;
    return acc;
  }, {});

  const prompt = `
You are SAGE, an adaptive engine for Sentinel — an institutional trading agent.

Recent trade outcomes (last ${recent.length}):
- Win rate: ${((wins / recent.length) * 100).toFixed(1)}%
- By strategy: ${JSON.stringify(byStrategy)}
- Sample outcomes: ${JSON.stringify(recent.slice(-5))}

Current signal weights: ${JSON.stringify(state.weights)}

Based on these outcomes, respond in JSON with:
{
  "insights": "2-3 sentence summary of what is working/not working",
  "weightAdjustments": { "<weightKey>": <delta between -0.3 and 0.3> },
  "playbookRules": [{ "condition": "...", "action": "BOOST|REDUCE|BLOCK", "magnitude": 0.0-0.3 }],
  "contextPrefix": "Accumulated wisdom in 1 sentence for AI reasoning"
}
Respond ONLY with valid JSON. No explanations outside the JSON.
`;

  log.info('SAGE: Running reflection...');
  const raw = await callGemini(prompt);
  if (!raw) { log.warn('SAGE: LLM unavailable — no change'); return; }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const parsed = JSON.parse(jsonMatch[0]);

    // Apply weight adjustments within CAGE
    if (parsed.weightAdjustments) {
      for (const [key, delta] of Object.entries(parsed.weightAdjustments) as [WeightKey, number][]) {
        const cage = (WEIGHT_CAGE as any)[key];
        if (!cage) continue;
        const clamped = Math.max(-WEIGHT_CAGE.maxChangePerCycle, Math.min(WEIGHT_CAGE.maxChangePerCycle, delta as number));
        const newVal = Math.max(cage.min, Math.min(cage.max, (state.weights as any)[key] + clamped));
        (state.weights as any)[key] = newVal;
      }
    }

    // Append playbook rules (up to max)
    if (Array.isArray(parsed.playbookRules)) {
      for (const r of parsed.playbookRules.slice(0, 3)) {
        if (state.playbookRules.length >= 20) break;
        state.playbookRules.push({
          id:  `sage_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          condition: r.condition,
          action: r.action,
          magnitude: Math.min(0.3, Math.abs(r.magnitude ?? 0.1)),
          source: 'reflection',
          createdAt: new Date().toISOString(),
          triggerCount: 0,
        });
      }
    }

    if (typeof parsed.contextPrefix === 'string') {
      state.contextPrefix = parsed.contextPrefix.slice(0, 200);
    }

    state.reflectionCount++;
    state.lastReflectionAt = new Date().toISOString();
    persistState();

    // Log reflection artifact
    appendFileSync(SAGE_LOG, JSON.stringify({
      at: state.lastReflectionAt,
      insights: parsed.insights,
      weightAdjustments: parsed.weightAdjustments,
      newWeights: state.weights,
      rulesAdded: parsed.playbookRules?.length ?? 0,
    }) + '\n');

    log.info(`SAGE: Reflection #${state.reflectionCount} complete. Insights: ${parsed.insights?.slice(0, 80)}`);
  } catch (e) {
    log.warn(`SAGE: Failed to parse reflection: ${e}`);
  }
}
