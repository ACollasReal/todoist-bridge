export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Simple shared-secret auth
  const secret = req.headers["x-task-push-secret"];
  if (!secret || secret !== process.env.TASK_PUSH_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = process.env.TODOIST_TOKEN;
  if (!token) return res.status(500).json({ error: "Missing TODOIST_TOKEN" });

  const { project, subtasks } = req.body || {};
  if (!project?.title || !Array.isArray(subtasks)) {
    return res.status(400).json({ error: "Expected { project: { title, todoist_project_id? }, subtasks: [...] }" });
  }

  const base = "https://api.todoist.com/rest/v2";
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const parentPayload = {
    content: project.title,
    project_id: project.todoist_project_id ?? undefined,
    description: project.description ?? undefined,
    ...(project.due ? { due: project.due } : {}),
    ...(project.due_string ? { due_string: project.due_string } : {}),
    labels: project.labels ?? undefined,
    priority: project.priority ?? undefined
  };

  const parentResp = await fetch(`${base}/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify(parentPayload)
  });
  if (!parentResp.ok) return res.status(parentResp.status).json({ error: await parentResp.text() });
  const parentTask = await parentResp.json();

  const created = [];
  for (const t of subtasks) {
    const payload = {
      content: t.content,
      description: t.description ?? undefined,
      project_id: project.todoist_project_id ?? undefined,
      parent_id: parentTask.id,
      ...(t.due ? { due: t.due } : {}),
      ...(t.due_string ? { due_string: t.due_string } : {}),
      labels: t.labels ?? undefined,
      priority: t.priority ?? undefined
    };
    const r = await fetch(`${base}/tasks`, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    created.push(await r.json());
  }

  return res.status(200).json({ parent: parentTask, subtasks: created });
}
