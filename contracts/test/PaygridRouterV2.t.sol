// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../src/PaygridLink.sol";
import "../src/PaygridRouterV2.sol";

contract MockStable is ERC20Permit {
    uint8 private immutable _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) ERC20Permit(name) {
        _decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}

contract MockSwapTarget {
    using SafeERC20 for IERC20;

    function swapExactOutput(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }

    function failSwap() external pure {
        revert("swap failed");
    }
}

contract PaygridRouterV2Test is Test {
    PaygridLink public link;
    PaygridRouterV2 public router;
    MockStable public usdc;
    MockStable public usdt;
    MockSwapTarget public swapTarget;
    MockSwapTarget public unauthorizedSwapTarget;

    address treasury = address(0x1111);
    address creator = address(0xbabe);
    address payer = address(0xdead);
    address recipient = address(0xcafe);
    uint256 amount = 100e6;
    uint256 expiresAt;

    function setUp() public {
        vm.prank(creator);
        link = new PaygridLink();
        router = new PaygridRouterV2(treasury, address(link));
        vm.prank(creator);
        link.setRouter(address(router));

        usdc = new MockStable("USDC", "USDC", 6);
        usdt = new MockStable("USDT", "USDT", 6);
        swapTarget = new MockSwapTarget();
        unauthorizedSwapTarget = new MockSwapTarget();

        usdc.mint(payer, 10000e6);
        usdt.mint(payer, 10000e6);
        usdc.mint(address(swapTarget), 10000e6);

        router.setSupportedToken(address(usdc), true);
        router.setSupportedToken(address(usdt), true);
        router.setSwapTarget(address(swapTarget), true);
        expiresAt = block.timestamp + 7 days;
    }

    function test_PayExactStillWorks() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "exact", false, expiresAt);

        vm.startPrank(payer);
        usdc.approve(address(router), amount);
        router.pay(id, address(usdc), amount);
        vm.stopPrank();

        assertEq(usdc.balanceOf(treasury), 500000);
        assertEq(usdc.balanceOf(recipient), 99500000);
        assertTrue(link.getLink(id).paid);
    }

    function test_PayWithSwapSettlesRequestedToken() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "swap", false, expiresAt);
        bytes memory swapData = abi.encodeWithSelector(
            MockSwapTarget.swapExactOutput.selector,
            address(usdt),
            address(usdc),
            100e6,
            amount
        );

        vm.startPrank(payer);
        usdt.approve(address(router), 101e6);
        router.payWithSwap(id, address(usdt), 101e6, amount, address(swapTarget), swapData, block.timestamp + 1 hours);
        vm.stopPrank();

        assertEq(usdc.balanceOf(treasury), 500000);
        assertEq(usdc.balanceOf(recipient), 99500000);
        assertEq(usdt.balanceOf(payer), 10000e6 - 100e6);
        assertTrue(link.getLink(id).paid);
    }

    function test_PayWithSwapRejectsUnauthorizedTarget() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "bad target", false, expiresAt);

        vm.startPrank(payer);
        usdt.approve(address(router), amount);
        vm.expectRevert("Unauthorized swap target");
        router.payWithSwap(id, address(usdt), amount, amount, address(unauthorizedSwapTarget), bytes(""), block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_PayWithSwapRejectsInsufficientOutput() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "low output", false, expiresAt);
        bytes memory swapData = abi.encodeWithSelector(
            MockSwapTarget.swapExactOutput.selector,
            address(usdt),
            address(usdc),
            100e6,
            amount - 1
        );

        vm.startPrank(payer);
        usdt.approve(address(router), 100e6);
        vm.expectRevert("Insufficient swap output");
        router.payWithSwap(id, address(usdt), 100e6, amount, address(swapTarget), swapData, block.timestamp + 1 hours);
        vm.stopPrank();
        assertFalse(link.getLink(id).paid);
    }

    function test_PayWithSwapRejectsFailedSwapAndDoesNotMarkPaid() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "fail", false, expiresAt);
        bytes memory swapData = abi.encodeWithSelector(MockSwapTarget.failSwap.selector);

        vm.startPrank(payer);
        usdt.approve(address(router), amount);
        vm.expectRevert();
        router.payWithSwap(id, address(usdt), amount, amount, address(swapTarget), swapData, block.timestamp + 1 hours);
        vm.stopPrank();
        assertFalse(link.getLink(id).paid);
    }
}
