import { createServer } from "node:http";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const servers = new Map();
const repository = "Mrcr1/tailspin-toys";

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function scoreIssue(issue) {
    const labels = issue.labels.map((label) => label.name.toLowerCase());
    let score = 0;
    if (labels.some((label) => ["critical", "security", "blocker"].includes(label))) score += 100;
    if (labels.some((label) => ["bug", "regression", "broken"].includes(label))) score += 50;
    if (labels.some((label) => ["high priority", "priority: high", "urgent"].includes(label))) score += 40;
    if (issue.comments === 0) score += 8;
    score += Math.max(0, 30 - Math.floor((Date.now() - Date.parse(issue.updated_at)) / 86_400_000));
    return score;
}

async function fetchIssues() {
    const response = await fetch(`https://api.github.com/repos/${repository}/issues?state=open&per_page=50`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "issue-triage-board" },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status} while loading issues`);
    return (await response.json())
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({ ...issue, score: scoreIssue(issue) }))
        .sort((left, right) => right.score - left.score || left.number - right.number);
}

function renderHtml() {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Issue triage board</title>
    <style>
      :root { color-scheme: dark; font-family: var(--font-sans, system-ui, sans-serif); }
      body { margin: 0; padding: 24px; background: var(--background-color-default, #0d1117); color: var(--text-color-default, #f0f6fc); }
      h1, h2, p { margin-top: 0; } h1 { font-size: 24px; margin-bottom: 8px; }
      h2 { font-size: 16px; margin: 28px 0 12px; color: var(--text-color-muted, #8b949e); }
      .intro, .status, .meta { color: var(--text-color-muted, #8b949e); } .intro { margin-bottom: 20px; }
      .board { display: grid; gap: 12px; } .card { border: 1px solid var(--border-color-default, #30363d); border-radius: 10px; padding: 16px; background: #161b22; }
      .top .card { border-color: #d29922; } .card-header { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
      .title { color: #58a6ff; font-weight: 600; text-decoration: none; } .number { color: var(--text-color-muted, #8b949e); font-family: var(--font-mono, monospace); }
      .description, .reason { color: #c9d1d9; line-height: 1.45; white-space: pre-wrap; } .reason { border-left: 3px solid #d29922; padding-left: 10px; font-size: 13px; }
      .meta { font-size: 12px; margin: 10px 0; } button { border: 1px solid #238636; border-radius: 6px; padding: 7px 11px; color: #fff; background: #238636; cursor: pointer; font-weight: 600; }
      button:hover { background: #2ea043; } button:focus-visible { outline: 2px solid var(--color-focus-outline, #58a6ff); outline-offset: 2px; } button[disabled] { opacity: .65; cursor: wait; }
      @media (min-width: 720px) { .top { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    </style>
  </head>
  <body>
    <h1>Issue triage board</h1>
    <p class="intro">The three issues most likely to need attention are surfaced first. Add any issue to this session to start working on it.</p>
    <p id="status" class="status" role="status" aria-live="polite">Loading open issues…</p>
    <section aria-labelledby="priority-heading"><h2 id="priority-heading">Needs attention now</h2><div id="priority" class="board top"></div></section>
    <section aria-labelledby="remaining-heading"><h2 id="remaining-heading">Remaining open issues</h2><div id="remaining" class="board"></div></section>
    <script>
      const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
      const reasonFor = (issue, index) => {
        const labels = issue.labels.map((label) => label.name.toLowerCase());
        if (labels.some((label) => ["critical", "security", "blocker"].includes(label))) return "Security or blocking work is explicitly labelled and should be assessed before routine issues.";
        if (labels.some((label) => ["bug", "regression", "broken"].includes(label))) return "This is labelled as a bug or regression, so it may represent broken user-facing behaviour.";
        if (labels.some((label) => ["high priority", "priority: high", "urgent"].includes(label))) return "The issue is explicitly marked high priority or urgent.";
        if (issue.comments === 0) return "No discussion has started yet; triaging it now can prevent it from becoming invisible.";
        return index === 0 ? "It has the strongest current triage signal based on labels, activity, and age." : "It ranks highly relative to the remaining open issues based on current activity and labels.";
      };
      const card = (issue, index, priority) => '<article class="card"><div class="card-header"><a class="title" href="' + escapeHtml(issue.html_url) + '" target="_blank" rel="noreferrer">#' + issue.number + ' ' + escapeHtml(issue.title) + '</a><span class="number">score ' + issue.score + '</span></div><p class="meta">Updated ' + new Date(issue.updated_at).toLocaleDateString() + ' · ' + issue.comments + ' comments</p><p class="description">' + escapeHtml(issue.body || "No description provided.") + '</p>' + (priority ? '<p class="reason"><strong>Why it is here:</strong> ' + reasonFor(issue, index) + '</p>' : '') + '<button type="button" data-testid="add-issue-' + issue.number + '" data-issue=&quot;' + escapeHtml(JSON.stringify({ number: issue.number, title: issue.title, url: issue.html_url, body: issue.body || "" })) + '&quot;>Add to current context</button></article>';
      const load = async () => {
        try {
          const response = await fetch("/api/issues"); if (!response.ok) throw new Error(await response.text());
          const issues = await response.json();
          document.querySelector("#priority").innerHTML = issues.slice(0, 3).map((issue, index) => card(issue, index, true)).join("") || '<p class="status">No open issues found.</p>';
          document.querySelector("#remaining").innerHTML = issues.slice(3).map((issue, index) => card(issue, index, false)).join("") || '<p class="status">All open issues are in the priority section.</p>';
          document.querySelector("#status").textContent = issues.length + " open issues loaded.";
          document.querySelectorAll("button[data-issue]").forEach((button) => button.addEventListener("click", async () => {
            button.disabled = true; button.textContent = "Adding…";
            try {
              const result = await fetch("/api/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: button.dataset.issue });
              if (!result.ok) throw new Error(await result.text()); button.textContent = "Added to context";
            } catch (error) { button.disabled = false; button.textContent = "Add to current context"; document.querySelector("#status").textContent = "Could not add issue: " + error.message; }
          }));
        } catch (error) { document.querySelector("#status").textContent = "Could not load issues: " + error.message; }
      };
      load();
    </script>
  </body>
</html>`;
}

