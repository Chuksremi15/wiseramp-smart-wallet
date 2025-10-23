import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

/**
 * Deploys the WalletFactory contract using the deployer account as the sweeper address
 *
 * @param hre HardhatRuntimeEnvironment object.
 */
const deployWalletFactory: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  /*
    On localhost, the deployer account is the one that comes with Hardhat, which is already funded.

    When deploying to live networks (e.g `yarn deploy --network sepolia`), the deployer account
    should have sufficient balance to pay for the gas fees for contract creation.

    You can generate a random account with `yarn generate` or `yarn account:import` to import your
    existing PK which will fill DEPLOYER_PRIVATE_KEY_ENCRYPTED in the .env file (then used on hardhat.config.ts)
    You can run the `yarn account` command to check your balance in every network.
  */
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("WalletFactory", {
    from: deployer,
    // Contract constructor arguments - WalletFactory takes a sweeper address
    args: [deployer],
    log: true,
    // autoMine: can be passed to the deploy function to make the deployment process faster on local networks by
    // automatically mining the contract deployment transaction. There is no effect on live networks.
    autoMine: true,
  });

  // Get the deployed contract to interact with it after deploying.
  const walletFactory = await hre.ethers.getContract<Contract>("WalletFactory", deployer);
  console.log("🏭 WalletFactory deployed!");
  console.log("📍 Implementation address:", await walletFactory.implementation());
  console.log("🤖 Sweeper address:", await walletFactory.sweeper());
};

export default deployWalletFactory;

// Tags are useful if you have multiple deploy files and only want to run one of them.
// e.g. yarn deploy --tags WalletFactory
deployWalletFactory.tags = ["WalletFactory"];
