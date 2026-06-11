// US states (+ DC) and the geographic NANP area codes assigned to each.
// Used to flag a phone number whose area code clearly belongs to a different
// state than the one the patient selected.
//
// IMPORTANT: we only ever flag a mismatch when an area code is *confidently*
// known to belong to another state. Newer overlay codes that aren't listed
// here simply won't trigger a mismatch — that's intentional, so a stale list
// never blocks a legitimate number. (Mobile numbers are portable, so this is a
// soft signal at best.)

import { usPhoneDigits } from "@/lib/phone";

export type UsState = { code: string; name: string };

export const US_STATES: UsState[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

const STATE_NAMES: Record<string, string> = Object.fromEntries(
  US_STATES.map((s) => [s.code, s.name])
);

const STATE_AREA_CODES: Record<string, string[]> = {
  AL: ["205", "251", "256", "334", "659", "938"],
  AK: ["907"],
  AZ: ["480", "520", "602", "623", "928"],
  AR: ["327", "479", "501", "870"],
  CA: [
    "209", "213", "279", "310", "323", "341", "350", "408", "415", "424",
    "442", "510", "530", "559", "562", "619", "626", "628", "650", "657",
    "661", "669", "707", "714", "747", "760", "805", "818", "820", "831",
    "840", "858", "909", "916", "925", "949", "951",
  ],
  CO: ["303", "719", "720", "970", "983"],
  CT: ["203", "475", "860", "959"],
  DE: ["302"],
  DC: ["202"],
  FL: [
    "239", "305", "321", "352", "386", "407", "448", "561", "656", "689",
    "727", "754", "772", "786", "813", "850", "863", "904", "941", "954",
  ],
  GA: ["229", "404", "470", "478", "678", "706", "762", "770", "912", "943"],
  HI: ["808"],
  ID: ["208", "986"],
  IL: [
    "217", "224", "309", "312", "331", "447", "464", "618", "630", "708",
    "730", "773", "779", "815", "847", "872",
  ],
  IN: ["219", "260", "317", "463", "574", "765", "812", "930"],
  IA: ["319", "515", "563", "641", "712"],
  KS: ["316", "620", "785", "913"],
  KY: ["270", "364", "502", "606", "859"],
  LA: ["225", "318", "337", "504", "985"],
  ME: ["207"],
  MD: ["240", "301", "410", "443", "667"],
  MA: ["339", "351", "413", "508", "617", "774", "781", "857", "978"],
  MI: [
    "231", "248", "269", "313", "517", "586", "616", "679", "734", "810",
    "906", "947", "989",
  ],
  MN: ["218", "320", "507", "612", "651", "763", "952"],
  MS: ["228", "601", "662", "769"],
  MO: ["314", "417", "557", "573", "636", "660", "816"],
  MT: ["406"],
  NE: ["308", "402", "531"],
  NV: ["702", "725", "775"],
  NH: ["603"],
  NJ: ["201", "551", "609", "640", "732", "848", "856", "862", "908", "973"],
  NM: ["505", "575"],
  NY: [
    "212", "315", "332", "347", "363", "516", "518", "585", "607", "631",
    "646", "680", "716", "718", "838", "845", "914", "917", "929", "934",
  ],
  NC: ["252", "336", "472", "704", "743", "828", "910", "919", "980", "984"],
  ND: ["701"],
  OH: [
    "216", "220", "234", "326", "330", "380", "419", "440", "513", "567",
    "614", "740", "937",
  ],
  OK: ["405", "539", "572", "580", "918"],
  OR: ["458", "503", "541", "971"],
  PA: [
    "215", "223", "267", "272", "412", "445", "484", "570", "582", "610",
    "717", "724", "814", "835", "878",
  ],
  RI: ["401"],
  SC: ["803", "821", "839", "843", "854", "864"],
  SD: ["605"],
  TN: ["423", "615", "629", "731", "865", "901", "931"],
  TX: [
    "210", "214", "254", "281", "325", "346", "361", "409", "430", "432",
    "469", "512", "682", "713", "726", "737", "806", "817", "830", "832",
    "903", "915", "936", "940", "945", "956", "972", "979",
  ],
  UT: ["385", "435", "801"],
  VT: ["802"],
  VA: ["276", "434", "540", "571", "686", "703", "757", "804", "826", "948"],
  WA: ["206", "253", "360", "425", "509", "564"],
  WV: ["304", "681"],
  WI: ["262", "274", "414", "534", "608", "715", "920"],
  WY: ["307"],
};

/** Reverse lookup: area code → 2-letter state code. */
export const AREA_CODE_TO_STATE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [state, codes] of Object.entries(STATE_AREA_CODES)) {
    for (const code of codes) map[code] = state;
  }
  return map;
})();

export function isUsStateCode(code: unknown): code is string {
  return typeof code === "string" && code in STATE_NAMES;
}

export function usStateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}

/** The state a phone's area code belongs to, or null if not confidently known. */
export function stateForPhone(phone: string): string | null {
  const d = usPhoneDigits(phone);
  if (d.length < 3) return null;
  return AREA_CODE_TO_STATE[d.slice(0, 3)] ?? null;
}

/**
 * True only when the phone is a complete US number whose area code is
 * confidently known to belong to a state OTHER than `stateCode`. Unknown area
 * codes return false so a stale list never blocks a valid number.
 */
export function phoneStateMismatch(phone: string, stateCode: string): boolean {
  if (!stateCode) return false;
  const d = usPhoneDigits(phone);
  if (d.length < 10) return false;
  const mapped = AREA_CODE_TO_STATE[d.slice(0, 3)];
  return !!mapped && mapped !== stateCode;
}
