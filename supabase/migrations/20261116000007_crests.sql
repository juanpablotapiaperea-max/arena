-- Logos oficiales de los equipos (archivos en public/crests). Se agregan por tandas.
-- Solo pone el logo si el admin no subió otro a mano.
update teams set crest_url = '/crests/' || key || '.webp'
where key in ('kings', 'ice-dragons', 'teletes', 'imalayas-hc', 'ice-breakers', 'the-lightnings', 'ducks', 'aletico-metropolitano', 'horizon', 'boing', 'black-horses', 'falcons', 'penguins', 'rhinos', 'dolphins')
  and (crest_url is null or crest_url like '/crests/%');
