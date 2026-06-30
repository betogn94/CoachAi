# Paso a paso — Pendientes del ecosistema King (puente quiz→app + Stripe)

Para conectar el **quiz de Lovable** con la **app** (que la app reconozca a la clienta y
dispare el Reveal) + el cobro Foundation. Toca **3 herramientas**: Vercel, Lovable, Stripe.

> ⚠️ **Regla de seguridad:** el secreto NO se pega en el chat con Claude. Beto lo genera y lo
> pone **directo** en Vercel y Lovable. Claude nunca necesita verlo.

---

## FASE 1 — El puente quiz→app (el secreto compartido + el POST)
El endpoint `/api/king-intake` ya está LIVE y **fail-closed**: sin el secreto seteado en Vercel,
rechaza todo (401). Hay que: poner el secreto en **los dos lados** + hacer que Lovable postee.

### Paso 1 — Generar el secreto (BETO, NO en el chat)
- Generá una cadena aleatoria fuerte (32+ caracteres). Opciones:
  - Terminal: `openssl rand -hex 32`
  - El generador de contraseñas de tu gestor (largo, aleatorio).
  - Un generador online de "random string / API key".
- **Guardalo en un lugar seguro** — lo necesitás en Vercel Y Lovable (tiene que ser idéntico).
- ❌ **NO lo pegues en el chat.**

### Paso 2 — Ponerlo en VERCEL (env var)
- Vercel → proyecto CoachAI → **Settings → Environment Variables**.
- **Add:** Name = `KING_INTAKE_SECRET` · Value = `<el secreto>` · Environment = **Production**.
- Guardar.
- ⚠️ **Redeploy** (las env vars solo aplican a deploys nuevos): Deployments → Redeploy el último.
  Sin redeploy, el endpoint sigue rechazando.

### Paso 3 — Poner el MISMO secreto en LOVABLE
- En Lovable, guardalo como secreto/variable (donde Lovable maneje las API keys).
- **Idéntico** al de Vercel (si difiere un caracter → 401).

### Paso 4 — Hacer que Lovable POSTee al terminar el quiz (LOVABLE / Daniel)
Al finalizar el quiz, Lovable hace este request:
- **Método:** `POST`
- **URL:** `https://coachaipro.ai/api/king-intake`
- **Headers:**
  - `x-intake-key: <el secreto>`  ← exacto, todo en minúscula con guiones
  - `Content-Type: application/json`
- **Body (JSON):**
  ```json
  {
    "email": "EMAIL_DE_LA_CLIENTA",
    "tenant_slug": "jesus",
    "quiz_respuestas": { "...": "respuestas del quiz" },
    "arquetipo": "ARQUETIPO_DEL_MAPA",
    "diagnostico": { "...": "diagnóstico" },
    "pdf_url": "URL_DEL_PDF_GENERADO"
  }
  ```
- **`email` es OBLIGATORIO** (es la llave con la que la app la reconoce al loguear). El resto es
  opcional, pero cuanto más mandes, más rico el Reveal.
- El endpoint acepta nombres alternativos (`respuestas`/`answers`, `archetype`, `diagnosis`,
  `pdfUrl`) por si a Lovable le sale más fácil otro nombre.
- Respuestas: `200 {ok:true}` = guardado · `401 unauthorized` = secreto mal/falta · `400` = email inválido.

### Paso 5 — Verificar (CLAUDE)
- Beto hace un **quiz de prueba** con un email propio.
- Claude verifica que aparezca la fila en la tabla `king_intake` (lo chequea por la base).
- Si llegó → puente ✅. Si no → se revisa (header mal, secreto distinto, body, etc.).

---

## FASE 2 — Stripe Foundation $297 + registrar el ingreso (no toca Lovable)
### Paso 6 — Crear el producto en STRIPE (BETO/Daniel)
- En Stripe (la MISMA cuenta que usa Lovable): producto **Foundation US$297 pago ÚNICO**.
- **Metadata:** `tenant_slug: 'jesus'` (para que el webhook sepa de qué tenant es).
- El **acceso** ya funciona: un pago único cae a "1 mes de acceso". ✅

### Paso 7 — Arreglo del webhook para el INGRESO (CLAUDE)
- Hoy el pago ÚNICO no dispara `invoice.paid` → los $297 **no se registran en `tower_revenue`**.
- Claude agrega al webhook el registro del pago único. Cuando el producto esté en Stripe, se conecta + prueba.

---

## Resumen del reparto
| Paso | Quién | Dónde |
|---|---|---|
| 1. Generar secreto | Beto | local (no chat) |
| 2. Secreto en Vercel + redeploy | Beto | Vercel |
| 3. Mismo secreto en Lovable | Beto/Daniel | Lovable |
| 4. POST al terminar el quiz | Daniel | Lovable |
| 5. Verificar la fila | Claude | base |
| 6. Producto Foundation $297 | Beto/Daniel | Stripe |
| 7. Webhook registra el pago único | Claude | código |
