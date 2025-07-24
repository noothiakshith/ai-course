import { GoogleGenAI } from '@google/genai';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import authenticateToken from '../middlewares/authmiddleware.js';

const prisma = new PrismaClient();
const routes = express.Router();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDz72MYyBn-owyYM7_rX4Eh1oYIpxzuyiU'; // Use env variable
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

routes.post('/generate', authenticateToken, async (req, res) => {
  const { topic, difficulty, duration } = req.body;
  const userId = req.user.id; 
  if (!topic || !difficulty || !duration) {
    return res.status(400).json({ error: 'Missing topic, difficulty, or duration' });
  }

  const validDifficulties = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];
  if (!validDifficulties.includes(difficulty.toUpperCase())) {
    return res.status(400).json({ error: 'Invalid difficulty. Must be BEGINNER, INTERMEDIATE, or ADVANCED' });
  }

  const prompt = `
You are an expert curriculum designer and educator specializing in creating comprehensive, engaging, and logically structured online courses. Your task is to generate a detailed course outline in a strict JSON format based on user-provided topic, difficulty, and duration.

**Input Parameters:**
- topic: ${topic}
- difficulty: ${difficulty}
- duration: ${duration}

**Output Format Requirements (Strict JSON):**
Your response *must* be a single, perfectly valid JSON object. Do not include any conversational text, explanations, or markdown fences outside of the JSON object itself. The JSON object should start immediately. The JSON object should adhere strictly to the following structure:
{
  "title": "A catchy, relevant, and engaging course title derived from the topic",
  "description": "A concise and compelling description of the course, outlining what learners will achieve, who it's for, and the main benefits. (Approx. 2-4 sentences)",
  "tags": [
    "keyword1",
    "keyword2",
    "keyword3",
    "keyword4",
    "keyword5"
  ],
  "modules": [
    {
      "module_title": "Title of Module 1",
      "lesson_titles": [
        "Title of Lesson 1.1",
        "Title of Lesson 1.2"
      ]
    }
  ]
}

**Guidelines:**
- Build from foundational to advanced concepts, tailored to the specified difficulty (${difficulty}).
- Generate 3 modules total, appropriate for the duration (${duration}).
- Each module should have 3 lesson titles, each concise, clear, and relevant to the module.
- Use 3 concise tags relevant to the topic.
- Output only the JSON object. Do not include markdown code fences .
- Ensure no trailing commas in arrays or objects.
`;

  try {
    const response = await ai.models.generateContentStream({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    let fullResponse = '';
    for await (const chunk of response) {
      fullResponse += chunk.text || '';
    }

    // Clean the response to remove markdown and ensure valid JSON
    let cleanedResponse = fullResponse
      .replace(/```json\n?/, '') // Remove opening ```json
      .replace(/\n?```/, '')     // Remove closing ```
      .replace(/,\s*]/g, ']')    // Remove trailing commas in arrays
      .replace(/,\s*}/g, '}');   // Remove trailing commas in objects


    let courseData;
    try {
      courseData = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('Invalid JSON:', cleanedResponse);
      return res.status(500).json({ error: 'AI response was not valid JSON', raw: cleanedResponse });
    }


    if (!courseData.title || !courseData.description || !courseData.tags || !courseData.modules) {
      return res.status(500).json({ error: 'Invalid course data structure', raw: courseData });
    }

    const durationMatch = duration.match(/(\d+)\s*week(s)?/i);
    const durationDays = durationMatch ? parseInt(durationMatch[1]) * 7 : 7;

    try {
      const course = await prisma.course.create({
        data: {
          title: courseData.title,
          description: courseData.description,
          tags: courseData.tags,
          difficulty: difficulty.toUpperCase(), 
          durationDays: durationDays,
          userId: userId,
          modules: {
            create: courseData.modules.map((module) => ({
              title: module.module_title,
              lessons: {
                create: module.lesson_titles.map((lessonTitle) => ({
                  title: lessonTitle,
                })),
              },
            })),
          },
        },
        include: {
          modules: {
            include: {
              lessons: true,
            },
          },
        },
      });

      res.json({ message: 'Course generated and saved successfully', course });
    } catch (dbError) {
      console.error('Database error:', dbError);
      res.status(500).json({ error: 'Failed to save course to database' });
    }
  } catch (aiError) {
    console.error('AI generation error:', aiError);
    res.status(500).json({ error: 'Failed to generate course outline' });
  }
});

routes.get('/courses', authenticateToken, async (req, res) => {
  const userid = req.user?.id;
  if (!userid) {
    return res.status(401).json({ message: "unauthorized" });
  }
  try {
    const allcourses = await prisma.course.findMany({
      where: {
        userId: userid
      },
      select: {
        id: true,
        title: true,
        difficulty: true,
        durationDays: true,
      }
    });
    return res.status(200).json({
      message: "courses retrieved successfully",
      courses: allcourses
    });
  }
  catch (error) {
    console.error("error in getting courses", error);
    return res.status(500).json({ message: "internal server error" });
  }
});

routes.get('/courses/:id', authenticateToken, async (req, res, next) => {
  const courseid = req.params.id;
  const userid = req.user?.id;
  
  if (!userid || !courseid) {
    return res.status(401).json({
      message: "unauthorized"
    });
  }
  
  try {
    const course = await prisma.course.findUnique({
      where: {
        id: courseid,
        userId: userid
      },
      include: {
        modules: {
          include: {
            lessons: true
          }
        }
      }
    });

    if (!course) {
      return res.status(404).json({
        message: "Course not found"
      });
    }

    return res.status(200).json({
      message: "Course retrieved successfully",
      course: course
    });
  }
  catch (error) {
    console.error("Error in getting course:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default routes;


