import { NextRequest, NextResponse } from 'next/server';

export interface SuggestedInterval {
  id: string;
  label: string;
  startTime: number;
  endTime: number;
  reason: string;
  recommendedPrompt: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const duration = Math.max(3, Number(body.duration) || 12);

    const t1End = Number((duration * 0.35).toFixed(1));
    const t2Start = Number((duration * 0.38).toFixed(1));
    const t2End = Number((duration * 0.72).toFixed(1));
    const t3Start = Number((duration * 0.75).toFixed(1));
    const t3End = Number((duration * 0.96).toFixed(1));

    const suggestions: SuggestedInterval[] = [
      {
        id: 'scene-intro',
        label: 'Opening Subject Focus',
        startTime: 0.5,
        endTime: t1End,
        reason: 'Primary subject establishes movement in foreground.',
        recommendedPrompt:
          'Spotlight the red area and add text "MAIN SUBJECT" on the red area',
      },
      {
        id: 'scene-peak',
        label: 'Mid-Clip Action Peak',
        startTime: t2Start,
        endTime: t2End,
        reason: 'Highest visual contrast across left, center, and right zones.',
        recommendedPrompt:
          'Anime impact on the red area, manga ink on the green area, and blur the blue area',
      },
      {
        id: 'scene-outro',
        label: 'Cinematic Outro Pull',
        startTime: t3Start,
        endTime: t3End,
        reason: 'Ideal window for slow-motion color splash and closing focus.',
        recommendedPrompt:
          'Keep the red area in color and make the background black and white, slow motion 0.5x',
      },
    ];

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('Error in /api/ai-analyze:', error);
    return NextResponse.json(
      { error: 'Failed to analyze video intervals' },
      { status: 500 }
    );
  }
}
