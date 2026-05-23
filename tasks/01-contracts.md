# Tasks: Smart Contracts

- [ ] Scaffold Foundry project with OpenZeppelin dependencies
- [ ] PaygridLink.sol — PaymentLink struct, createLink, cancelLink, getLink
- [ ] PaygridLink.sol — LinkCreated, LinkCancelled, LinkPaid events
- [ ] PaygridRouter.sol — pay() with fee split (0.5% treasury, 99.5% recipient)
- [ ] PaygridRouter.sol — payWithFiat() for Fonbnk-initiated payments
- [ ] PaygridRouter.sol — PaymentMethod enum (Crypto, Fonbnk)
- [ ] PaygridRouter.sol — PaymentReceived event with method + onrampTxId fields
- [ ] ReentrancyGuard on pay and payWithFiat
- [ ] Unit tests for create, cancel, pay, payWithFiat flows
- [ ] Integration tests with fork (Celo Mainnet)
- [ ] Deploy script for Celo Sepolia (testnet)
- [ ] Deploy script for Celo Mainnet
- [ ] Verify contracts on Celo Explorer (celoscan)
