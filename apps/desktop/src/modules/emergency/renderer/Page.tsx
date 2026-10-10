import { useCallback, useEffect, useState } from "react";
import { buildCardModel, cardCompleteness } from "@nexus/core";
import type { CardGap, CardModel, EmergencyCardSource } from "@nexus/core";
import { Button, EmptyState, LoadingState, PageHeader } from "@nexus/ui";
import type { ModulePageProps } from "../../../shared/moduleApi.js";
import { activeLocale, declaredText } from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { CardPrintFormat, EmergencyView } from "../shared/ipc.js";
import { MODULE_NAME, manifest } from "../shared/manifest.js";
import { CardForm } from "./CardForm.js";
import { CardView } from "./CardView.js";
import { ContactsEditor } from "./ContactsEditor.js";
import { cardFormOf, emptyCardForm, type EmergencyRun } from "./card.js";
import { copy } from "./copy.js";
import { iconName } from "./icon.js";
import "./emergency.css";

/**
 * HITNA KARTA (ADR-090) - the module's page.
 *
 * **Two modes, and the card is the default one.** This page is read by the person
 * who owns it and, in the moment it exists for, by somebody else entirely; so the
 * page opens on the CARD - large type, one block after another, in the languages
 * the card prints in - and editing is one button away. Opening on a form would
 * mean the page a stranger is handed looks like a database.
 *
 * **The card is built from the model, not from the wire.** `buildCardModel`
 * (`@nexus/core`) decides which sections exist, in which order and how a
 * reference that has gone missing reads; main builds the SAME model for the
 * printed sheet. So the preview is not an impression of the PDF - it is the same
 * document, drawn twice, and a section cannot appear on paper and not on screen.
 *
 * **Nothing here is heavy.** The model is a walk over a card, a short contact
 * list and two libraries the view already carries, so it runs on the page's own
 * thread; there is no worker, and there is nothing for one to do.
 *
 * **The module owns its own copy.** Nothing here reads the shell's `strings`
 * table: `copy.ts` is this module's table, rewritten in place by the same
 * `applyLocale` walk the shell's goes through, and it arrives with this chunk.
 */

