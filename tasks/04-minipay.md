# Tasks: MiniApp Frontend

Plan de ejecucion para `minipay/` con Next.js 14 App Router, Tailwind, Wagmi y Viem.
Fuente de verdad de integracion:
- [docs/architecture.md](../docs/architecture.md)
- [docs/api.md](../docs/api.md)
- [docs/contracts.md](../docs/contracts.md)
- [docs/data-model.md](../docs/data-model.md)
- [backend/README.md](../backend/README.md)

## Estado actual

- `minipay/` esta vacio salvo `.gitkeep`.
- `contracts/` ya tiene deploy de desarrollo en Celo Sepolia.
- `backend/` ya expone links, payments, Fonbnk config/session, Privy auth y ERC-8004 auth.
- `agent/` no bloquea el frontend: x402 payer ya existe para el endpoint de ejemplo.
- Mainnet deploy, Celoscan verification y registro final no bloquean el desarrollo UI.

**Resumen:** el frontend puede arrancar contra backend standalone y Celo Sepolia actualizada. La UI y las integraciones HTTP ya pueden validarse contra el deploy vigente de testnet.

---

## Objetivo

Construir una MiniPay MiniApp que:

- auto-conecte MiniPay cuando este dentro del contenedor,
- permita crear payment links en USDm, USDC y USDT,
- permita pagar links existentes por crypto o Fonbnk,
- muestre historial y detalle de pagos,
- funcione bien en viewport 360x640,
- use solo backend standalone via `BACKEND_URL`.

---

## Endpoints frontend

El frontend debe consumir estos endpoints actuales:

- `POST /api/links` - crear link.
- `GET /api/links` - listar links del usuario autenticado.
- `GET /api/links/:id` - cargar link publico y estado.
- `POST /api/links/:id/pay` - iniciar pago crypto o Fonbnk.
- `GET /api/payments` - historial autenticado.
- `GET /api/onramp/fonbnk/config?country=<ISO>` - carriers, limites y tasas.

No implementar API routes co-localizadas en Next.js salvo proxy minimo si Vercel lo requiere despues.

---

## Fase 1 - Scaffold y base de app

**Meta:** crear la estructura ejecutable de `minipay/`.

- [ ] Inicializar Next.js 14 App Router en `minipay/`.
- [ ] Configurar TypeScript, Tailwind y PostCSS.
- [ ] Definir scripts `dev`, `build`, `start`, `lint`.
- [ ] Crear layout base mobile-first para MiniPay.
- [ ] Crear `.env.example` con variables publicas:
  - `NEXT_PUBLIC_BACKEND_URL`
  - `NEXT_PUBLIC_CELO_RPC`
  - `NEXT_PUBLIC_PRIVY_APP_ID`
  - `NEXT_PUBLIC_CHAIN_ID`
- [ ] Definir rutas iniciales:
  - `/`
  - `/create`
  - `/pay/[id]`
  - `/history`
  - `/history/[id]`

**Done when**

- `npm run dev` arranca en `minipay/`,
- `npm run build` compila,
- la app renderiza sin depender de backend real.

---

## Fase 2 - MiniPay, Wagmi y Viem

**Meta:** conectar wallet y red sin romper restricciones de MiniPay.

- [ ] Configurar Wagmi + Viem para Celo Sepolia como red de desarrollo.
- [ ] Preparar configuracion para Celo Mainnet sin activarla por defecto.
- [ ] Detectar MiniPay con `window.ethereum?.isMiniPay`.
- [ ] Auto-conectar wallet al iniciar dentro de MiniPay.
- [ ] Soportar fallback web para pruebas fuera de MiniPay.
- [ ] Configurar transacciones legacy:
  - no `maxFeePerGas`,
  - no `maxPriorityFeePerGas`.
- [ ] Configurar `feeCurrency` cuando se envie tx desde MiniPay:
  - usar adapter address para fees en USDC/USDT,
  - usar token address real para balances, approvals y transferencias,
  - no mezclar token address con fee adapter.
- [ ] No usar `personal_sign` ni `eth_signTypedData`.
- [ ] No usar Ethers.js ni web3.js.

