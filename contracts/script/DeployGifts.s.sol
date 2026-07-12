// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PaygridGiftVault.sol";
import "../src/PaygridGiftRouter.sol";

contract DeployGifts is Script {
    function run() external {
        uint256 deployerPrivateKey = uint256(vm.envBytes32("PRIVATE_KEY"));
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address claimSigner = vm.envAddress("GIFT_CLAIM_SIGNER_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address usdt = vm.envAddress("USDT_ADDRESS");
        address usdm = vm.envAddress("USDM_ADDRESS");
        address mentoRouter = vm.envOr("MENTO_ROUTER_ADDRESS", address(0));
        address uniswapRouter = vm.envOr("UNISWAP_ROUTER_ADDRESS", address(0));

        vm.startBroadcast(deployerPrivateKey);

        PaygridGiftVault vault = new PaygridGiftVault(claimSigner);
        PaygridGiftRouter router = new PaygridGiftRouter(treasury, address(vault));
        vault.setRouter(address(router));
        router.setSupportedToken(usdc, true);
        router.setSupportedToken(usdt, true);
        router.setSupportedToken(usdm, true);
        if (mentoRouter != address(0)) router.setSwapTarget(mentoRouter, true);
        if (uniswapRouter != address(0)) router.setSwapTarget(uniswapRouter, true);

        vm.stopBroadcast();

        console.log("PaygridGiftVault: ", address(vault));
        console.log("PaygridGiftRouter:", address(router));
        console.log("Claim signer:     ", claimSigner);
        console.log("Treasury:         ", treasury);
        console.log("Chain ID:         ", block.chainid);
    }
}
