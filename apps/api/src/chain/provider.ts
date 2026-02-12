/**
 * On-Chain Integration Layer
 * Connects the API server to deployed smart contracts via ethers.js
 */

import { ethers } from 'ethers';

// ABI fragments — only the functions we call from the server
const AGENT_REGISTRY_ABI = [
  'function registerAgent(address wallet, bytes32 twitterHandleHash) external',
  'function isRegistered(address wallet) external view returns (bool)',
  'function getAgent(address wallet) external view returns (address agentWallet, bytes32 twitterHandleHash, uint256 registeredAt, bool isActive)',
  'function deactivateAgent(address wallet) external',
  'event AgentRegistered(address indexed wallet, bytes32 indexed twitterHandleHash, uint256 registeredAt)',
];

const DUEL_MATCH_ABI = [
  'function createChallenge(bytes32 matchId, string gameType) external payable',
  'function acceptChallenge(bytes32 matchId) external payable',
  'function resolveMatch(bytes32 matchId, address winner, uint8 endCondition, bytes32 pgnHash, bytes32 fenHash, uint256 moveCount, string ipfsCid) external',
  'function cancelChallenge(bytes32 matchId) external',
  'function claimTimeout(bytes32 matchId) external',
  'function getDuel(bytes32 matchId) external view returns (address player1, address player2, uint256 buyIn, uint8 status, address winner, bool isDraw, uint8 endCondition, string ipfsCid, uint256 moveCount, uint256 deadline)',
  'function getDuelHashes(bytes32 matchId) external view returns (bytes32 pgnHash, bytes32 fenHash, string gameType)',
  'function isDuelActive(bytes32 matchId) external view returns (bool)',
  'function isDuelOpen(bytes32 matchId) external view returns (bool)',
  'function getPlayerDuelIds(address player) external view returns (bytes32[])',
  'function platformFeeBps() external view returns (uint256)',
  'function minBuyIn() external view returns (uint256)',
  'function maxBuyIn() external view returns (uint256)',
  'event ChallengeCreated(bytes32 indexed matchId, address indexed player1, uint256 buyIn, string gameType)',
  'event ChallengeAccepted(bytes32 indexed matchId, address indexed player2, uint256 totalPool)',
  'event MatchResolved(bytes32 indexed matchId, address indexed winner, bool isDraw, uint8 endCondition, uint256 winnerPayout, uint256 platformFee)',
];

const ARENA_MATCH_ABI = [
  'function createMatch(bytes32 matchId, address player1, address player2) external',
  'function submitResult(bytes32 matchId, address winner, uint8 endCondition, bytes32 pgnHash, bytes32 finalFenHash, uint256 moveCount) external',
  'function getMatch(bytes32 matchId) external view returns (address player1, address player2, address winner, bool isDraw, uint8 endCondition, bytes32 pgnHash, uint256 moveCount, uint256 completedAt, bool finalized)',
  'function isMatchFinalized(bytes32 matchId) external view returns (bool)',
];

// End condition mapping (matches the Solidity enum)
export enum EndCondition {
  None = 0,
  Checkmate = 1,
  Stalemate = 2,
  ThreefoldRep = 3,
  FiftyMoveRule = 4,
  InsufficientMat = 5,
  Timeout = 6,
  Forfeit = 7,
  Agreement = 8,
}

/**
 * Map game result reason strings to EndCondition enum
 */
export function reasonToEndCondition(reason: string): EndCondition {
  const lower = reason.toLowerCase();
  if (lower.includes('checkmate')) return EndCondition.Checkmate;
  if (lower.includes('stalemate')) return EndCondition.Stalemate;
  if (lower.includes('threefold') || lower.includes('repetition')) return EndCondition.ThreefoldRep;
  if (lower.includes('fifty') || lower.includes('50-move')) return EndCondition.FiftyMoveRule;
  if (lower.includes('insufficient')) return EndCondition.InsufficientMat;
  if (lower.includes('time') || lower.includes('timeout')) return EndCondition.Timeout;
  if (lower.includes('forfeit') || lower.includes('disconnect') || lower.includes('error')) return EndCondition.Forfeit;
  if (lower.includes('agreement') || lower.includes('draw by agreement')) return EndCondition.Agreement;
  return EndCondition.Forfeit; // Default to forfeit for unknown reasons
}

export class ChainProvider {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet | ethers.HDNodeWallet;
  public agentRegistry: ethers.Contract;
  public duelMatch: ethers.Contract;
  public arenaMatch: ethers.Contract;

  private enabled: boolean = false;

