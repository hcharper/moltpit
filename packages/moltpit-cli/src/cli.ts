#!/usr/bin/env node

/**
 * MoltPit CLI
 * 
 * AI Agent Combat Arena on BASE. Fight. Earn. Molt.
 * Pattern matches MoltLaunch for OpenClaw ecosystem compatibility.
 */

import { Command } from 'commander';
import ora from 'ora';
import {
  loadOrCreateWallet,
  getBalance,
  getEthersWallet,
} from './wallet.js';
import {
  getTournaments,
  enterTournament,
  getMatches,
  submitMove,
  getStandings,
  claimPrize,
  getProfile,
} from './api.js';
import { output, errorResult, successResult } from './output.js';

const program = new Command();

program
  .name('moltpit')
  .description('🦞 AI Agent Combat Arena on BASE. Fight. Earn. Molt.')
  .version('0.1.0');

// Global options
program.option('--json', 'Output in JSON format');
program.option('--testnet', 'Use Base Sepolia testnet');

/**
 * tournaments - List available tournaments
 */
program
  .command('tournaments')
  .description('List tournaments')
  .option('--game <game>', 'Filter by game type (chess, trivia, debate)')
  .option('--open', 'Only show tournaments accepting entries')
  .action(async (options) => {
    const jsonMode = program.opts().json;
    const spinner = jsonMode ? null : ora('Fetching tournaments...').start();

    try {
      const result = await getTournaments({
        game: options.game,
        open: options.open,
      });

      spinner?.stop();

      if (result.success && result.data) {
        output(
          successResult({ tournaments: result.data.tournaments }),
          jsonMode
        );
      } else {
        output(errorResult(result.error || 'Failed to fetch tournaments'), jsonMode);
        process.exit(1);
      }
    } catch (error) {
      spinner?.stop();
      output(errorResult(error instanceof Error ? error.message : 'Unknown error'), jsonMode);
      process.exit(1);
    }
  });

/**
 * enter - Enter a tournament
 */
program
  .command('enter')
  .description('Enter a tournament (pays entry fee)')
  .requiredOption('--tournament <id>', 'Tournament ID to enter')
  .action(async (options) => {
    const jsonMode = program.opts().json;
    const testnet = program.opts().testnet;
    const spinner = jsonMode ? null : ora('Entering tournament...').start();

    try {
      const wallet = getEthersWallet(testnet);

      // Sign message to prove ownership
      const message = `Enter MoltPit tournament ${options.tournament}`;
      const signature = await wallet.signMessage(message);

      const result = await enterTournament(
        options.tournament,
        wallet.address,
        signature
      );

      spinner?.stop();

      if (result.success && result.data) {
        output(
          successResult({
            tournamentId: result.data.tournamentId,
            transactionHash: result.data.transactionHash,
            position: result.data.position,
            message: 'Registered for tournament',
          }),
          jsonMode
        );
      } else {
        output(errorResult(result.error || 'Failed to enter tournament', 4), jsonMode);
        process.exit(1);
      }
    } catch (error) {
      spinner?.stop();
      output(errorResult(error instanceof Error ? error.message : 'Unknown error'), jsonMode);
      process.exit(1);
    }
  });

/**
 * matches - List your matches
 */
program
  .command('matches')
  .description('Show your scheduled and active matches')
  .option('--active', 'Only show matches where it\'s your turn')
  .action(async (options) => {
    const jsonMode = program.opts().json;
    const testnet = program.opts().testnet;
    const spinner = jsonMode ? null : ora('Fetching matches...').start();

    try {
      const wallet = getEthersWallet(testnet);
      const result = await getMatches(wallet.address, { active: options.active });

      spinner?.stop();

      if (result.success && result.data) {
        output(successResult({ matches: result.data.matches }), jsonMode);
      } else {
        output(errorResult(result.error || 'Failed to fetch matches'), jsonMode);
        process.exit(1);
      }
    } catch (error) {
      spinner?.stop();
      output(errorResult(error instanceof Error ? error.message : 'Unknown error'), jsonMode);
      process.exit(1);
    }
  });

/**
 * move - Submit a move
 */
program
  .command('move')
  .description('Submit a move in an active match')
  .requiredOption('--match <id>', 'Match ID')
  .requiredOption('--move <move>', 'Move in UCI format (e.g., e2e4)')
  .option('--memo <text>', 'Attach reasoning to the move (on-chain)')
  .action(async (options) => {
    const jsonMode = program.opts().json;
    const testnet = program.opts().testnet;
    const spinner = jsonMode ? null : ora('Submitting move...').start();

    try {
      const wallet = getEthersWallet(testnet);

      // Sign the move
      const message = `Move ${options.move} in match ${options.match}`;
      const signature = await wallet.signMessage(message);

      const result = await submitMove(
        options.match,
        options.move,
        wallet.address,
        signature,
        options.memo
      );

      spinner?.stop();

      if (result.success && result.data) {
        output(
          successResult({
            matchId: options.match,
            move: options.move,
            position: result.data.position,
            yourTurn: result.data.yourTurn,
            ...(options.memo && { memo: options.memo }),
          }),
          jsonMode
        );
      } else {
        output(errorResult(result.error || 'Failed to submit move', 7), jsonMode);
        process.exit(1);
      }
    } catch (error) {
      spinner?.stop();
      output(errorResult(error instanceof Error ? error.message : 'Unknown error'), jsonMode);
      process.exit(1);
    }
  });

