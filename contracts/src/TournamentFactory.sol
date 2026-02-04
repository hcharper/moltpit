// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./PrizePool.sol";

/**
 * @title TournamentFactory
 * @notice Factory contract for creating and managing tournaments
 */
contract TournamentFactory is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    
    enum TournamentStatus {
        Created,
        Registration,
        InProgress,
        Completed,
        Cancelled
    }
    
    enum BracketType {
        SingleElimination,
        DoubleElimination,
        RoundRobin,
        Swiss
    }
    
    struct Tournament {
        uint256 id;
        string name;
        string gameType;
        uint256 entryFee;
        address tokenAddress;
        uint256 maxParticipants;
        uint256 registrationStart;
        uint256 registrationEnd;
        uint256 startTime;
        BracketType bracketType;
        TournamentStatus status;
        address organizer;
        address[] participants;
        bytes32[] agentHashes; // Verified agent code hashes
    }
    
    PrizePool public prizePool;
    
    uint256 public tournamentCount;
    mapping(uint256 => Tournament) public tournaments;
    mapping(uint256 => mapping(address => bytes32)) public agentHashes;
    
    // Results storage
    mapping(uint256 => address) public firstPlace;
    mapping(uint256 => address) public secondPlace;
    mapping(uint256 => address) public thirdPlace;
    
    event TournamentCreated(
        uint256 indexed id,
        string name,
        string gameType,
        uint256 entryFee,
        address organizer
    );
    event AgentRegistered(uint256 indexed tournamentId, address indexed owner, bytes32 agentHash);
    event TournamentStarted(uint256 indexed tournamentId);
    event TournamentCompleted(uint256 indexed tournamentId, address first, address second, address third);
    event TournamentCancelled(uint256 indexed tournamentId);
    
    error InvalidTimeRange();
    error TournamentNotFound();
    error RegistrationNotOpen();
    error RegistrationClosed();
    error TournamentFull();
    error AlreadyRegistered();
    error InvalidStatus();
    error NotOrganizer();
    error EmptyAgentHash();
    
    constructor(address _prizePool) {
        prizePool = PrizePool(_prizePool);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORGANIZER_ROLE, msg.sender);
    }
    
    /**
     * @notice Create a new tournament
     */
    function createTournament(
        string calldata name,
        string calldata gameType,
        uint256 entryFee,
        address tokenAddress,
        uint256 maxParticipants,
        uint256 registrationStart,
        uint256 registrationEnd,
        uint256 startTime,
        BracketType bracketType
    ) external onlyRole(ORGANIZER_ROLE) whenNotPaused returns (uint256) {
        if (registrationStart >= registrationEnd || registrationEnd >= startTime) {
            revert InvalidTimeRange();
        }
        
        uint256 id = ++tournamentCount;
        
        Tournament storage t = tournaments[id];
        t.id = id;
        t.name = name;
        t.gameType = gameType;
        t.entryFee = entryFee;
        t.tokenAddress = tokenAddress;
        t.maxParticipants = maxParticipants;
        t.registrationStart = registrationStart;
        t.registrationEnd = registrationEnd;
        t.startTime = startTime;
        t.bracketType = bracketType;
        t.status = TournamentStatus.Created;
        t.organizer = msg.sender;
        
        // Create prize pool
        prizePool.createPool(id, entryFee, tokenAddress);
        
        emit TournamentCreated(id, name, gameType, entryFee, msg.sender);
        
        return id;
    }
    
    /**
     * @notice Register an agent for a tournament
     * @param tournamentId Tournament ID
     * @param agentHash Hash of agent code (for verification)
     */
    function registerAgent(
        uint256 tournamentId,
        bytes32 agentHash
    ) external payable nonReentrant whenNotPaused {
        Tournament storage t = tournaments[tournamentId];
        if (t.id == 0) revert TournamentNotFound();
        if (block.timestamp < t.registrationStart) revert RegistrationNotOpen();
        if (block.timestamp > t.registrationEnd) revert RegistrationClosed();
        if (t.participants.length >= t.maxParticipants) revert TournamentFull();
        if (agentHashes[tournamentId][msg.sender] != bytes32(0)) revert AlreadyRegistered();
        if (agentHash == bytes32(0)) revert EmptyAgentHash();
        
        // Update status if needed
        if (t.status == TournamentStatus.Created) {
            t.status = TournamentStatus.Registration;
        }
        
        // Pay entry fee to prize pool
        if (t.tokenAddress == address(0)) {
            prizePool.enter{value: msg.value}(tournamentId, msg.sender);
        } else {
            // For ERC20, user must approve PrizePool first
            prizePool.enter(tournamentId, msg.sender);
        }
        
        t.participants.push(msg.sender);
        t.agentHashes.push(agentHash);
        agentHashes[tournamentId][msg.sender] = agentHash;
        
        emit AgentRegistered(tournamentId, msg.sender, agentHash);
    }
    
    /**
     * @notice Start a tournament (called when matches begin)
     */
    function startTournament(uint256 tournamentId) external onlyRole(ORGANIZER_ROLE) {
        Tournament storage t = tournaments[tournamentId];
        if (t.id == 0) revert TournamentNotFound();
        if (t.status != TournamentStatus.Registration) revert InvalidStatus();
        
        t.status = TournamentStatus.InProgress;
        emit TournamentStarted(tournamentId);
    }
    
    /**
     * @notice Complete tournament and distribute prizes
     */
    function completeTournament(
        uint256 tournamentId,
        address first,
        address second,
        address third
    ) external onlyRole(ORGANIZER_ROLE) {
        Tournament storage t = tournaments[tournamentId];
        if (t.id == 0) revert TournamentNotFound();
        if (t.status != TournamentStatus.InProgress) revert InvalidStatus();
        
        t.status = TournamentStatus.Completed;
        
        firstPlace[tournamentId] = first;
        secondPlace[tournamentId] = second;
        thirdPlace[tournamentId] = third;
        
        // Distribute prizes
        prizePool.distributePrizes(tournamentId, first, second, third);
        
        emit TournamentCompleted(tournamentId, first, second, third);
    }
    
    /**
     * @notice Cancel tournament
     */
    function cancelTournament(uint256 tournamentId) external {
        Tournament storage t = tournaments[tournamentId];
        if (t.id == 0) revert TournamentNotFound();
        if (t.status == TournamentStatus.Completed) revert InvalidStatus();
        if (msg.sender != t.organizer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotOrganizer();
        }
        
        t.status = TournamentStatus.Cancelled;
        prizePool.cancelPool(tournamentId);
        
        emit TournamentCancelled(tournamentId);
    }
    
    // View functions
    function getTournament(uint256 tournamentId) external view returns (
        string memory name,
        string memory gameType,
        uint256 entryFee,
        uint256 maxParticipants,
        uint256 participantCount,
        TournamentStatus status,
        address organizer
    ) {
        Tournament storage t = tournaments[tournamentId];
        return (
            t.name,
            t.gameType,
            t.entryFee,
            t.maxParticipants,
            t.participants.length,
            t.status,
            t.organizer
        );
    }
    
    function getParticipants(uint256 tournamentId) external view returns (address[] memory) {
        return tournaments[tournamentId].participants;
    }
    
    function getAgentHashes(uint256 tournamentId) external view returns (bytes32[] memory) {
        return tournaments[tournamentId].agentHashes;
    }
    
    // Admin functions
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
