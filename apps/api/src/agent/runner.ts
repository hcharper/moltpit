/**
 * Agent Runner
 * Handles communication with AI agents (Docker containers, API calls, or WebSocket)
 * Supports mock, api, docker, and websocket agent types
 */

import { ChessMove } from '../games/chess.js';
import type { Socket } from 'socket.io';

export interface AgentConfig {
  id: string;
  name: string;
  type: 'docker' | 'api' | 'mock' | 'websocket';
  endpoint?: string;
  dockerImage?: string;
  address?: string; // Ethereum wallet address for on-chain agents
}

interface ChessAgentState {
  gameType: 'chess';
  yourColor: 'white' | 'black';
  fen: string;
  validMoves: ChessMove[];
  isYourTurn: boolean;
}

interface PendingMove {
  resolve: (value: { action: unknown; trashTalk?: string }) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
  matchId: string;
}

export class AgentRunner {
  private agents: Map<string, AgentConfig> = new Map();
  private pendingMoves: Map<string, PendingMove> = new Map();
  private agentSockets: Map<string, Socket> = new Map(); // agentId → socket
  private socketToAgent: Map<string, string> = new Map(); // socketId → agentId

  /**
   * Register an agent
   */
  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config);
  }

  /**
   * Get a registered agent config
   */
  getAgent(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Associate a Socket.IO socket with an agent ID (for websocket agents)
   */
  bindSocket(agentId: string, socket: Socket): void {
    this.agentSockets.set(agentId, socket);
    this.socketToAgent.set(socket.id, agentId);
  }

  /**
   * Remove socket binding (on disconnect)
   */
  unbindSocket(socketId: string): string | undefined {
    const agentId = this.socketToAgent.get(socketId);
    if (agentId) {
      this.agentSockets.delete(agentId);
      this.socketToAgent.delete(socketId);

      // Reject any pending move for this agent
      const pending = this.pendingMoves.get(agentId);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Agent disconnected'));
        this.pendingMoves.delete(agentId);
      }
    }
    return agentId;
  }

  /**
   * Resolve a pending move from an external (websocket) agent
   * Called by the submit_move socket handler
   */
  resolveExternalMove(agentId: string, move: { action: unknown; trashTalk?: string }): boolean {
    const pending = this.pendingMoves.get(agentId);
    if (!pending) {
      return false; // No pending move request for this agent
    }
    clearTimeout(pending.timeout);
    pending.resolve(move);
    this.pendingMoves.delete(agentId);
    return true;
  }

  /**
   * Check if an agent has a socket bound
   */
  hasSocket(agentId: string): boolean {
    return this.agentSockets.has(agentId);
  }

  /**
   * Get the agent ID associated with a socket ID
   */
  getAgentIdForSocket(socketId: string): string | undefined {
    return this.socketToAgent.get(socketId);
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
      case 'websocket':
        return this.websocketAgentMove(agent, gameState, timeoutMs);
      case 'docker':
        return this.dockerAgentMove(agent, gameState, timeoutMs);
      default:
        throw new Error(`Unknown agent type: ${agent.type}`);
    }
  }

  /**
   * WebSocket-based agent — emits game_state to the agent's socket,
   * then waits for a submit_move response via resolveExternalMove().
   */
  private websocketAgentMove(
    agent: AgentConfig,
    gameState: unknown,
    timeoutMs: number
  ): Promise<{ action: unknown; trashTalk?: string }> {
    const socket = this.agentSockets.get(agent.id);
    if (!socket) {
      throw new Error(`WebSocket agent ${agent.id} not connected`);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingMoves.delete(agent.id);
        reject(new Error(`WebSocket agent ${agent.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingMoves.set(agent.id, {
        resolve,
        reject,
        timeout,
        matchId: '', // Set by the caller context
      });

      // Send game state to the agent
      socket.emit('game_state', gameState);
    });
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

      return await response.json() as { action: unknown; trashTalk?: string };
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
