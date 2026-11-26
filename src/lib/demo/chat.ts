import { NextResponse } from 'next/server';
import cache from './answers.json';
import { DEMO_DATE, DEMO_QUESTIONS } from './config';

const MAX_BODY_BYTES = 16_384;

/** No database, model, network, conversation persistence, or user text interpolation. */
export async function demoChatResponse(request: Request): Promise<NextResponse> {
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: 'A question is required.' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      return NextResponse.json({ error: 'Question is too long.' }, { status: 413 });
    }
    chunks.push(value);
  }
  let body: Record<string, unknown>;
  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'A valid JSON question is required.' }, { status: 400 });
  }
  const last = Array.isArray(body.messages) ? body.messages.at(-1) : null;
  const question = typeof body.question === 'string' ? body.question
    : typeof last?.content === 'string' ? last.content : '';
  const id = typeof body.questionId === 'string' ? body.questionId : '';
  if (!question.trim() && !id) return NextResponse.json({ error: 'A question is required.' }, { status: 400 });
  if (cache.synthetic !== true || cache.asOf !== DEMO_DATE) {
    return NextResponse.json({ error: 'Demo answers need rebuilding.' }, { status: 503 });
  }
  const answer = cache.questions.find(entry => entry.id === id || entry.question === question.trim());
  return NextResponse.json({
    content: answer?.answer ?? 'Live chat is off in this read-only demo. Choose one of the five sample questions to explore answers calculated from the made-up store data.',
    demo: true, cached: Boolean(answer), asOf: DEMO_DATE,
    questions: [...DEMO_QUESTIONS],
    ...(answer ? { questionId: answer.id, provenance: answer.provenance } : {}),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
