import type { AgentQuestion, QuestionAnswer, QuestionOption } from './dto';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cleanString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeOption(raw: unknown): QuestionOption | null {
  if (typeof raw === 'string') return raw.trim() ? { label: raw.trim() } : null;
  if (!isRecord(raw)) return null;
  const label = cleanString(raw.label);
  if (!label) return null;
  const description = cleanString(raw.description);
  return description ? { label, description } : { label };
}

/**
 * Reads agent_question `meta.questions` into structured questions. Older events stored
 * plain strings; those become free-text questions with no options. Invalid entries are dropped.
 */
export function normalizeQuestions(raw: unknown): AgentQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentQuestion[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ question: item.trim(), options: [] });
      continue;
    }
    if (!isRecord(item)) continue;
    const question = cleanString(item.question);
    if (!question) continue;
    const options = Array.isArray(item.options)
      ? item.options.map(normalizeOption).filter((o): o is QuestionOption => o !== null)
      : [];
    const header = cleanString(item.header);
    out.push({
      question,
      ...(header ? { header } : {}),
      options,
      ...(item.multiSelect === true && options.length > 0 ? { multiSelect: true } : {}),
    });
  }
  return out;
}

/** Reads human_answer `meta.answers`; returns [] for free-text answers recorded without it. */
export function normalizeAnswers(raw: unknown): QuestionAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((a) => {
    const selected = Array.isArray(a.selected) ? a.selected.map(cleanString).filter(Boolean) : [];
    const other = cleanString(a.other);
    return { question: cleanString(a.question), selected, other: other || null };
  });
}

/** One answer as a line of text: the chosen options, then the typed answer. "" when unanswered. */
export function answerText(a: Pick<QuestionAnswer, 'selected' | 'other'>): string {
  const parts = [...a.selected.map((s) => s.trim()).filter(Boolean)];
  const other = a.other?.trim();
  if (other) parts.push(other);
  return parts.join('; ');
}

/**
 * Markdown body for a structured human_answer event: each question in bold, then its
 * answer (options and/or typed text), then the optional extra note.
 */
export function formatAnswersBody(answers: QuestionAnswer[], note?: string | null): string {
  const blocks = answers.map((a, i) => {
    const text = answerText(a) || '_(no answer)_';
    const question = a.question.trim() || `Question ${i + 1}`;
    return `**${question}**\n\n${text}`;
  });
  const extra = note?.trim();
  if (extra) blocks.push(answers.length > 0 ? `**Note:**\n\n${extra}` : extra);
  return blocks.join('\n\n');
}
