# 📋 Listing de Google Play — CoachAI Pro

> Textos listos para copiar-pegar en Play Console. Redactado 2026-07-10.
> App = PWA de coaching fitness con IA. Categoría: **Salud y fitness**.
> Idioma principal del listing: **Español (Latinoamérica / es-419)**.

---

## 1. Datos básicos

- **Nombre de la app (máx. 30):** `CoachAI Pro`
- **Categoría:** Salud y fitness
- **Etiquetas sugeridas:** entrenamiento, fitness, nutrición, coach personal, hábitos
- **Email de contacto (público):** support.coachaipro@gmail.com
- **Sitio web:** https://coachaipro.ai
- **Política de privacidad:** https://coachaipro.ai/privacidad.html

---

## 2. Descripción corta (máx. 80 caracteres)

```
Tu coach personal de fitness y nutrición, con planes a medida y seguimiento diario.
```
*(79 caracteres — verificar el contador de Play; si lo marca largo, usar la alternativa)*

**Alternativa (72):**
```
Coach de fitness y nutrición con planes a medida y seguimiento diario.
```

---

## 3. Descripción larga (máx. 4000 caracteres)

```
CoachAI Pro es tu compañero de entrenamiento y nutrición, diseñado para acompañarte todos los días hacia tus objetivos.

Trabajás con un plan hecho a tu medida: tu rutina de entrenamiento y tu plan de alimentación se arman según tu nivel, tus objetivos y tus preferencias. Nada de planes genéricos: la app se adapta a vos.

🏋️ TU RUTINA, PASO A PASO
Seguí tu entrenamiento del día con ejercicios, series, repeticiones y descansos claros. Registrá lo que hacés y mirá cómo progresás semana a semana.

🥗 TU ALIMENTACIÓN, SIN COMPLICARTE
Tu plan de comidas con objetivos diarios aproximados, pensado para tu ritmo de vida. Registrá tus comidas y mantené el foco sin obsesionarte con los números.

💬 UN COACH QUE TE RESPONDE
Chateá con tu coach cuando lo necesites: dudas sobre un ejercicio, un cambio en tu día, una comida fuera del plan. Recibí respuestas claras y motivación para seguir.

📈 SEGUIMIENTO QUE TE MOTIVA
Registro diario simple, cierre de cada semana con tu análisis de progreso, fotos de tu evolución y logros que celebran tu constancia. Tus rachas te ayudan a no perder el ritmo.

🔔 RECORDATORIOS QUE SUMAN
La app te acompaña con recordatorios en los momentos justos del día, para que el hábito se sostenga solo.

✨ PENSADA PARA QUE VUELVAS
Sin ruido, sin culpa. Una experiencia simple y clara que te hace fácil aparecer todos los días.

CoachAI Pro es la app que usan coaches y equipos para llevar a sus clientes. Si tu entrenador o gimnasio te invitó, ingresá con tu correo y vas a encontrar tu plan esperándote. ¿Todavía no tenés coach? Probá la app como invitado y viví la experiencia.

—

AVISO DE SALUD
CoachAI Pro es una herramienta de acompañamiento para fitness y bienestar general. NO es un dispositivo médico ni brinda asesoramiento médico, diagnóstico ni tratamiento. La información y los planes que ofrece tienen fines educativos e informativos. Antes de comenzar cualquier programa de ejercicio o alimentación, consultá con un médico o profesional de la salud, especialmente si tenés alguna condición preexistente, estás embarazada o tomás medicación. El uso de la app es bajo tu propia responsabilidad.
```

*(~1.900 caracteres — dentro del límite. El bloque AVISO DE SALUD es obligatorio para apps de fitness/nutrición; no lo saques.)*

---

## 4. App access — instrucciones para el revisor ⚠️ CRÍTICO

> Play Console → App content → **App access**. Elegir "All or some functionality is restricted".
> Pegar esto para que el revisor pueda entrar (el login es por código OTP y el revisor NO lo recibe):

**Instrucciones (pegar en el campo, en inglés — el revisor suele ser de habla inglesa):**
```
This app is used by fitness coaches to deliver personalized plans to their clients.
Regular users sign in with an email one-time code (OTP).

To review the full app WITHOUT needing an email code, please use Guest access:
1. Open the app (it launches on the coach directory / guest entry screen).
2. Tap "Ingresar como invitado" (Enter as guest).
3. This starts a 14-day free trial with a sample experience — no login required.

You will see the full app: personalized workout, nutrition plan, daily logging,
AI coach chat, weekly review and progress tracking.
```

---

## 5. Data safety (Seguridad de los datos) — respuestas sugeridas

> Play Console → App content → **Data safety**. ⚠️ Beto: confirmá cada punto contra la
> realidad actual de la app antes de enviar. Borrador basado en lo que sé del producto:

