/* Research Workspace — browser app. Plain JavaScript, no build step. */
(function () {
"use strict";

/* ------------------------------- state ------------------------------- */
var S = null;            // workspace data from the server
var ME = null;           // signed-in user
var VIEW = { name: "dashboard" };
var WEEK_ID = null;
var OPEN_NODES = {};     // expanded branches in the tree
var FILTERS = { member: "", status: "", priority: "", branch: "", due: "", type: "", q: "", confidence: "", tag: "" };
var MODAL_OPEN = false;
var SEARCH = "";

/* ------------------------------ constants ------------------------------ */
var STATUS = ["TODO", "IN PROGRESS", "BLOCKED", "REVIEW", "COMPLETED"];
var PRIORITY = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
var CONFIDENCE = ["LOW", "MEDIUM", "HIGH"];
var RES_TYPES = ["ARTICLE", "PAPER", "COMPANY", "PATENT", "VIDEO", "REPORT", "PRODUCT", "NEWS", "OTHER"];
var OPP_STATUS = ["EXPLORING", "VALIDATING", "PROMISING", "SHORTLISTED", "REJECTED"];
var BRANCH_STATUS = ["ACTIVE", "EXPLORING", "PARKED", "DONE"];
var VERDICTS = ["KEEP", "INVESTIGATE", "REJECT", "DECISION NEEDED"];
var OPP_FIELDS = [["problem", "Problem"], ["customer", "Customer"], ["existing", "Existing solution"], ["market", "Market"],
  ["pain", "Pain level"], ["wtp", "Willingness to pay"], ["tech", "Technology required"], ["competition", "Competition"],
  ["whyNow", "Why now?"], ["whyUs", "Why us?"], ["moat", "Potential moat"], ["mvpCost", "Estimated MVP cost"],
  ["regulatory", "Regulatory barriers"], ["scalability", "Scalability"], ["openQs", "Open questions"]];
var SUMMARY_FIELDS = [["learned", "What we learned"], ["gaps", "Major market gaps"], ["tech", "Important technologies"],
  ["opportunities", "Potential opportunities"], ["strongest", "Strongest opportunity"], ["why", "Why"],
  ["risks", "Major risks"], ["validation", "Questions requiring validation"], ["next", "Next steps"]];
var CHECKLIST = ["All critical tasks completed", "Major branches reviewed", "Important sources attached",
  "Findings compiled", "Opportunities identified", "Open questions documented", "Final discussion completed"];
var MEETING_PROMPTS = [["learned", "What did we learn?"], ["surprised", "What surprised us?"], ["gaps", "What are the biggest gaps?"],
  ["opps", "What opportunities emerged?"], ["reject", "What do we reject?"], ["validate", "What needs validation?"],
  ["next", "What should we research next?"]];
var NAV = [["dashboard", "Dashboard"], ["tree", "Research tree"], ["mywork", "My work"], ["tasks", "All tasks"],
  ["ideas", "Ideas"], ["findings", "Findings"], ["resources", "Resources"], ["opportunities", "Opportunities"],
  ["decisions", "Decisions"], ["meeting", "Meeting"], ["summary", "Weekly summary"], ["team", "Team"], ["archive", "Archive"]];

/* ------------------------------- helpers ------------------------------- */
function esc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function today() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) {
  if (!d) return "—";
  var dt = new Date(String(d).length <= 10 ? d + "T00:00:00" : d);
  if (isNaN(dt)) return "—";
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function fmtDateTime(d) {
  var dt = new Date(d);
  if (isNaN(dt)) return "—";
  return fmtDate(d) + ", " + dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function addDays(d, n) { var x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
function daysLeft(end) { return Math.ceil((new Date(end + "T23:59:59") - new Date()) / 86400000); }
function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
function nameOf(id) { var m = byId(S.members, id); return m ? m.name : "Unassigned"; }
function initials(n) { return String(n || "?").split(" ").map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase(); }
function week() { return byId(S.weeks, WEEK_ID) || S.weeks[0]; }
function isAdmin() { return ME && ME.role === "ADMIN"; }
function readOnly() { var w = week(); return !w || w.status !== "ACTIVE"; }
function pathOf(branchId) {
  var out = [], b = byId(S.branches, branchId), guard = 0;
  while (b && guard++ < 30) { out.unshift(b); b = b.parentId ? byId(S.branches, b.parentId) : null; }
  return out;
}
function crumb(branchId) { return pathOf(branchId).map(function (b) { return b.name; }).join(" → "); }
function descendantIds(branchId) {
  var out = [branchId];
  (function walk(id) {
    S.branches.filter(function (b) { return b.parentId === id; }).forEach(function (c) { out.push(c.id); walk(c.id); });
  })(branchId);
  return out;
}
function childrenOf(parentId) {
  var w = week();
  return S.branches.filter(function (b) { return b.weekId === w.id && (b.parentId || null) === parentId; });
}
function stats(weekId) {
  var t = S.tasks.filter(function (x) { return x.weekId === weekId; });
  var done = t.filter(function (x) { return x.status === "COMPLETED"; }).length;
  return {
    tasks: t.length, done: done, pct: t.length ? Math.round(done / t.length * 100) : 0,
    branches: S.branches.filter(function (b) { return b.weekId === weekId; }).length,
    ideas: S.branches.filter(function (b) { return b.weekId === weekId && b.isIdea; }).length,
    findings: S.findings.filter(function (f) { return f.weekId === weekId; }).length,
    resources: S.resources.filter(function (r) { return r.weekId === weekId; }).length,
    questions: S.notes.filter(function (n) { return n.weekId === weekId && n.kind === "QUESTION" && !n.resolved; }).length,
    opportunities: S.opportunities.filter(function (o) { return o.weekId === weekId; }).length
  };
}
function toneFor(kind, v) {
  if (kind === "status") return { "TODO": "", "IN PROGRESS": "indigo", "BLOCKED": "red", "REVIEW": "amber", "COMPLETED": "green" }[v] || "";
  if (kind === "priority") return { LOW: "", MEDIUM: "", HIGH: "amber", CRITICAL: "red" }[v] || "";
  if (kind === "confidence") return { LOW: "", MEDIUM: "amber", HIGH: "green" }[v] || "";
  if (kind === "opp") return { EXPLORING: "", VALIDATING: "indigo", PROMISING: "green", SHORTLISTED: "violet", REJECTED: "red" }[v] || "";
  return "";
}
function chip(text, tone) { return '<span class="chip ' + (tone || "") + '">' + esc(text) + "</span>"; }
function avatar(name) { return '<span class="avatar">' + esc(initials(name)) + "</span>"; }
function icon(n) {
  var p = {
    plus: '<path d="M8 3v10M3 8h10"/>', chevron: '<path d="M6 4l4 4-4 4"/>', down: '<path d="M4 6l4 4 4-4"/>',
    search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l4 4"/>', clock: '<circle cx="8" cy="8" r="6"/><path d="M8 5v3.5l2 1"/>',
    trash: '<path d="M3 4h10M6 4V3h4v1M5 4l.7 9h4.6L11 4"/>', edit: '<path d="M11 2l3 3-8 8H3v-3z"/>',
    lock: '<rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
    spark: '<path d="M8 2l1.6 4.4L14 8l-4.4 1.6L8 14l-1.6-4.4L2 8l4.4-1.6z"/>', back: '<path d="M10 4L6 8l4 4"/>',
    menu: '<path d="M2 4h12M2 8h12M2 12h12"/>', check: '<path d="M3 8.5l3.5 3.5L13 5"/>'
  }[n] || "";
  return '<svg viewBox="0 0 16 16" class="ico" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>";
}
function selectHtml(name, options, value, placeholder) {
  var h = '<select id="' + name + '" class="input">';
  if (placeholder !== undefined) h += '<option value="">' + esc(placeholder) + "</option>";
  options.forEach(function (o) {
    var v = typeof o === "string" ? o : o[0], l = typeof o === "string" ? o : o[1];
    h += '<option value="' + esc(v) + '"' + (v === value ? " selected" : "") + ">" + esc(l) + "</option>";
  });
  return h + "</select>";
}
function field(label, inner, hint) {
  return '<label class="field"><span class="field-label">' + esc(label) + "</span>" + inner +
    (hint ? '<span class="hint">' + esc(hint) + "</span>" : "") + "</label>";
}
function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }
function checked(id) { var el = document.getElementById(id); return el ? el.checked : false; }
function empty(msg, actionHtml) {
  return '<div class="empty"><p>' + esc(msg) + "</p>" + (actionHtml || "") + "</div>";
}
function card(title, body, actionHtml) {
  return '<section class="card">' + (title ? '<header class="card-head"><h2>' + esc(title) + "</h2>" + (actionHtml || "") + "</header>" : "") +
    '<div class="card-body">' + body + "</div></section>";
}

/* --------------------------------- api --------------------------------- */
function apiGet(url) {
  return fetch(url, { credentials: "same-origin" }).then(function (r) {
    if (r.status === 401) { ME = null; renderLogin(); throw new Error("unauthenticated"); }
    return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Request failed"); return j; });
  });
}
function apiPost(url, body) {
  return fetch(url, {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {})
  }).then(function (r) {
    if (r.status === 401) { ME = null; renderLogin(); throw new Error("unauthenticated"); }
    return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Request failed"); return j; });
  });
}
function op(type, payload) {
  setBusy(true);
  return apiPost("/api/op", { type: type, payload: payload || {} })
    .then(function (res) { S = res.state; setBusy(false); render(); return res; })
    .catch(function (e) { setBusy(false); if (e.message !== "unauthenticated") toast(e.message); throw e; });
}
function setBusy(b) { var el = document.getElementById("busy"); if (el) el.style.visibility = b ? "visible" : "hidden"; }
function toast(msg) {
  var el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(function () { el.classList.remove("show"); }, 4000);
}

/* -------------------------------- login -------------------------------- */
function renderLogin(message) {
  MODAL_OPEN = false;
  document.getElementById("modal").innerHTML = "";
  document.getElementById("root").innerHTML =
    '<div class="login-wrap"><div class="login">' +
      '<div class="logo">R</div>' +
      "<h1>Research workspace</h1>" +
      "<p class=\"muted\">One topic a week, researched together. Sign in to pick up where the team left off.</p>" +
      '<div class="card"><div class="card-body">' +
        field("Name", '<input id="login-name" class="input" autocomplete="username" placeholder="Admin">') +
        field("Password", '<input id="login-pass" type="password" class="input" autocomplete="current-password">') +
        '<p id="login-err" class="err">' + esc(message || "") + "</p>" +
        '<button class="btn primary wide" onclick="A.login()">Sign in</button>' +
      "</div></div>" +
    "</div></div>";
  var p = document.getElementById("login-pass");
  p.addEventListener("keydown", function (e) { if (e.key === "Enter") A.login(); });
  document.getElementById("login-name").focus();
}

/* -------------------------------- shell -------------------------------- */
function render() {
  if (!ME) return renderLogin();
  if (!WEEK_ID || !byId(S.weeks, WEEK_ID)) {
    var active = S.weeks.filter(function (w) { return w.status === "ACTIVE"; })[0] || S.weeks[S.weeks.length - 1];
    WEEK_ID = active ? active.id : null;
  }
  var w = week();
  var weekOptions = S.weeks.slice().sort(function (a, b) { return b.number - a.number; }).map(function (x) {
    return [x.id, "Week " + String(x.number).padStart(2, "0") + " — " + x.topic + (x.status === "ARCHIVED" ? " (archived)" : "")];
  });
  var html =
    '<div class="layout">' +
      '<aside class="sidebar" id="sidebar">' +
        '<div class="brand"><span class="logo sm">R</span><div><div class="brand-name">Research workspace</div>' +
        '<div class="muted xs">' + S.members.length + " members</div></div></div>" +
        '<nav class="nav">' + NAV.map(function (n) {
          var active = VIEW.name === n[0] || (VIEW.name === "branch" && n[0] === "tree");
          return '<button class="nav-item' + (active ? " active" : "") + '" onclick="A.go(\'' + n[0] + '\')">' + esc(n[1]) + "</button>";
        }).join("") + "</nav>" +
        '<div class="me">' + avatar(ME.name) +
          '<div class="grow"><div class="me-name">' + esc(ME.name) + "</div>" +
          '<div class="muted xs">' + (ME.role === "ADMIN" ? "Admin" : "Member") + "</div></div>" +
          '<button class="btn icon-btn" title="Account" onclick="A.account()">' + icon("edit") + "</button>" +
          '<button class="btn icon-btn" title="Sign out" onclick="A.logout()">' + icon("back") + "</button>" +
        "</div>" +
      "</aside>" +
      '<div class="main-col">' +
        '<header class="topbar">' +
          '<button class="btn icon-btn only-mobile" onclick="A.toggleNav()">' + icon("menu") + "</button>" +
          '<div class="search-wrap">' + icon("search") +
            '<input id="global-search" class="search" placeholder="Search tasks, findings, sources, notes…" value="' + esc(SEARCH) + '" oninput="A.search(this.value)">' +
            '<div id="search-results" class="search-results"></div>' +
          "</div>" +
          '<div class="topbar-right"><span id="busy" class="busy">saving…</span>' +
          selectHtml("week-picker", weekOptions, w ? w.id : "") + "</div>" +
        "</header>" +
        (readOnly() && w ? '<div class="bar">' + icon("lock") + " Week " + String(w.number).padStart(2, "0") + " is archived. You can read everything; editing is closed.</div>" : "") +
        '<main class="content" id="content">' + screen() + "</main>" +
      "</div>" +
    "</div>";
  document.getElementById("root").innerHTML = html;
  document.getElementById("week-picker").addEventListener("change", function (e) {
    WEEK_ID = e.target.value; VIEW = { name: VIEW.name === "branch" ? "tree" : VIEW.name }; render();
  });
  if (SEARCH) renderSearchResults();
}

function screen() {
  if (!week()) return empty("No week has been created yet. An admin can start one from the Archive screen.");
  switch (VIEW.name) {
    case "dashboard": return viewDashboard();
    case "tree": return viewTree();
    case "branch": return viewBranch();
    case "mywork": return viewMyWork();
    case "tasks": return viewTasks();
    case "ideas": return viewIdeas();
    case "findings": return viewFindings();
    case "resources": return viewResources();
    case "opportunities": return viewOpportunities();
    case "decisions": return viewDecisions();
    case "meeting": return viewMeeting();
    case "summary": return viewSummary();
    case "team": return viewTeam();
    case "archive": return viewArchive();
    default: return viewDashboard();
  }
}
function pageHead(title, sub, actionHtml) {
  return '<div class="page-head"><div><h1>' + esc(title) + "</h1>" +
    (sub ? '<p class="muted">' + esc(sub) + "</p>" : "") + "</div>" + (actionHtml || "") + "</div>";
}

/* ------------------------------ dashboard ------------------------------ */
function viewDashboard() {
  var w = week(), st = stats(w.id), left = daysLeft(w.end);
  var mine = S.tasks.filter(function (t) { return t.weekId === w.id && t.assignee === ME.id && t.status !== "COMPLETED"; });
  var ideas = S.branches.filter(function (b) { return b.weekId === w.id && b.isIdea; }).slice(-3).reverse();
  var recentF = S.findings.filter(function (f) { return f.weekId === w.id; }).slice(-4).reverse();
  var recentR = S.resources.filter(function (r) { return r.weekId === w.id; }).slice(-4).reverse();
  var qs = S.notes.filter(function (n) { return n.weekId === w.id && n.kind === "QUESTION" && !n.resolved; }).slice(0, 5);

  var head = '<div class="week-head">' +
    '<div class="week-top"><div>' +
      '<div class="muted xs">Week ' + String(w.number).padStart(2, "0") + " · " + fmtDate(w.start) + " – " + fmtDate(w.end) + "</div>" +
      "<h1>" + esc(w.topic) + "</h1>" +
      '<p class="objective">' + esc(w.objective) + "</p>" +
    "</div><div class=\"week-actions\">" +
      (readOnly() ? "" : '<button class="btn primary" onclick="A.newIdea()">' + icon("plus") + " New branch / idea</button>") +
      (isAdmin() && !readOnly() ? '<button class="btn" onclick="A.editWeek()">' + icon("edit") + " Edit week</button>" : "") +
      (isAdmin() && !readOnly() ? '<button class="btn" onclick="A.closeWeek()">' + icon("lock") + " Close week</button>" : "") +
    "</div></div>" +
    '<div class="progress"><div class="bar-fill" style="width:' + st.pct + '%"></div></div>' +
    '<div class="muted xs">' + st.pct + "% of tasks done</div></div>";

  var statRow = '<div class="stat-row">' +
    stat(st.done + " / " + st.tasks, "Tasks done") + stat(st.branches, "Branches") + stat(st.ideas, "New ideas") +
    stat(st.findings, "Findings") + stat(st.resources, "Sources") + stat(left > 0 ? left : 0, "Days left") + "</div>";

  var dow = new Date().getDay();
  var phase = readOnly() ? 3 : dow === 1 ? 0 : (dow >= 2 && dow <= 4) ? 1 : dow === 5 ? 2 : 3;
  var steps = [["Monday", "Topic set, structure built, tasks assigned"], ["Tuesday–Thursday", "Research runs; findings, sources and ideas pile up"],
    ["Friday", "Branches reviewed, open questions collected"], ["Weekend", "Team discussion, opportunities scored, week closed"]];
  var strip = '<div class="strip">' + steps.map(function (s, i) {
    return '<div class="strip-item' + (i === phase ? " on" : "") + '"><div class="strip-day">' + esc(s[0]) + "</div><div class=\"muted xs\">" + esc(s[1]) + "</div></div>";
  }).join("") + "</div>";

  var left1 =
    card("Research tree", treeHtml(true), '<button class="btn sm" onclick="A.go(\'tree\')">Open full tree</button>') +
    card("My tasks", mine.length ? '<ul class="rows">' + mine.slice(0, 6).map(function (t) { return taskRow(t, false); }).join("") + "</ul>"
      : empty("Nothing assigned to you right now."), '<button class="btn sm" onclick="A.go(\'mywork\')">My work</button>');

  var right =
    card("New ideas this week", ideas.length ? ideas.map(function (b) {
      return '<button class="tile" onclick="A.openBranch(\'' + b.id + '\')"><div class="tile-title">' + icon("spark") + esc(b.name) + "</div>" +
        '<p class="muted sm">' + esc(b.why || b.description || "") + '</p><div class="muted xs">Spotted by ' + esc(nameOf(b.createdBy)) + "</div></button>";
    }).join("") : empty("Nothing has branched off yet."), readOnly() ? "" : '<button class="btn sm" onclick="A.newIdea()">' + icon("plus") + " Idea</button>") +
    card("Recent findings", recentF.length ? '<ul class="list">' + recentF.map(function (f) {
      return '<li><button class="link" onclick="A.openBranch(\'' + f.branchId + '\',\'findings\')">' + esc(f.title) + "</button>" +
        '<div class="muted xs">' + esc(nameOf(f.author)) + " · " + esc(crumb(f.branchId)) + "</div></li>";
    }).join("") + "</ul>" : empty("No findings recorded yet.")) +
    card("Open questions", qs.length ? '<ul class="list">' + qs.map(function (n) {
      return '<li><button class="link" onclick="A.openBranch(\'' + n.branchId + '\',\'questions\')">' + esc(n.text) + "</button></li>";
    }).join("") + "</ul>" : empty("No open questions.")) +
    card("Recent sources", recentR.length ? '<ul class="list">' + recentR.map(function (r) {
      return "<li>" + chip(r.type) + ' <a href="' + esc(r.url) + '" target="_blank" rel="noreferrer">' + esc(r.title) + "</a></li>";
    }).join("") + "</ul>" : empty("No sources collected yet."));

  return head + statRow + strip + '<div class="cols"><div class="col-2">' + left1 + '</div><div class="col-1">' + right + "</div></div>";
}
function stat(value, label) {
  return '<div class="stat"><div class="stat-value">' + esc(value) + '</div><div class="muted xs">' + esc(label) + "</div></div>";
}

/* -------------------------------- tree -------------------------------- */
function treeHtml(compact) {
  var roots = childrenOf(null);
  if (!roots.length) return empty("No branches yet. Break the topic into areas so people have something to pick up.");
  return '<ul class="tree">' + roots.map(function (b) { return treeNode(b, 0, compact); }).join("") + "</ul>";
}
function treeNode(b, depth, compact) {
  var kids = S.branches.filter(function (x) { return x.parentId === b.id; });
  var ids = descendantIds(b.id);
  var tasks = S.tasks.filter(function (t) { return ids.indexOf(t.branchId) >= 0; });
  var done = tasks.filter(function (t) { return t.status === "COMPLETED"; }).length;
  var findings = S.findings.filter(function (f) { return ids.indexOf(f.branchId) >= 0; }).length;
  var isOpen = OPEN_NODES[b.id] !== false && (depth === 0 || OPEN_NODES[b.id]);
  var html = '<li><div class="tree-row" style="padding-left:' + (depth * 18) + 'px">' +
    (kids.length ? '<button class="twisty" onclick="A.toggleNode(\'' + b.id + '\')">' + icon(isOpen ? "down" : "chevron") + "</button>" : '<span class="twisty"></span>') +
    '<button class="tree-name" onclick="A.openBranch(\'' + b.id + '\')">' + (b.isIdea ? icon("spark") : "") + esc(b.name) + "</button>" +
    '<span class="tree-meta muted xs">' + (tasks.length ? done + "/" + tasks.length + " tasks" : "") +
      (findings && !compact ? " · " + findings + " findings" : "") + "</span></div>";
  if (isOpen && kids.length) html += '<ul class="tree">' + kids.map(function (k) { return treeNode(k, depth + 1, compact); }).join("") + "</ul>";
  return html + "</li>";
}
function viewTree() {
  return pageHead("Research tree", "Every area of " + week().topic + ", plus anything that branched off during the week.",
    readOnly() ? "" : '<button class="btn primary" onclick="A.newBranch()">' + icon("plus") + " New branch</button>") +
    card("", treeHtml(false)) +
    '<p class="muted xs">Open a branch to see its tasks, findings, sources, notes and discussion.</p>';
}

/* ------------------------------- branch ------------------------------- */
var BRANCH_TABS = ["overview", "tasks", "findings", "resources", "notes", "questions", "discussion", "opportunities"];

function viewBranch() {
  var b = byId(S.branches, VIEW.branchId);
  if (!b) return empty("That branch no longer exists.", '<button class="btn" onclick="A.go(\'tree\')">Back to the tree</button>');
  var tab = VIEW.tab || "overview";
  var kids = S.branches.filter(function (x) { return x.parentId === b.id; });
  var tasks = S.tasks.filter(function (t) { return t.branchId === b.id; });
  var findings = S.findings.filter(function (f) { return f.branchId === b.id; });
  var resources = S.resources.filter(function (r) { return r.branchId === b.id; });
  var notes = S.notes.filter(function (n) { return n.branchId === b.id && n.kind !== "QUESTION"; });
  var questions = S.notes.filter(function (n) { return n.branchId === b.id && n.kind === "QUESTION"; });
  var opps = S.opportunities.filter(function (o) { return o.branchId === b.id; });
  var comments = S.comments.filter(function (c) { return c.targetType === "branch" && c.targetId === b.id; });
  var counts = { tasks: tasks.length, findings: findings.length, resources: resources.length, notes: notes.length,
    questions: questions.length, discussion: comments.length, opportunities: opps.length };
  var canEdit = !readOnly() && (isAdmin() || b.createdBy === ME.id);

  var head =
    '<nav class="crumbs"><button class="link" onclick="A.go(\'tree\')">Tree</button>' +
    pathOf(b.id).map(function (x) {
      return '<span class="sep">›</span><button class="link' + (x.id === b.id ? " current" : "") + '" onclick="A.openBranch(\'' + x.id + '\')">' + esc(x.name) + "</button>";
    }).join("") + "</nav>" +
    '<div class="page-head"><div><h1>' + (b.isIdea ? icon("spark") : "") + esc(b.name) + " " + chip(b.status, b.isIdea ? "violet" : "") + "</h1>" +
    (b.description ? '<p class="muted">' + esc(b.description) + "</p>" : "") + "</div><div class=\"row-actions\">" +
      (readOnly() ? "" : '<button class="btn" onclick="A.newBranch(\'' + b.id + '\')">' + icon("plus") + " Sub-branch</button>") +
      (readOnly() ? "" : '<button class="btn primary" onclick="A.convert(\'' + b.id + '\')">Convert to opportunity</button>') +
      (canEdit ? '<button class="btn icon-btn" title="Edit branch" onclick="A.editBranch(\'' + b.id + '\')">' + icon("edit") + "</button>" : "") +
      (isAdmin() && !readOnly() ? '<button class="btn icon-btn danger" title="Delete branch" onclick="A.deleteBranch(\'' + b.id + '\')">' + icon("trash") + "</button>" : "") +
    "</div></div>" +
    '<div class="tabs">' + BRANCH_TABS.map(function (t) {
      return '<button class="tab' + (t === tab ? " on" : "") + '" onclick="A.tab(\'' + t + '\')">' + t.charAt(0).toUpperCase() + t.slice(1) +
        (counts[t] ? ' <span class="muted xs">' + counts[t] + "</span>" : "") + "</button>";
    }).join("") + "</div>";

  var body = "";
  if (tab === "overview") body = branchOverview(b, kids, tasks, findings, resources, questions, opps);
  else if (tab === "tasks") body = card("Tasks", tasks.length ? '<ul class="rows">' + tasks.map(function (t) { return taskRow(t, false); }).join("") + "</ul>"
      : empty("No tasks on this branch yet."), isAdmin() && !readOnly() ? '<button class="btn sm" onclick="A.newTask(\'' + b.id + '\')">' + icon("plus") + " Add task</button>" : "");
  else if (tab === "findings") body = findingsCard(findings, b);
  else if (tab === "resources") body = resourcesCard(resources, b);
  else if (tab === "notes") body = notesCard(notes, b, "NOTE");
  else if (tab === "questions") body = notesCard(questions, b, "QUESTION");
  else if (tab === "discussion") body = card("Discussion", discussionHtml("branch", b.id));
  else if (tab === "opportunities") body = opps.length
    ? card("Opportunities", opps.map(function (o) { return oppTile(o); }).join(""))
    : card("Opportunities", empty("This branch has not been written up as an opportunity yet.",
        readOnly() ? "" : '<button class="btn" onclick="A.convert(\'' + b.id + '\')">Convert this branch</button>'));
  return head + body;
}

function branchOverview(b, kids, tasks, findings, resources, questions, opps) {
  var done = tasks.filter(function (t) { return t.status === "COMPLETED"; }).length;
  var left =
    (b.isIdea && b.why ? card("Why this looked interesting", "<p>" + esc(b.why) + '</p><p class="muted xs">Spotted by ' + esc(nameOf(b.createdBy)) + " · " + fmtDateTime(b.createdAt) + "</p>") : "") +
    card("What we know so far", findings.length ? findings.slice(0, 4).map(function (f) {
      return '<div class="quote"><div class="row-title">' + esc(f.title) + " " + chip(f.confidence, toneFor("confidence", f.confidence)) + "</div>" +
        "<p>" + esc(f.text) + '</p><div class="muted xs">' + esc(nameOf(f.author)) + "</div></div>";
    }).join("") : empty("Nothing recorded yet. Findings are what survive the week — write them down as you go."),
      '<button class="btn sm" onclick="A.tab(\'findings\')">All findings</button>') +
    (kids.length ? card("Sub-branches", '<div class="tiles">' + kids.map(function (k) {
      return '<button class="tile" onclick="A.openBranch(\'' + k.id + '\')"><div class="tile-title">' + (k.isIdea ? icon("spark") : "") + esc(k.name) + "</div>" +
        '<div class="muted xs">' + S.tasks.filter(function (t) { return t.branchId === k.id; }).length + " tasks · " +
        S.findings.filter(function (f) { return f.branchId === k.id; }).length + " findings</div></button>";
    }).join("") + "</div>") : "");
  var pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  var right =
    card("Progress", '<div class="progress"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
      '<dl class="kv"><div><dt>Tasks</dt><dd>' + done + "/" + tasks.length + "</dd></div>" +
      "<div><dt>Findings</dt><dd>" + findings.length + "</dd></div>" +
      "<div><dt>Sources</dt><dd>" + resources.length + "</dd></div>" +
      "<div><dt>Open questions</dt><dd>" + questions.filter(function (q) { return !q.resolved; }).length + "</dd></div>" +
      "<div><dt>Opportunities</dt><dd>" + opps.length + "</dd></div></dl>") +
    card("Working on this", (b.assignees && b.assignees.length ? '<ul class="list">' + b.assignees.map(function (a) {
      return "<li>" + avatar(nameOf(a)) + " " + esc(nameOf(a)) + "</li>";
    }).join("") + "</ul>" : empty("Nobody assigned yet.")) +
      (isAdmin() && !readOnly() ? '<button class="btn sm" onclick="A.editBranch(\'' + b.id + '\')">Assign people</button>' : ""));
  return '<div class="cols"><div class="col-2">' + left + '</div><div class="col-1">' + right + "</div></div>";
}

/* -------------------------------- tasks -------------------------------- */
function taskRow(t, showBranch) {
  var overdue = t.status !== "COMPLETED" && t.deadline && t.deadline < today();
  var comments = S.comments.filter(function (c) { return c.targetType === "task" && c.targetId === t.id; }).length;
  var canStatus = !readOnly() && (isAdmin() || t.assignee === ME.id);
  return '<li class="row">' +
    '<button class="row-main" onclick="A.openTask(\'' + t.id + '\')"><span class="row-title">' + esc(t.name) + "</span>" +
      '<span class="muted xs">' + (showBranch ? esc(crumb(t.branchId)) + " · " : "") + "due " + fmtDate(t.deadline) +
      (overdue ? ' <span class="overdue">overdue</span>' : "") + (comments ? " · " + comments + " comments" : "") + "</span></button>" +
    chip(t.priority, toneFor("priority", t.priority)) +
    '<span class="who" title="' + esc(nameOf(t.assignee)) + '">' + avatar(nameOf(t.assignee)) + "</span>" +
    '<select class="status ' + toneFor("status", t.status) + '"' + (canStatus ? "" : " disabled") +
      ' onchange="A.taskStatus(\'' + t.id + '\', this.value)">' +
      STATUS.map(function (s) { return '<option' + (s === t.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select></li>";
}

function viewTasks() {
  var w = week();
  var all = S.tasks.filter(function (t) { return t.weekId === w.id; });
  var list = all.slice();
  if (FILTERS.member) list = list.filter(function (t) { return t.assignee === FILTERS.member; });
  if (FILTERS.status) list = list.filter(function (t) { return t.status === FILTERS.status; });
  if (FILTERS.priority) list = list.filter(function (t) { return t.priority === FILTERS.priority; });
  if (FILTERS.branch) { var ids = descendantIds(FILTERS.branch); list = list.filter(function (t) { return ids.indexOf(t.branchId) >= 0; }); }
  if (FILTERS.due === "overdue") list = list.filter(function (t) { return t.status !== "COMPLETED" && t.deadline && t.deadline < today(); });
  if (FILTERS.due === "week") list = list.filter(function (t) { return t.deadline && t.deadline <= w.end; });
  var unassigned = all.filter(function (t) { return !t.assignee; }).length;
  var branchOpts = S.branches.filter(function (b) { return b.weekId === w.id; }).map(function (b) { return [b.id, crumb(b.id)]; });
  var filters = '<div class="filters">' +
    filterSelect("member", [["", "Anyone"]].concat(S.members.map(function (m) { return [m.id, m.name]; }))) +
    filterSelect("status", [["", "Any status"]].concat(STATUS.map(function (s) { return [s, s]; }))) +
    filterSelect("priority", [["", "Any priority"]].concat(PRIORITY.map(function (s) { return [s, s]; }))) +
    filterSelect("branch", [["", "Any branch"]].concat(branchOpts)) +
    filterSelect("due", [["", "Any deadline"], ["overdue", "Overdue"], ["week", "Due this week"]]) +
    '<button class="btn sm" onclick="A.clearFilters()">Clear</button></div>';
  return pageHead("All tasks", list.length + " of " + all.length + " shown",
      isAdmin() && !readOnly() ? '<button class="btn primary" onclick="A.newTask()">' + icon("plus") + " Add task</button>" : "") +
    filters +
    (isAdmin() && unassigned ? '<div class="bar warn">' + unassigned + " task" + (unassigned > 1 ? "s have" : " has") + " nobody on it.</div>" : "") +
    card("", list.length ? '<ul class="rows">' + list.map(function (t) { return taskRow(t, true); }).join("") + "</ul>" : empty("No tasks match these filters."));
}
function filterSelect(key, options) {
  return '<select class="input sm" onchange="A.setFilter(\'' + key + '\', this.value)">' + options.map(function (o) {
    return '<option value="' + esc(o[0]) + '"' + (FILTERS[key] === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
  }).join("") + "</select>";
}

/* ------------------------------ my work ------------------------------ */
function viewMyWork() {
  var w = week();
  var mine = S.tasks.filter(function (t) { return t.weekId === w.id && t.assignee === ME.id; });
  var groups = [
    ["Overdue", mine.filter(function (t) { return t.status !== "COMPLETED" && t.deadline && t.deadline < today(); })],
    ["Due today", mine.filter(function (t) { return t.status !== "COMPLETED" && t.deadline === today(); })],
    ["Upcoming", mine.filter(function (t) { return t.status !== "COMPLETED" && t.deadline > today(); })],
    ["Completed", mine.filter(function (t) { return t.status === "COMPLETED"; })]
  ];
  var mineF = S.findings.filter(function (f) { return f.weekId === w.id && f.author === ME.id; });
  var mineR = S.resources.filter(function (r) { return r.weekId === w.id && r.addedBy === ME.id; });
  var mineN = S.notes.filter(function (n) { return n.weekId === w.id && n.author === ME.id; });
  var mineB = S.branches.filter(function (b) { return b.weekId === w.id && ((b.assignees || []).indexOf(ME.id) >= 0 || b.createdBy === ME.id); });
  return pageHead("My work", "Everything assigned to you in week " + String(w.number).padStart(2, "0") + ".") +
    groups.map(function (g) {
      return card(g[0] + " (" + g[1].length + ")", g[1].length ? '<ul class="rows">' + g[1].map(function (t) { return taskRow(t, true); }).join("") + "</ul>" : empty("Nothing here."));
    }).join("") +
    '<div class="cols two">' +
      card("My findings (" + mineF.length + ")", mineF.length ? '<ul class="list">' + mineF.map(function (f) {
        return '<li><button class="link" onclick="A.openBranch(\'' + f.branchId + '\',\'findings\')">' + esc(f.title) + "</button></li>"; }).join("") + "</ul>" : empty("None yet.")) +
      card("My sources (" + mineR.length + ")", mineR.length ? '<ul class="list">' + mineR.map(function (r) {
        return '<li><a href="' + esc(r.url) + '" target="_blank" rel="noreferrer">' + esc(r.title) + "</a></li>"; }).join("") + "</ul>" : empty("None yet.")) +
      card("My notes (" + mineN.length + ")", mineN.length ? '<ul class="list">' + mineN.map(function (n) {
        return '<li><button class="link" onclick="A.openBranch(\'' + n.branchId + "','" + (n.kind === "QUESTION" ? "questions" : "notes") + '\')">' + esc(n.text) + "</button></li>"; }).join("") + "</ul>" : empty("None yet.")) +
      card("My branches (" + mineB.length + ")", mineB.length ? '<ul class="list">' + mineB.map(function (b) {
        return '<li><button class="link" onclick="A.openBranch(\'' + b.id + '\')">' + esc(crumb(b.id)) + "</button></li>"; }).join("") + "</ul>" : empty("None yet.")) +
    "</div>";
}

/* -------------------------------- ideas -------------------------------- */
function viewIdeas() {
  var w = week();
  var ideas = S.branches.filter(function (b) { return b.weekId === w.id && b.isIdea; });
  return pageHead("Ideas", "Things that came up mid-research and earned their own branch.",
      readOnly() ? "" : '<button class="btn primary" onclick="A.newIdea()">' + icon("plus") + " New idea</button>") +
    (ideas.length ? '<div class="tiles two">' + ideas.map(function (b) {
      var ids = descendantIds(b.id);
      var opp = S.opportunities.filter(function (o) { return o.branchId === b.id; })[0];
      return '<button class="tile lg" onclick="A.openBranch(\'' + b.id + '\')">' +
        '<div class="tile-title">' + icon("spark") + esc(b.name) + " " + chip(opp ? opp.status : b.status, opp ? toneFor("opp", opp.status) : "violet") + "</div>" +
        "<p>" + esc(b.why || b.description || "No description yet.") + "</p>" +
        '<div class="muted xs">Spotted by ' + esc(nameOf(b.createdBy)) + " · " +
        S.tasks.filter(function (t) { return ids.indexOf(t.branchId) >= 0; }).length + " tasks · " +
        S.findings.filter(function (f) { return ids.indexOf(f.branchId) >= 0; }).length + " findings</div></button>";
    }).join("") + "</div>" : card("", empty("Nothing has branched off yet this week.")));
}

/* ------------------------------ findings ------------------------------ */
function findingsCard(findings, b) {
  return card("Findings", findings.length ? findings.map(function (f) {
    var canDelete = !readOnly() && (isAdmin() || f.author === ME.id);
    return '<div class="panel"><div class="row-title">' + esc(f.title) + " " + chip(f.confidence + " confidence", toneFor("confidence", f.confidence)) +
      (canDelete ? '<button class="btn icon-btn danger right" onclick="A.del(\'finding.delete\',\'' + f.id + '\',\'Delete this finding?\')">' + icon("trash") + "</button>" : "") + "</div>" +
      "<p>" + esc(f.text) + "</p>" +
      ((f.sources || []).length ? '<ul class="list xs">' + f.sources.map(function (sid) {
        var r = byId(S.resources, sid);
        return r ? '<li><a href="' + esc(r.url) + '" target="_blank" rel="noreferrer">' + esc(r.title) + "</a></li>" : "";
      }).join("") + "</ul>" : "") +
      '<div class="meta">' + (f.tags || []).map(function (t) { return chip(t); }).join(" ") +
      '<span class="muted xs right">' + esc(nameOf(f.author)) + " · " + fmtDate(f.createdAt) + "</span></div></div>";
  }).join("") : empty("A finding is one thing you now believe, and why. Nothing here yet."),
    readOnly() ? "" : '<button class="btn sm" onclick="A.newFinding(\'' + b.id + '\')">' + icon("plus") + " Add finding</button>");
}
function viewFindings() {
  var w = week();
  var list = S.findings.filter(function (f) { return f.weekId === w.id; });
  if (FILTERS.confidence) list = list.filter(function (f) { return f.confidence === FILTERS.confidence; });
  if (FILTERS.tag) list = list.filter(function (f) { return (f.tags || []).indexOf(FILTERS.tag) >= 0; });
  var tags = [];
  S.findings.filter(function (f) { return f.weekId === w.id; }).forEach(function (f) {
    (f.tags || []).forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); });
  });
  return pageHead("Findings", "Everything the team believes it now knows, with who found it and how sure they are.") +
    '<div class="filters">' + filterSelect("confidence", [["", "Any confidence"]].concat(CONFIDENCE.map(function (c) { return [c, c]; }))) +
    tags.slice(0, 14).map(function (t) {
      return '<button class="chip clickable' + (FILTERS.tag === t ? " indigo" : "") + '" onclick="A.setFilter(\'tag\',\'' + esc(FILTERS.tag === t ? "" : t) + '\')">' + esc(t) + "</button>";
    }).join("") + "</div>" +
    card("", list.length ? list.map(function (f) {
      return '<div class="panel"><div class="row-title"><button class="link" onclick="A.openBranch(\'' + f.branchId + '\',\'findings\')">' + esc(f.title) + "</button> " +
        chip(f.confidence, toneFor("confidence", f.confidence)) + "</div><p>" + esc(f.text) + "</p>" +
        '<div class="muted xs">' + esc(nameOf(f.author)) + " · " + esc(crumb(f.branchId)) + "</div></div>";
    }).join("") : empty("No findings match."));
}

/* ------------------------------ resources ------------------------------ */
function resourceItem(r) {
  var canDelete = !readOnly() && (isAdmin() || r.addedBy === ME.id);
  return '<li class="row"><span class="chip">' + esc(r.type) + "</span>" +
    '<div class="row-main"><a href="' + esc(r.url) + '" target="_blank" rel="noreferrer" class="row-title">' + esc(r.title) + "</a>" +
    (r.description ? '<span class="muted xs">' + esc(r.description) + "</span>" : "") +
    '<span class="muted xs"><button class="link" onclick="A.openBranch(\'' + r.branchId + '\',\'resources\')">' + esc(crumb(r.branchId)) + "</button> · " + esc(nameOf(r.addedBy)) + "</span></div>" +
    (canDelete ? '<button class="btn icon-btn danger" onclick="A.del(\'resource.delete\',\'' + r.id + '\',\'Remove this source?\')">' + icon("trash") + "</button>" : "") + "</li>";
}
function resourcesCard(resources, b) {
  return card("Resources", resources.length ? '<ul class="rows">' + resources.map(resourceItem).join("") + "</ul>" : empty("No sources attached to this branch."),
    readOnly() ? "" : '<button class="btn sm" onclick="A.newResource(\'' + b.id + '\')">' + icon("plus") + " Add source</button>");
}
function viewResources() {
  var w = week();
  var list = S.resources.filter(function (r) { return r.weekId === w.id; });
  if (FILTERS.type) list = list.filter(function (r) { return r.type === FILTERS.type; });
  if (FILTERS.q) {
    var q = FILTERS.q.toLowerCase();
    list = list.filter(function (r) { return (r.title + " " + r.description + " " + (r.tags || []).join(" ")).toLowerCase().indexOf(q) >= 0; });
  }
  return pageHead("Resources", list.length + " sources, each attached to the branch it belongs to.") +
    '<div class="filters"><input class="input sm" placeholder="Filter sources, then press Enter" value="' + esc(FILTERS.q) + '" onchange="A.setFilter(\'q\', this.value)">' +
    filterSelect("type", [["", "All types"]].concat(RES_TYPES.map(function (t) { return [t, t]; }))) + "</div>" +
    card("", list.length ? '<ul class="rows">' + list.map(resourceItem).join("") + "</ul>" : empty("No sources match."));
}

/* ------------------------- notes and questions ------------------------- */
function notesCard(notes, b, kind) {
  var isQ = kind === "QUESTION";
  var body = (notes.length ? notes.map(function (n) {
    var canDelete = !readOnly() && (isAdmin() || n.author === ME.id);
    return '<div class="panel' + (n.resolved ? " done" : "") + '"><p>' + esc(n.text) + "</p>" +
      '<div class="meta">' + (n.kind === "MEETING" ? chip("Meeting", "indigo") + " " : "") +
      (n.tags || []).map(function (t) { return chip(t); }).join(" ") +
      '<span class="muted xs">' + esc(nameOf(n.author)) + " · " + fmtDateTime(n.createdAt) + "</span>" +
      (isQ && !readOnly() ? '<button class="btn sm" onclick="A.resolveNote(\'' + n.id + "'," + (n.resolved ? "false" : "true") + ')">' + (n.resolved ? "Reopen" : "Mark answered") + "</button>" : "") +
      (canDelete ? '<button class="btn icon-btn danger" onclick="A.del(\'note.delete\',\'' + n.id + '\',\'Delete this?\')">' + icon("trash") + "</button>" : "") +
      "</div></div>";
  }).join("") : empty(isQ ? "No questions raised on this branch." : "No notes yet.")) +
    (readOnly() ? "" :
      '<div class="composer"><textarea id="note-text" class="input" rows="3" placeholder="' +
      (isQ ? "What don&#39;t we know yet?" : "Anything worth keeping: an observation, a method, a warning.") + '"></textarea>' +
      '<div class="composer-row"><input id="note-tags" class="input sm" placeholder="Tags, comma separated">' +
      (isQ ? "" : '<select id="note-kind" class="input sm"><option value="NOTE">Research note</option><option value="MEETING">Meeting note</option></select>') +
      '<button class="btn primary" onclick="A.addNote(\'' + b.id + "','" + kind + '\')">Add</button></div></div>');
  return card(isQ ? "Open questions" : "Notes", body);
}

/* ------------------------------ discussion ------------------------------ */
function discussionHtml(targetType, targetId) {
  var list = S.comments.filter(function (c) { return c.targetType === targetType && c.targetId === targetId; });
  return (list.length ? '<ul class="comments">' + list.map(function (c) {
    return "<li>" + avatar(nameOf(c.author)) + '<div><div class="muted xs">' + esc(nameOf(c.author)) + " · " + fmtDateTime(c.createdAt) + "</div>" +
      "<p>" + esc(c.text) + "</p></div></li>";
  }).join("") + "</ul>" : '<p class="muted sm">No comments yet.</p>') +
    (readOnly() ? "" : '<div class="composer-row"><input id="comment-' + targetId + '" class="input" placeholder="Write a comment">' +
      '<button class="btn primary" onclick="A.addComment(\'' + targetType + "','" + targetId + '\')">Send</button></div>');
}

/* ---------------------------- opportunities ---------------------------- */
function oppTile(o) {
  return '<button class="tile" onclick="A.openOpp(\'' + o.id + '\')"><div class="tile-title">' + esc(o.title) + " " + chip(o.status, toneFor("opp", o.status)) + "</div>" +
    (o.problem ? '<p class="muted sm">' + esc(o.problem) + "</p>" : "") + "</button>";
}
function viewOpportunities() {
  var w = week();
  var list = S.opportunities.filter(function (o) { return o.weekId === w.id; });
  return pageHead("Opportunities", "Branches that might be a business. Move them along as evidence arrives.") +
    (list.length ? '<div class="pipeline">' + OPP_STATUS.map(function (st) {
      var col = list.filter(function (o) { return o.status === st; });
      return '<div class="pipe-col"><div class="pipe-head">' + esc(st) + ' <span class="muted xs">' + col.length + "</span></div>" +
        (col.length ? col.map(oppTile).join("") : '<p class="muted xs pad">—</p>') + "</div>";
    }).join("") + "</div>" : card("", empty("Nothing converted yet. Open a branch and use “Convert to opportunity”.")));
}

/* ------------------------------ decisions ------------------------------ */
function viewDecisions() {
  var w = week();
  var list = S.decisions.filter(function (d) { return d.weekId === w.id; });
  return pageHead("Decision log", "What was decided, and why — so the same argument is not had twice.",
      isAdmin() && !readOnly() ? '<button class="btn primary" onclick="A.newDecision()">' + icon("plus") + " Log a decision</button>" : "") +
    (list.length ? list.map(function (d) {
      return '<div class="panel"><div class="meta"><span class="muted xs">Decision #' + String(d.number).padStart(2, "0") + "</span>" +
        chip(d.decision, d.decision === "YES" ? "green" : d.decision === "NO" ? "red" : "amber") +
        '<span class="muted xs right">' + fmtDate(d.date) + "</span>" +
        (isAdmin() && !readOnly() ? '<button class="btn icon-btn danger" onclick="A.del(\'decision.delete\',\'' + d.id + '\',\'Delete this decision?\')">' + icon("trash") + "</button>" : "") +
        '</div><div class="row-title">' + esc(d.question) + "</div><p>" + esc(d.reason) + "</p>" +
        '<div class="muted xs">' + esc(d.participants) + "</div></div>";
    }).join("") : card("", empty("No decisions recorded for this week.")));
}

/* ---------------------------- meeting mode ---------------------------- */
function viewMeeting() {
  var w = week();
  var points = S.meeting.filter(function (p) { return p.weekId === w.id; });
  return pageHead("Meeting mode", "Add your points before the meeting. During it, the admin marks what happens to each one.") +
    '<div class="cols two">' + MEETING_PROMPTS.map(function (pr) {
      var mine = points.filter(function (x) { return x.promptId === pr[0]; });
      var body = (mine.length ? mine.map(function (x) {
        var canDelete = !readOnly() && (isAdmin() || x.author === ME.id);
        return '<div class="panel"><p>' + esc(x.text) + '</p><div class="meta"><span class="muted xs">' + esc(nameOf(x.author)) + "</span>" +
          (x.verdict ? chip(x.verdict, x.verdict === "KEEP" ? "green" : x.verdict === "REJECT" ? "red" : x.verdict === "INVESTIGATE" ? "indigo" : "amber") : "") +
          (isAdmin() && !readOnly() ? '<span class="verdicts">' + VERDICTS.map(function (v) {
            return '<button class="btn xs' + (x.verdict === v ? " on" : "") + '" onclick="A.verdict(\'' + x.id + "','" + v + '\')">' + esc(v) + "</button>";
          }).join("") + "</span>" : "") +
          (canDelete ? '<button class="btn icon-btn danger" onclick="A.del(\'meeting.delete\',\'' + x.id + '\',\'Delete this point?\')">' + icon("trash") + "</button>" : "") +
          "</div></div>";
      }).join("") : '<p class="muted sm">Nothing added yet.</p>') +
        (readOnly() ? "" : '<div class="composer-row"><input id="mp-' + pr[0] + '" class="input" placeholder="Add a point">' +
          '<button class="btn primary" onclick="A.addPoint(\'' + pr[0] + '\')">Add</button></div>');
      return card(pr[1], body);
    }).join("") + "</div>";
}

/* --------------------------- weekly summary --------------------------- */
function viewSummary() {
  var w = week(), st = stats(w.id);
  var editing = !!VIEW.editing;
  var opps = S.opportunities.filter(function (o) { return o.weekId === w.id; });
  var body = SUMMARY_FIELDS.map(function (f) {
    var v = (w.summary || {})[f[0]] || "";
    return "<div class=\"sum-field\"><h3>" + esc(f[1]) + "</h3>" +
      (editing ? '<textarea id="sum-' + f[0] + '" class="input" rows="3">' + esc(v) + "</textarea>"
        : (v ? "<p>" + esc(v) + "</p>" : '<p class="muted">Nothing written yet.</p>')) + "</div>";
  }).join("");
  var action = isAdmin()
    ? (editing ? '<button class="btn primary" onclick="A.saveSummary()">' + icon("check") + " Save summary</button>"
               : '<button class="btn" onclick="A.editSummary()">' + icon("edit") + " Edit</button>")
    : "";
  return pageHead("Week " + String(w.number).padStart(2, "0") + " — " + w.topic, "The one page the team reads at the end of the week.", action) +
    '<div class="stat-row">' + stat(st.done + " / " + st.tasks, "Tasks completed") + stat(st.findings, "Findings") +
    stat(st.resources, "Sources") + stat(st.opportunities, "Opportunities") + "</div>" +
    card("Executive summary", body) +
    (opps.length ? card("Opportunities carried out of this week", '<ul class="list">' + opps.map(function (o) {
      return "<li>" + chip(o.status, toneFor("opp", o.status)) + ' <button class="link" onclick="A.openOpp(\'' + o.id + '\')">' + esc(o.title) + "</button></li>";
    }).join("") + "</ul>") : "");
}

/* --------------------------------- team --------------------------------- */
function viewTeam() {
  var w = week();
  var workload = S.members.map(function (m) {
    var t = S.tasks.filter(function (x) { return x.weekId === w.id && x.assignee === m.id; });
    return { m: m, total: t.length, done: t.filter(function (x) { return x.status === "COMPLETED"; }).length,
      overdue: t.filter(function (x) { return x.status !== "COMPLETED" && x.deadline && x.deadline < today(); }).length };
  });
  var max = Math.max.apply(null, [1].concat(workload.map(function (x) { return x.total; })));
  var load = card("Workload this week", '<ul class="list">' + workload.map(function (x) {
    return '<li class="load"><div class="load-head">' + avatar(x.m.name) + " <strong>" + esc(x.m.name) + "</strong>" +
      (x.m.role === "ADMIN" ? " " + chip("Admin", "indigo") : "") +
      '<span class="muted xs right">' + x.done + "/" + x.total + " done" + (x.overdue ? " · " + x.overdue + " overdue" : "") + "</span></div>" +
      '<div class="load-bar"><div class="load-total" style="width:' + (x.total / max * 100) + '%">' +
      '<div class="load-done" style="width:' + (x.total ? x.done / x.total * 100 : 0) + '%"></div></div></div></li>';
  }).join("") + "</ul>");
  var admin = isAdmin() ? card("Members", '<ul class="rows">' + S.members.map(function (m) {
    return '<li class="row">' + avatar(m.name) + '<div class="row-main"><span class="row-title">' + esc(m.name) + "</span>" +
      '<span class="muted xs">' + (m.role === "ADMIN" ? "Admin" : "Member") + "</span></div>" +
      '<button class="btn sm" onclick="A.editMember(\'' + m.id + '\')">Edit</button>' +
      (m.id === ME.id ? "" : '<button class="btn icon-btn danger" onclick="A.removeMember(\'' + m.id + '\')">' + icon("trash") + "</button>") + "</li>";
  }).join("") + "</ul>", '<button class="btn sm primary" onclick="A.newMember()">' + icon("plus") + " Add member</button>") : "";
  return pageHead("Team", S.members.length + " people in this workspace.") + load + admin;
}

/* ------------------------------- archive ------------------------------- */
function viewArchive() {
  var weeks = S.weeks.slice().sort(function (a, b) { return b.number - a.number; });
  return pageHead("Archive", "Every week the team has run. Open one to read its full tree and conclusions.",
      isAdmin() ? '<button class="btn primary" onclick="A.newWeek()">' + icon("plus") + " Start a new week</button>" : "") +
    weeks.map(function (w) {
      var st = stats(w.id);
      return '<button class="tile lg row-tile" onclick="A.openWeek(\'' + w.id + '\')">' +
        '<div class="tile-title"><span class="muted xs">Week ' + String(w.number).padStart(2, "0") + "</span> " + esc(w.topic) + " " +
        chip(w.status === "ACTIVE" ? "Active" : "Archived", w.status === "ACTIVE" ? "green" : "") + "</div>" +
        '<div class="muted xs">' + fmtDate(w.start) + " – " + fmtDate(w.end) + " · " + st.branches + " branches · " +
        st.findings + " findings · " + st.opportunities + " opportunities</div></button>" +
        (isAdmin() && w.status === "ARCHIVED" ? '<button class="btn sm reopen" onclick="A.reopenWeek(\'' + w.id + '\')">Reopen this week</button>' : "");
    }).join("");
}

/* -------------------------------- search -------------------------------- */
function searchAll(q) {
  var term = q.trim().toLowerCase(), w = week(), out = [];
  if (term.length < 2 || !w) return out;
  function hit(v) { return String(v || "").toLowerCase().indexOf(term) >= 0; }
  S.branches.filter(function (b) { return b.weekId === w.id; }).forEach(function (b) {
    if (hit(b.name) || hit(b.description) || hit(b.why)) out.push(["Branch", crumb(b.id), b.description || b.why, b.id, "overview"]);
  });
  S.tasks.filter(function (t) { return t.weekId === w.id; }).forEach(function (t) {
    if (hit(t.name) || hit(t.description)) out.push(["Task", t.name, crumb(t.branchId) + " · " + nameOf(t.assignee), t.branchId, "tasks"]);
  });
  S.findings.filter(function (f) { return f.weekId === w.id; }).forEach(function (f) {
    if (hit(f.title) || hit(f.text) || (f.tags || []).some(hit)) out.push(["Finding", f.title, crumb(f.branchId), f.branchId, "findings"]);
  });
  S.resources.filter(function (r) { return r.weekId === w.id; }).forEach(function (r) {
    if (hit(r.title) || hit(r.description) || hit(r.url) || (r.tags || []).some(hit)) out.push(["Source", r.title, crumb(r.branchId), r.branchId, "resources"]);
  });
  S.notes.filter(function (n) { return n.weekId === w.id; }).forEach(function (n) {
    if (hit(n.text) || (n.tags || []).some(hit)) out.push([n.kind === "QUESTION" ? "Question" : "Note", n.text.slice(0, 90), crumb(n.branchId), n.branchId, n.kind === "QUESTION" ? "questions" : "notes"]);
  });
  S.opportunities.filter(function (o) { return o.weekId === w.id; }).forEach(function (o) {
    if (hit(o.title) || hit(o.problem) || hit(o.customer)) out.push(["Opportunity", o.title, o.status, o.branchId, "opportunities"]);
  });
  S.members.forEach(function (m) { if (hit(m.name)) out.push(["Member", m.name, m.role, "", ""]); });
  return out.slice(0, 40);
}
function renderSearchResults() {
  var box = document.getElementById("search-results");
  if (!box) return;
  if (!SEARCH.trim() || SEARCH.trim().length < 2) { box.classList.remove("show"); box.innerHTML = ""; return; }
  var res = searchAll(SEARCH);
  box.classList.add("show");
  box.innerHTML = res.length ? res.map(function (r) {
    return '<button class="sr" onclick="A.openSearch(\'' + r[3] + "','" + r[4] + '\')">' + chip(r[0]) +
      '<span class="sr-body"><span class="sr-title">' + esc(r[1]) + '</span><span class="muted xs">' + esc(r[2] || "") + "</span></span></button>";
  }).join("") : '<div class="sr-empty">Nothing matches that. Try a shorter term.</div>';
}

/* -------------------------------- modals -------------------------------- */
function openModal(title, body, footer, wide) {
  MODAL_OPEN = true;
  document.getElementById("modal").innerHTML =
    '<div class="modal-bg" onclick="A.closeModalIfBg(event)"><div class="modal' + (wide ? " wide" : "") + '">' +
      '<header class="modal-head"><h3>' + esc(title) + '</h3><button class="btn icon-btn" onclick="A.closeModal()">✕</button></header>' +
      '<div class="modal-body">' + body + "</div>" +
      (footer ? '<footer class="modal-foot">' + footer + "</footer>" : "") +
    "</div></div>";
  var first = document.querySelector(".modal-body input, .modal-body textarea");
  if (first) first.focus();
}
function closeModal() { MODAL_OPEN = false; document.getElementById("modal").innerHTML = ""; }
function footerButtons(label, onclick) {
  return '<button class="btn" onclick="A.closeModal()">Cancel</button><button class="btn primary" onclick="' + onclick + '">' + esc(label) + "</button>";
}
function memberOptions(selected) {
  return S.members.map(function (m) { return [m.id, m.name]; });
}
function branchOptions() {
  var w = week();
  return S.branches.filter(function (b) { return b.weekId === w.id; }).map(function (b) { return [b.id, crumb(b.id)]; });
}

/* ------------------------------- actions ------------------------------- */
var A = {
  /* --- session --- */
  login: function () {
    var name = val("login-name"), pass = val("login-pass");
    if (!name || !pass) { document.getElementById("login-err").textContent = "Enter your name and password."; return; }
    apiPost("/api/login", { name: name, password: pass })
      .then(function (res) { ME = res.user; return apiGet("/api/state"); })
      .then(function (res) { S = res.state; ME = res.user; VIEW = { name: "dashboard" }; render(); })
      .catch(function (e) { var el = document.getElementById("login-err"); if (el) el.textContent = e.message; });
  },
  logout: function () { apiPost("/api/logout").then(function () { ME = null; S = null; renderLogin("Signed out."); }); },
  account: function () {
    openModal("My account",
      field("Name", '<input id="acc-name" class="input" value="' + esc(ME.name) + '">') +
      '<hr class="rule">' +
      field("Current password", '<input id="acc-old" type="password" class="input">') +
      field("New password", '<input id="acc-new" type="password" class="input">', "Leave both blank to only change your name. At least six characters."),
      footerButtons("Save", "A.saveAccount()"));
  },
  saveAccount: function () {
    var p = { id: ME.id, name: val("acc-name") };
    if (val("acc-new")) { p.password = val("acc-new"); p.currentPassword = val("acc-old"); }
    op("member.update", p).then(function () {
      ME.name = p.name; closeModal();
      toast(p.password ? "Password changed. Other devices were signed out." : "Saved.");
      if (p.password) location.reload();
    });
  },

  /* --- navigation --- */
  go: function (name) { VIEW = { name: name }; SEARCH = ""; document.body.classList.remove("nav-open"); render(); },
  toggleNav: function () { document.body.classList.toggle("nav-open"); },
  openBranch: function (id, tab) { VIEW = { name: "branch", branchId: id, tab: tab || "overview" }; SEARCH = ""; render(); },
  tab: function (t) { VIEW = { name: "branch", branchId: VIEW.branchId, tab: t }; render(); },
  openWeek: function (id) { WEEK_ID = id; VIEW = { name: "dashboard" }; render(); },
  reopenWeek: function (id) {
    if (!confirm("Reopen this week for editing? Any week that is currently open will be archived.")) return;
    op("week.reopen", { id: id }).then(function () { WEEK_ID = id; VIEW = { name: "dashboard" }; render(); });
  },
  toggleNode: function (id) { OPEN_NODES[id] = !currentlyOpen(id); render(); },
  search: function (v) { SEARCH = v; renderSearchResults(); },
  openSearch: function (branchId, tab) {
    SEARCH = "";
    if (branchId) A.openBranch(branchId, tab || "overview"); else A.go("team");
  },
  setFilter: function (k, v) { FILTERS[k] = v; render(); },
  clearFilters: function () { FILTERS = { member: "", status: "", priority: "", branch: "", due: "", type: "", q: "", confidence: "", tag: "" }; render(); },

  /* --- tasks --- */
  taskStatus: function (id, status) { op("task.update", { id: id, status: status }); },
  openTask: function (id) {
    var t = byId(S.tasks, id);
    if (!t) return;
    var mine = t.assignee === ME.id;
    var canEdit = !readOnly() && (isAdmin() || mine);
    var body = '<p class="muted xs">' + esc(crumb(t.branchId)) + "</p>" +
      (isAdmin() && !readOnly()
        ? field("Task", '<input id="task-name" class="input" value="' + esc(t.name) + '">')
        : '<div class="row-title">' + esc(t.name) + "</div>") +
      field("Description", '<textarea id="task-desc" class="input" rows="3"' + (canEdit ? "" : " disabled") + ">" + esc(t.description) + "</textarea>") +
      '<div class="grid2">' +
        field("Assigned to", isAdmin() && !readOnly() ? selectHtml("task-assignee", memberOptions(), t.assignee, "Unassigned")
          : '<input class="input" value="' + esc(nameOf(t.assignee)) + '" disabled>') +
        field("Deadline", '<input id="task-deadline" type="date" class="input" value="' + esc(t.deadline) + '"' + (isAdmin() && !readOnly() ? "" : " disabled") + ">") +
        field("Status", canEdit ? selectHtml("task-status", STATUS, t.status) : '<input class="input" value="' + esc(t.status) + '" disabled>') +
        field("Priority", isAdmin() && !readOnly() ? selectHtml("task-priority", PRIORITY, t.priority) : '<input class="input" value="' + esc(t.priority) + '" disabled>') +
      "</div>" +
      '<p class="muted xs">Created by ' + esc(nameOf(t.createdBy)) + " on " + fmtDate(t.createdAt) + " · last updated " + fmtDateTime(t.updatedAt) + "</p>" +
      '<hr class="rule"><h4 class="sub">Discussion</h4>' + discussionHtml("task", t.id);
    var footer = canEdit
      ? (isAdmin() ? '<button class="btn danger" onclick="A.del(\'task.delete\',\'' + t.id + '\',\'Delete this task?\')">Delete</button>' : "") +
        footerButtons("Save changes", "A.saveTask('" + t.id + "')")
      : '<button class="btn" onclick="A.closeModal()">Close</button>';
    openModal("Task", body, footer, true);
  },
  saveTask: function (id) {
    var p = { id: id };
    if (document.getElementById("task-status")) p.status = val("task-status");
    if (document.getElementById("task-desc")) p.description = val("task-desc");
    if (document.getElementById("task-name")) p.name = val("task-name");
    if (document.getElementById("task-assignee")) p.assignee = val("task-assignee");
    if (document.getElementById("task-deadline")) p.deadline = val("task-deadline");
    if (document.getElementById("task-priority")) p.priority = val("task-priority");
    op("task.update", p).then(closeModal);
  },
  newTask: function (branchId) {
    var w = week();
    openModal("Add task",
      field("What needs doing", '<input id="nt-name" class="input" placeholder="Compare PMSM and BLDC on efficiency, cost and manufacturability">') +
      field("Description", '<textarea id="nt-desc" class="input" rows="3"></textarea>') +
      field("Branch", selectHtml("nt-branch", branchOptions(), branchId || "", "Pick a branch")) +
      '<div class="grid2">' +
        field("Assign to", selectHtml("nt-assignee", memberOptions(), "", "Unassigned")) +
        field("Deadline", '<input id="nt-deadline" type="date" class="input" value="' + esc(w.end) + '">') +
        field("Priority", selectHtml("nt-priority", PRIORITY, "MEDIUM")) +
        field("Status", selectHtml("nt-status", STATUS, "TODO")) +
      "</div>",
      footerButtons("Add task", "A.saveNewTask()"));
  },
  saveNewTask: function () {
    op("task.create", { name: val("nt-name"), description: val("nt-desc"), branchId: val("nt-branch"),
      assignee: val("nt-assignee"), deadline: val("nt-deadline"), priority: val("nt-priority"), status: val("nt-status") }).then(closeModal);
  },

  /* --- branches --- */
  newBranch: function (parentId) { branchForm(false, parentId); },
  newIdea: function () { branchForm(true, null); },
  saveNewBranch: function (isIdea) {
    op("branch.create", {
      weekId: WEEK_ID, name: val("nb-name"), description: val("nb-desc"), why: val("nb-why"),
      parentId: val("nb-parent"), status: val("nb-status"), isIdea: isIdea, assignees: pickedAssignees()
    }).then(function (res) { closeModal(); if (res.id) A.openBranch(res.id); });
  },
  editBranch: function (id) {
    var b = byId(S.branches, id);
    if (!b) return;
    var others = S.branches.filter(function (x) { return x.weekId === b.weekId && descendantIds(b.id).indexOf(x.id) < 0; })
      .map(function (x) { return [x.id, crumb(x.id)]; });
    openModal("Edit branch",
      field("Name", '<input id="eb-name" class="input" value="' + esc(b.name) + '">') +
      field("What it covers", '<textarea id="eb-desc" class="input" rows="3">' + esc(b.description) + "</textarea>") +
      (b.isIdea ? field("Why this is interesting", '<textarea id="eb-why" class="input" rows="3">' + esc(b.why) + "</textarea>") : "") +
      '<div class="grid2">' +
        field("Sits under", selectHtml("eb-parent", others, b.parentId || "", week().topic + " (top level)")) +
        field("Status", selectHtml("eb-status", BRANCH_STATUS, b.status)) +
      "</div>" +
      field("Who is on it", assigneePicker(b.assignees || [])),
      footerButtons("Save changes", "A.saveBranch('" + b.id + "')"));
  },
  saveBranch: function (id) {
    var p = { id: id, name: val("eb-name"), description: val("eb-desc"), parentId: val("eb-parent"),
      status: val("eb-status"), assignees: pickedAssignees() };
    if (document.getElementById("eb-why")) p.why = val("eb-why");
    op("branch.update", p).then(closeModal);
  },
  deleteBranch: function (id) {
    var b = byId(S.branches, id);
    if (!b || !confirm("Delete “" + b.name + "” and everything inside it? This cannot be undone.")) return;
    op("branch.delete", { id: id }).then(function () { A.go("tree"); });
  },

  /* --- findings, sources, notes, comments --- */
  newFinding: function (branchId) {
    var sources = S.resources.filter(function (r) { return r.branchId === branchId; });
    openModal("Add finding",
      field("Title", '<input id="nf-title" class="input" placeholder="Axial flux has a power-density advantage">') +
      field("What you found", '<textarea id="nf-text" class="input" rows="4" placeholder="Write it so someone who did not do the research can use it."></textarea>') +
      '<div class="grid2">' + field("Confidence", selectHtml("nf-conf", CONFIDENCE, "MEDIUM")) +
      field("Tags", '<input id="nf-tags" class="input" placeholder="power density, manufacturing">', "Comma separated") + "</div>" +
      (sources.length ? field("Supporting sources", '<div class="checks">' + sources.map(function (r) {
        return '<label><input type="checkbox" class="src-check" value="' + esc(r.id) + '"> ' + esc(r.title) + "</label>";
      }).join("") + "</div>") : ""),
      footerButtons("Add finding", "A.saveFinding('" + branchId + "')"));
  },
  saveFinding: function (branchId) {
    var src = [].slice.call(document.querySelectorAll(".src-check:checked")).map(function (el) { return el.value; });
    op("finding.create", { branchId: branchId, title: val("nf-title"), text: val("nf-text"),
      confidence: val("nf-conf"), tags: val("nf-tags"), sources: src }).then(closeModal);
  },
  newResource: function (branchId) {
    openModal("Add source",
      field("Title", '<input id="nr-title" class="input">') +
      field("Link", '<input id="nr-url" class="input" placeholder="https://">') +
      field("Why it matters", '<textarea id="nr-desc" class="input" rows="2" placeholder="One line so nobody has to open it to find out."></textarea>') +
      '<div class="grid2">' + field("Type", selectHtml("nr-type", RES_TYPES, "ARTICLE")) +
      field("Tags", '<input id="nr-tags" class="input">', "Comma separated") + "</div>",
      footerButtons("Add source", "A.saveResource('" + branchId + "')"));
  },
  saveResource: function (branchId) {
    op("resource.create", { branchId: branchId, title: val("nr-title"), url: val("nr-url"),
      description: val("nr-desc"), type: val("nr-type"), tags: val("nr-tags") }).then(closeModal);
  },
  addNote: function (branchId, kind) {
    var text = val("note-text");
    if (!text) return;
    var k = kind === "QUESTION" ? "QUESTION" : (document.getElementById("note-kind") ? val("note-kind") : "NOTE");
    op("note.create", { branchId: branchId, kind: k, text: text, tags: val("note-tags") });
  },
  resolveNote: function (id, resolved) { op("note.resolve", { id: id, resolved: resolved }); },
  addComment: function (type, id) {
    var text = val("comment-" + id);
    if (!text) return;
    op("comment.create", { targetType: type, targetId: id, text: text }).then(function () {
      if (type === "task") A.openTask(id);
      if (type === "opportunity") A.openOpp(id);
    });
  },
  del: function (opName, id, message) {
    if (!confirm(message || "Delete this?")) return;
    op(opName, { id: id }).then(function () { if (MODAL_OPEN) closeModal(); });
  },

  /* --- opportunities --- */
  convert: function (branchId) {
    var b = byId(S.branches, branchId);
    var o = S.opportunities.filter(function (x) { return x.branchId === branchId; })[0] || {};
    openModal(o.id ? "Edit opportunity" : "Convert branch to opportunity",
      '<p class="muted sm">The branch and its research stay exactly as they are. This adds the case for treating it as a business. Blanks are honest.</p>' +
      '<div class="grid2">' + field("Title", '<input id="op-title" class="input" value="' + esc(o.title || b.name) + '">') +
      field("Status", selectHtml("op-status", OPP_STATUS, o.status || "EXPLORING")) + "</div>" +
      '<div class="grid2">' + OPP_FIELDS.map(function (f) {
        return field(f[1], '<textarea id="op-' + f[0] + '" class="input" rows="2">' + esc(o[f[0]] || "") + "</textarea>");
      }).join("") + "</div>",
      footerButtons(o.id ? "Save opportunity" : "Create opportunity", "A.saveOpp('" + branchId + "')"), true);
  },
  saveOpp: function (branchId) {
    var p = { branchId: branchId, title: val("op-title"), status: val("op-status") };
    OPP_FIELDS.forEach(function (f) { p[f[0]] = val("op-" + f[0]); });
    op("opportunity.save", p).then(function () { closeModal(); A.go("opportunities"); });
  },
  openOpp: function (id) {
    var o = byId(S.opportunities, id);
    if (!o) return;
    openModal("Opportunity",
      '<div class="row-title">' + esc(o.title) + " " + chip(o.status, toneFor("opp", o.status)) + "</div>" +
      '<p class="muted xs">Written up by ' + esc(nameOf(o.createdBy)) + " · " + fmtDate(o.createdAt) +
      ' · <button class="link" onclick="A.closeModal();A.openBranch(\'' + o.branchId + '\')">open its research</button></p>' +
      (readOnly() ? "" : field("Status", selectHtml("opp-status-" + o.id, OPP_STATUS, o.status)) +
        '<button class="btn sm" onclick="A.setOppStatus(\'' + o.id + '\')">Update status</button>') +
      '<dl class="opp-grid">' + OPP_FIELDS.map(function (f) {
        return "<div><dt>" + esc(f[1]) + "</dt><dd>" + (o[f[0]] ? esc(o[f[0]]) : '<span class="muted">Not answered yet</span>') + "</dd></div>";
      }).join("") + "</dl>" +
      (readOnly() ? "" : '<button class="btn" onclick="A.convert(\'' + o.branchId + '\')">Edit the write-up</button>') +
      '<hr class="rule"><h4 class="sub">Discussion</h4>' + discussionHtml("opportunity", o.id),
      '<button class="btn" onclick="A.closeModal()">Close</button>', true);
  },
  setOppStatus: function (id) { op("opportunity.status", { id: id, status: val("opp-status-" + id) }).then(closeModal); },

  /* --- decisions --- */
  newDecision: function () {
    openModal("Log a decision",
      field("Question", '<input id="nd-q" class="input" placeholder="Should we investigate robotic actuators further?">') +
      field("Decision", selectHtml("nd-decision", ["YES", "NO", "DEFERRED"], "YES")) +
      field("Reason", '<textarea id="nd-reason" class="input" rows="3" placeholder="High import dependence, strong demand, the team can build it."></textarea>') +
      '<div class="grid2">' + field("Date", '<input id="nd-date" type="date" class="input" value="' + today() + '">') +
      field("Who was in the room", '<input id="nd-people" class="input" value="All members">') + "</div>",
      footerButtons("Log decision", "A.saveDecision()"));
  },
  saveDecision: function () {
    op("decision.create", { weekId: WEEK_ID, question: val("nd-q"), decision: val("nd-decision"),
      reason: val("nd-reason"), date: val("nd-date"), participants: val("nd-people") }).then(closeModal);
  },

  /* --- meeting --- */
  addPoint: function (promptId) {
    var text = val("mp-" + promptId);
    if (!text) return;
    op("meeting.create", { weekId: WEEK_ID, promptId: promptId, text: text });
  },
  verdict: function (id, v) {
    var m = byId(S.meeting, id);
    op("meeting.verdict", { id: id, verdict: m && m.verdict === v ? "" : v });
  },

  /* --- summary and weeks --- */
  editSummary: function () { VIEW = { name: "summary", editing: true }; render(); },
  saveSummary: function () {
    var summary = {};
    SUMMARY_FIELDS.forEach(function (f) { summary[f[0]] = val("sum-" + f[0]); });
    op("week.summary", { id: WEEK_ID, summary: summary }).then(function () { VIEW = { name: "summary" }; render(); });
  },
  editWeek: function () {
    var w = week();
    openModal("Edit week",
      field("Main topic", '<input id="ew-topic" class="input" value="' + esc(w.topic) + '">') +
      field("Objective", '<textarea id="ew-obj" class="input" rows="3">' + esc(w.objective) + "</textarea>") +
      '<div class="grid2">' + field("Starts", '<input id="ew-start" type="date" class="input" value="' + esc(w.start) + '">') +
      field("Ends", '<input id="ew-end" type="date" class="input" value="' + esc(w.end) + '">') + "</div>",
      footerButtons("Save changes", "A.saveWeek()"));
  },
  saveWeek: function () {
    op("week.update", { id: WEEK_ID, topic: val("ew-topic"), objective: val("ew-obj"), start: val("ew-start"), end: val("ew-end") }).then(closeModal);
  },
  newWeek: function () {
    var start = today();
    openModal("Start a new week",
      '<p class="muted sm">The current week is archived when the new one starts. Nothing is deleted.</p>' +
      field("Main topic", '<input id="nw-topic" class="input" placeholder="Industrial robotics">') +
      field("Objective", '<textarea id="nw-obj" class="input" rows="3" placeholder="What do we want to understand by Sunday?"></textarea>') +
      '<div class="grid2">' + field("Starts", '<input id="nw-start" type="date" class="input" value="' + start + '">') +
      field("Ends", '<input id="nw-end" type="date" class="input" value="' + addDays(start, 6) + '">') + "</div>",
      footerButtons("Start week", "A.saveNewWeek()"));
  },
  saveNewWeek: function () {
    op("week.create", { topic: val("nw-topic"), objective: val("nw-obj"), start: val("nw-start"), end: val("nw-end") })
      .then(function (res) { closeModal(); if (res.id) { WEEK_ID = res.id; VIEW = { name: "dashboard" }; render(); } });
  },
  closeWeek: function () {
    var w = week(), st = stats(w.id);
    openModal("Close and archive this week",
      '<p class="muted sm">Once closed, the week becomes read-only and moves to the archive. Everything stays searchable.</p>' +
      '<div class="checks">' + CHECKLIST.map(function (c, i) {
        return '<label><input type="checkbox" class="cl-check" data-label="' + esc(c) + '"' + ((w.checklist || {})[c] ? " checked" : "") + "> " + esc(c) + "</label>";
      }).join("") + "</div>" +
      '<p class="muted xs">' + st.done + " of " + st.tasks + " tasks completed · " + st.findings + " findings · " +
      st.opportunities + " opportunities · " + st.questions + " open questions.</p>",
      '<button class="btn" onclick="A.closeModal()">Not yet</button><button class="btn primary" onclick="A.doCloseWeek()">Close week</button>');
  },
  doCloseWeek: function () {
    var checklist = {};
    [].slice.call(document.querySelectorAll(".cl-check")).forEach(function (el) { checklist[el.getAttribute("data-label")] = el.checked; });
    op("week.close", { id: WEEK_ID, checklist: checklist }).then(function () { closeModal(); A.go("archive"); });
  },

  /* --- members --- */
  newMember: function () {
    openModal("Add member",
      field("Name", '<input id="nm-name" class="input">') +
      field("Role", selectHtml("nm-role", [["MEMBER", "Member"], ["ADMIN", "Admin"]], "MEMBER")) +
      field("Starting password", '<input id="nm-pass" class="input" value="welcome123">', "Tell them to change it from the account button in the sidebar."),
      footerButtons("Add member", "A.saveNewMember()"));
  },
  saveNewMember: function () {
    op("member.create", { name: val("nm-name"), role: val("nm-role"), password: val("nm-pass") }).then(closeModal);
  },
  editMember: function (id) {
    var m = byId(S.members, id);
    if (!m) return;
    openModal("Edit " + m.name,
      field("Name", '<input id="em-name" class="input" value="' + esc(m.name) + '">') +
      field("Role", selectHtml("em-role", [["MEMBER", "Member"], ["ADMIN", "Admin"]], m.role)) +
      field("Reset password to", '<input id="em-pass" class="input" placeholder="Leave blank to keep the current one">'),
      footerButtons("Save", "A.saveMember('" + id + "')"));
  },
  saveMember: function (id) {
    var p = { id: id, name: val("em-name"), role: val("em-role") };
    if (val("em-pass")) p.password = val("em-pass");
    op("member.update", p).then(closeModal);
  },
  removeMember: function (id) {
    var m = byId(S.members, id);
    if (!m || !confirm("Remove " + m.name + "? Their tasks become unassigned.")) return;
    op("member.delete", { id: id });
  },

  closeModal: closeModal,
  closeModalIfBg: function (e) { if (e.target.classList.contains("modal-bg")) closeModal(); }
};
window.A = A;

/* --------------------------- small form helpers --------------------------- */
function currentlyOpen(id) {
  var b = byId(S.branches, id);
  var depth = b ? pathOf(id).length - 1 : 0;
  return id in OPEN_NODES ? OPEN_NODES[id] : depth === 0;
}
function assigneePicker(selected) {
  return '<div class="picker">' + S.members.map(function (m) {
    return '<label class="pick"><input type="checkbox" class="assignee-check" value="' + esc(m.id) + '"' +
      (selected.indexOf(m.id) >= 0 ? " checked" : "") + "> " + esc(m.name) + "</label>";
  }).join("") + "</div>";
}
function pickedAssignees() {
  return [].slice.call(document.querySelectorAll(".assignee-check:checked")).map(function (el) { return el.value; });
}
function branchForm(isIdea, parentId) {
  openModal(isIdea ? "New idea / branch" : "New branch",
    (isIdea ? '<p class="note-violet">Found something the week&#39;s topic did not cover? Park it here as its own branch — the original research stays exactly where it was.</p>' : "") +
    field("Title", '<input id="nb-name" class="input" placeholder="' + (isIdea ? "Robotic actuators" : "Manufacturing") + '">') +
    (isIdea ? field("Why this is interesting", '<textarea id="nb-why" class="input" rows="3" placeholder="Imported actuators are expensive and robotics demand is rising."></textarea>') : "") +
    field("What it covers", '<textarea id="nb-desc" class="input" rows="3"></textarea>') +
    '<div class="grid2">' +
      field("Sits under", selectHtml("nb-parent", branchOptions(), parentId || "", week().topic + " (top level)")) +
      field("Status", selectHtml("nb-status", BRANCH_STATUS, isIdea ? "EXPLORING" : "ACTIVE")) + "</div>" +
    field("Who picks this up", assigneePicker([])),
    footerButtons("Create branch", "A.saveNewBranch(" + (isIdea ? "true" : "false") + ")"));
}

/* --------------------------------- boot --------------------------------- */
function refresh() {
  if (!ME || MODAL_OPEN) return;
  var el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  apiGet("/api/state").then(function (res) {
    if (!S || res.state.updatedAt !== S.updatedAt) { S = res.state; ME = res.user; render(); }
  }).catch(function () {});
}
document.addEventListener("click", function (e) {
  var wrap = document.querySelector(".search-wrap");
  if (wrap && !wrap.contains(e.target)) {
    var box = document.getElementById("search-results");
    if (box) box.classList.remove("show");
  }
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && MODAL_OPEN) closeModal();
  if (e.key === "Enter" && e.target && e.target.classList && e.target.classList.contains("input") && e.target.tagName === "INPUT") {
    var btn = e.target.parentElement && e.target.parentElement.querySelector(".btn.primary");
    if (btn) btn.click();
  }
});
apiGet("/api/state").then(function (res) {
  ME = res.user; S = res.state; render();
}).catch(function () { if (!ME) renderLogin(); });
setInterval(refresh, 15000);
})();
