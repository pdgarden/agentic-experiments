import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { api } from "@/api/client";
import { conversationsQuery, queryKeys } from "@/api/queries";
import type { Conversation } from "@/api/types";
import { LogoMark } from "@/components/LogoMark";
import { McpServers } from "@/components/mcp/McpServers";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Alert, RetryButton } from "@/components/ui/alert";
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
import { Skeleton } from "@/components/ui/skeleton";
import { groupByDate } from "@/dateBuckets";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { cn } from "@/utils";

interface SidebarProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const titleOf = (c: Conversation) => c.title || "New chat";
const groupId = (label: string) => `chats-${label.toLowerCase().replaceAll(" ", "-")}`;

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
  const actionError = rename.error?.message ?? remove.error?.message;

  const { collapsed, toggle, collapseIfNarrow } = useSidebarCollapsed();
  const pick = (id: string | null) => {
    onSelect(id);
    collapseIfNarrow();
  };
  const groups = groupByDate(conversations.data ?? [], (c) => c.updated_at, new Date());

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-3 text-sidebar-foreground">
        <RailButton label="Expand sidebar" hint="⌘B" onClick={toggle}>
          <PanelLeftOpen />
        </RailButton>
        <RailButton label="New chat" onClick={() => onSelect(null)}>
          <SquarePen />
        </RailButton>
      </aside>
    );
  }

  return (
    <>
      {/* Below md the sidebar floats over the chat: a rail-wide spacer keeps the chat in place. */}
      <div aria-hidden className="w-12 shrink-0 border-r bg-sidebar md:hidden" />
      <div
        aria-hidden
        className="fixed inset-0 z-30 bg-foreground/20 motion-safe:animate-in motion-safe:fade-in md:hidden"
        onClick={toggle}
      />
      <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl max-md:motion-safe:animate-in max-md:motion-safe:slide-in-from-left-8 max-md:motion-safe:duration-200">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <LogoMark />
          <span className="flex-1 truncate text-sm font-semibold tracking-tight">Agent chat</span>
          <RailButton label="Collapse sidebar" hint="⌘B" onClick={toggle}>
            <PanelLeftClose />
          </RailButton>
        </div>
        <div className="px-3 pb-2">
          <Button
            size="sm"
            className="w-full justify-start bg-accent-soft text-accent-soft-foreground shadow-none hover:bg-accent-soft/70"
            onClick={() => pick(null)}
          >
            <SquarePen /> New chat
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Chats">
          {conversations.isError && (
            <Alert
              size="sm"
              className="mx-1 mt-2"
              action={
                <RetryButton
                  busy={conversations.isFetching}
                  onRetry={() => void conversations.refetch()}
                />
              }
            >
              Could not load chats.
            </Alert>
          )}
          {actionError && (
            <Alert size="sm" className="mx-1 mt-2">
              {actionError}
            </Alert>
          )}
          {conversations.isPending && <ChatRowsSkeleton />}
          {groups.map((group) => (
            <div key={group.label} className="pt-2">
              <h2
                id={groupId(group.label)}
                className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground"
              >
                {group.label}
              </h2>
              <ul className="space-y-px" aria-labelledby={groupId(group.label)}>
                {group.items.map((conversation) => (
                  <li key={conversation.id}>
                    {editingId === conversation.id ? (
                      <RenameForm
                        initial={conversation.title ?? ""}
                        onCancel={() => setEditingId(null)}
                        onSave={(title) => {
                          setEditingId(null);
                          rename.mutate({ id: conversation.id, title });
                        }}
                      />
                    ) : (
                      <ChatRow
                        conversation={conversation}
                        active={conversation.id === selectedId}
                        onSelect={() => pick(conversation.id)}
                        onRename={() => setEditingId(conversation.id)}
                        onDelete={() => setDeleting(conversation)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <McpServers />
        <div className="flex items-center justify-between border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
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
    </>
  );
}

interface ChatRowProps {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function ChatRow({ conversation, active, onSelect, onRename, onDelete }: ChatRowProps) {
  const title = titleOf(conversation);
  return (
    <div
      className={cn(
        "group relative flex items-center rounded-md text-sm transition-colors hover:bg-sidebar-accent/60",
        active &&
          "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary hover:bg-sidebar-accent",
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50"
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
      >
        {title}
      </button>
      {conversation.running && (
        <Loader2
          className="mr-2 size-3.5 shrink-0 text-sidebar-primary group-focus-within:hidden group-hover:hidden motion-safe:animate-spin"
          aria-label="Running"
        />
      )}
      <div className="hidden shrink-0 pr-0.5 group-focus-within:flex group-hover:flex">
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
          aria-label={`Rename ${title}`}
          onClick={onRename}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:bg-transparent hover:text-destructive dark:hover:bg-transparent"
          aria-label={`Delete ${title}`}
          disabled={conversation.running}
          title={conversation.running ? "Stop the run first" : undefined}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Chat rows while the list loads: a group label and a few titles of varied length. */
function ChatRowsSkeleton() {
  return (
    <div className="space-y-1 px-2 pt-3">
      <span role="status" className="sr-only">
        Loading chats…
      </span>
      <Skeleton className="mb-2.5 h-2.5 w-12" />
      {["w-4/5", "w-3/5", "w-11/12", "w-2/3", "w-1/2"].map((width) => (
        <div key={width} className="py-1.5">
          <Skeleton className={cn("h-3.5", width)} />
        </div>
      ))}
    </div>
  );
}

function RailButton({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-8 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground dark:hover:bg-sidebar-accent"
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      onClick={onClick}
    >
      {children}
    </Button>
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
