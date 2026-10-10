import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "@/api/client";
import { queryKeys, sessionsQuery } from "@/api/queries";
import type { SessionRecord } from "@/api/types";
import { McpServers } from "@/components/McpServers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils";

interface SessionListProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function SessionList({ selectedId, onSelect }: SessionListProps) {
  const queryClient = useQueryClient();
  const sessions = useQuery(sessionsQuery);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SessionRecord | null>(null);

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.renameSession(id, title),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sessions, exact: true }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.session(id) });
      if (id === selectedId) onSelect(null);
      return queryClient.invalidateQueries({ queryKey: queryKeys.sessions, exact: true });
    },
  });

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start" onClick={() => onSelect(null)}>
          <Plus /> New chat
        </Button>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label="Chats">
        {sessions.isError && <p className="px-2 text-xs text-destructive">Could not load chats.</p>}
        {sessions.data?.map((session) =>
          editingId === session.id ? (
            <RenameForm
              key={session.id}
              initial={session.title}
              onCancel={() => setEditingId(null)}
              onSave={(title) => {
                setEditingId(null);
                rename.mutate({ id: session.id, title });
              }}
            />
          ) : (
            <div
              key={session.id}
              className={cn(
                "group flex items-center rounded-md text-sm hover:bg-sidebar-accent",
                session.id === selectedId && "bg-sidebar-accent font-medium",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
                aria-current={session.id === selectedId ? "page" : undefined}
                onClick={() => onSelect(session.id)}
              >
                {session.title || "Untitled"}
              </button>
              <div className="hidden shrink-0 group-hover:flex group-focus-within:flex">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Rename ${session.title || "chat"}`}
                  onClick={() => setEditingId(session.id)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Delete ${session.title || "chat"}`}
                  onClick={() => setDeleting(session)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ),
        )}
      </nav>
      <McpServers />
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title || "Untitled"}” and its history are deleted for good. A run in
              progress is stopped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

interface RenameFormProps {
  initial: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}

function RenameForm({ initial, onSave, onCancel }: RenameFormProps) {
  const [title, setTitle] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed && trimmed !== initial) onSave(trimmed);
    else onCancel();
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1 px-1 py-0.5">
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        aria-label="Chat title"
        maxLength={200}
        className="h-7 text-sm"
        autoFocus
      />
      <Button type="submit" size="icon" variant="ghost" className="size-7" aria-label="Save title">
        <Check className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label="Cancel rename"
        onClick={onCancel}
      >
        <X className="size-3.5" />
      </Button>
    </form>
  );
}
