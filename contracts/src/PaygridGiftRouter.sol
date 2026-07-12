// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./PaygridGiftVault.sol";

contract PaygridGiftRouter is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_FEE_BPS = 500;

    PaygridGiftVault public immutable giftVault;
    address public treasury;
    uint256 public feeBps = 50;

    mapping(address => bool) public supportedTokens;
    mapping(address => bool) public authorizedSwapTargets;

    struct SwapGiftParams {
        address tokenIn;
        address tokenOut;
        uint256 giftAmount;
        uint256 amountInMax;
        uint256 minAmountOut;
        address swapTarget;
        bytes swapCalldata;
        uint256 deadline;
        bytes32 claimHash;
        bytes32 metadataHash;
        uint256 expiresAt;
    }

    event GiftFunded(
        uint256 indexed giftId,
        address indexed sender,
        address indexed token,
        uint256 giftAmount,
        uint256 fee
    );
    event GiftFundedWithSwap(
        uint256 indexed giftId,
        address indexed sender,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 giftAmount
    );
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event FeeSet(uint256 oldFee, uint256 newFee);
    event SupportedTokenSet(address indexed token, bool supported);
    event SwapTargetSet(address indexed target, bool authorized);

    error SwapCallFailed(bytes reason);

    constructor(address _treasury, address _giftVault) Ownable(msg.sender) {
        require(_treasury != address(0), "Treasury required");
        require(_giftVault != address(0), "Gift vault required");
        treasury = _treasury;
        giftVault = PaygridGiftVault(_giftVault);
    }

    function createGift(
        address token,
        uint256 giftAmount,
        bytes32 claimHash,
        bytes32 metadataHash,
        uint256 expiresAt
    ) external nonReentrant whenNotPaused returns (uint256 giftId) {
        require(supportedTokens[token], "Unsupported token");
        require(giftAmount > 0, "Amount required");

        uint256 fee = calculateFee(giftAmount);
        IERC20(token).safeTransferFrom(msg.sender, address(this), giftAmount + fee);
        IERC20(token).safeTransfer(treasury, fee);
        IERC20(token).safeTransfer(address(giftVault), giftAmount);

        giftId = giftVault.createGiftFromRouter(
            msg.sender,
            token,
            giftAmount,
            claimHash,
            metadataHash,
            expiresAt
        );
        emit GiftFunded(giftId, msg.sender, token, giftAmount, fee);
    }

    function createGiftWithSwap(SwapGiftParams calldata params)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 giftId)
    {
        require(block.timestamp <= params.deadline, "Swap expired");
        require(supportedTokens[params.tokenIn] && supportedTokens[params.tokenOut], "Unsupported token");
        require(params.tokenIn != params.tokenOut, "Swap not required");
        require(authorizedSwapTargets[params.swapTarget], "Unauthorized swap target");
        require(params.giftAmount > 0 && params.amountInMax > 0, "Amount required");

        uint256 fee = calculateFee(params.giftAmount);
        uint256 requiredOut = params.giftAmount + fee;
        require(params.minAmountOut >= requiredOut, "Min output too low");

        IERC20 outToken = IERC20(params.tokenOut);
        uint256 outBefore = outToken.balanceOf(address(this));
        uint256 amountIn = _pullAndSwap(
            params.tokenIn,
            params.amountInMax,
            params.swapTarget,
            params.swapCalldata
        );
        uint256 amountOut = outToken.balanceOf(address(this)) - outBefore;
        require(amountOut >= params.minAmountOut, "Insufficient swap output");

        uint256 refundOut = amountOut - requiredOut;
        if (refundOut > 0) {
            outToken.safeTransfer(msg.sender, refundOut);
        }
        outToken.safeTransfer(treasury, fee);
        outToken.safeTransfer(address(giftVault), params.giftAmount);

        giftId = giftVault.createGiftFromRouter(
            msg.sender,
            params.tokenOut,
            params.giftAmount,
            params.claimHash,
            params.metadataHash,
            params.expiresAt
        );
        emit GiftFundedWithSwap(
            giftId,
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            amountIn,
            params.giftAmount
        );
    }

    function calculateFee(uint256 giftAmount) public view returns (uint256) {
        return (giftAmount * feeBps) / 10000;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Treasury required");
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _pullAndSwap(address tokenIn, uint256 amountInMax, address swapTarget, bytes calldata swapCalldata)
        private
        returns (uint256 amountIn)
    {
        IERC20 inToken = IERC20(tokenIn);
        uint256 beforeBalance = inToken.balanceOf(address(this));
        inToken.safeTransferFrom(msg.sender, address(this), amountInMax);
        inToken.forceApprove(swapTarget, amountInMax);
        (bool success, bytes memory reason) = swapTarget.call(swapCalldata);
        inToken.forceApprove(swapTarget, 0);
        if (!success) revert SwapCallFailed(reason);

        uint256 afterBalance = inToken.balanceOf(address(this));
        uint256 refundIn = afterBalance > beforeBalance ? afterBalance - beforeBalance : 0;
        if (refundIn > 0) inToken.safeTransfer(msg.sender, refundIn);
        return amountInMax - refundIn;
    }
}
