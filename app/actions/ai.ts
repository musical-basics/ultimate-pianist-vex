'use server'

/**
 * AI Server Action — wraps Gemini anchor prediction behind a server-only boundary.
 * This hides the API key from the client bundle.
 * Audio is fetched server-side by URL to avoid the server action body size limit.
 */

import { GoogleGenAI, Type } from '@google/genai'
import { getConfigsWithCorrections } from '@/lib/services/configService'
import type { Anchor } from '@/lib/types'

const anchorArraySchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            measure: { type: Type.INTEGER, description: 'Measure number (1-indexed)' },
            time: { type: Type.NUMBER, description: 'Time in seconds when this measure starts' },
        },
        required: ['measure', 'time'],
    },
}

export async function predictAnchors(
    audioUrl: string,
    xmlContent: string,
    totalMeasures: number,
    existingAnchors: Anchor[] = []
): Promise<{ anchors: Array<{ measure: number; time: number }> }> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || ''
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

    const ai = new GoogleGenAI({ apiKey })

    // Fetch audio server-side and convert to base64
    const audioRes = await fetch(audioUrl)
    const audioBuffer = await audioRes.arrayBuffer()
    const audioBase64 = Buffer.from(audioBuffer).toString('base64')
    const contentType = audioRes.headers.get('content-type') || 'audio/wav'

    // Build existing anchor context for the prompt
    let existingAnchorText = ''
    if (existingAnchors.length > 0) {
        const sorted = [...existingAnchors].sort((a, b) => a.measure - b.measure)
        existingAnchorText = `

CRITICAL — The user has already manually mapped ${sorted.length} measures by listening to the audio and aligning to note onsets/transients. These are GROUND TRUTH and must NOT be changed:

${sorted.map((a) => `  Measure ${a.measure}: ${a.time.toFixed(2)}s`).join('\n')}

Study the pattern of these manual mappings carefully:
- Notice how the timing between measures varies (this is a real performance with rubato/tempo changes)
- Measures are NOT evenly spaced — each measure aligns to where the first beat of that measure is actually heard in the audio
- Your job is to continue this same mapping style for the REMAINING UNMAPPED measures
- Listen to the audio transients (note attacks, chord changes, rhythmic accents) to find where each unmapped measure begins
- The spacing between measures should reflect the actual musical phrasing, not a fixed interval

Only return anchors for the UNMAPPED measures (measures NOT listed above).`
    }

    // Dynamic few-shot: get past corrections for learning
    let fewShotText = ''
    try {
        const corrected = await getConfigsWithCorrections()
        if (corrected.length > 0) {
            fewShotText = '\n\nHere are examples of correct mappings from other songs for reference:\n'
            for (const config of corrected.slice(0, 3)) {
                fewShotText += `\nSong: "${config.title}"\n`
                fewShotText += `Corrected anchors: ${JSON.stringify(config.anchors)}\n`
            }
        }
    } catch {
        // Silently skip if corrections unavailable
    }

    const unmappedMeasures = existingAnchors.length > 0
        ? `Only predict the UNMAPPED measures. The mapped measures (${existingAnchors.map(a => a.measure).join(', ')}) are already correct — do NOT include them in your response.`
        : `Predict all ${totalMeasures} measures.`

    const prompt = `You are a music transcription AI specialized in aligning audio recordings to MusicXML scores.

TASK: Listen to the provided audio and determine the exact timestamp (in seconds) when each measure begins, by identifying note onsets and transients in the audio.

${unmappedMeasures}

RULES:
1. Each measure's start time must align with an audible note onset, chord attack, or rhythmic accent in the audio
2. Do NOT evenly divide the audio duration — real performances have tempo variations, rubato, ritardandos, accelerandos, and rests
3. Listen for changes in harmony, melodic phrases, and rhythmic patterns to identify measure boundaries  
4. Pay attention to time signature changes and pickup measures in the score
5. Be precise to within 0.25 seconds${existingAnchorText}${fewShotText}

Return a JSON array where each object has:
- "measure": the measure number (1-indexed)
- "time": the time in seconds when this measure begins (use decimals, e.g. 12.35)

MusicXML score for structural reference:
${xmlContent.substring(0, 8000)}${xmlContent.length > 8000 ? '\n... (truncated)' : ''}`

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        inlineData: {
                            mimeType: contentType,
                            data: audioBase64,
                        },
                    },
                    { text: prompt },
                ],
            },
        ],
        config: {
            responseMimeType: 'application/json',
            responseSchema: anchorArraySchema,
        },
    })

    const text = response.text || '[]'
    const anchors = JSON.parse(text)

    return { anchors }
}
