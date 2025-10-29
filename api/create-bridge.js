// Serverless function for creating a Todoist parent task with ordered subtasks.
// CommonJS export for Vercel (@vercel/node).
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed", hint: "Use POST with JSON body" });
    }

    // ---- Auth: accept either x-task-push-secret or Authorization: Bearer <secret>
    const bearer = (req.headers["authorization"] || "").startsWith("Bearer ")
      ? req.headers["authorization"].slice(7)
      : null;
    const incomingSecret = req.headers["x-task-push-secret"] || bearer;
    if (!incomingSecret || incomingSecret !== process.env.TASK_PUSH_SECRET) {
      return res.status(401).json({ error: "Unauthorized", hint: "x-task-push-secret / Bearer mismatch" });
    }

    // ---- Parse JSON body safely
    let body = req.body;
    if (!body || typeof body === "string") {
      try { body = JSON.parse(body || "{}"); } catch { body = null; }
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const { project, subtasks } = body;
    if (!project?.title || !Array.isArray(subtasks)) {
      return res.status(400).json({
        error: "Bad payload",
        expected: '{ project: { title, todoist_project_id? }, subtasks: [{ content, ... }] }'
      });
    }

    // ---- dryRun mode (no Todoist calls)
    const dryRun =
      (req.query && req.query.dryRun === "true") ||
      (req.headers["x-dry-run"] === "true");

    const token = process.env.TODOIST_TOKEN;
    if (!token && !dryRun) {
      return res.status(500).json({ error: "Missing TODOIST_TOKEN env var" });
    }
    const base = "https://api.todoist.com/rest/v2";
    const headers = token
      ? { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };

    // ---- Sanitize/resolve project_id (Inbox-safe)
    // Accept numeric string or number. Ignore names like "Inbox" (Todoist will use Inbox).
    // Optional default via env var DEFAULT_TODOIST_PROJECT_ID.
    const rawProj = project.todoist_project_id;
    const defaultProjectId = process.env.DEFAULT_TODOIST_PROJECT_ID || undefined;
    let project_id;
    if (typeof rawProj === "number") {
      project_id = String(rawProj);
    } else if (typeof rawProj === "string" && /^\d+$/.test(rawProj.trim())) {
      project_id = rawProj.trim();
    } else {
      project_id = defaultProjectId; // may be undefined; Todoist will then use Inbox
    }

    // ---- Build payloads
    const parentPayload = {
      content: project.title,
      project_id,
      description: project.description ?? undefined,
      ...(project.due ? { due: project.due } : {}),
      ...(project.due_string ? { due_string: project.due_string } : {}),
      labels: project.labels ?? undefined,
      priority: project.priority ?? undefined
    };

    const childrenPayloads = subtasks.map((t) => ({
      content: t.content,
      description: t.description ?? undefined,
      project_id,
      ...(t.due ? { due: t.due } : {}),
      ...(t.due_string ? { due_string: t.due_string } : {}),
      labels: t.labels ?? undefined,
      priority: t.priority ?? undefined
    }));

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        parentPayload,
        childrenPayloadsCount: childrenPayloads.length,
        hint: "Remove ?dryRun=true to actually create tasks"
      });
    }

    // ---- Create parent
    const parentResp = await fetch(`${base}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify(parentPayload)
    });
    const parentText = await parentResp.text();
    if (!parentResp.ok) {
      return res.status(parentResp.status).json({ error: "Parent task failed", detail: parentText });
    }
    const parentTask = JSON.parse(parentText);

    // ---- Create children in order
    const created = [];
    for (const payload of childrenPayloads) {
      const r = await fetch(`${base}/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...payload, parent_id: parentTask.id })
      });
      const txt = await r.text();
      if (!r.ok) {
        return res.status(r.status).json({ error: "Subtask failed", detail: txt });
      }
      created.push(JSON.parse(txt));
    }

    return res.status(200).json({ parent: parentTask, subtasks: created });
  } catch (e) {
    return res.status(500).json({ error: "Unhandled exception", message: String(e && e.message || e) });
  }
};
