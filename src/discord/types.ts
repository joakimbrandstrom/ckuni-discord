export type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
};

export type DiscordOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordOption[];
};

export type DiscordComponent = {
  type: number;
  id?: number;
  custom_id?: string;
  value?: string;
  values?: string[];
  components?: DiscordComponent[];
  component?: DiscordComponent;
};

export type DiscordInteraction = {
  id: string;
  type: number;
  token: string;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user: DiscordUser; roles?: string[] };
  user?: DiscordUser;
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    values?: string[];
    options?: DiscordOption[];
    components?: DiscordComponent[];
  };
  message?: {
    id: string;
    content?: string;
    embeds?: unknown[];
    components?: unknown[];
  };
};
