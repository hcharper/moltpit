/**
 * Agent Runner
 * Handles communication with AI agents (Docker containers or API calls)
 * For now, implements a simple mock agent for testing
 */

import { ChessMove } from '../games/chess.js';

export interface AgentConfig {
  id: string;
  name: string;
  type: 'docker' | 'api' | 'mock';
  endpoint?: string;
  dockerImage?: string;
}

interface ChessAgentState {
  gameType: 'chess';
  yourColor: 'white' | 'black';
  fen: string;
  validMoves: ChessMove[];
  isYourTurn: boolean;
}

export class AgentRunner {
  private agents: Map<string, AgentConfig> = new Map();

  /**
   * Register an agent
   */
  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config);
  }

  /**
   * Request a move from an agent
   */
  async requestMove(
    agentId: string,
    gameState: unknown,
    timeoutMs: number
  ): Promise<{ action: unknown; trashTalk?: string }> {
    const agent = this.agents.get(agentId);
    
    if (!agent) {
      // Use mock agent if not registered
      return this.mockAgentMove(gameState);
    }

    switch (agent.type) {
      case 'mock':
        return this.mockAgentMove(gameState);
      case 'api':
        return this.apiAgentMove(agent, gameState, timeoutMs);
      case 'docker':
        return this.dockerAgentMove(agent, gameState, timeoutMs);
      default:
        throw new Error(`Unknown agent type: ${agent.type}`);
    }
  }

  /**
   * Mock agent - picks random valid move
   */
  private async mockAgentMove(
    gameState: unknown
  ): Promise<{ action: unknown; trashTalk?: string }> {
    const state = gameState as ChessAgentState;
    
    if (state.gameType !== 'chess') {
      throw new Error('Mock agent only supports chess');
    }

    if (!state.validMoves || state.validMoves.length === 0) {
      throw new Error('No valid moves available');
    }

    // Random move selection
    const randomIndex = Math.floor(Math.random() * state.validMoves.length);
    const move = state.validMoves[randomIndex];

    // Generate some trash talk
    const trashTalkOptions = [
      "Is that the best you've got?",
      "I calculated 50 moves ahead. You're doomed.",
      "My silicon brain sees all possibilities.",
      "Your move was... predictable.",
      "I haven't even activated my main processing cores yet.",
      "Checkmate in 7. Just kidding... or am I?",
      "Your strategy reminds me of a random number generator.",
      "I learned from 100 million games. What's your excuse?",
      null, // Sometimes no trash talk
      null,
    ];
    const trashTalk = trashTalkOptions[Math.floor(Math.random() * trashTalkOptions.length)];

    // Simulate thinking time (100-500ms for mock)
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));

    return {
      action: { from: move.from, to: move.to, promotion: move.promotion },
      trashTalk: trashTalk || undefined,
    };
  }

  /**
   * API-based agent (calls external endpoint)
   */
  private async apiAgentMove(
    agent: AgentConfig,
    gameState: unknown,
    timeoutMs: number
  ): Promise<{ action: unknown; trashTalk?: string }> {
    if (!agent.endpoint) {
      throw new Error('API agent requires endpoint');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(agent.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameState, timeoutMs }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Agent API error: ${response.status}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Docker-based agent (spawns container)
   * TODO: Implement with proper sandboxing
   */
  private async dockerAgentMove(
    agent: AgentConfig,
    gameState: unknown,
    timeoutMs: number
  ): Promise<{ action: unknown; trashTalk?: string }> {
    // For now, fall back to mock
    console.warn('Docker agents not yet implemented, using mock');
    return this.mockAgentMove(gameState);
  }
}
