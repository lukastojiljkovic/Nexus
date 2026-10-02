import type Database from "better-sqlite3-multiple-ciphers";
import { DocumentStore } from "@nexus/db";
import type { DocumentType } from "@nexus/db";
import { demoDay } from "./context.js";
import type { DemoContext } from "./context.js";

type DatabaseHandle = Database.Database;

/**
 * One tracked document, expressed as the sequence of expiry dates it has
 * carried — oldest first. The first entry is what `DocumentStore.create` is
 * given; every entry after it is one `DocumentStore.renew` call, so a spec
 * with N entries seeds exactly N-1 renewals. `DocDeadlines.tsx` (the „Rokovi"
 * horizon) draws a lane's SPAN only from the latest renewal, so what actually
 * reaches the chart is the last two entries — but the earlier ones still
 * populate `listRenewals`' history and its count.
 *
 * Offsets are days from `ctx.today`, resolved through `demoDay` (never a
 * literal date), so the whole catalogue stays correct however far in the
 * future the demo profile happens to be opened. Intervals between entries
 * mirror how each document actually gets renewed in life — annual for an ID
 * document or a policy, semestral for a student certificate, monthly for a
 * transit pass — which is what makes the COUNT of renewals plausible and not
 * just a number picked to satisfy the chart.
 */
interface DemoDocumentSpec {
  docType: DocumentType;
  label: string;
  notes: string | null;
  /** Expiry offsets in days from today, oldest first; the last is the CURRENT expiry. */
  expiryOffsets: readonly [number, ...number[]];
}

const DOCUMENTS: readonly DemoDocumentSpec[] = [
  // --- Comfortably valid (`ok`) — long-validity documents nowhere near their reminder window ---
  { docType: "licna_karta", label: "Lična karta", notes: null, expiryOffsets: [1500] },
  { docType: "pasos", label: "Pasoš", notes: "Biometrijski, izdat u MUP Beograd.", expiryOffsets: [1100] },
  { docType: "vozacka", label: "Vozačka dozvola", notes: null, expiryOffsets: [2500] },
  {
    docType: "kartica",
    label: "Bankovna kartica",
    notes: "Glavni tekući račun.",
    expiryOffsets: [900],
  },
  {
    docType: "custom",
    label: "Diploma srednje škole",
    notes: "Overena kopija čuva se uz original.",
    expiryOffsets: [7300],
  },
  // Renewed twice yearly (health-insurance stamp) — the recent renewal keeps it comfortably valid.
  { docType: "custom", label: "Zdravstvena knjižica", notes: null, expiryOffsets: [-795, -430, -65, 300] },
  // Gym membership, renewed every six months.
  {
    docType: "custom",
    label: "Fitnes članska kartica",
    notes: "Teretana — polugodišnja članarina.",
    expiryOffsets: [-210, -30, 150],
  },

  // --- Expiring soon (`uskoro`) — inside the type's own reminder window ---
  // Re-enrolled each academic year; the next enrollment is coming up.
  {
    docType: "custom",
    label: "Indeks",
    notes: "Overa naredne godine studija.",
    expiryOffsets: [-1077, -712, -347, 18],
  },
  // Reissued each academic year alongside the index.
  { docType: "kartica", label: "Studentska kartica", notes: null, expiryOffsets: [-1083, -718, -353, 12] },
  {
    docType: "polisa",
    label: "Polisa auto-osiguranja",
    notes: "AMS osiguranje, godišnja polisa.",
    expiryOffsets: [-1086, -721, -356, 9],
  },
  {
    docType: "custom",
    label: "Ugovor o zakupu stana",
    notes: "Produžava se sa stanodavcem na godinu dana.",
    expiryOffsets: [-705, -340, 25],
  },
  // Monthly transit pass — short cycle, so it always has renewal history and is nearly always close to due.
  { docType: "custom", label: "Mesečna karta za javni prevoz", notes: null, expiryOffsets: [-116, -86, -56, -26, 4] },

  // --- Already expired (`istekao`) — the renewal that did not happen yet ---
  // Annual technical inspection, lapsed less than two weeks ago.
  {
    docType: "registracija",
    label: "Registracija vozila",
    notes: "Tehnički pregled + registracija, Fiat Punto.",
    expiryOffsets: [-1472, -1107, -742, -377, -12],
  },
  // Issued each semester for scholarship/discount applications — easy to forget between semesters.
  {
    docType: "custom",
    label: "Potvrda o studiranju",
    notes: "Potrebna za studentski popust i stipendiju.",
    expiryOffsets: [-760, -580, -400, -220, -40],
  },
  // A one-off travel policy from a past trip; nothing to renew it into.
  {
    docType: "polisa",
    label: "Polisa putnog osiguranja",
    notes: "Kupljena za put u Grčku.",
    expiryOffsets: [-200],
  },
];

