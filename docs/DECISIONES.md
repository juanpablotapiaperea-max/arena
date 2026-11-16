# Decisiones y supuestos (sección 19)

Registro de lo que la especificación no definía o donde chocaba con otra cosa. Cada valor es editable salvo que se indique.

## Confirmadas por el dueño de la app

| Tema | Decisión |
|---|---|
| Ventaja de local | 1.1 en liga y en playoffs normales; 1.0 solo en sedes neutrales (finales a partido único). Diferente a la app anterior, que usaba 1.0 en todos los playoffs. |
| Modo de simulación por defecto | Realista (ruido ×0.4), aleatoriedad 30. |
| Repositorio | `arena`, nuevo. El repo de Base44 solo se usó para leer la fórmula original. |
| Construcción | Se construyen las 5 fases de corrido, sin pausas de aprobación entre fases. |

## Pendientes de confirmar

- **Promedio de 5.47 goles.** Con los atributos actuales de los 54 equipos, la fórmula original sin cambios da **≈6.2 goles por partido** (≈5.9 en sede neutral). El export de la app anterior lo confirma: las OHL recientes de 54 equipos promediaron 6.20 (17,946 goles en 2,893 partidos), y el 5.47 sale de mezclar ligas antiguas con equipos más débiles (por ejemplo, 4.5 en OHL de 40 equipos). La prueba automática fija el valor real (5.9–6.5). Si se quiere volver a 5.47 basta con bajar `baseGoals` de 2.8 a ≈2.45.

## Historial importado
- 171 ediciones desde el export de la app anterior (`data/legacy/historial-base44.md`); 40 traen el top 3 de su tabla.
- Los títulos y subcampeonatos por equipo cuadran exactamente con la sección 17 (prueba automática).
- Las competiciones que ya no existen (LAB CUP, TECATE, FSLH, 32PLAYS, Especial 151, THEBIG10, Liga del siglo, etc.) solo quedan en el historial.

## Supuestos tomados

### Motor
- Tiempo extra activado por defecto en todas las competiciones (como en la app anterior): gol de oro para el ganador, puntos 2 y 1.
- El sesgo secreto multiplica los goles esperados *después* del tope 0.2–8 y se vuelve a topar. Nunca entra en `expected` (cuotas, probabilidades).
- Tiros: `goles + Poisson(26 · (λ/2.9)^0.4 · estilos − goles)`, mínimo goles + 3.
- Penalizaciones: Poisson(3 × estilo) por equipo. Un gol es de power play si cae en los 2 minutos (escalados) posteriores a una penalización rival.
- Más/menos: no cuenta en power play; suman la línea y pareja del autor y restan una línea y pareja rivales elegidas por peso.
- Asistencias: primera con 90 %, segunda con 65 %.
- MVP: goles×3 + asistencias×2 + gol ganador + más/menos×0.25 (+1.5 si ganó). Porteros: (porcentaje de atajadas − 0.88)×40, +4 por blanqueada.
- Los defensas anotan con un cuarto del peso de un delantero de la misma línea.
- Periodos de reproducción de 5 minutos; tiempo extra de 2 minutos.
- Contraataque: pesos de goles por periodo 0.85 / 0.95 / 1.30.

### Plantillas
- 20 jugadores = 2 porteros + 6 defensas + 12 delanteros, y la alineación usa 1 + 6 + 12. Por lo tanto **el único suplente es el segundo portero**, que queda 8–15 puntos abajo. Los "suplentes 8–15 abajo" de la sección 6 solo aplican a él.
- Forma y moral inicial en 50 (neutras), para que el rating inicial reproduzca exactamente la sección 17.
- Salario: 150 K + 1.7 M × ((atributo − 55)/45)³, ×0.6 si es menor de 22, ×0.85 si es mayor de 32. Resultado: entre 10 y 22 M por club (media 17 M).
- Potencial: atributo + (26 − edad) × 0.5–2 + 0–2, tope 100.
- Estrategia de IA asignada al azar (determinista) entre las 5.
- Colores generados con el ángulo áureo; el administrador los edita.

### Datos y seguridad
- Tablas y columnas en inglés (`snake_case`); toda la interfaz en español.
- Espectadores y dueños entran con nombre y código: el nombre se convierte en un correo sintético `nombre@usuarios.arena.app` y el código es la contraseña de Supabase Auth, que se guarda con hash. Códigos de 8 caracteres.
- Administrador: correo, contraseña y app autenticadora (TOTP de Supabase). `is_admin()` exige `aal2`. Se puede desactivar con el ajuste `admin_require_mfa` solo para pruebas.
- La semilla y el sesgo aplicado de cada partido viven en `match_secrets` (solo administrador): con la semilla pública alguien podría recalcular el partido y descubrir un sesgo.
- Durante un evento en vivo la línea de tiempo no es legible directamente; la función `live_timeline()` entrega solo las jugadas ya ocurridas según el reloj del servidor.
- Presupuesto y estrategia de IA en `team_private` (administrador y dueño de ese club).
- Tablas añadidas a las 25 de la sección 16: `team_private`, `edition_teams`, `match_secrets`, `odds_offers`, `bet_leagues`, `bet_league_members`, `achievements`, `notifications`, `owner_wishlist`, `classics`, `admin_ranking_adjustments`, `ai_usage`.
- Los atributos del equipo se recalculan con un trigger de base de datos cada vez que cambia un jugador.

