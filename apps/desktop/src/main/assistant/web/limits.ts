/**
 * The caps a web request runs under (ADR-097).
 *
 * Every number here answers a question the open web asks without being invited
 * to: how many bytes of a reply this process will hold, how long it will wait,
 * how many hops it will follow, and how many results it will hand the model.
 * They are not measured constants — they are choices, and the reason each one
 * is what it is sits beside it, because a cap nobody can justify is a cap
 * nobody will defend when a page fails to load.
 */
export const WEB_LIMITS = {
  /**
   * Bytes of a search reply. A search reply is JSON with a handful of snippets;
   * half a megabyte is far past the largest honest one and far short of what an
   * instance that answers with an error page (or a whole archive) would cost.
   */
  searchBytes: 512 * 1024,
  /**
   * Bytes of a page. Two megabytes is the point where a page stops being an
   * article: it is roughly a hundred A4 pages of text, several times the
   * largest Wikipedia article, and it is what keeps a link to a video file or
   * a disk image from being read into the process that draws the window.
   */
  readBytes: 2 * 1024 * 1024,
  /**
   * Characters of extracted text. The cap is on the MODEL's side of the fence,
   * not the socket's: two megabytes of markup is typically a fifth of that in
   * prose, and this is what a context window can actually hold.
   */
  readChars: 40_000,
  /**
   * Results kept from a search reply, after the parser has read it. Eight is
   * what a person scans before choosing, and every extra result is context the
   * model spends on a link nobody will open.
   */
  searchResults: 8,
  /**
   * Characters accepted in a query. Long enough for a full Serbian sentence,
   * short enough that the query itself cannot be the payload of a request the
   * user approved as a search.
   */
  queryChars: 300,
  /**
   * Redirect hops followed, each one re-vetted. Five is the same bound
   * `download/service.ts` uses, and for the same reason: a chain longer than
   * this is not a page, it is a machine walking this process somewhere.
   */
  maxRedirects: 5,
  /**
   * Milliseconds for a whole search request, and for a whole page. A search is
   * an API call and has no reason to be slow; a page may be large, so it gets
   * more. Both are the WHOLE request — the idle deadline below is the one that
   * catches a socket that has stopped answering.
   */
  searchTimeoutMs: 15_000,
  readTimeoutMs: 30_000,
  /**
   * Milliseconds with no byte received before the request is destroyed. A slow
   * but live page may take as long as its deadline allows; a connection that
   * has stopped must not hold the assistant's turn open for ever.
   */
  idleTimeoutMs: 10_000,
  /**
   * Addresses one host name may resolve to before it is refused outright. A
   * name with more answers than this is a load-balancer or a CDN the SSRF check
   * cannot meaningfully speak about — and every one of them has to be public
   * for the name to be used at all.
   */
  maxAddresses: 24,
} as const;
