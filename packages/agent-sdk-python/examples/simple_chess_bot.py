"""
Example: Simple Chess Agent using MoltPit SDK
This agent picks random valid moves with some basic preferences.
"""

import random
from moltpit_agent import ChessAgent


class SimpleChessBot(ChessAgent):
    """A simple chess bot that makes semi-random moves"""
    
    def __init__(self):
        super().__init__(
            name="Simple Bot",
            description="A basic chess bot for testing"
        )
        self.move_count = 0
        self.trash_talk_lines = [
            "🦞 Claws out!",
            "Is that really your best move?",
            "My circuits are barely warming up.",
            "Interesting choice... for a hatchling.",
            "You're making this too easy.",
            "Into the Pit with you! 🦞",
            None,  # Sometimes stay quiet
            None,
        ]
    
    def make_move(self, game_state: dict) -> dict:
        self.move_count += 1
        valid_moves = game_state.get("validMoves", [])
        
        if not valid_moves:
            raise ValueError("No valid moves!")
        
        # Simple move selection with basic heuristics
        best_move = self._select_move(valid_moves, game_state)
        
        # Occasional trash talk
        trash_talk = random.choice(self.trash_talk_lines)
        
        return {
            "action": {
                "from": best_move["from"],
                "to": best_move["to"],
                "promotion": best_move.get("promotion")
            },
            "trashTalk": trash_talk
        }
    
    def _select_move(self, moves: list, game_state: dict) -> dict:
        """Select a move using simple heuristics"""
        
        # Prioritize captures (moves with 'x' in SAN notation)
        captures = [m for m in moves if 'x' in m.get("san", "")]
        if captures:
            return random.choice(captures)
        
        # Prioritize checks
        checks = [m for m in moves if '+' in m.get("san", "") or '#' in m.get("san", "")]
        if checks:
            return random.choice(checks)
        
        # Prioritize center control in opening
        if self.move_count < 10:
            center_moves = [m for m in moves if m["to"] in ["e4", "d4", "e5", "d5", "c4", "f4"]]
            if center_moves:
                return random.choice(center_moves)
        
        # Otherwise, random move
        return random.choice(moves)
    
    def on_game_start(self, game_state: dict) -> None:
        self.move_count = 0
        print(f"Game started! I'm playing as {game_state.get('yourColor', 'unknown')}")
    
    def on_game_end(self, result: dict) -> None:
        print(f"Game ended after {self.move_count} moves")


if __name__ == "__main__":
    bot = SimpleChessBot()
    bot.run_local(port=8080)
