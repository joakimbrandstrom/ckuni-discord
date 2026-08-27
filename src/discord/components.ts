import type { DiscordComponent, DiscordInteraction } from './types.js';

export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  Label: 18,
} as const;

export const RIDE_TYPE_SELECT_OPTIONS = [
  { label: 'Socialt', value: 'social' },
  { label: 'Intervaller', value: 'intervals' },
  { label: 'Distans', value: 'endurance' },
  { label: 'Tävling', value: 'race' },
  { label: 'Utomhus', value: 'outdoor' },
] as const;

export function textInputLabel(
  customId: string,
  label: string,
  options: {
    description?: string;
    placeholder?: string;
    required?: boolean;
    style?: number;
    maxLength?: number;
    value?: string;
  } = {},
): Record<string, unknown> {
  return {
    type: ComponentType.Label,
    label,
    description: options.description,
    component: {
      type: ComponentType.TextInput,
      custom_id: customId,
      style: options.style ?? 1,
      required: options.required ?? true,
      placeholder: options.placeholder,
      max_length: options.maxLength,
      value: options.value?.slice(0, options.maxLength),
    },
  };
}

export function stringSelectLabel(
  customId: string,
  label: string,
  options: Array<{ label: string; value: string; description?: string; default?: boolean }>,
  description?: string,
): Record<string, unknown> {
  return {
    type: ComponentType.Label,
    label,
    description,
    component: {
      type: ComponentType.StringSelect,
      custom_id: customId,
      options,
      required: true,
    },
  };
}

function collectValues(component: DiscordComponent, result: Record<string, string>): void {
  if (component.custom_id) {
    if (typeof component.value === 'string') result[component.custom_id] = component.value;
    else if (component.values?.length) result[component.custom_id] = component.values[0];
  }
  if (component.component) collectValues(component.component, result);
  for (const child of component.components ?? []) collectValues(child, result);
}

export function modalValues(interaction: DiscordInteraction): Record<string, string> {
  const result: Record<string, string> = {};
  for (const component of interaction.data?.components ?? []) collectValues(component, result);
  return result;
}