**Done when**

- la app detecta MiniPay,
- puede leer address conectado,
- no intenta firmas no soportadas,
- la configuracion usa Viem/Wagmi solamente.

---

## Fase 3 - Cliente backend y tipos

**Meta:** aislar llamadas HTTP y modelos compartidos del frontend.

- [ ] Crear cliente `NEXT_PUBLIC_BACKEND_URL`.
- [ ] Tipar modelos minimos:
  - `PaymentLink`
  - `Payment`
  - `FonbnkConfig`
  - `PayLinkCryptoResponse`
  - `PayLinkFonbnkResponse`
- [ ] Implementar helpers:
  - `createPaymentLink`
  - `getPaymentLink`
  - `listPaymentLinks`
  - `initiateCryptoPayment`
  - `initiateFonbnkPayment`
  - `getPaymentHistory`
  - `getFonbnkConfig`
- [ ] Manejar formato de error backend `{ error: { code, message, details } }`.
- [ ] Mantener auth via Privy JWT para crear links e historial.
- [ ] Permitir `GET /api/links/:id` publico para pagar links activos.

**Done when**

- las pantallas consumen un cliente comun,
- errores backend se presentan de forma consistente,
- no hay fetch ad-hoc duplicado en componentes.

---

## Fase 4 - Home y crear link

**Meta:** permitir que un usuario cree y comparta links.

- [ ] Home con acciones principales:
  - crear link,
  - ver historial,
  - abrir link reciente si existe.
- [ ] Form de crear link:
  - amount,
  - token `USDm | USDC | USDT`,
  - description,
  - recipientAddress,
  - acceptedMethods `crypto | fonbnk`.
- [ ] Validar amount segun decimales:
  - USDm: 18,
  - USDC / USDT: 6.
- [ ] No mostrar CELO como asset principal.
- [ ] Crear link via `POST /api/links`.
- [ ] Mostrar link generado y acciones de compartir:
  - WhatsApp,
  - email,
  - copy link,
  - native share si esta disponible.

**Done when**

- un usuario autenticado puede crear un link,
- el link resultante abre `/pay/[id]`,
- no hay amounts invalidos enviados al backend.

---

## Fase 5 - Pagar link por crypto

**Meta:** permitir pago crypto desde MiniPay o wallet compatible.

- [ ] Pantalla `/pay/[id]` carga link con `GET /api/links/:id`.
- [ ] Mostrar amount, token, description, estado y metodos aceptados.
- [ ] Mostrar tab crypto solo si el link acepta `crypto`.
- [ ] Llamar `POST /api/links/:id/pay` con `{ method: "crypto" }`.
- [ ] Ejecutar approve token antes del `pay()` del router si el allowance no alcanza.
- [ ] No implementar `permit` ni firmas typed data para MiniPay.
- [ ] Enviar tx retornada por backend con Viem/Wagmi.
- [ ] Respetar legacy tx y `feeCurrency`.
- [ ] Mostrar estados:
  - preparando tx,
  - esperando wallet,
  - confirmando,
  - pagado,
  - rechazado,
  - saldo insuficiente.
- [ ] Mostrar receipt con tx hash y link a explorer correcto por red.

**Done when**

- el flujo de pago crypto queda implementado y verificable en UI contra payloads reales del backend,
- el backend/indexer puede marcar el link como pagado en la Sepolia actual,
- la UI no bloquea si la confirmacion tarda.

---

## Fase 6 - Pagar link con Fonbnk

**Meta:** ofrecer fiat solo cuando Fonbnk este disponible.

- [ ] Detectar o pedir pais ISO del pagador.
- [ ] Consultar `GET /api/onramp/fonbnk/config?country=<ISO>`.
- [ ] Ocultar tab fiat si no hay carriers disponibles.
- [ ] Ocultar fiat para links en USDm; Fonbnk hoy solo soporta USDC y USDT.
- [ ] Mostrar carriers, canales y limites por carrier.
- [ ] No hardcodear carriers.
- [ ] Llamar `POST /api/links/:id/pay` con:
  - `method: "fonbnk"`,
  - `countryIsoCode`,
  - `paymentChannel`,
  - `carrierCode`,
  - `email` obligatorio para el flujo actual.
