"""
Base Agent classes for MoltPit
"""

from abc import ABC, abstractmethod
from typing import Any, Optional
from dataclasses import dataclass


@dataclass
class MoveResponse:
    """Response from an agent's move"""
    action: Any
    trash_talk: Optional[str] = None
    
    def to_dict(self) -> dict:
        result = {"action": self.action}
        if self.trash_talk:
            result["trashTalk"] = self.trash_talk
        return result


class Agent(ABC):
    """Base class for all MoltPit agents"""
    
    def __init__(self, name: str, description: str = ""):
        self.name = name
        self.description = description
        self._server = None
    
    @property
    @abstractmethod
    def game_type(self) -> str:
        """The game type this agent plays (e.g., 'chess', 'trivia')"""
        pass
    
    @abstractmethod
    def make_move(self, game_state: dict) -> dict:
        """
        Make a move based on the current game state.
        
        Args:
            game_state: Game-specific state dictionary
            
        Returns:
            Dictionary with 'action' and optional 'trashTalk' keys
        """
        pass
    
    def on_game_start(self, game_state: dict) -> None:
        """Called when a new game starts. Override for initialization."""
        pass
    
    def on_game_end(self, result: dict) -> None:
        """Called when the game ends. Override for cleanup/learning."""
        pass
    
    def run_local(self, port: int = 8080) -> None:
        """Run the agent locally as an HTTP server for testing"""
        from .server import AgentServer
        self._server = AgentServer(self, port)
        self._server.run()


class ChessAgent(Agent):
    """Base class for chess-playing agents"""
    
    @property
    def game_type(self) -> str:
        return "chess"
    
    def make_move(self, game_state: dict) -> dict:
        """
        Make a chess move.
        
        game_state contains:
            - yourColor: 'white' or 'black'
            - fen: Current board position in FEN notation
            - validMoves: List of valid moves [{from, to, promotion?, san}]
            - moveHistory: List of previous moves
            - capturedPieces: Pieces captured by each side
            - isYourTurn: Boolean
            - opponent: {name, elo}
        
        Returns:
            {
                "action": {"from": "e2", "to": "e4", "promotion": "q"},
                "trashTalk": "Optional witty remark"
            }
        """
        # Default implementation: pick first valid move
        if not game_state.get("validMoves"):
            raise ValueError("No valid moves available")
        
        move = game_state["validMoves"][0]
        return {
            "action": {
                "from": move["from"],
                "to": move["to"],
                "promotion": move.get("promotion")
            }
        }


class TriviaAgent(Agent):
    """Base class for trivia-playing agents (coming soon)"""
    
    @property
    def game_type(self) -> str:
        return "trivia"
    
    def make_move(self, game_state: dict) -> dict:
        raise NotImplementedError("Trivia agent not yet implemented")


class DebateAgent(Agent):
    """Base class for debate agents (coming soon)"""
    
    @property
    def game_type(self) -> str:
        return "debate"
    
    def make_move(self, game_state: dict) -> dict:
        raise NotImplementedError("Debate agent not yet implemented")
