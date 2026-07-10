"use strict";
/* Finanças: ingressos, patrocínio, salários e estádio — nos moldes do Brasfoot:
   4 fontes de renda (venda de jogadores, ingressos, patrocínio e amistosos). */
(function () {
  const U = window.TF.util;

  function suggestedTicketPrice(club) {
    return club.division === "A" ? 40 : 20;
  }

  function initialMoney(club) {
    const base = club.division === "A" ? 20e6 : 5e6;
    return Math.round(base * (0.6 + club.rating / 100));
  }

  function seasonSponsorship(club) {
    const base = club.division === "A" ? 12e6 : 4e6;
    return Math.round(base * (0.5 + club.rating / 90));
  }

  /* Público do jogo: depende da moral da torcida, força do adversário, divisão e preço. */
  function attendance(club, opponent, importance) {
    const priceRef = suggestedTicketPrice(club);
    const price = club.ticketPrice || priceRef;
    let fill = 0.28 + club.moralTorcida / 160;               // 0.28 a 0.90
    fill *= 0.75 + (opponent.rating / 100) * 0.45;           // adversário grande atrai
    fill *= importance === "cup" ? 1.1 : 1;
    const priceFactor = Math.pow(priceRef / price, 1.4);     // preço alto afasta
    fill = U.clamp(fill * priceFactor, 0.05, 1);
    const crowd = Math.round(club.capacity * fill);
    return { crowd, income: crowd * price };
  }

  function squadWages(club) {
    let total = 0;
    for (const p of club.players) if (p.contractYears > 0) total += p.wage;
    return total;
  }

  /* Processa o dia de jogo em casa: renda de ingressos. Copa divide a renda. */
  function homeMatchIncome(club, opponent, importance) {
    const { crowd, income } = attendance(club, opponent, importance);
    const net = importance === "cup" ? Math.round(income / 2) : income;
    return { crowd, income: net };
  }

  function stadiumExpansionCost(seats) { return seats * 450; }

  function orderStadiumExpansion(club, seats) {
    const cost = stadiumExpansionCost(seats);
    if (club.money < cost) return { ok: false, reason: "Dinheiro insuficiente." };
    club.money -= cost;
    club.stadiumWorks = { seats, weeksLeft: Math.max(4, Math.round(seats / 2500)) };
    return { ok: true, cost };
  }

  function tickStadiumWorks(club) {
    if (!club.stadiumWorks) return null;
    club.stadiumWorks.weeksLeft--;
    if (club.stadiumWorks.weeksLeft <= 0) {
      const seats = club.stadiumWorks.seats;
      club.capacity += seats;
      club.stadiumWorks = null;
      return seats;
    }
    return null;
  }

  window.TF.finance = { suggestedTicketPrice, initialMoney, seasonSponsorship, attendance, squadWages, homeMatchIncome, stadiumExpansionCost, orderStadiumExpansion, tickStadiumWorks };
})();
