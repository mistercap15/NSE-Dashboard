import { NextResponse } from 'next/server';
import pilot from '../../../../lib/gapPaperPilot.json';
export function GET() {
  return NextResponse.json(pilot, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
