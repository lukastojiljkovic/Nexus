/**
 * The Serbian letters that have no sign of their own in the three alphabets
 * this folder encodes (NATO words, Braille cells and semaphore positions), and
 * what is sent for each of them.
 *
 * **Transliterated, and the transliteration is reported.** č and ć are sent as
 * c, š as s, ž as z, and đ as dj, the same mapping `morse.ts` uses for the same
 * reason: a sign with no code is not dropped, because a silent drop reads as a
 * different word at the other end. The digraphs are not special. Lj and nj are
 * two letters in the Latin text and are sent as two letters; dž is d followed by
 * ž, so it is sent as dz.
 *
 * Serbian Braille has its own cells for č, ć, š, ž, đ and the digraphs. They are
 * not encoded here, and the tab says so rather than sending the Latin letters as
 * if they were Serbian cells.
 */
export const SERBIAN_TRANSLITERATIONS: Readonly<Record<string, string>> = {
  č: "c",
  ć: "c",
  š: "s",
  ž: "z",
  đ: "dj",
};