async function startServer() {
    const server = createServer((req, res) => {
        if (req.method === "GET" && req.url === "/api/issues") {
            fetchIssues().then((issues) => {
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(issues));
            }).catch((error) => {
                res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
                res.end(error.message);
            });
            return;
        }
        if (req.method === "POST" && req.url === "/api/add") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const issue = JSON.parse(body);
                    if (!Number.isInteger(issue.number) || typeof issue.title !== "string" || typeof issue.url !== "string") throw new Error("Invalid issue payload");
                    await session.send({ prompt: `Add this GitHub issue to the current work context and begin triaging it:\n\n#${issue.number} ${issue.title}\n${issue.url}\n\n${issue.body}` });
                    res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ added: true }));
                } catch (error) { res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }); res.end(error.message); }
            });
            return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(renderHtml());
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    return { server, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/` };
}

const session = await joinSession({
    canvases: [createCanvas({
        id: "issue-triage-board",
        displayName: "Issue triage board",
        description: "Kanban board showing the three open issues most likely to need attention, with actions to add issues to the current session context.",
        actions: [{
            name: "refresh_issues",
            description: "Refresh the board's open issue ranking.",
            handler: async () => {
                const issues = await fetchIssues();
                return { count: issues.length, topIssueNumbers: issues.slice(0, 3).map((issue) => issue.number) };
            },
        }],
        open: async (ctx) => {
            let entry = servers.get(ctx.instanceId);
            if (!entry) { entry = await startServer(); servers.set(ctx.instanceId, entry); }
            return { title: "Issue triage board", url: entry.url };
        },
        onClose: async (ctx) => {
            const entry = servers.get(ctx.instanceId);
            if (entry) { servers.delete(ctx.instanceId); await new Promise((resolve) => entry.server.close(() => resolve())); }
        },
    })],
});
