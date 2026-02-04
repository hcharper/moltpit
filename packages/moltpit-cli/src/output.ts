/**
 * Output formatting utilities for CLI
 * Matches MoltLaunch patterns: JSON mode vs human-readable
 */

import chalk from 'chalk';

export interface CommandResult {
  success: boolean;
  error?: string;
  exitCode?: number;
  [key: string]: unknown;
}

/**
 * Output result in JSON or human-readable format
 */
export function output(result: CommandResult, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.success) {
      formatHumanOutput(result);
    } else {
      console.error(chalk.red(`Error: ${result.error}`));
    }
  }
}

/**
 * Format result for human reading
 */
function formatHumanOutput(result: CommandResult): void {
  // Remove internal fields
  const { success, exitCode, ...data } = result;

  // Handle specific result types
  if ('tournaments' in data) {
    formatTournaments(data.tournaments as Tournament[]);
  } else if ('matches' in data) {
    formatMatches(data.matches as Match[]);
  } else if ('address' in data && 'balance' in data) {
    formatWallet(data as WalletInfo);
  } else if ('elo' in data && 'stats' in data) {
    formatProfile(data as Profile);
  } else if ('placement' in data && 'prize' in data) {
    formatClaim(data as ClaimResult);
  } else if ('position' in data) {
    formatMove(data as MoveResult);
  } else if ('tournamentId' in data && 'position' in data) {
    formatEntry(data as EntryResult);
  } else {
    // Generic output
    for (const [key, value] of Object.entries(data)) {
      console.log(`${chalk.gray(key)}: ${formatValue(value)}`);
    }
  }
}

interface Tournament {
  id: string;
  name: string;
  game: string;
  entryFee: string;
  prizePool: string;
  participants: number;
  maxParticipants: number;
  status: string;
  startsAt: string;
}

function formatTournaments(tournaments: Tournament[]): void {
  if (tournaments.length === 0) {
    console.log(chalk.gray('No tournaments found.'));
    return;
  }

  console.log(chalk.bold(`\n🔱 ${tournaments.length} Tournament(s)\n`));

  for (const t of tournaments) {
    const statusColor =
      t.status === 'registration'
        ? chalk.green
        : t.status === 'active'
        ? chalk.yellow
        : chalk.gray;

    console.log(
      `${chalk.bold(t.name)} ${chalk.gray(`[${t.game}]`)} ${statusColor(t.status)}`
    );
    console.log(
      `  Entry: ${chalk.cyan(t.entryFee + ' ETH')} | Prize: ${chalk.green(t.prizePool + ' ETH')} | ${t.participants}/${t.maxParticipants} agents`
    );
    console.log(`  ID: ${chalk.gray(t.id)}`);
    console.log();
  }
}

interface Match {
  id: string;
  game: string;
  opponentName: string;
  status: string;
  yourTurn: boolean;
  position: string;
  round: number;
}

function formatMatches(matches: Match[]): void {
  if (matches.length === 0) {
    console.log(chalk.gray('No active matches.'));
    return;
  }

  console.log(chalk.bold(`\n⚔️  ${matches.length} Match(es)\n`));

  for (const m of matches) {
    const turnIndicator = m.yourTurn
      ? chalk.green('YOUR TURN')
      : chalk.gray('waiting');

    console.log(`${chalk.bold(m.game)} vs ${chalk.cyan(m.opponentName)} ${turnIndicator}`);
    console.log(`  Round ${m.round} | Status: ${m.status}`);
    console.log(`  ID: ${chalk.gray(m.id)}`);
    if (m.position) {
      console.log(`  Position: ${chalk.gray(m.position.substring(0, 40))}...`);
    }
    console.log();
  }
}

interface WalletInfo {
  address: string;
  balance: string;
  network: string;
}

function formatWallet(wallet: WalletInfo): void {
  console.log(chalk.bold('\n💰 Wallet\n'));
  console.log(`Address: ${chalk.cyan(wallet.address)}`);
  console.log(`Balance: ${chalk.green(wallet.balance + ' ETH')}`);
  console.log(`Network: ${wallet.network}`);
}

interface Profile {
  agent: string;
  name: string;
  elo: Record<string, number>;
  stats: {
    matchesPlayed: number;
    matchesWon: number;
    winRate: number;
    totalEarnings: string;
  };
}

function formatProfile(profile: Profile): void {
  console.log(chalk.bold(`\n🏛️  ${profile.name || 'Agent'}\n`));
  console.log(`Address: ${chalk.gray(profile.agent)}`);

  if (Object.keys(profile.elo).length > 0) {
    console.log('\nElo Ratings:');
    for (const [game, rating] of Object.entries(profile.elo)) {
      console.log(`  ${game}: ${chalk.cyan(rating.toString())}`);
    }
  }

  console.log('\nStats:');
  console.log(`  Matches: ${profile.stats.matchesWon}/${profile.stats.matchesPlayed} (${(profile.stats.winRate * 100).toFixed(1)}% win rate)`);
  console.log(`  Earnings: ${chalk.green(profile.stats.totalEarnings + ' ETH')}`);
}

interface ClaimResult {
  tournamentId: string;
  placement: number;
  prize: string;
  transactionHash: string;
}

function formatClaim(result: ClaimResult): void {
  const medal = result.placement === 1 ? '🥇' : result.placement === 2 ? '🥈' : '🥉';
  console.log(chalk.bold(`\n${medal} Prize Claimed!\n`));
  console.log(`Placement: ${result.placement}`);
  console.log(`Prize: ${chalk.green(result.prize + ' ETH')}`);
  console.log(`TX: ${chalk.gray(result.transactionHash)}`);
}

interface MoveResult {
  matchId: string;
  move: string;
  position: string;
  yourTurn: boolean;
}

function formatMove(result: MoveResult): void {
  console.log(chalk.green(`\n✓ Move submitted: ${result.move}`));
  if (!result.yourTurn) {
    console.log(chalk.gray('Waiting for opponent...'));
  }
}

interface EntryResult {
  tournamentId: string;
  position: number;
  entryFee: string;
}

function formatEntry(result: EntryResult): void {
  console.log(chalk.green('\n✓ Registered for tournament!'));
  console.log(`Entry fee: ${result.entryFee} ETH`);
  console.log(`Position: #${result.position}`);
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Create error result
 */
export function errorResult(message: string, exitCode: number = 1): CommandResult {
  return { success: false, error: message, exitCode };
}

/**
 * Create success result
 */
export function successResult(data: Record<string, unknown>): CommandResult {
  return { success: true, ...data };
}
