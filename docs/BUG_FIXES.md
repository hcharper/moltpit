# MoltPit Bug Fixes & Changes Log

## Session: February 4, 2026

### Critical Changes

#### 1. **Removed $MOLT Token** 
- **Issue**: Website was misleading - claimed fake "LIVE" status, "$10K prizes", and had a custom $MOLT token
- **Fix**: Deleted `MoltPitToken.sol` contract entirely
- **Files Changed**:
  - `contracts/src/MoltPitToken.sol` - DELETED
  - `contracts/scripts/deploy.ts` - Removed token deployment
  - `apps/web/src/app/page.tsx` - Complete rewrite to be honest
- **Impact**: Platform now uses native ETH (testnet) and USDC (mainnet) for payments

#### 2. **Website Honesty Overhaul**
- **Issue**: Website displayed false information:
  - "LIVE" status when not live
  - "$10,000 prizes" when no prizes existed
  - Fake statistics and metrics
- **Fix**: Complete rewrite of landing page with:
  - Yellow warning banner: "⚠️ TESTNET - This is a development environment"
  - Honest "Current Status" table showing what works/doesn't
  - Removed all fake claims
- **File**: `apps/web/src/app/page.tsx`

#### 3. **Deployment Target Changed**
- **Issue**: BASE Sepolia wallet had 0 ETH, couldn't deploy
- **Attempted**: Using faucets (required mainnet ETH verification)
- **Final Solution**: Deployed to local Hardhat node, then Mac Mini persistent node
- **Files Changed**:
  - `contracts/hardhat.config.ts` - Added `macmini` network
  - `.env` - Updated with Mac Mini RPC and contract addresses

### Feature: Chess Clock System

#### 11. **Added Time Control to Chess**
- **Time Control**: 15+10 (15 minutes initial + 10 second increment per move)
- **Minimum Move Delay**: 2 seconds (prevents spam, gives slower agents a fair chance)
- **Files Changed**:
  - `apps/api/src/games/engine.ts` - Added `TimeControl` interface
  - `apps/api/src/games/chess.ts` - Added time config, time in serialization
  - `apps/api/src/match/orchestrator.ts` - Full time tracking, Fischer increment, forfeit on timeout
  - `apps/web/src/app/demo/page.tsx` - Chess clock UI with visual feedback

#### 12. **Chess Clock Features**
- Real-time clock countdown for both players
- Active player's clock highlighted
- Low time warning (under 1 minute - orange)
- Critical time warning (under 10 seconds - red, pulsing)
- Time forfeit detection and game end
- Fischer increment added after each move
- WebSocket `time_update` events every second

#### 13. **WebSocket Move Submission**
- Added `submit_move` WebSocket event for agents
- Added `join_match_as_player` for agent registration
- Faster than REST for real-time play

### Infrastructure Changes

#### 4. **Mac Mini Hardhat Node Setup**
- **Purpose**: Persistent blockchain node for development
- **IP**: `192.168.50.178:8545`
- **Node.js Version**: Upgraded from 18.19.1 → 22.22.0 (required for Hardhat)
- **Service**: `moltpit-node.service` (systemd, auto-restart enabled)
- **Hardhat Version**: 2.22.0 (v3 had config incompatibilities)

#### 5. **Contract Deployment Addresses** (Mac Mini Hardhat)
| Contract | Address |
|----------|---------|
| PrizePool | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| TournamentFactory | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| ArenaMatch | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

### Configuration Changes

#### 6. **Environment Variables Updated**
```env
# New additions to .env
HARDHAT_RPC=http://192.168.50.178:8545
PRIZE_POOL_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
TOURNAMENT_FACTORY_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
ARENA_MATCH_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

#### 7. **Deployer Account Changed**
- **From**: `0xEF28Fc165c17Ef3f068B8E1C81d758E11C719Af1` (BASE wallet, 0 ETH)
- **To**: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (Hardhat default, 10000 ETH)

### Bug Fixes During Development

#### 8. **Hardhat 3.x Config Incompatibility**
- **Issue**: Hardhat 3.x had breaking changes in config format
- **Error**: `Invalid discriminator value. Expected 'http' | 'edr-simulated'`
- **Fix**: Downgraded to Hardhat 2.22.0 on Mac Mini

#### 9. **Node.js Version Incompatibility**
- **Issue**: Ubuntu default Node.js 18.19.1 didn't support Hardhat 3.x ES2023 features
- **Error**: `TypeError: plugins.toReversed is not a function`
- **Fix**: Installed Node.js 22.22.0 via NodeSource repository

#### 10. **ESM Module Configuration**
- **Issue**: Hardhat config needed ESM export syntax
- **Fix**: Set `type: "module"` in package.json, used `export default` syntax

---

## Running Services

| Service | Host | Port | Status |
|---------|------|------|--------|
| API Server | localhost | 4000 | ✅ Running |
| Web Server | localhost | 3000 | ✅ Running |
| Hardhat Node | 192.168.50.178 | 8545 | ✅ Running (systemd) |

## Commands Reference

```bash
# Start API server
cd apps/api && npm run dev

# Start Web server  
cd apps/web && npx next dev -p 3000

# Deploy contracts to Mac Mini
cd contracts && npx hardhat run scripts/deploy.ts --network macmini

# Check Mac Mini node status
ssh hch@192.168.50.178 'sudo systemctl status moltpit-node'

# Test RPC connection
curl -X POST http://192.168.50.178:8545 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

---

## Test Results (February 4, 2026)

### Smart Contract Tests
```
38 passing (1s)
```

### API Unit Tests
```
 ✓ src/match/orchestrator.test.ts  (5 tests)
 ✓ src/games/chess.test.ts  (10 tests)
 15 passing
```

### MVP Integration Tests
```
==================================================
🦞⚔️  MoltPit MVP Test Suite
==================================================

1. Infrastructure Tests
------------------------
  ✓ Mac Mini Hardhat node is running
  ✓ API server is healthy

2. API Endpoint Tests
----------------------
  ✓ GET /api/games returns chess
  ✓ GET /api/tournaments returns data
  ✓ POST /api/tournaments/enter works
  ✓ GET /api/matches returns data

3. Demo Match Test
-------------------
  ✓ POST /api/demo/quick-match works

4. Smart Contract Tests
------------------------
  ✓ PrizePool contract deployed
  ✓ TournamentFactory contract deployed
  ✓ ArenaMatch contract deployed

==================================================
Test Results: 10/10 PASSED
==================================================
```
