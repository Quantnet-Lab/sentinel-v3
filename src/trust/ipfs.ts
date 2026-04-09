/**
 * IPFS artifact pinning via Pinata.
 * Every trade decision artifact is pinned for immutable public verification.
 */

import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';

const log = createLogger('IPFS');

export interface IpfsUploadResult {
  cid: string;
  url: string;
  pinataId: string | null;
  pinnedAt: string;
}

export async function pinArtifact(artifact: object, name: string): Promise<IpfsUploadResult | null> {
  if (!config.pinataJwt) {
    log.warn('[IPFS] PINATA_JWT not set — skipping pin');
    return null;
  }

  try {
    const resp = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.pinataJwt}`,
      },
      body: JSON.stringify({
        pinataContent: artifact,
        pinataMetadata: { name: `sentinel-v3-${name}-${Date.now()}` },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) throw new Error(`Pinata HTTP ${resp.status}`);
    const data: any = await resp.json();

    const result: IpfsUploadResult = {
      cid: data.IpfsHash,
      url: `${config.pinataGateway}/${data.IpfsHash}`,
      pinataId: data.PinSize ? String(data.PinSize) : null,
      pinnedAt: new Date().toISOString(),
    };

    log.info(`[IPFS] Pinned ${name}: ${result.cid}`);
    return result;
  } catch (e) {
    log.warn(`[IPFS] Pin failed: ${e}`);
    return null;
  }
}
