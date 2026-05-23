// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PaygridLink.sol";
import "../src/PaygridRouter.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PaygridTest is Test {
    PaygridLink link;
    PaygridRouter router;
    ERC20Mock token;

    address treasury = address(0xBEEF);
    address recipient = address(0xCAFE);
    address creator = address(0xC0FFEE);
    address payer = address(0xBABE);

    function setUp() public {
        token = new ERC20Mock("Mock", "MCK");
        link = new PaygridLink();
        router = new PaygridRouter(treasury, address(link));
        link.setRouter(address(router));
    }

    function testCreateAndCancel() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, 1000, address(token), "desc", true, 0);

        PaygridLink.PaymentLink memory p = link.getLink(id);
        assertEq(p.creator, creator);
        assertEq(p.recipient, recipient);
        assertEq(p.amount, 1000);
        assertEq(p.token, address(token));

        vm.prank(creator);
        link.cancelLink(id);
        p = link.getLink(id);
        assertTrue(p.cancelled);
    }

    function testOnlyRouterCanMarkPaid() public {
        vm.expectRevert("Only router");
        // calling markPaid directly should revert because msg.sender != router
        link.markPaid(1, payer, 1000, address(token), PaygridLink.PaymentMethod.Crypto);
    }

    function testRouterPaySplitsFee() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, 1_000_000, address(token), "x", false, 0);

        token.mint(payer, 1_000_000);
        vm.prank(payer);
        token.approve(address(router), 1_000_000);

        vm.prank(payer);
        router.pay(id, address(token), 1_000_000);

        uint256 fee = (1_000_000 * 50) / 10000; // 0.5%
        uint256 net = 1_000_000 - fee;

        assertEq(token.balanceOf(treasury), fee);
        assertEq(token.balanceOf(recipient), net);

        PaygridLink.PaymentLink memory p = link.getLink(id);
        assertTrue(p.paid);
    }

    function testPayWithFiatOwnerOnly() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, 1000, address(token), "fiat", true, 0);

        // simulate Fonbnk sending tokens to router
        token.mint(address(router), 1000);

        bytes32 txid = bytes32(uint256(0x123));
        // router.payWithFiat is owner-only; test contract is owner
        router.payWithFiat(id, address(token), 1000, txid);

        uint256 fee = (1000 * 50) / 10000;
        uint256 net = 1000 - fee;

        assertEq(token.balanceOf(treasury), fee);
        assertEq(token.balanceOf(recipient), net);

        PaygridLink.PaymentLink memory p = link.getLink(id);
        assertTrue(p.paid);
    }
}
