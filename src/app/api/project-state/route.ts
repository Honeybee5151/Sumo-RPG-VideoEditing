import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const AUTOSAVE_FILE = path.join(process.cwd(), '.autosave-project.json');

export async function GET() {
  try {
    if (!fs.existsSync(AUTOSAVE_FILE)) {
      return NextResponse.json({ session: null });
    }
    const raw = fs.readFileSync(AUTOSAVE_FILE, 'utf8');
    return NextResponse.json({ session: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ session: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tmpFile = `${AUTOSAVE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(body), 'utf8');
    fs.renameSync(tmpFile, AUTOSAVE_FILE);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
