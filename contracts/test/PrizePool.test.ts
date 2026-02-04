import { expect } from "chai";
import { ethers } from "hardhat";
import { PrizePool } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PrizePool", function () {
  let prizePool: PrizePool;
  let owner: SignerWithAddress;
  let tournament: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let feeRecipient: SignerWithAddress;

  const TOURNAMENT_ID = 1;
  const ENTRY_FEE = ethers.parseEther("0.1");

  beforeEach(async function () {
    [owner, tournament, user1, user2, user3, feeRecipient] = await ethers.getSigners();

    const PrizePool = await ethers.getContractFactory("PrizePool");
    prizePool = await PrizePool.deploy(feeRecipient.address);
    await prizePool.waitForDeployment();

    // Grant tournament role for testing
    const TOURNAMENT_ROLE = await prizePool.TOURNAMENT_ROLE();
    await prizePool.grantRole(TOURNAMENT_ROLE, tournament.address);
  });

  describe("Deployment", function () {
    it("Should set the fee recipient", async function () {
      expect(await prizePool.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("Should set platform fee to 5%", async function () {
      expect(await prizePool.platformFeeBps()).to.equal(500);
    });

    it("Should revert with zero address fee recipient", async function () {
      const PrizePool = await ethers.getContractFactory("PrizePool");
      await expect(
        PrizePool.deploy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(prizePool, "ZeroAddress");
    });
  });

  describe("Pool Creation", function () {
    it("Should create a pool with ETH", async function () {
      await expect(
        prizePool.connect(tournament).createPool(TOURNAMENT_ID, ENTRY_FEE, ethers.ZeroAddress)
      ).to.emit(prizePool, "PoolCreated")
        .withArgs(TOURNAMENT_ID, ENTRY_FEE, ethers.ZeroAddress);
    });

    it("Should prevent duplicate pool creation", async function () {
      await prizePool.connect(tournament).createPool(TOURNAMENT_ID, ENTRY_FEE, ethers.ZeroAddress);
      
      await expect(
        prizePool.connect(tournament).createPool(TOURNAMENT_ID, ENTRY_FEE, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(prizePool, "PoolAlreadyExists");
    });

    it("Should revert when called by non-tournament role", async function () {
      await expect(
        prizePool.connect(user1).createPool(TOURNAMENT_ID, ENTRY_FEE, ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe("Pool Entry", function () {
    beforeEach(async function () {
      await prizePool.connect(tournament).createPool(TOURNAMENT_ID, ENTRY_FEE, ethers.ZeroAddress);
    });

    it("Should allow users to enter with correct fee", async function () {
      await expect(
        prizePool.connect(tournament).enter(TOURNAMENT_ID, user1.address, { value: ENTRY_FEE })
      ).to.emit(prizePool, "EntryReceived")
        .withArgs(TOURNAMENT_ID, user1.address, ENTRY_FEE);
    });

    it("Should increase total prize pool", async function () {
      await prizePool.connect(tournament).enter(TOURNAMENT_ID, user1.address, { value: ENTRY_FEE });
      await prizePool.connect(tournament).enter(TOURNAMENT_ID, user2.address, { value: ENTRY_FEE });
      
      const pool = await prizePool.pools(TOURNAMENT_ID);
      expect(pool.totalPrize).to.equal(ENTRY_FEE * 2n);
      expect(pool.participantCount).to.equal(2);
    });

    it("Should revert with incorrect entry fee", async function () {
      await expect(
        prizePool.connect(tournament).enter(TOURNAMENT_ID, user1.address, { value: ENTRY_FEE / 2n })
      ).to.be.revertedWithCustomError(prizePool, "InvalidEntryFee");
    });

    it("Should prevent duplicate entries", async function () {
      await prizePool.connect(tournament).enter(TOURNAMENT_ID, user1.address, { value: ENTRY_FEE });
      
      await expect(
        prizePool.connect(tournament).enter(TOURNAMENT_ID, user1.address, { value: ENTRY_FEE })
      ).to.be.revertedWithCustomError(prizePool, "AlreadyParticipant");
    });

    it("Should revert for non-existent pool", async function () {
      await expect(
        prizePool.connect(tournament).enter(999, user1.address, { value: ENTRY_FEE })
      ).to.be.revertedWithCustomError(prizePool, "PoolNotFound");
    });
  });

  describe("Prize Distribution", function () {
    beforeEach(async function () {
      await prizePool.connect(tournament).createPool(TOURNAMENT_ID, ENTRY_FEE, ethers.ZeroAddress);
      
      // 3 participants enter (via tournament role simulating factory)
      await prizePool.connect(tournament).enter(TOURNAMENT_ID, user1.address, { value: ENTRY_FEE });
      await prizePool.connect(tournament).enter(TOURNAMENT_ID, user2.address, { value: ENTRY_FEE });
      await prizePool.connect(tournament).enter(TOURNAMENT_ID, user3.address, { value: ENTRY_FEE });
    });

    it("Should distribute prizes correctly", async function () {
      const totalPrize = ENTRY_FEE * 3n;
      
      // Contract deducts platform fee (5%) first, then applies prize distribution
      const platformFee = (totalPrize * 500n) / 10000n;  // 5%
      const prizeAfterFee = totalPrize - platformFee;
      
      const firstPrize = (prizeAfterFee * 7000n) / 10000n;  // 70% of 95%
      const secondPrize = (prizeAfterFee * 2000n) / 10000n; // 20% of 95%
      const thirdPrize = (prizeAfterFee * 500n) / 10000n;   // 5% of 95%
      
      const user1BalBefore = await ethers.provider.getBalance(user1.address);
      const user2BalBefore = await ethers.provider.getBalance(user2.address);
      const user3BalBefore = await ethers.provider.getBalance(user3.address);
      const feeRecipientBalBefore = await ethers.provider.getBalance(feeRecipient.address);

      await prizePool.connect(tournament).distributePrizes(
        TOURNAMENT_ID,
        user1.address,
        user2.address,
        user3.address
      );

      const user1BalAfter = await ethers.provider.getBalance(user1.address);
      const user2BalAfter = await ethers.provider.getBalance(user2.address);
      const user3BalAfter = await ethers.provider.getBalance(user3.address);
      const feeRecipientBalAfter = await ethers.provider.getBalance(feeRecipient.address);

      expect(user1BalAfter - user1BalBefore).to.equal(firstPrize);
      expect(user2BalAfter - user2BalBefore).to.equal(secondPrize);
      expect(user3BalAfter - user3BalBefore).to.equal(thirdPrize);
      expect(feeRecipientBalAfter - feeRecipientBalBefore).to.equal(platformFee);
    });

    it("Should emit PrizeDistributed events", async function () {
      const totalPrize = ENTRY_FEE * 3n;
      const platformFee = (totalPrize * 500n) / 10000n;
      const prizeAfterFee = totalPrize - platformFee;
      const firstPrize = (prizeAfterFee * 7000n) / 10000n;

      await expect(
        prizePool.connect(tournament).distributePrizes(
          TOURNAMENT_ID,
          user1.address,
          user2.address,
          user3.address
        )
      ).to.emit(prizePool, "PrizeDistributed")
        .withArgs(TOURNAMENT_ID, user1.address, 1, firstPrize);
    });

    it("Should mark pool as finalized after distribution", async function () {
      await prizePool.connect(tournament).distributePrizes(
        TOURNAMENT_ID,
        user1.address,
        user2.address,
        user3.address
      );

      const pool = await prizePool.pools(TOURNAMENT_ID);
      expect(pool.finalized).to.be.true;
    });

    it("Should revert if already finalized", async function () {
      await prizePool.connect(tournament).distributePrizes(
        TOURNAMENT_ID,
        user1.address,
        user2.address,
        user3.address
      );

      await expect(
        prizePool.connect(tournament).distributePrizes(
          TOURNAMENT_ID,
          user1.address,
          user2.address,
          user3.address
        )
      ).to.be.revertedWithCustomError(prizePool, "PoolFinalized");
    });
  });

  describe("Pool Cancellation", function () {
    beforeEach(async function () {
      await prizePool.connect(tournament).createPool(TOURNAMENT_ID, ENTRY_FEE, ethers.ZeroAddress);
      await prizePool.connect(tournament).enter(TOURNAMENT_ID, user1.address, { value: ENTRY_FEE });
      await prizePool.connect(tournament).enter(TOURNAMENT_ID, user2.address, { value: ENTRY_FEE });
    });

    it("Should allow tournament to cancel pool", async function () {
      await expect(
        prizePool.connect(tournament).cancelPool(TOURNAMENT_ID)
      ).to.emit(prizePool, "PoolCancelled")
        .withArgs(TOURNAMENT_ID);
    });

    it("Should allow participants to claim refunds", async function () {
      await prizePool.connect(tournament).cancelPool(TOURNAMENT_ID);
      
      const user1BalBefore = await ethers.provider.getBalance(user1.address);
      
      await prizePool.connect(user1).claimRefund(TOURNAMENT_ID);
      
      const user1BalAfter = await ethers.provider.getBalance(user1.address);
      
      // Balance increased (minus gas)
      expect(user1BalAfter).to.be.gt(user1BalBefore);
    });

    it("Should prevent double refund claims", async function () {
      await prizePool.connect(tournament).cancelPool(TOURNAMENT_ID);
      await prizePool.connect(user1).claimRefund(TOURNAMENT_ID);
      
      await expect(
        prizePool.connect(user1).claimRefund(TOURNAMENT_ID)
      ).to.be.revertedWithCustomError(prizePool, "AlreadyClaimed");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to update platform fee", async function () {
      await expect(
        prizePool.setPlatformFee(300)
      ).to.emit(prizePool, "PlatformFeeUpdated")
        .withArgs(500, 300);
      
      expect(await prizePool.platformFeeBps()).to.equal(300);
    });

    it("Should revert if fee exceeds maximum", async function () {
      await expect(
        prizePool.setPlatformFee(1500) // 15%
      ).to.be.revertedWithCustomError(prizePool, "InvalidFee");
    });

    it("Should allow pausing and unpausing", async function () {
      await prizePool.pause();
      expect(await prizePool.paused()).to.be.true;
      
      await prizePool.unpause();
      expect(await prizePool.paused()).to.be.false;
    });
  });
});
