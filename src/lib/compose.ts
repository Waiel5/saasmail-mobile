/**
 * Turning a draft into a request the send API accepts.
 *
 * `POST /api/send` and `POST /api/send/reply/{emailId}` both take
 * `multipart/form-data` with the payload as a JSON string in a `payload` field
 * rather than a JSON body — that is the shape the API documents, because the
 * same request may carry file parts.
 *
 * The text handling lives in `mail-text.ts`, which has no imports so it can be
 * checked outside a React Native runtime.
 */
import { apiFetch } from './api';
import {
  isEmail,
  parseAddressList,
  textToHtml,
  withSignature,
} from './mail-text';
import type { Inbox } from './types';

export { isEmail, parseAddressList, textToHtml, withSignature };

export interface Draft {
  to: string;
  cc: string;
  from: string;
  subject: string;
  body: string;
}

export interface SentResult {
  id: string | null;
  /**
   * The actual outcome. Every one of these comes back with HTTP 201, so the
   * status code says the request was understood, not that mail was delivered.
   */
  status: 'sent' | 'suppressed' | 'retrying' | 'failed';
  suppressed?: string[];
}

/** Why a draft cannot be sent yet, or null when it can. */
export function draftProblem(draft: Draft, isReply: boolean): string | null {
  if (!draft.from) return 'Choose an address to send from.';
  if (!isReply && !isEmail(draft.to)) return 'Enter a valid recipient address.';
  const badCc = parseAddressList(draft.cc).find((a) => !isEmail(a));
  if (badCc) return `“${badCc}” is not a valid address.`;
  return null;
}

export async function sendDraft(
  serverId: string,
  draft: Draft,
  inbox: Inbox | undefined,
  replyToEmailId?: string,
): Promise<SentResult> {
  const bodyHtml = withSignature(textToHtml(draft.body), inbox?.signatureHtml);
  const cc = parseAddressList(draft.cc).map((email) => ({ email }));

  const payload: Record<string, unknown> = {
    fromAddress: draft.from,
    bodyHtml,
    // Sent alongside the HTML rather than instead of it. A text/plain part is
    // what a screen reader and a plain-text client get, and its absence is a
    // spam signal in its own right.
    bodyText: draft.body.trim(),
    ...(cc.length > 0 ? { cc } : {}),
  };

  // A reply takes neither: the endpoint derives the recipient and the threaded
  // subject from the message being answered.
  if (!replyToEmailId) {
    payload.to = draft.to.trim();
    payload.subject = draft.subject.trim();
  }

  const form = new FormData();
  form.append('payload', JSON.stringify(payload));

  return apiFetch<SentResult>(
    serverId,
    replyToEmailId
      ? `/api/send/reply/${encodeURIComponent(replyToEmailId)}`
      : '/api/send',
    { method: 'POST', body: form },
  );
}
