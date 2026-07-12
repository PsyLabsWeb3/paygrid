// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../src/PaygridGiftVault.sol";
import "../src/PaygridGiftRouter.sol";

contract GiftMockStable is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract GiftMockSwapTarget {
    using SafeERC20 for IERC20;

    function swapExactOutput(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }
}

contract PaygridGiftTest is Test {
    PaygridGiftVault vault;
    PaygridGiftRouter router;
    GiftMockStable usdc;
    GiftMockStable usdt;
    GiftMockSwapTarget swapTarget;

    uint256 claimSignerKey = 0xA11CE;
    address claimSigner;
    address treasury = address(0x1111);
    address sender = address(0x2222);
    address recipient = address(0x3333);

    function setUp() public {
        claimSigner = vm.addr(claimSignerKey);
        vault = new PaygridGiftVault(claimSigner);
        router = new PaygridGiftRouter(treasury, address(vault));
        vault.setRouter(address(router));

        usdc = new GiftMockStable("USDC", "USDC");
        usdt = new GiftMockStable("USDT", "USDT");
        swapTarget = new GiftMockSwapTarget();
        router.setSupportedToken(address(usdc), true);
        router.setSupportedToken(address(usdt), true);
        router.setSwapTarget(address(swapTarget), true);

        usdc.mint(sender, 1_000 ether);
        usdt.mint(sender, 1_000 ether);
        usdc.mint(address(swapTarget), 1_000 ether);
    }

    function test_CreateAndClaimExactGift() public {
        uint256 giftId = _createGift(10 ether);
        bytes memory signature = _signClaim(giftId, recipient, 1, block.timestamp + 1 hours);

        vm.prank(recipient);
        vault.claimGift(giftId, 1, block.timestamp + 1 hours, signature);

        assertEq(usdc.balanceOf(recipient), 10 ether);
        assertEq(usdc.balanceOf(treasury), 0.05 ether);
        assertEq(uint256(vault.getGift(giftId).status), uint256(PaygridGiftVault.GiftStatus.Claimed));
    }

    function test_ClaimRejectsInvalidSigner() public {
        uint256 giftId = _createGift(10 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = vault.claimDigest(giftId, recipient, 1, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, digest);

        vm.prank(recipient);
        vm.expectRevert("Invalid authorization");
        vault.claimGift(giftId, 1, deadline, abi.encodePacked(r, s, v));
    }

    function test_ClaimRejectsReplayAndDoubleClaim() public {
        uint256 giftId = _createGift(10 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(giftId, recipient, 1, deadline);

        vm.prank(recipient);
        vault.claimGift(giftId, 1, deadline, signature);
        vm.prank(recipient);
        vm.expectRevert("Gift unavailable");
        vault.claimGift(giftId, 1, deadline, signature);
    }

    function test_ClaimRejectsSender() public {
        uint256 giftId = _createGift(10 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(giftId, sender, 1, deadline);

        vm.prank(sender);
        vm.expectRevert("Sender cannot claim");
        vault.claimGift(giftId, 1, deadline, signature);
    }

    function test_ClaimRejectsExpiredAuthorization() public {
        uint256 giftId = _createGift(10 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(giftId, recipient, 1, deadline);
        vm.warp(deadline + 1);

        vm.prank(recipient);
        vm.expectRevert("Authorization expired");
        vault.claimGift(giftId, 1, deadline, signature);
    }

    function test_ExpiredGiftCanBeRefunded() public {
        uint256 giftId = _createGift(10 ether);
        uint256 senderAfterFunding = usdc.balanceOf(sender);
        vm.warp(block.timestamp + 8 days);

        vault.refundExpiredGift(giftId);

        assertEq(usdc.balanceOf(sender), senderAfterFunding + 10 ether);
        assertEq(uint256(vault.getGift(giftId).status), uint256(PaygridGiftVault.GiftStatus.Refunded));
    }

    function test_SenderCanCancelActiveGift() public {
        uint256 giftId = _createGift(10 ether);
        uint256 senderAfterFunding = usdc.balanceOf(sender);

        vm.prank(sender);
        vault.cancelGift(giftId);

        assertEq(usdc.balanceOf(sender), senderAfterFunding + 10 ether);
        assertEq(uint256(vault.getGift(giftId).status), uint256(PaygridGiftVault.GiftStatus.Cancelled));
    }

    function test_CreateGiftWithSwap() public {
        uint256 giftAmount = 10 ether;
        uint256 fee = router.calculateFee(giftAmount);
        uint256 amountOut = giftAmount + fee;
        bytes memory swapData = abi.encodeWithSelector(
            GiftMockSwapTarget.swapExactOutput.selector,
            address(usdt),
            address(usdc),
            11 ether,
            amountOut
        );

        vm.startPrank(sender);
        usdt.approve(address(router), 11 ether);
        uint256 giftId = router.createGiftWithSwap(PaygridGiftRouter.SwapGiftParams({
            tokenIn: address(usdt),
            tokenOut: address(usdc),
            giftAmount: giftAmount,
            amountInMax: 11 ether,
            minAmountOut: amountOut,
            swapTarget: address(swapTarget),
            swapCalldata: swapData,
            deadline: block.timestamp + 1 hours,
            claimHash: keccak256("secret"),
            metadataHash: keccak256("metadata"),
            expiresAt: block.timestamp + 7 days
        }));
        vm.stopPrank();

        assertEq(vault.getGift(giftId).amount, giftAmount);
        assertEq(usdc.balanceOf(address(vault)), giftAmount);
        assertEq(usdc.balanceOf(treasury), fee);
    }

    function test_SwapRejectsUnauthorizedTarget() public {
        GiftMockSwapTarget badTarget = new GiftMockSwapTarget();
        vm.startPrank(sender);
        usdt.approve(address(router), 11 ether);
        vm.expectRevert("Unauthorized swap target");
        router.createGiftWithSwap(PaygridGiftRouter.SwapGiftParams({
            tokenIn: address(usdt),
            tokenOut: address(usdc),
            giftAmount: 10 ether,
            amountInMax: 11 ether,
            minAmountOut: 10.05 ether,
            swapTarget: address(badTarget),
            swapCalldata: bytes(""),
            deadline: block.timestamp + 1 hours,
            claimHash: keccak256("secret"),
            metadataHash: keccak256("metadata"),
            expiresAt: block.timestamp + 7 days
        }));
        vm.stopPrank();
    }

    function _createGift(uint256 giftAmount) private returns (uint256) {
        uint256 total = giftAmount + router.calculateFee(giftAmount);
        vm.startPrank(sender);
        usdc.approve(address(router), total);
        uint256 giftId = router.createGift(
            address(usdc),
            giftAmount,
            keccak256("secret"),
            keccak256("metadata"),
            block.timestamp + 7 days
        );
        vm.stopPrank();
        return giftId;
    }

    function _signClaim(uint256 giftId, address claimant, uint256 nonce, uint256 deadline)
        private
        returns (bytes memory)
    {
        bytes32 digest = vault.claimDigest(giftId, claimant, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(claimSignerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
