"use strict";
/* Mercado: compra, venda, renovação de contrato e propostas da IA. */
(function () {
  const U = window.TF.util;
  const W = () => window.TF.world;

  /* Valor de mercado justo do jogador no contexto do clube dono.
     Multiplicadores moderados sobre o valor real de mercado. */
  function fairValue(player, ownerClub) {
    let v = player.value * 1e6;
    if (player.contractYears <= 0) return 0; // livre
    const starters = ownerClub.players.slice().sort((a, b) => b.rating - a.rating).slice(0, 13);
    if (starters.some(p => p.id === player.id)) v *= 1.18;      // titular custa um pouco mais
    if (player.age <= 22 && player.potential > player.rating + 5) v *= 1.15; // promessa
    v *= 0.92 + player.contractYears * 0.06;                    // contrato longo valoriza pouco
    return Math.round(v);
  }

  /* Valor pedido pelo clube dono (se o dono anunciou um preço, vale o anúncio). */
  function askingPrice(player, ownerClub) {
    if (player.contractYears <= 0) return 0;
    if (player.forSale && player.salePrice) return Math.round(player.salePrice);
    let v = fairValue(player, ownerClub);
    if (player.forSale) v = Math.round(v * 0.85); // anunciado sem preço: leve desconto
    return v;
  }

  /* Salário que o jogador exige para assinar. */
  function wageDemand(player, buyingClub) {
    let w = player.wage * 1.15;
    if (buyingClub.rating < player.rating - 5) w *= 1.3; // clube pequeno paga mais caro
    if (player.contractYears <= 0) w *= 1.1;
    return Math.round(w / 100) * 100;
  }

  /* Tenta comprar: retorna resultado da negociação com o clube da IA. */
  function makeOffer(world, buyerClub, player, offerValue, wageOffer, years) {
    const owner = world.clubs[player.clubId];
    if (!owner || owner.id === buyerClub.id) return { ok: false, reason: "Negociação inválida." };
    const price = askingPrice(player, owner);
    if (buyerClub.money < offerValue) return { ok: false, reason: "Seu clube não tem esse dinheiro em caixa." };

    if (player.contractYears > 0) {
      const need = owner.players.filter(p => p.pos === player.pos && p.contractYears > 0).length;
      let willing = offerValue >= price * (need <= 2 ? 1.25 : 1);
      if (!willing) {
        const counter = Math.round(price * (need <= 2 ? 1.3 : 1.12));
        return { ok: false, counter, reason: owner.name + " recusou. Pede " + U.formatMoney(counter) + "." };
      }
    }
    const demand = wageDemand(player, buyerClub);
    if (wageOffer < demand * 0.92) {
      return { ok: false, wageCounter: demand, reason: player.name + " recusou o salário. Pede " + U.formatMoney(demand) + " por jogo." };
    }
    // negócio fechado
    transferPlayer(world, player, buyerClub, offerValue, wageOffer, years);
    return { ok: true, price: offerValue };
  }

  function transferPlayer(world, player, toClub, fee, wage, years) {
    const fromClub = world.clubs[player.clubId];
    if (fromClub) {
      fromClub.players = fromClub.players.filter(p => p.id !== player.id);
      fromClub.money += fee;
    }
    toClub.players.push(player);
    toClub.money -= fee;
    player.clubId = toClub.id;
    player.wage = wage;
    player.contractYears = years;
    player.forSale = false;
    player.salePrice = null;
    player.moral = U.clamp(player.moral + 8, 5, 100);
    player.joinedRecently = true;
  }

  /* Renovação: jogador aceita se o salário for suficiente. */
  function renewContract(player, club, wageOffer, years) {
    let demand = Math.round(player.wage * (player.moral < 40 ? 1.35 : 1.15));
    if (player.age >= 33) demand = Math.round(player.wage * 0.9);
    if (wageOffer < demand * 0.95) {
      return { ok: false, demand, reason: player.name + " quer pelo menos " + U.formatMoney(demand) + " por jogo." };
    }
    player.wage = wageOffer;
    player.contractYears = years;
    player.moral = U.clamp(player.moral + 10, 5, 100);
    return { ok: true };
  }

  /* Propostas da IA por jogadores do clube humano (semanal).
     Jogador à venda: o interesse depende do preço anunciado em relação ao valor justo —
     ninguém compra caro. Preço camarada atrai propostas rápidas. */
  function aiOffersForUser(world, userClub, rng) {
    const offers = [];
    for (const p of userClub.players) {
      let chance;
      let offerValue;
      const fair = Math.max(fairValue(p, userClub), 100000);
      if (p.forSale) {
        const price = p.salePrice || Math.round(fair * 0.85);
        const ratio = price / fair;
        if (ratio <= 0.75) chance = 0.45;        // pechincha: fila de interessados
        else if (ratio <= 0.95) chance = 0.30;
        else if (ratio <= 1.1) chance = 0.18;    // preço justo
        else if (ratio <= 1.35) chance = 0.07;   // caro
        else if (ratio <= 1.7) chance = 0.02;    // muito caro
        else chance = 0;                          // ninguém paga isso
        // compradores pagam o anúncio; se estiver caro, tentam pechinchar um pouco
        offerValue = ratio > 1.1 && rng() < 0.5
          ? Math.round(Math.max(fair * 1.05, price * 0.88))
          : Math.round(price);
      } else {
        // sondagens espontâneas por quem não está à venda
        chance = 0.008 + (p.rating >= 84 ? 0.02 : 0);
        offerValue = Math.round(fair * (0.7 + rng() * 0.45));
      }
      if (chance > 0 && rng() < chance) {
        const richClubs = Object.values(world.clubs).filter(c =>
          c.id !== userClub.id && c.rating >= p.rating - 14 && c.money > offerValue * 0.7);
        if (!richClubs.length) continue;
        const buyer = richClubs[Math.floor(rng() * richClubs.length)];
        offers.push({ playerId: p.id, clubId: buyer.id, value: offerValue });
      }
    }
    return offers;
  }

  function acceptAiOffer(world, userClub, offer) {
    const player = userClub.players.find(p => p.id === offer.playerId);
    const buyer = world.clubs[offer.clubId];
    if (!player || !buyer) return { ok: false };
    transferPlayer(world, player, buyer, offer.value, player.wage, 2);
    buyer.money += offer.value; // IA não fica sem caixa (dinheiro do jogo)
    return { ok: true };
  }

  window.TF.transfers = { askingPrice, fairValue, wageDemand, makeOffer, transferPlayer, renewContract, aiOffersForUser, acceptAiOffer };
})();
