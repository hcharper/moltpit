import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const OLYMPUS_DIR = path.join(os.homedir(), '.olympus');
const WALLET_PATH = path.join(OLYMPUS_DIR, 'wallet.json');
const STATE_PATH = path.join(OLYMPUS_DIR, 'state.json');

export interface WalletData {
  address: string;
  privateKey: string;
  createdAt: string;
}

export interface AgentState {
  tournaments: {
    entered: string[];
    completed: string[];
  };
  matches: {
    active: string[];
    completed: string[];
  };
  lastSync: string | null;
}

/**
 * Ensure the .olympus directory exists with proper permissions
 */
export function ensureOlympusDir(): void {
  if (!fs.existsSync(OLYMPUS_DIR)) {
    fs.mkdirSync(OLYMPUS_DIR, { mode: 0o700 });
  }
}

/**
 * Load or create wallet
 */
export function loadOrCreateWallet(): WalletData {
  ensureOlympusDir();

  if (fs.existsSync(WALLET_PATH)) {
    const data = fs.readFileSync(WALLET_PATH, 'utf-8');
    return JSON.parse(data) as WalletData;
  }

  // Create new wallet
  const wallet = ethers.Wallet.createRandom();
  const walletData: WalletData = {
    address: wallet.address,
    privateKey: wallet.privateKey,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(WALLET_PATH, JSON.stringify(walletData, null, 2), {
    mode: 0o600,
  });

  return walletData;
}

/**
 * Get wallet (throws if not exists)
 */
export function getWallet(): WalletData {
  if (!fs.existsSync(WALLET_PATH)) {
    throw new Error('No wallet found. Run any command to create one.');
  }
  const data = fs.readFileSync(WALLET_PATH, 'utf-8');
  return JSON.parse(data) as WalletData;
}

/**
 * Get ethers Wallet instance connected to provider
 */
export function getEthersWallet(testnet: boolean = false): ethers.Wallet {
  const walletData = loadOrCreateWallet();
  const rpcUrl = testnet
    ? 'https://sepolia.base.org'
    : 'https://mainnet.base.org';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(walletData.privateKey, provider);
}

/**
 * Load agent state
 */
export function loadState(): AgentState {
  ensureOlympusDir();

  if (fs.existsSync(STATE_PATH)) {
    const data = fs.readFileSync(STATE_PATH, 'utf-8');
    return JSON.parse(data) as AgentState;
  }

  return {
    tournaments: { entered: [], completed: [] },
    matches: { active: [], completed: [] },
    lastSync: null,
  };
}

/**
 * Save agent state
 */
export function saveState(state: AgentState): void {
  ensureOlympusDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Get wallet balance
 */
export async function getBalance(testnet: boolean = false): Promise<string> {
  const wallet = getEthersWallet(testnet);
  const balance = await wallet.provider!.getBalance(wallet.address);
  return ethers.formatEther(balance);
}
