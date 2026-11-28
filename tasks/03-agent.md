# Tasks: Agent

Plan de ejecución para `agent/` con Vercel AI SDK, viem, ERC-8004 y x402.
Fuente de verdad de integración:
- [docs/agent.md](../docs/agent.md)
- [docs/api.md](../docs/api.md)
- [docs/contracts.md](../docs/contracts.md)
- [backend/README.md](../backend/README.md)

## Estado actual

- Backend y contratos ya soportan links, pagos, historial, autenticación ERC-8004 y endpoint x402 de ejemplo.
- Fase 1 completada: wallets + identidad ERC-8004.
- Fase 2 completada: runtime base del agente.
- Fase 3 completada: tools para backend actual.
- Fase 4 implementada: ejecutor x402 v2; canarios mainnet CLI/MCP con las tres monedas verificados, validación operativa adicional pendiente.
- Fase 5 pendiente: x402 server propio / agent exposure.

**Resumen:** el backend ya expone las APIs que el agente consume. El agente ya tiene cliente x402 payer para el endpoint de ejemplo; lo pendiente es exponer un endpoint x402 propio, observabilidad completa y validación operativa.

---

## Objetivo

Construir un runtime de agente que:

- mantenga identidad ERC-8004 coherente con el backend,
- cree y consulte payment links vía backend,
- pague endpoints x402,
- produzca reportes de tesorería,
- quede listo para operar en VPS con wallet persistente.

---

## Fase 1 — Wallet bootstrap + identidad ERC-8004

**Meta:** dejar el agente con wallets, registro on-chain y metadata coherentes.

- [x] Generar `AGENT_PRIVATE_KEY` y `AGENT_OWNER_PRIVATE_KEY` con `viem generatePrivateKey`.
- [x] Guardar ambas keys solo en `agent/.env` y documentarlas en `agent/.env.example`.
- [x] Definir el rol de cada wallet:
  - owner: registrar identidad y autorizar wallet de pago,
  - payment: gas, links y x402.
- [x] Registrar el agente en el registry ERC-8004 correcto según red:
  - Sepolia para pruebas,
  - Mainnet para despliegue final.
- [x] Publicar metadata del agente con `agentId`, endpoints y capacidades.
- [x] Verificar el `agentId` en 8004scan.
- [x] Fondear la wallet de pago en la red correspondiente.

**Done when**

- el agentId existe en el registry,
- la metadata es visible,
- la wallet de pago tiene saldo suficiente para pruebas,
- no hay secretos en git.

---

## Fase 2 — Runtime base del agente

**Meta:** crear el esqueleto ejecutable del runtime.

- [x] Inicializar el runtime `agent/` con scripts reales, entrada principal y configuración.
- [x] Configurar Vercel AI SDK con herramientas.
- [x] Crear cliente de backend con `BACKEND_URL`.
- [x] Crear cliente viem para lectura on-chain y balance checks.
- [x] Definir capa de wallet y utilidades comunes.
- [x] Resolver configuración por entorno:
  - `AGENT_PRIVATE_KEY`
  - `AGENT_OWNER_PRIVATE_KEY`
  - `BACKEND_URL`
  - `CELO_RPC_URL`
  - `ERC8004_AGENT_ID`

**Done when**

- el runtime arranca localmente,
- las variables críticas se validan al inicio,
- el agente puede hablar con backend y chain.

---

## Fase 3 — Tooling para backend actual

**Meta:** conectar el agente con las APIs ya disponibles.

- [x] `createPaymentLink(amount, token, description, recipientAddress, acceptedMethods)`.
- [x] `checkPaymentStatus(linkId)`.
- [x] `getBalance(token?)`.
- [x] `getPaymentHistory(limit?, status?)`.
- [x] `executeTreasuryReport(period?)`.
- [x] Consumir los endpoints ya existentes:
  - `POST /api/links`
  - `GET /api/links`
  - `GET /api/links/:id`
  - `GET /api/payments`
- [x] Manejar auth dual según corresponda:
  - ERC-8004 para agente,
  - Privy si se usa en flows compartidos.
- [x] Normalizar montos y decimales antes de enviar requests o calcular balances:
  - USDC / USDT: 6 decimales,
  - USDm: 18 decimales.

**Done when**

- el agente puede crear links,
- consultar estado,
- leer historial,
- producir un resumen de tesorería sin tocar la base directamente,
- las tools rechazan tokens o montos inválidos antes de llamar al backend.

---

## Fase 4 — x402 v2 payer

- [x] Replace thirdweb and simulated proof generation with an authenticated client of the backend executor.
- [x] Stable idempotency keys and payment status/capability tools.
- [x] Backend policy, shared per-token budgets, encrypted authorizations and recovery worker.
- [x] Official MCP transports and input validation.
- [x] Mainnet USDC/USDT/wMXN CLI and MCP canaries with recorded receipts, transfers and shared-budget accounting.
- [x] USDC/USDT client-interruption recovery with the original operation and no second transfer.
- [ ] VPS concurrent replay audit and remaining first-operation/restart recovery validation.
- [ ] Real Sepolia USDC canary (operator prioritized mainnet).

See docs/x402.md. Unit/fork checks do not imply mainnet readiness.

## Fase 5 — x402 payee / agent exposure

**Meta:** exponer endpoint propio del agente cuando el runtime ya exista.

- [ ] Definir `/agent/x402` o equivalente.
- [ ] Definir webhook local de confirmación.
- [ ] Proteger el endpoint con el esquema ya descrito en `docs/agent.md`.
- [ ] Mantener compatibilidad con el backend actual.
- [ ] No tratar este endpoint como product-ready hasta que el payer esté estable y testeado.

**Done when**

- el agente puede recibir pagos por un endpoint propio,
- la interfaz del payee no contradice la spec de backend,
- el endpoint queda documentado con request/response y headers requeridos.

---

## Fase 6 — Observabilidad y reportes

**Meta:** cerrar la parte operativa.

- [ ] Logs estructurados para tools, auth, balance checks y pagos.
- [ ] Reporte de tesorería por período.
- [ ] Healthcheck del runtime.
- [ ] Manejo de reintentos y errores de red.
- [ ] Señales mínimas para operación en VPS/PM2:
  - startup/shutdown,
  - wallet address usada,
  - endpoint de backend,
  - estado de conexión RPC.

**Done when**

- se pueden auditar acciones del agente,
- el reporte de tesorería sale sin intervención manual,
- el runtime puede operar en VPS/PM2.

---

## Fase 7 — Tests y validación

**Meta:** dejar la implementación confiable para merge.

- [ ] Test de generación/registro de wallet.
- [ ] Test de tools contra backend mockeado.
- [x] Test de x402 payer con endpoint de prueba.
- [ ] Test de reportes de tesorería.
- [ ] Validación manual de:
  - crear payment link,
  - consultar estado,
  - pagar endpoint x402,
  - verificar `agentId` en 8004scan.

**Done when**

- el runtime pasa tests,
- el flujo principal del agente se puede repetir en Sepolia,
- las herramientas respetan tokens, decimales y auth esperada.

---

## Notas de alineación

- `backend/` ya cubre Privy, Fonbnk, ERC-8004 y x402.
- `contracts/` ya define `PaygridLink` y `PaygridRouter`.
- `minipay/` no debe asumir API co-localizada.
- No hardcodear addresses de prueba en el runtime salvo que vengan de `contracts/deployments.*.json`.
- Variables adicionales a documentar si el runtime las usa:
  - `AGENT_API_KEY`
  - `X402_EXECUTOR_API_KEY` (backend executor credential; no payment key in agent)
