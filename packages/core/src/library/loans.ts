/**
 * A loan: a work lent to a person, from a day, due back on an optional day, and
 * returned on a day once it is back.
 *
 * **One row per lending, and the history is the rows.** A work has at most one
 * ACTIVE loan (the store and a partial unique index both say so), but every
 * earlier lending stays as a row with its `returnedOn` set, so "who had it last
 * spring" is a question the data answers.
 *
 * **Overdue is a comparison, not a stored state.** A loan is overdue when it has
 * not come back and its due day is before today. Storing the flag would need a
 * job to set it on the day it turns true; comparing two bare days answers the
 * same question every time the page is drawn.
 */

/** The longest name a loan may be made to. A policy bound, the length a creator's name gets. */
export const LIBRARY_MAX_LOAN_TO_LENGTH = 120;

export interface LibraryLoan {
  readonly id: string;
  readonly itemId: string;
  /** Who has the work: free text, because a lender may name a friend, a shop or a shelf. */
  readonly to: string;
  /** The bare local day the work left. */
  readonly lentOn: string;
  /** The bare local day it is due back, or null when nobody set one. */
  readonly dueOn: string | null;
  /** The bare local day it came back, or null while the loan is active. */
  readonly returnedOn: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Whether a loan is overdue on `today`. Both days are bare local dates, which
 * sort as strings in calendar order, so a plain comparison is the calendar
 * comparison.
 */
export function isLibraryLoanOverdue(
  loan: Pick<LibraryLoan, "dueOn" | "returnedOn">,
  today: string,
): boolean {
  return loan.returnedOn === null && loan.dueOn !== null && loan.dueOn < today;
}
