import express from 'express'
const router = express.Router()
import verifyToken from '../middlewares/authmiddleware.js'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// 1. Get modules for a course
router.get('/courses/:id/modules', verifyToken, async (req, res) => {
  const courseid = req.params.id
  const userid = req.user?.id

  if (!userid || !courseid) {
    return res.status(401).json({ message: "Unauthorized" })
  }
try {
  const modules = await prisma.module.findMany({
    where: {
      courseId: courseid
    },
    include: {
      course: {
        select: {
          userId: true,  // Changed from creatorId to userId
          title: true,
          description: true
        }
      },
      lessons: true // Include lessons if needed
    }
  });

  return res.status(200).json({
    message: "Modules retrieved successfully",
    modules: modules
  });
} catch (error) {
  console.error("Error fetching modules:", error);
  return res.status(500).json({ message: "Error fetching modules", error: error.message });
}

})

// 2. Get lessons for a module
router.get('/modules/:id/lessons', verifyToken, async (req, res) => {
  const moduleid = req.params.id;
  const userid = req.user?.id;

  if (!moduleid || !userid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const lessons = await prisma.lesson.findMany({
      where: { moduleId: moduleid },
      include: {
        module: {
          include: {
            course: {
              select: {
                userId: true,  // Changed from creatorId to userId
                title: true,
                description: true
              }
            }
          }
        }
      }
    });

    return res.status(200).json({ 
      message: "Lessons retrieved successfully",
      lessons 
    });
  } catch (err) {
    return res.status(500).json({ message: "Error fetching lessons", error: err.message });
  }
});

// 3. Get basic lesson details
router.get('/lessons/:id', verifyToken, async (req, res) => {
  const lessonid = req.params.id
  const userid = req.user?.id

  if (!lessonid || !userid) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonid },
      select: {
        title: true,
        objectives: true,
        isEnriched: true,
        moduleId: true
      }
    })

    return res.status(200).json({ lesson })
  } catch (err) {
    return res.status(500).json({ message: "Error fetching lesson", error: err.message })
  }
})

router.get('/lessons/:id/full', verifyToken, async (req, res) => {
  const lessonid = req.params.id;
  const userid = req.user?.id;

  if (!lessonid || !userid) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const content = await prisma.lesson.findUnique({
      where: { id: lessonid },
      include: {
        contentBlocks: {
          orderBy: {
            order: 'asc'
          },
          select: {
            id: true,
            order: true,
            type: true,
            text: true,
            language: true,
            videoUrl: true,
            mcq: {
              select: {
                id: true,
                question: true,
                options: true,
                answer: true,
                explanation: true
              }
            }
          }
        },
        videos: true
      }
    });

    if (!content) {
      return res.status(404).json({ message: "Lesson not found" });
    }
    content.contentBlocks = content.contentBlocks.map(block => {
      if (block.type === 'MCQ' && block.mcq) {
        return {
          ...block,
          mcqData: block.mcq,
          mcq: undefined 
        };
      }
      return block;
    });

    return res.status(200).json({
      message: "Lesson content retrieved successfully",
      content
    });
  } catch (err) {
    console.error("Error fetching full lesson:", err);
    return res.status(500).json({ 
      message: "Error fetching full lesson", 
      error: err.message 
    });
  }
});
export default router
