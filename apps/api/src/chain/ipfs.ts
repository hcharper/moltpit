/**
 * IPFS Integration
 * Pins game data (PGN, moves, metadata) to IPFS for verifiable storage.
 * 
 * Supports:
 * - Pinata (recommended for production)
 * - Local/fallback mode that returns a deterministic hash without actual pinning
 */

import { createHash } from 'crypto';

export interface GameData {
  matchId: string;
  gameType: string;
  players: { address: string; name: string; color?: string }[];
  pgn: string;
  finalFen: string;
  moves: { moveNumber: number; san: string; fenAfter: string; thinkingTimeMs: number }[];
  result: {
    winner?: string;
    isDraw: boolean;
    reason: string;
    moveCount: number;
  };
  timestamps: {
    startedAt: string;
    completedAt: string;
  };
  chainId?: number;
}

export class IpfsClient {
  private pinataJwt: string | null;
  private enabled: boolean;

  constructor() {
    this.pinataJwt = process.env.PINATA_JWT || null;
    this.enabled = !!this.pinataJwt;

    if (!this.enabled) {
      console.warn('⚠️  IPFS pinning disabled — set PINATA_JWT env var for production');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Pin game data to IPFS
   * Returns the CID (Content Identifier)
   */
  async pinGameData(data: GameData): Promise<string> {
    const jsonContent = JSON.stringify(data, null, 2);

    if (this.enabled && this.pinataJwt) {
      return this.pinToPinata(jsonContent, `moltpit-match-${data.matchId}`);
    }

    // Fallback: generate a deterministic hash (for dev/testing)
    return this.generateLocalCid(jsonContent);
  }

  /**
   * Pin raw JSON string to Pinata
   */
  private async pinToPinata(content: string, name: string): Promise<string> {
    try {
      const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.pinataJwt}`,
        },
        body: JSON.stringify({
          pinataContent: JSON.parse(content),
          pinataMetadata: {
            name,
            keyvalues: {
              platform: 'moltpit',
              type: 'match-data',
            },
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Pinata error ${response.status}: ${error}`);
      }

      const result = await response.json() as { IpfsHash: string };
      console.log(`📌 Pinned to IPFS: ${result.IpfsHash}`);
      return result.IpfsHash;
    } catch (error) {
      console.error('IPFS pinning failed:', error);
      // Fallback to local hash
      return this.generateLocalCid(content);
    }
  }

  /**
   * Generate a deterministic CID-like hash for dev/testing
   * Format: "local-<sha256 prefix>" to make it obvious it's not real IPFS
   */
  private generateLocalCid(content: string): string {
    const hash = createHash('sha256').update(content).digest('hex');
    return `local-${hash.slice(0, 46)}`;
  }

  /**
   * Get the gateway URL for an IPFS CID
   */
  getGatewayUrl(cid: string): string {
    if (cid.startsWith('local-')) {
      return `https://localhost/ipfs/${cid}`; // Fake URL for dev
    }
    // Use Pinata's dedicated gateway or public gateway
    const gateway = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud';
    return `${gateway}/ipfs/${cid}`;
  }
}

// Singleton
let ipfsClient: IpfsClient | null = null;

export function getIpfsClient(): IpfsClient {
  if (!ipfsClient) {
    ipfsClient = new IpfsClient();
  }
  return ipfsClient;
}
