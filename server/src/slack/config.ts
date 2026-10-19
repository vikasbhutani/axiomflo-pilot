/**
 * Settings for the Slack bot service. It shares the API's base settings and adds:
 *
 *   SLACK_SIGNING_SECRET  from Secret Manager: proves requests come from Slack
 *   SLACK_BOT_TOKEN       from Secret Manager: lets the bot reply (starts xoxb-)
 *   SLACK_TEAM_ID         your Slack workspace's ID (starts T); other workspaces are refused
 *   WEB_APP_URL           the AxiomFlo web app's address, for the "Link my account" button
 *   AGENT_URL             the AxiomFlo Agent service
 *
 * The secrets are never logged.
 */
import { ConfigError, loadConfig, type ServerConfig } from '../config.js';
import { parseBaseUrl } from '../gateway/config.js';

export interface SlackConfig extends ServerConfig {
  signingSecret: string;
  botToken: string;
  teamId: string;
  webAppUrl: string;
  agentUrl: string;
}

type Env = Record<string, string | undefined>;

export function loadSlackConfig(env: Env = process.env): SlackConfig {
  const base = loadConfig(env);
  const signingSecret = (env.SLACK_SIGNING_SECRET ?? '').trim();
  const botToken = (env.SLACK_BOT_TOKEN ?? '').trim();
  const teamId = (env.SLACK_TEAM_ID ?? '').trim();
  if (!/^[a-f0-9]{32}$/.test(signingSecret)) throw new ConfigError('SLACK_SIGNING_SECRET must be the Signing Secret from your Slack app’s Basic Information page.');
  if (!/^xoxb-[A-Za-z0-9-]+$/.test(botToken)) throw new ConfigError('SLACK_BOT_TOKEN must be the Bot User OAuth Token (starts with xoxb-).');
  if (!/^T[A-Z0-9]{2,20}$/.test(teamId)) throw new ConfigError('SLACK_TEAM_ID must be your Slack workspace ID (starts with T).');
  if (!base.agentUrl) throw new ConfigError('AGENT_URL must be set: the Slack bot answers through the AxiomFlo Agent.');
  const webAppUrl = parseBaseUrl('WEB_APP_URL', (env.WEB_APP_URL ?? '').trim());
  return { ...base, signingSecret, botToken, teamId, webAppUrl, agentUrl: base.agentUrl };
}
