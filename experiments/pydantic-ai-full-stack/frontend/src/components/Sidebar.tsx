import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "@/api/client";
import { conversationsQuery, queryKeys } from "@/api/queries";
import type { Conversation } from "@/api/types";
import { McpServers } from "@/components/mcp/McpServers";
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

interface SidebarProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const titleOf = (c: Conversation) => c.title || "New chat";

export function Sidebar({ selectedId, onSelect }: SidebarProps) {
  const queryClient = useQueryClient();
  const conversations = useQuery(conversationsQuery);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.rename(id, title),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.conversation(updated.id), updated);
      return queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.conversation(id), exact: true });
      if (id === selectedId) onSelect(null);
      return queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true });
    },
  });
  const error = conversations.isError
    ? "Could not load chats."
    : (rename.error?.message ?? remove.error?.message);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start" onClick={() => onSelect(null)}>
          <Plus /> New chat
        </Button>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label="Chats">
        {error && <p className="px-2 text-xs text-destructive">{error}</p>}
        {conversations.data?.map((conversation) =>
          editingId === conversation.id ? (
            <RenameForm
              key={conversation.id}
              initial={conversation.title ?? ""}
              onCancel={() => setEditingId(null)}
              onSave={(title) => {
                setEditingId(null);
                rename.mutate({ id: conversation.id, title });
              }}
            />
          ) : (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-center rounded-md text-sm hover:bg-sidebar-accent",
                conversation.id === selectedId && "bg-sidebar-accent font-medium",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
                aria-current={conversation.id === selectedId ? "page" : undefined}
                onClick={() => onSelect(conversation.id)}
              >
                {titleOf(conversation)}
              </button>
              {conversation.running && (
                <Loader2
                  className="mr-2 size-3.5 shrink-0 animate-spin text-muted-foreground group-hover:hidden group-focus-within:hidden"
                  aria-label="Running"
                />
              )}
              <div className="hidden shrink-0 group-hover:flex group-focus-within:flex">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Rename ${titleOf(conversation)}`}
                  onClick={() => setEditingId(conversation.id)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Delete ${titleOf(conversation)}`}
                  disabled={conversation.running}
                  title={conversation.running ? "Stop the run first" : undefined}
                  onClick={() => setDeleting(conversation)}
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
              “{deleting ? titleOf(deleting) : ""}” is deleted for good, with its history,
              attachments and artifacts.
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
