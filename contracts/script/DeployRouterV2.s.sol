// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PaygridLink.sol";
import "../src/PaygridRouterV2.sol";

contract DeployRouterV2 is Script {
    function run() external {
        bytes32 pkBytes = vm.envBytes32("PRIVATE_KEY");
        uint256 deployerPrivateKey = uint256(pkBytes);
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address paygridLink = vm.envAddress("PAYGRID_LINK_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address usdt = vm.envAddress("USDT_ADDRESS");
        address usdm = vm.envAddress("USDM_ADDRESS");
        address uniswapRouter = vm.envOr("UNISWAP_ROUTER_ADDRESS", address(0));
        address mentoRouter = vm.envOr("MENTO_ROUTER_ADDRESS", address(0));
        bool connectLink = vm.envOr("CONNECT_LINK_ROUTER", false);

        vm.startBroadcast(deployerPrivateKey);

        PaygridRouterV2 router = new PaygridRouterV2(treasury, paygridLink);
        router.setSupportedToken(usdc, true);
        router.setSupportedToken(usdt, true);
        router.setSupportedToken(usdm, true);
        if (uniswapRouter != address(0)) {
            router.setSwapTarget(uniswapRouter, true);
        }
        if (mentoRouter != address(0)) {
            router.setSwapTarget(mentoRouter, true);
        }
        if (connectLink) {
            PaygridLink(paygridLink).setRouter(address(router));
        }

        vm.stopBroadcast();

        console.log("PaygridRouterV2:", address(router));
        console.log("PaygridLink:    ", paygridLink);
        console.log("Treasury:       ", treasury);
        console.log("Connected link: ", connectLink);
    }
}
