// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PaygridLink.sol";
import "../src/PaygridRouter.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 chainId = block.chainid;

        vm.startBroadcast(deployerPrivateKey);

        PaygridLink link = new PaygridLink();
        console.log("PaygridLink:", address(link));

        PaygridRouter router = new PaygridRouter(treasury, address(link));
        console.log("PaygridRouter:", address(router));

        link.setRouter(address(router));
        console.log("Router connected");

        vm.stopBroadcast();

        console.log("\n=== Paygrid deployment ===");
        console.log("Chain ID:     ", chainId);
        console.log("Treasury:     ", treasury);
        console.log("PaygridLink:  ", address(link));
        console.log("PaygridRouter:", address(router));
    }
}
