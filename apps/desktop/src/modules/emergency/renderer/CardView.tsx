import type { CardBlock, CardLanguage, CardModel } from "@nexus/core";
import { Card, Chip } from "@nexus/ui";
import { formatCardDate, languageTag } from "../shared/cardDate.js";
import { CARD_TEXT, SERBIAN_EMERGENCY_NUMBERS } from "../shared/cardText.js";

/**
 * The card as the page shows it: the same document the printer gets, drawn in the
 * app's own tokens.
 *
 * **Why the on-screen card is not the edit form.** The user reads this page the
 * way a stranger will - large type, one block after another, the blood type where
 * a medic looks for it - and edits it by pressing one button. A form that was
 * also the preview would show somebody a grid of inputs and call it a card.
 *
 * **Both languages, side by side, when the card asks for both.** `printLanguage`
 * decides that (`cardModel.ts`), and this component draws one sheet per pass, so
 * what the screen shows is what the sheet will be; the chip names the language
 * because two identical-looking sheets otherwise have no visible difference
 * except the words.
 *
 * Nothing here decides order, content or whether a section exists - the model
 * does all three. This file knows how to DRAW the seven block kinds and the four
 * numbers, and nothing about a card.
 */
export function CardView({
  model,
  title,
}: {
  model: CardModel;
  title: { readonly sr: string; readonly en: string };
}) {
  return (
    <div className="emergency__sheets">
      {model.passes.map((pass) => (
        <Card key={pass.language} className="emergency__sheet">
          <div className="emergency__sheet-head">
            <h2 className="emergency__sheet-title">{title[pass.language]}</h2>
            <Chip className="emergency__sheet-lang">{languageTag(pass.language)}</Chip>
          </div>
          {pass.blocks.map((block) => (
            <Block key={block.key} block={block} language={pass.language} />
          ))}
          <div className="emergency__numbers">
            <div className="emergency__label">
              {CARD_TEXT.emergencyNumbers[pass.language]}
            </div>
            <ul className="emergency__numbers-list">
              {SERBIAN_EMERGENCY_NUMBERS.map((entry) => (
                <li key={entry.number} className="emergency__number-row">
                  <span className="emergency__number">{entry.number}</span>
                  <span className="emergency__number-label">{entry.label[pass.language]}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="emergency__disclaimer">{CARD_TEXT.disclaimer[pass.language]}</p>
        </Card>
      ))}
    </div>
  );
}

/** One block, drawn by its key - the model's own vocabulary, exhaustively. */
function Block({ block, language }: { block: CardBlock; language: CardLanguage }) {
  switch (block.key) {
    case "identity":
      return (
        <section className="emergency__block">
          {/* `null` prints nothing: an unanswered name is not a name to fill in. */}
          {block.fullName !== null && (
            <p className="emergency__name">{block.fullName}</p>
          )}
          {block.dateOfBirth !== null && (
            <Field
              label={CARD_TEXT.dateOfBirth[language]}
              value={formatCardDate(block.dateOfBirth, language)}
            />
          )}
        </section>
      );
    case "bloodType":
      return (
        <section className="emergency__block">
          <div className="emergency__label">{CARD_TEXT.bloodType[language]}</div>
          <p className="emergency__blood">
            {block.bloodType === "unknown"
              ? CARD_TEXT.bloodTypeUnknown[language]
              : block.bloodType}
          </p>
        </section>
      );
    case "allergies":
      return (
        <Rows
          label={CARD_TEXT.allergies[language]}
          empty={block.allergies.length === 0 ? CARD_TEXT.allergiesNone[language] : null}
          rows={block.allergies.map((allergy) => ({
            main: allergy.label,
            note: allergy.severity === null ? null : SEVERITY_TEXT[allergy.severity][language],
          }))}
        />
      );
    case "conditions":
      return (
        <Rows
          label={CARD_TEXT.conditions[language]}
          empty={block.conditions.length === 0 ? CARD_TEXT.conditionsNone[language] : null}
          rows={block.conditions.map((condition) => ({ main: condition, note: null }))}
        />
      );
    case "medications":
      return (
        <Rows
          label={CARD_TEXT.medications[language]}
          empty={block.medications.length === 0 ? CARD_TEXT.medicationsNone[language] : null}
          rows={block.medications.map((medication) => ({
            main: medication.name,
            note: medication.dose,
          }))}
        />
      );
    case "organDonor":
      return (
        <Field
          label={CARD_TEXT.organDonor[language]}
          value={block.organDonor === "yes" ? CARD_TEXT.yes[language] : CARD_TEXT.no[language]}
        />
      );
    case "contacts":
      return (
        <Rows
          label={CARD_TEXT.contacts[language]}
          empty={null}
          rows={block.contacts.map((contact) => ({
            // A reference that has gone dangling says so rather than printing a
            // blank line - the card model's own rule, drawn.
            main: contact.missing
              ? CARD_TEXT.contactMissing[language]
              : (contact.name ?? ""),
            note: [contact.relation, contact.phone].filter((part) => part !== null).join(" · "),
          }))}
        />
      );
    case "doctor":
      return (
        <section className="emergency__block">
          <div className="emergency__label">{CARD_TEXT.doctor[language]}</div>
          {block.name !== null && <p className="emergency__value">{block.name}</p>}
          {block.phone !== null && <p className="emergency__note">{block.phone}</p>}
        </section>
      );
    case "insurance":
      return (
        <section className="emergency__block">
          <div className="emergency__label">{CARD_TEXT.insurance[language]}</div>
          <p className="emergency__value">{block.number}</p>
        </section>
      );
    case "documents":
      return (
        <Rows
          label={CARD_TEXT.documents[language]}
          empty={null}
          rows={block.documents.map((document) => ({
            main: document.missing
              ? CARD_TEXT.documentMissing[language]
              : (document.label ?? ""),
            note: document.expiryDate === null ? null : formatCardDate(document.expiryDate, language),
          }))}
        />
      );
    case "notes":
      return (
        <section className="emergency__block">
          <div className="emergency__label">{CARD_TEXT.notes[language]}</div>
          <p className="emergency__prose">{block.notes}</p>
        </section>
      );
  }
}

/** One labelled scalar. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <section className="emergency__block">
      <div className="emergency__label">{label}</div>
      <p className="emergency__value">{value}</p>
    </section>
  );
}

/** One list block: rows, or the sentence an ANSWERED-EMPTY list prints. */
function Rows({
  label,
  rows,
  empty,
}: {
  label: string;
  rows: readonly { readonly main: string; readonly note: string | null }[];
  empty: string | null;
}) {
  return (
    <section className="emergency__block">
      <div className="emergency__label">{label}</div>
      {rows.length === 0 ? (
        empty !== null && <p className="emergency__empty">{empty}</p>
      ) : (
        <ul className="emergency__rows">
          {rows.map((row, index) => (
            // The card's rows have no ids of their own: a list of allergies is a
            // list of words, and its position is the only identity it has.
            <li key={`${index}-${row.main}`} className="emergency__row">
              <span className="emergency__row-main">{row.main}</span>
              {row.note !== null && row.note !== "" && (
                <span className="emergency__row-note">{row.note}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The severity words, read off the shared table so the screen and the sheet cannot disagree. */
const SEVERITY_TEXT = {
  mild: CARD_TEXT.severityMild,
  severe: CARD_TEXT.severitySevere,
  anaphylaxis: CARD_TEXT.severityAnaphylaxis,
} as const;
