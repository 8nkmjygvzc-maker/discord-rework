import { describe, expect, it } from 'vitest';
import {
  decodeMessageContent,
  encodeMessageContent,
  encodeReactionContent,
  isPlausibleReactionEmoji,
  MAX_REACTION_EMOJI_LENGTH,
  MAX_REPLY_PREVIEW_LENGTH,
} from './messages';

describe('Nachrichten-Inhaltsformat (Phase 8/9)', () => {
  it('kodiert und dekodiert Text mit Anhängen', () => {
    const meta = {
      id: 'a1',
      name: 'foto.png',
      mimeType: 'image/png',
      sizeBytes: 123,
      key: 'k',
      nonce: 'n',
    };
    const decoded = decodeMessageContent(encodeMessageContent('hallo', [meta]));
    expect(decoded.text).toBe('hallo');
    expect(decoded.attachments).toEqual([meta]);
    expect(decoded.replyTo).toBeNull();
    expect(decoded.reaction).toBeNull();
  });

  it('behandelt Nachrichten aus Phase 6/7 (Rohtext) als Text ohne Extras', () => {
    expect(decodeMessageContent('einfach nur Text')).toEqual({
      text: 'einfach nur Text',
      attachments: [],
      replyTo: null,
      reaction: null,
    });
    // Auch krumme JSON-ähnliche Texte fallen sauber auf Rohtext zurück.
    expect(decodeMessageContent('{kein json').text).toBe('{kein json');
    expect(decodeMessageContent('{"v":2,"x":1}').text).toBe('{"v":2,"x":1}');
  });

  it('transportiert Antwort-Bezüge und klemmt die Zitat-Vorschau', () => {
    const replyTo = {
      messageId: 'm1',
      senderId: 'u1',
      senderUsername: 'frieda',
      preview: 'x'.repeat(500),
    };
    const decoded = decodeMessageContent(encodeMessageContent('antwort', [], replyTo));
    expect(decoded.replyTo?.messageId).toBe('m1');
    expect(decoded.replyTo?.senderUsername).toBe('frieda');
    expect(decoded.replyTo?.preview).toHaveLength(MAX_REPLY_PREVIEW_LENGTH);
  });

  it('verwirft kaputte Antwort-Bezüge statt zu crashen', () => {
    const raw = JSON.stringify({ v: 1, text: 'hi', replyTo: { messageId: 42 } });
    expect(decodeMessageContent(raw).replyTo).toBeNull();
    expect(decodeMessageContent(raw).text).toBe('hi');
  });

  it('kodiert und dekodiert Reaktions-Events', () => {
    const decoded = decodeMessageContent(encodeReactionContent('m1', '👍', 'add'));
    expect(decoded.reaction).toEqual({ targetMessageId: 'm1', emoji: '👍', action: 'add' });
    expect(decoded.text).toBe('');
  });

  it('validiert Reaktions-Events defensiv (Emoji-Länge, action)', () => {
    const tooLong = JSON.stringify({
      v: 1,
      text: '',
      reaction: {
        targetMessageId: 'm1',
        emoji: 'x'.repeat(MAX_REACTION_EMOJI_LENGTH + 1),
        action: 'add',
      },
    });
    expect(decodeMessageContent(tooLong).reaction).toBeNull();
    const badAction = JSON.stringify({
      v: 1,
      text: '',
      reaction: { targetMessageId: 'm1', emoji: '👍', action: 'toggle' },
    });
    expect(decodeMessageContent(badAction).reaction).toBeNull();
  });

  it('verwirft absenderkontrollierte Message-IDs mit Sonderzeichen', () => {
    // z. B. Selector-Injektion: `"]` würde ohne Validierung bis in
    // querySelector(`[data-message-id="…"]`) durchgereicht.
    const badReply = JSON.stringify({
      v: 1,
      text: 'hi',
      replyTo: { messageId: 'x"]', senderId: 'u1', senderUsername: 'f', preview: 'p' },
    });
    expect(decodeMessageContent(badReply).replyTo).toBeNull();
    const badTarget = JSON.stringify({
      v: 1,
      text: '',
      reaction: { targetMessageId: 'a b', emoji: '👍', action: 'add' },
    });
    expect(decodeMessageContent(badTarget).reaction).toBeNull();
  });

  it('akzeptiert nur plausible Emoji-Sequenzen als Reaktion', () => {
    // Echte Emojis inkl. ZWJ-Sequenzen, Hautfarben und Keycaps …
    for (const emoji of ['👍', '❤️', '👩🏽‍💻', '🏳️‍🌈', '1️⃣', '🇩🇪']) {
      expect(isPlausibleReactionEmoji(emoji), emoji).toBe(true);
    }
    // … aber kein Text, keine reinen ASCII-Bausteine, nichts Leeres/Überlanges.
    for (const bad of ['HELLO', '123', '#', 'a👍', '', ' ', '👍'.repeat(20)]) {
      expect(isPlausibleReactionEmoji(bad), JSON.stringify(bad)).toBe(false);
    }
    const textAsEmoji = JSON.stringify({
      v: 1,
      text: '',
      reaction: { targetMessageId: 'm1', emoji: 'LOL!', action: 'add' },
    });
    expect(decodeMessageContent(textAsEmoji).reaction).toBeNull();
  });
});
