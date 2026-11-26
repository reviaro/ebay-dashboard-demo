import { withStore } from '@/lib/stores/route';
import { NextResponse } from 'next/server';
import {
  parseTaskCreate,
  parseTaskUpdate,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  readJson,
} from '@/lib/tasks';

async function handleGET() {
  try {
    return NextResponse.json(await listTasks());
  } catch {
    return NextResponse.json({ error: 'Task operation failed' }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  const body = await readJson(request);
  try {
    if (body === undefined) {
      return NextResponse.json({ error: 'Invalid task', details: ['body must be valid JSON'] }, { status: 400 });
    }
    const parsed = parseTaskCreate(body);
    if ('errors' in parsed) {
      return NextResponse.json({ error: 'Invalid task', details: parsed.errors }, { status: 400 });
    }
    return NextResponse.json(await createTask(parsed));
  } catch {
    return NextResponse.json({ error: 'Task operation failed' }, { status: 500 });
  }
}

async function handlePUT(request: Request) {
  const body = await readJson(request);
  try {
    if (body === undefined) {
      return NextResponse.json({ error: 'Invalid task', details: ['body must be valid JSON'] }, { status: 400 });
    }
    const parsed = parseTaskUpdate(body);
    if ('errors' in parsed) {
      return NextResponse.json({ error: 'Invalid task', details: parsed.errors }, { status: 400 });
    }
    const updated = await updateTask(parsed.id, parsed.fields);
    if (updated === null) {
      return NextResponse.json({ error: 'No task with that id' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Task operation failed' }, { status: 500 });
  }
}

async function handleDELETE(request: Request) {
  try {
    const idParam = new URL(request.url).searchParams.get('id');
    const id = Number(idParam);
    if (!idParam || !Number.isInteger(id) || id < 1) {
      return NextResponse.json({ error: 'id query parameter must be an integer >= 1' }, { status: 400 });
    }
    const ok = await deleteTask(id);
    if (!ok) {
      return NextResponse.json({ error: 'No task with that id' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Task operation failed' }, { status: 500 });
  }
}

export const GET = withStore('view', handleGET);

export const POST = withStore('edit', handlePOST);

export const PUT = withStore('edit', handlePUT);

export const DELETE = withStore('edit', handleDELETE);
