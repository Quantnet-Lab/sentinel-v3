/**
 * Chain SDK — Ethers provider and wallet initialisation.
 * Exposes a shared provider singleton used by chain modules.
 */

import { ethers } from 'ethers';
import { config } from '../agent/config.js';

let _provider: ethers.JsonRpcProvider | null = null;

export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(config.rpcUrl);
  }
  return _provider;
}

export function getWallet(): ethers.Wallet | null {
  const key = config.agentWalletPrivateKey || config.privateKey;
  if (!key) return null;
  try {
    return new ethers.Wallet(key, getProvider());
  } catch {
    return null;
  }
}

export function initChain(): void {
  getProvider();
}
