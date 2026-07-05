import { describe, expect, it } from 'vitest';
import { GatewayOpcode } from '@parley/shared';
import { parseGatewayMessage } from './gateway.util';

describe('parseGatewayMessage', () => {
  it('parst eine gültige Identify-Nachricht', () => {
    const msg = parseGatewayMessage(
      JSON.stringify({ op: GatewayOpcode.Identify, d: { token: 'abc' } }),
    );
    expect(msg).toEqual({ op: GatewayOpcode.Identify, d: { token: 'abc' } });
  });

  it('lehnt kaputtes JSON ab', () => {
    expect(parseGatewayMessage('{nicht json')).toBeNull();
  });

  it('lehnt Nachrichten ohne numerischen Opcode ab', () => {
    expect(parseGatewayMessage(JSON.stringify({ op: 'HELLO' }))).toBeNull();
    expect(parseGatewayMessage(JSON.stringify({ d: {} }))).toBeNull();
    expect(parseGatewayMessage('null')).toBeNull();
    expect(parseGatewayMessage('"string"')).toBeNull();
  });

  it('lehnt unbekannte Opcodes ab', () => {
    expect(parseGatewayMessage(JSON.stringify({ op: 99 }))).toBeNull();
  });
});
