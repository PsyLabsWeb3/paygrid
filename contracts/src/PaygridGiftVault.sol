// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PaygridGiftVault is Ownable, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    enum GiftStatus {
        None,
        Active,
        Claimed,
        Cancelled,
        Refunded
    }

    struct Gift {
        uint256 id;
        address sender;
        address token;
        uint256 amount;
        bytes32 claimHash;
        bytes32 metadataHash;
        uint256 expiresAt;
        address recipient;
        GiftStatus status;
    }

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "ClaimGift(uint256 giftId,address recipient,uint256 nonce,uint256 deadline)"
    );

    address public router;
    address public claimSigner;
    uint256 private _nextId = 1;

    mapping(uint256 => Gift) private _gifts;
    mapping(bytes32 => bool) public usedClaims;

    event GiftCreated(
        uint256 indexed giftId,
        address indexed sender,
        address indexed token,
        uint256 amount,
        bytes32 claimHash,
        bytes32 metadataHash,
        uint256 expiresAt
    );
    event GiftClaimed(uint256 indexed giftId, address indexed recipient, address indexed token, uint256 amount);
    event GiftCancelled(uint256 indexed giftId, address indexed sender);
    event GiftRefunded(uint256 indexed giftId, address indexed sender);
    event RouterSet(address indexed oldRouter, address indexed newRouter);
    event ClaimSignerSet(address indexed oldSigner, address indexed newSigner);

    constructor(address _claimSigner) Ownable(msg.sender) EIP712("PaygridGiftVault", "1") {
        require(_claimSigner != address(0), "Claim signer required");
        claimSigner = _claimSigner;
    }

    function createGiftFromRouter(
        address sender,
        address token,
        uint256 amount,
        bytes32 claimHash,
        bytes32 metadataHash,
        uint256 expiresAt
    ) external whenNotPaused returns (uint256 giftId) {
        require(msg.sender == router, "Only router");
        require(sender != address(0), "Sender required");
        require(token != address(0), "Token required");
        require(amount > 0, "Amount required");
        require(claimHash != bytes32(0), "Claim hash required");
        require(expiresAt > block.timestamp, "Invalid expiration");

        giftId = _nextId++;
        _gifts[giftId] = Gift({
            id: giftId,
            sender: sender,
            token: token,
            amount: amount,
            claimHash: claimHash,
            metadataHash: metadataHash,
            expiresAt: expiresAt,
            recipient: address(0),
            status: GiftStatus.Active
        });

        emit GiftCreated(giftId, sender, token, amount, claimHash, metadataHash, expiresAt);
    }

    function claimGift(
        uint256 giftId,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        Gift storage gift = _gifts[giftId];
        require(gift.status == GiftStatus.Active, "Gift unavailable");
        require(block.timestamp <= gift.expiresAt, "Gift expired");
        require(block.timestamp <= deadline, "Authorization expired");
        require(msg.sender != gift.sender, "Sender cannot claim");

        bytes32 claimKey = keccak256(abi.encode(giftId, msg.sender, nonce));
        require(!usedClaims[claimKey], "Authorization used");

        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, giftId, msg.sender, nonce, deadline));
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        require(recovered == claimSigner, "Invalid authorization");

        usedClaims[claimKey] = true;
        gift.status = GiftStatus.Claimed;
        gift.recipient = msg.sender;
        IERC20(gift.token).safeTransfer(msg.sender, gift.amount);

        emit GiftClaimed(giftId, msg.sender, gift.token, gift.amount);
    }

    function cancelGift(uint256 giftId) external nonReentrant {
        Gift storage gift = _gifts[giftId];
        require(gift.sender == msg.sender, "Not sender");
        require(gift.status == GiftStatus.Active, "Gift unavailable");

        gift.status = GiftStatus.Cancelled;
        IERC20(gift.token).safeTransfer(gift.sender, gift.amount);
        emit GiftCancelled(giftId, gift.sender);
    }

    function refundExpiredGift(uint256 giftId) external nonReentrant {
        Gift storage gift = _gifts[giftId];
        require(gift.status == GiftStatus.Active, "Gift unavailable");
        require(block.timestamp > gift.expiresAt, "Gift not expired");

        gift.status = GiftStatus.Refunded;
        IERC20(gift.token).safeTransfer(gift.sender, gift.amount);
        emit GiftRefunded(giftId, gift.sender);
    }

    function getGift(uint256 giftId) external view returns (Gift memory) {
        return _gifts[giftId];
    }

    function claimDigest(uint256 giftId, address recipient, uint256 nonce, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, giftId, recipient, nonce, deadline));
        return _hashTypedDataV4(structHash);
    }

    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "Router required");
        emit RouterSet(router, _router);
        router = _router;
    }

    function setClaimSigner(address _claimSigner) external onlyOwner {
        require(_claimSigner != address(0), "Claim signer required");
        emit ClaimSignerSet(claimSigner, _claimSigner);
        claimSigner = _claimSigner;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
