import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
  const courseId = 'cmd62avx40001w1cwyjltx0se';

  // Fetch course from database
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      modules: {
        include: {
          lessons: true,
        },
      },
    },
  });

  if (!course) {
    console.log('❌ Course not found.');
    return;
  }

  const simplifiedCourse = {
    title: course.title,
    modules: course.modules.map((mod) => ({
      module_title: mod.title,
      lessons: mod.lessons.map((lesson) => ({
        lesson_title: lesson.title,
      })),
    })),
  };

  const prompt = `
You are an AI that transforms lesson outlines into rich educational content blocks in a strict JSON format.

## Your Output Must Follow This Format:
Return a JSON object with the same structure as the input course, where each lesson includes a "content" array. The "content" array contains blocks of the following types:
- "paragraph": An explanatory text block with a "text" field.
- "video": A YouTube search query string (not a link) with a "text" field.
- "mcq": A multiple-choice question block with:
  {
    "type": "mcq",
    "question": "Your question here",
    "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
    "answer": 0,
    "explanation": "Why this answer is correct"
  }

## Output Structure:
{
  "title": "Course title",
  "modules": [
    {
      "module_title": "Module title",
      "lessons": [
        {
          "lesson_title": "Lesson title",
          "content": [
            { "type": "paragraph", "text": "..." },
            { "type": "video", "text": "..." },
            { "type": "mcq", "question": "...", "options": [...], "answer": 0, "explanation": "..." }
          ]
        }
      ]
    }
  ]
}

## Instructions:
- Maintain the exact structure of the input course (title, modules, lessons).
- For each lesson, provide 1–2 paragraph blocks, 1–2 video blocks (YouTube search queries), and 3–5 MCQ blocks.
- Use only the fields specified in the block types.
- Return only valid JSON, with no additional text, markdown, or code block markers (e.g., \`\`\`json).
- Ensure the response is complete and does not exceed 4096 tokens to avoid truncation.

Now enrich this course structure:

${JSON.stringify(simplifiedCourse, null, 2)}
`;

  let output;
  let attempt = 0;
  const maxAttempts = 3;

  // Retry mechanism for API call
  while (attempt < maxAttempts) {
    try {
      console.log(`Attempt ${attempt + 1} to generate content...`);
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      output = response.text;

      // Strip any unexpected code block markers
      output = output.trim().replace(/^```json/, '').replace(/```$/, '').trim();
      console.log('✅ API response received.');
      break; // Exit loop on success
    } catch (error) {
      console.error(`❌ AI generation failed (attempt ${attempt + 1}):`, error.message);
      attempt++;
      if (attempt === maxAttempts) {
        console.error('❌ Max attempts reached. Aborting.');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1s before retry
    }
  }

  let enrichedContent;
  try {
    const parsed = JSON.parse(output);
    if (!parsed.modules || !Array.isArray(parsed.modules)) {
      if (Array.isArray(parsed)) {
        console.log('⚠️ AI returned flat content array. Mapping to first lesson.');
        enrichedContent = {
          modules: [
            {
              lessons: [
                {
                  content: parsed.filter((block) => block.type && ['paragraph', 'video', 'mcq'].includes(block.type)),
                },
              ],
            },
          ],
        };
      } else {
        console.error('❌ Parsed JSON does not contain a valid "modules" array:', parsed);
        return;
      }
    } else {
      enrichedContent = parsed;
    }
    console.log('✅ Parsed JSON:', JSON.stringify(enrichedContent, null, 2));
  } catch (error) {
    console.error('❌ JSON parsing failed:', error.message);
    console.log('Raw Gemini output:\n', output);
    return;
  }

  console.log('✅ Enriched by AI.\nNow updating DB...');

  try {
    for (let modIndex = 0; modIndex < course.modules.length; modIndex++) {
      const module = course.modules[modIndex];
      const enrichedModule = enrichedContent.modules?.[modIndex] || { lessons: [] };

      for (let lessonIndex = 0; lessonIndex < module.lessons.length; lessonIndex++) {
        const lesson = module.lessons[lessonIndex];
        const enrichedLesson = enrichedModule.lessons?.[lessonIndex] || { content: [] };
        const contentBlocks = enrichedLesson.content || [];

        // Validate content blocks
        const validBlocks = contentBlocks.filter((block) => {
          if (!block.type || !['paragraph', 'video', 'mcq'].includes(block.type)) {
            console.warn(`⚠️ Invalid block type in lesson "${lesson.title}":`, block);
            return false;
          }
          if (block.type === 'mcq' && (!block.question || !Array.isArray(block.options) || block.answer == null || !block.explanation)) {
            console.warn(`⚠️ Invalid MCQ block in lesson "${lesson.title}":`, block);
            return false;
          }
          return true;
        });

        if (validBlocks.length === 0) {
          console.warn(`⚠️ No valid content blocks for lesson "${lesson.title}". Skipping update.`);
          continue;
        }

        await prisma.lesson.update({
          where: { id: lesson.id },
          data: {
            isEnriched: true,
            objectives: [], // Add logic to generate objectives if needed
            contentBlocks: {
              deleteMany: {}, // Clear existing blocks to avoid duplicates
              create: validBlocks.map((block, index) => ({
                order: index,
                type: block.type.toUpperCase(),
                text: block.text || null,
                language: block.language || null,
                videoUrl: block.type === 'video' ? block.text : null,
                mcq: block.type === 'mcq'
                  ? {
                      create: {
                        question: block.question,
                        options: block.options,
                        answer: block.answer,
                        explanation: block.explanation,
                      },
                    }
                  : undefined,
              })),
            },
            videos: {
              deleteMany: {}, // Clear existing videos to avoid duplicates
              create: validBlocks
                .filter((b) => b.type === 'video')
                .map((v) => ({ query: v.text })),
            },
          },
        });

        console.log(`✅ Updated lesson: ${lesson.title}`);
      }
    }
    console.log('\n✅ All lessons enriched and saved to DB.');
  } catch (error) {
    console.error('❌ Database update failed:', error.message);
    return;
  } finally {
    await prisma.$disconnect();
  }
}

test().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});