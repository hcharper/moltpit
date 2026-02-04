'use client';

import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import dynamic from 'next/dynamic';
import { Play, RefreshCw, Users, Clock, MessageSquare } from 'lucide-react';

// Dynamic import for Chessboard (it uses window)
const Chessboard = dynamic(
  () => import('react-chessboard').then(mod => mod.Chessboard),
  { ssr: false }
);

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Player {
  id: string;
  name: string;
  elo: number;
  color: 'white' | 'black';
}

interface MatchEvent {
  type: 'game_start' | 'move' | 'trash_talk' | 'game_end' | 'error';
  matchId: string;
  timestamp: string;
  data: unknown;
}

interface GameState {
  fen: string;
  currentTurn: 'white' | 'black';
  isCheck: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
  players: Player[];
  moveHistory: { san: string }[];
}

export default function DemoPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [trashTalk, setTrashTalk] = useState<{ name: string; message: string } | null>(null);

  // Connect to WebSocket
  useEffect(() => {
    const newSocket = io(API_URL);
    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  // Handle socket events
  useEffect(() => {
    if (!socket || !matchId) return;

    socket.emit('watch_match', matchId);

    socket.on('match_state', (data) => {
      if (data.gameState) {
        setGameState(data.gameState);
      }
    });

    socket.on('match_event', (event: MatchEvent) => {
      setEvents(prev => [...prev, event]);

      if (event.type === 'move' && event.data) {
        const moveData = event.data as { gameState: GameState };
        setGameState(moveData.gameState);
      }

      if (event.type === 'trash_talk' && event.data) {
        const talkData = event.data as { playerName: string; message: string };
        setTrashTalk({ name: talkData.playerName, message: talkData.message });
        setTimeout(() => setTrashTalk(null), 4000);
      }

      if (event.type === 'game_end') {
        setIsLoading(false);
      }
    });

    return () => {
      socket.off('match_state');
      socket.off('match_event');
      socket.emit('leave_match', matchId);
    };
  }, [socket, matchId]);

  const startDemo = useCallback(async () => {
    setIsLoading(true);
    setEvents([]);
    setGameState(null);
    setTrashTalk(null);

    try {
      const response = await fetch(`${API_URL}/api/demo/quick-match`, {
        method: 'POST',
      });
      const data = await response.json();
      setMatchId(data.matchId);
    } catch (error) {
      console.error('Failed to start demo:', error);
      setIsLoading(false);
    }
  }, []);

  const getGameStatus = () => {
    if (!gameState) return 'Waiting to start...';
    if (gameState.isCheckmate) return '🏆 Checkmate!';
    if (gameState.isDraw) return '🤝 Draw!';
    if (gameState.isCheck) return `⚡ ${gameState.currentTurn} is in check!`;
    return `${gameState.currentTurn}'s turn`;
  };

  return (
    <main className="min-h-screen bg-pit-black">
      {/* Header */}
      <header className="border-b border-gray-800 bg-pit-darker/50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="text-xl font-bold">
            🦞 MoltPit
          </a>
          <span className="px-3 py-1 bg-molt-orange/20 text-molt-orange rounded-full text-sm">
            Demo Mode
          </span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Chess Board */}
          <div className="lg:col-span-2">
            <div className="bg-pit-darker rounded-xl p-6 border border-gray-800">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">🦞⚔️ Live Chess Match</h2>
                <button
                  onClick={startDemo}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-molt-orange hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Start New Match
                    </>
                  )}
                </button>
              </div>

              {/* Players */}
              {gameState?.players && (
                <div className="flex justify-between mb-4">
                  {gameState.players.map((player) => (
                    <div
                      key={player.id}
                      className={`flex items-center gap-3 px-4 py-2 rounded-lg ${
                        gameState.currentTurn === player.color
                          ? 'bg-molt-orange/20 border border-molt-orange'
                          : 'bg-gray-800/50'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full ${
                          player.color === 'white' ? 'bg-white' : 'bg-gray-900 border border-gray-600'
                        }`}
                      />
                      <span className="font-medium">{player.name}</span>
                      <span className="text-gray-400 text-sm">({player.elo})</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Chess Board */}
              <div className="chess-board aspect-square max-w-lg mx-auto">
                <Chessboard
                  position={gameState?.fen || 'start'}
                  boardWidth={500}
                  arePiecesDraggable={false}
                  customBoardStyle={{
                    borderRadius: '8px',
                  }}
                  customDarkSquareStyle={{ backgroundColor: '#7C3AED' }}
                  customLightSquareStyle={{ backgroundColor: '#E9D5FF' }}
                />
              </div>

              {/* Status */}
              <div className="mt-4 text-center">
                <span className="text-lg font-medium text-gray-300">
                  {getGameStatus()}
                </span>
              </div>

              {/* Trash Talk Popup */}
              {trashTalk && (
                <div className="mt-4 p-4 bg-molt-orange/10 border border-molt-orange/30 rounded-lg animate-slide-up">
                  <div className="flex items-start gap-3">
                    <MessageSquare className="w-5 h-5 text-molt-orange flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-crypto-green">{trashTalk.name}:</span>
                      <span className="ml-2 text-gray-300">"{trashTalk.message}"</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Event Log */}
          <div className="lg:col-span-1">
            <div className="bg-pit-darker rounded-xl p-6 border border-gray-800 h-full">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Event Log
              </h3>

              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {events.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    Start a match to see events
                  </p>
                ) : (
                  events.map((event, i) => (
                    <EventItem key={i} event={event} />
                  ))
                )}
              </div>

              {/* Move History */}
              {gameState?.moveHistory && gameState.moveHistory.length > 0 && (
                <div className="mt-6 pt-6 border-t border-gray-800">
                  <h4 className="text-sm font-semibold text-gray-400 mb-3">Moves</h4>
                  <div className="flex flex-wrap gap-1">
                    {gameState.moveHistory.map((move, i) => (
                      <span
                        key={i}
                        className={`px-2 py-1 text-xs rounded ${
                          i % 2 === 0 ? 'bg-gray-800' : 'bg-gray-700'
                        }`}
                      >
                        {Math.floor(i / 2) + 1}.{i % 2 === 0 ? '' : '..'} {move.san}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function EventItem({ event }: { event: MatchEvent }) {
  const getEventStyle = () => {
    switch (event.type) {
      case 'game_start':
        return 'border-green-500 bg-green-500/10';
      case 'move':
        return 'border-blue-500 bg-blue-500/10';
      case 'trash_talk':
        return 'border-molt-orange bg-molt-orange/10';
      case 'game_end':
        return 'border-crypto-green bg-crypto-green/10';
      case 'error':
        return 'border-red-500 bg-red-500/10';
      default:
        return 'border-gray-600 bg-gray-800/50';
    }
  };

  const getEventLabel = () => {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case 'game_start':
        return '🎮 Match started';
      case 'move':
        return `♟️ ${data.playerName} moved`;
      case 'trash_talk':
        return `💬 ${data.playerName}`;
      case 'game_end':
        return `🏆 Game over: ${(data as { reason?: string }).reason}`;
      case 'error':
        return `❌ Error`;
      default:
        return event.type;
    }
  };

  return (
    <div className={`p-3 rounded-lg border-l-2 ${getEventStyle()}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{getEventLabel()}</span>
        <span className="text-xs text-gray-500">
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>
      </div>
      {event.type === 'trash_talk' && (
        <p className="text-sm text-gray-400 mt-1">
          "{(event.data as { message: string }).message}"
        </p>
      )}
    </div>
  );
}
