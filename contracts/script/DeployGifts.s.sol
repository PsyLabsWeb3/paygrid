// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PaygridGiftVault.sol";
import "../src/PaygridGiftRouter.sol";

contract DeployGifts is Script {
    function run() external {
        uint256 deployerPrivateKey = uint256(vm.envBytes32("PRIVATE_KEY"));
        address deployer = vm.addr(deployerPrivateKey);
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address owner = vm.envOr("OWNER_ADDRESS", deployer);
        address claimSigner = vm.envAddress("GIFT_CLAIM_SIGNER_ADDRESS");
        address usdc = vm.envOr("USDC_ADDRESS", address(0));
        address usdt = vm.envOr("USDT_ADDRESS", address(0));
        address usdm = vm.envOr("USDM_ADDRESS", address(0));
        address mentoRouter = vm.envOr("MENTO_ROUTER_ADDRESS", address(0));
        address uniswapRouter = vm.envOr("UNISWAP_ROUTER_ADDRESS", address(0));

        vm.startBroadcast(deployerPrivateKey);

        PaygridGiftVault vault = new PaygridGiftVault(claimSigner);
        PaygridGiftRouter router = new PaygridGiftRouter(treasury, address(vault));
        vault.setRouter(address(router));
        if (usdc != address(0)) router.setSupportedToken(usdc, true);
        if (usdt != address(0)) router.setSupportedToken(usdt, true);
        if (usdm != address(0)) router.setSupportedToken(usdm, true);
        if (mentoRouter != address(0)) router.setSwapTarget(mentoRouter, true);
        if (uniswapRouter != address(0)) router.setSwapTarget(uniswapRouter, true);
        if (owner != deployer) {
            vault.transferOwnership(owner);
            router.transferOwnership(owner);
        }

        vm.stopBroadcast();

        console.log("PaygridGiftVault: ", address(vault));
        console.log("PaygridGiftRouter:", address(router));
        console.log("Claim signer:     ", claimSigner);
        console.log("Treasury:         ", treasury);
        console.log("Owner:            ", owner);
        console.log("Chain ID:         ", block.chainid);
    }
}
