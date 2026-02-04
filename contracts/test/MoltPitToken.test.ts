import { expect } from "chai";
import { ethers } from "hardhat";
import { MoltPitToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MoltPitToken", function () {
  let token: MoltPitToken;
  let owner: SignerWithAddress;
  let minter: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async function () {
    [owner, minter, user] = await ethers.getSigners();

    const MoltPitToken = await ethers.getContractFactory("MoltPitToken");
    token = await MoltPitToken.deploy();
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await token.name()).to.equal("MoltPit");
      expect(await token.symbol()).to.equal("MOLT");
    });

    it("Should have 0 initial supply", async function () {
      expect(await token.totalSupply()).to.equal(0);
    });

    it("Should grant admin and minter roles to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
      const MINTER_ROLE = await token.MINTER_ROLE();

      expect(await token.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await token.hasRole(MINTER_ROLE, owner.address)).to.be.true;
    });

    it("Should set MAX_SUPPLY to 100M tokens", async function () {
      const maxSupply = await token.MAX_SUPPLY();
      expect(maxSupply).to.equal(ethers.parseEther("100000000"));
    });
  });

  describe("Minting", function () {
    it("Should allow minter to mint tokens", async function () {
      const amount = ethers.parseEther("1000");
      await token.mint(user.address, amount);
      expect(await token.balanceOf(user.address)).to.equal(amount);
    });

    it("Should update totalMinted correctly", async function () {
      const amount = ethers.parseEther("5000");
      await token.mint(user.address, amount);
      expect(await token.totalMinted()).to.equal(amount);
    });

    it("Should revert when non-minter tries to mint", async function () {
      const amount = ethers.parseEther("1000");
      await expect(
        token.connect(user).mint(user.address, amount)
      ).to.be.reverted;
    });

    it("Should revert when minting to zero address", async function () {
      const amount = ethers.parseEther("1000");
      await expect(
        token.mint(ethers.ZeroAddress, amount)
      ).to.be.revertedWithCustomError(token, "ZeroAddress");
    });

    it("Should revert when minting zero amount", async function () {
      await expect(
        token.mint(user.address, 0)
      ).to.be.revertedWithCustomError(token, "ZeroAmount");
    });

    it("Should revert when exceeding max supply", async function () {
      const maxSupply = await token.MAX_SUPPLY();
      const halfSupply = maxSupply / 2n;
      
      // Mint half supply
      await token.mint(user.address, halfSupply);
      
      // Try to mint more than remaining
      await expect(
        token.mint(user.address, halfSupply + 1n)
      ).to.be.revertedWithCustomError(token, "ExceedsMaxSupply");
    });
  });

  describe("Minting Finalization", function () {
    it("Should allow admin to finalize minting", async function () {
      await token.finalizeMinting();
      expect(await token.mintingFinalized()).to.be.true;
    });

    it("Should emit MintingFinalized event", async function () {
      const amount = ethers.parseEther("1000");
      await token.mint(user.address, amount);
      
      await expect(token.finalizeMinting())
        .to.emit(token, "MintingFinalized")
        .withArgs(amount);
    });

    it("Should prevent minting after finalization", async function () {
      await token.finalizeMinting();
      
      await expect(
        token.mint(user.address, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(token, "MintingAlreadyFinalized");
    });
  });

  describe("Burning", function () {
    it("Should allow token holders to burn their tokens", async function () {
      const amount = ethers.parseEther("1000");
      await token.mint(user.address, amount);
      
      const burnAmount = ethers.parseEther("500");
      await token.connect(user).burn(burnAmount);
      
      expect(await token.balanceOf(user.address)).to.equal(amount - burnAmount);
    });
  });
});
