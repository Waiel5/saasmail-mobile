/**
 * Both send endpoints take `multipart/form-data` with the JSON in a `payload`
 * field, not a JSON body — the same request may carry file parts.
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
  /** All four arrive as HTTP 201; the status code means understood, not delivered. */
  status: 'sent' | 'suppressed' | 'retrying' | 'failed';
  suppressed?: string[];
}

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
    // Sent alongside the HTML, not instead of it: a missing text/plain part is
    // a spam signal on its own.
    bodyText: draft.body.trim(),
    ...(cc.length > 0 ? { cc } : {}),
  };

  // The reply endpoint derives recipient and threaded subject from the message
  // being answered, so sending them is wrong.
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