**¿La app recopila o comparte datos de usuario?** → Sí, recopila. **No** los vende ni los comparte con terceros para publicidad.

| Tipo de dato | ¿Se recopila? | ¿Requerido? | Propósito | Encriptado en tránsito | ¿Se puede borrar? |
|---|---|---|---|---|---|
| **Email** | Sí | Sí | Gestión de la cuenta / login | Sí | Sí (in-app) |
| **Nombre** | Sí | Sí | Personalización | Sí | Sí (in-app) |
| **Info de salud y fitness** (peso, medidas, objetivos, registros de dieta/entrenamiento) | Sí | Sí | Funcionalidad de la app | Sí | Sí (in-app) |
| **Fotos** (fotos de progreso, opcionales) | Sí | No | Funcionalidad de la app | Sí | Sí (in-app) |
| **Mensajes in-app** (chat con el coach/IA) | Sí | Sí | Funcionalidad de la app | Sí | Sí (in-app) |
| **ID de dispositivo / push token** | Sí | No | Notificaciones | Sí | Sí |

**Prácticas de seguridad a declarar (marcar):**
- ✅ Los datos están encriptados en tránsito (HTTPS).
- ✅ El usuario puede solicitar la eliminación de sus datos → **Perfil → "Eliminar mi cuenta"** (borra datos + fotos + cuenta de Auth). URL/método: in-app.
- ✅ Los datos NO se comparten con terceros para publicidad.
- ⚠️ Declarar el procesamiento por IA: el contenido del chat se procesa vía un proveedor de IA (Anthropic) para generar respuestas. (Confirmar si Play lo pide como "compartir con terceros" — como es un procesador bajo contrato, normalmente va como "processing", no "sharing". Beto: revisar la pregunta exacta.)

**URL de eliminación de datos (si Play la pide aparte):** la eliminación es in-app (Perfil → Eliminar mi cuenta). Si exige URL web, apuntar a la política de privacidad que lo explica.

---

## 6. Content rating (Clasificación de contenido)

> Play Console → App content → **Content rating** → cuestionario de IARC.
> Respuestas esperadas para CoachAI Pro (app de fitness, sin contenido sensible):

- Categoría de la app: **Utility / Productivity / Health** (NO juego).
- ¿Violencia? **No.** ¿Contenido sexual? **No.** ¿Lenguaje ofensivo? **No.**
- ¿Sustancias controladas? **No.** ¿Apuestas? **No.**
- ¿Interacción entre usuarios / chat? **Sí** (chat con coach/IA) — declararlo.
- ¿Comparte ubicación? **No.**
- Resultado esperado: **apto para todo público / PEGI 3 / ESRB Everyone** aprox.

---

## 7. Público objetivo (Target audience)

- **Grupo de edad:** 18 y más (app de fitness/nutrición para adultos).
- **No dirigida a niños** → evita la mayoría de los requisitos de Families.

---

## 8. Otros formularios de App content (checklist)

- [ ] **Privacy policy:** https://coachaipro.ai/privacidad.html
- [ ] **App access:** instrucciones de invitado (sección 4).
- [ ] **Ads:** la app **no** muestra anuncios → declarar "No".
- [ ] **Data safety:** sección 5.
- [ ] **Content rating:** sección 6.
- [ ] **Target audience:** 18+.
- [ ] **Government app:** No.
- [ ] **Financial features:** No (el pago es externo / diferido; v1 no vende in-app).
- [ ] **Health apps declaration:** si Play muestra la declaración de apps de salud, marcar que es de bienestar general, no médica (concuerda con el disclaimer).

---

## 9. Assets gráficos (los hace Juli)

- **Ícono de la tienda:** 512×512 PNG (32-bit, con alpha).
- **Feature graphic:** 1024×500 PNG/JPG (obligatorio).
- **Screenshots de teléfono:** mín. 2, hasta 8. Ratio 16:9 o 9:16, lado min 320px, max 3840px.
  - Sugerencia de qué mostrar: (1) Home con rutina del día, (2) plan de alimentación,
    (3) chat con el coach, (4) cierre semanal / progreso, (5) logros/medallas.
- *(Opcional)* screenshots de tablet 7" y 10" si se quiere aparecer bien en tablets.

---

## Notas / pendientes honestos

- ⚠️ **Data safety**: es un borrador — Beto confirma cada fila contra la app real antes de enviar. Declarar de menos = riesgo de suspensión; declarar de más = fricción. Vale 10 min de repaso.
- ⚠️ **Términos de servicio**: si Play los pide (a veces con suscripciones), avisá y los armo. Para v1 access-only (sin venta in-app) puede no ser bloqueante.
- El texto está en español LatAm. Si más adelante se escala pauta a otros mercados, conviene una versión EN del listing.
