// Chismes de la liga: notas ficticias de la vida privada y deportiva de los
// jugadores y los equipos (todos inventados). Nunca hablan de los usuarios.

export interface GossipPlayer {
  id: string;
  name: string; // "Nombre Apellido"
  position: 'G' | 'D' | 'F';
  number: number;
  age: number;
  rating: number;
  teamId: string;
  teamName: string;
}

export interface GossipTeam {
  id: string;
  name: string;
}

export interface GossipContext {
  player: GossipPlayer;
  other: GossipPlayer; // otro jugador (de otro equipo casi siempre)
  mate: GossipPlayer; // compañero del mismo equipo
  rival: GossipTeam; // equipo rival
}

export interface Gossip {
  category: string;
  title: string;
  body: string;
  teamId: string;
  playerId: string;
}

type Rng = () => number;
const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length) % xs.length];

const POS: Record<GossipPlayer['position'], string> = { G: 'portero', D: 'defensa', F: 'delantero' };
const first = (p: GossipPlayer) => p.name.split(' ')[0];
const last = (p: GossipPlayer) => p.name.split(' ').slice(1).join(' ') || p.name;

const SOURCES = [
  'Fuentes cercanas al vestidor',
  'Personas que pidieron no ser nombradas',
  'Testigos en el lugar',
  'Dos utileros con muy buena memoria',
  'Amigos muy cercanos a la familia',
  'Meseros que lo vieron todo',
  'Vecinos del fraccionamiento',
  'Varias cuentas anónimas de chismes de la liga',
];

const CLOSERS = [
  'Hasta ahora, nadie del club ha querido confirmar ni desmentir.',
  'El jugador no respondió a nuestros mensajes, pero sí los dejó en visto.',
  'En el club piden respeto y "concentración en lo deportivo".',
  'La afición ya armó su propia teoría en el chat del partido.',
  'Seguiremos atentos: en ARENA nada se queda en secreto mucho tiempo.',
  'Su representante dijo que "todo es un malentendido". Lo mismo dijo la última vez.',
];

const PLACES = ['una taquería de madrugada', 'un antro de moda', 'un restaurante de mariscos', 'la boda de un excompañero', 'un concierto de reguetón', 'una feria de pueblo', 'un karaoke', 'el aeropuerto', 'un partido de pádel', 'una cafetería hípster'];
const PETS = ['un perro salchicha', 'un gato persa', 'una iguana', 'un loro que dice groserías', 'dos cabritos', 'un pez beta llamado Campeón'];
const CARS = ['un auto deportivo amarillo', 'una camioneta blindada', 'una moto de colección', 'un vocho restaurado', 'un carrito de golf personalizado'];
const HOBBIES = ['clases de salsa', 'la cerámica', 'cocinar pozole', 'el ajedrez en línea', 'la jardinería', 'los rompecabezas de 5,000 piezas', 'la astrología', 'tejer bufandas'];
const SUPERSTITIONS = ['usa los mismos calcetines desde hace tres temporadas', 'toca 14 veces el poste antes de cada periodo', 'solo come chilaquiles verdes el día de partido', 'no deja que nadie toque su stick', 'entra a la pista siempre con el pie izquierdo', 'escucha la misma canción de banda antes de cada juego'];

type Template = (rng: Rng, c: GossipContext) => Omit<Gossip, 'teamId' | 'playerId'>;

