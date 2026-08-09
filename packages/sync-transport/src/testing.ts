/**
 * A recording {@link HttpPort} for this package's own tests.
 *
 * NOT exported from the barrel, and deliberately not a `/testing` subpath: it is
 * a test double for the transport's own suites, not a public fixture, and a
 * fixture that ships is one more thing that can end up in a bundle. The one
 * public seam is the port itself — anybody wiring a real one supplies it.
 */

import type { HttpPort, HttpRequest, HttpResponse } from "./http.js";

export interface RecordedPort {
  readonly port: HttpPort;
  readonly requests: readonly HttpRequest[];
}

/**
 * Answers each call with the next canned response, in order, and records what it
 * was asked.
 *
 * Running out of responses THROWS rather than repeating the last one: a test
 * that made an unexpected extra request is a test whose subject did something it
 * was not asked to, and quietly answering it is how a second round trip becomes
 * invisible.
 */
export function recordingPort(responses: readonly HttpResponse[]): RecordedPort {
  const requests: HttpRequest[] = [];
  let index = 0;
  const port: HttpPort = async (request) => {
    requests.push(request);
    const response = responses[index];
    index += 1;
    if (response === undefined) {
      throw new Error(`recordingPort: unexpected request ${request.method} ${request.path}`);
    }
    return response;
  };
  return { port, requests };
}

/** A port that always throws, for the „the network was not there" path. */
export function failingPort(message = "offline"): HttpPort {
  return async () => {
    throw new Error(message);
  };
}

export const ok = (body: string): HttpResponse => ({ status: 200, body });
export const created = (body: string): HttpResponse => ({ status: 201, body });
export const failed = (status: number, body: string): HttpResponse => ({ status, body });
