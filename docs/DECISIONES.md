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

- **Promedio de 5.47 goles.** Con los atributos actuales de los 54 equipos, la fórmula original sin cambios da **≈6.2 goles por partido** (≈5.9 en sede neutral). El 5.47 histórico salió de equipos con otros atributos. La prueba automática fija el valor real (5.9–6.5). Si se quiere volver a 5.47 basta con bajar `baseGoals` de 2.8 a ≈2.45 en la configuración del motor.
- Archivo del historial (171 ediciones): se importa con `scripts/import-legacy.ts` en cuanto se tenga el export de la app anterior.

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

### Valores iniciales de configuración
- Bono diario de créditos: 100. Margen de la casa: 6 %. Tope de apuesta de club: 10 % del presupuesto.
- Precio de entrada 45 USD; aforo genérico por nivel: 6 000 / 9 000 / 12 000 / 16 000.
- Premios por ronda (×peso de la competición): campeón 3 M, subcampeón 1.8 M, semifinal 1 M, cuartos 600 K, octavos 350 K, playoffs 200 K.
- Tope diario de gasto de IA: 1 USD (a confirmar).
- Probabilidades: 10 000 simulaciones; el servidor las reparte en varias pasadas para no exceder el límite de CPU de las Edge Functions.
- CENTENARIO: el contador incluye las 171 ediciones importadas, así que el primero sale al finalizar la edición 200.
