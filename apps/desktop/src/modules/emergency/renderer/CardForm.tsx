import { useState } from "react";
import type { ReactNode } from "react";
import { BLOOD_TYPES } from "@nexus/core";
import type { AllergySeverity, CardPrintLanguage } from "@nexus/core";
import { Button, Card, Checkbox, Select, TextArea, TextField } from "@nexus/ui";
import { activeLocale } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { CARD_TEXT } from "../shared/cardText.js";
import type { CardFieldsPayload } from "../shared/ipc.js";
import {
  SEVERITY_CHOICES,
  blankAllergy,
  blankMedication,
  cardFieldsOf,
  cardFormProblem,
  todayKey,
  type CardForm as CardFormDraft,
} from "./card.js";
import { copy } from "./copy.js";

/**
 * The card's editor: one form, and the contact list beside it.
 *
 * **Why one form and not a wizard.** Everything on the card is a fact about one
 * person, and the card is one page; a wizard would hide the second half of a
 * short form behind a button. The blocks are in the order the card prints them,
 * so filling the form in is reading the card (`buildCardModel` owns that order,
 * and this file follows it rather than deciding one).
 *
 * **Why the three lists carry a tick each.** `null` and `[]` are different
 * answers on this card - "not said" versus "there are none" - and a form cannot
 * express two answers with one control. The tick says the list is EMPTY ON
 * PURPOSE; leaving it unticked and adding no rows says the question is
 * unanswered, and both print differently (`cardFields.ts` explains why that
 * distinction is the module's whole point).
 *
 * The draft lives here and nowhere else: the page renders what main said, and a
 * half-typed form is not something main has ever heard of.
 */
export function CardForm({
  initial,
  contacts,
  onSave,
  onCancel,
}: {
  initial: CardFormDraft;
  /** The contact list, drawn by the page: it writes through `moveContact` and friends, and this form does not own it. */
  contacts: ReactNode;
  onSave: (fields: CardFieldsPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CardFormDraft>(initial);
  const [problem, setProblem] = useState<"fullName" | "dateOfBirth" | null>(null);
  const [saving, setSaving] = useState(false);

  const today = todayKey(new Date());

  async function save(): Promise<void> {
    const found = cardFormProblem(draft, today);
    setProblem(found);
    if (found !== null) return;
    setSaving(true);
    try {
      await onSave(cardFieldsOf(draft));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="emergency__form" title={copy.form.title}>
      <p className="nx-hint">{copy.form.intro}</p>

      <div className="emergency__grid">
        <div className="emergency__field">
          <TextField
            label={copy.form.fullName}
            value={draft.fullName}
            maxLength={120}
            onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
          />
          {problem === "fullName" && (
            <p className="emergency__field-error">{copy.form.problemName}</p>
          )}
        </div>
        <div className="emergency__field">
          <TextField
            label={copy.form.dateOfBirth}
            type="date"
            value={draft.dateOfBirth}
            onChange={(event) => setDraft({ ...draft, dateOfBirth: event.target.value })}
          />
          {problem === "dateOfBirth" && (
            <p className="emergency__field-error">{copy.form.problemDate}</p>
          )}
        </div>
        <Select
          label={copy.form.bloodType}
          value={draft.bloodType}
          onChange={(event) => setDraft({ ...draft, bloodType: event.target.value })}
        >
          <option value="">{copy.form.bloodTypeUnanswered}</option>
          {BLOOD_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
          <option value="unknown">{CARD_TEXT.bloodTypeUnknown[activeLocale()]}</option>
        </Select>
        <Select
          label={copy.form.organDonor}
          value={draft.organDonor}
          onChange={(event) => setDraft({ ...draft, organDonor: event.target.value })}
        >
          <option value="">{copy.form.organDonorUnanswered}</option>
          <option value="yes">{CARD_TEXT.yes[activeLocale()]}</option>
          <option value="no">{CARD_TEXT.no[activeLocale()]}</option>
        </Select>
        <TextField
          label={copy.form.insurance}
          value={draft.healthInsuranceNumber}
          maxLength={60}
          onChange={(event) =>
            setDraft({ ...draft, healthInsuranceNumber: event.target.value })
          }
        />
        <TextField
          label={copy.form.doctorName}
          value={draft.doctorName}
          maxLength={120}
          onChange={(event) => setDraft({ ...draft, doctorName: event.target.value })}
        />
        <TextField
          label={copy.form.doctorPhone}
          value={draft.doctorPhone}
          maxLength={40}
          onChange={(event) => setDraft({ ...draft, doctorPhone: event.target.value })}
        />
        <Select
          label={copy.form.printLanguage}
          value={draft.printLanguage}
          onChange={(event) =>
            setDraft({ ...draft, printLanguage: event.target.value as CardPrintLanguage })
          }
        >
          <option value="sr">{copy.form.printSr}</option>
          <option value="en">{copy.form.printEn}</option>
          <option value="both">{copy.form.printBoth}</option>
        </Select>
      </div>

      <AllergyRows draft={draft} setDraft={setDraft} />
      <ConditionRows draft={draft} setDraft={setDraft} />
      <MedicationRows draft={draft} setDraft={setDraft} />

      <TextArea
        label={copy.form.notes}
        value={draft.notes}
        maxLength={2000}
        rows={4}
        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
      />

      {contacts}

      <div className="emergency__actions">
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {copy.form.save}
        </Button>
        <Button variant="quiet" disabled={saving} onClick={onCancel}>
          {copy.form.cancel}
        </Button>
      </div>
    </Card>
  );
}

// --- The three lists --------------------------------------------------------

/** One list row's frame: the row's fields, and the one button that removes it. */
function RowShell({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <div className="emergency__row-edit">
      {children}
      <Button size="sm" variant="quiet" onClick={onRemove}>
        {copy.form.removeRow}
      </Button>
    </div>
  );
}

function AllergyRows({
  draft,
  setDraft,
}: {
  draft: CardFormDraft;
  setDraft: (next: CardFormDraft) => void;
}) {
  return (
    <section className="emergency__group">
      <div className="emergency__label">{copy.form.allergies}</div>
      <Checkbox
        checked={draft.allergiesAnswered}
        onChange={(event) => setDraft({ ...draft, allergiesAnswered: event.target.checked })}
      >
        {copy.form.allergiesNone}
      </Checkbox>
      {draft.allergies.map((allergy, index) => (
        <RowShell
          key={index}
          onRemove={() =>
            setDraft({ ...draft, allergies: draft.allergies.filter((_, at) => at !== index) })
          }
        >
          <TextField
            label={copy.form.allergyLabel}
            value={allergy.label}
            maxLength={120}
            onChange={(event) =>
              setDraft({
                ...draft,
                allergies: draft.allergies.map((row, at) =>
                  at === index ? { ...row, label: event.target.value } : row,
                ),
              })
            }
          />
          <Select
            label={copy.form.allergySeverity}
            value={allergy.severity ?? ""}
            onChange={(event) => {
              const chosen = event.target.value as AllergySeverity | "";
              setDraft({
                ...draft,
                allergies: draft.allergies.map((row, at) =>
                  at === index
                    ? { ...row, severity: chosen === "" ? null : (chosen as AllergySeverity) }
                    : row,
                ),
              });
            }}
          >
            {SEVERITY_CHOICES.map((severity) => (
              <option key={severity ?? ""} value={severity ?? ""}>
                {severity === null
                  ? copy.form.severityUnanswered
                  : SEVERITY_WORDS[severity][activeLocale()]}
              </option>
            ))}
          </Select>
        </RowShell>
      ))}
      <Button
        size="sm"
        onClick={() =>
          setDraft({ ...draft, allergies: [...draft.allergies, blankAllergy()] })
        }
      >
        {copy.form.addAllergy}
      </Button>
    </section>
  );
}

function ConditionRows({
  draft,
  setDraft,
}: {
  draft: CardFormDraft;
  setDraft: (next: CardFormDraft) => void;
}) {
  return (
    <section className="emergency__group">
      <div className="emergency__label">{copy.form.conditions}</div>
      <Checkbox
        checked={draft.conditionsAnswered}
        onChange={(event) => setDraft({ ...draft, conditionsAnswered: event.target.checked })}
      >
        {copy.form.conditionsNone}
      </Checkbox>
      {draft.conditions.map((condition, index) => (
        <RowShell
          key={index}
          onRemove={() =>
            setDraft({ ...draft, conditions: draft.conditions.filter((_, at) => at !== index) })
          }
        >
          <TextField
            label={copy.form.conditions}
            value={condition}
            maxLength={200}
            onChange={(event) =>
              setDraft({
                ...draft,
                conditions: draft.conditions.map((row, at) =>
                  at === index ? event.target.value : row,
                ),
              })
            }
          />
        </RowShell>
      ))}
      <Button
        size="sm"
        onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, ""] })}
      >
        {copy.form.addCondition}
      </Button>
    </section>
  );
}

