import { GatewayMessage, GatewayOpcode } from '@parley/shared';

/**
 * Parst eine rohe WebSocket-Nachricht zum Protokoll-Envelope.
 * Liefert null bei ungültigem JSON oder unbekanntem Opcode – der Aufrufer
 * schließt die Verbindung dann mit GatewayCloseCode.InvalidPayload.
 */
export function parseGatewayMessage(raw: string): GatewayMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;

  const op = (data as { op?: unknown }).op;
  if (typeof op !== 'number' || !Object.values(GatewayOpcode).includes(op)) return null;

  return data as GatewayMessage;
}
