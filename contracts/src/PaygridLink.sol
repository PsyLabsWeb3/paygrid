// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract PaygridLink is Ownable {
    enum PaymentMethod { Crypto, Fonbnk }

    address public router;

    constructor() Ownable(msg.sender) {}

    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "Zero address");
        router = _router;
    }

    struct PaymentLink {
        uint256 id;
        address creator;
        address recipient;
        uint256 amount;
        address token;
        string description;
        bool acceptsFiat;
        bool paid;
        bool cancelled;
        uint256 createdAt;
        uint256 expiresAt;
    }

    uint256 private _nextId = 1;
    mapping(uint256 => PaymentLink) private _links;

    event LinkCreated(
        uint256 indexed linkId,
        address indexed creator,
        address indexed recipient,
        uint256 amount,
        address token,
        bool acceptsFiat
    );

    event LinkCancelled(uint256 indexed linkId);
    event LinkPaid(
        uint256 indexed linkId,
        address payer,
        uint256 amount,
        address token,
        PaymentMethod method
    );

    function createLink(
        address recipient,
        uint256 amount,
        address token,
        string calldata description,
        bool acceptsFiat,
        uint256 expiresAt
    ) external returns (uint256 linkId) {
        require(recipient != address(0), "Recipient required");
        require(amount > 0, "Amount required");
        require(token != address(0), "Token required");
        require(expiresAt == 0 || expiresAt > block.timestamp, "Invalid expiration");

        linkId = _nextId++;
        _links[linkId] = PaymentLink({
            id: linkId,
            creator: msg.sender,
            recipient: recipient,
            amount: amount,
            token: token,
            description: description,
            acceptsFiat: acceptsFiat,
            paid: false,
            cancelled: false,
            createdAt: block.timestamp,
            expiresAt: expiresAt
        });

        emit LinkCreated(linkId, msg.sender, recipient, amount, token, acceptsFiat);
    }

    function cancelLink(uint256 linkId) external {
        PaymentLink storage link = _links[linkId];
        require(link.creator == msg.sender, "Not creator");
        require(!link.paid, "Already paid");
        require(!link.cancelled, "Already cancelled");

        link.cancelled = true;
        emit LinkCancelled(linkId);
    }

    // Mark a link as paid. Only the configured router may call this.
    // The router passes payer, amount, token and method to improve observability
    function markPaid(
        uint256 linkId,
        address payer,
        uint256 amount,
        address token,
        PaymentMethod method
    ) external {
        require(msg.sender == router, "Only router");
        PaymentLink storage link = _links[linkId];
        require(!link.paid, "Already paid");
        require(!link.cancelled, "Already cancelled");
        // support expiresAt == 0 as "no expiration"
        require(link.expiresAt == 0 || block.timestamp <= link.expiresAt, "Expired");

        link.paid = true;

        // Emit LinkPaid so indexers / UIs can listen directly on the link contract
        emit LinkPaid(linkId, payer, amount, token, method);
    }

    // Backwards-compatible overload for tests or callers that only pass linkId.
    // This preserves the previous markPaid(linkId) behavior.
    function markPaid(uint256 linkId) external {
        require(msg.sender == router, "Only router");
        PaymentLink storage link = _links[linkId];
        require(!link.paid, "Already paid");
        require(!link.cancelled, "Already cancelled");
        require(link.expiresAt == 0 || block.timestamp <= link.expiresAt, "Expired");

        link.paid = true;

        // Emit a LinkPaid event with best-effort values (payer unknown here)
        emit LinkPaid(linkId, address(0), link.amount, link.token, PaymentMethod.Crypto);
    }

    function getLink(uint256 linkId) external view returns (PaymentLink memory) {
        return _links[linkId];
    }

    function isActive(uint256 linkId) external view returns (bool) {
        PaymentLink storage link = _links[linkId];
        return !link.paid && !link.cancelled && (link.expiresAt == 0 || block.timestamp <= link.expiresAt);
    }
}