function MedicationRows({
  draft,
  setDraft,
}: {
  draft: CardFormDraft;
  setDraft: (next: CardFormDraft) => void;
}) {
  return (
    <section className="emergency__group">
      <div className="emergency__label">{copy.form.medications}</div>
      <Checkbox
        checked={draft.medicationsAnswered}
        onChange={(event) => setDraft({ ...draft, medicationsAnswered: event.target.checked })}
      >
        {copy.form.medicationsNone}
      </Checkbox>
      {draft.medications.map((medication, index) => (
        <RowShell
          key={index}
          onRemove={() =>
            setDraft({ ...draft, medications: draft.medications.filter((_, at) => at !== index) })
          }
        >
          <TextField
            label={copy.form.medicationName}
            value={medication.name}
            maxLength={120}
            onChange={(event) =>
              setDraft({
                ...draft,
                medications: draft.medications.map((row, at) =>
                  at === index ? { ...row, name: event.target.value } : row,
                ),
              })
            }
          />
          <TextField
            label={copy.form.medicationDose}
            value={medication.dose}
            maxLength={200}
            onChange={(event) =>
              setDraft({
                ...draft,
                medications: draft.medications.map((row, at) =>
                  at === index ? { ...row, dose: event.target.value } : row,
                ),
              })
            }
          />
        </RowShell>
      ))}
      <Button
        size="sm"
        onClick={() =>
          setDraft({ ...draft, medications: [...draft.medications, blankMedication()] })
        }
      >
        {copy.form.addMedication}
      </Button>
    </section>
  );
}

/** The severity words, read off the shared table so the form, the card and the sheet cannot disagree. */
const SEVERITY_WORDS: Record<AllergySeverity, { readonly sr: string; readonly en: string }> = {
  mild: CARD_TEXT.severityMild,
  severe: CARD_TEXT.severitySevere,
  anaphylaxis: CARD_TEXT.severityAnaphylaxis,
};

