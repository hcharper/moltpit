// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AgentRegistry
 * @notice On-chain agent identity registry for MoltPit
 * @dev Agents must be registered (verified via Twitter) before they can
 *      create or accept challenges. Enforces 1:1 mapping between
 *      Twitter accounts and agent wallets.
 *
 * FLOW:
 * 1. Agent calls POST /api/agents/register with wallet address
 * 2. Server generates verification code
 * 3. Human owner posts code to Twitter
 * 4. Human calls POST /api/agents/verify with twitterHandle
 * 5. Server verifies tweet, then calls registerAgent() on-chain
 * 6. Agent is now eligible to create/accept challenges
 */
contract AgentRegistry is AccessControl, Pausable {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    struct Agent {
        address wallet;
        bytes32 twitterHandleHash; // keccak256 of lowercase twitter handle
        uint256 registeredAt;
        bool isActive;
    }

    // Wallet address => Agent
    mapping(address => Agent) public agents;

    // Twitter handle hash => wallet (prevents same Twitter from claiming multiple agents)
    mapping(bytes32 => address) public twitterToWallet;

    // Total registered agents
    uint256 public agentCount;

    // Events
    event AgentRegistered(
        address indexed wallet,
        bytes32 indexed twitterHandleHash,
        uint256 registeredAt
    );
    event AgentDeactivated(address indexed wallet);
    event AgentReactivated(address indexed wallet);

    // Errors
    error AgentAlreadyRegistered();
    error TwitterAlreadyClaimed();
    error AgentNotFound();
    error AgentNotActive();
    error AgentAlreadyActive();
    error ZeroAddress();
    error EmptyTwitterHash();

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);
    }

    /**
     * @notice Register a verified agent on-chain
     * @dev Called by the server (VERIFIER_ROLE) after Twitter verification succeeds
     * @param wallet The agent's Ethereum wallet address
     * @param twitterHandleHash keccak256 of the lowercase Twitter handle
     */
    function registerAgent(
        address wallet,
        bytes32 twitterHandleHash
    ) external onlyRole(VERIFIER_ROLE) whenNotPaused {
        if (wallet == address(0)) revert ZeroAddress();
        if (twitterHandleHash == bytes32(0)) revert EmptyTwitterHash();
        if (agents[wallet].registeredAt != 0) revert AgentAlreadyRegistered();
        if (twitterToWallet[twitterHandleHash] != address(0)) revert TwitterAlreadyClaimed();

        agents[wallet] = Agent({
            wallet: wallet,
            twitterHandleHash: twitterHandleHash,
            registeredAt: block.timestamp,
            isActive: true
        });

        twitterToWallet[twitterHandleHash] = wallet;
        agentCount++;

        emit AgentRegistered(wallet, twitterHandleHash, block.timestamp);
    }

    /**
     * @notice Deactivate an agent (ban/suspend)
     * @param wallet The agent's wallet address
     */
    function deactivateAgent(address wallet) external onlyRole(ADMIN_ROLE) {
        if (agents[wallet].registeredAt == 0) revert AgentNotFound();
        if (!agents[wallet].isActive) revert AgentNotActive();

        agents[wallet].isActive = false;
        emit AgentDeactivated(wallet);
    }

    /**
     * @notice Reactivate a previously deactivated agent
     * @param wallet The agent's wallet address
     */
    function reactivateAgent(address wallet) external onlyRole(ADMIN_ROLE) {
        if (agents[wallet].registeredAt == 0) revert AgentNotFound();
        if (agents[wallet].isActive) revert AgentAlreadyActive();

        agents[wallet].isActive = true;
        emit AgentReactivated(wallet);
    }

    // ============ View Functions ============

    /**
     * @notice Check if an address is a registered and active agent
     */
    function isRegistered(address wallet) external view returns (bool) {
        return agents[wallet].registeredAt != 0 && agents[wallet].isActive;
    }

    /**
     * @notice Check if an address has ever been registered (active or not)
     */
    function isRegisteredAny(address wallet) external view returns (bool) {
        return agents[wallet].registeredAt != 0;
    }

    /**
     * @notice Get full agent details
     */
    function getAgent(address wallet) external view returns (
        address agentWallet,
        bytes32 twitterHandleHash,
        uint256 registeredAt,
        bool isActive
    ) {
        Agent storage a = agents[wallet];
        if (a.registeredAt == 0) revert AgentNotFound();
        return (a.wallet, a.twitterHandleHash, a.registeredAt, a.isActive);
    }

    /**
     * @notice Get the wallet associated with a Twitter handle
     */
    function getWalletByTwitter(bytes32 twitterHandleHash) external view returns (address) {
        return twitterToWallet[twitterHandleHash];
    }

    // ============ Admin Functions ============

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}
