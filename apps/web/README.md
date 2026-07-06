# @parley/web

React-Frontend (Vite, TailwindCSS 4, Zustand).

## Entwicklung

```bash
npm run dev -w @parley/web    # Dev-Server auf http://localhost:5173
npm run build -w @parley/web  # Typecheck + Produktions-Build nach dist/
```

Im Dev-Modus werden `/api`-Anfragen per Vite-Proxy an das Backend (Port 3001) weitergeleitet – dadurch ist kein CORS nötig. Das Backend sollte also parallel laufen (`npm run dev:api` im Root).

## Ende-zu-Ende-Verschlüsselung (Phase 6)

Sämtliche Ver-/Entschlüsselung passiert im Browser – der Server sieht nur Ciphertext:

- `src/lib/e2ee.ts` – Orchestrierung: Schlüssel erzeugen/veröffentlichen, X3DH-Sessions und Double-Ratchet zu anderen Nutzern, Sender-Key pro Kanal (verteilen, rotieren), Nachrichten ver-/entschlüsseln. Krypto-Primitiven kommen aus `@parley/shared` (libsodium).
- `src/lib/cryptoDb.ts` – IndexedDB-Wrapper für das Schlüsselmaterial, eine DB pro Nutzer. **Private Schlüssel verlassen den Browser nie.**
- Multi-Tab-Sicherheit über Web Locks; entschlüsselte Texte leben nur im Speicher (`store/messages.ts`, nie persistiert).

Konsequenz des „ein Gerät pro Account“-Modells (v1): Die Identität hängt am Browser-Profil. Neuer Browser oder gelöschte Site-Daten ⇒ neue Schlüssel, ältere Nachrichten bleiben dauerhaft unlesbar (UI zeigt einen 🔒-Platzhalter). Mitglieder erhalten fehlende Sender-Keys automatisch beim nächsten Senden des Absenders.
