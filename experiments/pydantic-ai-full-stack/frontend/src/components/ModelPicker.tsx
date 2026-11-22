import type { ConversationSettings, ModelInfo, ThinkingLevel } from "@/api/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const thinkingLabel: Record<ThinkingLevel, string> = {
  off: "Thinking off",
  low: "Thinking low",
  medium: "Thinking medium",
  high: "Thinking high",
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
    <div className="flex items-center gap-2">
      <Select
        value={settings.model_id}
        disabled={disabled}
        onValueChange={(id) => {
          const model = models.find((m) => m.id === id);
          if (model) onChange(withModel(settings, model));
        }}
      >
        <SelectTrigger size="sm" aria-label="Model" className="w-40">
          <SelectValue />
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
          <SelectTrigger size="sm" aria-label="Thinking" className="w-40">
            <SelectValue />
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
