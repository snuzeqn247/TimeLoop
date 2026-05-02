import { useEffect, useRef, useState } from "react";
import { PinnedObject } from "@siafoundation/sia-storage";
import { useAuthStore } from "../../stores/auth";

const ANNIVERSARY_WINDOW_DAYS = 3;
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const UNLOCK_TOAST_STORAGE_KEY = "timeloop-unlock-toasts-shown";
const FINAL_DAY_MS = 24 * 60 * 60 * 1000;

type MemoryStatus =
  | { kind: "uploading"; shardsDone: number }
  | { kind: "stored" }
  | { kind: "error"; message: string };

type MemoryMode = "past" | "capsule";

type Memory = {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  size: number;
  mode: MemoryMode;
  anchorDate: string; // YYYY-MM-DD
  uploadedAt: string; // ISO timestamp
  status: MemoryStatus;
  proof: string;
  pinnedObject?: PinnedObject;
};

type ConfirmDialogState = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone: "danger" | "indigo";
  onConfirm: () => void;
};

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDateLong(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isLikelyUUID(s: string) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
    s,
  );
}

function isLikelyCameraExport(s: string) {
  return /^(IMG|DSC|DCIM|PXL|VID|MVI|GOPR)[_-]?\d+/i.test(s);
}

function titleFromFile(name: string) {
  const base = name.replace(/\.[^/.]+$/, "");
  if (isLikelyUUID(base) || isLikelyCameraExport(base) || base.length < 3) {
    return "";
  }
  return base.replace(/[-_]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function shortProof(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  let h2 = 0;
  for (let i = seed.length - 1; i >= 0; i--)
    h2 = (h2 * 17 + seed.charCodeAt(i)) | 0;
  const a = (h >>> 0).toString(16).padStart(8, "0");
  const b = (h2 >>> 0).toString(16).padStart(8, "0");
  return `sia://${a}-${b}`;
}

function daysToNearestAnniversary(memoryDateISO: string, today: Date): number {
  const md = new Date(`${memoryDateISO}T00:00:00`);
  const dayMs = 24 * 60 * 60 * 1000;
  const candidates = [
    new Date(today.getFullYear() - 1, md.getMonth(), md.getDate()),
    new Date(today.getFullYear(), md.getMonth(), md.getDate()),
    new Date(today.getFullYear() + 1, md.getMonth(), md.getDate()),
  ];
  return Math.min(
    ...candidates.map((c) => Math.abs((c.getTime() - today.getTime()) / dayMs)),
  );
}

function isAnniversary(memoryDateISO: string, today: Date): boolean {
  const md = new Date(`${memoryDateISO}T00:00:00`);
  if (md.getFullYear() >= today.getFullYear()) return false;
  return (
    daysToNearestAnniversary(memoryDateISO, today) <= ANNIVERSARY_WINDOW_DAYS
  );
}

function yearsAgo(memoryDateISO: string, today: Date): number {
  const md = new Date(`${memoryDateISO}T00:00:00`);
  return today.getFullYear() - md.getFullYear();
}

function isLockedCapsule(memory: Memory, now: Date): boolean {
  if (memory.mode !== "capsule") return false;
  const unlock = new Date(`${memory.anchorDate}T00:00:00`);
  return unlock.getTime() > now.getTime();
}

function msUntilUnlock(memory: Memory, now: Date): number {
  const unlock = new Date(`${memory.anchorDate}T00:00:00`);
  return unlock.getTime() - now.getTime();
}

function longCountdown(targetISO: string, now: Date): string {
  const target = new Date(`${targetISO}T00:00:00`);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "Unlocking now";

  let years = 0;
  let months = 0;
  const cursor = new Date(now);
  while (true) {
    const next = new Date(cursor);
    next.setFullYear(next.getFullYear() + 1);
    if (next.getTime() > target.getTime()) break;
    years++;
    cursor.setTime(next.getTime());
  }
  while (true) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    if (next.getTime() > target.getTime()) break;
    months++;
    cursor.setTime(next.getTime());
  }
  const remainingMs = target.getTime() - cursor.getTime();
  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? "month" : "months"}`);
  if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (parts.length === 0) parts.push("less than a day");
  return parts.slice(0, 3).join(", ");
}

function liveCountdown(targetISO: string, now: Date): string {
  const target = new Date(`${targetISO}T00:00:00`);
  let totalSeconds = Math.max(
    0,
    Math.floor((target.getTime() - now.getTime()) / 1000),
  );
  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds -= hours * 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function inferMimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  return "";
}

function isPreviewableImage(memory: Memory): boolean {
  if (memory.size > PREVIEW_MAX_BYTES) return false;
  const type = memory.fileType || inferMimeFromName(memory.fileName);
  return type.startsWith("image/") && type !== "image/heic";
}

function genericKindLabel(memory: Memory): string {
  const type = (
    memory.fileType || inferMimeFromName(memory.fileName)
  ).toLowerCase();
  if (type.startsWith("image/")) return "Image";
  if (type.startsWith("video/")) return "Video";
  if (type.startsWith("audio/")) return "Audio";
  if (type === "application/pdf") return "Document";
  if (type.startsWith("text/")) return "Text";
  if (
    type.includes("word") ||
    type.includes("document") ||
    type.includes("rtf")
  )
    return "Document";
  return "File";
}

function loadShownUnlockToasts(): Set<string> {
  try {
    const raw = localStorage.getItem(UNLOCK_TOAST_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveShownUnlockToasts(set: Set<string>) {
  try {
    localStorage.setItem(
      UNLOCK_TOAST_STORAGE_KEY,
      JSON.stringify(Array.from(set)),
    );
  } catch {
    // ignore
  }
}

// Trigger a browser download of a Blob as a file
function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so the download has time to start
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MemoryThumbnail({
  memory,
  onDownload,
  busy,
}: {
  memory: Memory;
  onDownload: () => void;
  busy: boolean;
}) {
  const sdk = useAuthStore((s) => s.sdk);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    if (
      !sdk ||
      !memory.pinnedObject ||
      memory.status.kind !== "stored" ||
      !isPreviewableImage(memory)
    ) {
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const stream = sdk.download(memory.pinnedObject!, { maxInflight: 10 });
        const blob = await new Response(stream).blob();
        if (cancelled) return;
        const mime =
          memory.fileType ||
          inferMimeFromName(memory.fileName) ||
          "application/octet-stream";
        const typedBlob = blob.type ? blob : new Blob([blob], { type: mime });
        createdUrl = URL.createObjectURL(typedBlob);
        setPreviewUrl(createdUrl);
      } catch (err) {
        console.error("Failed to load preview:", err);
        if (!cancelled) setPreviewError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [
    sdk,
    memory.pinnedObject,
    memory.status.kind,
    memory.fileName,
    memory.fileType,
    memory.size,
  ]);

  if (!isPreviewableImage(memory) || memory.status.kind !== "stored") {
    return null;
  }

  if (previewError) {
    return (
      <div className="mb-4 flex h-48 items-center justify-center rounded-2xl bg-neutral-100 text-sm text-neutral-500">
        Preview unavailable
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="mb-4 flex h-48 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50/50">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
          </span>
          Decrypting from Sia...
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onDownload}
      disabled={busy}
      title="Click to download the original file"
      className="group relative mb-4 block w-full overflow-hidden rounded-2xl"
    >
      <img
        src={previewUrl}
        alt={memory.title || memory.fileName}
        className="max-h-96 w-full object-cover transition-transform group-hover:scale-[1.01]"
      />
      <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-3 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
          {busy ? "Downloading..." : "Click to download"}
        </span>
      </div>
    </button>
  );
}

function LockedCard({
  memory,
  now,
  onCancelCapsule,
}: {
  memory: Memory;
  now: Date;
  onCancelCapsule: (memory: Memory) => void;
}) {
  const remaining = msUntilUnlock(memory, now);
  const inFinalDay = remaining <= FINAL_DAY_MS;

  return (
    <article className="relative rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-6 shadow-sm">
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-3xl shadow-sm">
          🔒
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-indigo-700">
            Time capsule · sealed
          </p>
          <p className="mt-2 text-lg font-semibold text-neutral-900">
            A memory locked until {formatDateLong(memory.anchorDate)}
          </p>
          {inFinalDay ? (
            <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-indigo-700">
              {liveCountdown(memory.anchorDate, now)}
            </p>
          ) : (
            <p className="mt-3 text-sm text-indigo-900/80">
              Opens in {longCountdown(memory.anchorDate, now)}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-indigo-900/70">
            <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 font-medium">
              Sealed {formatDateTime(memory.uploadedAt)}
            </span>
            <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 font-medium">
              {genericKindLabel(memory)}
            </span>
          </div>
          <p className="mt-3 text-xs text-indigo-900/60">
            <span className="font-semibold uppercase tracking-[0.18em]">
              Capsule ID ·{" "}
            </span>
            <span className="font-mono">{memory.proof}</span>
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onCancelCapsule(memory)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-500 transition-colors hover:bg-white hover:text-indigo-800"
        >
          Cancel capsule
        </button>
      </div>
    </article>
  );
}

function ConfirmDialog({
  state,
  onCancel,
}: {
  state: ConfirmDialogState;
  onCancel: () => void;
}) {
  if (!state.open) return null;
  const confirmClass =
    state.tone === "indigo"
      ? "bg-indigo-600 hover:bg-indigo-700"
      : "bg-rose-600 hover:bg-rose-700";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold text-neutral-900">
          {state.title}
        </h2>
        <p className="mt-3 text-sm text-neutral-600">{state.body}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl bg-neutral-100 px-5 py-2.5 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-200"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={() => {
              state.onConfirm();
            }}
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors ${confirmClass}`}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function UnlockToast({
  memory,
  onDismiss,
}: {
  memory: Memory;
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-auto rounded-2xl border border-emerald-200 bg-white px-5 py-4 shadow-2xl ring-1 ring-emerald-100">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🔓</span>
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            A capsule just opened
          </p>
          <p className="mt-1 text-sm font-semibold text-neutral-900">
            {memory.title || "Untitled memory"}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Sealed on {formatDateLong(memory.uploadedAt.slice(0, 10))} ·
            unlocked today
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-neutral-400 hover:text-neutral-700"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function UploadZone() {
  const sdk = useAuthStore((s) => s.sdk);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingMode, setPendingMode] = useState<MemoryMode>("past");
  const [pendingDate, setPendingDate] = useState(todayISO());
  const [pendingTitle, setPendingTitle] = useState("");
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [now, setNow] = useState(new Date());
  const [confirmState, setConfirmState] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    body: "",
    confirmLabel: "",
    tone: "danger",
    onConfirm: () => {},
  });
  const [unlockToasts, setUnlockToasts] = useState<Memory[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  useEffect(() => {
    const anyInFinalDay = memories.some(
      (m) =>
        m.status.kind === "stored" &&
        isLockedCapsule(m, now) &&
        msUntilUnlock(m, now) <= FINAL_DAY_MS,
    );
    const interval = anyInFinalDay ? 1000 : 60 * 1000;
    const tick = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(tick);
  }, [memories, now]);

  useEffect(() => {
    const shown = loadShownUnlockToasts();
    const newlyUnlocked = memories.filter(
      (m) =>
        m.status.kind === "stored" &&
        m.mode === "capsule" &&
        !isLockedCapsule(m, now) &&
        !shown.has(m.proof),
    );
    if (newlyUnlocked.length === 0) return;
    setUnlockToasts((prev) => {
      const seen = new Set(prev.map((p) => p.proof));
      const adds = newlyUnlocked.filter((m) => !seen.has(m.proof));
      return [...prev, ...adds];
    });
    const next = new Set(shown);
    for (const m of newlyUnlocked) next.add(m.proof);
    saveShownUnlockToasts(next);
  }, [memories, now]);

  function dismissToast(proof: string) {
    setUnlockToasts((prev) => prev.filter((t) => t.proof !== proof));
  }

  useEffect(() => {
    if (!sdk) return;
    let cancelled = false;
    (async () => {
      try {
        const events = await sdk.objectEvents(undefined, 100);
        if (cancelled) return;
        const loaded: Memory[] = [];
        for (const event of events) {
          if (event.deleted || !event.object) continue;
          try {
            const metaBytes = event.object.metadata();
            const meta = JSON.parse(new TextDecoder().decode(metaBytes));
            if (!meta?.name) continue;
            const uploadedAt = meta.uploadedAt || new Date().toISOString();
            const mode: MemoryMode =
              meta.mode === "capsule" ? "capsule" : "past";
            const anchorDate =
              meta.anchorDate || meta.memoryDate || uploadedAt.slice(0, 10);
            loaded.push({
              id: crypto.randomUUID(),
              title: meta.title || titleFromFile(meta.name),
              fileName: meta.name,
              fileType: meta.type || inferMimeFromName(meta.name),
              size: meta.size ?? 0,
              mode,
              anchorDate,
              uploadedAt,
              status: { kind: "stored" },
              proof: shortProof(meta.name + uploadedAt),
              pinnedObject: event.object,
            });
          } catch {
            // Skip malformed entries
          }
        }
        loaded.sort((a, b) => (b.uploadedAt > a.uploadedAt ? 1 : -1));
        setMemories(loaded);
      } catch (err) {
        console.error("Failed to load memories from Sia:", err);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  function handleFilePicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    setPendingFile(file);
    setPendingMode("past");
    setPendingDate(todayISO());
    setPendingTitle(titleFromFile(file.name));
  }

  function selectMode(mode: MemoryMode) {
    setPendingMode(mode);
    setPendingDate(mode === "capsule" ? tomorrowISO() : todayISO());
  }

  function cancelPending() {
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function sealMemory() {
    if (!sdk || !pendingFile) return;
    const file = pendingFile;
    const mode = pendingMode;
    const anchorDate = pendingDate;
    const title = pendingTitle.trim() || titleFromFile(file.name);
    const id = crypto.randomUUID();
    const uploadedAt = new Date().toISOString();
    const memory: Memory = {
      id,
      title,
      fileName: file.name,
      fileType: file.type || inferMimeFromName(file.name),
      size: file.size,
      mode,
      anchorDate,
      uploadedAt,
      status: { kind: "uploading", shardsDone: 0 },
      proof: shortProof(file.name + uploadedAt),
    };

    setMemories((prev) => [memory, ...prev]);
    cancelPending();

    if (mode === "capsule") {
      const shown = loadShownUnlockToasts();
      shown.add(memory.proof);
      saveShownUnlockToasts(shown);
    }

    try {
      const obj = new PinnedObject();
      const pinnedObject = await sdk.upload(obj, file.stream(), {
        maxInflight: 10,
        onShardUploaded: () => {
          setMemories((prev) =>
            prev.map((m) =>
              m.id === id && m.status.kind === "uploading"
                ? {
                    ...m,
                    status: {
                      kind: "uploading",
                      shardsDone: m.status.shardsDone + 1,
                    },
                  }
                : m,
            ),
          );
        },
      });

      pinnedObject.updateMetadata(
        new TextEncoder().encode(
          JSON.stringify({
            name: file.name,
            type: file.type,
            size: file.size,
            title,
            mode,
            anchorDate,
            uploadedAt,
          }),
        ),
      );
      await sdk.pinObject(pinnedObject);
      await sdk.updateObjectMetadata(pinnedObject);

      setMemories((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, status: { kind: "stored" }, pinnedObject } : m,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setMemories((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, status: { kind: "error", message } } : m,
        ),
      );
    }
  }

  async function saveEditedTitle(memory: Memory) {
    const newTitle = editingTitleValue.trim();
    setEditingTitleId(null);
    if (!newTitle || newTitle === memory.title) return;

    setMemories((prev) =>
      prev.map((m) => (m.id === memory.id ? { ...m, title: newTitle } : m)),
    );

    if (!sdk || !memory.pinnedObject) {
      console.warn("No pinnedObject for memory; title saved locally only.");
      return;
    }
    try {
      memory.pinnedObject.updateMetadata(
        new TextEncoder().encode(
          JSON.stringify({
            name: memory.fileName,
            type: memory.fileType,
            size: memory.size,
            title: newTitle,
            mode: memory.mode,
            anchorDate: memory.anchorDate,
            uploadedAt: memory.uploadedAt,
          }),
        ),
      );
      await sdk.updateObjectMetadata(memory.pinnedObject);
    } catch (err) {
      console.error("Failed to persist title to Sia:", err);
    }
  }

  function closeConfirm() {
    setConfirmState((s) => ({ ...s, open: false }));
  }

  function requestDeleteMemory(memory: Memory) {
    const label = memory.title || memory.fileName || "this memory";
    setConfirmState({
      open: true,
      title: `Delete "${label}"?`,
      body: "Removing this memory will erase it from the Sia network. This can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
      onConfirm: () => {
        closeConfirm();
        performDelete(memory);
      },
    });
  }

  function requestCancelCapsule(memory: Memory) {
    setConfirmState({
      open: true,
      title: "Cancel this time capsule?",
      body: `Cancelling will permanently delete the sealed contents from Sia before they ever unlock. This can't be undone.`,
      confirmLabel: "Cancel capsule",
      tone: "indigo",
      onConfirm: () => {
        closeConfirm();
        performDelete(memory);
      },
    });
  }

  async function performDelete(memory: Memory) {
    if (!sdk) return;
    if (memory.status.kind !== "stored" || !memory.pinnedObject) {
      setMemories((prev) => prev.filter((m) => m.id !== memory.id));
      return;
    }
    try {
      const objectId = memory.pinnedObject.id();
      await sdk.deleteObject(objectId);
      setMemories((prev) => prev.filter((m) => m.id !== memory.id));
    } catch (err) {
      console.error("Failed to delete memory:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setConfirmState({
        open: true,
        title: "Couldn't delete",
        body: msg,
        confirmLabel: "OK",
        tone: "danger",
        onConfirm: closeConfirm,
      });
    }
  }

  // Fetch the file blob from Sia. Used by Download and Share.
  async function fetchMemoryBlob(memory: Memory): Promise<Blob | null> {
    if (!sdk || !memory.pinnedObject) return null;
    const stream = sdk.download(memory.pinnedObject, { maxInflight: 10 });
    const blob = await new Response(stream).blob();
    const mime =
      memory.fileType ||
      inferMimeFromName(memory.fileName) ||
      "application/octet-stream";
    return blob.type ? blob : new Blob([blob], { type: mime });
  }

  async function downloadMemory(memory: Memory) {
    if (busyIds.has(memory.id)) return;
    setBusy(memory.id, true);
    try {
      const blob = await fetchMemoryBlob(memory);
      if (!blob) return;
      triggerBrowserDownload(blob, memory.fileName);
    } catch (err) {
      console.error("Download failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setConfirmState({
        open: true,
        title: "Couldn't download",
        body: msg,
        confirmLabel: "OK",
        tone: "danger",
        onConfirm: closeConfirm,
      });
    } finally {
      setBusy(memory.id, false);
    }
  }

  async function shareMemory(memory: Memory) {
    if (busyIds.has(memory.id)) return;
    setBusy(memory.id, true);
    try {
      const blob = await fetchMemoryBlob(memory);
      if (!blob) return;
      const file = new File([blob], memory.fileName, {
        type: blob.type || "application/octet-stream",
      });

      // Try the native browser share API first
      const navAny = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
        share?: (data: {
          files?: File[];
          title?: string;
          text?: string;
        }) => Promise<void>;
      };
      const supportsFileShare =
        typeof navAny.share === "function" &&
        typeof navAny.canShare === "function" &&
        navAny.canShare({ files: [file] });

      if (supportsFileShare) {
        try {
          await navAny.share!({
            files: [file],
            title: memory.title || "A TimeLoop memory",
            text: memory.title
              ? `${memory.title} — from TimeLoop`
              : "A memory from TimeLoop",
          });
          return;
        } catch (err) {
          // User cancelled the share sheet, or the platform rejected it.
          // AbortError = user cancellation, which is a normal outcome.
          if ((err as Error)?.name === "AbortError") return;
          console.warn("Native share failed, falling back to download:", err);
        }
      }

      // Fallback: download the file so the user can share it however they want
      triggerBrowserDownload(blob, memory.fileName);
    } catch (err) {
      console.error("Share failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setConfirmState({
        open: true,
        title: "Couldn't share",
        body: msg,
        confirmLabel: "OK",
        tone: "danger",
        onConfirm: closeConfirm,
      });
    } finally {
      setBusy(memory.id, false);
    }
  }

  const onThisDayMemories = memories.filter(
    (m) =>
      m.status.kind === "stored" &&
      m.mode === "past" &&
      isAnniversary(m.anchorDate, now),
  );

  const lockedCapsules = memories
    .filter((m) => m.status.kind === "stored" && isLockedCapsule(m, now))
    .sort((a, b) => {
      if (a.anchorDate !== b.anchorDate)
        return a.anchorDate < b.anchorDate ? -1 : 1;
      return a.uploadedAt < b.uploadedAt ? -1 : 1;
    });

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e9fff5,transparent_35%),linear-gradient(#fbfbf9,#f6f7f4)] px-6 py-10 text-neutral-950">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-emerald-700">
            Private memory vault
          </p>
          <h1 className="mt-2 text-5xl font-semibold tracking-tight">
            TimeLoop
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-neutral-600">
            Personal moments sealed, encrypted, and looped back to you on the
            anniversaries that matter — and the future dates you choose.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-sm italic text-neutral-500">
            Your own private memory timeline — stored on Sia, independent of
            any app or service.
          </p>
        </header>

        {/* 1. Sia storage layer */}
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50/80 p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-emerald-800">
                Sia storage layer
              </p>
              <p className="mt-1 text-sm text-emerald-900/75">
                Files are encrypted client-side and stored as erasure-coded
                shards across the Sia host network. Your memories persist
                independently of any app or service — including this one.
              </p>
            </div>
            <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm">
              Sia · live
            </span>
          </div>
        </section>

        {/* 2. Add a memory */}
        {!pendingFile ? (
          <label className="block cursor-pointer rounded-3xl border-2 border-dashed border-neutral-300 bg-white/80 p-12 text-center shadow-sm transition hover:border-emerald-400 hover:bg-white">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(event) => handleFilePicked(event.target.files)}
            />
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-neutral-950 text-3xl text-white">
              ↑
            </div>
            <p className="mt-5 text-xl font-semibold">Add a memory</p>
            <p className="mt-2 text-sm text-neutral-500">
              Choose a note, photo, screenshot, or keepsake to seal into
              TimeLoop.
            </p>
          </label>
        ) : (
          <div className="space-y-5 rounded-3xl border-2 border-emerald-300 bg-white p-8 shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-neutral-400">
                Selected file
              </p>
              <p className="mt-1 break-all font-mono text-sm text-neutral-700">
                {pendingFile.name} · {formatSize(pendingFile.size)}
              </p>
            </div>

            <div>
              <p className="mb-2 block text-sm font-semibold text-neutral-700">
                What kind of memory is this?
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => selectMode("past")}
                  className={`rounded-xl border-2 px-4 py-3 text-left transition ${
                    pendingMode === "past"
                      ? "border-amber-400 bg-amber-50"
                      : "border-neutral-200 bg-white hover:border-neutral-300"
                  }`}
                >
                  <div className="text-sm font-semibold text-neutral-900">
                    From the past
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Resurfaces on anniversaries
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => selectMode("capsule")}
                  className={`rounded-xl border-2 px-4 py-3 text-left transition ${
                    pendingMode === "capsule"
                      ? "border-indigo-400 bg-indigo-50"
                      : "border-neutral-200 bg-white hover:border-neutral-300"
                  }`}
                >
                  <div className="text-sm font-semibold text-neutral-900">
                    Time capsule
                  </div>
                  <div className="mt-1 text-xs text-neutral-500">
                    Locked until a future date
                  </div>
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="memory-title"
                className="mb-2 block text-sm font-semibold text-neutral-700"
              >
                Title
              </label>
              <input
                id="memory-title"
                type="text"
                value={pendingTitle}
                onChange={(e) => setPendingTitle(e.target.value)}
                placeholder="Give this memory a name…"
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 placeholder-neutral-400 focus:border-emerald-500 focus:outline-none"
              />
              {pendingMode === "capsule" && (
                <p className="mt-2 text-xs text-neutral-500">
                  The title stays hidden too until the unlock date.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="memory-date"
                className="mb-2 block text-sm font-semibold text-neutral-700"
              >
                {pendingMode === "past"
                  ? "When is this memory from?"
                  : "Unlock this memory on…"}
              </label>
              <input
                id="memory-date"
                type="date"
                value={pendingDate}
                max={pendingMode === "past" ? todayISO() : undefined}
                min={pendingMode === "capsule" ? tomorrowISO() : undefined}
                onChange={(e) => setPendingDate(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 focus:border-emerald-500 focus:outline-none"
              />
              <p className="mt-2 text-xs text-neutral-500">
                {pendingMode === "past"
                  ? "Pick the date this moment actually happened. TimeLoop will resurface it on future anniversaries."
                  : "TimeLoop will hide this memory from your vault until this date."}
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={sealMemory}
                className={`flex-1 rounded-xl py-3 font-semibold text-white transition-colors ${
                  pendingMode === "capsule"
                    ? "bg-indigo-600 hover:bg-indigo-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {pendingMode === "capsule" ? "Seal capsule" : "Seal it"}
              </button>
              <button
                type="button"
                onClick={cancelPending}
                className="rounded-xl bg-neutral-100 px-6 py-3 font-semibold text-neutral-900 transition-colors hover:bg-neutral-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* 3. On this day */}
        {onThisDayMemories.length > 0 && (
          <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 shadow-sm">
            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-amber-800">
                On this day
              </p>
              <h2 className="mt-1 text-2xl font-semibold">From years past</h2>
            </div>
            <div className="grid gap-3">
              {onThisDayMemories.map((memory) => {
                const years = yearsAgo(memory.anchorDate, now);
                const busy = busyIds.has(memory.id);
                return (
                  <article
                    key={memory.id}
                    className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm"
                  >
                    <MemoryThumbnail
                      memory={memory}
                      busy={busy}
                      onDownload={() => downloadMemory(memory)}
                    />
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">
                      {years} {years === 1 ? "year" : "years"} ago ·{" "}
                      {formatDateLong(memory.anchorDate)}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold">
                      {memory.title || (
                        <span className="italic font-normal text-neutral-400">
                          Untitled
                        </span>
                      )}
                    </h3>
                    <p className="mt-1 text-sm text-neutral-500">
                      Source file: {memory.fileName} ·{" "}
                      {formatSize(memory.size)}
                    </p>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => downloadMemory(memory)}
                        disabled={busy}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-wait disabled:text-amber-400"
                      >
                        {busy ? "Working..." : "Download"}
                      </button>
                      <button
                        type="button"
                        onClick={() => shareMemory(memory)}
                        disabled={busy}
                        className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-wait disabled:bg-amber-300"
                      >
                        Share
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* 4. Time capsules */}
        {lockedCapsules.length > 0 && (
          <section className="rounded-3xl border border-indigo-200 bg-indigo-50/60 p-6 shadow-sm">
            <div className="mb-4">
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-indigo-800">
                Time capsules
              </p>
              <h2 className="mt-1 text-2xl font-semibold">
                Waiting for the future
              </h2>
              <p className="mt-1 text-sm text-indigo-900/70">
                Stored privately. Not an email. Not tied to a platform. Just
                waiting.
              </p>
            </div>
            <div className="grid gap-3">
              {lockedCapsules.map((memory) => (
                <LockedCard
                  key={memory.id}
                  memory={memory}
                  now={now}
                  onCancelCapsule={requestCancelCapsule}
                />
              ))}
            </div>
          </section>
        )}

        {/* 5. Stored memories */}
        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Stored memories</h2>
              <p className="text-sm text-neutral-500">
                {loadingHistory
                  ? "Loading from Sia..."
                  : memories.length === 0
                    ? "No memories sealed yet."
                    : `${memories.length} sealed in your vault.`}
              </p>
            </div>
          </div>

          {!loadingHistory && memories.length === 0 ? (
            <div className="rounded-3xl border border-neutral-200 bg-white/70 p-10 text-center shadow-sm">
              <p className="text-lg font-semibold">Your vault is ready.</p>
              <p className="mt-2 text-sm text-neutral-500">
                Instead of relying on social media to remember your past,
                TimeLoop is your own private memory timeline. Upload your first
                file to begin.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {memories.map((memory) => {
                if (
                  memory.status.kind === "stored" &&
                  isLockedCapsule(memory, now)
                ) {
                  return null;
                }
                const busy = busyIds.has(memory.id);
                const canActOnFile =
                  memory.status.kind === "stored" && !!memory.pinnedObject;
                return (
                  <article
                    key={memory.id}
                    className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm transition hover:shadow-md"
                  >
                    <MemoryThumbnail
                      memory={memory}
                      busy={busy}
                      onDownload={() => downloadMemory(memory)}
                    />
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-neutral-400">
                          {memory.mode === "capsule"
                            ? `Unlocked · ${formatDateLong(memory.anchorDate)}`
                            : formatDateLong(memory.anchorDate)}
                        </p>
                        {editingTitleId === memory.id ? (
                          <input
                            type="text"
                            autoFocus
                            value={editingTitleValue}
                            onChange={(e) =>
                              setEditingTitleValue(e.target.value)
                            }
                            onBlur={() => saveEditedTitle(memory)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditedTitle(memory);
                              if (e.key === "Escape") setEditingTitleId(null);
                            }}
                            className="mt-2 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-2xl font-semibold focus:border-emerald-500 focus:outline-none"
                          />
                        ) : (
                          <h3
                            className="mt-2 cursor-text text-2xl font-semibold hover:text-emerald-700"
                            onClick={() => {
                              if (memory.status.kind !== "stored") return;
                              setEditingTitleId(memory.id);
                              setEditingTitleValue(memory.title);
                            }}
                            title={
                              memory.status.kind === "stored"
                                ? "Click to edit"
                                : undefined
                            }
                          >
                            {memory.title || (
                              <span className="italic font-normal text-neutral-400">
                                Untitled — click to add a title
                              </span>
                            )}
                          </h3>
                        )}
                        <p className="mt-1 text-sm text-neutral-500">
                          Source file: {memory.fileName} ·{" "}
                          {formatSize(memory.size)}
                        </p>
                        <p className="mt-2 text-sm text-neutral-600">
                          A captured moment stored privately and anchored to
                          Sia.
                        </p>
                      </div>

                      <span
                        className={`w-fit rounded-full px-4 py-2 text-sm font-semibold ${
                          memory.status.kind === "stored"
                            ? "bg-emerald-100 text-emerald-800"
                            : memory.status.kind === "error"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {memory.status.kind === "stored"
                          ? "Sealed on Sia"
                          : memory.status.kind === "error"
                            ? "Upload failed"
                            : `Encrypting · ${memory.status.shardsDone} shards`}
                      </span>
                    </div>

                    {memory.status.kind === "error" && (
                      <div className="mt-5 rounded-2xl bg-rose-50 p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose-700">
                          Error
                        </p>
                        <p className="mt-2 break-all font-mono text-sm text-rose-900/80">
                          {memory.status.message}
                        </p>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      {canActOnFile && (
                        <>
                          <button
                            type="button"
                            onClick={() => downloadMemory(memory)}
                            disabled={busy}
                            className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-wait disabled:text-neutral-400"
                          >
                            {busy ? "Working..." : "Download"}
                          </button>
                          <button
                            type="button"
                            onClick={() => shareMemory(memory)}
                            disabled={busy}
                            className="rounded-lg px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-wait disabled:text-emerald-400"
                          >
                            Share
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => requestDeleteMemory(memory)}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-rose-50 hover:text-rose-700"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex w-full max-w-sm flex-col gap-3">
        {unlockToasts.map((toast) => (
          <UnlockToast
            key={toast.proof}
            memory={toast}
            onDismiss={() => dismissToast(toast.proof)}
          />
        ))}
      </div>

      <ConfirmDialog state={confirmState} onCancel={closeConfirm} />
    </main>
  );
}
