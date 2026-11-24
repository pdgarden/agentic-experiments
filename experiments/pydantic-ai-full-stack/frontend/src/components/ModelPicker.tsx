import { Brain, Sparkles } from "lucide-react";
import type { ConversationSettings, ModelInfo, ThinkingLevel } from "@/api/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils";

/**
 * The header's compact pill look, shared with the MCP picker. In a narrow header (an `@container`
 * under 32rem) the chevrons go, and `pillLabel` hides a label visually (not from screen readers).
 */
export const pillClass =
  "h-7 gap-1.5 rounded-full border-border/70 bg-transparent px-2.5 text-xs font-medium shadow-none hover:bg-accent dark:bg-transparent dark:hover:bg-accent [&_svg:not([class*='size-'])]:size-3.5 @max-lg:[&_svg.lucide-chevron-down]:hidden";
export const pillLabel = "@max-lg:sr-only";

const thinkingLabel: Record<ThinkingLevel, string> = {
  off: "Thinking off",
  low: "Thinking low",
  medium: "Thinking medium",
  high: "Thinking high",
};

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

interface ModelPickerProps {
  models: ModelInfo[];
  settings: ConversationSettings;
  onChange: (settings: ConversationSettings) => void;
  disabled?: boolean;
}

export function ModelPicker({ models, settings, onChange, disabled }: ModelPickerProps) {
  const current = models.find((m) => m.id === settings.model_id);
  const levels = current?.thinking_levels ?? ["off"];
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={settings.model_id}
        disabled={disabled}
        onValueChange={(id) => {
          const model = models.find((m) => m.id === id);
          if (model) onChange(withModel(settings, model));
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label="Model"
          title={current ? `Model: ${current.label}` : "Model"}
          className={cn(pillClass, "max-w-44")}
        >
          <Sparkles className="text-primary" aria-hidden />
          <SelectValue>
            <span className={pillLabel}>{current?.label}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {levels.length > 1 && (
        <Select
          value={settings.thinking}
          disabled={disabled}
          onValueChange={(level) => onChange({ ...settings, thinking: level as ThinkingLevel })}
        >
          <SelectTrigger
            size="sm"
            aria-label="Thinking"
            title={thinkingLabel[settings.thinking]}
            className={cn(pillClass, settings.thinking === "off" && "text-muted-foreground")}
          >
            <Brain aria-hidden />
            <SelectValue>{thinkingShort[settings.thinking]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {levels.map((level) => (
              <SelectItem key={level} value={level}>
                {thinkingLabel[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
