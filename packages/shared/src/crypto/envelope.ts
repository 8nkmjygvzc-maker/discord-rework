/**
 * Wire-Format der Schlüssel-Umschläge (KeyEnvelope): Ende-zu-Ende-verschlüsselte
 * Nutzlasten von Nutzer zu Nutzer, transportiert über die Server-Mailbox
 * (REST + KEY_ENVELOPE-Gateway-Event). Der Server sieht nur diesen Umschlag,
 * nie den Inhalt. In Phase 6 einziger Typ: Sender-Key-Verteilung.
 */
import { RatchetHeader } from './ratchet';
import { X3dhHeader } from './x3dh';

export interface KeyEnvelopePayload {
  v: 1;
  type: 'senderKeyDistribution';
  /** Nur bei der ersten Nachricht einer neuen Session: X3DH-Initialisierung. */
  x3dh?: X3dhHeader;
  header: RatchetHeader;
  nonce: string;
  /** Ratchet-verschlüsselte SenderKeyDistribution (JSON). */
  ciphertext: string;
}
