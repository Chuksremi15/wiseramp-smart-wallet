// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./SweepWallet.sol";

/**
 * @title WalletFactory
 * @notice Deploys and manages user wallets. You deploy this contract ONCE.
 */
contract WalletFactory {
    // The address of the "template" SweepWallet.
    // This is set once when you deploy the factory.
    address public immutable implementation;

    // Address of your secure sweeper bot
    address public immutable sweeper;

    event WalletCreated(address indexed wallet, bytes32 indexed salt);

    constructor(address _sweeper) {
        // Deploy the "master" template contract
        SweepWallet _implementation = new SweepWallet();
        implementation = address(_implementation);
        sweeper = _sweeper;
    }

    /**
     * @notice This is the "magic" function.
     * It deploys the wallet and sweeps its funds in ONE transaction.
     */
    function deployAndSweep(bytes32 _salt, address _tokenAddress, address _to) external {
        // Only your main sweeper bot can call this
        require(msg.sender == sweeper, "Factory: Not sweeper");

        // 1. Deploy the clone deterministically
        address wallet = Clones.cloneDeterministic(implementation, _salt);

        // 2. Initialize the new clone, setting its owner
        SweepWallet(wallet).initialize(sweeper);

        // 3. Tell the new wallet to sweep its funds
        SweepWallet(wallet).sweep(_tokenAddress, _to);

        emit WalletCreated(wallet, _salt);
    }

    // --- View Function for Backend ---

    /**
     * @notice Calculates the *future* address for a user's salt.
     * Your backend calls this (for free) to get a deposit address.
     */
    function getDeterministicAddress(bytes32 _salt) public view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt, address(this));
    }
}