const T: Template[] = [
  // ── Corazón
  (r, { player: p, other: o }) => ({
    category: 'Corazón',
    title: `¿Romance a la vista? Captan a ${p.name} muy sonriente en ${pick(r, PLACES)}`,
    body: `${pick(r, SOURCES)} aseguran que el ${POS[p.position]} de ${p.teamName} no llegó solo: iba con una persona que, dicen, también estaba en la fiesta de cumpleaños de ${o.name} (${o.teamName}).\n\n"Se veían muy cómplices, compartieron postre y todo", contó un testigo. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Corazón',
    title: `Se acabó el amor: ${p.name} habría terminado su relación de tres años`,
    body: `El número ${p.number} de ${p.teamName} ya no aparece en las fotos de su ahora expareja, y ambos dejaron de seguirse en redes. ${pick(r, SOURCES)} dicen que la ruptura fue "tranquila, pero con lágrimas".\n\nCompañeros de equipo cuentan que llegó al entrenamiento con lentes oscuros y sin hablar con nadie. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p, other: o }) => ({
    category: 'Corazón',
    title: `Triángulo amoroso entre ${p.teamName} y ${o.teamName}`,
    body: `Dicen que ${p.name} y ${o.name} no se saludaron en el último cruce por "un tema personal" que nada tiene que ver con el hockey. ${pick(r, SOURCES)} hablan de una misma persona que estuvo saliendo con ambos.\n\nEl próximo duelo entre sus equipos promete mucho más que puntos. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Corazón',
    title: `¡Campanas de boda! ${p.name} pidió matrimonio en plena pista`,
    body: `Al terminar el entrenamiento, el ${POS[p.position]} de ${p.teamName} se arrodilló en el círculo central con un anillo escondido en el guante. La respuesta fue un sí entre aplausos del cuerpo técnico.\n\nYa se habla de que la mitad del plantel será padrino. ${pick(r, CLOSERS)}`,
  }),
  // ── Vestidor
  (r, { player: p, mate: m }) => ({
    category: 'Vestidor',
    title: `Pleito en el vestidor de ${p.teamName}: ${last(p)} y ${last(m)} ya no se hablan`,
    body: `Todo empezó, dicen, por un pase que nunca llegó y terminó con una discusión a gritos en las regaderas. ${pick(r, SOURCES)} aseguran que el entrenador tuvo que separarlos.\n\n${first(m)} ya pidió cambiar de lugar en el autobús. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Vestidor',
    title: `${p.name} y su manía: ${pick(r, SUPERSTITIONS)}`,
    body: `En ${p.teamName} ya nadie se sorprende, pero los nuevos no lo podían creer. El número ${p.number} ${pick(r, SUPERSTITIONS)} y jura que por eso le va bien.\n\n"Si le mueves algo, se pone de malas todo el día", cuenta un compañero. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p, mate: m }) => ({
    category: 'Vestidor',
    title: `¿Quién es el bromista de ${p.teamName}? Todos señalan a ${p.name}`,
    body: `Le llenó el casco de confeti a ${m.name} y le cambió el tono de alarma del celular por el himno del rival. ${pick(r, SOURCES)} dicen que ya hay un plan de venganza en marcha.\n\nEl cuerpo técnico se ríe… por ahora. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Vestidor',
    title: `Multa interna para ${p.name} por llegar tarde… otra vez`,
    body: `El ${POS[p.position]} de ${p.teamName} habría llegado 40 minutos tarde a la junta de video por, según él, "un tráfico imposible". El problema: lo etiquetaron en una foto desayunando hotcakes a esa misma hora.\n\nLa multa irá al fondo para la cena de fin de temporada. ${pick(r, CLOSERS)}`,
  }),
  // ── Fiesta
  (r, { player: p, other: o }) => ({
    category: 'Fiesta',
    title: `Noche larga: ${p.name} y ${o.name} cerraron ${pick(r, PLACES)}`,
    body: `A pesar de que sus equipos son rivales, el número ${p.number} de ${p.teamName} y el de ${o.teamName} cantaron juntos hasta las 4 de la mañana. ${pick(r, SOURCES)} juran que pidieron "Payaso de rodeo" seis veces.\n\nEl entrenador de ${p.teamName} no estaría nada contento. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Fiesta',
    title: `Fiesta sorpresa sale mal: ${p.name} se enteró una hora antes`,
    body: `Sus compañeros de ${p.teamName} le prepararon una fiesta por su cumpleaños ${p.age}, pero alguien mandó la invitación al grupo equivocado… donde estaba el festejado.\n\nIgual fingió sorpresa "con mucha dignidad", cuenta un testigo. ${pick(r, CLOSERS)}`,
  }),
  // ── Redes
  (r, { player: p, rival }) => ({
    category: 'Redes',
    title: `${p.name} borra una publicación contra ${rival.name}… pero ya había captura`,
    body: `Duró 12 minutos en línea: una foto con la frase "a ver si ahora sí" dirigida a ${rival.name}. Para cuando la borró, la captura ya circulaba en todos los chats de la liga.\n\nEn ${rival.name} dicen que ya la imprimieron para el vestidor. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Redes',
    title: `Lluvia de memes: ${p.name} se vuelve tendencia por su nuevo corte de pelo`,
    body: `El número ${p.number} de ${p.teamName} estrenó un look que la afición comparó con "un cepillo de dientes eléctrico". Él respondió con un video bailando y ganó 10 mil seguidores en un día.\n\n${pick(r, SOURCES)} dicen que el estilista ya recibió llamadas de otros tres jugadores. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p, other: o }) => ({
    category: 'Redes',
    title: `Indirectas en redes entre ${p.name} y ${o.name}`,
    body: `Uno publicó "hay quien juega por el escudo y hay quien juega por la foto". Minutos después, el otro subió una foto… muy sonriente, sin texto. La afición de ${p.teamName} y ${o.teamName} ya tomó partido.\n\n${pick(r, CLOSERS)}`,
  }),
  // ── Mercado
  (r, { player: p, rival }) => ({
    category: 'Mercado',
    title: `¿Se va? Ven a ${p.name} comiendo con directivos de ${rival.name}`,
    body: `${pick(r, SOURCES)} aseguran que el ${POS[p.position]} de ${p.teamName} pasó dos horas en una mesa privada con gente de ${rival.name}. Él dice que "solo eran amigos de la infancia".\n\nSu contrato y su media de ${p.rating} lo vuelven pieza codiciada. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Mercado',
    title: `${p.name} quiere aumento: "o me pagan como estrella o me voy"`,
    body: `Eso es lo que, según ${pick(r, SOURCES).toLowerCase()}, le dijo el número ${p.number} a la directiva de ${p.teamName}. Con ${p.age} años, siente que es su momento.\n\nLa directiva respondió con una pizza para todo el plantel y ninguna respuesta. ${pick(r, CLOSERS)}`,
  }),
  // ── Lujo
  (r, { player: p }) => ({
    category: 'Lujo',
    title: `${p.name} estrena ${pick(r, CARS)} y la afición explota`,
    body: `Llegó al entrenamiento de ${p.teamName} manejando su nueva adquisición y estacionándose en dos lugares. Sus compañeros le dejaron una nota en el parabrisas: "Ahora sí invita las cenas".\n\n${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Lujo',
    title: `La nueva mansión de ${p.name} tiene pista de hielo privada`,
    body: `El ${POS[p.position]} de ${p.teamName} mostró en video su nueva casa: alberca, cine y una mini pista de hielo en el jardín. "Para entrenar en vacaciones", explicó.\n\n${pick(r, SOURCES)} dicen que nunca la ha usado. ${pick(r, CLOSERS)}`,
  }),
  // ── Manías y aficiones
  (r, { player: p }) => {
    const h = pick(r, HOBBIES);
    return {
      category: 'Vida privada',
      title: `El lado desconocido de ${p.name}: ahora es fan de ${h}`,
      body: `Fuera de la pista, el número ${p.number} de ${p.teamName} dedica sus tardes a ${h}. Ya le regaló sus creaciones a medio vestidor.\n\n"Dice que le baja la ansiedad antes de los partidos", cuenta un compañero. ${pick(r, CLOSERS)}`,
    };
  },
  (r, { player: p }) => ({
    category: 'Vida privada',
    title: `${p.name} adopta ${pick(r, PETS)} y ya es la mascota del equipo`,
    body: `La nueva mascota de ${p.name} ya visitó el vestidor de ${p.teamName} y, según cuentan, se comió la mitad de la botana del cuerpo técnico.\n\nLa afición pide que salga a la pista en el próximo juego de local. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p, mate: m }) => ({
    category: 'Vida privada',
    title: `${p.name} y ${m.name}, ahora socios: abren un puesto de tacos`,
    body: `Los compañeros de ${p.teamName} invirtieron sus ahorros en una taquería que abre solo después de los partidos. El nombre: "El Gol de Oro".\n\n${pick(r, SOURCES)} dicen que el pastor está bueno pero la salsa "pica más que una derrota en casa". ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Vida privada',
    title: `¡Será papá! ${p.name} anuncia que viene un bebé en camino`,
    body: `El ${POS[p.position]} de ${p.teamName} lo anunció con una foto de unos patines diminutos. Ya prometió que si es niño se llamará como su ídolo, y si es niña… también.\n\nEl vestidor ya organiza el baby shower con temática de hockey. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Vida privada',
    title: `${p.name} habría participado en un reality show de cocina`,
    body: `${pick(r, SOURCES)} aseguran que el número ${p.number} de ${p.teamName} grabó un episodio a escondidas y quedó eliminado en el primer reto por quemar el arroz.\n\nÉl lo niega todo, pero ya hay un clip borroso circulando. ${pick(r, CLOSERS)}`,
  }),
  // ── Directiva
  (r, { player: p, rival }) => ({
    category: 'Directiva',
    title: `Tensión en ${p.teamName}: el entrenador estaría en la cuerda floja`,
    body: `Tras los últimos resultados, la directiva de ${p.teamName} habría pedido "resultados inmediatos". ${pick(r, SOURCES)} dicen que el próximo partido, ante ${rival.name}, podría ser decisivo.\n\nEn el vestidor cierran filas: "Estamos con el profe", dijo ${p.name}. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p }) => ({
    category: 'Directiva',
    title: `Nuevo uniforme de ${p.teamName} divide a la afición`,
    body: `Se filtró el diseño del uniforme alternativo y nadie se pone de acuerdo: unos lo llaman "histórico", otros "un mantel de fonda". ${p.name} ya posó con él y dijo que le encanta.\n\n${pick(r, CLOSERS)}`,
  }),
  (r, { player: p, other: o }) => ({
    category: 'Rivalidad',
    title: `Apuesta entre amigos: ${p.name} y ${o.name} se juegan raparse`,
    body: `Antes del próximo duelo entre ${p.teamName} y ${o.teamName}, los dos acordaron que el que pierda se rapa en transmisión en vivo. ${pick(r, SOURCES)} dicen que ya compraron la máquina.\n\nLa afición ya armó una quiniela aparte. ${pick(r, CLOSERS)}`,
  }),
  (r, { player: p, rival }) => ({
    category: 'Rivalidad',
    title: `"No les tengo miedo": ${p.name} calienta el duelo ante ${rival.name}`,
    body: `En una entrevista de pasillo, el ${POS[p.position]} de ${p.teamName} soltó que ${rival.name} "está sobrevalorado" y que piensa "dejar su firma en el marcador".\n\nEn ${rival.name} ya pegaron la frase en el pizarrón del vestidor. ${pick(r, CLOSERS)}`,
  }),
];

/** Genera un chisme a partir de jugadores y equipos ficticios. */
export function generateGossip(rng: Rng, c: GossipContext): Gossip {
  const t = pick(rng, T);
  const g = t(rng, c);
  return { ...g, teamId: c.player.teamId, playerId: c.player.id };
}

export const GOSSIP_TEMPLATE_COUNT = T.length;