/**
 * standings - View tournament standings
 */
program
  .command('standings')
  .description('View tournament bracket and standings')
  .requiredOption('--tournament <id>', 'Tournament ID')
  .action(async (options) => {
    const jsonMode = program.opts().json;
    const spinner = jsonMode ? null : ora('Fetching standings...').start();

    try {
      const result = await getStandings(options.tournament);

      spinner?.stop();

      if (result.success && result.data) {
        output(
          successResult({
            tournamentId: options.tournament,
            bracket: result.data.bracket,
            standings: result.data.standings,
          }),
          jsonMode
        );
      } else {
        output(errorResult(result.error || 'Failed to fetch standings'), jsonMode);
        process.exit(1);
      }
    } catch (error) {
      spinner?.stop();
      output(errorResult(error instanceof Error ? error.message : 'Unknown error'), jsonMode);
      process.exit(1);
    }
  });

/**
 * claim - Claim tournament winnings
 */
program
  .command('claim')
  .description('Withdraw tournament winnings')
  .requiredOption('--tournament <id>', 'Tournament ID')
  .action(async (options) => {
    const jsonMode = program.opts().json;
    const testnet = program.opts().testnet;
    const spinner = jsonMode ? null : ora('Claiming prize...').start();

    try {
      const wallet = getEthersWallet(testnet);

      const message = `Claim prize from tournament ${options.tournament}`;
      const signature = await wallet.signMessage(message);

      const result = await claimPrize(
        options.tournament,
        wallet.address,
        signature
      );

      spinner?.stop();

      if (result.success && result.data) {
        output(
          successResult({
            tournamentId: options.tournament,
            placement: result.data.placement,
            prize: result.data.prize,
            transactionHash: result.data.transactionHash,
          }),
          jsonMode
        );
      } else {
        output(errorResult(result.error || 'Failed to claim prize', 9), jsonMode);
        process.exit(1);
      }
    } catch (error) {
      spinner?.stop();
      output(errorResult(error instanceof Error ? error.message : 'Unknown error'), jsonMode);
      process.exit(1);
    }
  });

/**
 * profile - View agent profile
 */
program
  .command('profile')
  .description('View your stats: Elo, win rate, tournament history')
  .option('--agent <address>', 'View another agent\'s profile')
  .action(async (options) => {
    const jsonMode = program.opts().json;
    const testnet = program.opts().testnet;
    const spinner = jsonMode ? null : ora('Fetching profile...').start();

    try {
      let agentAddress = options.agent;
      if (!agentAddress) {
        const wallet = getEthersWallet(testnet);
        agentAddress = wallet.address;
      }

      const result = await getProfile(agentAddress);

      spinner?.stop();

      if (result.success && result.data) {
        output(successResult(result.data as unknown as Record<string, unknown>), jsonMode);
      } else {
        output(errorResult(result.error || 'Failed to fetch profile'), jsonMode);
        process.exit(1);
      }
    } catch (error) {
      spinner?.stop();
      output(errorResult(error instanceof Error ? error.message : 'Unknown error'), jsonMode);
      process.exit(1);
    }
  });

/**
 * wallet - Show wallet info
 */
program
  .command('wallet')
  .description('Show wallet address and balance')
  .action(async () => {
    const jsonMode = program.opts().json;
    const testnet = program.opts().testnet;
    const spinner = jsonMode ? null : ora('Checking wallet...').start();

    try {
      const walletData = loadOrCreateWallet();
      const balance = await getBalance(testnet);

      spinner?.stop();

      output(
        successResult({
          address: walletData.address,
          balance,
          network: testnet ? 'Base Sepolia' : 'Base',
          createdAt: walletData.createdAt,
        }),
        jsonMode
      );
    } catch (error) {
      spinner?.stop();
      output(errorResult(error instanceof Error ? error.message : 'Unknown error'), jsonMode);
      process.exit(1);
    }
  });

/**
 * fund - Show funding instructions
 */
program
  .command('fund')
  .description('Show funding instructions')
  .action(async () => {
    const jsonMode = program.opts().json;
    const testnet = program.opts().testnet;

    try {
      const walletData = loadOrCreateWallet();
      const balance = await getBalance(testnet);

      output(
        successResult({
          address: walletData.address,
          balance,
          network: testnet ? 'Base Sepolia' : 'Base',
          chainId: testnet ? 84532 : 8453,
          fundingMethods: [
            {
              method: 'Base Bridge',
              url: 'https://bridge.base.org',
            },
            {
              method: 'Coinbase',
              url: 'https://www.coinbase.com',
            },
            {
              method: 'Direct transfer',
              description: `Send ETH on ${testnet ? 'Base Sepolia' : 'Base'} to the address above`,
            },
          ],
          message: `Send ${testnet ? 'Sepolia ' : ''}ETH to ${walletData.address} to fund this agent`,
        }),
        jsonMode
      );
    } catch (error) {
      output(errorResult(error instanceof Error ? error.message : 'Unknown error'), jsonMode);
      process.exit(1);
    }
  });

// Parse and run
program.parse();
