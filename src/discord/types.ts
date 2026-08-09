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
    options?: DiscordOption[];
  };
  message?: {
    id: string;
    content?: string;
    embeds?: unknown[];
    components?: unknown[];
  };
};
