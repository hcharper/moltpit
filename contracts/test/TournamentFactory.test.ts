import { expect } from "chai";
import { ethers } from "hardhat";
import { TournamentFactory, PrizePool } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("TournamentFactory", function () {
  let factory: TournamentFactory;
  let prizePool: PrizePool;
  let owner: SignerWithAddress;
  let organizer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let feeRecipient: SignerWithAddress;

  const ENTRY_FEE = ethers.parseEther("0.1");

  beforeEach(async function () {
    [owner, organizer, user1, user2, user3, user4, feeRecipient] = await ethers.getSigners();

    // Deploy PrizePool
    const PrizePool = await ethers.getContractFactory("PrizePool");
    prizePool = await PrizePool.deploy(feeRecipient.address);
    await prizePool.waitForDeployment();

    // Deploy TournamentFactory
    const TournamentFactory = await ethers.getContractFactory("TournamentFactory");
    factory = await TournamentFactory.deploy(await prizePool.getAddress());
    await factory.waitForDeployment();

    // Grant tournament role to factory
    const TOURNAMENT_ROLE = await prizePool.TOURNAMENT_ROLE();
    await prizePool.grantRole(TOURNAMENT_ROLE, await factory.getAddress());

    // Grant organizer role
    const ORGANIZER_ROLE = await factory.ORGANIZER_ROLE();
    await factory.grantRole(ORGANIZER_ROLE, organizer.address);
  });

  describe("Deployment", function () {
    it("Should set the prize pool address", async function () {
      expect(await factory.prizePool()).to.equal(await prizePool.getAddress());
    });

    it("Should grant admin role to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE();
      expect(await factory.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });
  });

  describe("Tournament Creation", function () {
    it("Should create a tournament", async function () {
      const now = await time.latest();
      const regStart = now + 100;
      const regEnd = now + 200;
      const startTime = now + 300;

      await expect(
        factory.connect(organizer).createTournament(
          "Chess Championship",
          "chess",
          ENTRY_FEE,
          ethers.ZeroAddress,
          16,
          regStart,
          regEnd,
          startTime,
          0 // SingleElimination
        )
      ).to.emit(factory, "TournamentCreated");

      expect(await factory.tournamentCount()).to.equal(1);
    });

    it("Should revert with invalid time range", async function () {
      const now = await time.latest();
      
      // Registration end before start
      await expect(
        factory.connect(organizer).createTournament(
          "Invalid Tournament",
          "chess",
          ENTRY_FEE,
          ethers.ZeroAddress,
          16,
          now + 200, // regStart
          now + 100, // regEnd (before regStart)
          now + 300,
          0
        )
      ).to.be.revertedWithCustomError(factory, "InvalidTimeRange");
    });

    it("Should revert when called by non-organizer", async function () {
      const now = await time.latest();
      
      await expect(
        factory.connect(user1).createTournament(
          "Unauthorized",
          "chess",
          ENTRY_FEE,
          ethers.ZeroAddress,
          16,
          now + 100,
          now + 200,
          now + 300,
          0
        )
      ).to.be.reverted;
    });
  });

  describe("Agent Registration", function () {
    let tournamentId: bigint;
    let regStart: number;
    let regEnd: number;

    beforeEach(async function () {
      const now = await time.latest();
      regStart = now + 100;
      regEnd = now + 1000;
      const startTime = now + 2000;

      const tx = await factory.connect(organizer).createTournament(
        "Chess Championship",
        "chess",
        ENTRY_FEE,
        ethers.ZeroAddress,
        16,
        regStart,
        regEnd,
        startTime,
        0
      );
      await tx.wait();
      tournamentId = 1n;
    });

    it("Should allow agent registration during registration period", async function () {
      await time.increaseTo(regStart + 10);

      const agentHash = ethers.keccak256(ethers.toUtf8Bytes("agent-code-v1"));

      await expect(
        factory.connect(user1).registerAgent(tournamentId, agentHash, { value: ENTRY_FEE })
      ).to.emit(factory, "AgentRegistered")
        .withArgs(tournamentId, user1.address, agentHash);
    });

    it("Should revert before registration starts", async function () {
      const agentHash = ethers.keccak256(ethers.toUtf8Bytes("agent-code-v1"));

      await expect(
        factory.connect(user1).registerAgent(tournamentId, agentHash, { value: ENTRY_FEE })
      ).to.be.revertedWithCustomError(factory, "RegistrationNotOpen");
    });

    it("Should revert after registration ends", async function () {
      await time.increaseTo(regEnd + 10);

      const agentHash = ethers.keccak256(ethers.toUtf8Bytes("agent-code-v1"));

      await expect(
        factory.connect(user1).registerAgent(tournamentId, agentHash, { value: ENTRY_FEE })
      ).to.be.revertedWithCustomError(factory, "RegistrationClosed");
    });

    it("Should revert for duplicate registration", async function () {
      await time.increaseTo(regStart + 10);

      const agentHash = ethers.keccak256(ethers.toUtf8Bytes("agent-code-v1"));
      await factory.connect(user1).registerAgent(tournamentId, agentHash, { value: ENTRY_FEE });

      await expect(
        factory.connect(user1).registerAgent(tournamentId, agentHash, { value: ENTRY_FEE })
      ).to.be.revertedWithCustomError(factory, "AlreadyRegistered");
    });

    it("Should revert for empty agent hash", async function () {
      await time.increaseTo(regStart + 10);

      await expect(
        factory.connect(user1).registerAgent(tournamentId, ethers.ZeroHash, { value: ENTRY_FEE })
      ).to.be.revertedWithCustomError(factory, "EmptyAgentHash");
    });

    it("Should revert for non-existent tournament", async function () {
      await time.increaseTo(regStart + 10);

      const agentHash = ethers.keccak256(ethers.toUtf8Bytes("agent-code-v1"));

      await expect(
        factory.connect(user1).registerAgent(999n, agentHash, { value: ENTRY_FEE })
      ).to.be.revertedWithCustomError(factory, "TournamentNotFound");
    });
  });

  describe("Tournament Lifecycle", function () {
    let tournamentId: bigint;
    let regStart: number;
    let regEnd: number;
    let startTime: number;

    beforeEach(async function () {
      // Use fresh tournament with unique timing windows
      const now = await time.latest();
      regStart = now + 10;
      regEnd = now + 100;
      startTime = now + 200;

      const tx = await factory.connect(organizer).createTournament(
        "Lifecycle Test Tournament",
        "chess",
        ENTRY_FEE,
        ethers.ZeroAddress,
        16,
        regStart,
        regEnd,
        startTime,
        0
      );
      await tx.wait();
      tournamentId = await factory.tournamentCount();

      // Register agents during registration period - use user3/user4 to avoid conflicts
      await time.increaseTo(regStart + 5);
      const agentHash1 = ethers.keccak256(ethers.toUtf8Bytes(`agent-lifecycle-1-${tournamentId}`));
      const agentHash2 = ethers.keccak256(ethers.toUtf8Bytes(`agent-lifecycle-2-${tournamentId}`));
      
      await factory.connect(user3).registerAgent(tournamentId, agentHash1, { value: ENTRY_FEE });
      await factory.connect(user4).registerAgent(tournamentId, agentHash2, { value: ENTRY_FEE });
    });

    it("Should allow organizer to start tournament", async function () {
      await time.increaseTo(startTime + 10);

      await expect(
        factory.connect(organizer).startTournament(tournamentId)
      ).to.emit(factory, "TournamentStarted")
        .withArgs(tournamentId);
    });

    it("Should allow organizer to complete tournament", async function () {
      await time.increaseTo(startTime + 10);
      await factory.connect(organizer).startTournament(tournamentId);

      await expect(
        factory.connect(organizer).completeTournament(
          tournamentId,
          user3.address,
          user4.address,
          user3.address // Third place fallback
        )
      ).to.emit(factory, "TournamentCompleted");
    });

    it("Should allow organizer to cancel tournament", async function () {
      await expect(
        factory.connect(organizer).cancelTournament(tournamentId)
      ).to.emit(factory, "TournamentCancelled")
        .withArgs(tournamentId);
    });
  });

  describe("Tournament Queries", function () {
    beforeEach(async function () {
      const now = await time.latest();
      
      // Create multiple tournaments
      for (let i = 0; i < 3; i++) {
        await factory.connect(organizer).createTournament(
          `Tournament ${i + 1}`,
          "chess",
          ENTRY_FEE,
          ethers.ZeroAddress,
          16,
          now + 100 + i * 1000,
          now + 500 + i * 1000,
          now + 800 + i * 1000,
          0
        );
      }
    });

    it("Should return correct tournament count", async function () {
      expect(await factory.tournamentCount()).to.equal(3);
    });

    it("Should get tournament by ID", async function () {
      const tournament = await factory.tournaments(1);
      expect(tournament.name).to.equal("Tournament 1");
      expect(tournament.gameType).to.equal("chess");
    });

    it("Should get participants for a tournament", async function () {
      const now = await time.latest();
      await time.increaseTo(now + 150); // During registration

      const agentHash = ethers.keccak256(ethers.toUtf8Bytes("agent-code"));
      await factory.connect(user1).registerAgent(1, agentHash, { value: ENTRY_FEE });

      const participants = await factory.getParticipants(1);
      expect(participants.length).to.equal(1);
      expect(participants[0]).to.equal(user1.address);
    });
  });
});
