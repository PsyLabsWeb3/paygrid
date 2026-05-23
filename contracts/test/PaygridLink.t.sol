// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PaygridLink.sol";

contract PaygridLinkTest is Test {
    PaygridLink public link;

    address router = address(0xf00d);
    address creator = address(0xbabe);
    address recipient = address(0xcafe);
    address token = address(0xdead);
    uint256 amount = 100e6; // 100 USDC
    uint256 expiresAt = block.timestamp + 7 days;

    function setUp() public {
        vm.prank(creator);
        link = new PaygridLink();
        vm.prank(creator);
        link.setRouter(router);
    }

    function test_Constructor() public {
        assertEq(link.owner(), creator);
    }

    function test_CreateLink() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, token, "test", false, expiresAt);

        PaygridLink.PaymentLink memory l = link.getLink(id);
        assertEq(l.creator, creator);
        assertEq(l.recipient, recipient);
        assertEq(l.amount, amount);
        assertEq(l.token, token);
        assertEq(l.description, "test");
        assertEq(l.acceptsFiat, false);
        assertFalse(l.paid);
        assertFalse(l.cancelled);
        assertEq(l.expiresAt, expiresAt);
    }

    function test_CreateLinkWithFiat() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, token, "fiat link", true, expiresAt);

        PaygridLink.PaymentLink memory l = link.getLink(id);
        assertEq(l.acceptsFiat, true);
    }

    function test_CreateLinkEmitsEvent() public {
        vm.prank(creator);
        vm.expectEmit(true, true, true, true);
        emit PaygridLink.LinkCreated(1, creator, recipient, amount, token, true);
        link.createLink(recipient, amount, token, "evt", true, expiresAt);
    }

    function test_CancelLink() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, token, "cancel", false, expiresAt);

        vm.prank(creator);
        link.cancelLink(id);

        PaygridLink.PaymentLink memory l = link.getLink(id);
        assertTrue(l.cancelled);
    }

    function test_CancelLink_RevertsNotCreator() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, token, "cancel", false, expiresAt);

        vm.prank(address(0x1337));
        vm.expectRevert("Not creator");
        link.cancelLink(id);
    }

    function test_CancelLink_RevertsAlreadyPaid() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, token, "paid", false, expiresAt);

        vm.prank(router);
        link.markPaid(id);

        vm.prank(creator);
        vm.expectRevert("Already paid");
        link.cancelLink(id);
    }

    function test_MarkPaid() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, token, "mark", false, expiresAt);

        vm.prank(router);
        link.markPaid(id);

        PaygridLink.PaymentLink memory l = link.getLink(id);
        assertTrue(l.paid);
    }

    function test_MarkPaid_RevertsExpired() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, token, "expired", false, block.timestamp + 1);

        vm.warp(block.timestamp + 2);

        vm.prank(router);
        vm.expectRevert("Expired");
        link.markPaid(id);
    }

    function test_IsActive() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, token, "active", false, expiresAt);
        assertTrue(link.isActive(id));
    }

    function test_IsActive_FalseWhenPaid() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, token, "paid", false, expiresAt);

        vm.prank(router);
        link.markPaid(id);
        assertFalse(link.isActive(id));
    }

    function test_LinkIdsIncrement() public {
        vm.startPrank(creator);
        uint256 id1 = link.createLink(recipient, amount, token, "first", false, expiresAt);
        uint256 id2 = link.createLink(recipient, amount, token, "second", false, expiresAt);
        assertEq(id1, 1);
        assertEq(id2, 2);
    }
}
