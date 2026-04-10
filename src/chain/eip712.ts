/**
 * EIP-712 typed data signing for Sentinel checkpoints and trade intents.
 * Signs locally using ethers — no external dependency.
 */

import { ethers } from 'ethers';
import { config } from '../agent/config.js';

const DOMAIN = {
  name: 'RiskRouter',
  version: '1',
  chainId: config.chainId,
  verifyingContract: config.riskRouterAddress as `0x${string}`,
};

const TRADE_INTENT_TYPES = {
  TradeIntent: [
    { name: 'agentId',          type: 'uint256' },
    { name: 'agentWallet',      type: 'address' },
    { name: 'pair',             type: 'string'  },
    { name: 'action',           type: 'string'  },
    { name: 'amountUsdScaled',  type: 'uint256' },
    { name: 'maxSlippageBps',   type: 'uint256' },
    { name: 'nonce',            type: 'uint256' },
    { name: 'deadline',         type: 'uint256' },
  ],
};

const CHECKPOINT_TYPES = {
  Checkpoint: [
    { name: 'agentId',   type: 'uint256' },
    { name: 'symbol',    type: 'string'  },
    { name: 'eventType', type: 'string'  },
    { name: 'dataHash',  type: 'bytes32' },
    { name: 'nonce',     type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

function getWallet(): ethers.Wallet | null {
  const key = config.agentWalletPrivateKey || config.privateKey;
  if (!key) return null;
  try {
    return new ethers.Wallet(key);
  } catch {
    return null;
  }
}

export function getSignerAddress(): string | null {
  return getWallet()?.address ?? null;
}

export async function signTradeIntent(params: {
  agentId: number;
  agentWallet: string;
  pair: string;
  action: string;
  amountUsdScaled: number;
  maxSlippageBps: number;
  nonce: number;
  deadline: number;
}): Promise<string | null> {
  const wallet = getWallet();
  if (!wallet) return null;

  const value = {
    agentId:         BigInt(params.agentId),
    agentWallet:     params.agentWallet as `0x${string}`,
    pair:            params.pair,
    action:          params.action,
    amountUsdScaled: BigInt(Math.round(params.amountUsdScaled)),
    maxSlippageBps:  BigInt(params.maxSlippageBps),
    nonce:           BigInt(params.nonce),
    deadline:        BigInt(params.deadline),
  };

  try {
    return await wallet.signTypedData(DOMAIN, TRADE_INTENT_TYPES, value);
  } catch {
    return null;
  }
}

export async function signCheckpoint(params: {
  agentId: number;
  symbol: string;
  eventType: string;
  dataHash: string;
  nonce: number;
}): Promise<string | null> {
  const wallet = getWallet();
  if (!wallet) return null;

  const value = {
    agentId:   BigInt(params.agentId),
    symbol:    params.symbol,
    eventType: params.eventType,
    dataHash:  params.dataHash as `0x${string}`,
    nonce:     BigInt(params.nonce),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  };

  try {
    return await wallet.signTypedData(DOMAIN, CHECKPOINT_TYPES, value);
  } catch {
    return null;
  }
}

export function hashData(data: object): string {
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(data)));
}
