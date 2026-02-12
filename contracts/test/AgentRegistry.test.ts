import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentRegistry", function () {
  let registry: AgentRegistry;
  let owner: SignerWithAddress;
  let verifier: SignerWithAddress;
  let agent1: SignerWithAddress;
  let agent2: SignerWithAddress;
  let agent3: SignerWithAddress;

  const twitterHash1 = ethers.keccak256(ethers.toUtf8Bytes("agent_alice"));
  const twitterHash2 = ethers.keccak256(ethers.toUtf8Bytes("agent_bob"));
  const twitterHash3 = ethers.keccak256(ethers.toUtf8Bytes("agent_charlie"));

  beforeEach(async function () {
    [owner, verifier, agent1, agent2, agent3] = await ethers.getSigners();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    registry = await AgentRegistry.deploy();
    await registry.waitForDeployment();

    // Grant verifier role
    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();
    await registry.grantRole(VERIFIER_ROLE, verifier.address);
  });

  describe("Deployment", function () {
    it("Should set deployer as admin", async function () {
      const ADMIN_ROLE = await registry.ADMIN_ROLE();
      expect(await registry.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should set deployer as verifier", async function () {
      const VERIFIER_ROLE = await registry.VERIFIER_ROLE();
      expect(await registry.hasRole(VERIFIER_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero agents", async function () {
      expect(await registry.agentCount()).to.equal(0);
    });
  });

  describe("Agent Registration", function () {
    it("Should register an agent successfully", async function () {
      await expect(
        registry.connect(verifier).registerAgent(agent1.address, twitterHash1)
      ).to.emit(registry, "AgentRegistered")
        .withArgs(agent1.address, twitterHash1, await getBlockTimestamp());

      expect(await registry.isRegistered(agent1.address)).to.be.true;
      expect(await registry.agentCount()).to.equal(1);
    });

    it("Should store correct agent details", async function () {
      await registry.connect(verifier).registerAgent(agent1.address, twitterHash1);

      const [wallet, tHash, registeredAt, isActive] = await registry.getAgent(agent1.address);
      expect(wallet).to.equal(agent1.address);
      expect(tHash).to.equal(twitterHash1);
      expect(registeredAt).to.be.gt(0);
      expect(isActive).to.be.true;
    });

    it("Should map Twitter handle to wallet", async function () {
      await registry.connect(verifier).registerAgent(agent1.address, twitterHash1);
      expect(await registry.getWalletByTwitter(twitterHash1)).to.equal(agent1.address);
    });

    it("Should register multiple agents", async function () {
      await registry.connect(verifier).registerAgent(agent1.address, twitterHash1);
      await registry.connect(verifier).registerAgent(agent2.address, twitterHash2);
      await registry.connect(verifier).registerAgent(agent3.address, twitterHash3);

      expect(await registry.agentCount()).to.equal(3);
      expect(await registry.isRegistered(agent1.address)).to.be.true;
      expect(await registry.isRegistered(agent2.address)).to.be.true;
      expect(await registry.isRegistered(agent3.address)).to.be.true;
    });

    it("Should revert if wallet already registered", async function () {
      await registry.connect(verifier).registerAgent(agent1.address, twitterHash1);

      await expect(
        registry.connect(verifier).registerAgent(agent1.address, twitterHash2)
      ).to.be.revertedWithCustomError(registry, "AgentAlreadyRegistered");
    });

    it("Should revert if Twitter already claimed by another agent", async function () {
      await registry.connect(verifier).registerAgent(agent1.address, twitterHash1);

      await expect(
        registry.connect(verifier).registerAgent(agent2.address, twitterHash1)
      ).to.be.revertedWithCustomError(registry, "TwitterAlreadyClaimed");
    });

    it("Should revert for zero address", async function () {
      await expect(
        registry.connect(verifier).registerAgent(ethers.ZeroAddress, twitterHash1)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("Should revert for empty Twitter hash", async function () {
      await expect(
        registry.connect(verifier).registerAgent(agent1.address, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "EmptyTwitterHash");
    });

    it("Should revert when called by non-verifier", async function () {
      await expect(
        registry.connect(agent1).registerAgent(agent1.address, twitterHash1)
      ).to.be.reverted;
    });

    it("Should revert when paused", async function () {
      await registry.pause();
      await expect(
        registry.connect(verifier).registerAgent(agent1.address, twitterHash1)
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    });
  });

  describe("Agent Deactivation", function () {
    beforeEach(async function () {
      await registry.connect(verifier).registerAgent(agent1.address, twitterHash1);
    });

    it("Should deactivate an agent", async function () {
      await expect(
        registry.deactivateAgent(agent1.address)
      ).to.emit(registry, "AgentDeactivated")
        .withArgs(agent1.address);

      expect(await registry.isRegistered(agent1.address)).to.be.false;
      // Still registered (just not active)
      expect(await registry.isRegisteredAny(agent1.address)).to.be.true;
    });

    it("Should revert if agent not found", async function () {
      await expect(
        registry.deactivateAgent(agent2.address)
      ).to.be.revertedWithCustomError(registry, "AgentNotFound");
    });

    it("Should revert if already deactivated", async function () {
      await registry.deactivateAgent(agent1.address);
      await expect(
        registry.deactivateAgent(agent1.address)
      ).to.be.revertedWithCustomError(registry, "AgentNotActive");
    });

    it("Should revert when called by non-admin", async function () {
      await expect(
        registry.connect(agent1).deactivateAgent(agent1.address)
      ).to.be.reverted;
    });
  });

  describe("Agent Reactivation", function () {
    beforeEach(async function () {
      await registry.connect(verifier).registerAgent(agent1.address, twitterHash1);
      await registry.deactivateAgent(agent1.address);
    });

    it("Should reactivate a deactivated agent", async function () {
      await expect(
        registry.reactivateAgent(agent1.address)
      ).to.emit(registry, "AgentReactivated")
        .withArgs(agent1.address);

      expect(await registry.isRegistered(agent1.address)).to.be.true;
    });

    it("Should revert if agent is already active", async function () {
      await registry.reactivateAgent(agent1.address);
      await expect(
        registry.reactivateAgent(agent1.address)
      ).to.be.revertedWithCustomError(registry, "AgentAlreadyActive");
    });
  });

  describe("View Functions", function () {
    it("Should return false for unregistered address", async function () {
      expect(await registry.isRegistered(agent1.address)).to.be.false;
      expect(await registry.isRegisteredAny(agent1.address)).to.be.false;
    });

    it("Should revert getAgent for unregistered address", async function () {
      await expect(
        registry.getAgent(agent1.address)
      ).to.be.revertedWithCustomError(registry, "AgentNotFound");
    });

    it("Should return zero address for unclaimed Twitter", async function () {
      expect(await registry.getWalletByTwitter(twitterHash1)).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Pause / Unpause", function () {
    it("Should pause and unpause", async function () {
      await registry.pause();
      await expect(
        registry.connect(verifier).registerAgent(agent1.address, twitterHash1)
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      await registry.unpause();
      await expect(
        registry.connect(verifier).registerAgent(agent1.address, twitterHash1)
      ).to.emit(registry, "AgentRegistered");
    });
  });
});

// Helper to get the block timestamp (approximate, for event matching)
async function getBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp + 1; // Next block approx
}
