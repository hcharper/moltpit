import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // 1. Deploy MoltPitToken
  console.log("\n1. Deploying MoltPitToken...");
  const MoltPitToken = await ethers.getContractFactory("MoltPitToken");
  const moltPitToken = await MoltPitToken.deploy();
  await moltPitToken.waitForDeployment();
  const tokenAddress = await moltPitToken.getAddress();
  console.log("MoltPitToken deployed to:", tokenAddress);

  // 2. Deploy PrizePool
  console.log("\n2. Deploying PrizePool...");
  const PrizePool = await ethers.getContractFactory("PrizePool");
  const prizePool = await PrizePool.deploy(deployer.address); // Fee recipient = deployer for now
  await prizePool.waitForDeployment();
  const prizePoolAddress = await prizePool.getAddress();
  console.log("PrizePool deployed to:", prizePoolAddress);

  // 3. Deploy TournamentFactory
  console.log("\n3. Deploying TournamentFactory...");
  const TournamentFactory = await ethers.getContractFactory("TournamentFactory");
  const tournamentFactory = await TournamentFactory.deploy(prizePoolAddress);
  await tournamentFactory.waitForDeployment();
  const factoryAddress = await tournamentFactory.getAddress();
  console.log("TournamentFactory deployed to:", factoryAddress);

  // 4. Grant TOURNAMENT_ROLE to TournamentFactory on PrizePool
  console.log("\n4. Setting up roles...");
  const TOURNAMENT_ROLE = await prizePool.TOURNAMENT_ROLE();
  await prizePool.grantRole(TOURNAMENT_ROLE, factoryAddress);
  console.log("Granted TOURNAMENT_ROLE to TournamentFactory");

  // 5. Mint initial token supply (for testing)
  console.log("\n5. Minting initial tokens...");
  const initialMint = ethers.parseEther("1000000"); // 1M tokens for testing
  await moltPitToken.mint(deployer.address, initialMint);
  console.log("Minted 1,000,000 MOLT to deployer");

  console.log("\n========================================");
  console.log("Deployment complete!");
  console.log("========================================");
  console.log("MoltPitToken:", tokenAddress);
  console.log("PrizePool:", prizePoolAddress);
  console.log("TournamentFactory:", factoryAddress);
  console.log("========================================");
  
  // Save deployment addresses
  const fs = await import("fs");
  const deployments = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    timestamp: new Date().toISOString(),
    contracts: {
      MoltPitToken: tokenAddress,
      PrizePool: prizePoolAddress,
      TournamentFactory: factoryAddress,
    },
  };
  
  fs.writeFileSync(
    "./deployments.json",
    JSON.stringify(deployments, null, 2)
  );
  console.log("\nDeployment info saved to deployments.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
