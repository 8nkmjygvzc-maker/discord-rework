/**
 * Kurzlebige Übergabe des Login-Passworts an die E2EE-Schicht (Schlüssel-Backup).
 *
 * Beim Login/Registrieren ist das Passwort ohnehin im Client vorhanden – die
 * E2EE-Initialisierung braucht es EINMALIG, um den Backup-Master-Key zu
 * entpacken (Restore auf neuem Gerät) bzw. das Backup einzurichten. Es wird
 * hier nur im Speicher gehalten und gelöscht, sobald es erfolgreich verwendet
 * wurde oder die Sitzung endet. Eigenes Modul statt Import in store/auth,
 * damit kein Zyklus auth ⇄ e2ee entsteht.
 */

let secret: string | null = null;

export function provideLoginSecret(password: string): void {
  secret = password;
}

/** Passwort lesen, OHNE es zu löschen – erst `clearLoginSecret()` nach Erfolg. */
export function peekLoginSecret(): string | null {
  return secret;
}

export function clearLoginSecret(): void {
  secret = null;
}
