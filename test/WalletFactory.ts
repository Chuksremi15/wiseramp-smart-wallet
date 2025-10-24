import { expect } from "chai";
import { ethers } from "hardhat";
import { WalletFactory, SweepWallet } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("WalletFactory", function () {
  let walletFactory: WalletFactory;
  let sweeper: SignerWithAddress;
  let user: SignerWithAddress;
  let recipient: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  const testSalt = ethers.keccak256(ethers.toUtf8Bytes("test-salt-123"));

  beforeEach(async function () {
    [sweeper, user, recipient, unauthorized] = await ethers.getSigners();

    const WalletFactoryFactory = await ethers.getContractFactory("WalletFactory");
    walletFactory = (await WalletFactoryFactory.deploy(sweeper.address)) as WalletFactory;
    await walletFactory.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct sweeper address", async function () {
      expect(await walletFactory.sweeper()).to.equal(sweeper.address);
    });

    it("Should deploy and set implementation address", async function () {
      const implementationAddress = await walletFactory.implementation();
      expect(implementationAddress).to.not.equal(ethers.ZeroAddress);

      // Verify implementation has code
      const code = await ethers.provider.getCode(implementationAddress);
      expect(code).to.not.equal("0x");
    });
  });

  describe("getDeterministicAddress", function () {
    it("Should return consistent addresses for same salt", async function () {
      const address1 = await walletFactory.getDeterministicAddress(testSalt);
      const address2 = await walletFactory.getDeterministicAddress(testSalt);

      expect(address1).to.equal(address2);
      expect(address1).to.not.equal(ethers.ZeroAddress);
    });

    it("Should return different addresses for different salts", async function () {
      const salt1 = ethers.keccak256(ethers.toUtf8Bytes("salt1"));
      const salt2 = ethers.keccak256(ethers.toUtf8Bytes("salt2"));

      const address1 = await walletFactory.getDeterministicAddress(salt1);
      const address2 = await walletFactory.getDeterministicAddress(salt2);

      expect(address1).to.not.equal(address2);
    });
  });

  describe("Wallet Deployment Check", function () {
    it("Should have no code at predicted address before deployment", async function () {
      const predictedAddress = await walletFactory.getDeterministicAddress(testSalt);
      const code = await ethers.provider.getCode(predictedAddress);
      expect(code).to.equal("0x");
    });

    it("Should have code at predicted address after deployment", async function () {
      const predictedAddress = await walletFactory.getDeterministicAddress(testSalt);

      // Deploy wallet by calling deployAndSweep with ETH (address(0))
      await walletFactory.connect(sweeper).deployAndSweep(testSalt, ethers.ZeroAddress, recipient.address);

      const code = await ethers.provider.getCode(predictedAddress);
      expect(code).to.not.equal("0x");
    });
  });

  describe("deployAndSweep", function () {
    it("Should revert if not called by sweeper", async function () {
      await expect(
        walletFactory.connect(unauthorized).deployAndSweep(testSalt, ethers.ZeroAddress, recipient.address),
      ).to.be.revertedWith("Factory: Not sweeper");
    });

    it("Should deploy wallet and emit WalletCreated event", async function () {
      const predictedAddress = await walletFactory.getDeterministicAddress(testSalt);

      await expect(walletFactory.connect(sweeper).deployAndSweep(testSalt, ethers.ZeroAddress, recipient.address))
        .to.emit(walletFactory, "WalletCreated")
        .withArgs(predictedAddress, testSalt);
    });

    it("Should deploy wallet at predicted address", async function () {
      const predictedAddress = await walletFactory.getDeterministicAddress(testSalt);

      await walletFactory.connect(sweeper).deployAndSweep(testSalt, ethers.ZeroAddress, recipient.address);

      // Verify wallet is deployed at predicted address
      const code = await ethers.provider.getCode(predictedAddress);
      expect(code).to.not.equal("0x");
    });

    it("Should initialize wallet with sweeper as owner", async function () {
      const predictedAddress = await walletFactory.getDeterministicAddress(testSalt);

      await walletFactory.connect(sweeper).deployAndSweep(testSalt, ethers.ZeroAddress, recipient.address);

      const wallet = await ethers.getContractAt("SweepWallet", predictedAddress);
      expect(await wallet.owner()).to.equal(sweeper.address);
    });

    describe("ETH Sweeping", function () {
      it("Should sweep ETH from newly deployed wallet", async function () {
        const predictedAddress = await walletFactory.getDeterministicAddress(testSalt);
        const ethAmount = ethers.parseEther("1.0");

        // Send ETH to the predicted address before deployment
        await user.sendTransaction({
          to: predictedAddress,
          value: ethAmount,
        });

        const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

        // Deploy and sweep ETH (address(0) represents ETH)
        await walletFactory.connect(sweeper).deployAndSweep(testSalt, ethers.ZeroAddress, recipient.address);

        const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);
        expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(ethAmount);

        // Wallet should have 0 ETH after sweep
        const walletBalance = await ethers.provider.getBalance(predictedAddress);
        expect(walletBalance).to.equal(0);
      });
    });

    describe("Duplicate Deployment", function () {
      it("Should revert when trying to deploy same wallet twice", async function () {
        // First deployment should succeed
        await walletFactory.connect(sweeper).deployAndSweep(testSalt, ethers.ZeroAddress, recipient.address);

        // Second deployment should revert (CREATE2 collision)
        await expect(walletFactory.connect(sweeper).deployAndSweep(testSalt, ethers.ZeroAddress, recipient.address)).to
          .be.reverted;
      });
    });
  });

  describe("Integration Tests", function () {
    it("Should handle multiple wallets with different salts", async function () {
      const salt1 = ethers.keccak256(ethers.toUtf8Bytes("user1"));
      const salt2 = ethers.keccak256(ethers.toUtf8Bytes("user2"));

      const address1 = await walletFactory.getDeterministicAddress(salt1);
      const address2 = await walletFactory.getDeterministicAddress(salt2);

      // Deploy both wallets
      await walletFactory.connect(sweeper).deployAndSweep(salt1, ethers.ZeroAddress, recipient.address);

      await walletFactory.connect(sweeper).deployAndSweep(salt2, ethers.ZeroAddress, recipient.address);

      // Both should be deployed (have code)
      const code1 = await ethers.provider.getCode(address1);
      const code2 = await ethers.provider.getCode(address2);
      expect(code1).to.not.equal("0x");
      expect(code2).to.not.equal("0x");

      // Addresses should be different
      expect(address1).to.not.equal(address2);
    });

    it("Should work with zero ETH balance", async function () {
      // Deploy wallet with no ETH to sweep
      await expect(walletFactory.connect(sweeper).deployAndSweep(testSalt, ethers.ZeroAddress, recipient.address)).to
        .not.be.reverted;

      const predictedAddress = await walletFactory.getDeterministicAddress(testSalt);
      const code = await ethers.provider.getCode(predictedAddress);
      expect(code).to.not.equal("0x");
    });

    it("Should handle large ETH amounts", async function () {
      const predictedAddress = await walletFactory.getDeterministicAddress(testSalt);
      const largeAmount = ethers.parseEther("100.0");

      // Send large ETH amount to predicted address
      await user.sendTransaction({
        to: predictedAddress,
        value: largeAmount,
      });

      const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

      await walletFactory.connect(sweeper).deployAndSweep(testSalt, ethers.ZeroAddress, recipient.address);

      const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(largeAmount);
    });
  });
});
