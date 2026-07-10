"use strict";
/* Gerador de nomes de jogadores por nacionalidade (para completar elencos e juniores). */
(function () {
  const POOLS = {
    BRA: {
      first: ["Gabriel", "Lucas", "Matheus", "João", "Pedro", "Rafael", "Bruno", "Felipe", "Gustavo", "Vinícius", "Thiago", "Caio", "Diego", "Eduardo", "Renan", "Igor", "Wesley", "Douglas", "Marcos", "André", "Luan", "Everton", "Alex", "Carlos", "Kaique", "Yago", "Ryan", "Kauã", "Davi", "Ramon", "Wallace", "Jean", "Fabrício", "Emerson", "Vitor", "Danilo", "Robson", "Maicon", "Élton", "Nathan"],
      last: ["Silva", "Santos", "Oliveira", "Souza", "Costa", "Pereira", "Almeida", "Ferreira", "Rodrigues", "Gomes", "Martins", "Araújo", "Ribeiro", "Barbosa", "Cardoso", "Nascimento", "Lima", "Moura", "Cavalcanti", "Teixeira", "Correia", "Farias", "Rocha", "Dias", "Monteiro", "Mendes", "Freitas", "Barros", "Pinto", "Carvalho", "Machado", "Ramos", "Nogueira", "Moraes", "Azevedo", "Batista"]
    },
    ENG: {
      first: ["Jack", "Harry", "Oliver", "George", "Charlie", "Thomas", "James", "William", "Joe", "Callum", "Lewis", "Kyle", "Aaron", "Ben", "Daniel", "Sam", "Luke", "Jordan", "Connor", "Ryan", "Nathan", "Liam", "Mason", "Ethan", "Alfie", "Archie", "Jamie", "Reece", "Dominic", "Marcus"],
      last: ["Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson", "Johnson", "Davies", "Robinson", "Wright", "Thompson", "Evans", "Walker", "White", "Roberts", "Green", "Hall", "Wood", "Jackson", "Clarke", "Harrison", "Bennett", "Shaw", "Palmer", "Mills", "Barnes", "Fletcher", "Gibson", "Hart", "Dawson"]
    },
    ESP: {
      first: ["Álvaro", "Sergio", "David", "Javier", "Daniel", "Pablo", "Adrián", "Diego", "Iker", "Carlos", "Rubén", "Mario", "Jorge", "Raúl", "Víctor", "Iván", "Óscar", "Marcos", "Hugo", "Gonzalo", "Unai", "Mikel", "Ander", "Pau", "Joan", "Alejandro", "Fernando", "Isco", "Nico", "Dani"],
      last: ["García", "Fernández", "González", "Rodríguez", "López", "Martínez", "Sánchez", "Pérez", "Gómez", "Martín", "Jiménez", "Ruiz", "Hernández", "Díaz", "Moreno", "Álvarez", "Romero", "Navarro", "Torres", "Domínguez", "Vázquez", "Ramos", "Gil", "Serrano", "Molina", "Castro", "Ortega", "Rubio", "Marín", "Iglesias"]
    },
    ITA: {
      first: ["Alessandro", "Andrea", "Marco", "Francesco", "Matteo", "Lorenzo", "Davide", "Simone", "Federico", "Riccardo", "Luca", "Giovanni", "Gabriele", "Antonio", "Nicola", "Stefano", "Giuseppe", "Emanuele", "Filippo", "Tommaso", "Pietro", "Salvatore", "Mattia", "Cristian", "Samuele", "Enrico", "Dario", "Fabio", "Michele", "Paolo"],
      last: ["Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci", "Marino", "Greco", "Bruno", "Gallo", "Conti", "De Luca", "Mancini", "Costa", "Giordano", "Rizzo", "Lombardi", "Moretti", "Barbieri", "Fontana", "Santoro", "Mariani", "Rinaldi", "Caruso", "Ferrara", "Galli", "Martini", "Leone"]
    },
    POR: {
      first: ["João", "Diogo", "Tiago", "Gonçalo", "Rúben", "Francisco", "André", "Pedro", "Miguel", "Rafael", "Bernardo", "Tomás", "Duarte", "Afonso", "Vasco", "Nuno", "Ricardo", "Bruno", "Fábio", "Hélder", "Renato", "Sérgio", "Paulo", "Vítor", "Domingos", "Martim", "Gil", "Edgar", "Ivo", "Leandro"],
      last: ["Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins", "Jesus", "Sousa", "Fernandes", "Gonçalves", "Gomes", "Lopes", "Marques", "Alves", "Almeida", "Ribeiro", "Pinto", "Carvalho", "Teixeira", "Moreira", "Correia", "Mendes", "Nunes", "Soares", "Vieira", "Monteiro", "Cardoso", "Rocha"]
    },
    GER: {
      first: ["Lukas", "Leon", "Finn", "Jonas", "Luca", "Maximilian", "Felix", "Paul", "Niklas", "Tim", "Jan", "Moritz", "Tom", "Erik", "Julian", "David", "Nico", "Fabian", "Marcel", "Kevin", "Dennis", "Florian", "Philipp", "Simon", "Robin", "Til", "Hannes", "Sebastian", "Matthias", "Timo"],
      last: ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann", "Koch", "Richter", "Bauer", "Klein", "Wolf", "Schröder", "Neumann", "Schwarz", "Zimmermann", "Braun", "Krüger", "Hofmann", "Hartmann", "Lange", "Schmitt", "Werner", "Krause", "Meier", "Lehmann", "Kaiser"]
    }
  };

  function randomName(nation, rng) {
    const pool = POOLS[nation] || POOLS.BRA;
    const r = rng || window.TF.util.RNG.next.bind(window.TF.util.RNG);
    const first = pool.first[Math.floor(r() * pool.first.length)];
    const last = pool.last[Math.floor(r() * pool.last.length)];
    return first + " " + last;
  }

  window.TF = window.TF || {};
  window.TF.names = { randomName, POOLS };
})();
