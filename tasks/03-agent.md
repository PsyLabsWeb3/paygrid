# Tasks: Agent

Plan de ejecución para `agent/` con Vercel AI SDK, viem, ERC-8004 y x402.
Fuente de verdad de integración:
- [docs/agent.md](../docs/agent.md)
- [docs/api.md](../docs/api.md)
- [docs/contracts.md](../docs/contracts.md)
- [backend/README.md](../backend/README.md)

## Estado actual

- Backend listo para consumo por el agente.
- Contratos y deploys Sepolia ya definidos.
- `agent/` sigue sin runtime completo.

## Objetivo

Construir un runtime de agente que:

- registre y mantenga identidad ERC-8004,
- cree y consulte payment links vía backend,
- pague endpoints x402,
- produzca reportes de tesorería,
- quede listo para operar en VPS con wallet persistente.

---

## Fase 1 — Wallet bootstrap + identidad ERC-8004

**Meta:** dejar el agente con wallets, registro on-chain y metadata coherentes.

- [ ] Generar `AGENT_PRIVATE_KEY` y `AGENT_OWNER_PRIVATE_KEY` con `viem generatePrivateKey`.
- [ ] Guardar ambas keys solo en `agent/.env` y documentarlas en `agent/.env.example`.
- [ ] Definir el rol de cada wallet:
  - owner: registrar identidad y autorizar wallet de pago,
  - payment: gas, links y x402.
- [ ] Registrar el agente en el registry ERC-8004 correcto según red:
  - Sepolia para pruebas,
  - Mainnet para despliegue final.
- [ ] Publicar metadata del agente con `agentId`, endpoints y capacidades.
- [ ] Verificar el `agentId` en 8004scan.
- [ ] Fondear la wallet de pago en la red correspondiente.

**Done when**

- el agentId existe en el registry,
- la metadata es visible,
- la wallet de pago tiene saldo suficiente para pruebas,
- no hay secretos en git.

---

## Fase 2 — Runtime base del agente

**Meta:** crear el esqueleto ejecutable del runtime.

- [ ] Inicializar el runtime `agent/` con scripts reales, entrada principal y configuración.
- [ ] Configurar Vercel AI SDK con herramientas.
- [ ] Crear cliente de backend con `BACKEND_URL`.
- [ ] Crear cliente viem para lectura on-chain y balance checks.
- [ ] Definir capa de wallet y utilidades comunes.
- [ ] Resolver configuración por entorno:
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

- [ ] `createPaymentLink(amount, token, description, recipientAddress, acceptedMethods)`.
- [ ] `checkPaymentStatus(linkId)`.
- [ ] `getBalance(token?)`.
- [ ] `getPaymentHistory(limit?, status?)`.
- [ ] `executeTreasuryReport(period?)`.
- [ ] Consumir los endpoints ya existentes:
  - `POST /api/links`
  - `GET /api/links`
  - `GET /api/links/:id`
  - `GET /api/payments`
- [ ] Manejar auth dual según corresponda:
  - ERC-8004 para agente,
  - Privy si se usa en flows compartidos.

**Done when**

- el agente puede crear links,
- consultar estado,
- leer historial,
- producir un resumen de tesorería sin tocar la base directamente.

---

## Fase 4 — x402 payer

**Meta:** permitir que el agente pague endpoints protegidos.

- [ ] Integrar `thirdweb/x402` como payer.
- [ ] Consumir el ejemplo backend `GET /api/x402/data`.
- [ ] Manejar challenge `402 Payment Required`.
- [ ] Reintentar request con proof válido.
- [ ] Registrar trazas mínimas de pagos x402 para debugging.

**Done when**

- el agente puede pagar un endpoint x402 de prueba,
- el flujo challenge → proof → success queda automatizado.

---

## Fase 5 — x402 payee / agent exposure

**Meta:** exponer endpoint propio del agente cuando el runtime ya exista.

- [ ] Definir `/agent/x402` o equivalente.
- [ ] Definir webhook local de confirmación.
- [ ] Proteger el endpoint con el esquema ya descrito en `docs/agent.md`.
- [ ] Mantener compatibilidad con el backend actual.

**Done when**

- el agente puede recibir pagos por un endpoint propio,
- la interfaz del payee no contradice la spec de backend.

---

## Fase 6 — Observabilidad y reportes

**Meta:** cerrar la parte operativa.

- [ ] Logs estructurados para tools y pagos.
- [ ] Reporte de tesorería por período.
- [ ] Healthcheck del runtime.
- [ ] Manejo de reintentos y errores de red.

**Done when**

- se pueden auditar acciones del agente,
- el reporte de tesorería sale sin intervención manual,
- el runtime puede operar en VPS/PM2.

---

## Fase 7 — Tests y validación

**Meta:** dejar la implementación confiable para merge.

- [ ] Test de generación/registro de wallet.
- [ ] Test de tools contra backend mockeado.
- [ ] Test de x402 payer con endpoint de prueba.
- [ ] Test de reportes de tesorería.
- [ ] Validación manual de:
  - crear payment link,
  - consultar estado,
  - pagar endpoint x402,
  - verificar `agentId` en 8004scan.

**Done when**

- el runtime pasa tests,
- el flujo principal del agente se puede repetir en Sepolia.

---

## Estimación de costo de ejecución

Estimación para implementar esta fase con LLM, no costo de operación del agente:

| Fase | Tokens estimados | GPT-5 mini | GPT-5 |
|------|------------------|-----------:|------:|
| 1 | 50k-70k | $0.05-$0.07 | $0.24-$0.35 |
| 2 | 90k-130k | $0.09-$0.13 | $0.46-$0.60 |
| 3 | 100k-160k | $0.10-$0.16 | $0.48-$0.73 |
| 4 | 60k-90k | $0.05-$0.09 | $0.25-$0.38 |

Total aproximado:

- GPT-5 mini: $0.29-$0.45
- GPT-5: $1.43-$2.06

Supuesto: sesiones con contexto compartido razonable y 1-2 iteraciones por fase.

---

## Notas de alineación

- `backend/` ya cubre Privy, Fonbnk, ERC-8004 y x402.
- `contracts/` ya define `PaygridLink` y `PaygridRouter`.
- `minipay/` no debe asumir API co-localizada.
- No hardcodear addresses de prueba en el runtime salvo que vengan de `contracts/deployments.*.json`.
