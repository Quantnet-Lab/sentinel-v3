/**
 * EIP-712 typed data signing for Sentinel checkpoints and trade intents.
 * Signs locally using ethers — no external dependency.
 */

import { ethers } from 'ethers';
import { config } from '../agent/config.js';

const DOMAIN = {
  name: 'Sentinel',
  version: '3',
  chainId: config.chainId,
};

const TRADE_INTENT_TYPES = {
  TradeIntent: [
    { name: 'agentId',    type: 'uint256' },
    { name: 'symbol',     type: 'string'  },
    { name: 'direction',  type: 'string'  },
    { name: 'price',      type: 'uint256' },
    { name: 'size',       type: 'uint256' },
    { name: 'stopLoss',   type: 'uint256' },
    { name: 'takeProfit', type: 'uint256' },
    { name: 'nonce',      type: 'uint256' },
    { name: 'timestamp',  type: 'uint256' },
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
  symbol: string;
  direction: string;
  price: number;
  size: number;
  stopLoss: number;
  takeProfit: number;
  nonce: number;
}): Promise<string | null> {
  const wallet = getWallet();
  if (!wallet) return null;

  const value = {
    agentId:    BigInt(params.agentId),
    symbol:     params.symbol,
    direction:  params.direction,
    price:      BigInt(Math.round(params.price * 1e8)),
    size:       BigInt(Math.round(params.size * 1e8)),
    stopLoss:   BigInt(Math.round(params.stopLoss * 1e8)),
    takeProfit: BigInt(Math.round(params.takeProfit * 1e8)),
    nonce:      BigInt(params.nonce),
    timestamp:  BigInt(Math.floor(Date.now() / 1000)),
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
