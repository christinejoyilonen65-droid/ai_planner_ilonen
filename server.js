import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';

dotenv.config();
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 4000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DATA_DIR = path.join(__dirname, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const PLAN_FILE = path.join(DATA_DIR, 'plan.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const defaults = [
    [TASKS_FILE, '[]'],
    [PLAN_FILE, 'null'],
    [CHAT_FILE, '[]'],
  ];
  for (const [file, fallback] of defaults) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, fallback);
    }
  }
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function requireApiKey(res) {
  if (!GEMINI_API_KEY) {
    res.status(500).json({
      error: 'Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.',
    });
    return false;
  }
  return true;
}

async function callGemini(prompt) {
  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
const data = await response.json();

console.log("Gemini Response:", JSON.stringify(data, null, 2));

if (!response.ok) {
  console.error(data);
  const err = new Error(data?.error?.message || "Gemini API request failed");
  err.status = response.status;
  throw err;
}
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------------------- Tasks ---------------------------- */

app.get('/api/tasks', async (_req, res) => {
  res.json(await readJSON(TASKS_FILE, []));
});

app.post('/api/tasks', async (req, res) => {
  const { title, subject, deadline, estimatedHours, priority } = req.body || {};
  if (!title || !deadline) {
    return res.status(400).json({ error: 'title and deadline are required' });
  }
  const tasks = await readJSON(TASKS_FILE, []);
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: String(title).slice(0, 200),
    subject: subject ? String(subject).slice(0, 60) : 'General',
    deadline,
    estimatedHours: Math.max(0.5, Number(estimatedHours) || 1),
    priority: ['low', 'medium', 'high'].includes(priority) ? priority : 'medium',
    completed: false,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  await writeJSON(TASKS_FILE, tasks);
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', async (req, res) => {
  const tasks = await readJSON(TASKS_FILE, []);
  const task = tasks.find((t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { completed, title, subject, deadline, estimatedHours, priority } = req.body || {};
  if (completed !== undefined) task.completed = Boolean(completed);
  if (title) task.title = String(title).slice(0, 200);
  if (subject) task.subject = String(subject).slice(0, 60);
  if (deadline) task.deadline = deadline;
  if (estimatedHours) task.estimatedHours = Math.max(0.5, Number(estimatedHours));
  if (priority && ['low', 'medium', 'high'].includes(priority)) task.priority = priority;
  await writeJSON(TASKS_FILE, tasks);
  res.json(task);
});

app.delete('/api/tasks/:id', async (req, res) => {
  const tasks = await readJSON(TASKS_FILE, []);
  await writeJSON(TASKS_FILE, tasks.filter((t) => t.id !== req.params.id));
  res.json({ ok: true });
});

/* ------------------------ AI plan generation ------------------------ */

app.post('/api/generate-plan', async (_req, res) => {
  if (!requireApiKey(res)) return;
  const tasks = await readJSON(TASKS_FILE, []);
  const pending = tasks.filter((t) => !t.completed);
  if (pending.length === 0) {
    return res.status(400).json({ error: 'Add at least one open task before generating a plan.' });
  }

  const taskList = pending
    .map((t) => `- "${t.title}" | subject: ${t.subject} | due: ${t.deadline} | est. hours: ${t.estimatedHours} | priority: ${t.priority}`)
    .join('\n');

  const prompt = [
    'You are a study-planning assistant helping a student schedule their work.',
    `Outstanding tasks:\n${taskList}`,
    'Build a realistic day-by-day schedule that respects each deadline and the estimated hours needed.',
    'Order sessions by priority and due date, and keep each day under 6 total study hours.',
    'Respond in concise markdown: one heading per day, bullet points for study sessions. No extra commentary.',
  ].join('\n\n');

  try {
    const text = await callGemini(prompt);
    const plan = { generatedAt: new Date().toISOString(), text };
    await writeJSON(PLAN_FILE, plan);
    res.json(plan);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/plan', async (_req, res) => {
  res.json(await readJSON(PLAN_FILE, null));
});

/* ---------------------------- Chat assistant ---------------------------- */

app.get('/api/chat', async (_req, res) => {
  res.json(await readJSON(CHAT_FILE, []));
});

app.post('/api/chat', async (req, res) => {
  if (!requireApiKey(res)) return;
  const message = (req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message is required' });

  const [tasks, plan, history] = await Promise.all([
    readJSON(TASKS_FILE, []),
    readJSON(PLAN_FILE, null),
    readJSON(CHAT_FILE, []),
  ]);

  const context = [
    'You are a friendly study-planning assistant inside a student productivity app.',
    tasks.length
      ? `Current tasks: ${tasks.map((t) => `${t.title} (due ${t.deadline})`).join('; ')}.`
      : 'The student has not added any tasks yet.',
    plan?.text ? `Current study plan:\n${plan.text}` : 'No study plan has been generated yet.',
    'Answer the student briefly and helpfully.',
  ].join('\n\n');

  try {
    const reply = await callGemini(`${context}\n\nStudent: ${message}`);
    history.push({ role: 'user', text: message, at: new Date().toISOString() });
    history.push({ role: 'assistant', text: reply, at: new Date().toISOString() });
    await writeJSON(CHAT_FILE, history);
    res.json({ reply });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/chat', async (_req, res) => {
  await writeJSON(CHAT_FILE, []);
  res.json({ ok: true });
});

ensureDataFiles().then(() => {
  app.listen(PORT, () => console.log(`AI Study Planner running on http://localhost:${PORT}`));
});
