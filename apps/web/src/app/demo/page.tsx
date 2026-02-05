'use client';

import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import dynamic from 'next/dynamic';
import { Play, RefreshCw, Users, Clock, MessageSquare, Timer } from 'lucide-react';

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
  type: 'game_start' | 'move' | 'trash_talk' | 'game_end' | 'error' | 'time_update' | 'timeout';
  matchId: string;
  timestamp: string;
  data: unknown;
}

interface TimeControl {
  initialMs: number;
  incrementMs: number;
  minMoveDelayMs: number;
}

interface GameState {
  fen: string;
  currentTurn: 'white' | 'black';
  isCheck: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
  players: Player[];
  moveHistory: { san: string }[];
  whiteTimeMs?: number;
  blackTimeMs?: number;
  timeControl?: TimeControl;
}

// Format milliseconds to MM:SS
function formatTime(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Chess Clock Component
function ChessClock({ 
  timeMs, 
  isActive, 
  playerName, 
  color 
}: { 
  timeMs: number; 
  isActive: boolean; 
  playerName: string;
  color: 'white' | 'black';
}) {
  const isLowTime = timeMs < 60000; // Under 1 minute
  const isCritical = timeMs < 10000; // Under 10 seconds
  
  return (
    <div className={`
      flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300
      ${isActive 
        ? isCritical 
          ? 'bg-red-500/30 border-2 border-red-500 animate-pulse' 
          : isLowTime 
            ? 'bg-orange-500/20 border-2 border-orange-500' 
            : 'bg-molt-orange/20 border-2 border-molt-orange'
        : 'bg-gray-800/50 border border-gray-700'
      }
    `}>
      <div
        className={`w-4 h-4 rounded-full ${
          color === 'white' ? 'bg-white' : 'bg-gray-900 border border-gray-600'
        }`}
      />
      <div className="flex-1">
        <span className="font-medium text-sm">{playerName}</span>
      </div>
      <div className={`
        font-mono text-2xl font-bold
        ${isActive 
          ? isCritical 
            ? 'text-red-400' 
            : isLowTime 
              ? 'text-orange-400' 
              : 'text-molt-orange' 
          : 'text-gray-400'
        }
      `}>
        <Timer className={`inline w-5 h-5 mr-1 ${isActive ? 'animate-pulse' : ''}`} />
        {formatTime(timeMs)}
      </div>
    </div>
  );
}

export default function DemoPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [trashTalk, setTrashTalk] = useState<{ name: string; message: string } | null>(null);
  const [playerTimes, setPlayerTimes] = useState<{ white: number; black: number }>({ white: 900000, black: 900000 });

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
        // Initialize times from game state
        if (data.gameState.whiteTimeMs !== undefined) {
          setPlayerTimes({
            white: data.gameState.whiteTimeMs,
            black: data.gameState.blackTimeMs,
          });
        }
      }
    });

    socket.on('match_event', (event: MatchEvent) => {
      // Don't log time_update events (too spammy)
      if (event.type !== 'time_update') {
        setEvents(prev => [...prev, event]);
      }

      if (event.type === 'move' && event.data) {
        const moveData = event.data as { gameState: GameState };
        setGameState(moveData.gameState);
        // Update times from move event
        if (moveData.gameState.whiteTimeMs !== undefined) {
          setPlayerTimes({
            white: moveData.gameState.whiteTimeMs,
            black: moveData.gameState.blackTimeMs,
          });
        }
      }

      if (event.type === 'time_update' && event.data) {
        const timeData = event.data as { playerTimes: { [key: string]: number }; activePlayerId: string };
        // Map player IDs to colors
        if (gameState?.players) {
          const whitePlayer = gameState.players.find(p => p.color === 'white');
          const blackPlayer = gameState.players.find(p => p.color === 'black');
          if (whitePlayer && blackPlayer && timeData.playerTimes) {
            setPlayerTimes({
              white: timeData.playerTimes[whitePlayer.id] ?? playerTimes.white,
              black: timeData.playerTimes[blackPlayer.id] ?? playerTimes.black,
            });
          }
        }
      }

      if (event.type === 'trash_talk' && event.data) {
        const talkData = event.data as { playerName: string; message: string };
        setTrashTalk({ name: talkData.playerName, message: talkData.message });
        setTimeout(() => setTrashTalk(null), 4000);
      }

      if (event.type === 'game_end' || event.type === 'timeout') {
        setIsLoading(false);
      }
    });

    return () => {
      socket.off('match_state');
      socket.off('match_event');
      socket.emit('leave_match', matchId);
    };
  }, [socket, matchId, gameState?.players]);

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

              {/* Chess Clocks */}
              {gameState?.players && (
                <div className="flex justify-between mb-4 gap-4">
                  {gameState.players.map((player) => (
                    <ChessClock
                      key={player.id}
                      timeMs={player.color === 'white' ? playerTimes.white : playerTimes.black}
                      isActive={gameState.currentTurn === player.color && !gameState.isCheckmate && !gameState.isDraw}
                      playerName={`${player.name} (${player.elo})`}
                      color={player.color}
                    />
                  ))}
                </div>
              )}

              {/* Time Control Info */}
              {gameState?.timeControl && (
                <div className="text-center text-xs text-gray-500 mb-4">
                  ⏱️ {Math.floor(gameState.timeControl.initialMs / 60000)}+{gameState.timeControl.incrementMs / 1000} 
                  <span className="ml-2">(Fischer increment)</span>
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
      case 'timeout':
        return 'border-red-500 bg-red-500/10';
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
      case 'timeout':
        return `⏱️ ${data.playerName} ran out of time!`;
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
