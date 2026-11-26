/**
 * Shared route plumbing: origin enforcement and error shaping.
 *
 * Every response body passes through `redact`, so no route can leak a token,
 * an authorization code, or a client secret even if an unexpected error type
 * reaches the handler.
 */

import { NextResponse } from 'next/server';
import { EbayConfigError } from './config';
import { OAuthFlowError } from './oauth-service';
import { OAuthRedirectError } from './oauth';
import { RequestOriginError, verifySameOrigin } from '../http/request-guard';
import { EbayApiError } from './errors';
import { SyncLockedError } from './sync-lock';
import { redactString } from './redact';

export function guardOrigin(request: Request): NextResponse | null {
  try {
    verifySameOrigin(request.headers);
    return null;
  } catch (error) {
    if (error instanceof RequestOriginError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}

/** Maps a thrown error to a status and a sanitized message. */
export function errorResponse(error: unknown): NextResponse {
  const prismaCode = (error as { code?: unknown })?.code;
  // Only a unique-constraint violation is a conflict the operator can act on.
  if (prismaCode === 'P2002') {
    return NextResponse.json({ error: 'The connection or record conflicts with existing data. Verify the selected store and seller before trying again.', code: 'data_conflict' }, { status: 409 });
  }
  // Any other database fault (busy timeout, missing table, missing record) is
  // a server problem. Reporting it as a conflict sent the operator off to
  // reconnect eBay; name the code and keep the detail in the server log.
  if (typeof prismaCode === 'string' && /^P\d{4}$/.test(prismaCode)) {
    console.error(`Database error ${prismaCode}:`, redactString(error instanceof Error ? error.message : String(error)));
    return NextResponse.json({ error: `A database error occurred (${prismaCode}). Nothing is wrong with the eBay connection; check the server log.`, code: 'database_error' }, { status: 500 });
  }
  if (error instanceof EbayConfigError) {
    // Not configured yet is an operator task, not a server fault.
    return NextResponse.json(
      { error: error.message, code: 'not_configured' },
      { status: 503 }
    );
  }

  if (error instanceof OAuthRedirectError || error instanceof OAuthFlowError) {
    return NextResponse.json(
      { error: error.message, code: 'oauth_failed' },
      { status: 400 }
    );
  }

  if (error instanceof SyncLockedError) {
    // Not a failure: a sync is already running. 409 rather than 500 is what
    // lets the UI say "already running" instead of "sync failed".
    return NextResponse.json(
      {
        error: error.message,
        code: 'already_running',
        holder: error.holder,
        expiresAt: error.expiresAt,
      },
      { status: 409 }
    );
  }

  if (error instanceof EbayApiError) {
    return NextResponse.json(
      { error: error.message, code: 'ebay_error', status: error.status },
      { status: 502 }
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json(
    { error: redactString(message), code: 'internal_error' },
    { status: 500 }
  );
}
