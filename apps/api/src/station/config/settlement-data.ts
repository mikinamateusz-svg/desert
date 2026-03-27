// Metropolitan cities (500k+) — always classified as 'metropolitan'.
// Includes common diacritic and ASCII variants from Google geocoding responses.
export const METROPOLITAN_CITIES = new Set([
  'warszawa',
  'warsaw',
  'kraków',
  'krakow',
  'cracow',
  'wrocław',
  'wroclaw',
  'gdańsk',
  'gdansk',
  'gdynia',
  'sopot',
  'poznań',
  'poznan',
  'łódź',
  'lodz',
]);

// City population map — normalised lowercase keys.
// Source: GUS 2023 municipal population data.
// metropolitan cities omitted here (handled by METROPOLITAN_CITIES set).
// Extend this map to improve rural classification accuracy.
export const CITY_POPULATIONS: Record<string, number> = {
  szczecin: 390_000,
  bydgoszcz: 340_000,
  lublin: 340_000,
  katowice: 290_000,
  białystok: 295_000,
  bialystok: 295_000,
  rzeszów: 195_000,
  rzeszow: 195_000,
  toruń: 200_000,
  torun: 200_000,
  kielce: 195_000,
  gliwice: 180_000,
  zabrze: 170_000,
  bytom: 155_000,
  'bielsko-biała': 170_000,
  'bielsko-biala': 170_000,
  olsztyn: 170_000,
  sosnowiec: 200_000,
  radom: 210_000,
  częstochowa: 215_000,
  czestochowa: 215_000,
  tychy: 125_000,
  rybnik: 135_000,
  ruda_śląska: 135_000,
  opole: 127_000,
  elbląg: 118_000,
  płock: 120_000,
  plock: 120_000,
  wałbrzych: 110_000,
  walbrzych: 110_000,
  włocławek: 110_000,
  wloclawek: 110_000,
  tarnów: 107_000,
  tarnow: 107_000,
  chorzów: 105_000,
  chorzow: 105_000,
  kalisz: 99_000,
  koszalin: 105_000,
  legnica: 99_000,
  grudziądz: 94_000,
  grudziadz: 94_000,
  jaworzno: 90_000,
  słupsk: 90_000,
  slupsk: 90_000,
  jastrzębie_zdrój: 88_000,
  nowy_sącz: 83_000,
  jelenia_góra: 80_000,
  siedlce: 79_000,
  mysłowice: 73_000,
  konin: 72_000,
  piotrków_trybunalski: 72_000,
  inowrocław: 71_000,
  lubin: 71_000,
  ostrowiec_świętokrzyski: 68_000,
  gniezno: 67_000,
  stargard: 66_000,
  suwalki: 66_000,
  suwałki: 66_000,
  zgierz: 57_000,
  ostróda: 33_000,
  piła: 72_000,
  ostrów_wielkopolski: 71_000,
  tarnowskie_góry: 61_000,
  przemysł: 60_000,
  przemysl: 60_000,
  zamość: 63_000,
  zamosc: 63_000,
  starachowice: 50_000,
  mielec: 60_000,
  puławy: 47_000,
  biała_podlaska: 57_000,
  ostrołęka: 51_000,
  sieradz: 43_000,
  świdnica: 55_000,
  swidnica: 55_000,
  leszno: 63_000,
  zielona_góra: 140_000,
  zielona_gora: 140_000,
  gorzów_wielkopolski: 122_000,
  gorzow_wielkopolski: 122_000,
};

export type SettlementTierValue = 'metropolitan' | 'city' | 'town' | 'rural';

export function resolveSettlementTier(locality: string | null): SettlementTierValue {
  if (!locality) return 'rural';
  const normalised = locality.toLowerCase().trim().replace(/\s+/g, '_');
  if (METROPOLITAN_CITIES.has(normalised)) return 'metropolitan';
  const pop = CITY_POPULATIONS[normalised];
  if (pop !== undefined) {
    if (pop >= 50_000) return 'city';
    if (pop >= 10_000) return 'town';
    return 'rural';
  }
  // Unknown locality — treat as rural (conservative; real community data will correct)
  return 'rural';
}
