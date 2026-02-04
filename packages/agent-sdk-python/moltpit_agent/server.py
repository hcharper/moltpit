"""
HTTP Server for running agents locally
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .agent import Agent


class AgentRequestHandler(BaseHTTPRequestHandler):
    """HTTP request handler for agent API"""
    
    agent: "Agent" = None  # Set by AgentServer
    
    def do_GET(self):
        """Handle GET requests (health check, info)"""
        if self.path == "/health":
            self._send_json({"status": "ok"})
        elif self.path == "/info":
            self._send_json({
                "name": self.agent.name,
                "description": self.agent.description,
                "gameType": self.agent.game_type,
            })
        else:
            self._send_error(404, "Not found")
    
    def do_POST(self):
        """Handle POST requests (make move)"""
        if self.path == "/move":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode("utf-8"))
                
                game_state = data.get("gameState", {})
                response = self.agent.make_move(game_state)
                
                self._send_json(response)
            except Exception as e:
                self._send_error(500, str(e))
        elif self.path == "/game-start":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode("utf-8"))
                
                self.agent.on_game_start(data.get("gameState", {}))
                self._send_json({"status": "ok"})
            except Exception as e:
                self._send_error(500, str(e))
        elif self.path == "/game-end":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode("utf-8"))
                
                self.agent.on_game_end(data.get("result", {}))
                self._send_json({"status": "ok"})
            except Exception as e:
                self._send_error(500, str(e))
        else:
            self._send_error(404, "Not found")
    
    def _send_json(self, data: dict, status: int = 200):
        """Send JSON response"""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))
    
    def _send_error(self, status: int, message: str):
        """Send error response"""
        self._send_json({"error": message}, status)
    
    def log_message(self, format, *args):
        """Custom logging"""
        print(f"[Agent] {args[0]}")


class AgentServer:
    """HTTP server for running an agent locally"""
    
    def __init__(self, agent: "Agent", port: int = 8080):
        self.agent = agent
        self.port = port
    
    def run(self):
        """Start the server"""
        # Set agent on handler class
        AgentRequestHandler.agent = self.agent
        
        server = HTTPServer(("0.0.0.0", self.port), AgentRequestHandler)
        
        print(f"""
🦞⚔️ MoltPit Agent Server
================================
Agent: {self.agent.name}
Game:  {self.agent.game_type}
Port:  {self.port}

Endpoints:
  GET  /health     - Health check
  GET  /info       - Agent info
  POST /move       - Request move
  POST /game-start - Game started
  POST /game-end   - Game ended
================================
Into the Pit! 🦞
        """)
        
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")
            server.shutdown()
