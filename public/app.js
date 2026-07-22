const taskForm = document.getElementById('task-form');
const taskList = document.getElementById('task-list');
const progressText = document.getElementById('progress-text');
const progressFill = document.getElementById('progress-fill');

const generateBtn = document.getElementById('generate-btn');
const planStatus = document.getElementById('plan-status');
const planOutput = document.getElementById('plan-output');

const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatLog = document.getElementById('chat-log');

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ------------------------------ Tasks ------------------------------ */

function renderTasks(tasks) {
  taskList.innerHTML = '';
  const total = tasks.length;
  const done = tasks.filter((t) => t.completed).length;

  progressText.textContent = total === 0
    ? '0 of 0 tasks complete'
    : `${done} of ${total} tasks complete`;
  progressFill.style.width = total === 0 ? '0%' : `${Math.round((done / total) * 100)}%`;

  const sorted = [...tasks].sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  for (const task of sorted) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.completed ? ' completed' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.addEventListener('change', () => toggleTask(task.id, checkbox.checked));

    const body = document.createElement('div');
    body.className = 'task-body';

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title;

    const meta = document.createElement('div');
    meta.className = 'task-meta';

    const tag = document.createElement('span');
    tag.className = `priority-tag priority-${task.priority}`;
    tag.textContent = task.priority;

    const subjectSpan = document.createElement('span');
    subjectSpan.textContent = task.subject;

    const dueSpan = document.createElement('span');
    dueSpan.textContent = `due ${task.deadline}`;

    const hoursSpan = document.createElement('span');
    hoursSpan.textContent = `${task.estimatedHours}h`;

    meta.append(tag, subjectSpan, dueSpan, hoursSpan);
    body.append(title, meta);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${task.title}`);
    removeBtn.addEventListener('click', () => removeTask(task.id));

    li.append(checkbox, body, removeBtn);
    taskList.appendChild(li);
  }
}

async function loadTasks() {
  const tasks = await api('/api/tasks');
  renderTasks(tasks);
  return tasks;
}

async function toggleTask(id, completed) {
  await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ completed }) });
  await loadTasks();
}

async function removeTask(id) {
  await api(`/api/tasks/${id}`, { method: 'DELETE' });
  await loadTasks();
}

taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('task-title').value.trim();
  const subject = document.getElementById('task-subject').value.trim();
  const deadline = document.getElementById('task-deadline').value;
  const estimatedHours = document.getElementById('task-hours').value;
  const priority = document.getElementById('task-priority').value;
  if (!title || !deadline) return;

  await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, subject, deadline, estimatedHours, priority }),
  });
  taskForm.reset();
  document.getElementById('task-hours').value = 1;
  await loadTasks();
});

/* --------------------------- Plan generation --------------------------- */

function renderPlan(text) {
  planOutput.innerHTML = '';
  if (!text) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Add some tasks, then generate a plan to see your day-by-day schedule here.';
    planOutput.appendChild(empty);
    return;
  }

  // Minimal markdown-ish rendering: "## Day" headings and "- " bullets only.
  const lines = text.split('\n');
  let list = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,3}\s+/.test(line)) {
      list = null;
      const h = document.createElement('h3');
      h.textContent = line.replace(/^#{1,3}\s+/, '');
      planOutput.appendChild(h);
    } else if (/^[-*]\s+/.test(line)) {
      if (!list) {
        list = document.createElement('ul');
        planOutput.appendChild(list);
      }
      const li = document.createElement('li');
      li.textContent = line.replace(/^[-*]\s+/, '');
      list.appendChild(li);
    } else {
      list = null;
      const p = document.createElement('p');
      p.textContent = line;
      planOutput.appendChild(p);
    }
  }
}

async function loadPlan() {
  const plan = await api('/api/plan');
  renderPlan(plan?.text || '');
}

function setPlanStatus(message, isError = false) {
  if (!message) {
    planStatus.hidden = true;
    return;
  }
  planStatus.hidden = false;
  planStatus.textContent = message;
  planStatus.className = 'status-line' + (isError ? ' error' : '');
}

generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  setPlanStatus('Generating your plan…');
  try {
    const plan = await api('/api/generate-plan', { method: 'POST' });
    renderPlan(plan.text);
    setPlanStatus('');
  } catch (err) {
    setPlanStatus(err.message, true);
  } finally {
    generateBtn.disabled = false;
  }
});

/* ------------------------------- Chat ------------------------------- */

function appendBubble(role, text, pending = false) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}${pending ? ' pending' : ''}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
  return bubble;
}

async function loadChat() {
  const history = await api('/api/chat');
  chatLog.innerHTML = '';
  for (const entry of history) {
    appendBubble(entry.role, entry.text);
  }
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = '';
  appendBubble('user', message);
  const pending = appendBubble('assistant', 'Thinking…', true);

  try {
    const { reply } = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message }) });
    pending.remove();
    appendBubble('assistant', reply);
  } catch (err) {
    pending.remove();
    appendBubble('assistant', `Error: ${err.message}`);
  }
});

/* ------------------------------- Init ------------------------------- */

(async function init() {
  await Promise.all([loadTasks(), loadPlan(), loadChat()]);
})();
