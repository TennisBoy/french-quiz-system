// No 0/o, 1/l/i: temporary passwords are read off a printed sheet.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Random temporary password like "k7mq-x3pa-9fte" (~59 bits of entropy). */
export function generateTempPassword(groups = 3, groupLength = 4): string {
  const total = groups * groupLength;
  const limit = 256 - (256 % ALPHABET.length); // rejection sampling avoids modulo bias
  const chars: string[] = [];
  while (chars.length < total) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limit && chars.length < total) chars.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  const out: string[] = [];
  for (let g = 0; g < groups; g++) out.push(chars.slice(g * groupLength, (g + 1) * groupLength).join(""));
  return out.join("-");
}
