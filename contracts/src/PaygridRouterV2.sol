// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PaygridLink.sol";

contract PaygridRouterV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum PaymentMethod {
        Crypto,
        Fonbnk,
        Card
    }

    address public treasury;
    uint256 public feeBps = 50; // 0.5% = 50 bps
    uint256 public constant MAX_FEE_BPS = 500; // 5% max
    PaygridLink public paygridLink;

    mapping(address => bool) public supportedTokens;
    mapping(address => bool) public authorizedSwapTargets;

    event PaymentReceived(
        uint256 indexed linkId,
        address indexed payer,
        address indexed token,
        uint256 amount,
        uint256 fee,
        PaymentMethod method,
        bytes32 onrampTxId
    );
    event SwapPayment(
        uint256 indexed linkId,
        address indexed payer,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address swapTarget
    );
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event FeeSet(uint256 oldFee, uint256 newFee);
    event SupportedTokenSet(address indexed token, bool supported);
    event SwapTargetSet(address indexed target, bool authorized);

    error SwapCallFailed(bytes reason);

    constructor(address _treasury, address _paygridLink) Ownable(msg.sender) {
        require(_treasury != address(0), "Treasury required");
        require(_paygridLink != address(0), "PaygridLink required");
        treasury = _treasury;
        paygridLink = PaygridLink(_paygridLink);
    }

    function pay(uint256 linkId, address token, uint256 amount) external nonReentrant {
        PaygridLink.PaymentLink memory link = paygridLink.getLink(linkId);
        _validateLink(link, token, amount);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _settleAndMarkPaid(linkId, link.recipient, token, amount, PaymentMethod.Crypto, bytes32(0));
    }

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
        _validateLink(link, token, amount);

        IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _settleAndMarkPaid(linkId, link.recipient, token, amount, PaymentMethod.Crypto, bytes32(0));
    }

    function payWithSwap(
        uint256 linkId,
        address tokenIn,
        uint256 amountInMax,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCalldata,
        uint256 deadline
    ) external nonReentrant {
        PaygridLink.PaymentLink memory link = paygridLink.getLink(linkId);
        _validateSwapRequest(link, tokenIn, amountInMax, minAmountOut, swapTarget, deadline);

        IERC20 tokenOutContract = IERC20(link.token);
        uint256 tokenOutBefore = tokenOutContract.balanceOf(address(this));
        uint256 amountIn = _pullAndSwap(tokenIn, amountInMax, swapTarget, swapCalldata);
        uint256 amountOut = tokenOutContract.balanceOf(address(this)) - tokenOutBefore;

        require(amountOut >= minAmountOut, "Insufficient swap output");
        require(amountOut >= link.amount, "Payment amount not met");

        uint256 refundOut = amountOut - link.amount;
        if (refundOut > 0) {
            tokenOutContract.safeTransfer(msg.sender, refundOut);
        }

        _settleSwapPayment(linkId, link, tokenIn, amountIn, swapTarget);
    }

    function payWithFiat(uint256 linkId, address token, uint256 amount, bytes32 onrampTxId)
        external
        onlyOwner
        nonReentrant
    {
        require(onrampTxId != bytes32(0), "onrampTxId required");

        PaygridLink.PaymentLink memory link = paygridLink.getLink(linkId);
        _validateLink(link, token, amount);
        require(link.acceptsFiat, "Fiat not accepted");
        _settleAndMarkPaid(linkId, link.recipient, token, amount, PaymentMethod.Fonbnk, onrampTxId);
    }

    function payWithCard(uint256 linkId, address token, uint256 amount, bytes32 providerTxId)
        external
        onlyOwner
        nonReentrant
    {
        require(providerTxId != bytes32(0), "providerTxId required");

        PaygridLink.PaymentLink memory link = paygridLink.getLink(linkId);
        _validateLink(link, token, amount);
        require(link.acceptsFiat, "Fiat not accepted");
        _settleAndMarkPaid(linkId, link.recipient, token, amount, PaymentMethod.Card, providerTxId);
    }

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

    function setSupportedToken(address token, bool supported) external onlyOwner {
        require(token != address(0), "Token required");
        supportedTokens[token] = supported;
        emit SupportedTokenSet(token, supported);
    }

    function setSwapTarget(address target, bool authorized) external onlyOwner {
        require(target != address(0), "Target required");
        authorizedSwapTargets[target] = authorized;
        emit SwapTargetSet(target, authorized);
    }

    function _settleSwapPayment(
        uint256 linkId,
        PaygridLink.PaymentLink memory link,
        address tokenIn,
        uint256 amountIn,
        address swapTarget
    ) private {
        _settleAndMarkPaid(linkId, link.recipient, link.token, link.amount, PaymentMethod.Crypto, bytes32(0));
        emit SwapPayment(linkId, msg.sender, tokenIn, link.token, amountIn, link.amount, swapTarget);
    }

    function _validateSwapRequest(
        PaygridLink.PaymentLink memory link,
        address tokenIn,
        uint256 amountInMax,
        uint256 minAmountOut,
        address swapTarget,
        uint256 deadline
    ) private view {
        require(block.timestamp <= deadline, "Swap expired");
        require(amountInMax > 0, "Amount required");
        require(authorizedSwapTargets[swapTarget], "Unauthorized swap target");
        require(supportedTokens[tokenIn], "Unsupported token in");
        _validateLinkState(link);
        require(supportedTokens[link.token], "Unsupported token out");
        require(tokenIn != link.token, "Swap not required");
        require(minAmountOut >= link.amount, "Min output too low");
    }

    function _pullAndSwap(address tokenIn, uint256 amountInMax, address swapTarget, bytes calldata swapCalldata)
        private
        returns (uint256 amountIn)
    {
        IERC20 tokenInContract = IERC20(tokenIn);
        uint256 tokenInBefore = tokenInContract.balanceOf(address(this));

        tokenInContract.safeTransferFrom(msg.sender, address(this), amountInMax);
        tokenInContract.forceApprove(swapTarget, amountInMax);
        (bool success, bytes memory reason) = swapTarget.call(swapCalldata);
        tokenInContract.forceApprove(swapTarget, 0);
        if (!success) {
            revert SwapCallFailed(reason);
        }

        uint256 tokenInAfter = tokenInContract.balanceOf(address(this));
        uint256 refundIn = tokenInAfter > tokenInBefore ? tokenInAfter - tokenInBefore : 0;
        if (refundIn > 0) {
            tokenInContract.safeTransfer(msg.sender, refundIn);
        }
        return amountInMax - refundIn;
    }

    function _validateLink(PaygridLink.PaymentLink memory link, address token, uint256 amount) private view {
        _validateLinkState(link);
        require(link.token == token, "Wrong token");
        require(link.amount == amount, "Wrong amount");
    }

    function _validateLinkState(PaygridLink.PaymentLink memory link) private view {
        require(link.creator != address(0), "Link not found");
        require(!link.paid, "Already paid");
        require(!link.cancelled, "Cancelled");
        require(link.expiresAt == 0 || block.timestamp <= link.expiresAt, "Expired");
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
        paygridLink.markPaid(linkId, msg.sender, amount, token, PaygridLink.PaymentMethod(uint8(method)));
        emit PaymentReceived(linkId, msg.sender, token, amount, fee, method, onrampTxId);
    }

    function _calculateSplit(uint256 amount) private view returns (uint256 fee, uint256 net) {
        fee = (amount * feeBps) / 10000;
        net = amount - fee;
    }
}
