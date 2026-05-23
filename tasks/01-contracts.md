# Tasks: Smart Contracts

- [x] Scaffold Foundry project with OpenZeppelin dependencies
- [x] PaygridLink.sol — PaymentLink struct, createLink, cancelLink, getLink
- [x] PaygridLink.sol — LinkCreated, LinkCancelled, LinkPaid events
- [x] PaygridRouter.sol — pay() with fee split (0.5% treasury, 99.5% recipient)
- [x] PaygridRouter.sol — payWithPermit() single-tx permit payment
- [x] PaygridRouter.sol — payWithFiat() for Fonbnk-initiated payments
- [x] PaygridRouter.sol — PaymentMethod enum (Crypto, Fonbnk)
- [x] PaygridRouter.sol — PaymentReceived event with method + onrampTxId fields
- [x] ReentrancyGuard on pay, payWithPermit, and payWithFiat
- [x] Unit tests for create, cancel, pay, payWithPermit, payWithFiat flows
- [x] Deploy to Celo Sepolia (testnet)
  - PaygridLink:  `0xB2aB34957C4E70f5E0FD90cc18186b5B1b4D9f29`
  - PaygridRouter: `0xdBCaFe19e942075a9f9719dD8f2f7bb1b6F865d9`
- [ ] Integration tests with fork (Celo Mainnet)
- [ ] Deploy to Celo Mainnet
- [ ] Verify contracts on Celoscan
