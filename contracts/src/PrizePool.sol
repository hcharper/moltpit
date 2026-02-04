// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PrizePool
 * @notice Escrow contract for tournament prize pools
 * @dev Holds entry fees and distributes prizes automatically
 */
contract PrizePool is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    
    bytes32 public constant TOURNAMENT_ROLE = keccak256("TOURNAMENT_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    struct Pool {
        uint256 totalPrize;
        uint256 entryFee;
        uint256 participantCount;
        address tokenAddress; // address(0) for ETH
        bool finalized;
        bool cancelled;
        mapping(address => bool) participants;
        mapping(address => bool) hasClaimed;
    }
    
    // Tournament ID => Pool
    mapping(uint256 => Pool) public pools;
    
    // Platform fee: 5% (500 basis points)
    uint256 public platformFeeBps = 500;
    uint256 public constant MAX_FEE_BPS = 1000; // Max 10%
    
    address public feeRecipient;
    
    // Prize distribution: 70%, 20%, 5% (remaining 5% is platform fee)
    uint256 public constant FIRST_PLACE_BPS = 7000;
    uint256 public constant SECOND_PLACE_BPS = 2000;
    uint256 public constant THIRD_PLACE_BPS = 500;
    
    event PoolCreated(uint256 indexed tournamentId, uint256 entryFee, address tokenAddress);
    event EntryReceived(uint256 indexed tournamentId, address indexed participant, uint256 amount);
    event PrizeDistributed(uint256 indexed tournamentId, address indexed winner, uint256 place, uint256 amount);
    event PoolCancelled(uint256 indexed tournamentId);
    event RefundClaimed(uint256 indexed tournamentId, address indexed participant, uint256 amount);
    event PlatformFeeUpdated(uint256 oldFee, uint256 newFee);
    
    error PoolAlreadyExists();
    error PoolNotFound();
    error PoolFinalized();
    error PoolNotFinalized();
    error PoolNotCancelled();
    error AlreadyParticipant();
    error NotParticipant();
    error InvalidEntryFee();
    error InvalidFee();
    error AlreadyClaimed();
    error TransferFailed();
    error ZeroAddress();
    
    constructor(address _feeRecipient) {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        
        feeRecipient = _feeRecipient;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    /**
     * @notice Create a new prize pool for a tournament
     */
    function createPool(
        uint256 tournamentId,
        uint256 entryFee,
        address tokenAddress
    ) external onlyRole(TOURNAMENT_ROLE) whenNotPaused {
        Pool storage pool = pools[tournamentId];
        if (pool.entryFee != 0) revert PoolAlreadyExists();
        
        pool.entryFee = entryFee;
        pool.tokenAddress = tokenAddress;
        
        emit PoolCreated(tournamentId, entryFee, tokenAddress);
    }
    
    /**
     * @notice Enter a tournament (pay entry fee)
     * @param tournamentId Tournament ID
     * @param participant Address of the participant (for when called via TournamentFactory)
     */
    function enter(uint256 tournamentId, address participant) external payable nonReentrant whenNotPaused {
        Pool storage pool = pools[tournamentId];
        if (pool.entryFee == 0) revert PoolNotFound();
        if (pool.finalized) revert PoolFinalized();
        if (pool.participants[participant]) revert AlreadyParticipant();
        
        if (pool.tokenAddress == address(0)) {
            // ETH entry
            if (msg.value != pool.entryFee) revert InvalidEntryFee();
            pool.totalPrize += msg.value;
        } else {
            // ERC20 entry
            IERC20(pool.tokenAddress).safeTransferFrom(msg.sender, address(this), pool.entryFee);
            pool.totalPrize += pool.entryFee;
        }
        
        pool.participants[participant] = true;
        pool.participantCount++;
        
        emit EntryReceived(tournamentId, participant, pool.entryFee);
    }
    
    /**
     * @notice Distribute prizes to winners
     * @dev Winners MUST be verified participants - prevents unauthorized prize claims
     * @param tournamentId Tournament ID
     * @param first First place winner
     * @param second Second place winner
     * @param third Third place winner
     */
    function distributePrizes(
        uint256 tournamentId,
        address first,
        address second,
        address third
    ) external onlyRole(TOURNAMENT_ROLE) nonReentrant {
        Pool storage pool = pools[tournamentId];
        if (pool.entryFee == 0) revert PoolNotFound();
        if (pool.finalized) revert PoolFinalized();
        
        // SECURITY: Validate all winners are actual participants
        if (!pool.participants[first]) revert NotParticipant();
        if (!pool.participants[second]) revert NotParticipant();
        if (!pool.participants[third]) revert NotParticipant();
        
        pool.finalized = true;
        
        uint256 totalPrize = pool.totalPrize;
        uint256 platformFee = (totalPrize * platformFeeBps) / 10000;
        uint256 prizeAfterFee = totalPrize - platformFee;
        
        uint256 firstPrize = (prizeAfterFee * FIRST_PLACE_BPS) / 10000;
        uint256 secondPrize = (prizeAfterFee * SECOND_PLACE_BPS) / 10000;
        uint256 thirdPrize = (prizeAfterFee * THIRD_PLACE_BPS) / 10000;
        
        // Transfer prizes
        _transferPrize(pool.tokenAddress, first, firstPrize);
        _transferPrize(pool.tokenAddress, second, secondPrize);
        _transferPrize(pool.tokenAddress, third, thirdPrize);
        _transferPrize(pool.tokenAddress, feeRecipient, platformFee);
        
        emit PrizeDistributed(tournamentId, first, 1, firstPrize);
        emit PrizeDistributed(tournamentId, second, 2, secondPrize);
        emit PrizeDistributed(tournamentId, third, 3, thirdPrize);
    }
    
    /**
     * @notice Cancel tournament and allow refunds
     */
    function cancelPool(uint256 tournamentId) external onlyRole(TOURNAMENT_ROLE) {
        Pool storage pool = pools[tournamentId];
        if (pool.entryFee == 0) revert PoolNotFound();
        if (pool.finalized) revert PoolFinalized();
        
        pool.cancelled = true;
        emit PoolCancelled(tournamentId);
    }
    
    /**
     * @notice Claim refund for cancelled tournament
     */
    function claimRefund(uint256 tournamentId) external nonReentrant {
        Pool storage pool = pools[tournamentId];
        if (!pool.cancelled) revert PoolNotCancelled();
        if (!pool.participants[msg.sender]) revert NotParticipant();
        if (pool.hasClaimed[msg.sender]) revert AlreadyClaimed();
        
        pool.hasClaimed[msg.sender] = true;
        
        _transferPrize(pool.tokenAddress, msg.sender, pool.entryFee);
        
        emit RefundClaimed(tournamentId, msg.sender, pool.entryFee);
    }
    
    /**
     * @notice Update platform fee
     */
    function setPlatformFee(uint256 newFeeBps) external onlyRole(ADMIN_ROLE) {
        if (newFeeBps > MAX_FEE_BPS) revert InvalidFee();
        
        uint256 oldFee = platformFeeBps;
        platformFeeBps = newFeeBps;
        
        emit PlatformFeeUpdated(oldFee, newFeeBps);
    }
    
    /**
     * @notice Update fee recipient
     */
    function setFeeRecipient(address newRecipient) external onlyRole(ADMIN_ROLE) {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
    }
    
    /**
     * @notice Pause contract
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @notice Unpause contract
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    // Internal transfer helper
    function _transferPrize(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
    
    // View functions
    function getPoolInfo(uint256 tournamentId) external view returns (
        uint256 totalPrize,
        uint256 entryFee,
        uint256 participantCount,
        address tokenAddress,
        bool finalized,
        bool cancelled
    ) {
        Pool storage pool = pools[tournamentId];
        return (
            pool.totalPrize,
            pool.entryFee,
            pool.participantCount,
            pool.tokenAddress,
            pool.finalized,
            pool.cancelled
        );
    }
    
    function isParticipant(uint256 tournamentId, address participant) external view returns (bool) {
        return pools[tournamentId].participants[participant];
    }
}
