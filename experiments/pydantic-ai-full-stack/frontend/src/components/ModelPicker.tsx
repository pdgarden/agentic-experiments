import { ChevronDown } from "lucide-react";
import type { ConversationSettings, ModelInfo, ThinkingLevel } from "@/api/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/utils";

const thinkingShort: Record<ThinkingLevel, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** The settings with another model; a thinking level the new model lacks falls back to off. */
export function withModel(settings: ConversationSettings, model: ModelInfo): ConversationSettings {
  const thinking = model.thinking_levels.includes(settings.thinking) ? settings.thinking : "off";
  return { ...settings, model_id: model.id, thinking };
}

/** The button's text: the model, plus the thinking level when it is on and can change. */
export function modelLabel(model: ModelInfo | undefined, thinking: ThinkingLevel): string {
  if (!model) return "Model";
  const levels = model.thinking_levels;
  return levels.length > 1 && thinking !== "off"
    ? `${model.label} · ${thinkingShort[thinking]}`
    : model.label;
}

interface ModelPickerProps {
  models: ModelInfo[];
  settings: ConversationSettings;
  onChange: (settings: ConversationSettings) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * One quiet "model · thinking" button opening a menu with two radio groups. Picking a model keeps
 * the menu open so the thinking group updates in place; picking a level closes it.
 *
 * With many models (say more than 6) the thinking group would be better as a `Thinking › Medium`
 * sub-menu; not needed for today's catalogue.
 */
export function ModelPicker({ models, settings, onChange, disabled, className }: ModelPickerProps) {
  const current = models.find((m) => m.id === settings.model_id);
  const levels = current?.thinking_levels ?? ["off"];
  const label = modelLabel(current, settings.thinking);
  const title =
    current && levels.length > 1
      ? `Model: ${current.label}, thinking ${thinkingShort[settings.thinking].toLowerCase()}`
      : `Model: ${current?.label ?? "none"}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Model and thinking"
        title={title}
        disabled={disabled}
        className={cn(
          "inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:text-foreground",
          className,
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-52">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={settings.model_id}
          onValueChange={(id) => {
            const model = models.find((m) => m.id === id);
            if (model) onChange(withModel(settings, model));
          }}
        >
          {models.map((m) => (
            <DropdownMenuRadioItem
              key={m.id}
              value={m.id}
              // Stay open: the thinking group below follows the new model.
              onSelect={(event) => event.preventDefault()}
            >
              {m.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {levels.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Thinking</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={settings.thinking}
              onValueChange={(level) => onChange({ ...settings, thinking: level as ThinkingLevel })}
            >
              {levels.map((level) => (
                <DropdownMenuRadioItem key={level} value={level}>
                  {thinkingShort[level]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