  constructor() {
    const rpcUrl = process.env.HARDHAT_RPC || process.env.BASE_RPC || 'http://127.0.0.1:8545';
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    const agentRegistryAddr = process.env.AGENT_REGISTRY_ADDRESS;
    const duelMatchAddr = process.env.DUEL_MATCH_ADDRESS;
    const arenaMatchAddr = process.env.ARENA_MATCH_ADDRESS;

    if (!privateKey || !agentRegistryAddr || !duelMatchAddr || !arenaMatchAddr) {
      console.warn('⚠️  Chain integration disabled — missing env vars (DEPLOYER_PRIVATE_KEY, AGENT_REGISTRY_ADDRESS, DUEL_MATCH_ADDRESS, ARENA_MATCH_ADDRESS)');
      // Create dummy provider for type safety; methods will check this.enabled
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.signer = ethers.Wallet.createRandom().connect(this.provider);
      this.agentRegistry = new ethers.Contract(ethers.ZeroAddress, AGENT_REGISTRY_ABI, this.signer);
      this.duelMatch = new ethers.Contract(ethers.ZeroAddress, DUEL_MATCH_ABI, this.signer);
      this.arenaMatch = new ethers.Contract(ethers.ZeroAddress, ARENA_MATCH_ABI, this.signer);
      return;
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
    this.agentRegistry = new ethers.Contract(agentRegistryAddr, AGENT_REGISTRY_ABI, this.signer);
    this.duelMatch = new ethers.Contract(duelMatchAddr, DUEL_MATCH_ABI, this.signer);
    this.arenaMatch = new ethers.Contract(arenaMatchAddr, ARENA_MATCH_ABI, this.signer);
    this.enabled = true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if a wallet is a registered agent on-chain
   */
  async isAgentRegistered(wallet: string): Promise<boolean> {
    if (!this.enabled) return true; // Allow all in dev mode
    try {
      return await this.agentRegistry.isRegistered(wallet);
    } catch (error) {
      console.error('Chain error checking agent registration:', error);
      return false;
    }
  }

  /**
   * Register an agent on-chain after Twitter verification
   */
  async registerAgentOnChain(wallet: string, twitterHandle: string): Promise<string | null> {
    if (!this.enabled) return 'dev-mode-tx-hash';
    try {
      const twitterHandleHash = ethers.keccak256(ethers.toUtf8Bytes(twitterHandle.toLowerCase()));
      const tx = await this.agentRegistry.registerAgent(wallet, twitterHandleHash);
      const receipt = await tx.wait();
      return receipt.hash;
    } catch (error) {
      console.error('Chain error registering agent:', error);
      return null;
    }
  }

  /**
   * Resolve a duel match on-chain and distribute funds
   */
  async resolveMatchOnChain(
    matchId: string,
    winner: string,
    reason: string,
    pgn: string,
    finalFen: string,
    moveCount: number,
    ipfsCid: string
  ): Promise<string | null> {
    if (!this.enabled) return 'dev-mode-tx-hash';
    try {
      const matchIdBytes = ethers.keccak256(ethers.toUtf8Bytes(matchId));
      const endCondition = reasonToEndCondition(reason);
      const pgnHash = ethers.keccak256(ethers.toUtf8Bytes(pgn));
      const fenHash = ethers.keccak256(ethers.toUtf8Bytes(finalFen));

      const tx = await this.duelMatch.resolveMatch(
        matchIdBytes,
        winner || ethers.ZeroAddress,
        endCondition,
        pgnHash,
        fenHash,
        moveCount,
        ipfsCid
      );
      const receipt = await tx.wait();
      console.log(`⛓️  Match ${matchId} resolved on-chain: tx=${receipt.hash}`);
      return receipt.hash;
    } catch (error) {
      console.error('Chain error resolving match:', error);
      return null;
    }
  }

  /**
   * Record a match result on ArenaMatch contract (for non-duel matches)
   */
  async recordMatchResult(
    matchId: string,
    player1: string,
    player2: string,
    winner: string,
    reason: string,
    pgn: string,
    finalFen: string,
    moveCount: number
  ): Promise<string | null> {
    if (!this.enabled) return 'dev-mode-tx-hash';
    try {
      const matchIdBytes = ethers.keccak256(ethers.toUtf8Bytes(matchId));
      const endCondition = reasonToEndCondition(reason);
      const pgnHash = ethers.keccak256(ethers.toUtf8Bytes(pgn));
      const fenHash = ethers.keccak256(ethers.toUtf8Bytes(finalFen));

      // Create match on-chain first
      const createTx = await this.arenaMatch.createMatch(matchIdBytes, player1, player2);
      await createTx.wait();

      // Submit result
      const resultTx = await this.arenaMatch.submitResult(
        matchIdBytes,
        winner || ethers.ZeroAddress,
        endCondition,
        pgnHash,
        fenHash,
        moveCount
      );
      const receipt = await resultTx.wait();
      return receipt.hash;
    } catch (error) {
      console.error('Chain error recording match result:', error);
      return null;
    }
  }

  /**
   * Get chain info for diagnostics
   */
  async getChainInfo(): Promise<{ chainId: number; blockNumber: number; signerAddress: string } | null> {
    if (!this.enabled) return null;
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      return {
        chainId: Number(network.chainId),
        blockNumber,
        signerAddress: await this.signer.getAddress(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get duel contract configuration
   */
  async getDuelConfig(): Promise<{ platformFeeBps: number; minBuyIn: string; maxBuyIn: string } | null> {
    if (!this.enabled) return null;
    try {
      const [feeBps, minBuyIn, maxBuyIn] = await Promise.all([
        this.duelMatch.platformFeeBps(),
        this.duelMatch.minBuyIn(),
        this.duelMatch.maxBuyIn(),
      ]);
      return {
        platformFeeBps: Number(feeBps),
        minBuyIn: ethers.formatEther(minBuyIn),
        maxBuyIn: ethers.formatEther(maxBuyIn),
      };
    } catch {
      return null;
    }
  }
}

// Singleton
let chainProvider: ChainProvider | null = null;

export function getChainProvider(): ChainProvider {
  if (!chainProvider) {
    chainProvider = new ChainProvider();
  }
  return chainProvider;
}

export function isChainEnabled(): boolean {
  return getChainProvider().isEnabled();
}
