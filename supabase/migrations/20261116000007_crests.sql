-- Logos oficiales de los equipos (archivos en public/crests). Se agregan por tandas.
-- Solo pone el logo si el admin no subió otro a mano.
update teams set crest_url = '/crests/' || key || '.webp'
where key in ('kings', 'ice-dragons', 'teletes', 'imalayas-hc', 'ice-breakers', 'the-lightnings', 'ducks', 'aletico-metropolitano', 'horizon', 'boing', 'black-horses', 'falcons', 'penguins', 'rhinos', 'dolphins',
  'foxes', 'panthers', 'berserkers', 'wolves', 'titans', 'vikings', 'toros', 'angels', 'aztecz', 'raptors', 'cuervos', 'axolotls', 'owls', 'demons', 'bears',
  'krakens', 'scorpions', 'spartans', 'coyotes', 'phantoms', 'pirates', 'perry-the-platypus', 'only', 'zuricatas', 'ronins', 'griffins', 'knights',
  'huskys', 'whales', 'cobras', 'sharks', 'salamaders', 'mamuts', 'tigers', 'united', 'hex-clankers', 'yetis', 'wyvers', 'salmons')
  and (crest_url is null or crest_url like '/crests/%');