- [ ] Abrir `session.redirectUrl` o widget provider segun response backend.
- [ ] Mostrar estados:
  - creando sesion,
  - esperando pago,
  - procesando,
  - completado,
  - fallido,
  - Fonbnk no disponible.

**Done when**

- la opcion fiat aparece solo con availability valida,
- el usuario recibe instrucciones claras del provider,
- el link puede pasar a pagado cuando webhook/indexer confirma.

---

## Fase 7 - Historial, detalle y receipts

**Meta:** cerrar vistas post-pago y actividad.

- [ ] Historial con tabs:
  - recibidos,
  - links activos.
- [ ] No implementar tab de enviados como feature principal mientras backend no exponga payer history autenticado.
- [ ] Consumir `GET /api/payments` y `GET /api/links`.
- [ ] Filtros por status y token.
- [ ] Vista detalle con:
  - amount,
  - token,
  - metodo,
  - status,
  - timestamp,
  - tx hash,
  - link a explorer.
- [ ] Empty states:
  - no links,
  - no payments,
  - no resultados para filtro.
- [ ] Loading skeletons para vistas con data fetching.
- [ ] Deeplinks o acciones para receipt/share cuando MiniPay lo soporte.

**Done when**

- un usuario puede auditar pagos y links desde la app,
- los detalles usan datos backend, no datos mockeados.

---

## Fase 8 - UX hardening MiniPay

**Meta:** dejar la app lista para uso real en dispositivo.

- [ ] Optimizar para 360x640.
- [ ] Mantener bundle objetivo menor a 2 MB.
- [ ] Disenar tap targets comodos para Opera Mini/MiniPay.
- [ ] Evitar texto largo que rompa botones o cards.
- [ ] Estados de error para:
  - backend caido,
  - wallet no disponible,
  - chain incorrecta,
  - token no soportado,
  - tx rechazada,
  - Fonbnk unavailable.
- [ ] Copys compatibles con MiniPay:
  - usar "Network fee" en vez de "Gas",
  - usar "Deposit" en vez de "Onramp" o "Buy crypto",
  - usar "Withdraw" en vez de "Offramp" o "Sell crypto".
- [ ] No identificar al usuario principalmente por address si phone/ODIS esta disponible.

**Done when**

- la UI es usable en telefono pequeno,
- no usa terminos prohibidos por MiniPay,
- fallos comunes tienen recuperacion clara.

---

## Fase 9 - Tests y validacion

**Meta:** validar el flujo completo antes de merge.

- [ ] Unit tests para validacion de amount/token.
- [ ] Tests de cliente backend con fetch mockeado.
- [ ] Tests de create link form.
- [ ] Tests de pay link states.
- [ ] Build production `npm run build`.
- [ ] Validacion manual fuera de MiniPay con browser normal.
- [ ] Validacion manual en MiniPay fisico via ngrok:
  - auto-connect,
  - crear link,
  - abrir link compartido,
  - pagar crypto,
  - mostrar receipt,
  - verificar history.
- [ ] Validacion Fonbnk con pais/carrier soportado o mock provider si no hay credenciales.

**Done when**

- build pasa,
- tests pasan,
- flujo principal se puede repetir en Celo Sepolia,
- no hay secretos en git,
- `tasks/04-minipay.md` refleja el estado final.

---

## Notas de alineacion

- Red de desarrollo: Celo Sepolia `11142220`.
- Red final: Celo Mainnet `42220`.
- Las direcciones Sepolia actuales ya reflejan el deploy vigente para desarrollo y E2E de testnet.
- No usar Alfajores.
- No asumir API co-localizada en `minipay/`.
- No hardcodear Fonbnk carriers.
- No hardcodear amounts sin validar decimales.
- No presentar CELO como asset principal.
- Para Mainnet, esperar direcciones finales de `contracts/deployments.mainnet.json` o equivalente.
