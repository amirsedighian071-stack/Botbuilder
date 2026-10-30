/* BotForge home page — fills catalog totals from the generated catalog. */
(function () {
  'use strict';

  const BF = window.BF;
  const CATALOG = window.BOTFORGE_CATALOG || { totals: {} };

  BF.ready(() => {
    const totals = CATALOG.totals || {};
    const map = {
      homeBots: totals.bots,
      homeCommands: totals.commands,
      homeCategories: totals.categories
    };
    for (const [id, value] of Object.entries(map)) {
      const node = document.getElementById(id);
      if (node && value !== undefined) node.textContent = BF.faDigits(value);
    }
  });
})();
