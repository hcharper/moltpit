import { expect } from "chai";
import { ethers } from "hardhat";
import { DuelMatch, AgentRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DuelMatch", function () {
  let duelMatch: DuelMatch;
  let registry: AgentRegistry;
  let owner: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let agent1: SignerWithAddress;
  let agent2: SignerWithAddress;
  let agent3: SignerWithAddress;
  let nonAgent: SignerWithAddress;

  const BUY_IN = ethers.parseEther("0.1");
  const MATCH_ID = ethers.keccak256(ethers.toUtf8Bytes("match-001"));
  const MATCH_ID_2 = ethers.keccak256(ethers.toUtf8Bytes("match-002"));
  const PGN_HASH = ethers.keccak256(ethers.toUtf8Bytes("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#"));
  const FEN_HASH = ethers.keccak256(ethers.toUtf8Bytes("rnbqkb1r/pppp1Qpp/5n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR"));
  const IPFS_CID = "bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

  const twitterHash1 = ethers.keccak256(ethers.toUtf8Bytes("agent_alice"));
  const twitterHash2 = ethers.keccak256(ethers.toUtf8Bytes("agent_bob"));
  const twitterHash3 = ethers.keccak256(ethers.toUtf8Bytes("agent_charlie"));

  beforeEach(async function () {
    [owner, feeRecipient, agent1, agent2, agent3, nonAgent] = await ethers.getSigners();

    // Deploy AgentRegistry
    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    registry = await AgentRegistry.deploy();
    await registry.waitForDeployment();

    // Deploy DuelMatch
    const DuelMatch = await ethers.getContractFactory("DuelMatch");
    duelMatch = await DuelMatch.deploy(feeRecipient.address, await registry.getAddress());
    await duelMatch.waitForDeployment();

    // Register agents in registry
    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();
    await registry.grantRole(VERIFIER_ROLE, owner.address);
    await registry.registerAgent(agent1.address, twitterHash1);
    await registry.registerAgent(agent2.address, twitterHash2);
    await registry.registerAgent(agent3.address, twitterHash3);
  });

  describe("Deployment", function () {
    it("Should set fee recipient", async function () {
      expect(await duelMatch.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("Should set agent registry", async function () {
      expect(await duelMatch.agentRegistry()).to.equal(await registry.getAddress());
    });

    it("Should set platform fee to 5%", async function () {
      expect(await duelMatch.platformFeeBps()).to.equal(500);
    });

    it("Should set draw fee to 2.5%", async function () {
      expect(await duelMatch.drawFeeBps()).to.equal(250);
    });

    it("Should revert with zero fee recipient", async function () {
      const DuelMatch = await ethers.getContractFactory("DuelMatch");
      await expect(
        DuelMatch.deploy(ethers.ZeroAddress, await registry.getAddress())
      ).to.be.revertedWithCustomError(duelMatch, "ZeroAddress");
    });

    it("Should revert with zero registry address", async function () {
      const DuelMatch = await ethers.getContractFactory("DuelMatch");
      await expect(
        DuelMatch.deploy(feeRecipient.address, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(duelMatch, "ZeroAddress");
    });
  });

  describe("Create Challenge", function () {
    it("Should create a challenge with ETH deposit", async function () {
      await expect(
        duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN })
      ).to.emit(duelMatch, "ChallengeCreated")
        .withArgs(MATCH_ID, agent1.address, BUY_IN, "chess");

      expect(await duelMatch.isDuelOpen(MATCH_ID)).to.be.true;
      expect(await duelMatch.duelCount()).to.equal(1);
    });

    it("Should hold ETH in contract", async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });

      expect(await ethers.provider.getBalance(await duelMatch.getAddress())).to.equal(BUY_IN);
    });

    it("Should store correct duel details", async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });

      const [player1, player2, buyIn, status] = await duelMatch.getDuel(MATCH_ID);
      expect(player1).to.equal(agent1.address);
      expect(player2).to.equal(ethers.ZeroAddress);
      expect(buyIn).to.equal(BUY_IN);
      expect(status).to.equal(0); // Open
    });

    it("Should track player duels", async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });
      expect(await duelMatch.getPlayerDuelCount(agent1.address)).to.equal(1);
    });

    it("Should revert for unregistered agent", async function () {
      await expect(
        duelMatch.connect(nonAgent).createChallenge(MATCH_ID, "chess", { value: BUY_IN })
      ).to.be.revertedWithCustomError(duelMatch, "NotRegisteredAgent");
    });

    it("Should revert for duplicate match ID", async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });
      await expect(
        duelMatch.connect(agent2).createChallenge(MATCH_ID, "chess", { value: BUY_IN })
      ).to.be.revertedWithCustomError(duelMatch, "DuelAlreadyExists");
    });

    it("Should revert for buy-in below minimum", async function () {
      await expect(
        duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: ethers.parseEther("0.0001") })
      ).to.be.revertedWithCustomError(duelMatch, "InvalidBuyIn");
    });

    it("Should revert for buy-in above maximum", async function () {
      await expect(
        duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: ethers.parseEther("100") })
      ).to.be.revertedWithCustomError(duelMatch, "InvalidBuyIn");
    });

    it("Should revert when paused", async function () {
      await duelMatch.pause();
      await expect(
        duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN })
      ).to.be.revertedWithCustomError(duelMatch, "EnforcedPause");
    });
  });

  describe("Accept Challenge", function () {
    beforeEach(async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });
    });

    it("Should accept a challenge with matching deposit", async function () {
      await expect(
        duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN })
      ).to.emit(duelMatch, "ChallengeAccepted")
        .withArgs(MATCH_ID, agent2.address, BUY_IN * 2n);
    });

    it("Should set status to Active", async function () {
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN });
      expect(await duelMatch.isDuelActive(MATCH_ID)).to.be.true;
    });

    it("Should hold both deposits in contract", async function () {
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN });
      expect(await ethers.provider.getBalance(await duelMatch.getAddress())).to.equal(BUY_IN * 2n);
    });

    it("Should set the deadline", async function () {
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN });
      const [,,,, , , , , ,deadline] = await duelMatch.getDuel(MATCH_ID);
      expect(deadline).to.be.gt(0);
    });

    it("Should revert for unregistered agent", async function () {
      await expect(
        duelMatch.connect(nonAgent).acceptChallenge(MATCH_ID, { value: BUY_IN })
      ).to.be.revertedWithCustomError(duelMatch, "NotRegisteredAgent");
    });

    it("Should revert if challenger tries to accept own challenge", async function () {
      await expect(
        duelMatch.connect(agent1).acceptChallenge(MATCH_ID, { value: BUY_IN })
      ).to.be.revertedWithCustomError(duelMatch, "CannotAcceptOwnChallenge");
    });

    it("Should revert with wrong buy-in amount", async function () {
      await expect(
        duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN / 2n })
      ).to.be.revertedWithCustomError(duelMatch, "IncorrectBuyIn");
    });

    it("Should revert for non-existent challenge", async function () {
      await expect(
        duelMatch.connect(agent2).acceptChallenge(MATCH_ID_2, { value: BUY_IN })
      ).to.be.revertedWithCustomError(duelMatch, "DuelNotFound");
    });

    it("Should revert if challenge already accepted", async function () {
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN });
      await expect(
        duelMatch.connect(agent3).acceptChallenge(MATCH_ID, { value: BUY_IN })
      ).to.be.revertedWithCustomError(duelMatch, "InvalidStatus");
    });
  });

  describe("Cancel Challenge", function () {
    beforeEach(async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });
    });

    it("Should cancel and refund the creator", async function () {
      const balBefore = await ethers.provider.getBalance(agent1.address);

      const tx = await duelMatch.connect(agent1).cancelChallenge(MATCH_ID);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balAfter = await ethers.provider.getBalance(agent1.address);
      expect(balAfter - balBefore + gasUsed).to.equal(BUY_IN);
    });

    it("Should emit ChallengeCancelled", async function () {
      await expect(
        duelMatch.connect(agent1).cancelChallenge(MATCH_ID)
      ).to.emit(duelMatch, "ChallengeCancelled")
        .withArgs(MATCH_ID, agent1.address);
    });

    it("Should revert if not the challenger", async function () {
      await expect(
        duelMatch.connect(agent2).cancelChallenge(MATCH_ID)
      ).to.be.revertedWithCustomError(duelMatch, "NotChallenger");
    });

    it("Should revert if already accepted", async function () {
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN });
      await expect(
        duelMatch.connect(agent1).cancelChallenge(MATCH_ID)
      ).to.be.revertedWithCustomError(duelMatch, "InvalidStatus");
    });
  });

  describe("Resolve Match — Decisive Game", function () {
    beforeEach(async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN });
    });

    it("Should distribute funds correctly: winner gets 95%, platform gets 5%", async function () {
      const totalPool = BUY_IN * 2n;
      const platformFee = (totalPool * 500n) / 10000n; // 5%
      const winnerPayout = totalPool - platformFee;

      const winnerBalBefore = await ethers.provider.getBalance(agent1.address);
      const feeBalBefore = await ethers.provider.getBalance(feeRecipient.address);

      await duelMatch.resolveMatch(
        MATCH_ID, agent1.address,
        1, // Checkmate
        PGN_HASH, FEN_HASH, 7, IPFS_CID
      );

      const winnerBalAfter = await ethers.provider.getBalance(agent1.address);
      const feeBalAfter = await ethers.provider.getBalance(feeRecipient.address);

      expect(winnerBalAfter - winnerBalBefore).to.equal(winnerPayout);
      expect(feeBalAfter - feeBalBefore).to.equal(platformFee);
    });

    it("Should emit MatchResolved for decisive game", async function () {
      const totalPool = BUY_IN * 2n;
      const platformFee = (totalPool * 500n) / 10000n;
      const winnerPayout = totalPool - platformFee;

      await expect(
        duelMatch.resolveMatch(MATCH_ID, agent1.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID)
      ).to.emit(duelMatch, "MatchResolved")
        .withArgs(MATCH_ID, agent1.address, false, 1, winnerPayout, platformFee);
    });

    it("Should store game data on-chain", async function () {
      await duelMatch.resolveMatch(MATCH_ID, agent1.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID);

      const [pgnHash, fenHash, gameType] = await duelMatch.getDuelHashes(MATCH_ID);
      expect(pgnHash).to.equal(PGN_HASH);
      expect(fenHash).to.equal(FEN_HASH);
      expect(gameType).to.equal("chess");
    });

    it("Should store IPFS CID on-chain", async function () {
      await duelMatch.resolveMatch(MATCH_ID, agent1.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID);

      const [,,,,,,, ipfsCid] = await duelMatch.getDuel(MATCH_ID);
      expect(ipfsCid).to.equal(IPFS_CID);
    });

    it("Should empty the contract balance", async function () {
      await duelMatch.resolveMatch(MATCH_ID, agent1.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID);
      expect(await ethers.provider.getBalance(await duelMatch.getAddress())).to.equal(0);
    });

    it("Should set status to Resolved", async function () {
      await duelMatch.resolveMatch(MATCH_ID, agent1.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID);
      const [,,, status] = await duelMatch.getDuel(MATCH_ID);
      expect(status).to.equal(2); // Resolved
    });

    it("Should allow player2 as winner", async function () {
      await duelMatch.resolveMatch(MATCH_ID, agent2.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID);
      const [,,,, winner] = await duelMatch.getDuel(MATCH_ID);
      expect(winner).to.equal(agent2.address);
    });

    it("Should work with timeout end condition", async function () {
      await expect(
        duelMatch.resolveMatch(MATCH_ID, agent1.address, 6, PGN_HASH, FEN_HASH, 50, IPFS_CID)
      ).to.emit(duelMatch, "MatchResolved");
    });

    it("Should work with forfeit end condition", async function () {
      await expect(
        duelMatch.resolveMatch(MATCH_ID, agent1.address, 7, PGN_HASH, FEN_HASH, 30, IPFS_CID)
      ).to.emit(duelMatch, "MatchResolved");
    });
  });

  describe("Resolve Match — Draw", function () {
    beforeEach(async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN });
    });

    it("Should distribute draw correctly: both get refund minus small fee", async function () {
      const totalPool = BUY_IN * 2n;
      const drawFee = (totalPool * 250n) / 10000n; // 2.5%
      const refundEach = (totalPool - drawFee) / 2n;

      const bal1Before = await ethers.provider.getBalance(agent1.address);
      const bal2Before = await ethers.provider.getBalance(agent2.address);
      const feeBalBefore = await ethers.provider.getBalance(feeRecipient.address);

      await duelMatch.resolveMatch(
        MATCH_ID, ethers.ZeroAddress,
        2, // Stalemate
        PGN_HASH, FEN_HASH, 100, IPFS_CID
      );

      const bal1After = await ethers.provider.getBalance(agent1.address);
      const bal2After = await ethers.provider.getBalance(agent2.address);
      const feeBalAfter = await ethers.provider.getBalance(feeRecipient.address);

      expect(bal1After - bal1Before).to.equal(refundEach);
      expect(bal2After - bal2Before).to.equal(refundEach);
      expect(feeBalAfter - feeBalBefore).to.equal(drawFee);
    });

    it("Should handle all draw end conditions", async function () {
      // Stalemate
      await expect(
        duelMatch.resolveMatch(MATCH_ID, ethers.ZeroAddress, 2, PGN_HASH, FEN_HASH, 100, IPFS_CID)
      ).to.emit(duelMatch, "MatchResolved");
    });

    it("Should handle threefold repetition draw", async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID_2, "chess", { value: BUY_IN });
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID_2, { value: BUY_IN });

      await expect(
        duelMatch.resolveMatch(MATCH_ID_2, ethers.ZeroAddress, 3, PGN_HASH, FEN_HASH, 60, IPFS_CID)
      ).to.emit(duelMatch, "MatchResolved");
    });

    it("Should emit MatchResolved for draw", async function () {
      const totalPool = BUY_IN * 2n;
      const drawFee = (totalPool * 250n) / 10000n;
      const refundEach = (totalPool - drawFee) / 2n;

      await expect(
        duelMatch.resolveMatch(MATCH_ID, ethers.ZeroAddress, 2, PGN_HASH, FEN_HASH, 100, IPFS_CID)
      ).to.emit(duelMatch, "MatchResolved")
        .withArgs(MATCH_ID, ethers.ZeroAddress, true, 2, refundEach, drawFee);
    });
  });

  describe("Resolve Match — Validation", function () {
    beforeEach(async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN });
    });

    it("Should revert if winner is not a participant", async function () {
      await expect(
        duelMatch.resolveMatch(MATCH_ID, agent3.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID)
      ).to.be.revertedWithCustomError(duelMatch, "InvalidWinner");
    });

    it("Should revert if draw has non-zero winner", async function () {
      await expect(
        duelMatch.resolveMatch(MATCH_ID, agent1.address, 2, PGN_HASH, FEN_HASH, 100, IPFS_CID)
      ).to.be.revertedWithCustomError(duelMatch, "InvalidWinner");
    });

    it("Should revert with EndCondition.None", async function () {
      await expect(
        duelMatch.resolveMatch(MATCH_ID, agent1.address, 0, PGN_HASH, FEN_HASH, 7, IPFS_CID)
      ).to.be.revertedWithCustomError(duelMatch, "InvalidEndCondition");
    });

    it("Should revert if match not Active", async function () {
      await duelMatch.resolveMatch(MATCH_ID, agent1.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID);
      await expect(
        duelMatch.resolveMatch(MATCH_ID, agent1.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID)
      ).to.be.revertedWithCustomError(duelMatch, "InvalidStatus");
    });

    it("Should revert when called by non-organizer", async function () {
      await expect(
        duelMatch.connect(agent1).resolveMatch(MATCH_ID, agent1.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID)
      ).to.be.reverted;
    });
  });

  describe("Timeout Claim", function () {
    beforeEach(async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN });
    });

    it("Should refund both players after deadline", async function () {
      // Advance time past deadline
      await ethers.provider.send("evm_increaseTime", [2 * 60 * 60 + 1]); // 2 hours + 1 second
      await ethers.provider.send("evm_mine", []);

      const bal1Before = await ethers.provider.getBalance(agent1.address);
      const bal2Before = await ethers.provider.getBalance(agent2.address);

      const tx = await duelMatch.connect(agent1).claimTimeout(MATCH_ID);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const bal1After = await ethers.provider.getBalance(agent1.address);
      const bal2After = await ethers.provider.getBalance(agent2.address);

      expect(bal1After - bal1Before + gasUsed).to.equal(BUY_IN);
      expect(bal2After - bal2Before).to.equal(BUY_IN);
    });

    it("Should emit TimeoutClaimed", async function () {
      await ethers.provider.send("evm_increaseTime", [2 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        duelMatch.connect(agent1).claimTimeout(MATCH_ID)
      ).to.emit(duelMatch, "TimeoutClaimed")
        .withArgs(MATCH_ID, agent1.address);
    });

    it("Should revert before deadline", async function () {
      await expect(
        duelMatch.connect(agent1).claimTimeout(MATCH_ID)
      ).to.be.revertedWithCustomError(duelMatch, "DeadlineNotReached");
    });

    it("Should revert for non-participant", async function () {
      await ethers.provider.send("evm_increaseTime", [2 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        duelMatch.connect(nonAgent).claimTimeout(MATCH_ID)
      ).to.be.revertedWithCustomError(duelMatch, "NotParticipant");
    });

    it("Should revert for non-active match", async function () {
      await duelMatch.resolveMatch(MATCH_ID, agent1.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID);

      await ethers.provider.send("evm_increaseTime", [2 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        duelMatch.connect(agent1).claimTimeout(MATCH_ID)
      ).to.be.revertedWithCustomError(duelMatch, "InvalidStatus");
    });

    it("Player 2 can also claim timeout", async function () {
      await ethers.provider.send("evm_increaseTime", [2 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        duelMatch.connect(agent2).claimTimeout(MATCH_ID)
      ).to.emit(duelMatch, "TimeoutClaimed")
        .withArgs(MATCH_ID, agent2.address);
    });
  });

  describe("Admin Functions", function () {
    it("Should update platform fee", async function () {
      await duelMatch.setPlatformFee(300); // 3%
      expect(await duelMatch.platformFeeBps()).to.equal(300);
      expect(await duelMatch.drawFeeBps()).to.equal(150);
    });

    it("Should revert if fee exceeds max", async function () {
      await expect(
        duelMatch.setPlatformFee(1100) // 11%
      ).to.be.revertedWithCustomError(duelMatch, "InvalidFee");
    });

    it("Should update fee recipient", async function () {
      await duelMatch.setFeeRecipient(agent3.address);
      expect(await duelMatch.feeRecipient()).to.equal(agent3.address);
    });

    it("Should update match deadline", async function () {
      await duelMatch.setMatchDeadline(4 * 60 * 60); // 4 hours
      expect(await duelMatch.matchDeadline()).to.equal(4 * 60 * 60);
    });

    it("Should update buy-in limits", async function () {
      await duelMatch.setBuyInLimits(ethers.parseEther("0.01"), ethers.parseEther("5"));
      expect(await duelMatch.minBuyIn()).to.equal(ethers.parseEther("0.01"));
      expect(await duelMatch.maxBuyIn()).to.equal(ethers.parseEther("5"));
    });

    it("Should restrict admin functions to ADMIN_ROLE", async function () {
      await expect(duelMatch.connect(agent1).setPlatformFee(100)).to.be.reverted;
      await expect(duelMatch.connect(agent1).setFeeRecipient(agent1.address)).to.be.reverted;
      await expect(duelMatch.connect(agent1).setMatchDeadline(1000)).to.be.reverted;
      await expect(duelMatch.connect(agent1).setBuyInLimits(1, 2)).to.be.reverted;
    });
  });

  describe("Fee Math Precision", function () {
    const buyIns = [
      ethers.parseEther("0.001"),   // Min
      ethers.parseEther("0.01"),
      ethers.parseEther("0.1"),
      ethers.parseEther("1.0"),
      ethers.parseEther("0.123456789"),
    ];

    for (const buyIn of buyIns) {
      it(`Should have no dust at buy-in ${ethers.formatEther(buyIn)} ETH`, async function () {
        const matchId = ethers.keccak256(ethers.toUtf8Bytes(`fee-test-${buyIn.toString()}`));

        await duelMatch.connect(agent1).createChallenge(matchId, "chess", { value: buyIn });
        await duelMatch.connect(agent2).acceptChallenge(matchId, { value: buyIn });

        const contractBalBefore = await ethers.provider.getBalance(await duelMatch.getAddress());
        expect(contractBalBefore).to.equal(buyIn * 2n);

        await duelMatch.resolveMatch(matchId, agent1.address, 1, PGN_HASH, FEN_HASH, 7, IPFS_CID);

        // Contract should be empty — no dust
        const contractBalAfter = await ethers.provider.getBalance(await duelMatch.getAddress());
        expect(contractBalAfter).to.equal(0);
      });
    }

    it("Should have no dust for draws either", async function () {
      const matchId = ethers.keccak256(ethers.toUtf8Bytes("draw-dust-test"));
      const buyIn = ethers.parseEther("0.1");

      await duelMatch.connect(agent1).createChallenge(matchId, "chess", { value: buyIn });
      await duelMatch.connect(agent2).acceptChallenge(matchId, { value: buyIn });

      await duelMatch.resolveMatch(matchId, ethers.ZeroAddress, 2, PGN_HASH, FEN_HASH, 100, IPFS_CID);

      // Check for dust (draw may leave 1 wei due to integer division)
      const contractBal = await ethers.provider.getBalance(await duelMatch.getAddress());
      expect(contractBal).to.be.lte(1); // At most 1 wei dust from odd division
    });
  });

  describe("Multiple Concurrent Duels", function () {
    it("Should handle multiple independent duels", async function () {
      const matchId2 = ethers.keccak256(ethers.toUtf8Bytes("match-002"));
      const buyIn2 = ethers.parseEther("0.05");

      // Duel 1
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });
      await duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN });

      // Duel 2
      await duelMatch.connect(agent2).createChallenge(matchId2, "chess", { value: buyIn2 });
      await duelMatch.connect(agent3).acceptChallenge(matchId2, { value: buyIn2 });

      // Resolve duel 2 first
      await duelMatch.resolveMatch(matchId2, agent3.address, 1, PGN_HASH, FEN_HASH, 20, IPFS_CID);

      // Duel 1 should still be active
      expect(await duelMatch.isDuelActive(MATCH_ID)).to.be.true;

      // Resolve duel 1
      await duelMatch.resolveMatch(MATCH_ID, agent1.address, 6, PGN_HASH, FEN_HASH, 50, IPFS_CID);

      expect(await duelMatch.duelCount()).to.equal(2);
      expect(await ethers.provider.getBalance(await duelMatch.getAddress())).to.equal(0);
    });
  });

  describe("Deactivated Agent", function () {
    it("Should prevent deactivated agent from creating challenges", async function () {
      await registry.deactivateAgent(agent1.address);

      await expect(
        duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN })
      ).to.be.revertedWithCustomError(duelMatch, "NotRegisteredAgent");
    });

    it("Should prevent deactivated agent from accepting challenges", async function () {
      await duelMatch.connect(agent1).createChallenge(MATCH_ID, "chess", { value: BUY_IN });
      await registry.deactivateAgent(agent2.address);

      await expect(
        duelMatch.connect(agent2).acceptChallenge(MATCH_ID, { value: BUY_IN })
      ).to.be.revertedWithCustomError(duelMatch, "NotRegisteredAgent");
    });
  });
});
