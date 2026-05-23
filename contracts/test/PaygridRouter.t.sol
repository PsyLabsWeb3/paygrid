// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "../src/PaygridLink.sol";
import "../src/PaygridRouter.sol";

contract MockUSDC is ERC20Permit {
    constructor() ERC20("USDC", "USDC") ERC20Permit("USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract PaygridRouterTest is Test {
    PaygridLink public link;
    PaygridRouter public router;
    MockUSDC public usdc;

    address treasury = address(0x1111);
    address creator = address(0xbabe);
    address payer = address(0xdead);
    address recipient = address(0xcafe);
    uint256 amount = 100e6; // 100 USDC
    uint256 expiresAt;

    function setUp() public {
        vm.prank(creator);
        link = new PaygridLink();

        router = new PaygridRouter(treasury, address(link));

        vm.prank(creator);
        link.setRouter(address(router));

        usdc = new MockUSDC();
        usdc.mint(payer, 10000e6); // 10,000 USDC

        expiresAt = block.timestamp + 7 days;
    }

    function _createAndFundLink() private returns (uint256) {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "test", false, expiresAt);

        vm.prank(payer);
        usdc.approve(address(router), amount);
        return id;
    }

    // --- Constructor ---

    function test_Constructor() public {
        assertEq(router.treasury(), treasury);
        assertEq(router.feeBps(), 50);
        assertEq(address(router.paygridLink()), address(link));
    }

    function test_Constructor_RevertsZeroTreasury() public {
        vm.expectRevert("Treasury required");
        new PaygridRouter(address(0), address(link));
    }

    // --- Pay ---

    function test_Pay() public {
        uint256 id = _createAndFundLink();

        vm.prank(payer);
        router.pay(id, address(usdc), amount);

        // 0.5% fee = 0.5 USDC = 500000
        assertEq(usdc.balanceOf(treasury), 500000);
        assertEq(usdc.balanceOf(recipient), 99500000);
        assertEq(usdc.balanceOf(payer), 10000e6 - amount);

        PaygridLink.PaymentLink memory l = link.getLink(id);
        assertTrue(l.paid);
    }

    function test_Pay_EmitsEvent() public {
        uint256 id = _createAndFundLink();
        uint256 expectedFee = (amount * 50) / 10000;

        vm.prank(payer);
        vm.expectEmit(true, true, true, false);
        emit PaygridRouter.PaymentReceived(
            id, payer, address(usdc), amount, expectedFee, PaygridRouter.PaymentMethod.Crypto, bytes32(0)
        );
        router.pay(id, address(usdc), amount);
    }

    // --- PayWithFiat ---

    function test_PayWithFiat() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "fiat", true, expiresAt);

        // Mint tokens to router (as if Fonbnk sent them)
        usdc.mint(address(router), amount);

        bytes32 onrampTxId = keccak256("fonbnk-tx-123");
        router.payWithFiat(id, address(usdc), amount, onrampTxId);

        assertEq(usdc.balanceOf(treasury), 500000);
        assertEq(usdc.balanceOf(recipient), 99500000);
    }

    function test_PayWithFiat_RevertsNotOwner() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "fiat", true, expiresAt);

        vm.prank(address(0x1337));
        vm.expectRevert();
        router.payWithFiat(id, address(usdc), amount, keccak256("test"));
    }

    function test_PayWithFiat_RevertsFiatNotAccepted() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "nofiat", false, expiresAt);

        usdc.mint(address(router), amount);
        bytes32 fakeId = keccak256("test");

        vm.expectRevert("Fiat not accepted");
        router.payWithFiat(id, address(usdc), amount, fakeId);
    }

    // --- Validation ---

    function test_Pay_RevertsAlreadyPaid() public {
        uint256 id = _createAndFundLink();

        vm.startPrank(payer);
        router.pay(id, address(usdc), amount);
        usdc.approve(address(router), amount);
        vm.expectRevert("Already paid");
        router.pay(id, address(usdc), amount);
    }

    function test_Pay_RevertsExpired() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "soon", false, block.timestamp + 1);

        vm.prank(payer);
        usdc.approve(address(router), amount);

        vm.warp(block.timestamp + 2);

        vm.prank(payer);
        vm.expectRevert("Expired");
        router.pay(id, address(usdc), amount);
    }

    // --- Fee Management ---

    function test_SetFeeBps() public {
        router.setFeeBps(100); // 1%
        assertEq(router.feeBps(), 100);
    }

    function test_SetFeeBps_RevertsTooHigh() public {
        vm.expectRevert("Fee too high");
        router.setFeeBps(501); // > 5%
    }

    function test_SetFeeBps_RevertsNotOwner() public {
        vm.prank(address(0x1337));
        vm.expectRevert();
        router.setFeeBps(100);
    }

    // --- Treasury ---

    function test_SetTreasury() public {
        router.setTreasury(address(0x2222));
        assertEq(router.treasury(), address(0x2222));
    }

    function test_SetTreasury_RevertsZero() public {
        vm.expectRevert("Cannot be zero");
        router.setTreasury(address(0));
    }

    // --- Fee Calculation ---

    function test_FeeCalculation_100USDC() public {
        uint256 id = _createAndFundLink();

        vm.prank(payer);
        router.pay(id, address(usdc), amount);

        // 100 USDC = 100_000_000 (6 decimals)
        // 0.5% = 500_000
        assertEq(usdc.balanceOf(treasury), 500_000);
        assertEq(usdc.balanceOf(recipient), 99_500_000);
    }

    function test_FeeCalculation_1USDC() public {
        uint256 small = 1e6; // 1 USDC

        vm.prank(creator);
        uint256 id = link.createLink(recipient, small, address(usdc), "small", false, expiresAt);

        vm.prank(payer);
        usdc.approve(address(router), small);

        vm.prank(payer);
        router.pay(id, address(usdc), small);

        // 1 USDC = 1_000_000
        // 0.5% = 5_000
        assertEq(usdc.balanceOf(treasury), 5_000);
        assertEq(usdc.balanceOf(recipient), 995_000);
    }

    // --- PayWithPermit ---

    function test_PayWithPermit() public {
        vm.prank(creator);
        uint256 id = link.createLink(recipient, amount, address(usdc), "permit", false, expiresAt);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 signerKey = 0xabc123;
        address signer = vm.addr(signerKey);

        usdc.mint(signer, amount);

        bytes32 domainSeparator = usdc.DOMAIN_SEPARATOR();
        bytes32 permitTypehash = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                permitTypehash,
                signer,
                address(router),
                amount,
                usdc.nonces(signer),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);

        vm.prank(signer);
        router.payWithPermit(id, address(usdc), amount, deadline, v, r, s);

        uint256 expectedFee = (amount * 50) / 10000;
        assertEq(usdc.balanceOf(treasury), expectedFee);
        assertEq(usdc.balanceOf(recipient), amount - expectedFee);
    }
}
