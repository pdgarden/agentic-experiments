import type { FileUIPart } from "ai";
import {
  CircleAlert,
  FileBraces,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { api } from "@/api/client";
import type { UploadedFile } from "@/api/types";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { attachShortcut, ComposerMenu } from "@/components/ComposerMenu";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/utils";

// The backend's allowlist (backend/src/store/files.py). Browsers often give `.md` no type.
const BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};
// Extensions too: a file picker may not map `.md` to text/markdown.
const ACCEPT = [
  ...new Set(Object.values(BY_EXTENSION)),
  ...Object.keys(BY_EXTENSION).map((extension) => `.${extension}`),
].join(",");

/** The file with a media type the backend accepts, when the browser left it empty. */
export function withMediaType(file: File): File {
  if (file.type) return file;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = BY_EXTENSION[extension];
  return type ? new File([file], file.name, { type }) : file;
}

interface Attachment {
  key: string;
  name: string;
  mediaType: string;
  previewUrl: string | null;
  uploaded: UploadedFile | null;
  error: string | null;
}

const toFilePart = (file: UploadedFile): FileUIPart => ({
  type: "file",
  mediaType: file.media_type,
  filename: file.filename,
  url: file.url,
});

function fileIcon(mediaType: string) {
  if (mediaType === "text/csv") return FileSpreadsheet;
  if (mediaType === "application/json") return FileBraces;
  if (mediaType.startsWith("text/") || mediaType === "application/pdf") return FileText;
  return FileIcon;
}

const extensionOf = (name: string) =>
  name.includes(".") ? (name.split(".").pop()?.toUpperCase() ?? "") : "";

/** One attachment: a thumbnail for images, an icon and the name otherwise. */
function AttachmentCard({
  attachment: a,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const status = a.error ? "error" : a.uploaded ? "ready" : "uploading";
  const Icon = fileIcon(a.mediaType);
  return (
    <li
      data-testid="attachment"
      data-status={status}
      title={a.error ?? a.name}
      className={cn(
        "group/attachment relative h-14 rounded-xl border bg-background text-xs motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95",
        a.previewUrl ? "w-14" : "flex max-w-56 items-center gap-2 pr-3 pl-1.5",
        a.error && "border-destructive/50 bg-destructive/10 text-destructive",
      )}
    >
      {a.previewUrl ? (
        <>
          <img src={a.previewUrl} alt="" className="size-full rounded-[inherit] object-cover" />
          <span className="sr-only">{a.name}</span>
        </>
      ) : (
        <>
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              a.error ? "bg-destructive/15" : "bg-accent-soft text-accent-soft-foreground",
            )}
          >
            <Icon className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{a.name}</span>
            <span className={cn("block", !a.error && "text-muted-foreground")}>
              {a.error ? "Upload failed" : extensionOf(a.name) || "File"}
            </span>
          </span>
        </>
      )}
      {status === "uploading" && (
        <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-background/70">
          <Loader2 className="size-4 text-primary motion-safe:animate-spin" />
          <span className="sr-only">Uploading</span>
        </span>
      )}
      {a.error && a.previewUrl && (
        <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-destructive/40">
          <CircleAlert className="size-5 text-destructive-foreground" />
        </span>
      )}
      <button
        type="button"
        aria-label={`Remove ${a.name}`}
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm opacity-0 transition-opacity group-hover/attachment:opacity-100 hover:bg-foreground/80 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:opacity-100"
      >
        <X className="size-3" />
      </button>
    </li>
  );
}

/** Lets the parent fill the input, e.g. from a suggestion. */
export interface ComposerHandle {
  setText: (text: string) => void;
}

interface ComposerProps {
  ref?: Ref<ComposerHandle>;
  conversationId: string;
  running: boolean;
  onSend: (text: string, files: FileUIPart[]) => Promise<void>;
  onStop: () => void;
  /** Items the chat adds to the `+` menu, under "Attach files". */
  menuItems?: ReactNode;
  /** The line under the box (settings chips, the model button), laid out left to right. */
  footer?: ReactNode;
}

/** Message input with attachments: each file is uploaded as soon as it is added. */
export function Composer({
  ref,
  conversationId,
  running,
  onSend,
  onStop,
  menuItems,
  footer,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    setText: (next: string) => {
      setText(next);
      const element = textarea.current;
      if (!element) return;
      element.focus();
      // The caret after the text, once React has written it.
      requestAnimationFrame(() => element.setSelectionRange(next.length, next.length));
    },
  }));

  const uploading = attachments.some((a) => !a.uploaded && !a.error);
  const ready = attachments.flatMap((a) => (a.uploaded ? [a.uploaded] : []));
  const canSend = (text.trim() !== "" || ready.length > 0) && !uploading && !running && !sending;

  const update = (key: string, change: Partial<Attachment>) =>
    setAttachments((list) => list.map((a) => (a.key === key ? { ...a, ...change } : a)));

  const add = (files: Iterable<File>) => {
    for (const raw of files) {
      const file = withMediaType(raw);
      const key = crypto.randomUUID();
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setAttachments((list) => [
        ...list,
        { key, name: file.name, mediaType: file.type, previewUrl, uploaded: null, error: null },
      ]);
      api.upload(file, conversationId).then(
        (uploaded) => update(key, { uploaded }),
        (err: unknown) => update(key, { error: err instanceof Error ? err.message : String(err) }),
      );
    }
  };

  const remove = (key: string) =>
    setAttachments((list) => {
      const gone = list.find((a) => a.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return list.filter((a) => a.key !== key);
    });

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError(null);
    // Cleared right away: the send resolves only when the reply has finished streaming.
    const sent = { text, attachments };
    setText("");
    setAttachments([]);
    try {
      await onSend(sent.text.trim(), ready.map(toFilePart));
      for (const a of sent.attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    } catch (err) {
      setText(sent.text);
      setAttachments(sent.attachments);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const attach = () => fileInput.current?.click();

  // Only while focus is in the composer; Ctrl+U is "view source" in some browsers.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!attachShortcut.matches(event)) return;
    event.preventDefault();
    attach();
  };

  const onPaste = (event: ClipboardEvent) => {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault();
      add(event.clipboardData.files);
    }
  };

  return (
    <div>
      <PromptInput onSubmit={submit} onDropFiles={add} onKeyDown={onKeyDown}>
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-1 pt-1 pb-2" aria-label="Attachments">
            {attachments.map((a) => (
              <AttachmentCard key={a.key} attachment={a} onRemove={() => remove(a.key)} />
            ))}
          </ul>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          data-testid="file-input"
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = "";
          }}
        />
        {/* One row while the text is one line; the buttons stay at the bottom as it grows. */}
        <div className="flex items-end gap-1">
          <div className="flex h-10 shrink-0 items-center">
            <ComposerMenu onAttach={attach} items={menuItems} />
          </div>
          <PromptInputTextarea
            ref={textarea}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onSubmitKey={() => void submit()}
            onPaste={onPaste}
            placeholder="Message the agent…"
            aria-label="Message"
            autoFocus
            className="px-1.5 py-2.5"
          />
          <div className="flex h-10 shrink-0 items-center">
            <PromptInputSubmit running={running} disabled={!canSend} onStop={onStop} />
          </div>
        </div>
        {error && (
          <Alert size="sm" className="mx-1 mt-2">
            {error}
          </Alert>
        )}
      </PromptInput>
      {footer && (
        <div className="flex items-start justify-between gap-2 px-2 pt-1.5 text-xs">{footer}</div>
      )}
    </div>
  );
}
