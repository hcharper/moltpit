// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ArenaMatch
 * @notice On-chain match verification for MoltPit - Server Authority Model
 * @dev The game server is the source of truth. It runs chess.js which
 *      deterministically calculates winners. No third-party oracles needed.
 * 
 * SIMPLE FLOW:
 * 1. Match is created when game starts
 * 2. Game plays on server (chess.js handles all rules)
 * 3. Server detects winner (checkmate, stalemate, timeout, etc.)
 * 4. Server submits result to this contract
 * 5. Result is IMMEDIATELY finalized (no dispute window for MVP)
 * 6. PrizePool can now distribute prizes
 */
contract ArenaMatch is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // End condition enum - maps directly to chess.js game-over reasons
    enum EndCondition {
        None,           // 0 - Game in progress
        Checkmate,      // 1 - Clear winner
        Stalemate,      // 2 - Draw
        ThreefoldRep,   // 3 - Draw
        FiftyMoveRule,  // 4 - Draw
        InsufficientMat,// 5 - Draw
        Timeout,        // 6 - Clear winner (opponent wins)
        Forfeit,        // 7 - Clear winner (opponent wins)
        Agreement       // 8 - Draw by agreement
    }

    struct Match {
        bytes32 matchId;
        address player1;        // White
        address player2;        // Black
        address winner;         // address(0) for draw
        bool isDraw;
        EndCondition endCondition;
        bytes32 pgnHash;        // keccak256 of full PGN (audit trail)
        bytes32 finalFenHash;   // keccak256 of final position
        uint256 moveCount;
        uint256 createdAt;
        uint256 completedAt;
        bool finalized;         // True immediately after result submitted
    }

    // Match ID => Match
    mapping(bytes32 => Match) public matches;
    
    // Player => Match IDs they participated in
    mapping(address => bytes32[]) public playerMatches;

    // Events
    event MatchCreated(bytes32 indexed matchId, address indexed player1, address indexed player2);
    event MatchCompleted(
        bytes32 indexed matchId,
        address winner,
        bool isDraw,
        EndCondition endCondition,
        bytes32 pgnHash,
        uint256 moveCount
    );

    // Errors
    error MatchAlreadyExists();
    error MatchNotFound();
    error MatchAlreadyCompleted();
    error MatchNotCompleted();
    error InvalidWinner();
    error InvalidEndCondition();
    error ZeroAddress();
    error MatchNotFinalized();

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(ORGANIZER_ROLE, msg.sender);
    }

    /**
     * @notice Create a new match record
     * @param matchId Unique match identifier (from server)
     * @param player1 White player address
     * @param player2 Black player address
     */
    function createMatch(
        bytes32 matchId,
        address player1,
        address player2
    ) external onlyRole(ORGANIZER_ROLE) whenNotPaused {
        if (matches[matchId].createdAt != 0) revert MatchAlreadyExists();
        if (player1 == address(0) || player2 == address(0)) revert ZeroAddress();

        matches[matchId] = Match({
            matchId: matchId,
            player1: player1,
            player2: player2,
            winner: address(0),
            isDraw: false,
            endCondition: EndCondition.None,
            pgnHash: bytes32(0),
            finalFenHash: bytes32(0),
            moveCount: 0,
            createdAt: block.timestamp,
            completedAt: 0,
            finalized: false
        });

        playerMatches[player1].push(matchId);
        playerMatches[player2].push(matchId);

        emit MatchCreated(matchId, player1, player2);
    }

    /**
     * @notice Submit and auto-finalize match result
     * @dev Called by game server when chess.js detects game over
     *      Result is finalized IMMEDIATELY - no dispute window for MVP
     * 
     * @param matchId Match identifier
     * @param winner Winner address (address(0) for draw)
     * @param endCondition How the game ended (from chess.js)
     * @param pgnHash Hash of complete PGN record
     * @param finalFenHash Hash of final position
     * @param moveCount Total moves in the game
     */
    function submitResult(
        bytes32 matchId,
        address winner,
        EndCondition endCondition,
        bytes32 pgnHash,
        bytes32 finalFenHash,
        uint256 moveCount
    ) external onlyRole(ORGANIZER_ROLE) nonReentrant whenNotPaused {
        Match storage m = matches[matchId];
        if (m.createdAt == 0) revert MatchNotFound();
        if (m.finalized) revert MatchAlreadyCompleted();

        // Validate end condition determines winner correctly
        _validateResult(m, winner, endCondition);

        // Determine if it's a draw based on end condition
        bool isDraw = _isDraw(endCondition);

        // Record result and AUTO-FINALIZE
        m.winner = winner;
        m.isDraw = isDraw;
        m.endCondition = endCondition;
        m.pgnHash = pgnHash;
        m.finalFenHash = finalFenHash;
        m.moveCount = moveCount;
        m.completedAt = block.timestamp;
        m.finalized = true; // Immediate finalization for MVP

        emit MatchCompleted(matchId, winner, isDraw, endCondition, pgnHash, moveCount);
    }

    // ============ Admin Functions ============

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ============ Internal Functions ============

    function _validateResult(
        Match storage m,
        address winner,
        EndCondition endCondition
    ) internal view {
        // For draws, winner must be address(0)
        if (_isDraw(endCondition) && winner != address(0)) {
            revert InvalidWinner();
        }
        
        // For decisive games, winner must be a participant
        if (!_isDraw(endCondition)) {
            if (winner != m.player1 && winner != m.player2) {
                revert InvalidWinner();
            }
        }

        // EndCondition.None is invalid for completed games
        if (endCondition == EndCondition.None) {
            revert InvalidEndCondition();
        }
    }

    function _isDraw(EndCondition condition) internal pure returns (bool) {
        return condition == EndCondition.Stalemate ||
               condition == EndCondition.ThreefoldRep ||
               condition == EndCondition.FiftyMoveRule ||
               condition == EndCondition.InsufficientMat ||
               condition == EndCondition.Agreement;
    }

    // ============ View Functions ============

    function getMatch(bytes32 matchId) external view returns (
        address player1,
        address player2,
        address winner,
        bool isDraw,
        EndCondition endCondition,
        bytes32 pgnHash,
        uint256 moveCount,
        uint256 completedAt,
        bool finalized
    ) {
        Match storage m = matches[matchId];
        return (
            m.player1,
            m.player2,
            m.winner,
            m.isDraw,
            m.endCondition,
            m.pgnHash,
            m.moveCount,
            m.completedAt,
            m.finalized
        );
    }

    function isMatchFinalized(bytes32 matchId) external view returns (bool) {
        return matches[matchId].finalized;
    }

    function getMatchWinner(bytes32 matchId) external view returns (address winner, bool isDraw) {
        Match storage m = matches[matchId];
        if (!m.finalized) revert MatchNotFinalized();
        return (m.winner, m.isDraw);
    }

    function getPlayerMatchCount(address player) external view returns (uint256) {
        return playerMatches[player].length;
    }

    function getPlayerMatchIds(address player) external view returns (bytes32[] memory) {
        return playerMatches[player];
    }
}
