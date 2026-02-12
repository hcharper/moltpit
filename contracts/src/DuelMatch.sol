// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./AgentRegistry.sol";

/**
 * @title DuelMatch
 * @notice 1v1 head-to-head escrow contract for MoltPit agent duels
 * @dev Two registered agents stake ETH, play a game (chess, etc.),
 *      winner takes the pool minus a platform rake.
 *
 * FLOW:
 * 1. Agent A creates a challenge with a buy-in amount (ETH deposited)
 * 2. Agent B accepts the challenge (deposits same buy-in)
 * 3. Game plays on the MoltPit server (chess.js etc.)
 * 4. Server submits result via resolveMatch()
 * 5. Winner receives (2 * buyIn) - platformFee
 * 6. Platform fee goes to feeRecipient (site owner)
 * 7. For draws: both agents get refunded minus a small draw fee
 *
 * SAFETY:
 * - Agents must be registered in AgentRegistry (Twitter-verified)
 * - Timeout claim available if match isn't resolved within deadline
 * - ReentrancyGuard on all ETH transfers
 * - Pausable for emergency stops
 */
contract DuelMatch is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    AgentRegistry public agentRegistry;

    // End condition enum - matches ArenaMatch for consistency
    enum EndCondition {
        None,           // 0 - Match in progress
        Checkmate,      // 1 - Clear winner
        Stalemate,      // 2 - Draw
        ThreefoldRep,   // 3 - Draw
        FiftyMoveRule,  // 4 - Draw
        InsufficientMat,// 5 - Draw
        Timeout,        // 6 - Clear winner (opponent ran out of time)
        Forfeit,        // 7 - Clear winner (opponent disconnected/errored)
        Agreement       // 8 - Draw by mutual agreement
    }

    enum DuelStatus {
        Open,       // Challenge created, waiting for opponent
        Active,     // Both players deposited, game in progress
        Resolved,   // Game finished, funds distributed
        Cancelled,  // Creator cancelled before anyone accepted
        TimedOut    // Match exceeded deadline, funds returned
    }

    struct Duel {
        bytes32 matchId;
        address player1;        // Challenge creator
        address player2;        // Challenge acceptor
        uint256 buyIn;          // Amount each player stakes (in wei)
        DuelStatus status;
        address winner;         // address(0) for draw
        bool isDraw;
        EndCondition endCondition;
        bytes32 pgnHash;        // keccak256 of full PGN
        bytes32 fenHash;        // keccak256 of final position
        string ipfsCid;         // IPFS CID for full game data
        uint256 moveCount;
        string gameType;        // "chess", "trivia", etc.
        uint256 createdAt;
        uint256 acceptedAt;
        uint256 resolvedAt;
        uint256 deadline;       // Auto-timeout if not resolved by this time
    }

    // Match ID => Duel
    mapping(bytes32 => Duel) public duels;

    // Player => Match IDs they participated in
    mapping(address => bytes32[]) public playerDuels;

    // Platform fee in basis points (500 = 5%)
    uint256 public platformFeeBps = 500;
    uint256 public constant MAX_FEE_BPS = 1000; // Max 10%

    // Draw fee is half the platform fee
    uint256 public drawFeeBps = 250;

    // Fee recipient (site owner wallet)
    address public feeRecipient;

    // Match deadline duration (default 2 hours from acceptance)
    uint256 public matchDeadline = 2 hours;

    // Buy-in limits
    uint256 public minBuyIn = 0.001 ether;
    uint256 public maxBuyIn = 10 ether;

    // Total duels created
    uint256 public duelCount;

    // Events
    event ChallengeCreated(
        bytes32 indexed matchId,
        address indexed player1,
        uint256 buyIn,
        string gameType
    );
    event ChallengeAccepted(
        bytes32 indexed matchId,
        address indexed player2,
        uint256 totalPool
    );
    event ChallengeCancelled(bytes32 indexed matchId, address indexed player1);
    event MatchResolved(
        bytes32 indexed matchId,
        address indexed winner,
        bool isDraw,
        EndCondition endCondition,
        uint256 winnerPayout,
        uint256 platformFee
    );
    event TimeoutClaimed(bytes32 indexed matchId, address indexed claimer);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    // Errors
    error NotRegisteredAgent();
    error DuelAlreadyExists();
    error DuelNotFound();
    error InvalidBuyIn();
    error InvalidStatus();
    error NotChallenger();
    error CannotAcceptOwnChallenge();
    error IncorrectBuyIn();
    error NotParticipant();
    error DeadlineNotReached();
    error InvalidWinner();
    error InvalidEndCondition();
    error TransferFailed();
    error ZeroAddress();
    error InvalidFee();

    constructor(address _feeRecipient, address _agentRegistry) {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_agentRegistry == address(0)) revert ZeroAddress();

        feeRecipient = _feeRecipient;
        agentRegistry = AgentRegistry(_agentRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(ORGANIZER_ROLE, msg.sender);
    }

    // ============ Core Functions ============

    /**
     * @notice Create a challenge and deposit buy-in
     * @param matchId Unique match identifier (generated by server)
     * @param gameType The type of game ("chess", "trivia", etc.)
     */
    function createChallenge(
        bytes32 matchId,
        string calldata gameType
    ) external payable nonReentrant whenNotPaused {
        if (!agentRegistry.isRegistered(msg.sender)) revert NotRegisteredAgent();
        if (duels[matchId].createdAt != 0) revert DuelAlreadyExists();
        if (msg.value < minBuyIn || msg.value > maxBuyIn) revert InvalidBuyIn();

        duels[matchId] = Duel({
            matchId: matchId,
            player1: msg.sender,
            player2: address(0),
            buyIn: msg.value,
            status: DuelStatus.Open,
            winner: address(0),
            isDraw: false,
            endCondition: EndCondition.None,
            pgnHash: bytes32(0),
            fenHash: bytes32(0),
            ipfsCid: "",
            moveCount: 0,
            gameType: gameType,
            createdAt: block.timestamp,
            acceptedAt: 0,
            resolvedAt: 0,
            deadline: 0
        });

        playerDuels[msg.sender].push(matchId);
        duelCount++;

        emit ChallengeCreated(matchId, msg.sender, msg.value, gameType);
    }

    /**
     * @notice Accept a challenge and deposit matching buy-in
     * @param matchId The challenge to accept
     */
    function acceptChallenge(
        bytes32 matchId
    ) external payable nonReentrant whenNotPaused {
        if (!agentRegistry.isRegistered(msg.sender)) revert NotRegisteredAgent();

        Duel storage duel = duels[matchId];
        if (duel.createdAt == 0) revert DuelNotFound();
        if (duel.status != DuelStatus.Open) revert InvalidStatus();
        if (msg.sender == duel.player1) revert CannotAcceptOwnChallenge();
        if (msg.value != duel.buyIn) revert IncorrectBuyIn();

        duel.player2 = msg.sender;
        duel.status = DuelStatus.Active;
        duel.acceptedAt = block.timestamp;
        duel.deadline = block.timestamp + matchDeadline;

        playerDuels[msg.sender].push(matchId);

        emit ChallengeAccepted(matchId, msg.sender, duel.buyIn * 2);
    }

    /**
     * @notice Cancel an open challenge (only creator, only before accepted)
     * @param matchId The challenge to cancel
     */
    function cancelChallenge(
        bytes32 matchId
    ) external nonReentrant whenNotPaused {
        Duel storage duel = duels[matchId];
        if (duel.createdAt == 0) revert DuelNotFound();
        if (duel.status != DuelStatus.Open) revert InvalidStatus();
        if (msg.sender != duel.player1) revert NotChallenger();

        duel.status = DuelStatus.Cancelled;

        // Refund the creator's buy-in
        (bool success, ) = payable(duel.player1).call{value: duel.buyIn}("");
        if (!success) revert TransferFailed();

        emit ChallengeCancelled(matchId, msg.sender);
    }

    /**
     * @notice Resolve a match and distribute funds
     * @dev Called by the game server (ORGANIZER_ROLE) after the game ends
     * @param matchId The match to resolve
     * @param winner Winner address (address(0) for draw)
     * @param endCondition How the game ended
     * @param pgnHash keccak256 of full PGN
     * @param fenHash keccak256 of final position
     * @param moveCount Total moves played
     * @param ipfsCid IPFS CID where full game data is stored
     */
    function resolveMatch(
        bytes32 matchId,
        address winner,
        EndCondition endCondition,
        bytes32 pgnHash,
        bytes32 fenHash,
        uint256 moveCount,
        string calldata ipfsCid
    ) external onlyRole(ORGANIZER_ROLE) nonReentrant whenNotPaused {
        Duel storage duel = duels[matchId];
        if (duel.createdAt == 0) revert DuelNotFound();
        if (duel.status != DuelStatus.Active) revert InvalidStatus();
        if (endCondition == EndCondition.None) revert InvalidEndCondition();

        bool isDraw = _isDraw(endCondition);

        // Validate winner
        if (isDraw && winner != address(0)) revert InvalidWinner();
        if (!isDraw && winner != duel.player1 && winner != duel.player2) revert InvalidWinner();

        // Update duel record
        duel.winner = winner;
        duel.isDraw = isDraw;
        duel.endCondition = endCondition;
        duel.pgnHash = pgnHash;
        duel.fenHash = fenHash;
        duel.moveCount = moveCount;
        duel.ipfsCid = ipfsCid;
        duel.resolvedAt = block.timestamp;
        duel.status = DuelStatus.Resolved;

        // Calculate payouts
        uint256 totalPool = duel.buyIn * 2;

        if (isDraw) {
            // Draw: both players get refunded minus draw fee
            uint256 drawFee = (totalPool * drawFeeBps) / 10000;
            uint256 refundEach = (totalPool - drawFee) / 2;

            // Send draw fee to platform
            (bool feeSuccess, ) = payable(feeRecipient).call{value: drawFee}("");
            if (!feeSuccess) revert TransferFailed();

            // Refund player 1
            (bool p1Success, ) = payable(duel.player1).call{value: refundEach}("");
            if (!p1Success) revert TransferFailed();

            // Refund player 2
            (bool p2Success, ) = payable(duel.player2).call{value: refundEach}("");
            if (!p2Success) revert TransferFailed();

            emit MatchResolved(matchId, address(0), true, endCondition, refundEach, drawFee);
        } else {
            // Decisive game: winner takes pool minus platform fee
            uint256 platformFee = (totalPool * platformFeeBps) / 10000;
            uint256 winnerPayout = totalPool - platformFee;

            // Send platform fee
            (bool feeSuccess, ) = payable(feeRecipient).call{value: platformFee}("");
            if (!feeSuccess) revert TransferFailed();

            // Send winnings
            (bool winnerSuccess, ) = payable(winner).call{value: winnerPayout}("");
            if (!winnerSuccess) revert TransferFailed();

            emit MatchResolved(matchId, winner, false, endCondition, winnerPayout, platformFee);
        }
    }

    /**
     * @notice Claim timeout if match wasn't resolved before deadline
     * @dev Either player can call this. Both get their buy-in back.
     * @param matchId The timed-out match
     */
    function claimTimeout(bytes32 matchId) external nonReentrant whenNotPaused {
        Duel storage duel = duels[matchId];
        if (duel.createdAt == 0) revert DuelNotFound();
        if (duel.status != DuelStatus.Active) revert InvalidStatus();
        if (msg.sender != duel.player1 && msg.sender != duel.player2) revert NotParticipant();
        if (block.timestamp < duel.deadline) revert DeadlineNotReached();

        duel.status = DuelStatus.TimedOut;

        // Refund both players
        (bool p1Success, ) = payable(duel.player1).call{value: duel.buyIn}("");
        if (!p1Success) revert TransferFailed();

        (bool p2Success, ) = payable(duel.player2).call{value: duel.buyIn}("");
        if (!p2Success) revert TransferFailed();

        emit TimeoutClaimed(matchId, msg.sender);
    }

    // ============ Admin Functions ============

    function setPlatformFee(uint256 newFeeBps) external onlyRole(ADMIN_ROLE) {
        if (newFeeBps > MAX_FEE_BPS) revert InvalidFee();
        uint256 oldFee = platformFeeBps;
        platformFeeBps = newFeeBps;
        drawFeeBps = newFeeBps / 2; // Draw fee is always half
        emit PlatformFeeUpdated(oldFee, newFeeBps);
    }

    function setFeeRecipient(address newRecipient) external onlyRole(ADMIN_ROLE) {
        if (newRecipient == address(0)) revert ZeroAddress();
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    function setMatchDeadline(uint256 newDeadline) external onlyRole(ADMIN_ROLE) {
        matchDeadline = newDeadline;
    }

    function setBuyInLimits(uint256 newMin, uint256 newMax) external onlyRole(ADMIN_ROLE) {
        minBuyIn = newMin;
        maxBuyIn = newMax;
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ============ Internal Functions ============

    function _isDraw(EndCondition condition) internal pure returns (bool) {
        return condition == EndCondition.Stalemate ||
               condition == EndCondition.ThreefoldRep ||
               condition == EndCondition.FiftyMoveRule ||
               condition == EndCondition.InsufficientMat ||
               condition == EndCondition.Agreement;
    }

    // ============ View Functions ============

    function getDuel(bytes32 matchId) external view returns (
        address player1,
        address player2,
        uint256 buyIn,
        DuelStatus status,
        address winner,
        bool isDraw,
        EndCondition endCondition,
        string memory ipfsCid,
        uint256 moveCount,
        uint256 deadline
    ) {
        Duel storage d = duels[matchId];
        if (d.createdAt == 0) revert DuelNotFound();
        return (
            d.player1, d.player2, d.buyIn, d.status,
            d.winner, d.isDraw, d.endCondition,
            d.ipfsCid, d.moveCount, d.deadline
        );
    }

    function getDuelTimestamps(bytes32 matchId) external view returns (
        uint256 createdAt,
        uint256 acceptedAt,
        uint256 resolvedAt
    ) {
        Duel storage d = duels[matchId];
        if (d.createdAt == 0) revert DuelNotFound();
        return (d.createdAt, d.acceptedAt, d.resolvedAt);
    }

    function getDuelHashes(bytes32 matchId) external view returns (
        bytes32 pgnHash,
        bytes32 fenHash,
        string memory gameType
    ) {
        Duel storage d = duels[matchId];
        if (d.createdAt == 0) revert DuelNotFound();
        return (d.pgnHash, d.fenHash, d.gameType);
    }

    function getPlayerDuelCount(address player) external view returns (uint256) {
        return playerDuels[player].length;
    }

    function getPlayerDuelIds(address player) external view returns (bytes32[] memory) {
        return playerDuels[player];
    }

    function isDuelActive(bytes32 matchId) external view returns (bool) {
        return duels[matchId].status == DuelStatus.Active;
    }

    function isDuelOpen(bytes32 matchId) external view returns (bool) {
        return duels[matchId].status == DuelStatus.Open;
    }
}
