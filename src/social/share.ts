/**
 * Social Sharing — Trade Summary Generator
 *
 * Generates shareable trade summaries formatted for X/Twitter and Discord.
 * Used by the dashboard share feature and the live proof walkthrough page.
 */

import { config } from '../agent/config.js';

export interface ShareableTradePost {
  text: string;
  hashtags: string[];
  mentions: string[];
  url: string | null;
}

export function generateTradePost(params: {
  signal: string;
  confidence: number;
  price: number;
  symbol: string;
  approved: boolean;
  explanation: string;
  trustScore: number;
  strategy: string;
  artifactCid?: string;
  pnl?: number;
}): ShareableTradePost {
  const emoji = params.signal === 'buy' ? '📈' : params.signal === 'sell' ? '📉' : '⏸️';
  const decision = params.approved ? '✅ APPROVED' : '🚫 BLOCKED';
  const pnlLine = params.pnl != null ? `\n💰 PnL: $${params.pnl.toFixed(2)}` : '';
  const artifactLine = params.artifactCid ? `\n🔗 Proof: ipfs://${params.artifactCid}` : '';
  const dir = params.signal.toUpperCase();

  const text = `${emoji} ${config.agentName} — ${dir} ${params.symbol} @ $${params.price.toFixed(2)}

${decision} | Strategy: ${params.strategy} | Confidence: ${(params.confidence * 100).toFixed(0)}%
🛡️ Trust Score: ${params.trustScore.toFixed(0)} | Governance pipeline active${pnlLine}${artifactLine}

Every trade is auditable on IPFS. Zero trust assumptions.

@Surgexyz_ @lablabai #SurgeHackathon #ERC8004 #DeFi #Base`;

  return {
    text,
    hashtags: ['SurgeHackathon', 'ERC8004', 'DeFi', 'Base'],
    mentions: ['@Surgexyz_', '@lablabai'],
    url: params.artifactCid ? `${config.pinataGateway}/${params.artifactCid}` : null,
  };
}

export function generateDailySummaryPost(params: {
  trades: number;
  pnl: number;
  capital: number;
  trustScore: number;
  winRate: number;
  artifactCount: number;
  symbols: string[];
}): ShareableTradePost {
  const pnlEmoji = params.pnl >= 0 ? '🟢' : '🔴';
  const pnlPct = params.capital > 0 ? ((params.pnl / params.capital) * 100).toFixed(2) : '0.00';
  const symbolList = params.symbols.join(', ');

  const text = `📊 ${config.agentName} — Daily Summary

${pnlEmoji} PnL: $${params.pnl.toFixed(2)} (${pnlPct}%)
📈 Trades: ${params.trades} | Win Rate: ${(params.winRate * 100).toFixed(0)}%
🛡️ Trust Score: ${params.trustScore.toFixed(0)} | Markets: ${symbolList}
🔗 ${params.artifactCount} IPFS governance artifacts generated

Institutional SMC strategies. Every decision auditable.

@Surgexyz_ @lablabai #SurgeHackathon #ERC8004 #DeFi`;

  return {
    text,
    hashtags: ['SurgeHackathon', 'ERC8004', 'DeFi'],
    mentions: ['@Surgexyz_', '@lablabai'],
    url: null,
  };
}

export function buildTwitterIntentUrl(post: ShareableTradePost): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(post.text)}`;
}
