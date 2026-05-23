// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PaygridLink.sol";
import "../src/PaygridRouter.sol";

contract Deploy is Script {
    address constant TREASURY = 0xD4683314A013792fe8840E4171dC4692E317617B;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        PaygridLink link = new PaygridLink();
        console.log("PaygridLink:", address(link));

        PaygridRouter router = new PaygridRouter(TREASURY, address(link));
        console.log("PaygridRouter:", address(router));

        link.setRouter(address(router));
        console.log("Router connected");

        vm.stopBroadcast();

        console.log("\n=== Deployed on Sepolia ===");
        console.log("Treasury:     ", TREASURY);
        console.log("PaygridLink:  ", address(link));
        console.log("PaygridRouter:", address(router));
    }
}
