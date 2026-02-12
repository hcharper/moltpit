import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // 1. Deploy PrizePool (tournament escrow)
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

  // 3. Deploy ArenaMatch (result recording)
  console.log("\n3. Deploying ArenaMatch...");
  const ArenaMatch = await ethers.getContractFactory("ArenaMatch");
  const arenaMatch = await ArenaMatch.deploy();
  await arenaMatch.waitForDeployment();
  const arenaMatchAddress = await arenaMatch.getAddress();
  console.log("ArenaMatch deployed to:", arenaMatchAddress);

  // 4. Deploy AgentRegistry (Twitter-verified agent identity)
  console.log("\n4. Deploying AgentRegistry...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy();
  await agentRegistry.waitForDeployment();
  const agentRegistryAddress = await agentRegistry.getAddress();
  console.log("AgentRegistry deployed to:", agentRegistryAddress);

  // 5. Deploy DuelMatch (1v1 head-to-head escrow)
  console.log("\n5. Deploying DuelMatch...");
  const DuelMatch = await ethers.getContractFactory("DuelMatch");
  const duelMatch = await DuelMatch.deploy(deployer.address, agentRegistryAddress);
  await duelMatch.waitForDeployment();
  const duelMatchAddress = await duelMatch.getAddress();
  console.log("DuelMatch deployed to:", duelMatchAddress);

  // 6. Set up roles
  console.log("\n6. Setting up roles...");

  // PrizePool: grant TOURNAMENT_ROLE to TournamentFactory
  const TOURNAMENT_ROLE = await prizePool.TOURNAMENT_ROLE();
  await prizePool.grantRole(TOURNAMENT_ROLE, factoryAddress);
  console.log("Granted TOURNAMENT_ROLE to TournamentFactory on PrizePool");

  // ArenaMatch: grant ORGANIZER_ROLE to deployer (server submits results)
  const ORGANIZER_ROLE_ARENA = await arenaMatch.ORGANIZER_ROLE();
  await arenaMatch.grantRole(ORGANIZER_ROLE_ARENA, deployer.address);
  console.log("Granted ORGANIZER_ROLE to deployer on ArenaMatch");

  // AgentRegistry: grant VERIFIER_ROLE to deployer (server verifies agents)
  const VERIFIER_ROLE = await agentRegistry.VERIFIER_ROLE();
  await agentRegistry.grantRole(VERIFIER_ROLE, deployer.address);
  console.log("Granted VERIFIER_ROLE to deployer on AgentRegistry");

  // DuelMatch: grant ORGANIZER_ROLE to deployer (server resolves matches)
  const ORGANIZER_ROLE_DUEL = await duelMatch.ORGANIZER_ROLE();
  await duelMatch.grantRole(ORGANIZER_ROLE_DUEL, deployer.address);
  console.log("Granted ORGANIZER_ROLE to deployer on DuelMatch");

  console.log("\n========================================");
  console.log("Deployment complete!");
  console.log("========================================");
  console.log("PrizePool:          ", prizePoolAddress);
  console.log("TournamentFactory:  ", factoryAddress);
  console.log("ArenaMatch:         ", arenaMatchAddress);
  console.log("AgentRegistry:      ", agentRegistryAddress);
  console.log("DuelMatch:          ", duelMatchAddress);
  console.log("========================================");
  console.log("Fee Recipient:      ", deployer.address);
  console.log("Platform Fee:        5% (500 bps)");
  console.log("Payment:             ETH");
  
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
      AgentRegistry: agentRegistryAddress,
      DuelMatch: duelMatchAddress,
    },
    roles: {
      feeRecipient: deployer.address,
      organizer: deployer.address,
      verifier: deployer.address,
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
