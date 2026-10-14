import {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type InteractionEditReplyOptions,
} from "discord.js";

import { discordBotViewer } from "../worker/discord";
import type { Env } from "../worker/env";

type LoginInteraction = {
  guildId: string | null;
  user: { id: string };
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<void>;
  editReply(options: InteractionEditReplyOptions): Promise<void>;
};

export async function handleDiscordLogin(interaction: LoginInteraction, env: Env) {
  let deferred = false;
  let loginToken: string | undefined;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    deferred = true;
    if (interaction.guildId !== env.DISCORD_GUILD_ID) {
      await interaction.editReply({ content: "Use /login in Bunny's Discord server." });
      return;
    }
    if (!env.AUTH_SESSIONS) throw new Error("Session storage is unavailable");
    const viewer = await discordBotViewer(interaction.user.id, env);
    if (!viewer) {
      await interaction.editReply({
        content: "Finish Bunny's Discord membership checks, then try /login again.",
      });
      return;
    }
    loginToken = await env.AUTH_SESSIONS.issueLoginLink(viewer.id);
    const url = new URL("/login", env.APP_URL);
    url.hash = loginToken;
    const button = new ButtonBuilder()
      .setLabel("Hop into bunny.plus")
      .setStyle(ButtonStyle.Link)
      .setURL(url.toString());
    await interaction.editReply({
      content:
        "Your private login link is ready ♡ It expires in 10 minutes and works once. Keep it to yourself; requesting a new link replaces this one.",
      allowedMentions: { parse: [] },
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    });
  } catch {
    if (loginToken)
      await env.AUTH_SESSIONS?.revokeLoginLink(loginToken).catch(() =>
        console.error("Discord /login link could not be revoked"),
      );
    // Discord errors can include request bodies and interaction tokens; never log them.
    console.error("Discord /login could not be completed");
    if (deferred) {
      await interaction
        .editReply({
          content: "Couldn't make a login link right now. Please try /login again in a moment.",
          components: [],
        })
        .catch(() => console.error("Discord /login error reply could not be sent"));
    }
  }
}

export async function startDiscordBot(env: Env) {
  if (!env.DISCORD_BOT_TOKEN || !env.AUTH_SESSIONS) return;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    allowedMentions: { parse: [] },
  });
  let registered = false;
  let registering = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  async function registerLogin() {
    if (registered || registering || !client.isReady()) return;
    if (!client.guilds.cache.has(env.DISCORD_GUILD_ID)) {
      console.error("Add the Discord bot to the configured server to enable /login");
      return;
    }
    registering = true;
    try {
      // Upsert just /login, preserving any other application commands.
      await client.application.commands.create(
        {
          name: "login",
          description: "Get a private, temporary link to sign into bunny.plus",
          type: ApplicationCommandType.ChatInput,
        },
        env.DISCORD_GUILD_ID,
      );
      registered = true;
      console.log("Discord /login is ready");
    } catch {
      console.error("Discord /login registration failed; retrying shortly");
      retry = setTimeout(() => void registerLogin(), 30_000);
      retry.unref();
    } finally {
      registering = false;
    }
  }
  client.on(Events.ClientReady, () => void registerLogin());
  client.on(Events.GuildCreate, (guild) => {
    if (guild.id === env.DISCORD_GUILD_ID) void registerLogin();
  });
  client.on(Events.GuildDelete, (guild) => {
    if (guild.id === env.DISCORD_GUILD_ID) registered = false;
  });
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === "login")
      void handleDiscordLogin(
        {
          guildId: interaction.guildId,
          user: interaction.user,
          deferReply: async (options) => {
            await interaction.deferReply(options);
          },
          editReply: async (options) => {
            await interaction.editReply(options);
          },
        },
        env,
      );
  });
  client.on(Events.Error, () => console.error("Discord bot connection error"));
  client.on(Events.ShardError, () => console.error("Discord bot gateway error"));
  try {
    await client.login(env.DISCORD_BOT_TOKEN);
  } catch {
    if (retry) clearTimeout(retry);
    await client.destroy();
    console.error("Discord bot could not connect; retrying shortly");
    setTimeout(() => void startDiscordBot(env), 30_000).unref();
  }
}