export default function EmergencyPage({ profileId }: ModulePageProps) {
  const [view, setView] = useState<EmergencyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  /** One read, into state. Every mutation answers with the same shape, so there is exactly one way this page learns anything. */
  const run = useCallback<EmergencyRun>(async (action) => {
    try {
      setView(await action(window.nexus.modules.emergency));
      setError(null);
    } catch (failure) {
      setError(copy.errors.mutate);
      console.error("Nexus: an emergency-card change failed:", failure);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setView(await window.nexus.modules.emergency.list({ profileId }));
      setError(null);
    } catch (failure) {
      setError(copy.errors.load);
      console.error("Nexus: the emergency card could not be loaded:", failure);
    }
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const card = view?.card ?? null;
  const source: EmergencyCardSource | null =
    view === null || card === null
      ? null
      : {
          fullName: card.fullName,
          dateOfBirth: card.dateOfBirth,
          bloodType: card.bloodType,
          allergies: card.allergies,
          conditions: card.conditions,
          medications: card.medications,
          organDonor: card.organDonor,
          healthInsuranceNumber: card.healthInsuranceNumber,
          doctorName: card.doctorName,
          doctorPhone: card.doctorPhone,
          notes: card.notes,
          printLanguage: card.printLanguage,
          contacts: view.contacts,
          documents: view.documents,
        };
  const model: CardModel | null =
    source === null || view === null
      ? null
      : buildCardModel(source, view.people, view.documentChoices, activeLocale());

  /** What the card still needs before it is worth printing (`cardCompleteness`, one module over). */
  const gaps =
    view === null || card === null
      ? []
      : cardCompleteness({ ...sourceFields(card), contacts: view.contacts });

  /** The contact list is only offered once a card exists: its rows hang off the card (`migration 078`). */
  const contacts =
    view === null || card === null ? null : (
      <ContactsEditor profileId={profileId} view={view} run={run} />
    );

  async function print(format: CardPrintFormat): Promise<void> {
    setNotice(null);
    try {
      const result = await window.nexus.modules.emergency.printCard({ profileId, format });
      // A cancelled dialog says nothing: the user knows what they did, and a
      // message about it would be the app commenting on a non-event.
      setNotice(result.saved ? copy.card.printSaved : null);
      setError(null);
    } catch (failure) {
      setError(copy.errors.print);
      console.error("Nexus: the emergency card could not be printed:", failure);
    }
  }

  async function removeCard(): Promise<void> {
    setConfirming(false);
    setEditing(false);
    setNotice(null);
    await run((api) => api.removeCard({ profileId }));
  }

  return (
    <div className="emergency">
      {/* The page's own name is the word the module DECLARED, read in the
          language being spoken, rather than a second copy of it (ADR-090's copy
          split). */}
      <PageHeader
        title={declaredText(manifest.copy?.name)}
        subtitle={copy.page.subtitle}
        sigil={iconName}
      />
      {error !== null && (
        <p className="emergency__error" role="alert">
          {error}
        </p>
      )}
      {view === null ? (
        error === null && <LoadingState label={copy.page.loading} rows={5} />
      ) : editing ? (
        <CardForm
          initial={card === null ? emptyCardForm() : cardFormOf(card)}
          onSave={async (fields) => {
            // A create and an update are the same form: which of the two this is
            // depends on whether the profile has a card at all, and the page is
            // the only thing that knows - the store refuses the wrong one.
            await run((api) =>
              card === null
                ? api.createCard({ profileId, fields })
                : api.updateCard({ profileId, fields }),
            );
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          contacts={contacts}
        />
      ) : card === null || model === null ? (
        <EmptyState
          sigil={iconName}
          title={copy.empty.title}
          description={copy.empty.body}
          action={
            <Button variant="primary" onClick={() => setEditing(true)}>
              {copy.form.create}
            </Button>
          }
        />
      ) : (
        <>
          <Completeness gaps={gaps} />
          <div className="emergency__controls">
            <Button variant="primary" onClick={() => setEditing(true)}>
              {copy.card.edit}
            </Button>
            <Button onClick={() => void print("a6")}>{copy.card.printA6}</Button>
            <Button onClick={() => void print("card-a4")}>{copy.card.printCardOnA4}</Button>
            <span className="nx-hint emergency__print-hint">{copy.card.printHint}</span>
            {confirming ? (
              <span className="emergency__confirm">
                <span className="nx-hint">{copy.card.removeQuestion}</span>
                <Button onClick={() => void removeCard()}>{copy.card.confirmRemove}</Button>
                <Button variant="quiet" onClick={() => setConfirming(false)}>
                  {copy.card.cancelRemove}
                </Button>
                <span className="nx-hint">{copy.card.removeNote}</span>
              </span>
            ) : (
              <Button variant="quiet" onClick={() => setConfirming(true)}>
                {copy.card.remove}
              </Button>
            )}
          </div>
          {notice !== null && <p className="nx-hint">{notice}</p>}
          <CardView model={model} title={MODULE_NAME} />
        </>
      )}
    </div>
  );
}

/**
 * The three questions the card still has to be told the answers to, in the order
 * it prints them - or the sentence that says it needs nothing more.
 *
 * Each prompt names the gap in the module's own words rather than repeating the
 * card's headings: the card already prints „Alergije"; what this line adds is
 * that the question was never ANSWERED, which is the one state the card itself
 * shows by staying silent.
 */
function Completeness({ gaps }: { gaps: readonly CardGap[] }) {
  if (gaps.length === 0) return <p className="nx-hint">{copy.gaps.complete}</p>;
  return (
    <div className="emergency__gaps">
      <span className="emergency__label">{copy.gaps.title}</span>
      <ul className="emergency__gap-list">
        {gaps.map((gap) => (
          <li key={gap} className="nx-hint">
            {gap === "bloodType"
              ? copy.gaps.bloodType
              : gap === "allergies"
                ? copy.gaps.allergies
                : copy.gaps.contacts}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The card's fields without its two lists - what `cardCompleteness` needs beside the contacts it is asked about. */
function sourceFields(card: NonNullable<EmergencyView["card"]>) {
  return {
    fullName: card.fullName,
    dateOfBirth: card.dateOfBirth,
    bloodType: card.bloodType,
    allergies: card.allergies,
    conditions: card.conditions,
    medications: card.medications,
    organDonor: card.organDonor,
    healthInsuranceNumber: card.healthInsuranceNumber,
    doctorName: card.doctorName,
    doctorPhone: card.doctorPhone,
    notes: card.notes,
    printLanguage: card.printLanguage,
  };
}
