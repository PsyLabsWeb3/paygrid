// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PaygridLink.sol";

contract PaygridRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum PaymentMethod { Crypto, Fonbnk, Card }

    address public treasury;
    uint256 public feeBps = 50; // 0.5% = 50 bps
    uint256 public constant MAX_FEE_BPS = 500; // 5% max
    PaygridLink public paygridLink;

    event PaymentReceived(
        uint256 indexed linkId,
        address indexed payer,
        address indexed token,
        uint256 amount,
        uint256 fee,
        PaymentMethod method,
        bytes32 onrampTxId
    );

    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event FeeSet(uint256 oldFee, uint256 newFee);

    constructor(address _treasury, address _paygridLink) Ownable(msg.sender) {
        require(_treasury != address(0), "Treasury required");
        require(_paygridLink != address(0), "PaygridLink required");
        treasury = _treasury;
        paygridLink = PaygridLink(_paygridLink);
    }

    // --- Crypto payment (ERC-20 approve) ---

    function pay(uint256 linkId, address token, uint256 amount) external nonReentrant {
        PaygridLink.PaymentLink memory link = paygridLink.getLink(linkId);
        _validateLink(linkId, link, token, amount);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _settleAndMarkPaid(linkId, link.recipient, token, amount, PaymentMethod.Crypto, bytes32(0));
    }

    // --- Crypto payment with permit (single tx) ---

    function payWithPermit(
        uint256 linkId,
        address token,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        PaygridLink.PaymentLink memory link = paygridLink.getLink(linkId);
        _validateLink(linkId, link, token, amount);

        IERC20Permit(token).permit(
            msg.sender,
            address(this),
            amount,
            deadline,
            v,
            r,
            s
        );

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _settleAndMarkPaid(linkId, link.recipient, token, amount, PaymentMethod.Crypto, bytes32(0));
    }

    // --- Fiat payment (Fonbnk) ---

    function payWithFiat(
        uint256 linkId,
        address token,
        uint256 amount,
        bytes32 onrampTxId
    ) external onlyOwner nonReentrant {
        require(onrampTxId != bytes32(0), "onrampTxId required");

        PaygridLink.PaymentLink memory link = paygridLink.getLink(linkId);
        _validateLink(linkId, link, token, amount);
        require(link.acceptsFiat, "Fiat not accepted");

        // Tokens already held by router (sent by Fonbnk)
        _settleAndMarkPaid(linkId, link.recipient, token, amount, PaymentMethod.Fonbnk, onrampTxId);
    }

    // --- Card-funded payment (Ramp or future card provider) ---

    function payWithCard(
        uint256 linkId,
        address token,
        uint256 amount,
        bytes32 providerTxId
    ) external onlyOwner nonReentrant {
        require(providerTxId != bytes32(0), "providerTxId required");

        PaygridLink.PaymentLink memory link = paygridLink.getLink(linkId);
        _validateLink(linkId, link, token, amount);
        require(link.acceptsFiat, "Fiat not accepted");

        // Tokens already held by router (sent by the card/onramp provider)
        _settleAndMarkPaid(linkId, link.recipient, token, amount, PaymentMethod.Card, providerTxId);
    }

    // --- Shared helpers ---

    function _validateLink(
        uint256 linkId,
        PaygridLink.PaymentLink memory link,
        address token,
        uint256 amount
    ) private view {
        require(link.creator != address(0), "Link not found");
        require(!link.paid, "Already paid");
        require(!link.cancelled, "Cancelled");
        // support expiresAt == 0 as "no expiration"
        require(link.expiresAt == 0 || block.timestamp <= link.expiresAt, "Expired");
        require(link.token == token, "Wrong token");
        require(link.amount == amount, "Wrong amount");
    }

    function _settleAndMarkPaid(
        uint256 linkId,
        address recipient,
        address token,
        uint256 amount,
        PaymentMethod method,
        bytes32 onrampTxId
    ) private {
        (uint256 fee, uint256 net) = _calculateSplit(amount);

        IERC20(token).safeTransfer(treasury, fee);
        IERC20(token).safeTransfer(recipient, net);

        // mark paid on the link contract and emit events
        // cast router enum to PaygridLink.PaymentMethod for cross-contract call
        paygridLink.markPaid(linkId, msg.sender, amount, token, PaygridLink.PaymentMethod(uint8(method)));

        emit PaymentReceived(linkId, msg.sender, token, amount, fee, method, onrampTxId);
    }

    function _calculateSplit(uint256 amount) private view returns (uint256 fee, uint256 net) {
        fee = (amount * feeBps) / 10000;
        net = amount - fee;
    }

    // --- Admin ---

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Cannot be zero");
        emit TreasurySet(treasury, _treasury);
        treasury = _treasury;
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "Fee too high");
        emit FeeSet(feeBps, _feeBps);
        feeBps = _feeBps;
    }
}
