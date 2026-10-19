/** Turns the agent's plain-text answers into Slack messages (mrkdwn). */
import type { AgentAnswer } from '../assistant/agentClient.js';
import type { SlackMessage } from './slackApi.js';

/** Slack treats &, < and > as control characters in message text. */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Gemini writes Markdown; Slack bolds with single asterisks. */
function toMrkdwn(text: string): string {
  return escapeSlack(text).replace(/\*\*(.+?)\*\*/g, '*$1*');
}

function linkLine(links: { label: string; url: string }[]): string {
  const safe = links.filter((l, i, all) => /^https:\/\//.test(l.url) && all.findIndex((x) => x.url === l.url) === i).slice(0, 3);
  return safe.map((l) => `<${l.url.replace(/[<>|]/g, '')}|${escapeSlack(l.label).replace(/\|/g, '/')}>`).join('  ·  ');
}

export function answerMessage(answer: AgentAnswer): SlackMessage {
  const prefix = answer.status === 'ok' ? '' : ':warning: ';
  const links = answer.status === 'ok' ? linkLine(answer.links) : '';
  const text = `${prefix}${toMrkdwn(answer.text)}${links ? `\n${links}` : ''}`;
  return { text };
}

export function linkPromptMessage(url: string): SlackMessage {
  const text = 'To answer questions about AI spend, I need to know who you are in AxiomFlo. Link your Slack account once, then ask again.';
  return {
    text: `${text} ${url}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      { type: 'actions', elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Link my AxiomFlo account' }, url }] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'The link works once and expires in 15 minutes. Don’t forward it. It only works for the AxiomFlo account with the same email as your Slack profile.' }] },
    ],
  };
}

export const plain = (text: string): SlackMessage => ({ text: escapeSlack(text) });
