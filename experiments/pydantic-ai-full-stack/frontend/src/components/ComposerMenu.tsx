import { Paperclip, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The "attach files" shortcut: ⌘U on Apple platforms, Ctrl+U elsewhere. */
export const attachShortcut = {
  label: isMac ? "⌘U" : "Ctrl+U",
  matches: (event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }) =>
    event.key.toLowerCase() === "u" && !event.altKey && (isMac ? event.metaKey : event.ctrlKey),
};

interface ComposerMenuProps {
  onAttach: () => void;
  /** Extra items under a separator, e.g. the MCP servers sub-menu. */
  items?: ReactNode;
}

/** The composer's `+` button: attach files, then whatever the chat adds. */
export function ComposerMenu({ onAttach, items }: ComposerMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Add"
          title="Attach files and more"
          className="group rounded-full text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <Plus className="size-5 motion-safe:transition-transform group-data-[state=open]:rotate-45" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuItem onSelect={onAttach}>
          <Paperclip />
          Attach files
          <DropdownMenuShortcut>{attachShortcut.label}</DropdownMenuShortcut>
        </DropdownMenuItem>
        {items && (
          <>
            <DropdownMenuSeparator />
            {items}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