### Proyecto de Supabase
- Proyecto `mtcitbfyizdlllfvoxka` (us-east-1). Instalado por la Management API: esquema, seed, historial y la función `admin-users`.
- Registro público desactivado (`disable_signup`): solo el administrador crea cuentas, desde la función `admin-users`.
- La clave pública es del formato nuevo `sb_publishable_…` (equivale a la anon key) y va en `VITE_SUPABASE_ANON_KEY`.

### Valores iniciales de configuración
- Bono diario de créditos: 100. Margen de la casa: 6 %. Tope de apuesta de club: 10 % del presupuesto.
- Precio de entrada 45 USD; aforo genérico por nivel: 6 000 / 9 000 / 12 000 / 16 000.
- Premios por ronda (×peso de la competición): campeón 3 M, subcampeón 1.8 M, semifinal 1 M, cuartos 600 K, octavos 350 K, playoffs 200 K.
- Tope diario de gasto de IA: 1 USD (a confirmar).
- Probabilidades: 10 000 simulaciones; el servidor las reparte en varias pasadas para no exceder el límite de CPU de las Edge Functions.
- CENTENARIO: el contador incluye las 171 ediciones importadas, así que el primero sale al finalizar la edición 200.

## Fases 2 a 4: calendario, días de competencia, mercado y pulido

### Planificador y días de competencia
- El generador reparte las unidades (jornadas y rondas) de todas las ediciones activas en días, respetando el máximo de partidos por día; el admin después arrastra bloques entre días, une o borra días y agrega unidades sueltas. Los avisos (día demasiado cargado, rondas fuera de orden) se muestran sin bloquear.
- **Ráfagas:** el tamaño de cada ráfaga se calcula para que todos los partidos del día quepan en la ventana horaria. La última ráfaga de un bloque toma todo lo que quede.
- **Eventos en vivo:** se detectan clásicos con una puntuación de 0 a 100 (rivalidad marcada, cercanía en ranking, finales). Si ninguno califica, salen en vivo los mejores clásicos del día, **mínimo 3** y máximo 24 por día. Solo hay un vivo a la vez; los vivos de una ronda empiezan después de las ráfagas de las que dependen, las finales van al final y un resumen cierra el día.
- Prueba de carga real (OHL + Primera + Segunda, 359 partidos): el día dura ≈357 min con 3 vivos y cada tick tarda ≈1.8 s (p50).
- El marcador de un vivo nunca se adelanta: la línea de tiempo solo se lee con `live_timeline`, que entrega los eventos ya ocurridos según el reloj del servidor.

### Apuestas
- Cuotas exactas con Poisson y margen de la casa; mercados de largo plazo (campeón, playoffs, descenso) con Monte Carlo (presupuesto de 300 mil simulaciones por cálculo).
- Los sesgos secretos del admin nunca entran en las cuotas ni en los goles esperados.
- El bono diario y el cobro de apuestas pasan por funciones de servidor que activan la bandera `arena.trusted`; sin ella, un usuario no puede modificar sus propios créditos.
- Ligas privadas entre amigos con código de invitación de 6 caracteres; la tabla ordena por ganancia neta. Logros calculados a partir del historial de boletas.

### Mercado, draft y cierre
- Valor de jugador por rating, edad, potencial y contrato; el vendedor pide más y el comprador ofrece menos, con hasta 3 rondas de negociación.
- Los intercambios mantienen siempre la plantilla en 2 porteros, 6 defensas y 12 delanteros. Las dos mitades de un intercambio se guardan juntas o ninguna; al cerrar la ventana y al terminar el draft se recortan o completan las plantillas.
- Draft por orden inverso del ranking; el dueño elige su turno o el sistema elige por él al vencer el tiempo.
- El cierre de temporada muestra una vista previa (ascensos, descensos, puntos de ranking, retiros) antes de aplicarse.

### Prensa
- Las notas se escriben con Claude (modelo `claude-opus-5-5`) si existe el secreto `ANTHROPIC_API_KEY` en las funciones de Supabase. **Hoy no está configurado**, así que se usan plantillas en español; al agregar la clave cambia solo, sin tocar código.
- Las jornadas que tuvieron vivos no generan una nota de jornada aparte (ya tienen su crónica).

### Estadios
- Apagados por defecto (`stadiums_enabled = false`). El admin los ve y edita siempre; los espectadores solo cuando se encienden. La ventaja de local extra del estadio es pequeña y editable.

### Accesibilidad
- Tamaño de texto, alto contraste, movimiento reducido, fuente de alta legibilidad (Atkinson Hyperlegible), paleta segura para daltonismo, enlaces subrayados, anuncios para lector de pantalla, sonidos y vibración. Cada persona elige en su perfil o con el botón ♿; respeta también las preferencias del sistema.
