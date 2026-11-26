import { withStoreData } from '@/lib/stores/context';
import prisma from '@/lib/prisma';

export const TASK_STATUSES = ['todo', 'in-progress', 'completed'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface TaskCreate {
  title: string;
  description?: string | null;
  /** Full markdown document the agent attaches (report, plan, analysis). */
  report?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  phase?: number | null;
  dueDate?: Date | null;
}
export type TaskUpdateFields = Partial<TaskCreate>;

const MAX_TITLE = 500;
const MAX_DESCRIPTION = 5000;
const MAX_REPORT = 200_000;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse a request body as JSON, returning undefined on malformed input. */
export async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Validate one field into `out`, pushing a message to `errors` on failure. */
function applyField(
  key: keyof TaskCreate,
  raw: Record<string, unknown>,
  out: Partial<TaskCreate>,
  errors: string[],
): void {
  if (!(key in raw) || raw[key] === undefined) return;
  const value = raw[key];

  if (key === 'title') {
    if (typeof value !== 'string' || value.trim() === '') errors.push('title is required');
    else if (value.trim().length > MAX_TITLE) errors.push(`title must be <= ${MAX_TITLE} characters`);
    else out.title = value.trim();
  } else if (key === 'description') {
    if (value === null) out.description = null;
    else if (typeof value === 'string') {
      if (value.length > MAX_DESCRIPTION) errors.push(`description must be <= ${MAX_DESCRIPTION} characters`);
      else out.description = value;
    } else errors.push('description must be a string or null');
  } else if (key === 'report') {
    if (value === null) out.report = null;
    else if (typeof value === 'string') {
      if (value.length > MAX_REPORT) errors.push(`report must be <= ${MAX_REPORT} characters`);
      else out.report = value;
    } else errors.push('report must be a string or null');
  } else if (key === 'status') {
    if (TASK_STATUSES.includes(value as TaskStatus)) out.status = value as TaskStatus;
    else errors.push(`status must be one of ${TASK_STATUSES.join(', ')}`);
  } else if (key === 'priority') {
    if (TASK_PRIORITIES.includes(value as TaskPriority)) out.priority = value as TaskPriority;
    else errors.push(`priority must be one of ${TASK_PRIORITIES.join(', ')}`);
  } else if (key === 'phase') {
    if (value === null) out.phase = null;
    else if (typeof value === 'number' && Number.isInteger(value) && value >= 1) out.phase = value;
    else errors.push('phase must be an integer >= 1');
  } else if (key === 'dueDate') {
    if (value === null) out.dueDate = null;
    else if (typeof value === 'string' || value instanceof Date) {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) errors.push('dueDate must be a valid date');
      else out.dueDate = d;
    } else errors.push('dueDate must be a date string or null');
  }
}

const ALL_FIELDS: (keyof TaskCreate)[] = ['title', 'description', 'report', 'status', 'priority', 'phase', 'dueDate'];

export function parseTaskCreate(body: unknown): TaskCreate | { errors: string[] } {
  if (!isRecord(body)) return { errors: ['body must be a JSON object'] };
  const errors: string[] = [];
  const out: Partial<TaskCreate> = {};
  for (const key of ALL_FIELDS) applyField(key, body, out, errors);
  // Only fire the fallback when `title` was genuinely absent — otherwise
  // `applyField` has already pushed the precise message (blank / too long) and
  // this would duplicate it or contradict it.
  if (!('title' in body) || body.title === undefined) errors.push('title is required');
  if (errors.length) return { errors };
  return {
    title: out.title!,
    description: out.description,
    report: out.report,
    status: out.status ?? 'todo',
    priority: out.priority ?? 'medium',
    phase: out.phase,
    dueDate: out.dueDate,
  };
}

export function parseTaskUpdate(
  body: unknown,
): { id: number; fields: TaskUpdateFields } | { errors: string[] } {
  if (!isRecord(body)) return { errors: ['body must be a JSON object'] };
  const errors: string[] = [];
  const id = body.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
    errors.push('id must be an integer >= 1');
  }
  const fields: Partial<TaskCreate> = {};
  for (const key of ALL_FIELDS) applyField(key, body, fields, errors);
  if (Object.keys(fields).length === 0) errors.push('at least one updatable field is required');
  if (errors.length) return { errors };
  return { id: id as number, fields };
}

export function listTasks() {
  return prisma.task.findMany({ orderBy: { createdAt: 'desc' } });
}

export function createTask(input: TaskCreate) {
  return prisma.task.create({
    data: withStoreData({
      title: input.title,
      description: input.description ?? null,
      report: input.report ?? null,
      status: input.status,
      priority: input.priority,
      // Pass `undefined` (not `null`) when omitted so Prisma applies the
      // schema default `phase Int? @default(1)`. An explicit value — including
      // an explicit `null` — is still honored.
      phase: input.phase === undefined ? undefined : input.phase,
      dueDate: input.dueDate ?? null,
    }),
  });
}

export async function updateTask(id: number, fields: TaskUpdateFields) {
  try {
    return await prisma.task.update({ where: { id }, data: fields });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') return null;
    throw error;
  }
}

export async function deleteTask(id: number): Promise<boolean> {
  try {
    await prisma.task.delete({ where: { id } });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') return false;
    throw error;
  }
}
