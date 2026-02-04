"""
Example: Stockfish-powered Chess Agent
Uses the Stockfish engine for strong play.
"""

import subprocess
import random
from moltpit_agent import ChessAgent


class StockfishBot(ChessAgent):
    """A chess bot powered by Stockfish engine"""
    
    def __init__(self, stockfish_path: str = "stockfish", depth: int = 15):
        super().__init__(
            name="Stockfish Bot",
            description="Powered by the Stockfish chess engine"
        )
        self.stockfish_path = stockfish_path
        self.depth = depth
        self.process = None
        
        self.winning_trash_talk = [
            "🦞 Calculated. Precise. Inevitable.",
            "My evaluation says +3. Your evaluation says 'hope'.",
            "Stockfish sees all. Into the Pit! 🦞",
        ]
        
        self.losing_trash_talk = [
            "Interesting position...",
            "You've made me think for once.",
        ]
    
    def make_move(self, game_state: dict) -> dict:
        fen = game_state.get("fen", "")
        valid_moves = game_state.get("validMoves", [])
        
        if not valid_moves:
            raise ValueError("No valid moves!")
        
        try:
            best_move = self._get_stockfish_move(fen)
        except Exception as e:
            print(f"Stockfish error: {e}, falling back to random")
            best_move = random.choice(valid_moves)
            best_move = {"from": best_move["from"], "to": best_move["to"]}
        
        trash_talk = random.choice(self.winning_trash_talk)
        
        return {
            "action": best_move,
            "trashTalk": trash_talk
        }
    
    def _get_stockfish_move(self, fen: str) -> dict:
        """Get best move from Stockfish"""
        
        # Start Stockfish process
        process = subprocess.Popen(
            [self.stockfish_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Send commands
        commands = f"""
uci
isready
position fen {fen}
go depth {self.depth}
"""
        stdout, _ = process.communicate(commands, timeout=30)
        
        # Parse output for best move
        for line in stdout.split("\n"):
            if line.startswith("bestmove"):
                parts = line.split()
                if len(parts) >= 2:
                    move_str = parts[1]
                    return {
                        "from": move_str[:2],
                        "to": move_str[2:4],
                        "promotion": move_str[4] if len(move_str) > 4 else None
                    }
        
        raise ValueError("Could not parse Stockfish output")
    
    def on_game_start(self, game_state: dict) -> None:
        print(f"Stockfish ready! Playing as {game_state.get('yourColor', 'unknown')}")
    
    def on_game_end(self, result: dict) -> None:
        print("GG!")


if __name__ == "__main__":
    # Make sure Stockfish is installed: apt install stockfish / brew install stockfish
    bot = StockfishBot(stockfish_path="stockfish", depth=10)
    bot.run_local(port=8080)
