import type { FileUIPart } from "ai";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { type ClipboardEvent, type FormEvent, useRef, useState } from "react";
import { api } from "@/api/client";
import type { UploadedFile } from "@/api/types";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
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

interface ComposerProps {
  conversationId: string;
  running: boolean;
  onSend: (text: string, files: FileUIPart[]) => Promise<void>;
  onStop: () => void;
}

/** Message input with attachments: each file is uploaded as soon as it is added. */
export function Composer({ conversationId, running, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
        { key, name: file.name, previewUrl, uploaded: null, error: null },
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

  const onPaste = (event: ClipboardEvent) => {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault();
      add(event.clipboardData.files);
    }
  };

  return (
    <PromptInput
      onSubmit={submit}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        add(event.dataTransfer.files);
      }}
    >
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-1 pb-2" aria-label="Attachments">
          {attachments.map((a) => (
            <li
              key={a.key}
              data-testid="attachment"
              data-status={a.error ? "error" : a.uploaded ? "ready" : "uploading"}
              title={a.error ?? a.name}
              className={cn(
                "flex max-w-56 items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                a.error && "border-destructive text-destructive",
              )}
            >
              {a.previewUrl ? (
                <img src={a.previewUrl} alt="" className="size-6 rounded object-cover" />
              ) : (
                <FileText className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{a.name}</span>
              {!a.uploaded && !a.error && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
              <button
                type="button"
                className="shrink-0 rounded hover:bg-muted"
                aria-label={`Remove ${a.name}`}
                onClick={() => remove(a.key)}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <PromptInputTextarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onSubmitKey={() => void submit()}
        onPaste={onPaste}
        placeholder="Message the agent…"
        aria-label="Message"
        autoFocus
      />
      <PromptInputToolbar>
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
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Attach files"
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip />
        </Button>
        <div className="ml-auto">
          <PromptInputSubmit running={running} disabled={!canSend} onStop={onStop} />
        </div>
      </PromptInputToolbar>
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </PromptInput>
  );
}
