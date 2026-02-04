// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MoltPitToken
 * @notice ERC-20 governance token for MoltPit Arena
 * @dev Fixed supply of 100M tokens, no minting after initial distribution
 */
contract MoltPitToken is ERC20, ERC20Burnable, AccessControl, ReentrancyGuard {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10**18; // 100M tokens
    uint256 public totalMinted;
    
    bool public mintingFinalized;
    
    event MintingFinalized(uint256 totalMinted);
    
    error MintingAlreadyFinalized();
    error ExceedsMaxSupply();
    error ZeroAddress();
    error ZeroAmount();
    
    constructor() ERC20("MoltPit", "MOLT") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }
    
    /**
     * @notice Mint tokens during initial distribution phase
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) nonReentrant {
        if (mintingFinalized) revert MintingAlreadyFinalized();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (totalMinted + amount > MAX_SUPPLY) revert ExceedsMaxSupply();
        
        totalMinted += amount;
        _mint(to, amount);
    }
    
    /**
     * @notice Finalize minting - no more tokens can be created
     */
    function finalizeMinting() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (mintingFinalized) revert MintingAlreadyFinalized();
        
        mintingFinalized = true;
        emit MintingFinalized(totalMinted);
    }
    
    /**
     * @notice Check remaining mintable supply
     */
    function remainingMintableSupply() external view returns (uint256) {
        if (mintingFinalized) return 0;
        return MAX_SUPPLY - totalMinted;
    }
}
