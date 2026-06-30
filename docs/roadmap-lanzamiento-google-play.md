# 🗺️ Roadmap — de acá a la app en Google Play

Dónde estás hoy (30/06): **cuenta de organización CREADA** ✅ (CoachAI Pro, ID 481487...).
DUNS ✅, sitio web verificado ✅. Falta que Google **verifique tu identidad** (revisando
los docs, ~días) → después teléfonos → después publicar.

**Reparto:** lo que dice **(BETO)** lo hacés vos en Play/PWABuilder; lo que dice **(CLAUDE)**
lo hago yo (textos, parte técnica web). Yo te guío en cada paso.

---

## FASE A — Esperar la verificación de Google (pasivo, ~días)
- **Qué:** Google revisa los documentos de identidad/empresa que subieron.
- **Dónde:** no hay que tocar nada. Llega un **mail a `support.coachaipro@gmail.com`** cuando termine.
- **Por qué:** hasta que no te verifiquen, no podés publicar.
- **Cuando llegue el mail:** se **desbloquea la verificación de teléfonos** → entrás a Play
  Console → "Verifica tus números de teléfono" → seguís las indicaciones (te mandan un código). **(BETO)**

## FASE B — Generar la app Android (el `.aab`) — SE PUEDE HACER YA, en paralelo
*(No necesita la verificación completa. Podés adelantarlo mientras Google revisa.)*
- **Qué:** convertir la web (PWA) en un archivo Android (`.aab`) — la app es la misma web
  adentro de un cascarón Android (TWA).
- **Dónde:** **pwabuilder.com** **(BETO)**.
- **Cómo:** pegás `https://coachaipro.ai` → "Package for stores → Android" →
  - **Package ID:** `ai.coachaipro.app` (⚠️ permanente, no se cambia después).
  - **Signing key:** "Create new" → ⚠️⚠️ **GUARDÁ la llave + contraseñas en un lugar seguro**
    (si la perdés, no podés actualizar la app nunca).
  - Bajás el **`.aab`**.
- **Por qué:** el `.aab` es el archivo que subís a Play.
- **Guía detallada:** `docs/wrapper-android-pwabuilder.md`.

## FASE C — Armar la app en Play Console (cargar todo el "listing")
- **Qué:** crear la app + cargar lo que ve la gente + los formularios que Google exige.
- **Dónde:** Play Console → "Crear app".
- **Qué cargás (BETO carga, CLAUDE te pasa los textos):**
  - **Nombre:** CoachAI Pro · **Categoría:** Salud y fitness.
  - **Descripción** (corta + larga) → **te la redacto yo (CLAUDE)** con el disclaimer de salud.
  - **Screenshots + ícono 512 + feature graphic 1024×500** → los hace **Juli** (ya tiene el brief).
  - **Data safety** (declarar: email, fotos, datos de salud) → **te armo las respuestas (CLAUDE)**.
  - **Content rating** (cuestionario) · **Público objetivo**.
  - **Acceso para el revisor (App access):** ⚠️ clave → poné que use **"Ingresar como invitado"**
    (el login es por código, el revisor no lo recibe; con invitado entra y revisa todo).
  - **Privacy policy URL:** `coachaipro.ai/privacidad.html` (ya está).
- **Por qué:** Google necesita todo esto para revisar + mostrar la app en la tienda.

## FASE D — Subir el `.aab` + el assetlinks
- **Qué:** subir el `.aab` a **Producción** + activar **Play App Signing**.
- **Dónde:** Play Console → Producción **(BETO)**. (La cuenta de organización **NO** necesita el
  test de 12 testers → vas directo a producción.)
- **Después:** sacás el **SHA-256** de Play Console → Setup → App signing → **me lo pasás** →
  yo lo pongo en `assetlinks.json` + redeploy **(CLAUDE)**.
- **Por qué:** el assetlinks hace que la app abra **sin la barra de URL** (más nativa).

## FASE E — Enviar a revisión → LIVE 🚀
- **Qué:** enviar la app a revisión.
- **Dónde:** Play Console **(BETO)**.
- **Por qué:** Google revisa (~7 días o menos) → la app **va live en Google Play**.

## FASE F — iOS (después, aparte)
- Mismo PWABuilder → "iOS" genera un proyecto, pero **compilar necesita una Mac** (la de Jesús).
- Lo encaramos cuando Android esté resuelto.

---

## ✅ Tu próxima acción cuando retomes (en orden)
1. **Pasivo:** esperar el mail de verificación de identidad → ahí hacés los **teléfonos** (Fase A).
2. **Activo (en paralelo, no esperes):** correr **PWABuilder** para tener el **`.aab`** listo (Fase B),
   y pedirme **el texto del listing + las respuestas de Data safety** (Fase C) así llegás con todo armado.
3. Cuando se verifique todo → subís el `.aab`, me pasás el **SHA-256**, y **enviamos a revisión**.

**En una línea:** Google te verifica (días) → mientras, generás el `.aab` + armamos el listing →
subís + me das el fingerprint → enviar a revisión → live. **Lo difícil ya está hecho.** 💪
