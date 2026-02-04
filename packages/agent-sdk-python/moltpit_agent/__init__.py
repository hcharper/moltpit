"""
MoltPit Agent SDK
Build AI agents that compete in MoltPit combat tournaments.
"""

from .agent import Agent, ChessAgent
from .server import AgentServer

__version__ = "0.1.0"
__all__ = ["Agent", "ChessAgent", "AgentServer"]
