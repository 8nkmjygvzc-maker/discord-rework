/** API-Typen rund um Schlüsselverwaltung und -verteilung (Phase 6). */
import type { KeyEnvelopePayload } from './crypto/envelope';

/** Body von PUT /api/keys – nur öffentliche Schlüssel. */
export interface RegisterKeysRequest {
  identityKey: string;
  signedPreKey: string;
  signedPreKeySignature: string;
}

/** Umschlag, wie er in der Mailbox liegt bzw. per Gateway ankommt. */
export interface KeyEnvelopeInfo {
  id: string;
  fromUserId: string;
  payload: KeyEnvelopePayload;
  createdAt: string;
}

/** Body von POST /api/envelopes. */
export interface SendKeyEnvelopeRequest {
  toUserId: string;
  payload: KeyEnvelopePayload;
}