/**
 * English labels and notes, keyed by the Serbian text the Serbian scene uses,
 * so `ctx.locale === "sr"` writes exactly what it always did. Keys are unique
 * across the two fields, and a missing key falls back to the Serbian text.
 */
const EN: Readonly<Record<string, string>> = {
  "Lična karta": "Identity card",
  Pasoš: "Passport",
  "Biometrijski, izdat u MUP Beograd.": "Biometric, issued by the Belgrade police.",
  "Vozačka dozvola": "Driving licence",
  "Bankovna kartica": "Bank card",
  "Glavni tekući račun.": "Main current account.",
  "Diploma srednje škole": "Secondary-school diploma",
  "Overena kopija čuva se uz original.": "The certified copy is kept with the original.",
  "Zdravstvena knjižica": "Health-insurance booklet",
  "Fitnes članska kartica": "Gym membership card",
  "Teretana — polugodišnja članarina.": "Gym - six-month membership.",
  Indeks: "Student record book",
  "Overa naredne godine studija.": "Enrolment stamp for the next academic year.",
  "Studentska kartica": "Student card",
  "Polisa auto-osiguranja": "Car insurance policy",
  "AMS osiguranje, godišnja polisa.": "AMS insurance, annual policy.",
  "Ugovor o zakupu stana": "Flat lease agreement",
  "Produžava se sa stanodavcem na godinu dana.": "Renewed with the landlord for a year.",
  "Mesečna karta za javni prevoz": "Monthly public-transport pass",
  "Registracija vozila": "Vehicle registration",
  "Tehnički pregled + registracija, Fiat Punto.": "Technical inspection + registration, Fiat Punto.",
  "Potvrda o studiranju": "Certificate of enrolment",
  "Potrebna za studentski popust i stipendiju.": "Needed for the student discount and the scholarship.",
  "Polisa putnog osiguranja": "Travel insurance policy",
  "Kupljena za put u Grčku.": "Bought for a trip to Greece.",
};

/** The seeded text for the active locale. */
function text(ctx: DemoContext, sr: string): string {
  return ctx.locale === "en" ? (EN[sr] ?? sr) : sr;
}

/**
 * Populates ~15 tracked documents through `DocumentStore.create`/`renew` —
 * CAL-004's deadline module, with all three derived states represented and
 * the majority carrying real renewal history for the „Rokovi" horizon to draw
 * spans from.
 */
export function seedDemoDocuments(db: DatabaseHandle, ctx: DemoContext): void {
  const store = new DocumentStore(db, ctx.profileId);

  for (const spec of DOCUMENTS) {
    const [firstOffset, ...renewalOffsets] = spec.expiryOffsets;
    const created = store.create({
      docType: spec.docType,
      label: text(ctx, spec.label),
      expiryDate: demoDay(ctx, firstOffset),
      notes: spec.notes === null ? null : text(ctx, spec.notes),
    });

    for (const offset of renewalOffsets) {
      store.renew(created.id, demoDay(ctx, offset));
    }
  }
}
