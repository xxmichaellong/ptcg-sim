/**
 * Cards banned in Expanded, by printing ("set code" + number), as the
 * official list stands (pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list;
 * Limitless's `bans:expanded` lists the same 49 printings, 2026-10-15).
 * Reprints of a banned card are banned with it: the catalog applies a ban to
 * every printing that shares the card's rules. Standard bans none.
 *
 * Changing this list changes the catalog's version, so browsers fetch the
 * new body.
 */
export const EXPANDED_BANS: readonly string[] = Object.freeze([
  'ASR TG2',
  'EVS 83',
  'EVS 185',
  'EVS 186',
  'SHF SV13',
  'RCL 22',
  'RCL 165',
  'RCL 207',
  'SP 22',
  'CEC 83',
  'CEC 194',
  'CEC 265',
  'HIF 58',
  'HIF 60',
  'HIF 68',
  'UNM 206',
  'UNM 206A',
  'UNM 253',
  'UNB 78',
  'UNB 165',
  'UNB 178',
  'LOT 90',
  'LOT 91',
  'FLI 83',
  'UPR 114',
  'SLG 45',
  'SMP 85',
  'GEN 71',
  'BKP 98',
  'BKP 98A',
  'BKP 98B',
  'BKP 109',
  'AOR 74',
  'AOR 75',
  'AOR 75A',
  'ROS 77',
  'ROS 77A',
  'ROS 106',
  'PRC 133',
  'PRC 158',
  'PHF 99',
  'PHF 118',
  'FLF 23',
  'XY 124',
  'PLF 101',
  'PLF 115',
  'DEX 62',
  'DEX 110',
  'NVI 67',
]);

export const STANDARD_BANS: readonly string[] = Object.freeze([]);
