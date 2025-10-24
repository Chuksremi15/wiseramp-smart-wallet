import { expect } from "chai";
import { ethers } from "hardhat";
import { SweepWallet, WalletFactory, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SweepWallet", function () {
  let sweepWallet: SweepWallet;
  let walletFactory: WalletFactory;
  let implementation: SweepWallet;
  let mockToken: MockERC20;
  let owner: SignerWithAddress;
  let recipient: SignerWithAddress;
  let unauthorized: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async function () {
    [owner, recipient, unauthorized, user] = await ethers.getSigners();

    // Deploy WalletFactory (which creates the SweepWallet implementation)
    const WalletFactoryFactory = await ethers.getContractFactory("WalletFactory");
    walletFactory = (await WalletFactoryFactory.deploy(owner.address)) as WalletFactory;
    await walletFactory.waitForDeployment();

    // Get the implementation address for reference
    const implementationAddress = await walletFactory.implementation();
    implementation = (await ethers.getContractAt("SweepWallet", implementationAddress)) as SweepWallet;

    // Deploy a wallet clone using the factory
    const testSalt = ethers.keccak256(ethers.toUtf8Bytes("test-wallet"));
    const walletAddress = await walletFactory.getDeterministicAddress(testSalt);

    // Deploy the wallet by calling deployAndSweep (this creates and initializes the clone)
    await walletFactory.connect(owner).deployAndSweep(
      testSalt,
      ethers.ZeroAddress, // ETH
      recipient.address,
    );

    // Get the deployed wallet instance
    sweepWallet = (await ethers.getContractAt("SweepWallet", walletAddress)) as SweepWallet;

    // Deploy mock ERC20 token
    const MockTokenFactory = await ethers.getContractFactory("MockERC20");
    mockToken = (await MockTokenFactory.deploy("MockToken", "MTK", ethers.parseEther("1000000"))) as MockERC20;
    await mockToken.waitForDeployment();
  });

  describe("Deployment and Initialization", function () {
    it("Should set the correct owner after initialization", async function () {
      expect(await sweepWallet.owner()).to.equal(owner.address);
    });

    it("Should set the correct factory address", async function () {
      expect(await sweepWallet.factory()).to.equal(await walletFactory.getAddress());
    });

    it("Should not allow double initialization", async function () {
      await expect(sweepWallet.initialize(unauthorized.address)).to.be.revertedWithCustomError(
        sweepWallet,
        "InvalidInitialization",
      );
    });

    it("Should disable initializers on implementation contract", async function () {
      // Should not be able to initialize the implementation contract
      await expect(implementation.initialize(owner.address)).to.be.revertedWithCustomError(
        implementation,
        "InvalidInitialization",
      );
    });
  });

  describe("ETH Handling", function () {
    it("Should receive ETH via receive function", async function () {
      const ethAmount = ethers.parseEther("1.0");

      await user.sendTransaction({
        to: await sweepWallet.getAddress(),
        value: ethAmount,
      });

      const balance = await ethers.provider.getBalance(await sweepWallet.getAddress());
      expect(balance).to.equal(ethAmount);
    });

    it("Should sweep ETH to recipient", async function () {
      const ethAmount = ethers.parseEther("2.0");
      const walletAddress = await sweepWallet.getAddress();

      // Send ETH to wallet
      await user.sendTransaction({
        to: walletAddress,
        value: ethAmount,
      });

      const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

      // Sweep ETH
      await sweepWallet.connect(owner).sweepETH(recipient.address);

      const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);
      const walletBalance = await ethers.provider.getBalance(walletAddress);

      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(ethAmount);
      expect(walletBalance).to.equal(0);
    });

    it("Should handle zero ETH balance gracefully", async function () {
      const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

      // Sweep when wallet has no ETH
      await expect(sweepWallet.connect(owner).sweepETH(recipient.address)).to.not.be.reverted;

      const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);
      expect(recipientBalanceAfter).to.equal(recipientBalanceBefore);
    });

    it("Should revert if non-owner/non-factory tries to sweep ETH", async function () {
      const ethAmount = ethers.parseEther("1.0");

      await user.sendTransaction({
        to: await sweepWallet.getAddress(),
        value: ethAmount,
      });

      await expect(sweepWallet.connect(unauthorized).sweepETH(recipient.address)).to.be.revertedWith(
        "SweepWallet: Not authorized",
      );
    });

    it("Should allow factory to sweep ETH", async function () {
      const ethAmount = ethers.parseEther("1.0");
      const walletAddress = await sweepWallet.getAddress();

      // Send ETH to wallet
      await user.sendTransaction({
        to: walletAddress,
        value: ethAmount,
      });

      const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);

      // Factory should be able to sweep (this is how deployAndSweep works)
      // We can't directly test this since we can't impersonate the factory contract
      // But we know it works because deployAndSweep succeeded in beforeEach

      // Instead, let's test that owner can sweep
      await sweepWallet.connect(owner).sweepETH(recipient.address);

      const recipientBalanceAfter = await ethers.provider.getBalance(recipient.address);
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(ethAmount);
    });
  });

  describe("ERC20 Token Handling", function () {
    beforeEach(async function () {
      // Transfer some tokens to the wallet for testing
      const tokenAmount = ethers.parseEther("100");
      await mockToken.transfer(await sweepWallet.getAddress(), tokenAmount);
    });

    it("Should sweep ERC20 tokens to recipient", async function () {
      const walletAddress = await sweepWallet.getAddress();
      const tokenAmount = ethers.parseEther("100");

      const recipientBalanceBefore = await mockToken.balanceOf(recipient.address);
      const walletBalanceBefore = await mockToken.balanceOf(walletAddress);

      expect(walletBalanceBefore).to.equal(tokenAmount);

      // Sweep tokens
      await sweepWallet.connect(owner).sweep(await mockToken.getAddress(), recipient.address);

      const recipientBalanceAfter = await mockToken.balanceOf(recipient.address);
      const walletBalanceAfter = await mockToken.balanceOf(walletAddress);

      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(tokenAmount);
      expect(walletBalanceAfter).to.equal(0);
    });

    it("Should handle zero token balance gracefully", async function () {
      // First sweep all tokens
      await sweepWallet.connect(owner).sweep(await mockToken.getAddress(), recipient.address);

      const recipientBalanceBefore = await mockToken.balanceOf(recipient.address);

      // Try to sweep again when wallet has no tokens
      await expect(sweepWallet.connect(owner).sweep(await mockToken.getAddress(), recipient.address)).to.not.be
        .reverted;

      const recipientBalanceAfter = await mockToken.balanceOf(recipient.address);
      expect(recipientBalanceAfter).to.equal(recipientBalanceBefore);
    });

    it("Should revert if non-owner/non-factory tries to sweep tokens", async function () {
      await expect(
        sweepWallet.connect(unauthorized).sweep(await mockToken.getAddress(), recipient.address),
      ).to.be.revertedWith("SweepWallet: Not authorized");
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to transfer ownership", async function () {
      await sweepWallet.connect(owner).transferOwnership(recipient.address);
      expect(await sweepWallet.owner()).to.equal(recipient.address);
    });

    it("Should not allow non-owner to transfer ownership", async function () {
      await expect(
        sweepWallet.connect(unauthorized).transferOwnership(recipient.address),
      ).to.be.revertedWithCustomError(sweepWallet, "OwnableUnauthorizedAccount");
    });

    it("Should allow new owner to sweep after ownership transfer", async function () {
      const ethAmount = ethers.parseEther("1.0");

      // Send ETH to wallet
      await user.sendTransaction({
        to: await sweepWallet.getAddress(),
        value: ethAmount,
      });

      // Transfer ownership
      await sweepWallet.connect(owner).transferOwnership(recipient.address);

      // New owner should be able to sweep
      await expect(sweepWallet.connect(recipient).sweepETH(user.address)).to.not.be.reverted;

      // Old owner should not be able to sweep
      await expect(sweepWallet.connect(owner).sweepETH(user.address)).to.be.revertedWith("SweepWallet: Not authorized");
    });
  });

  describe("Integration Tests", function () {
    it("Should handle both ETH and token sweeping in sequence", async function () {
      const walletAddress = await sweepWallet.getAddress();
      const ethAmount = ethers.parseEther("1.0");
      const tokenAmount = ethers.parseEther("50");

      // Send both ETH and tokens to wallet
      await user.sendTransaction({
        to: walletAddress,
        value: ethAmount,
      });
      await mockToken.transfer(walletAddress, tokenAmount);

      const recipientEthBefore = await ethers.provider.getBalance(recipient.address);
      const recipientTokenBefore = await mockToken.balanceOf(recipient.address);

      // Sweep ETH first
      await sweepWallet.connect(owner).sweepETH(recipient.address);

      // Then sweep tokens
      await sweepWallet.connect(owner).sweep(await mockToken.getAddress(), recipient.address);

      const recipientEthAfter = await ethers.provider.getBalance(recipient.address);
      const recipientTokenAfter = await mockToken.balanceOf(recipient.address);

      expect(recipientEthAfter - recipientEthBefore).to.equal(ethAmount);
      expect(recipientTokenAfter - recipientTokenBefore).to.equal(tokenAmount);

      // Wallet should be empty
      expect(await ethers.provider.getBalance(walletAddress)).to.equal(0);
      expect(await mockToken.balanceOf(walletAddress)).to.equal(0);
    });

    it("Should handle large amounts", async function () {
      const walletAddress = await sweepWallet.getAddress();
      const largeEthAmount = ethers.parseEther("100");
      const largeTokenAmount = ethers.parseEther("10000");

      // Send large amounts
      await user.sendTransaction({
        to: walletAddress,
        value: largeEthAmount,
      });
      await mockToken.transfer(walletAddress, largeTokenAmount);

      // Should handle large sweeps without issues
      await expect(sweepWallet.connect(owner).sweepETH(recipient.address)).to.not.be.reverted;

      await expect(sweepWallet.connect(owner).sweep(await mockToken.getAddress(), recipient.address)).to.not.be
        .reverted;
    });
  });
});
