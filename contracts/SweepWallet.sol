// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title SweepWallet
 * @notice This is the "template" contract for each user. It will be cloned.
 * It is "Initializable" instead of having a constructor.
 */
contract SweepWallet is Initializable, Ownable {
    using Address for address payable;

    address public factory;

    // Constructor for the implementation contract - sets a dummy owner
    constructor() Ownable(msg.sender) {
        // Disable initializers on the implementation contract
        _disableInitializers();
    }

    // This function is called *once* by the factory right after deployment.
    function initialize(address _newOwner) public initializer {
        // The "owner" of this wallet is your main backend sweeper bot
        _transferOwnership(_newOwner);
        // Store the factory address to allow it to sweep during deployment
        factory = msg.sender;
    }

    /**
     * @notice Sweeps all of a specific ERC-20 token to a destination.
     * Only the owner (your sweeper bot) or factory can call this.
     */
    function sweep(address _tokenAddress, address _to) external {
        require(msg.sender == owner() || msg.sender == factory, "SweepWallet: Not authorized");
        IERC20 token = IERC20(_tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        if (balance > 0) {
            token.transfer(_to, balance);
        }
    }

    /**
     * @notice Sweeps all native ETH from this contract.
     */
    function sweepETH(address payable _to) external {
        require(msg.sender == owner() || msg.sender == factory, "SweepWallet: Not authorized");
        uint256 balance = address(this).balance;
        if (balance > 0) {
            _to.sendValue(balance);
        }
    }

    // Must have this to receive native ETH from users
    receive() external payable {}
}
