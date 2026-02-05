import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // 1. Deploy PrizePool
  console.log("\n1. Deploying PrizePool...");
  const PrizePool = await ethers.getContractFactory("PrizePool");
  const prizePool = await PrizePool.deploy(deployer.address); // Fee recipient = deployer
  await prizePool.waitForDeployment();
  const prizePoolAddress = await prizePool.getAddress();
  console.log("PrizePool deployed to:", prizePoolAddress);

  // 2. Deploy TournamentFactory
  console.log("\n2. Deploying TournamentFactory...");
  const TournamentFactory = await ethers.getContractFactory("TournamentFactory");
  const tournamentFactory = await TournamentFactory.deploy(prizePoolAddress);
  await tournamentFactory.waitForDeployment();
  const factoryAddress = await tournamentFactory.getAddress();
  console.log("TournamentFactory deployed to:", factoryAddress);

  // 3. Deploy ArenaMatch
  console.log("\n3. Deploying ArenaMatch...");
  const ArenaMatch = await ethers.getContractFactory("ArenaMatch");
  const arenaMatch = await ArenaMatch.deploy();
  await arenaMatch.waitForDeployment();
  const arenaMatchAddress = await arenaMatch.getAddress();
  console.log("ArenaMatch deployed to:", arenaMatchAddress);

  // 4. Grant TOURNAMENT_ROLE to TournamentFactory on PrizePool
  console.log("\n4. Setting up roles...");
  const TOURNAMENT_ROLE = await prizePool.TOURNAMENT_ROLE();
  await prizePool.grantRole(TOURNAMENT_ROLE, factoryAddress);
  console.log("Granted TOURNAMENT_ROLE to TournamentFactory");

  // 5. Grant ORGANIZER_ROLE to deployer on ArenaMatch (for submitting results)
  const ORGANIZER_ROLE = await arenaMatch.ORGANIZER_ROLE();
  await arenaMatch.grantRole(ORGANIZER_ROLE, deployer.address);
  console.log("Granted ORGANIZER_ROLE to deployer on ArenaMatch");

  console.log("\n========================================");
  console.log("Deployment complete!");
  console.log("========================================");
  console.log("PrizePool:", prizePoolAddress);
  console.log("TournamentFactory:", factoryAddress);
  console.log("ArenaMatch:", arenaMatchAddress);
  console.log("========================================");
  console.log("\nPayment: ETH (testnet) / USDC (mainnet)");
  console.log("No token required - uses native ETH or USDC directly");
  
  // Save deployment addresses
  const fs = await import("fs");
  const deployments = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    timestamp: new Date().toISOString(),
    contracts: {
      PrizePool: prizePoolAddress,
      TournamentFactory: factoryAddress,
      ArenaMatch: arenaMatchAddress,
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
