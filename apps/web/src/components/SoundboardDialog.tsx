import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  hasPermission,
  MAX_SOUNDBOARD_NAME_LENGTH,
  Permissions,
  permissionsFromString,
  SoundboardSoundInfo,
} from '@parley/shared';
import Modal from './Modal';
import { useAuthStore } from '../store/auth';
import { useServersStore } from '../store/servers';
import { useSettingsStore } from '../store/settings';
import { useSoundboardStore } from '../store/soundboard';
import { useVoiceStore } from '../store/voice';
import { formatBytes } from '../lib/attachments';

/**
 * Soundboard (Discord-artig): Grid aller Server-Sounds; Klick spielt den Sound
 * für ALLE im Sprachkanal ab (REST → SOUNDBOARD_PLAY-Event). Mit
 * ManageSoundboard lassen sich Sounds hochladen, bearbeiten und löschen –
 * eigene Uploads darf man immer löschen. Die UI blendet nur aus, durchgesetzt
 * wird serverseitig.
 */
export default function SoundboardDialog({ onClose }: { onClose: () => void }) {
  const selfId = useAuthStore((s) => s.user?.id);
  const activeServerId = useVoiceStore((s) => s.activeServerId);
  const selectedServer = useServersStore((s) => s.selectedServer);
  const sounds = useSoundboardStore((s) => s.sounds);
  const loading = useSoundboardStore((s) => s.loading);
  const error = useSoundboardStore((s) => s.error);
  const nowPlaying = useSoundboardStore((s) => s.nowPlaying);
  const play = useSoundboardStore((s) => s.play);

  // Rechte kennen wir nur, wenn der Sprachkanal-Server auch der ausgewählte
  // ist (myPermissions kommt aus dessen ServerDetails) – sonst nur abspielen.
  const myPerms =
    selectedServer && selectedServer.id === activeServerId
      ? permissionsFromString(selectedServer.myPermissions)
      : 0n;
  const canManage = hasPermission(myPerms, Permissions.ManageSoundboard);

  const [editing, setEditing] = useState<SoundboardSoundInfo | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  if (!activeServerId) return null;

  return (
    <Modal title="Soundboard" onClose={onClose}>
      {nowPlaying && (
        <p className="mb-3 truncate rounded bg-emerald-950/50 px-2 py-1 text-xs text-emerald-300">
          🔊 {nowPlaying.username} spielt „{nowPlaying.label}“
        </p>
      )}
      <LocalVolumeSlider />
      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      {loading && sounds.length === 0 ? (
        <p className="text-sm text-zinc-400">Lade Sounds …</p>
      ) : sounds.length === 0 ? (
        <p className="text-sm text-zinc-400">
          Noch keine Sounds auf diesem Server.
          {canManage ? ' Lade unten den ersten hoch!' : ''}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {sounds.map((sound) => {
            const canDelete = canManage || sound.uploaderId === selfId;
            return (
              <div key={sound.id} className="group relative">
                <button
                  type="button"
                  title={`„${sound.name}“ für alle abspielen (${formatBytes(sound.sizeBytes)})`}
                  onClick={() => void play(sound.id)}
                  className="flex w-full flex-col items-center gap-1 rounded-lg bg-zinc-900 px-2 py-3 hover:bg-zinc-700"
                >
                  <span className="text-2xl leading-none">{sound.emoji ?? '🔊'}</span>
                  <span className="w-full truncate text-center text-xs text-zinc-300">
                    {sound.name}
                  </span>
                </button>
                {canManage && (
                  <button
                    type="button"
                    title="Bearbeiten"
                    onClick={() => {
                      setFormError(null);
                      setEditing(sound);
                    }}
                    className="absolute left-1 top-1 hidden rounded bg-zinc-800/90 px-1 text-xs group-hover:block hover:bg-zinc-600"
                  >
                    ✏️
                  </button>
                )}
                {canDelete && <DeleteButton serverId={activeServerId} soundId={sound.id} />}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <EditForm
          key={editing.id}
          serverId={activeServerId}
          sound={editing}
          onDone={() => setEditing(null)}
        />
      )}

      {canManage && !editing && (
        <UploadForm serverId={activeServerId} error={formError} setError={setFormError} />
      )}
    </Modal>
  );
}

/**
 * Lokale Wiedergabelautstärke (Einstellungs-Store, Feinschliff): wirkt sofort –
 * auch auf gerade spielende Sounds – und nur für einen selbst.
 */
function LocalVolumeSlider() {
  const volume = useSettingsStore((s) => s.soundboardVolume);
  const setVolume = useSettingsStore((s) => s.setSoundboardVolume);
  return (
    <label
      className="mb-3 flex items-center gap-2 text-xs text-zinc-400"
      title="Nur für dich – wirkt sofort, auch auf gerade spielende Sounds"
    >
      🔊 Lautstärke
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={(e) => setVolume(Number(e.target.value) / 100)}
        className="flex-1"
        data-testid="soundboard-local-volume"
      />
      <span className="w-9 text-right tabular-nums">{Math.round(volume * 100)}%</span>
    </label>
  );
}

function DeleteButton({ serverId, soundId }: { serverId: string; soundId: string }) {
  const remove = useSoundboardStore((s) => s.remove);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      title="Sound löschen"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        remove(serverId, soundId)
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
      className="absolute right-1 top-1 hidden rounded bg-zinc-800/90 px-1 text-xs group-hover:block hover:bg-red-900 disabled:opacity-50"
    >
      🗑️
    </button>
  );
}

/** Neuen Sound hochladen: Datei (Auswahl ODER Drag & Drop) + Name + Emoji + Lautstärke. */
function UploadForm({
  serverId,
  error,
  setError,
}: {
  serverId: string;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const upload = useSoundboardStore((s) => s.upload);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [volume, setVolume] = useState(100);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const pickFile = (chosen: File | undefined) => {
    if (!chosen) return;
    setError(null);
    setFile(chosen);
    // Namensvorschlag aus dem Dateinamen (ohne Endung), solange keiner dasteht.
    setName((current) =>
      current ? current : chosen.name.replace(/\.[^.]+$/, '').slice(0, MAX_SOUNDBOARD_NAME_LENGTH),
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Bitte eine Audiodatei auswählen oder hineinziehen');
      return;
    }
    if (!name.trim()) {
      setError('Bitte einen Namen angeben');
      return;
    }
    setBusy(true);
    setError(null);
    upload(serverId, file, {
      name: name.trim(),
      emoji: emoji.trim() || undefined,
      volume: volume / 100,
    })
      .then(() => {
        setFile(null);
        setName('');
        setEmoji('');
        setVolume(100);
        if (fileRef.current) fileRef.current.value = '';
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 border-t border-zinc-700 pt-4">
      <h3 className="text-sm font-semibold text-zinc-200">Sound hinzufügen</h3>
      <p className="mt-1 text-xs text-zinc-500">
        Audiodatei bis 10 MiB, beliebige Länge – die Anzahl der Sounds ist unbegrenzt.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        onChange={(e) => {
          pickFile(e.target.files?.[0]);
          e.target.value = ''; // gleiche Datei erneut wählbar
        }}
        className="hidden"
      />
      {/* Drop-Zone: Klick öffnet die Dateiauswahl, Dateien lassen sich hineinziehen. */}
      <button
        type="button"
        data-testid="sound-drop-zone"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pickFile(e.dataTransfer.files?.[0]);
        }}
        className={`mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-3 text-xs transition ${
          dragOver
            ? 'border-indigo-400 bg-indigo-950/50 text-indigo-200'
            : 'border-zinc-600 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'
        }`}
      >
        {file ? (
          <>
            🎵 <span className="max-w-56 truncate">{file.name}</span>
            <span className="text-zinc-500">({formatBytes(file.size)})</span>
          </>
        ) : (
          <>🎵 Audiodatei hierher ziehen oder klicken</>
        )}
      </button>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={name}
          maxLength={MAX_SOUNDBOARD_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
        <input
          type="text"
          value={emoji}
          maxLength={8}
          onChange={(e) => setEmoji(e.target.value)}
          placeholder="Emoji"
          className="w-16 rounded bg-zinc-900 px-2 py-1 text-center text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
      </div>
      <VolumeSlider value={volume} onChange={setVolume} />
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="mt-3 w-full rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? 'Lädt hoch …' : 'Hochladen'}
      </button>
    </form>
  );
}

/** Vorhandenen Sound bearbeiten (Name/Emoji/Lautstärke; Emoji leer = entfernen). */
function EditForm({
  serverId,
  sound,
  onDone,
}: {
  serverId: string;
  sound: SoundboardSoundInfo;
  onDone: () => void;
}) {
  const update = useSoundboardStore((s) => s.update);
  const [name, setName] = useState(sound.name);
  const [emoji, setEmoji] = useState(sound.emoji ?? '');
  const [volume, setVolume] = useState(Math.round(sound.volume * 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wird der Sound anderweitig gelöscht (Event), schließt sich das Formular.
  const stillThere = useSoundboardStore((s) => s.sounds.some((x) => x.id === sound.id));
  useEffect(() => {
    if (!stillThere) onDone();
  }, [stillThere, onDone]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Bitte einen Namen angeben');
      return;
    }
    setBusy(true);
    setError(null);
    update(serverId, sound.id, {
      name: name.trim(),
      emoji: emoji.trim() || null,
      volume: volume / 100,
    })
      .then(onDone)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 border-t border-zinc-700 pt-4">
      <h3 className="text-sm font-semibold text-zinc-200">„{sound.name}“ bearbeiten</h3>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={name}
          maxLength={MAX_SOUNDBOARD_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
        <input
          type="text"
          value={emoji}
          maxLength={8}
          onChange={(e) => setEmoji(e.target.value)}
          placeholder="Emoji"
          className="w-16 rounded bg-zinc-900 px-2 py-1 text-center text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
      </div>
      <VolumeSlider value={volume} onChange={setVolume} />
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Speichern
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600"
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function VolumeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
      Lautstärke
      <input
        type="range"
        min={5}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="w-9 text-right tabular-nums">{value}%</span>
    </label>
  );
}
