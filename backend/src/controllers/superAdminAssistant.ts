import { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { AuthenticatedRequest } from '../types/index.js';
import { ASSISTANT_TOOLS, executeAssistantTool } from '../services/superAdminAssistantTools.js';

const MODEL = 'claude-sonnet-5';
// Each round resends the entire growing message list (tool results included)
// back to the API -- that's inherent to how tool use works, not something we
// control. Kept low specifically to bound how many times a verbose tool
// result gets rebilled within one multi-round answer.
const MAX_TOOL_ROUNDS = 2;
const MAX_HISTORY_MESSAGES = 16;
const MAX_MESSAGE_LENGTH = 4000;

const SYSTEM_PROMPT = `You are the Observer Assistant, embedded in the Superadmin Observer console for an exam/proctoring platform.

You have read-only access to real operational data through tools: admin accounts, the server-guaranteed admin action log, the audit trail of create/update/delete actions, admin click events, live telemetry, telemetry history, and feature flags.

Rules:
- Always call a tool before answering any question about accounts, activity, audit history, or system health. Never guess or fabricate a number, name, or timestamp.
- Cite concrete details from tool results (admin emails, counts, timestamps) rather than vague generalities.
- If the available data doesn't answer the question, say so plainly instead of speculating.
- You are strictly read-only. You have no tool that deletes, toggles, or changes anything. If asked to perform an action (delete an account, lock a feature, etc.), explain that you can only report on data — the superadmin must perform that action themselves in the console.
- Keep answers concise and scannable; use short paragraphs or bullet points for multi-item answers.`;

let anthropicClient: Anthropic | null = null;
function getClient(): Anthropic | null {
  // Reuses the same Anthropic key already configured for the AI test
  // generator (see testAgentService.ts) rather than requiring a second key.
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) return null;
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

function sanitizeHistory(raw: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ChatHistoryMessage =>
        !!m &&
        typeof m === 'object' &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string'
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));
}

export async function chatWithAssistant(req: AuthenticatedRequest, res: Response): Promise<void> {
  const client = getClient();
  if (!client) {
    res.status(503).json({
      error: 'assistant_unavailable',
      message: 'ANTHROPIC_API_KEY is not configured on the server.',
    });
    return;
  }

  const { message } = req.body as { message?: unknown };
  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: '"message" is required' });
    return;
  }

  const history = sanitizeHistory((req.body as { history?: unknown }).history);
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message.slice(0, MAX_MESSAGE_LENGTH) },
  ];

  try {
    let toolRounds = 0;
    const toolsUsed = new Set<string>();

    while (true) {
      const allowTools = toolRounds < MAX_TOOL_ROUNDS;
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        ...(allowTools
          ? { tools: ASSISTANT_TOOLS }
          : { tools: ASSISTANT_TOOLS, tool_choice: { type: 'none' as const } }),
        messages,
      });

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim();

        res.json({
          reply: text || 'I was unable to produce a response — please try rephrasing.',
          toolsUsed: Array.from(toolsUsed),
        });
        return;
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        toolsUsed.add(block.name);
        const result = await executeAssistantTool(block.name, (block.input as Record<string, unknown>) ?? {});
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
      toolRounds += 1;
    }
  } catch (error) {
    console.error('Superadmin assistant error:', error);
    if (error instanceof Anthropic.APIError) {
      const status = error.status === 401 || error.status === 400 ? 502 : 500;
      res.status(status).json({
        error: 'assistant_upstream_error',
        message: `The AI provider rejected the request: ${error.message}`,
      });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}
